// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IArenaVenue} from "../interfaces/IArenaVenue.sol";
import {IPriceSource} from "../interfaces/IPriceSource.sol";
import {IBinaryPool, IBinarySettlement, IERC20Like} from "../interfaces/IDreamDEX.sol";

/**
 *  Adapter one: DreamDEX event contracts. Fitness function #1.
 *
 *  Plain and non-upgradeable on purpose. It holds nothing of value between
 *  transactions and is freely redeployable via Population.setWiring, which is
 *  what makes the venue seam cheap to replace.
 *
 *  WHY redeemFor DOES NOT READ THE PRICE SOURCE. `openOpposing` resolves the
 *  pool fresh through IPriceSource, because pools are recycled across windows and
 *  a cached pool eventually points at a different market's book. `redeemFor`
 *  cannot do the same: IPriceSource.currentWindow reverts StalePrice past
 *  maxStaleness (180s), and in the reactive path NOBODY pushes a price before
 *  settlement — no keeper between resolution and consequence is the project's
 *  central claim. Reading the price source at settlement would make that path
 *  revert every time, and it would only ever pass under a keeper-driven cadence
 *  that happened to push first. So the pool is RECORDED per position id at open
 *  time and read back at settlement.
 *
 *  That is not a cache of "the current pool" — the thing the never-cache rule
 *  forbids. It is recorded truth about one specific position, the same shape as
 *  Prophet.currentMarketId, and it is written every time a position is issued.
 */
contract DreamDEXVenue is IArenaVenue {
    IPriceSource public immutable priceSource;
    address public immutable settlement;
    address public immutable collateralToken;
    address public immutable outcomeToken;
    string public symbol;

    /// @dev Which pool a position id was issued against. Written at open, read at
    ///      settle. See the note above on why this is not a forbidden cache.
    mapping(uint256 => address) public poolOf;

    error NotTradeable();
    error TransferFailed();
    error UnknownPosition(uint256 positionId);

    constructor(
        IPriceSource priceSource_,
        address settlement_,
        address collateral_,
        address outcomeToken_,
        string memory symbol_
    ) {
        priceSource = priceSource_;
        settlement = settlement_;
        collateralToken = collateral_;
        outcomeToken = outcomeToken_;
        symbol = symbol_;
    }

    function collateral() external view returns (address) {
        return collateralToken;
    }

    function positionToken() external view returns (address) {
        return outcomeToken;
    }

    function openOpposing(address up, address down, uint256 amount)
        external
        returns (uint256 upId, uint256 downId, uint256 quantity)
    {
        address pool;
        bool tradeable;
        (, pool, upId, downId,,,,, tradeable) = priceSource.currentWindow(symbol);
        if (!tradeable) revert NotTradeable();

        if (!IERC20Like(collateralToken).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        // Per-call approval, not infinite: pools are recycled across windows, and
        // a standing allowance to a recycled address is a liability nobody is
        // watching.
        IERC20Like(collateralToken).approve(pool, amount);
        IBinaryPool(pool).mintSet(up, down, amount);

        poolOf[upId] = pool;
        poolOf[downId] = pool;

        // Each side HOLDS the pair's whole backing while having RISKED only its
        // own contribution, so the winner nets the loser's stake at an effective
        // price of 0.5. Do not derive this from either side's contribution.
        quantity = amount;
    }

    function redeemFor(address organism, uint256 positionId, uint256 quantity)
        external
        returns (uint256 collateralOut)
    {
        address pool = poolOf[positionId];
        if (pool == address(0)) revert UnknownPosition(positionId);

        // The organism transferred the position here immediately before this
        // call, so this contract is the holder finalizeAndRedeem burns from, and
        // `organism` is the payee. Redeeming a losing id is legal and returns
        // zero. NOT wrapped in try/catch: a genuinely reverting settlement is an
        // integration break that should abort rather than be silenced, and
        // Population.settleAll already isolates one organism's failure from the
        // rest of the window.
        //
        // `organism` is passed as `to` rather than this contract for a reason
        // beyond saving a hop: settlement may CREDIT an owed balance instead of
        // transferring, and the credit is booked against `to`. Routing it here
        // would strand a winner's payout in a venue with no claim path, where
        // Prophet._sweepOwed can rescue it from the organism.
        collateralOut = IBinarySettlement(settlement).finalizeAndRedeem(pool, positionId, quantity, organism);
    }
}
