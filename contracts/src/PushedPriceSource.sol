// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceSource} from "./interfaces/IPriceSource.sol";
import {IBinaryMarketsModule, IBinaryMarket} from "./interfaces/IDreamDEX.sol";

/**
 *  v1 price source: two numbers pushed, everything else read from chain.
 *
 *  The naive version of this contract would have the cadence script push the whole
 *  window — pool address, outcome ids, tradeability, the lot — which would put a
 *  large off-chain trust surface directly under the organisms' commitments.
 *
 *  It does not need to. `BinaryMarketsModule.markets(marketId)` returns `pool`,
 *  `yesId`, `noId`, `tradingStart` and `expiry`, and that ABI is verified against
 *  the SDK. So structure, identity and timing are all read from chain truth, and the
 *  only pushed values are the OPENING and LAST prices — the two things no verified
 *  on-chain read is available for yet.
 *
 *  That distinction matters for how this gets described. "Prices are pushed; pool
 *  resolution, outcome ids, tradeability and timing are read on-chain" is accurate.
 *  "The oracle is off-chain" would overstate it, and "everything is on-chain" would
 *  understate it. Both are wrong.
 *
 *  Replaced by an OracleHub-reading implementation once that ABI is verified; nothing
 *  in Population changes when it is.
 */
