/**
 *  Gas limits for the four driver calls — as one table, in a module with no dependencies.
 *
 *  WHY IT LIVES HERE AND NOT IN `cadence.ts`. Same reason as `season.ts` and `commit.ts`:
 *  the boundary is arithmetic, the arithmetic is where the mistake costs a window, and a
 *  pure module can be driven by a table with no RPC, no key and no deployment. This file
 *  imports nothing, so `--self-test` can exercise it in a process that has no chain.
 *
 *  ────────────────────────────────────────────────────────────────────────────────
 *  THE DEFECT THIS EXISTS TO PREVENT, measured on tx
 *  0xc2705634adec9a805e75ad3674fc2c856b319c8460e47224ac7d2e22ed7ecacc (block 482387810),
 *  window 68. Full diagnosis in `docs/ERROR_W68_MOMENTUM.md`.
 *
 *  `eth_estimateGas` is STRUCTURALLY INCAPABLE of sizing any of these four calls, and the
 *  reason is a design decision in the contract rather than a quirk of the estimator. The
 *  estimator binary-searches for the smallest limit at which the transaction DOES NOT
 *  REVERT. Every one of the four driver calls is built on the repo's central rule — "one
 *  bad organism must never halt the population" — so each wraps its per-organism work in a
 *  `try`/`catch` and emits `ThinkFailed` / `CommitFailed` / `SettleFailed` instead of
 *  bubbling. The phase is then advanced unconditionally (`Population.sol:1529` for `think`,
 *  `:1851` for `settleAll`). So:
 *
 *      a gas limit at which the LAST organisms in the loop run out of gas and fail
 *      silently satisfies the estimator's success criterion perfectly.
 *
 *  An out-of-gas inside a `try` burns the 63/64 of gas that was forwarded to the subcall
 *  and returns failure; the `catch` swallows it; the transaction lands `status 1`. The
 *  estimator has no way to tell that apart from a healthy window, because on chain there
 *  is nothing to tell apart: both are successful transactions.
 *
 *  The numbers from window 68, which is the receipt that proves it:
 *
 *      gas limit on the tx    2,592,003   = the estimate x 1.05
 *      gas CHARGED            2,465,478   = 95.1% of the limit, with `status 1`
 *      gas the work needs       774,291   = `cast run` replay, all four organisms settled
 *      unexplained            1,691,187
 *
 *  MOMENTUM was the fourth and final organism in `settleAll`'s backwards loop. It emitted
 *  `SettleFailed(1)` and kept a WINNING 13,300,000-token position open with its 6.65 tUSDC
 *  stake already spent. The replay of the identical transaction over the identical prior
 *  state settles all four with zero `OutOfGas`, zero `Revert`, zero `EvmError` — so the
 *  estimate had landed on the cost of the FAILING path, not the working one.
 *
 *  And a failed settle is not "an organism missed a window". `Prophet.noteCommitted` has no
 *  guard on `positionOpen`, so the NEXT window's `commitAll` overwrites `currentOutcomeId`
 *  and the old position stops being addressable by the only contract allowed to redeem it.
 *  It is collateral leaving the arena.
 *  ────────────────────────────────────────────────────────────────────────────────
 *
 *  WHY ALL FOUR CALLS AND NOT JUST THE SETTLE. The window-68 receipt is a settle, and the
 *  first repair only sized the settle. But the argument above is about the `try`/`catch`
 *  plus unconditional phase advance, and all four driver calls have that shape:
 *
 *    - `think`     per-organism `try` around `createAdvancedRequest` -> `ThinkFailed` +
 *                  `CognitionUnspent` (`Population.sol:1503-1526`), `phase = 1` regardless.
 *                  An underestimate here means an organism that PAID its 0.24 STT deposit
 *                  and got no request — the deposit is drawn before the call.
 *
 *                  BUT `think` DOES NOT ONLY DEGRADE QUIETLY, and this was measured the
 *                  hard way on tx 0x064d8bfe... (block 483919081, window 68, 7 organisms).
 *                  `p.noteThinking(requestId, marketId)` at `Population.sol:1515` sits in
 *                  the `try`'s SUCCESS body, and a Solidity `try/catch` does not protect
 *                  its own `returns` block — only the callee. So when the forwarded 63/64
 *                  is enough for `createAdvancedRequest` to succeed but what remains is not
 *                  enough for `noteThinking`, that inner out-of-gas is NOT caught at
 *                  `:1516`. It bubbles, and the whole window fails to open.
 *
 *                  The receipt's tell is that `gasUsed` came in UNDER the limit — 4,026,317
 *                  of 4,100,000. A top-level out-of-gas consumes the limit exactly; a
 *                  revert bubbling up from a starved subcall leaves the caller's 1/64
 *                  retention unspent. `gasUsed < gasLimit` on an out-of-gas failure is
 *                  therefore evidence of depth, not evidence against gas — which is the
 *                  opposite of how it reads, and is why this one was nearly misdiagnosed as
 *                  a logic revert.
 *    - `commitAll` `try` in `_pair` via `this.executePair` and in `_openEmpty` ->
 *                  `CommitFailed` (`:1669`, `:1738`), phase advanced regardless. An
 *                  underestimate means a paired organism that thought and was never played.
 *    - `settleAll` the measured case above.
 *    - `hatchAll`  no `inPhase` and no per-organism `try`, so an underestimate here DOES
 *                  revert rather than silently skipping — and `hatch()` swallows the throw
 *                  as a tolerance. A child whose genome is pending stays pending, which is
 *                  recoverable, but it is the one asset the system cannot rebuild, so it is
 *                  sized generously too.
 *
 *  So the estimator is unusable on the whole driver surface, not on one call.
 *
 *  WHY A FLOOR PLUS PER-ORGANISM HEADROOM, rather than a flat number. The per-organism
 *  legs are the part that scales — the population grows toward `maxPopulation = 24` as
 *  organisms breed — while the fixed cost is the window bookkeeping each call does once.
 *  Sizing per living organism means the limit tracks the population instead of needing a
 *  revision every time it grows.
 *
 *  OVERSHOOTING IS FREE AND UNDERSHOOTING IS NOT, which is what settles every number here.
 *  Unused gas is refunded; only the gas actually burned is charged. An undershoot orphans a
 *  position whose stake is already spent. These are not comparable risks, so every figure
 *  below is deliberately generous against its measurement rather than tight against it.
 */

