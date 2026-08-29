// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 *  Where a window's POSITIONS live, and how a resolved position becomes
 *  collateral.
 *
 *  The companion to IPriceSource, which already abstracts what the window IS.
 *  Together they are DARWIN's whole dependency on any particular venue: bring a
 *  way to issue opposing backed positions and a way to pay the side reality
 *  agreed with, and the engine is indifferent to how that adjudication happens.
 *
 *  v1  DreamDEXVenue     — complete-set mint + finalizeAndRedeem.
 *  v2  DirectDuelVenue   — escrow resolved by the sign of a price change.
 *
 *  CONSTRAINT THAT OUTRANKS EVERY OTHER CONSIDERATION HERE: redeemFor is called
 *  from inside a reactivity callback, in the same block the underlying
 *  resolution lands. An implementation that needs a second transaction, a
 *  keeper, or a waiting period breaks the project's central technical claim,
 *  not merely its performance.
 */
interface IArenaVenue {
    /**
     *  Issue opposing, fully-backed positions out of `amount` collateral, which
     *  the venue pulls from msg.sender (Population holds it for the duration of
     *  one transaction and approves exactly this amount).
     *
     *  @return upId     Position id now held by `up`.
     *  @return downId   Position id now held by `down`.
     *  @return quantity Position units EACH side holds. NOT the same number as
     *                   either side's collateral contribution: a 1:1-backed pair
     *                   funded from both sides leaves each holding the pair's
     *                   whole backing. Conflating the two makes every winner
     *                   read as a break-even and silently zeroes the fitness
     *                   signal.
     */
    function openOpposing(address up, address down, uint256 amount)
        external
        returns (uint256 upId, uint256 downId, uint256 quantity);

    /**
     *  Convert a resolved position into collateral paid to `organism`.
     *
     *  CALL PROTOCOL — the caller MUST have transferred the position to this
     *  venue first, if `positionToken()` is non-zero. This is not a stylistic
     *  choice; it is forced by the redemption primitive. DreamDEX's
     *  `finalizeAndRedeem` burns from `msg.sender` — its `Redeemed` event
     *  distinguishes `holder` from `to` for exactly that reason — and the
     *  ERC-6909 surface this project depends on exposes `transfer` and
     *  `setOperator` but no `transferFrom`, so a venue CANNOT pull an
     *  organism's tokens no matter what rights it has been granted. The
     *  organism pushes; the venue redeems as holder and directs the payout back.
     *
     *  Custody is transient and the whole sequence is one call, so a revert
     *  anywhere unwinds the transfer with it. Nothing is stranded.
     *
     *  MUST return 0 for a losing position rather than reverting — a loser
     *  settling is the normal case, and a revert here would abort the window for
     *  every other organism. MUST be callable in the resolution block.
     *
     *  @return collateralOut What the position was WORTH. The caller separately
     *          measures what actually ARRIVED; the two differ whenever a venue
     *          credits an owed balance instead of transferring, and that
     *          difference is the gap between the fitness signal and the ledger.
     */
    function redeemFor(address organism, uint256 positionId, uint256 quantity)
        external
        returns (uint256 collateralOut);

    /**
     *  The token positions are denominated in, or `address(0)` if this venue
     *  issues no transferable position token and its ids are pure bookkeeping.
     *
     *  Zero is a real answer, not a missing one: it tells the caller to skip the
     *  push described above. `DirectDuelVenue` returns zero.
     */
    function positionToken() external view returns (address);

    /// @dev The collateral token this venue settles in.
    function collateral() external view returns (address);
}
