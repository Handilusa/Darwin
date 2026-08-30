/**
 *  On-chain enum values, and how to say them in English.
 *
 *  This module imports NOTHING. That is its whole purpose: the fixture renderer, the
 *  formatting helpers and the lineage layout all need these labels, and none of them should
 *  drag a 1MB chain library off a CDN to spell the word "Momentum". `abi.js` is the only
 *  module that touches viem, and it is imported lazily, so `?demo=1` renders with the
 *  network unplugged.
 *
 *  Indices are the on-chain values. Do not reorder — these are storage-visible enums and a
 *  reordering here silently mislabels every organism on the page.
 */

/** Genome.sol:5-10 */
export const BELIEF = ["None", "Up", "Down", "Abstain"];

/** Genome.sol:26-32 */
export const THESIS = ["Unknown", "Momentum", "Reversion", "Breakout", "Range"];

/**
 *  Population.sol:92 comments `phase` as `0 idle, 1 thinking, 2 committed` — that is the
 *  population's STATE. The operational scripts' own `PHASE` array is labelled by the NEXT
 *  ACTION instead (`THINK`, `COMMIT`, `SETTLE`), so the same number 0 reads as "idle" in the
 *  contract and "THINK" in the terminal. Both are correct and they are off by one step.
 *
 *  A dashboard that picked one and dropped the label would describe a live population
 *  backwards, so this one shows the state and names the call that advances it.
 */
export const PHASE_STATE = ["Idle", "Thinking", "Committed"];
export const PHASE_NEXT = ["think()", "commitAll()", "settleAll()"];

/** Belief -> a CSS class, so colour is decided in one place rather than at each call site. */
export const BELIEF_TONE = ["none", "up", "down", "abstain"];

export const ZERO = "0x0000000000000000000000000000000000000000";