/** The four calls this module sizes. `hatchAll` is included; `pushWindow` is not (see below). */
export type DriverCall = "think" | "commit" | "settle" | "hatch";

/**
 *  Fixed cost per call, in gas, before any per-organism work.
 *
 *  `settle` carries the largest floor because its fixed leg is the real one: `settleAll`
 *  touches `BinarySettlement`, a SHARED SINGLETON whose slots may be cold in a live block
 *  where a replay reads them warm. That cold/warm difference is one of the two candidate
 *  explanations for window 68's 1.69M unexplained gas (the other being a transient revert
 *  from the same singleton), and neither can be separated from off chain — so the floor
 *  pays for it rather than betting against it.
 */
const FLOOR: Record<DriverCall, bigint> = {
  // `think` reads the nine-value `currentWindow`, resolves the market through
  // `PushedPriceSource._resolveMarket`'s 14-tuple, and writes `windowVenue`/`windowRakeBps`.
  think: 600_000n,
  // `commitAll` partitions beliefs and opens pairs; the fixed leg is the belief sweep.
  commit: 600_000n,
  // See above — the shared singleton is why this one is 1.5M and not 600k.
  settle: 1_500_000n,
  // `hatchAll` does nothing fixed but iterate `living`.
  hatch: 400_000n,
};

