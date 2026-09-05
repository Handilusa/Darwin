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

/**
 *  The same four values, in words somebody who has never opened the contract can use.
 *
 *  `None` is the one that had to be translated. It is what `Prophet.settleWindow` writes at
 *  `Prophet.sol:528` and what `die` writes at `:536`, so for the whole of phase 0 it is the
 *  value on EVERY living organism — and "None" reads as missing data, as though the page
 *  failed to load a field, when what it actually means is "holds no position right now".
 *
 *  `Abstain` is left alone deliberately. It is ordinary English and it is a different fact
 *  from `None`: the organism was asked, the validators agreed, and the answer was a refusal
 *  to call the window. Collapsing the two would hide the distinction that makes an abstain
 *  cost the same metabolism as a wrong answer.
 */
export const BELIEF_HUMAN = ["no call", "Up", "Down", "Abstain"];

/** One clause per belief, for the places that have room to say what it commits the organism to. */
export const BELIEF_GLOSS = [
  "holds no position this window",
  "expects the close above the open",
  "expects the close below the open",
  "was asked, and declined to call it",
];

/** Genome.sol:26-32 */
export const THESIS = ["Unknown", "Momentum", "Reversion", "Breakout", "Range"];

/**
 *  Why, in one clause each. These are the five values `Genome.parseAnswer` can return, and they
 *  are trading vocabulary — a reader who does not already have it cannot tell "Reversion" from
 *  "Range", which are opposite claims about the same chart.
 */
export const THESIS_GLOSS = [
  "no thesis was parsed from the answer",
  "the move continues",
  "the move snaps back",
  "the range breaks",
  "the range holds",
];

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

/**
 *  What the population is doing in each state, and what the call that advances it DOES.
 *
 *  `PHASE_NEXT` is a Solidity function name. It is the right thing to show somebody who intends
 *  to verify the cadence against the contract, and it is meaningless to somebody who is trying
 *  to work out what this page is — `commitAll()` names the caller's action, not the event. Both
 *  ship: the sentence leads and the selector stays beside it, because dropping the selector
 *  would take away the one label that lets a reader check the claim.
 */
export const PHASE_GLOSS = [
  "between windows",
  "inference is out with the validators",
  "positions are open against the market",
];
export const PHASE_NEXT_HUMAN = ["ask every organism", "pair the disagreements", "settle, grade and charge"];

/** Belief -> a CSS class, so colour is decided in one place rather than at each call site. */
export const BELIEF_TONE = ["none", "up", "down", "abstain"];

export const ZERO = "0x0000000000000000000000000000000000000000";