contract PushedPriceSource is IPriceSource {
    IBinaryMarketsModule public immutable module;
    address public owner;
    address public updater;

    struct Window {
        bytes32 marketId;
        uint256 openPrice; // the level resolution is measured against
        uint256 lastPrice;
        uint8 priceDecimals;
        uint64 updatedAt;
    }

    /// @dev Keyed by symbol so a second market ("ETH") needs no new deployment.
    mapping(string => Window) internal windows;

    /// @dev A price older than this is refused rather than served. A stalled pusher
    ///      must stop the population, not feed it a price from twenty minutes ago —
    ///      organisms would commit real collateral against a stale opening level and
    ///      the fitness signal would be measuring the pusher, not the forecaster.
    uint64 public maxStaleness = 180;

    /// @dev Largest `priceDecimals` a push may carry. See `pushWindow` for why this
    ///      is 18 and not the arithmetic limit of 77.
    uint8 public constant MAX_PRICE_DECIMALS = 18;

    event WindowPushed(string symbol, bytes32 indexed marketId, uint256 openPrice, uint256 lastPrice);
    event UpdaterChanged(address updater);
    /// @dev `setUpdater` has always emitted; this one did not until 2026-09-05, so a
    ///      loosened staleness guard was the one operator change that left no trace.
    event MaxStalenessChanged(uint64 previous, uint64 current);

    error NotAuthorized();
    error NoWindow(string symbol);
    error StalePrice(uint64 age, uint64 limit);
    error ZeroStaleness();
    error ZeroPrice();
    error ZeroMarket();
    error BadDecimals(uint8 got, uint8 limit);

    constructor(IBinaryMarketsModule module_, address owner_, address updater_) {
        module = module_;
        owner = owner_;
        updater = updater_;
    }

    function setUpdater(address updater_) external {
        if (msg.sender != owner) revert NotAuthorized();
        updater = updater_;
        emit UpdaterChanged(updater_);
    }

    /**
     *  ZERO IS REJECTED; LARGE IS MERELY RECORDED, and the asymmetry is the point.
     *
     *  `currentWindow` refuses a price when `age > maxStaleness`, so zero refuses
     *  every price not pushed in the same second — which in practice is every price,
     *  because `pushWindow` and `think` are two transactions. That bricks the feed,
     *  and with it every `think`, from one `onlyOwner` call whose most likely cause
     *  is an uninitialised variable rather than an intention. A LARGE value is the
     *  opposite: it is a deliberate loosening of the guard, sometimes a correct one
     *  on a chain having a slow minute, so it is allowed and the event above makes
     *  it visible instead of a cap picking an arbitrary number on the owner's behalf.
     */
    function setMaxStaleness(uint64 seconds_) external {
        if (msg.sender != owner) revert NotAuthorized();
        if (seconds_ == 0) revert ZeroStaleness();
        emit MaxStalenessChanged(maxStaleness, seconds_);
        maxStaleness = seconds_;
    }

    /**
     *  A ZERO PRICE IS THE ONE BAD PUSH THAT DOES NOT ANNOUNCE ITSELF, so it is
     *  refused here rather than downstream.
     *
     *  Staleness is already guarded because a stalled pusher must stop the population
     *  instead of feeding it a price from twenty minutes ago. A zero is worse than
     *  stale: nothing reverts, and every organism is graded against nothing. On the
     *  duel venue the outcome is the sign of `lastPrice - openPrice`, so an
     *  `openPrice` of zero makes UP win deterministically no matter what BTC did —
     *  a whole window of fitness signal that measures the pusher, not the forecaster,
     *  and the counters it moves are permanent.
     *
     *  This is not hypothetical: `scripts/lib/market.ts:151` names the exact failure
     *  ("silently reads `undefined` as 0 pushes a zero opening price and every
     *  organism is graded against nothing") and guards `undefined` — but a REST
     *  payload carrying a literal `0`, or an `OPEN_PRICE=0` in the environment
     *  override at `market.ts:129`, still arrives here as a well-formed zero. The
     *  updater is a hot key on a script; this contract is the trust boundary, so the
     *  check belongs on this side of it.
     *
     *  `marketId` is refused for a narrower reason: `currentWindow` reads a zero
     *  `marketId` as "no window at all" (`NoWindow`), so pushing one writes a window
     *  the reader denies exists. Failing at the push says what actually went wrong.
     *
     *  `priceDecimals` is capped, and the cap is a judgment rather than a
     *  measurement — say so rather than dress it up. The MECHANICAL limit is 77:
     *  `Genome._decimal` computes `10 ** decimals`, which overflows uint256 above
     *  that and takes `Population.think` down with a bare arithmetic panic — not a
     *  per-organism `ThinkFailed` but the whole window, since `beliefPrompt` is
     *  called outside the per-organism try/catch, and with a revert reason that
     *  names neither this field nor this contract. The cap here is **18** instead,
     *  because `priceDecimals` describes the scale of a price and no ERC-20 or price
     *  feed reports more (tUSDC is 6, `market.ts` defaults to 6, Chainlink tops out
     *  at 18), so nothing real is rejected and a garbage value is named at the push
     *  instead of surfacing as a population that cannot think. If a feed ever
     *  genuinely reports more, this is one line on a plain redeployable contract —
     *  raise it, and mind that anything above 77 needs `_decimal` fixed first.
     */
    function pushWindow(
        string calldata symbol,
        bytes32 marketId,
        uint256 openPrice,
        uint256 lastPrice,
        uint8 priceDecimals
    ) external {
        if (msg.sender != updater && msg.sender != owner) revert NotAuthorized();
        if (marketId == bytes32(0)) revert ZeroMarket();
        if (openPrice == 0 || lastPrice == 0) revert ZeroPrice();
        if (priceDecimals > MAX_PRICE_DECIMALS) revert BadDecimals(priceDecimals, MAX_PRICE_DECIMALS);
        windows[symbol] = Window({
            marketId: marketId,
            openPrice: openPrice,
            lastPrice: lastPrice,
            priceDecimals: priceDecimals,
            updatedAt: uint64(block.timestamp)
        });
        emit WindowPushed(symbol, marketId, openPrice, lastPrice);
    }

    /// @inheritdoc IPriceSource
    function currentWindow(string calldata symbol)
        external
        view
        returns (
            bytes32 marketId,
            address pool,
            uint256 outcomeIdUp,
            uint256 outcomeIdDown,
            uint256 openPrice,
            uint256 lastPrice,
            uint8 priceDecimals,
            uint64 secondsRemaining,
            bool tradeable
        )
    {
        // Scoped so neither `w` nor `age` stays live alongside the nine named
        // returns — this whole function runs within a few slots of the limit.
        {
            Window memory w = windows[symbol];
            if (w.marketId == bytes32(0)) revert NoWindow(symbol);

            uint64 age = uint64(block.timestamp) - w.updatedAt;
            if (age > maxStaleness) revert StalePrice(age, maxStaleness);

            marketId = w.marketId;
            openPrice = w.openPrice;
            lastPrice = w.lastPrice;
            priceDecimals = w.priceDecimals;
        }

        // Resolved fresh on every call. Pools are RECYCLED across windows, so a
        // cached pool address is a live wire: it will eventually point at a pool
        // belonging to a different market, and a mint would succeed against the
        // wrong book. Outcome ids encode the pool nonce and are equally unsafe to
        // cache.
        Resolved memory r = _resolveMarket(marketId);
        pool = r.pool;
        outcomeIdUp = r.outcomeIdUp;
        outcomeIdDown = r.outcomeIdDown;

        uint256 now_ = block.timestamp;
        if (now_ >= r.expiry) {
            secondsRemaining = 0;
        } else {
            secondsRemaining = uint64(r.expiry - now_);
        }

        tradeable = r.pool != address(0) && now_ >= r.tradingStart && now_ < r.expiry
            && !IBinaryMarket(r.marketAddr).isResolved() && !IBinaryMarket(r.marketAddr).isVoided();
    }

    /// @dev Returned as one memory struct rather than a six-value tuple: a tuple
    ///      assignment costs six stack slots at the call site, and `currentWindow`
    ///      does not have six to spare. A memory pointer costs one.
    struct Resolved {
        address marketAddr;
        address pool;
        uint256 outcomeIdUp;
        uint256 outcomeIdDown;
        uint64 tradingStart;
        uint64 expiry;
    }

    /**
     *  Pull the six fields we need out of a 14-field market record.
     *
     *  ISOLATED IN ITS OWN STACK FRAME ON PURPOSE. Destructuring a 14-tuple needs
     *  fourteen stack slots at once, and doing that inside `currentWindow` — where
     *  nine named return values are live for the whole body — overflows the stack.
     *  Splitting the read out is what makes that function compile; do not inline it
     *  back. It also gives the skipped-field documentation one obvious home.
     *
     *  The eight skipped fields are indices 0..7: oracleQuestionId,
     *  outcomeSlotCount, voidPolicy, collateral, originOperatorId, originVenueId,
     *  oracleAdapter, creator.
     */
    function _resolveMarket(bytes32 marketId) internal view returns (Resolved memory r) {
        (,,,,,,,, r.marketAddr, r.pool, r.outcomeIdUp, r.outcomeIdDown, r.tradingStart, r.expiry) =
            module.markets(marketId);
    }

    /// @dev Convenience for the monitor: what was pushed, without the liveness
    ///      checks that make `currentWindow` revert.
    function rawWindow(string calldata symbol) external view returns (Window memory) {
        return windows[symbol];
    }
}
