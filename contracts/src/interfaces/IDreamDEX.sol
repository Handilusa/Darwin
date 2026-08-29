// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// DreamDEX Event Contract interfaces.
//
// Every signature below was transcribed from @somnia-chain/markets-sdk@0.28.1
// (package/src/tradeAbi.ts, moduleAbi.ts, readsAbi.ts), which states that its
// ABIs mirror the deployed contracts exactly. See ../../SPIKE.md for the
// corrections these encode — four of them are selector-critical and were wrong
// in the pre-spike design.

/**
 *  BinaryPool — the per-market CLOB and complete-set surface.
 *
 *  IMPORTANT: the generic placeOrder / placeOrderFor / amendOrder / placeOrders
 *  entries all REVERT `UseBinaryPlacement` on a binary pool. `placeBinaryOrder`
 *  is the only placement path, and the YES/NO order kind is an explicit param.
 *
 *  Pools are per-market and RECYCLED across windows. Never store one. Resolve it
 *  from IBinaryMarketsModule.markets(marketId) every time.
 */
interface IBinaryPool {
    /// @dev kind: 0 BUY_YES, 1 SELL_YES, 2 BUY_NO, 3 SELL_NO.
    ///      `price` is ALWAYS the YES-side price, whatever the kind.
    ///      builderFeeBpsTimes1k MUST be uint96 — the selector depends on it.
    ///      Binary pools take no msg.value, but the on-chain signature is payable
    ///      and the selector includes it, so this must stay payable.
    ///      Returns (success, id) — readable by a CONTRACT caller, but not by an
    ///      EOA, which has to reconstruct the outcome from receipt events. This
    ///      asymmetry is why DARWIN's organisms place their own orders.
    function placeBinaryOrder(
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k,
        uint64 userData
    ) external payable returns (bool success, uint128 id);

    function cancelOrder(uint128 orderId) external;

    /// @dev Shrinks a resting order IN PLACE, keeping price-time queue priority
    ///      (unlike amend, which re-inserts at the back). Not placement-gated, so
    ///      it works on binary pools. newQuantityRemaining must be a lotSize
    ///      multiple and >= minQuantity.
    function reduceOrder(uint128 orderId, uint256 newQuantityRemaining) external;

    /// @dev Mint a complete pair: the pool pulls `amount` collateral from the
    ///      caller and mints `amount` YES to yesTo and `amount` NO to noTo.
    ///
    ///      yesTo and noTo are INDEPENDENT. This is how DARWIN gives two
    ///      organisms holding opposing beliefs real, fully-backed positions with
    ///      no order book and no external counterparty — the population is its
    ///      own liquidity, and the accounting is exactly 1:1.
    function mintSet(address yesTo, address noTo, uint256 amount) external;

    /// @dev Surrender `amount` YES + `amount` NO, receive `amount` collateral
    ///      back (credited via the pool's vault).
    function burnSet(uint256 amount) external;

    /// @dev A binary pool's vault accepts ONLY its collateral; anything else
    ///      reverts InvalidDepositOrWithdrawal. There is no manual-vault-mode on
    ///      a binary pool (that is SpotPool-only).
    function withdraw(address token, uint256 amount) external;
}

/**
 *  BinaryMarketsModule — the user-facing markets contract. Owns the pools and
 *  routes redemption through the settlement singleton.
 */
interface IBinaryMarketsModule {
    /// @dev The ONLY correct way to reach a pool or an outcome id.
    ///      Note yesId/noId encode the pool nonce, so a recycled pool's ids
    ///      differ between windows: never cache them across markets.
    function markets(bytes32 marketId)
        external
        view
        returns (
            uint256 oracleQuestionId,
            uint8 outcomeSlotCount,
            uint8 voidPolicy,
            address collateral,
            uint32 originOperatorId,
            bytes32 originVenueId,
            address oracleAdapter,
            address creator,
            address market,
            address pool,
            uint256 yesId,
            uint256 noId,
            uint64 tradingStart,
            uint64 expiry
        );

    function marketNonce(bytes32 marketId) external view returns (uint64 nonce);

    /// @dev Trader-facing redemption. (operatorId, venueId) are attribution-only
    ///      and may be 0. Pulls the caller's winning outcome tokens, then redeems
    ///      through the settlement singleton.
    function redeem(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint8 outcomeIdx, uint256 amount) external;

    function mintCompleteSet(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint256 amount) external;
    function mergeCompleteSet(uint32 operatorId, bytes32 venueId, bytes32 marketId, uint256 amount) external;

