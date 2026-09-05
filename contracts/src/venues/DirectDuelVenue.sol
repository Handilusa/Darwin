// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IArenaVenue} from "../interfaces/IArenaVenue.sol";
import {IPriceSource} from "../interfaces/IPriceSource.sol";
import {IERC20Like} from "../interfaces/IDreamDEX.sol";

/**
 *  Adapter two: a duel resolved by the sign of a price change. Fitness function #2.
 *
 *  It exists to make one claim executable rather than asserted: the engine does not
 *  care HOW reality is adjudicated. There are no complete sets here, no order book,
 *  no external settlement contract and no pool — a pair of antes is escrowed, and
 *  the side the price agreed with takes the whole backing.
 *
 *  Plain and non-upgradeable, like `DreamDEXVenue`, and freely redeployable through
 *  `Population.setWiring`. Unlike that one it DOES hold value between transactions:
 *  a duel's backing sits here from `openOpposing` until both sides have redeemed.
 *  Every path below therefore has to account for the whole backing exactly once,
 *  and the accounting is the part of this contract worth reviewing.
 *
 *  HOW MUCH OF THE DREAMDEX DEPENDENCY THIS ACTUALLY REMOVES, stated precisely
 *  because the spec's first draft overstated it. This venue needs no market: it
 *  reads two prices and moves collateral. But it reads them through `IPriceSource`,
 *  and the v1 implementation (`PushedPriceSource`) resolves a real DreamDEX market
 *  to compute `tradeable` — while `Population.think` refuses a window whose market
 *  is not tradeable. So an arena wired to this venue still cannot open a window
 *  without a live market TODAY. Removing that last thread is a price-source change
 *  (`IPriceSource` v2, reading the oracle hub directly), not a venue change. What
 *  is true now is narrower and still worth having: settlement itself cannot fail
 *  for want of a market, a pool, or a counterparty contract of any kind.
 *
 *  HONEST LIMITATION: a venue we wrote ourselves is a weaker generality proof than
 *  a third-party integration. What it does establish is that the settlement
 *  MECHANISM is swappable, which is the claim the platform story rests on.
 */