/**
 *  Gas per living organism.
 *
 *  `settle` is 900,000 against a measured 636,284 for the winning leg on its own — ~1.4x,
 *  with the cold-slot uncertainty already paid for in the floor. `think` is one
 *  `createAdvancedRequest` with a payload built by `Genome.beliefPrompt`. `commit` is one
 *  `openOpposing` per PAIR, so per-organism is already ~2x what a pair costs. `hatch` is a
 *  full `BeaconProxy` deployment plus an endowment transfer, which is why it is the
 *  largest — but only organisms with a pending genome pay it.
 */
const PER_ORGANISM: Record<DriverCall, bigint> = {
  /**
   *  MEASURED, not estimated: 516,928 per organism.
   *
   *  `scripts/gas-bisect.ts think --block 483919080` bisects the failing window-68 call
   *  against the state it actually ran on and puts the minimum for a non-reverting
   *  `think()` at 7 living organisms at 4,218,497. Net of the 600,000 floor that is
   *  (4,218,497 - 600,000) / 7 = 516,928 each.
   *
   *  The old figure was 500,000, which made the limit 4,100,000 — 97% of what the call
   *  needed. It was not measured; it was inferred from `settle`'s shape, and it is the one
   *  number in this file that was tight against its guess rather than generous against a
   *  measurement. It cost window 68 (tx 0x064d8bfe...). Note how small the miss was: 2.8%.
   *  A table that only just clears is a table that fails on the window after the next
   *  organism hatches, and `maxPopulation` is 24.
   *
   *  800,000 is ~1.55x the measurement — deliberately above the ~1.4x `settle` carries,
   *  because `settle`'s ratio was chosen when its own floor had already absorbed the
   *  cold-slot uncertainty and `think`'s has not. At 7 that is 6.2M against a 30M ceiling;
   *  at the full 24 it is 19.8M, still uncapped.
   */
  think: 800_000n,
  commit: 500_000n,
  settle: 900_000n,
  hatch: 1_200_000n,
};

/**
 *  The block gas limit this cadence will not exceed.
 *
 *  A limit above the block's own cap is not conservative, it is a transaction the chain
 *  will not accept at all — which would convert "one organism silently skipped" into "the
 *  window does not advance", a strictly worse failure. At `maxPopulation = 24` the settle
 *  formula alone wants 1.5M + 21.6M = 23.1M, so this clamp is REACHABLE on a full
 *  population and is not a defensive flourish.
 *
 *  30M is the conventional Ethereum-family block limit and Shannon has not been measured
 *  below it. THE CLAMP IS NOT THE ANSWER TO A FULL POPULATION, it is the guard that keeps
 *  the failure legible: at 24 organisms the driver calls need splitting across
 *  transactions, and `capped` is returned from `driverGas` so the caller can say so out
 *  loud rather than discovering it as a mystery `SettleFailed` on the last organism in the
 *  loop. See `docs/ERROR_W68_MOMENTUM.md`.
 */
export const BLOCK_GAS_CEILING = 30_000_000n;

export type GasPlan = {
  /** The limit to put on the transaction. */
  gas: bigint;
  /** True when the formula wanted more than `BLOCK_GAS_CEILING` and was clamped. */
  capped: boolean;
  /** What the formula asked for before the clamp — for the operator's warning. */
  wanted: bigint;
};

/**
 *  Size one driver call for a population of `alive` living organisms.
 *
 *  `alive` is clamped to at least 1: a zero-organism population still has to be able to
 *  advance its phase, and a limit of exactly the floor is the one case where the formula
 *  could produce a number smaller than the fixed work it has to pay for. `bigint`
 *  throughout because viem hands `aliveCount` over as one and the limit goes back to viem
 *  as one — no widening, no `Number` round-trip on a `uint64`.
 */
export function driverGas(call: DriverCall, alive: bigint): GasPlan {
  const n = alive > 0n ? alive : 1n;
  const wanted = FLOOR[call] + PER_ORGANISM[call] * n;
  return wanted > BLOCK_GAS_CEILING
    ? { gas: BLOCK_GAS_CEILING, capped: true, wanted }
    : { gas: wanted, capped: false, wanted };
}