    /// @dev Permissionless keeper entries. finalizeMarket sweeps the pool's
    ///      backing + resolution snapshot to settlement (no-op-guarded against
    ///      double-finalize); releasePool returns a drained pool to its creator's
    ///      free list. DARWIN normally does not need finalizeMarket — it uses
    ///      BinarySettlement.finalizeAndRedeem, which folds it in.
    function finalizeMarket(bytes32 marketId) external;
    function releasePool(bytes32 marketId) external;

    /// @dev Repairs the case where BinaryMarket.voidExpired() flipped a market
    ///      Voided directly, bypassing the module, so the oracle adapter's
    ///      onResolved (hub earmark release) never fired. Reverts
    ///      MarketNotSettled while the market is still live. Idempotent.
    function syncSettlement(bytes32 marketId) external;

    /// @dev Keyed by ORACLE QUESTION, not market: fans out to every market bound
    ///      to that question. Partial success IS success; reverts
    ///      OracleNotAnswered only when none answered. First thing to try when a
    ///      market is past expiry with no resolution.
    function pokeOracle(uint256 oracleQuestionId) external;
}

/**
 *  BinarySettlement — the permanent redemption singleton every pool finalizes
 *  into. `redeem` was REMOVED from the pool in v2; this is where it lives.
 */
interface IBinarySettlement {
    /// @dev The keystone for DARWIN. Folds finalize + redeem into ONE call and
    ///      returns collateralOut, so a reactive callback can collect an
    ///      organism's winnings in the very block the market settled. Nothing
    ///      keeper-shaped sits between resolution and consequence.
    function finalizeAndRedeem(address pool, uint256 outcomeId, uint256 amount, address to)
        external
        returns (uint256 collateralOut);

    function redeem(uint256 outcomeId, uint256 amount, address to) external returns (uint256 collateralOut);
    function finalize(address pool) external returns (uint256 marketKey);

    /// @dev A payout can fall back to a credited balance instead of a transfer.
    ///      An organism that never claims strands its winnings, so Prophet
    ///      exposes a claim path.
    function claimOwed(address token) external returns (uint256 amount);
    function owed(address user, address token) external view returns (uint256);

    /// @dev settlementFeeBpsTimes1k is the field DARWIN's whole economic thesis
    ///      depends on being zero. The docs say fees are zero; this struct has a
    ///      fee field regardless. MEASURE IT on a live finalized market before
    ///      repeating the claim (see SPIKE.md).
    function getSettlement(uint256 marketKey)
        external
        view
        returns (
            address collateralToken,
            uint128 backing,
            bool finalized,
            bool voided,
            uint256 settlementFeeBpsTimes1k,
            address feeRecipient,
            address pool,
            uint64 nonce,
            uint256[] memory payoutNumerators
        );

    function isFinalized(uint256 outcomeId) external view returns (bool);
}

/**
 *  BinaryMarket — lifecycle and oracle views only. No settlement writes.
 */
interface IBinaryMarket {
    /// @dev Settlement v3 stores a payout VECTOR, not a single winner.
    ///      winningOutcome() was REMOVED and reverts on the deployed contract.
    ///      Derive the winning index as the argmax of this vector, gated on
    ///      isResolved(). Empty until resolved.
    function payoutNumerators() external view returns (uint256[] memory);

    function isResolved() external view returns (bool);
    function isVoided() external view returns (bool);
    function pool() external view returns (address);
    function outcomeToken() external view returns (address);
    function yesId() external view returns (uint256);
    function noId() external view returns (uint256);

    /// @dev expiry + settlementWindow is the instant voidExpired() is callable.
    function settlementWindow() external view returns (uint64);
}

/**
 *  OutcomeToken6909 — ONE shared ERC-6909 singleton for every market. Up and Down
 *  are token ids, not per-market ERC-20s.
 */
interface IOutcomeToken6909 {
    function balanceOf(address owner, uint256 id) external view returns (uint256);
    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool);
    function approve(address spender, uint256 id, uint256 amount) external returns (bool);
    function setOperator(address spender, bool approved) external returns (bool);
}

interface IERC20Like {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Shannon testnet tUSDC only. Credits msg.sender, caps at 10,000 tUSDC,
///      reverts FaucetCapExceeded past the cap. tUSDC is 6 decimals where
///      mainnet USDso is 18 — always derive scale from decimals(), never a
///      literal, or the two differ by 10^12.
interface ITestnetFaucet {
    function faucet(uint256 amount) external;
}