contract DirectDuelVenue is IArenaVenue {
    /*//////////////////////////////////////////////////////////////
                                  WIRING
    //////////////////////////////////////////////////////////////*/

    address public immutable collateralToken;
    IPriceSource public immutable priceSource;
    string public symbol;

    /*//////////////////////////////////////////////////////////////
                                  STATE
    //////////////////////////////////////////////////////////////*/

    /**
     *  How a duel ended. `Pending` is the only value that can still change.
     *
     *  `Void` covers three different stories that all pay the same way — a flat
     *  print, a window this venue could not observe a closing price for, and a
     *  closing price belonging to some other window — because the payout is the
     *  only thing the accounting cares about: each side takes back exactly what it
     *  risked. The events distinguish them for whoever is watching.
     */
    enum Outcome {
        Pending,
        Up,
        Down,
        Void
    }

    struct Duel {
        bytes32 marketId; // the window this duel was opened against
        uint256 openPrice; // the level the organisms were asked about
        uint256 closePrice; // 0 until observed; kept for anyone reading duels directly
        uint256 backing; // BOTH antes. Doubles as the "does this duel exist" flag
        address up;
        address down;
        Outcome outcome;
        bool upClaimed;
        bool downClaimed;
    }

    /// @dev Sequential and never recycled, so a stale id can never be mistaken for a
    ///      live one. Position ids are derived from this rather than stored: duel `k`
    ///      owns ids `2k-1` (up) and `2k` (down), which is why there is no
    ///      positionId -> duelId mapping to keep in step with anything.
    uint256 public duelCount;

    mapping(uint256 => Duel) public duels;

    /*//////////////////////////////////////////////////////////////
                              EVENTS / ERRORS
    //////////////////////////////////////////////////////////////*/

    event DuelOpened(
        uint256 indexed duelId, bytes32 indexed marketId, address up, address down, uint256 backing, uint256 openPrice
    );
    event DuelResolved(uint256 indexed duelId, uint256 openPrice, uint256 closePrice, Outcome outcome);

    /// @dev No closing price could be attributed to this duel's window, so both sides
    ///      get their ante back and neither is graded. THE ONE TO ALERT ON: it means
    ///      the arena ran a window that decided nothing, and a season of these is a
    ///      population that is paying rent to think and never being measured.
    event DuelUnadjudicable(uint256 indexed duelId, bytes32 indexed marketId);

    error NothingStaked();
    error NoOpenPrice();
    error UnknownDuel(uint256 duelId);
    error NotHolder();
    error TransferFailed();

    constructor(address collateral_, IPriceSource priceSource_, string memory symbol_) {
        collateralToken = collateral_;
        priceSource = priceSource_;
        symbol = symbol_;
    }

    /*//////////////////////////////////////////////////////////////
                                 IARENAVENUE
    //////////////////////////////////////////////////////////////*/

    function collateral() external view returns (address) {
        return collateralToken;
    }

    /**
     *  No transferable position token exists here, and zero is the real answer
     *  rather than a missing one: it tells `Prophet.settleWindow` to skip the push
     *  that DreamDEX's burn-from-msg.sender redemption forces. That branch reaches
     *  production through this venue and nowhere else.
     */
    function positionToken() external pure returns (address) {
        return address(0);
    }

    /**
     *  Escrow both antes and record the level they will be judged against.
     *
     *  WHY THIS READS THE PRICE SOURCE AND `redeemFor` MUST NOT. The opening level
     *  has to be the one the organisms were actually asked about, so it is read
     *  fresh here — `currentWindow` reverting `StalePrice` is the correct outcome,
     *  and `Population._pair` already isolates that revert into a `CommitFailed`
     *  plus two empty positions, with both antes unwound by the same revert.
     *  Settlement cannot do the same: on the reactive path nobody pushes a price
     *  between resolution and the callback. So the level is RECORDED here, exactly
     *  as `DreamDEXVenue` records its pool.
     *
     *  Tradeability is deliberately NOT required. This venue never touches an order
     *  book, so a tradeable market is not one of its preconditions — freshness is.
     *  Nothing is loosened by dropping the check: `Population.think` refuses an
     *  untradeable window before any of this runs, and it is the price source, not
     *  the venue, that would have to change for a marketless arena to be possible.
     */
    function openOpposing(address up, address down, uint256 amount)
        external
        returns (uint256 upId, uint256 downId, uint256 quantity)
    {
        if (amount == 0) revert NothingStaked();

        bytes32 marketId;
        uint256 openPrice;
        (marketId,,,, openPrice,,,,) = priceSource.currentWindow(symbol);

        // An unpriced window cannot adjudicate anything: against an opening level of
        // zero every close but zero is a rise, so UP would win by arithmetic rather
        // than by being right. Refuse to issue the pair instead.
        if (openPrice == 0) revert NoOpenPrice();

        if (!IERC20Like(collateralToken).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        uint256 duelId = ++duelCount;
        upId = duelId * 2 - 1;
        downId = duelId * 2;

        Duel storage d = duels[duelId];
        d.marketId = marketId;
        d.openPrice = openPrice;
        d.backing = amount;
        d.up = up;
        d.down = down;

        // The pair's WHOLE backing, matching `DreamDEXVenue`, where a complete set
        // leaves each side holding what both sides funded. Each has risked half of
        // it, so the winner nets the loser's ante at an effective price of 0.5. Do
        // not derive this from one side's contribution.
        quantity = amount;

        emit DuelOpened(duelId, marketId, up, down, amount, openPrice);
    }

    /**
     *  Pay the side the price agreed with.
     *
     *  `quantity` is accepted for interface compatibility and deliberately ignored:
     *  this venue issues no fungible outcome units, so the position id alone
     *  determines the payout. Returns 0 for a loser rather than reverting — a losing
     *  settlement is the normal case and must not abort the window for anyone else.
     *
     *  RESOLUTION IS FROZEN BY THE FIRST CLAIM, and that is a solvency property
     *  rather than an optimisation. If each side were adjudicated against the price
     *  live at the moment it happened to claim, anyone could redeem side A while the
     *  price was up and side B after it fell, and BOTH would be paid the whole
     *  backing out of an escrow holding one. So the first claim writes the outcome
     *  and every later read of that duel — including a void — is bound by it.
     *
     *  ONLY THE POSITION'S OWNER MAY REDEEM IT, which closes the other half of the
     *  same hole. Resolution reads whatever price is current, so a bystander who
     *  could trigger it would be choosing WHEN the window closes: an entrant
     *  watching the feed would resolve at the instant their own organism was ahead.
     *  There is deliberately no public `resolve` for the same reason. The only path
     *  in is `Prophet.settleWindow`, which is `onlyPopulation` and only reachable
     *  from `settleAll` in phase 2 — so the cadence driver decides when a duel
     *  closes, exactly as it does for the DreamDEX arena.
     */
    function redeemFor(
        address organism,
        uint256 positionId,
        uint256 /* quantity */
    )
        external
        returns (uint256 collateralOut)
    {
        if (msg.sender != organism) revert NotHolder();

        uint256 duelId = (positionId + 1) / 2;
        bool isUp = positionId % 2 == 1;

        Duel storage d = duels[duelId];
        if (d.backing == 0) return 0;
        if ((isUp ? d.up : d.down) != organism) return 0;

        // Recorded before the payout is even computed, so a loser's claim is spent
        // too. A loser returning zero is not an error to be retried; it is the
        // window's answer.
        if (isUp) {
            if (d.upClaimed) return 0;
            d.upClaimed = true;
        } else {
            if (d.downClaimed) return 0;
            d.downClaimed = true;
        }

        Outcome outcome = _resolve(duelId, d);

        if (outcome == Outcome.Void) {
            // EACH SIDE TAKES BACK WHAT IT RISKED, rather than the backing being
            // stranded here. Half is exactly one ante because `Population._pair`
            // clamps both legs to the same number before it mints — an invariant
            // this venue depends on and cannot check, since `openOpposing` is handed
            // the pooled total and never the two contributions. An odd backing would
            // leave one wei behind; the pairing arithmetic cannot produce one.
            //
            // Paying the ante back is also what makes the GRADING right.
            // `Prophet.settleWindow` compares what the position was worth against
            // what was risked, so an equal number is scored as neither a win nor a
            // loss — which is what a window nobody won means, and what a voided
            // DreamDEX market already does by paying both sides 0.5. Paying zero
            // instead would book both forecasters as wrong and quietly delete the
            // collateral.
            collateralOut = d.backing / 2;
        } else if ((outcome == Outcome.Up) == isUp) {
            collateralOut = d.backing;
        } else {
            return 0;
        }

        if (!IERC20Like(collateralToken).transfer(organism, collateralOut)) revert TransferFailed();
    }

    /*//////////////////////////////////////////////////////////////
                                RESOLUTION
    //////////////////////////////////////////////////////////////*/

    /// @dev What a duel ended as, without the state write. `Pending` means it has
    ///      not been claimed against yet, not that it is unresolvable.
    function outcomeOf(uint256 duelId) external view returns (Outcome) {
        if (duels[duelId].backing == 0) revert UnknownDuel(duelId);
        return duels[duelId].outcome;
    }

    /// @dev Position ids for a duel, so a caller reading events does not have to know
    ///      the `2k-1` / `2k` convention.
    ///
    ///      Duel 0 is refused rather than allowed to underflow. Ids start at 1
    ///      (`++duelCount`), so zero is not a boundary case — it is the argument a
    ///      caller passes when it has no duel, typically an unset variable or a
    ///      `duels[id]` lookup that returned nothing. `0 * 2 - 1` answered that with a
    ///      bare arithmetic panic; `UnknownDuel(0)` answers it with the same error
    ///      `outcomeOf` already gives for every other id that does not exist. `pure`
    ///      cannot check existence beyond this one, and does not pretend to.
    function positionIdsOf(uint256 duelId) external pure returns (uint256 upId, uint256 downId) {
        if (duelId == 0) revert UnknownDuel(0);
        return (duelId * 2 - 1, duelId * 2);
    }

    /**
     *  Decide the duel once, from the closing price current at this moment.
     *
     *  Internal on purpose — see the note on `redeemFor` about who gets to choose
     *  when a window closes.
     */
    function _resolve(uint256 duelId, Duel storage d) internal returns (Outcome) {
        if (d.outcome != Outcome.Pending) return d.outcome;

        (bool ok, bytes32 marketId, uint256 closePrice) = _observe();

        // A price we cannot attribute to THIS duel's window is worse than no price:
        // it would grade a forecast about one window against the movement of
        // another. Both refusals land in the same place — void, both antes back,
        // nobody graded — because the alternative is reverting, and a revert inside
        // `settleWindow` fails the whole organism's settlement and leaves its
        // position open with the ante already gone.
        if (!ok || marketId != d.marketId) {
            d.outcome = Outcome.Void;
            emit DuelUnadjudicable(duelId, d.marketId);
            return Outcome.Void;
        }

        d.closePrice = closePrice;
        Outcome outcome;
        if (closePrice > d.openPrice) {
            outcome = Outcome.Up;
        } else if (closePrice < d.openPrice) {
            outcome = Outcome.Down;
        } else {
            // A flat print pays nobody and grades nobody. Rare on a real feed, and
            // it must not become a coin flip.
            outcome = Outcome.Void;
        }
        d.outcome = outcome;

        emit DuelResolved(duelId, d.openPrice, closePrice, outcome);
        return outcome;
    }

    /**
     *  Read the current window, tolerating its absence.
     *
     *  `currentWindow` reverts `StalePrice` past `maxStaleness` and `NoWindow` when
     *  nothing has ever been pushed, and BOTH are ordinary conditions on the path
     *  this runs on: settlement is not guaranteed a freshly pushed price. Letting
     *  either propagate would abort the organism's whole settlement — its position
     *  left open, its ante already escrowed here — so the failure is caught and
     *  turned into a void, which refunds instead of misgrading.
     *
     *  Isolated in its own frame for the same reason `PushedPriceSource._resolveMarket`
     *  is: a nine-value destructure inside a function with live locals is how this
     *  file would run out of stack.
     */
    function _observe() internal view returns (bool ok, bytes32 marketId, uint256 lastPrice) {
        try priceSource.currentWindow(symbol) returns (
            bytes32 m, address, uint256, uint256, uint256, uint256 lp, uint8, uint64, bool
        ) {
            return (true, m, lp);
        } catch {
            return (false, bytes32(0), 0);
        }
    }
}
