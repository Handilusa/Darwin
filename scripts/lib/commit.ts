/**
 *  When may the window's beliefs be committed — as one predicate, in a module with no
 *  dependencies.
 *
 *  WHY IT LIVES HERE AND NOT IN `cadence.ts`. Same reason as `season.ts`: two processes
 *  need this comparison for opposite reasons. The cadence asks "may I send `commitAll`
 *  yet?"; the monitor asks "did a window commit before the validators could possibly have
 *  answered?" while the cadence is the thing suspected of being wrong. A hand-mirrored
 *  copy of the rule in the monitor is the drift class `cite-drift` and `abi-drift` exist
 *  to catch, and here the two copies disagreeing is not hypothetical — it is the defect
 *  this module was written for.
 *
 *  ────────────────────────────────────────────────────────────────────────────────
 *  THE DEFECT THIS EXISTS TO PREVENT, measured on 2026-09-06/07.
 *
 *  The cadence ran 29 windows in ~25 minutes and every one of them reported
 *  "all beliefs in (8 Abstain)". `doCommit`'s wait loop read `pendingThinkers()` as its
 *  FIRST action and broke out on an empty result, so `commitAll` was sent before any
 *  validator could answer — the subcommittee takes 5-30 s. `Population.commitAll`
 *  (`contracts/src/Population.sol:1607`) routes `Belief.None` down the same `else` branch
 *  as `Belief.Abstain`, so "nobody has answered yet" and "everybody declined" are the
 *  same on-chain outcome: `_openEmpty` for all eight, no UP/DOWN pairs, no positions, an
 *  empty window that still charges metabolism at settlement.
 *
 *  So an empty pending set is NOT sufficient evidence that thinking is done, and the
 *  reason it is not is the whole content of this module:
 *
 *    - `pendingBeliefRequestId` is written by `Prophet.noteThinking` (`Prophet.sol:217`)
 *      inside the same transaction as `think()`. An `eth_call` that lands against a state
 *      root from before that transaction sees zero for every organism.
 *    - It is CLEARED by `Prophet.handleBelief` (`Prophet.sol:267`), which is also the only
 *      writer of `belief`. So a returned-to-zero id and a never-set id are
 *      indistinguishable from the id alone.
 *    - An organism whose `createAdvancedRequest` reverted, or whose `drawCognition` came
 *      up short, never had the id set at all (`Population.sol:1495`, `:1520`) and emits
 *      `ThinkFailed`. It will never answer, and waiting for it is waiting forever.
 *
 *  The fix is therefore two-sided, and both sides are in `commitReadiness` below: a FLOOR
 *  in time that no window may commit before, and a positive signal — `belief != None` —
 *  that says thinking actually happened rather than merely that nothing is outstanding.
 *
 *  It was NOT a funding failure, which was the competing explanation and is worth
 *  recording because it would have needed the opposite fix. Cognition held fell 13.2 ->
 *  5.808 STT across the run; 7.392 / 0.033 = 224 = 28 windows x 8 organisms, exactly. The
 *  deposits were drawn and the requests were created for every organism in every window,
 *  so `ThinkFailed` was not firing and the organisms could afford to think. They were
 *  simply never given time to.
 *  ────────────────────────────────────────────────────────────────────────────────
 */

/** What the cadence should do about `commitAll` right now. */
export type CommitReadiness =
  /** Send it: every living organism that can answer has answered. */
  | { act: "commit"; why: string }
  /** Send it anyway — the market is about to expire, or patience ran out. Warn first. */
  | { act: "commit-anyway"; why: string }
  /** Do not send it yet. Poll again. */
  | { act: "wait"; why: string };

export type CommitInputs = {
  /** Living organisms whose `pendingBeliefRequestId` is still non-zero. */
  pending: number;
  /** Living organisms whose `belief` is no longer `None` — i.e. a callback landed. */
  answered: number;
  /** Living organisms, total. The denominator for both counts above. */
  alive: number;
  /** Seconds elapsed since `think()` landed. */
  elapsed: number;
  /**
   *  The floor: seconds after `think()` before an empty pending set may be believed.
   *  Below this, `pending == 0 && answered == 0` is read as "the requests have not
   *  registered yet", which is the defect above.
   */
  floor: number;
  /** Seconds after `think()` at which to give up waiting and commit on what arrived. */
  patience: number;
  /**
   *  Seconds left until the window's BINDING commit deadline, or `undefined` when it could
   *  not be read.
   *
   *  Two unrelated clocks can bind, and the caller passes whichever runs out first: the
   *  market's own expiry, and the staleness of the pushed price that
   *  `IArenaVenue.openOpposing` reads while `commitAll` executes. Treating expiry as the
   *  only deadline is what let a 330s patience budget run past a 180s staleness limit —
   *  see `commitDeadline` in `cadence.ts`. This module does not care which one it is; it
   *  only needs to know that past zero, waiting longer cannot help.
   */
  untilDeadline: number | undefined;
};

