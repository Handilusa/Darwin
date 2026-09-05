// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 *  Where a window's market facts come from.
 *
 *  WHY THIS IS AN INTERFACE AND NOT A DIRECT ORACLE READ. An organism must be told
 *  the window's OPENING price, because that is the level a DreamDEX event contract
 *  resolves against — an organism given only the current price is answering a
 *  different question than the one it will be graded on. OracleHub is deployed at a
 *  known address but its read ABI has not been verified against a live node yet, so
 *  hardwiring a guess would put an unverified call on the critical path of an
 *  unattended ten-day run.
 *
 *  The seam costs one `staticcall` and buys the ability to swap provenance without
 *  touching Population:
 *
 *    v1  PushedPriceSource — the cadence trigger writes the window's facts.
 *        Ships day 2. Honest description: prices are pushed, everything else
 *        (cognition, commitment, selection, death, reproduction) is on-chain.
 *
 *    v2  OracleHubPriceSource — reads the hub directly, or receives the read as a
 *        reactivity `ethCalls` result delivered atomically with the tick. At that
 *        point nothing off-chain remains in the causal chain.
 *
 *  Do not claim v2's property while running v1.
 */
interface IPriceSource {
    /**
     *  Everything `Population.think()` needs about the live window, in one call.
     *
     *  @return marketId          DreamDEX market key for the current window.
     *  @return pool             Resolved from markets(marketId). NEVER cached —
     *                           pools are recycled across windows.
     *  @return outcomeIdUp      YES token id for this window (encodes pool nonce).
     *  @return outcomeIdDown    NO token id for this window.
     *  @return openPrice        The level resolution is measured against.
     *  @return lastPrice        Latest observed price.
     *  @return priceDecimals    Scale of both prices. Derived, never assumed, and
     *                           bounded: an implementation MUST NOT return a value
     *                           above 77. `Genome._decimal` renders the prompt with
     *                           `10 ** priceDecimals`, which overflows uint256 past
     *                           that and reverts `think()` for the WHOLE population
     *                           with a bare arithmetic panic — outside the
     *                           per-organism try/catch, so it is not survivable as a
     *                           `ThinkFailed`. `PushedPriceSource` enforces a tighter
     *                           18 at push time and explains the choice there.
     *  @return secondsRemaining Until the window closes.
     *  @return tradeable        False unless the market's status is exactly 1.
     *                           Population must not open a position when false.
     */
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
        );
}
