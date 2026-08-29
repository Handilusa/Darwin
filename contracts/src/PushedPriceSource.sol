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

    event WindowPushed(string symbol, bytes32 indexed marketId, uint256 openPrice, uint256 lastPrice);
    event UpdaterChanged(address updater);

    error NotAuthorized();
    error NoWindow(string symbol);
    error StalePrice(uint64 age, uint64 limit);

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

    function setMaxStaleness(uint64 seconds_) external {
        if (msg.sender != owner) revert NotAuthorized();
        maxStaleness = seconds_;
    }

    function pushWindow(
        string calldata symbol,
        bytes32 marketId,
        uint256 openPrice,
        uint256 lastPrice,
        uint8 priceDecimals
    ) external {
        if (msg.sender != updater && msg.sender != owner) revert NotAuthorized();
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
        Window memory w = windows[symbol];
        if (w.marketId == bytes32(0)) revert NoWindow(symbol);

        uint64 age = uint64(block.timestamp) - w.updatedAt;
        if (age > maxStaleness) revert StalePrice(age, maxStaleness);

        marketId = w.marketId;
        openPrice = w.openPrice;
        lastPrice = w.lastPrice;
        priceDecimals = w.priceDecimals;

        // Resolved fresh on every call. Pools are RECYCLED across windows, so a
        // cached pool address is a live wire: it will eventually point at a pool
        // belonging to a different market, and a mint would succeed against the
        // wrong book. Outcome ids encode the pool nonce and are equally unsafe to
        // cache.
        //
        // The eight skipped fields are oracleQuestionId, outcomeSlotCount,
        // voidPolicy, collateral, originOperatorId, originVenueId, oracleAdapter,
        // creator — indices 0..7 of a 14-field record.
        uint64 tradingStart;
        uint64 expiry;
        address marketAddr;
        (,,,,,,,, marketAddr, pool, outcomeIdUp, outcomeIdDown, tradingStart, expiry) = module.markets(marketId);

        uint256 now_ = block.timestamp;
        if (now_ >= expiry) {
            secondsRemaining = 0;
        } else {
            secondsRemaining = uint64(expiry - now_);
        }

        tradeable = pool != address(0) && now_ >= tradingStart && now_ < expiry
            && !IBinaryMarket(marketAddr).isResolved() && !IBinaryMarket(marketAddr).isVoided();
    }

    /// @dev Convenience for the monitor: what was pushed, without the liveness
    ///      checks that make `currentWindow` revert.
    function rawWindow(string calldata symbol) external view returns (Window memory) {
        return windows[symbol];
    }
}