/**
 *  Decide whether to commit, keep waiting, or commit under protest.
 *
 *  Pure, so the table in `cadence.ts --self-test` can drive it with no RPC, no key and no
 *  deployment — including the two controls that matter: that the 29-window defect is
 *  caught, and that a genuinely unanimous abstention is still allowed to commit.
 *
 *  ORDER IS LOAD-BEARING. The deadline outranks everything, because a commitment that
 *  lands after expiry is a window in which every organism paid to think and then had
 *  nothing to think about — strictly worse than committing on a partial answer set. The
 *  floor outranks the empty-pending shortcut, because that shortcut IS the defect.
 */
export function commitReadiness(i: CommitInputs): CommitReadiness {
  // 1. THE MARKET WINS. Past the commit deadline nothing else is worth waiting for.
  if (i.untilDeadline !== undefined && i.untilDeadline <= 0) {
    return {
      act: "commit-anyway",
      why:
        `at the commit deadline with ${i.pending} of ${i.alive} still thinking and ` +
        `${i.answered} answered — committing now, because past the binding deadline (market ` +
        `expiry or price staleness, whichever came first) waiting longer cannot help`,
    };
  }

  // 2. AN EXTINCT POPULATION IS NOT A PENDING ONE. Guarded before the floor so a dead
  //    population does not sit in the wait loop for its whole patience budget.
  if (i.alive === 0) {
    return { act: "commit", why: "no living organisms — nothing to wait for" };
  }

  // 3. THE FLOOR. `pending == 0` this early means the `think()` writes have not been
  //    observed yet, not that the validators answered in under `floor` seconds.
  //    `answered > 0` is the escape hatch: a real callback has landed, so the reads are
  //    demonstrably seeing post-`think()` state and the floor has done its job.
  if (i.elapsed < i.floor && i.answered === 0) {
    return {
      act: "wait",
      why:
        `${i.elapsed}s since think, floor is ${i.floor}s and no belief has landed yet — ` +
        `an empty pending set this early means the requests have not registered, not that ` +
        `the subcommittee answered`,
    };
  }

  // 4. THE ORDINARY DONE CONDITION. Nothing outstanding, past the floor.
  if (i.pending === 0) {
    return {
      act: "commit",
      why: `all beliefs in — ${i.answered} of ${i.alive} answered after ${i.elapsed}s`,
    };
  }

  // 5. PATIENCE. Some organism is never going to answer — a request the validators
  //    dropped leaves `pendingBeliefRequestId` set forever (`Prophet.sol:224`), so there
  //    has to be a bound that is not the deadline.
  if (i.elapsed >= i.patience) {
    return {
      act: "commit-anyway",
      why:
        `inference patience (${i.patience}s) exhausted with ${i.pending} of ${i.alive} still ` +
        `pending and ${i.answered} answered`,
    };
  }

  return {
    act: "wait",
    why: `${i.pending} of ${i.alive} still thinking, ${i.answered} answered, ${i.elapsed}s elapsed`,
  };
}

/**
 *  Is a committed window one the population could not possibly have thought about?
 *
 *  The monitor's question, and the reason this module is shared rather than private to the
 *  cadence. `commitReadiness` prevents the defect going forward; this DETECTS it, in a
 *  process that does not trust the cadence to be correct — including a cadence running
 *  from an older build, or one whose floor was set to zero by an env var.
 *
 *  Deliberately not a second copy of the rule above: it asks only the one question that
 *  needs no timing information, which is whether ANY organism formed a belief. Zero
 *  answers across a living population is either the defect or a total validator outage,
 *  and both are worth an operator's attention; it cannot be a legitimate unanimous
 *  abstention, because an abstention IS an answer — `handleBelief` initialises `b` to
 *  `Belief.Abstain` (`Prophet.sol:271`) and writes it through on every non-Success status
 *  (`Prophet.sol:290`), so a delivered callback always moves `belief` off `None`.
 */
export function committedBlind(alive: number, answered: number): boolean {
  if (alive === 0) return false;
  return answered === 0;
}
