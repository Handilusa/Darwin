/**
 *  The cadence. This is what keeps the population alive.
 *
 *  Run with:
 *    npm run cadence            # forever
 *    npm run cadence:once       # one action, then exit (for cron)
 *
 *  DESIGN: a state machine on the on-chain `phase`, not a fixed sequence.
 *
 *  Every iteration reads `Population.phase()` and performs the one action that phase
 *  permits. Nothing is remembered between iterations — the active market, the window
 *  number and the phase all live on chain, so this process can be killed, restarted,
 *  moved to another machine, or run from cron, and it resumes exactly where the
 *  population is rather than where it thinks the population should be. For a run that
 *  must not stop for eleven days, that property is worth more than any amount of
 *  cleverness in the scheduling.
 *
 *  THE SEASON BOUNDARY AND THE BIRTHS ARE STATES, NOT A SCHEDULE. `endSeason` and
 *  `hatchAll` are conditions this loop re-derives from chain state every iteration —
 *  `windowCount` against `seasonStartWindow + seasonWindows` for the one, a window that
 *  has just been graded for the other — and not entries in a calendar. There is no wall
 *  clock and no counter anywhere in this process, which is why killing it between a
 *  settlement and a season close cannot cost the population either.
 *
 *  It is also, deliberately, the thinnest possible off-chain component: it pushes two
 *  prices and calls five functions. It decides nothing. Belief formation, pairing,
 *  fitness, death, mutation and lineage are all on chain, and if this process dies the
 *  population does not lose state — it stops advancing, which `monitor.ts` alerts on.
 */
import {
  BELIEF,
  PHASE,
  fmt,
  flag,
  labels,
  log,
  manifest,
  marketsModuleAbi,
  num,
  populationAbi,
  priceSourceAbi,
  prophetAbi,
  publicClient,
  selectionEngineAbi,
  sleep,
  stamp,
  wallet,
  warn,
  explorerTx,
  type Manifest,
} from "./lib/darwin.js";
import { discover, resolution } from "./lib/market.js";
// Imported for use below AND re-exported further down, which are two different things: the
// `export { seasonIsOver }` there keeps the name on this module's surface for the self-test,
// while this binding is what `maybeEndSeason` and the test table actually call.
import { seasonIsOver } from "./lib/season.js";
import { commitReadiness, committedBlind, type CommitInputs, type CommitReadiness } from "./lib/commit.js";
import { driverGas, BLOCK_GAS_CEILING, type DriverCall, type GasPlan } from "./lib/gas.js";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BaseError,
  ContractFunctionRevertedError,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";

/*//////////////////////////////////////////////////////////////
                             TUNABLES
//////////////////////////////////////////////////////////////*/

/** Stop opening new positions this many seconds before expiry. */
const COMMIT_LEAD = num("CADENCE_COMMIT_LEAD", 60);

/**
 *  Do not START a window with less than this much time left.
 *
 *  Inference is asynchronous with a 300-second request timeout, and a window whose
 *  commitment lands after expiry is a window where every organism paid to think and
 *  then had nothing to think about. Wait for the next one instead — at a 15-minute
 *  cadence that costs at most fifteen minutes.
 */
const MIN_WINDOW_SECONDS = num("CADENCE_MIN_WINDOW", 360);

/**
 *  How long to wait for validator responses before committing on whatever arrived.
 *
 *  NOT the binding bound, and reading it as one is the trap this comment exists to close.
 *  `commitDeadline` also derives a bound from the pushed price's staleness, and
 *  `commitReadiness` takes the earlier of the two — so on a live window this 330 is
 *  usually slack, not policy. Raising it does not buy more patience; it buys nothing past
 *  `updatedAt + maxStaleness - CADENCE_STALENESS_MARGIN`. See `commitDeadline` for why
 *  that second clock was invisible until 2026-09-07 and what it cost.
 */
const INFERENCE_PATIENCE = num("CADENCE_INFERENCE_PATIENCE", 330);

/**
 *  Seconds of the staleness budget reserved for the commit transaction itself.
 *
 *  `commitAll` has to be MINED while the pushed price is still fresh, not merely sent:
 *  `PushedPriceSource.currentWindow` compares `maxStaleness` against the `block.timestamp`
 *  of the block that includes it. So what this reserves against is build + sign + submit +
 *  inclusion, and zero would be wrong even though the send looks instant from here.
 *
 *  20s leaves 160 of the live 180s budget for inference, which is over 5x the 30s the
 *  subcommittee takes at its slowest — so the margin is bought out of slack nothing else
 *  was using, and it also covers one retry.
 */
const STALENESS_MARGIN = num("CADENCE_STALENESS_MARGIN", 20);

/**
 *  The FLOOR: never believe an empty pending set before this many seconds after `think()`.
 *
 *  This is the tunable that did not exist on 2026-09-06, and its absence cost 28 windows
 *  of cognition in 25 minutes — see `lib/commit.ts` for the measurement and
 *  `commitReadiness` for the rule. The subcommittee takes 5-30 s to answer, and the reads
 *  that check on it can land against pre-`think()` state, so an empty pending set inside
 *  the first few seconds means "not started" rather than "finished".
 *
 *  30 s, not 20: the observed validator latency runs to 30 s, and the cost of overshooting
 *  is nothing — the floor is a lower bound on the wait, not an added delay. Any organism
 *  answering earlier moves `belief` off `None` and `commitReadiness` releases immediately
 *  on the `answered > 0` escape hatch, so on a healthy window this is invisible. It is
 *  also 1/12th of the 3600 s window the population trades and well inside the
 *  `expiry - CADENCE_COMMIT_LEAD` deadline, so it cannot push a commitment past expiry.
 */
const COMMIT_FLOOR = num("CADENCE_COMMIT_FLOOR", 30);

/** How long to wait for the reactivity precompile to settle before poking manually. */
const REACTIVITY_PATIENCE = num("CADENCE_REACTIVITY_PATIENCE", 90);

const POLL = num("CADENCE_POLL", 5) * 1000;
const IDLE = num("CADENCE_IDLE", 15) * 1000;

const USE_REACTIVITY = flag("CADENCE_USE_REACTIVITY", false);

/*//////////////////////////////////////////////////////////////
                               MAIN
//////////////////////////////////////////////////////////////*/

async function main(): Promise<void> {
  // BEFORE `manifest()` AND `wallet()`, deliberately. Both throw without a deployment and
  // a private key respectively, and the whole point of the self-test is that the season
  // arithmetic can be exercised on a machine that has neither.
  if (process.argv.includes("--self-test")) return selfTestSeasonBoundary();

  const m = manifest();
  const { account, client } = wallet();
  const once = process.argv.includes("--once");

  await preflight(m, account.address);

  log(`cadence up as ${account.address}; population ${m.population}; symbol ${m.symbol}`);

  for (;;) {
    try {
      const advanced = await step(m, client);
      if (once) break;
      if (!advanced) await sleep(IDLE);
    } catch (err) {
      // A cadence that dies on a transient RPC error is a population that dies with it.
      warn(describe(err));
      if (once) {
        process.exitCode = 1;
        break;
      }
      await sleep(IDLE);
    }
  }
}

/**
 *  @returns true if the population moved a phase this step.
 *
 *  THE SEASON CHECK RUNS BEFORE THE PHASE SWITCH, NOT AFTER SETTLEMENT.
 *
 *  `windowCount` is incremented in `think()` (`Population.sol:1283`), not in
 *  `settleAll()` — so the window that satisfies `endSeason`'s
 *  `windowCount - seasonStartWindow >= seasonWindows` becomes the FINAL window the
 *  moment it opens, and it is then traded and graded under the next level's ante. A
 *  post-settle close therefore closes one window too late, every season, by
 *  construction. Closing here — in phase 0, before `think()` opens window N+1 — is the
 *  only placement at which the boundary condition and the standings agree: every
 *  position from the season's last window is redeemed, every metabolism charge is paid,
 *  every corpse's residue has already been forfeited into the pot by `settleAll`, and
 *  nothing new has been staked yet.
 *
 *  It is deliberately not gated on the phase being 0, only ordered before the switch.
 *  A cadence restarted mid-window comes back in phase 1 or 2, and a season that came
 *  due while the process was down must still close on the next tick rather than waiting
 *  for the window in flight to finish and hoping this branch is reached.
 */
async function step(m: Manifest, client: WalletLike): Promise<boolean> {
  await maybeEndSeason(m, client);

  const phase = await read(m, "phase");

  switch (Number(phase)) {
    case 0:
      return await doThink(m, client);
    case 1:
      return await doCommit(m, client);
    case 2:
      return await doSettle(m, client);
    default:
      warn(`unknown phase ${phase} — leaving it alone. Use forcePhase(0) if it is wedged.`);
      return false;
  }
}

/*//////////////////////////////////////////////////////////////
                          PHASE 0 — THINK
//////////////////////////////////////////////////////////////*/

async function doThink(m: Manifest, client: WalletLike): Promise<boolean> {
  const w = await discover(m.symbol, m);
  const now = Math.floor(Date.now() / 1000);

  if (now < w.tradingStart) {
    log(`window ${short(w.marketId)} opens in ${w.tradingStart - now}s`);
    return false;
  }

  const remaining = w.expiry - now;
  if (remaining < MIN_WINDOW_SECONDS) {
    log(`window ${short(w.marketId)} has only ${remaining}s left — waiting for the next one`);
    return false;
  }

  const { resolved, voided } = await resolution(w.market);
  if (resolved || voided) {
    log(`window ${short(w.marketId)} already ${voided ? "voided" : "resolved"} — waiting for the next one`);
    return false;
  }

  // Push, then think, back to back and in that order. `PushedPriceSource` refuses a
  // price older than `maxStaleness` (180s), so any delay between these two calls is a
  // reverting `think()`.
  log(
    `push  ${m.symbol} ${short(w.marketId)} open=${fmt(w.openPrice, w.priceDecimals, 2)} ` +
      `last=${fmt(w.lastPrice, w.priceDecimals, 2)} (${w.source}) ${remaining}s left`,
  );
  await send(client, {
    address: m.priceSource,
    abi: priceSourceAbi,
    functionName: "pushWindow",
    args: [m.symbol, w.marketId, w.openPrice, w.lastPrice, w.priceDecimals],
  });

  const alive = await read(m, "aliveCount");
  if (alive === 0n) {
    warn("no living organisms — the population is extinct. Nothing left to drive.");
    return false;
  }

  // PRE-FLIGHT ON THE ORGANISMS' BALANCES, NOT POPULATION'S. Each organism pays its own
  // inference deposit, so Population's balance does not tell us whether this window will
  // produce any forecasts — it only funds births. Checking the wrong balance here would
  // have been worse than checking nothing: the warning would stay silent through a
  // population that abstains its way to extinction.
  const deposit = await read(m, "requestDeposit");
  const snap = await read(m, "snapshot");
  const broke: string[] = [];
  for (const o of snap.filter((x) => !x.dead)) {
    const bal = await publicClient.getBalance({ address: o.addr });
    if (bal < deposit) broke.push(`#${o.id} (${fmt(bal, 18, 4)})`);
  }
  if (broke.length > 0) {
    warn(
      `${broke.length}/${alive} organisms cannot afford this window's inference at ` +
        `${fmt(deposit, 18, 4)} STT: ${broke.join(", ")}. They will abstain and still pay ` +
        `metabolism. Fund them: npm run fund -- --windows 400`,
    );
  }

  // EXPLICIT GAS, same argument as the settle. `think` wraps `createAdvancedRequest` in a
  // per-organism `try` and advances `phase = 1` regardless (`Population.sol:1503-1529`), so
  // an underestimate is silent here too — and it is expensive in a way the settle's is not:
  // `drawCognition` takes the organism's deposit BEFORE the request, so an organism skipped
  // for gas has paid its 0.24 STT and bought nothing. `scripts/lib/gas.ts` has the reasoning.
  const hash = await send(client, {
    address: m.population,
    abi: populationAbi,
    functionName: "think",
    gas: await gasFor(m, "think"),
  });
  const window = await read(m, "windowCount");
  log(`think window #${window} · ${alive} organisms · ${explorerTx(hash)}`);
  await reportStragglers(m, hash, "think");
  return true;
}

/*//////////////////////////////////////////////////////////////
                         PHASE 1 — COMMIT
//////////////////////////////////////////////////////////////*/

async function doCommit(m: Manifest, client: WalletLike): Promise<boolean> {
  const deadline = await commitDeadline(m);
  const startedAt = Math.floor(Date.now() / 1000);

  // THE ONE CASE `commitDeadline` CANNOT REPAIR, named out loud rather than committed
  // into silently. Past the staleness bound `commitAll` reverts `StalePrice` inside
  // `_pair`, and the resulting `CommitFailed` + one `Unpaired` per organism is
  // byte-identical in the log to a window nobody formed a belief in — so without this
  // line the operator would be told the population went quiet when in fact it thought,
  // answered, and was refused a market by its own price feed.
  //
  // Compares a chain-derived deadline against the local wall clock, which is the same
  // assumption the `untilDeadline` arithmetic below already makes; a machine whose clock
  // is skewed by more than the 20s margin will get this wrong in whichever direction it
  // is skewed.
  if (deadline !== undefined && deadline <= startedAt) {
    warn(
      `the pushed price is already too stale to survive this commit — the staleness ` +
        `deadline passed ${startedAt - deadline}s ago. commitAll will revert StalePrice ` +
        `inside _pair and every organism will be Unpaired with its belief formed but ` +
        `unplayed. The repair is to re-push this window, PRESERVING openPrice, before ` +
        `committing: openPrice is the level the organisms are graded against.`,
    );
  }

  /*
   *  THE WAIT IS THE WHOLE FUNCTION, and until 2026-09-07 it did not exist.
   *
   *  This loop used to read `pendingThinkers()` as its first action and break out on an
   *  empty result, which sent `commitAll` before the validators could possibly have
   *  answered — they take 5-30 s. See `lib/commit.ts` for the measurement: 29 consecutive
   *  windows committed with all eight organisms on `Belief.None`, which `commitAll` scores
   *  as an abstention, so every one of those windows opened zero positions and still
   *  charged metabolism at settlement. The decision now lives in `commitReadiness`, which
   *  is pure and driven by a table under `--self-test`, because the failure was silent in
   *  the operator's own log: "all beliefs in (8 Abstain)" is what a healthy unanimous
   *  abstention prints too.
   *
   *  BOTH COUNTS ARE READ, not just the pending one. An empty pending set means either
   *  "everyone answered" or "the requests have not registered yet", and only `answered`
   *  separates them — `belief != None` can be written by nothing except a delivered
   *  callback (`Prophet.sol:290`).
   */
  for (;;) {
    const now = Math.floor(Date.now() / 1000);
    const [pending, answered, alive] = await beliefProgress(m);

    const verdict = commitReadiness({
      pending: pending.length,
      answered,
      alive,
      elapsed: now - startedAt,
      floor: COMMIT_FLOOR,
      patience: INFERENCE_PATIENCE,
      untilDeadline: deadline === undefined ? undefined : deadline - now,
    });

    if (verdict.act === "commit") {
      log(`${verdict.why} (${await beliefSummary(m)})`);
      break;
    }
    if (verdict.act === "commit-anyway") {
      warn(`${verdict.why}${pending.length > 0 ? `: ${pending.join(", ")}` : ""}`);
      break;
    }

    log(verdict.why);
    await sleep(POLL);
  }

  /*
   *  THE LAST LINE OF DEFENCE, and it is a warning rather than a refusal.
   *
   *  `commitReadiness` can still reach a commit with nobody having answered — the
   *  deadline branch and the patience branch both do, deliberately, because a commitment
   *  after expiry is worse. But a window where NO living organism formed a belief is not a
   *  population of sceptics; it is the defect above, or a total validator outage. Say so
   *  in the operator's log at the moment it happens, in the same words `monitor.ts` uses,
   *  so the two processes cannot disagree about what a blind window looks like.
   *
   *  Not a refusal, because refusing would wedge the machine in phase 1: nothing else
   *  advances it, `settleAll` is gated on phase 2, and the organisms have already paid for
   *  their inference either way. Committing blind loses a window; refusing loses the run.
   */
  const [, finalAnswered, finalAlive] = await beliefProgress(m);
  if (committedBlind(finalAlive, finalAnswered)) {
    warn(
      `committing a BLIND window: not one of ${finalAlive} living organisms formed a belief, so ` +
        `commitAll will score all of them as abstentions (Population.sol:1608), open no positions, ` +
        `and still charge metabolism at settlement. Either the subcommittee is down or this window ` +
        `committed too early — check CADENCE_COMMIT_FLOOR (${COMMIT_FLOOR}s) against the 5-30s the ` +
        `validators take.`,
    );
  }

  // An organism with no consensus answer opens a zero-size position and is scored as an
  // abstain. That is the intended mechanic, not a failure: it failed to think, it acts
  // on nothing, and it still pays metabolism.
  // EXPLICIT GAS, same argument again: `_pair` goes through `this.executePair` purely to get
  // a revert boundary and `_openEmpty` catches too, so every per-organism failure here is a
  // `CommitFailed` event on a successful transaction (`Population.sol:1669`, `:1738`) and the
  // estimator cannot see it. An organism skipped here thought, answered, and is never played.
  const hash = await send(client, {
    address: m.population,
    abi: populationAbi,
    functionName: "commitAll",
    gas: await gasFor(m, "commit"),
  });
  log(`commit · ${explorerTx(hash)}`);
  await reportStragglers(m, hash, "commit");
  return true;
}

/** Seconds-since-epoch by which the commitment must land, from the market's own expiry. */
/**
 *  When `commitAll` must be sent by — the EARLIER of two unrelated clocks.
 *
 *  Until 2026-09-07 this returned only `expiry - COMMIT_LEAD`, and the second clock was
 *  invisible. `PushedPriceSource.currentWindow` refuses a price older than `maxStaleness`
 *  (live: 180s), and `DreamDEXVenue.openOpposing` reads it UNGUARDED
 *  (`contracts/src/venues/DreamDEXVenue.sol:73`). So a `commitAll` sent after the pushed
 *  price went stale reverts `StalePrice` inside `_pair`, whose catch turns it into
 *  `CommitFailed` plus one `Unpaired` per organism — a window where all eight paid to
 *  think, formed real beliefs, and opened nothing. `CADENCE_INFERENCE_PATIENCE` defaults
 *  to 330s against a 180s limit, so on any window where a single organism was slow to
 *  answer, THE DEFAULT CONFIGURATION PRODUCED THAT OUTCOME — and it is indistinguishable
 *  in the operator's log from a unanimous abstention, which is exactly the failure shape
 *  `lib/commit.ts` was already written to stop being silent.
 *
 *  BOTH BOUNDS ARE READ FROM CHAIN, not assumed, and each for its own reason.
 *  `maxStaleness` has an `onlyOwner` setter (`PushedPriceSource.setMaxStaleness`), so a
 *  hard-coded 180 would silently stop matching the contract the moment it was tuned.
 *  `updatedAt` is the push's own block timestamp — the only clock the staleness check
 *  actually uses. `doCommit`'s `startedAt` is wall-clock time in whichever process
 *  happened to enter phase 1, which under `--once` can be minutes after the push;
 *  measuring this budget from it would be measuring the wrong clock entirely.
 *
 *  KNOWN LIMIT, deliberately not repaired here. If the pushed price is ALREADY stale when
 *  phase 1 begins, this returns a deadline in the past, `commitReadiness` rule 1 commits
 *  under protest, and that commit reverts `StalePrice` anyway. The real repair is to
 *  re-push before committing — preserving `openPrice` byte for byte and refreshing only
 *  `lastPrice`, because `openPrice` is the level every organism is graded against and
 *  moving it would corrupt the fitness signal rather than merely delay it. That is a
 *  second transaction on the commit path and is not worth introducing untested against a
 *  live population; the warning in `doCommit` names the condition so it is not silent.
 */
async function commitDeadline(m: Manifest): Promise<number | undefined> {
  const marketId = await read(m, "activeMarketId");
  if (marketId === "0x0000000000000000000000000000000000000000000000000000000000000000") return undefined;

  const [rec, limit, raw] = await Promise.all([
    publicClient.readContract({
      address: m.marketsModule,
      abi: marketsModuleAbi,
      functionName: "markets",
      args: [marketId as Hex],
    }),
    publicClient.readContract({ address: m.priceSource, abi: priceSourceAbi, functionName: "maxStaleness" }),
    publicClient.readContract({ address: m.priceSource, abi: priceSourceAbi, functionName: "rawWindow", args: [m.symbol] }),
  ]);

  const byExpiry = Number(rec[13]) - COMMIT_LEAD;

  // `updatedAt == 0` means nothing was ever pushed for this symbol. `currentWindow` then
  // reverts `NoWindow`, not `StalePrice`, and no staleness deadline exists to compute —
  // subtracting from zero would hand back a deadline ~57 years in the past and commit
  // every window under protest.
  if (raw.updatedAt === 0n) return byExpiry;

  const byStaleness = Number(raw.updatedAt) + Number(limit) - STALENESS_MARGIN;
  return Math.min(byExpiry, byStaleness);
}

/**
 *  Where the window's thinking has got to: who is still out, how many have answered, how
 *  many are alive.
 *
 *  ONE SNAPSHOT FOR BOTH COUNTS, and that is not just an RPC saving. `belief` and
 *  `pendingBeliefRequestId` are written in the same transaction by the same callback
 *  (`Prophet.handleBelief` clears the id at `:267` and writes the belief at `:290`), so
 *  reading them from two different snapshots can observe a callback half-landed: id
 *  already zero, belief not yet seen. That combination is exactly the one
 *  `commitReadiness` treats as "the requests have not registered yet", so a split read
 *  could make a finishing window look like a starting one and burn the whole patience
 *  budget. `snapshot()` returns `belief` per organism in a single call, so the pair is
 *  consistent by construction — the extra per-organism read is only for the pending id,
 *  which `snapshot()` does not carry.
 *
 *  `belief != None` is the positive signal. It cannot be forged by a stale read: nothing
 *  writes it except a delivered callback, and `noteThinking` resets it to `None` at the
 *  start of every window (`Prophet.sol:218`), so it can never carry the previous window's
 *  answer into this one's count.
 */
async function beliefProgress(m: Manifest): Promise<[pending: number[], answered: number, alive: number]> {
  const snap = await read(m, "snapshot");
  const pending: number[] = [];
  let answered = 0;
  let alive = 0;
  for (const o of snap) {
    if (o.dead) continue;
    alive++;
    if (o.belief !== 0) answered++;
    const outstanding = await publicClient.readContract({
      address: o.addr,
      abi: prophetAbi,
      functionName: "pendingBeliefRequestId",
    });
    if (outstanding !== 0n) pending.push(Number(o.id));
  }
  return [pending, answered, alive];
}

async function beliefSummary(m: Manifest): Promise<string> {
  const snap = await read(m, "snapshot");
  const counts = new Map<string, number>();
  for (const o of snap) {
    if (o.dead) continue;
    const name = BELIEF[o.belief] ?? `?${o.belief}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([k, v]) => `${v} ${k}`).join(", ") || "nobody";
}

/*//////////////////////////////////////////////////////////////
                         PHASE 2 — SETTLE
//////////////////////////////////////////////////////////////*/

async function doSettle(m: Manifest, client: WalletLike): Promise<boolean> {
  const marketId = (await read(m, "activeMarketId")) as Hex;
  const rec = await publicClient.readContract({
    address: m.marketsModule,
    abi: marketsModuleAbi,
    functionName: "markets",
    args: [marketId],
  });
  const market = rec[8];
  const expiry = Number(rec[13]);

  const now = Math.floor(Date.now() / 1000);
  if (now < expiry) {
    log(`window ${short(marketId)} expires in ${expiry - now}s`);
    return false;
  }

  const { resolved, voided } = await resolution(market);
  if (!resolved && !voided) {
    log(`window ${short(marketId)} expired but not yet resolved on chain — waiting`);
    return false;
  }

  // THE CENTRAL CLAIM. When reactivity is live, the precompile inserts a synthetic
  // transaction in the SAME BLOCK as resolution and `settleAll()` has already run by the
  // time this process notices. Give it a moment to prove that before reaching for the
  // manual path — and say plainly which one happened, because "no keeper anywhere in the
  // causal chain" is only true in the first case.
  if (USE_REACTIVITY) {
    const until = Date.now() + REACTIVITY_PATIENCE * 1000;
    while (Date.now() < until) {
      if (Number(await read(m, "phase")) === 0) {
        log(`settled by reactivity — no transaction from this process. ${voided ? "(voided window)" : ""}`);
        await hatch(m, client);
        return true;
      }
      await sleep(POLL);
    }
    warn(`reactivity did not settle within ${REACTIVITY_PATIENCE}s — falling back to poke()`);
  }

  const fallbackOpen = await publicClient.readContract({
    address: m.selectionEngine,
    abi: selectionEngineAbi,
    functionName: "fallbackEnabled",
  });

  // THE EXPLICIT GAS IS NOT A TUNING KNOB, and it is the whole repair for window 68. The
  // estimator cannot size a call that never reverts; `scripts/lib/gas.ts` carries the
  // measurement and the argument, and `--self-test` drives the table.
  const settleGas = await gasFor(m, "settle");

  const hash = fallbackOpen
    ? await send(client, {
        address: m.selectionEngine,
        abi: selectionEngineAbi,
        functionName: "poke",
        gas: settleGas,
      })
    : await send(client, {
        address: m.population,
        abi: populationAbi,
        functionName: "settleAll",
        gas: settleGas,
      });

  const via = fallbackOpen ? "SelectionEngine.poke" : "settleAll";
  log(`settle${voided ? " (voided)" : ""} via ${via} · ${explorerTx(hash)}`);
  // Works on both branches for `SettleFailed`: `poke()` calls `settleAll` internally, so
  // Population's own logs are in this receipt either way — the filter is on the emitter, not
  // the callee. That same filter is why `ReactionFailed` needs its own reader below: it is
  // SelectionEngine's log, and a Population-only filter drops it silently.
  await reportStragglers(m, hash, "settle");
  const reacted = await reportReactionFailure(m, hash);
  await reportDeaths(m);
  await hatch(m, client);

  /*
   *  DID IT ACTUALLY ADVANCE? Re-read the phase rather than trusting the receipt.
   *
   *  `send` asserts `receipt.status === "success"`, and on the `settleAll` branch that IS the
   *  whole story: `settleAll` writes `phase = 0` unconditionally at its end
   *  (`Population.sol:1628`), so a successful direct call cannot leave the machine in phase 2.
   *  The `poke` branch is a different transaction. `SelectionEngine._handle` wraps the call in
   *  `try population.settleAll()` and swallows any revert into `ReactionFailed`
   *  (`SelectionEngine.sol:220`), deliberately — a reverting reactive callback is paid for by
   *  the subscription owner and buys nothing. So `poke()` succeeds, the receipt says
   *  `success`, `reportStragglers` finds no `SettleFailed` because nothing in `settleAll` ran
   *  at all, and the population sits in phase 2 with every position still open.
   *
   *  Returning `true` there was the bug: the loop treats `true` as "the population moved", so
   *  it skipped its idle sleep and came straight back to a phase-2 population, poked again,
   *  and reported progress on every iteration. A wedge that should have read as a stall read
   *  as a healthy cadence in the operator's own log, at whatever rate the RPC would answer.
   *
   *  REPORTED, NOT RETRIED, and that is the loop's decision to make rather than this
   *  function's. `false` means "nothing moved, go and sleep", which is exactly right here: the
   *  same `poke` meets the same revert, so a retry policy would burn the hot key's gas and
   *  bury the reason. `monitor.ts`'s phase stall is what escalates it, because that is the
   *  alert an operator is actually watching.
   */
  const verdict = settleVerdict(Number(await read(m, "phase")), fallbackOpen, reacted);

  if (verdict === "wedged") {
    const why = fallbackOpen
      ? "poke() catches a reverting settleAll and emits ReactionFailed instead of bubbling it, so " +
        "a successful receipt does not mean a settled window"
      : "settleAll returned success without ever reaching `phase = 0`, which the deployed source " +
        "cannot do — check the deployed bytecode against this ABI";
    warn(
      `settle transaction succeeded but the population is STILL in phase 2 — the window did not ` +
        `close. ${why}. Every position is still open and every ante is still in the venue. Not ` +
        `retrying: the same call will meet the same revert. ${explorerTx(hash)}`,
    );
    return false;
  }

  // A lost race, not a fault: our poke reverted and something else — the precompile, or
  // another operator — settled the window in between. Worth a line so the log does not carry
  // an unexplained failure event, and deliberately not a warning.
  if (verdict === "lost-race") {
    log(`the poke above reverted but the window is settled anyway — another driver got there first`);
  }

  return true;
}

/**
 *  What a landed settle transaction actually accomplished, from the phase read back.
 *
 *  Pure, exported and separate from `doSettle` for one reason: it is the arithmetic of the
 *  honesty fix, and everything around it needs a chain. `--self-test` drives this table with
 *  no RPC, no key and no deployment, exactly as it does `seasonIsOver` — and it carries the
 *  control that matters, that a phase which did NOT move can never come back as progress.
 *
 *  THE PHASE IS THE ONLY AUTHORITY HERE. Not the receipt status (`send` already asserted it),
 *  not the absence of `SettleFailed` (a `poke` whose inner `settleAll` reverted emits none,
 *  because nothing inside `settleAll` ran), and not `ReactionFailed` on its own — that event
 *  says our call failed, which is not the same as the window being unsettled. Only phase 2
 *  after the call means nothing closed.
 *
 *    "settled"    the machine left phase 2. Progress, whoever caused it.
 *    "lost-race"  it left phase 2 AND our call was swallowed — someone else settled it.
 *    "wedged"     still phase 2. NOT progress, and the caller must return `false` so the loop
 *                 sleeps instead of poking again at RPC speed.
 */
export type SettleVerdict = "settled" | "lost-race" | "wedged";

export function settleVerdict(phaseAfter: number, fallbackOpen: boolean, reactionFailed: boolean): SettleVerdict {
  // `fallbackOpen` decides only the WORDING at the call site, never the verdict. It is taken
  // here so the self-test can prove that: a wedge is a wedge on both branches, and a version
  // that excused the direct `settleAll` branch would hide the "deployed bytecode disagrees
  // with this ABI" case, which is the more alarming of the two.
  void fallbackOpen;
  if (phaseAfter === 2) return "wedged";
  return reactionFailed ? "lost-race" : "settled";
}

/**
 *  Print the revert `SelectionEngine` swallowed, from the settle transaction's own logs.
 *
 *  THIS EVENT WAS INVISIBLE UNTIL 2026-09-06, and it was invisible for a structural reason
 *  rather than an oversight: every other report in this file filters
 *  `receipt.logs` down to `l.address === m.population`, which is right for `SettleFailed`,
 *  `Spawned` and `SeasonEnded` and wrong for exactly one event. `ReactionFailed(address
 *  emitter, uint256 blockNumber, bytes reason)` is declared on `SelectionEngine`
 *  (`SelectionEngine.sol:66`), so a Population-address filter drops it and a
 *  `populationAbi` decode would not match it either way. The one event emitted precisely when
 *  a settlement callback failed was the one event the operator could not see.
 *
 *  Read from the ENGINE THE MANIFEST NAMES, because that is the address this process poked;
 *  `preflightSelection` is where a manifest/chain divergence is reported, and doing it again
 *  per settlement would be noise on the hot path.
 *
 *  @returns true if any `ReactionFailed` was decoded, so the caller can tell a wedge from a
 *  lost race without re-fetching the receipt.
 *
 *  Never throws, same rule as `reportStragglers`: the transaction has landed and the phase
 *  re-read is the finding. A decode failure must not replace a real result with an exception.
 */
async function reportReactionFailure(m: Manifest, hash: Hex): Promise<boolean> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    const failed = parseEventLogs({
      abi: selectionEngineAbi,
      logs: receipt.logs.filter((l) => l.address.toLowerCase() === m.selectionEngine.toLowerCase()),
      eventName: "ReactionFailed",
    });
    for (const e of failed) {
      // The raw bytes, not a decoded name. `_handle` catches with `catch (bytes memory
      // reason)`, so this is whatever `settleAll` reverted with — a four-byte custom-error
      // selector most of the time. The two worth recognising on sight, both computed with
      // viem rather than remembered: `NotDriver()` is `0x0c0e646e` (this engine is no longer
      // the wired driver) and `WrongPhase(uint8,uint8)` is `0x05fb5e1b` followed by its two
      // arguments (something already settled the window). Printing the bytes verbatim is the
      // honest form — guessing a name from a hand-written ABI would occasionally name the
      // wrong error, and four bytes are decodable by hand.
      warn(
        `ReactionFailed at block ${e.args.blockNumber} — SelectionEngine caught a reverting ` +
          `settleAll and swallowed it. Revert data: ${e.args.reason}. ${explorerTx(hash)}`,
      );
    }
    return failed.length > 0;
  } catch (err) {
    warn(`could not decode ReactionFailed from the settle receipt: ${describe(err)}`);
    return false;
  }
}

/*//////////////////////////////////////////////////////////////
                        BIRTHS — hatchAll
//////////////////////////////////////////////////////////////*/

/**
 *  Children whose mutation consensus arrived are born here. One transaction, best effort.
 *
 *  A SEPARATE TRANSACTION FROM SETTLEMENT, ON PURPOSE, AND THAT IS THE CONTRACT'S
 *  DECISION RATHER THAN THIS SCRIPT'S. `hatchAll` is the one driver call with no
 *  `inPhase` modifier (`Population.sol:397` declares it) precisely so a mutation inference that is
 *  still in flight cannot delay a settlement, and so the gas of a birth is never charged
 *  to the reactivity callback that settles. Do not fold it into `settleAll`, and do not
 *  move it ahead of the settlement it follows: it is called after both settlement paths
 *  because a window's deaths and its births belong to the window that has just been
 *  graded.
 *
 *  Sent unconditionally rather than gated on a pending-birth read. Two reasons, and the
 *  second is the one that decides it: `hatchAll` skips organisms with no pending genome
 *  by itself, and the only precondition this script could read is each organism's
 *  `pendingChildPrompt`, which is per-organism, unbounded in size, and absent from
 *  `prophetAbi`. A wrong precondition would mean a child that is never born — an
 *  irreversible loss of a generation, which is the one asset this system cannot rebuild —
 *  while a redundant transaction costs gas. Those are not comparable risks.
 */
async function hatch(m: Manifest, client: WalletLike): Promise<void> {
  try {
    // EXPLICIT GAS, and this is the one driver call where an underestimate DOES revert —
    // `hatchAll` has no per-organism `try` (`Population.sol:1969-1981`), so an out-of-gas
    // bubbles and the `catch` below swallows it as a tolerance. That makes it the quietest
    // of the four: a birth lost to a gas limit reads as "nothing was pending". A `BeaconProxy`
    // deployment plus an endowment transfer is the most expensive per-organism leg here.
    const hash = await send(client, {
      address: m.population,
      abi: populationAbi,
      functionName: "hatchAll",
      gas: await gasFor(m, "hatch"),
    });
    await reportBirths(m, hash);
  } catch (err) {
    // NothingToHatch is the normal case, not an error.
    //
    // Kept even though the deployed `hatchAll` cannot currently emit it: the error is
    // declared (`Population.sol:306`) but no path in `src/` reverts with it — the loop
    // `continue`s past organisms with nothing pending — so today this branch is a
    // tolerance rather than a filter. It stays because the tolerance is free and the
    // alternative is a warning every quiet window if a future revision adds the guard.
    if (!/NothingToHatch/.test(describe(err))) warn(`hatchAll: ${describe(err)}`);
  }
}

/**
 *  Say which organisms were skipped, from the driver transaction's own logs.
 *
 *  `ThinkFailed` / `CommitFailed` / `SettleFailed` are the entire trace of the "one bad
 *  organism must never halt the population" rule: the loop catches, emits, and moves on,
 *  so nothing about the resulting state says a failure happened. That makes these the one
 *  class of fault `monitor.ts` structurally cannot find — it polls state, and a poll
 *  arriving after the transaction sees a population that merely did less than it should
 *  have. The receipt is in this process's hand exactly once, here.
 *
 *  A FAILED SETTLE IS THE SERIOUS ONE and is worded accordingly. `Prophet.settleWindow`
 *  clears `positionOpen` in its first statement, so a revert anywhere below unwinds that
 *  too and the organism keeps an open position with its ante already escrowed in the
 *  venue. Nothing retries it, and `noteCommitted` has no `positionOpen` guard, so the
 *  next window's commit overwrites `currentOutcomeId` and the old position stops being
 *  addressable by the only contract allowed to redeem it. So this is not "an organism
 *  missed a window": it is collateral leaving the arena. Act on the first one.
 *
 *  Never throws. The transaction has already landed; a decode failure is a reporting bug
 *  and must not abort the cadence — same rule as `reportBirths`.
 */
async function reportStragglers(m: Manifest, hash: Hex, verb: "think" | "commit" | "settle"): Promise<void> {
  const eventName = verb === "think" ? "ThinkFailed" : verb === "commit" ? "CommitFailed" : "SettleFailed";
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    const failed = parseEventLogs({
      abi: populationAbi,
      logs: receipt.logs.filter((l) => l.address.toLowerCase() === m.population.toLowerCase()),
      eventName,
    });
    if (failed.length === 0) return;

    const ids = failed.map((e) => `#${e.args.prophetId}`).join(", ");
    if (verb === "settle") {
      warn(
        `SETTLE FAILED for ${ids} — each still has an OPEN position and its ante is still in the ` +
          `venue. Nothing retries this window, and the next commit will overwrite the position id, ` +
          `after which that collateral is unreachable. Investigate before the next window: ` +
          `${explorerTx(hash)}`,
      );
    } else {
      warn(`${eventName} for ${ids} — skipped this window, scored as an abstain · ${explorerTx(hash)}`);
    }
  } catch (err) {
    warn(`${verb} landed but the per-organism failure report did not decode: ${describe(err)}`);
  }
}

/**
 *  Say who was born, from the birth transaction's own logs.
 *
 *  `Spawned(prophetId, prophet, parentId, generation)` is the lineage record, and lineage
 *  is the headline metric here — a bare "hatch · <tx>" line makes the one number the
 *  README leads with invisible in the operator's own log. Read from the receipt rather
 *  than by diffing `snapshot()`, for the same reason `reportSeasonClose` reads the
 *  receipt: a later read cannot distinguish this transaction's births from the next
 *  window's.
 *
 *  Never throws. The births are already on chain; a decode failure is a reporting bug.
 */
async function reportBirths(m: Manifest, hash: Hex): Promise<void> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    const born = parseEventLogs({
      abi: populationAbi,
      logs: receipt.logs.filter((l) => l.address.toLowerCase() === m.population.toLowerCase()),
      eventName: "Spawned",
    });

    if (born.length === 0) {
      log(`hatch · nothing was pending · ${explorerTx(hash)}`);
      return;
    }

    log(`hatch · ${born.length} born · ${explorerTx(hash)}`);
    for (const e of born) {
      log(`  BIRTH  #${e.args.prophetId} gen ${e.args.generation} from #${e.args.parentId} at ${e.args.prophet}`);
    }
  } catch (err) {
    warn(`hatch landed but the report failed: ${describe(err)} · ${explorerTx(hash)}`);
  }
}

async function reportDeaths(m: Manifest): Promise<void> {
  const snap = await read(m, "snapshot");
  const window = await read(m, "windowCount");
  for (const o of snap) {
    if (o.dead && o.deathWindow === window) {
      log(
        `DEATH  #${o.id} gen ${o.generation} after ${o.windowsLived} windows ` +
          `(${o.correctCount}/${o.wrongCount}/${o.abstainCount} right/wrong/abstain)`,
      );
    }
  }
  log(`alive ${snap.filter((o) => !o.dead).length}/${snap.length} · window #${window}`);
}

/*//////////////////////////////////////////////////////////////
                       THE SEASON BOUNDARY
//////////////////////////////////////////////////////////////*/

/**
 *  `endSeason`'s own guard lives in `lib/season.ts` and is RE-EXPORTED here, not defined here.
 *
 *  It moved out on 2026-09-06 because `monitor.ts` needs the same comparison for the opposite
 *  question — "should someone have closed this by now?", asked while this process is the one
 *  suspected of being dead — and it was mirroring both guards by hand rather than sharing them.
 *  A duplicated consensus boundary is the drift class the rest of this repo spends `cite-drift`,
 *  `abi-drift` and `count-drift` catching, and the failure mode is not hypothetical: an
 *  off-by-one here costs a season, and the same off-by-one over there silences the alert that
 *  would have caught it. The monitor must not import THIS file to get it — that would pull
 *  viem, `manifest()` and a `wallet()` that wants a key into a process whose job is to keep
 *  running when this one cannot — so the predicate went down into a module that imports nothing.
 *
 *  Re-exported rather than merely imported so the name stays part of this file's surface: the
 *  `--self-test` table below exercises `seasonIsOver` under this module's own export, which is
 *  what makes `npm run cadence:selftest` a check on the closer and not just on a library.
 */
export { seasonIsOver } from "./lib/season.js";

/**
 *  Close the season if the chain says it is over.
 *
 *  CHECK FIRST, AND STILL TOLERATE THE REVERT. `endSeason` is permissionless, so
 *  between the read below and the transaction landing, anyone — another operator, an
 *  entrant watching the window count, a bot — may have closed it. That is a feature of
 *  the design, not a race to be defended against: the payout is a promise to entrants
 *  that must not depend on us being awake. So `SeasonNotOver` from the send is logged as
 *  the ordinary outcome it is, exactly as `NothingToHatch` is in `hatch()`.
 *
 *  The read is what keeps the common case from being a reverting transaction every
 *  fifteen seconds for the whole season; the tolerance is what keeps a lost race from
 *  looking like a fault.
 *
 *  @returns nothing. A season close does not advance a phase, so it must NOT be reported
 *  as progress — returning `true` here would make the loop skip its idle sleep and spin.
 */
async function maybeEndSeason(m: Manifest, client: WalletLike): Promise<void> {
  // Through `read()`, like every other chain read in this file, so the widths come from
  // one place: `windowCount`/`seasonStartWindow` are `uint64` and arrive as `bigint`,
  // `seasonWindows`/`seasonId` are `uint32` and arrive as `number` (viem's boundary is
  // uint48/uint56, see `ReadResult`). The `BigInt()` below is that boundary made explicit
  // rather than a cast covering an unknown.
  try {
    const [windowCount, startWindow, seasonWindows, seasonId, pool] = await Promise.all([
      read(m, "windowCount"),
      read(m, "seasonStartWindow"),
      read(m, "seasonWindows"),
      read(m, "seasonId"),
      read(m, "prizePool"),
    ]);

    if (!seasonIsOver(windowCount, startWindow, BigInt(seasonWindows))) return;

    // `m.collateralDecimals`, never a literal 6. tUSDC happens to be 6, but the manifest
    // records what the deployed collateral reports, and a hardcoded scale would misprint
    // the pot by orders of magnitude the first time this ran against another collateral.
    log(
      `season ${seasonId} is over at window #${windowCount} (opened #${startWindow}, ran ` +
        `${seasonWindows}) · pool ${fmt(pool, m.collateralDecimals, 2)} — closing before the next window opens`,
    );

    let hash: Hex;
    try {
      hash = await send(client, { address: m.population, abi: populationAbi, functionName: "endSeason" });
    } catch (err) {
      const why = describe(err);
      if (/SeasonNotOver/.test(why)) {
        // Somebody else got there first, which is what permissionless means. CONFIRM it
        // rather than assume it: the identical revert would also mean our own read of the
        // boundary was wrong, and those two need opposite responses — one is nothing to
        // do, the other is a predicate that disagrees with the contract on every tick.
        const now = await read(m, "seasonId");
        if (now > seasonId) {
          log(`season ${seasonId} was closed by another caller — now in season ${now}`);
        } else {
          warn(`endSeason reverted SeasonNotOver but the season is still ${now} — check seasonIsOver against the ABI`);
        }
        return;
      }
      // Anything else IS a fault, and one that stops entrants being paid, so it is loud.
      // Not rethrown: a population that cannot close its season must still keep trading,
      // and nothing is lost — the pot stays where it is and the next tick tries again.
      warn(`endSeason: ${why}`);
      return;
    }

    await reportSeasonClose(m, hash, seasonId);
  } catch (err) {
    // The reads themselves failed. A transient RPC error must not cost the window.
    warn(`season check: ${describe(err)}`);
  }
}

/**
 *  Read the close back out of its own receipt and print the standings.
 *
 *  FROM THE LOGS, NOT FROM STORAGE READ AFTERWARDS. `endSeason` moves `seasonId`,
 *  `seasonStartWindow` and `prizePool` in the same transaction, so a post-hoc read
 *  reports the NEW season's empty state and calls it the old one's result. The events
 *  are the record — that is the whole claim this project makes about legibility — so the
 *  log is decoded from the receipt of the transaction that made it.
 *
 *  `SeasonEnded` and `SeasonPrizePaid` both carry the PRE-INCREMENT `seasonId`
 *  (`Population.sol:293`/`294`, emitted at `Population.sol:1113` with `seasonId += 1` after), so the season
 *  named in these logs is the one that just finished. No adjustment needed here — but do
 *  not "fix" it to `seasonId - 1` if the contract's emit ever moves.
 *
 *  Best effort throughout: a receipt that cannot be decoded must not turn a successful
 *  season close into a failed cadence step. The transaction is already on chain.
 */
async function reportSeasonClose(m: Manifest, hash: Hex, expected: number): Promise<void> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });

    // OUR LOGS ONLY. `endSeason` also drives ERC-20 transfers, so the receipt carries
    // the collateral's logs too. `parseEventLogs` in this viem version takes no `address`
    // filter (checked against the installed `parseEventLogs.d.ts`, not assumed), so the
    // narrowing is done here: a future ABI collision must not be decoded as ours.
    const mine = receipt.logs.filter((l) => l.address.toLowerCase() === m.population.toLowerCase());

    // TWO CALLS, ONE `eventName` EACH, rather than one call with both names. An array of
    // names yields a union whose `args` differ, and neither `find` nor `filter` narrows a
    // discriminated union in TypeScript, so every field access downstream would need a
    // cast. Two calls cost one extra pass over a handful of logs.
    const ended = parseEventLogs({ abi: populationAbi, logs: mine, eventName: "SeasonEnded" })[0];
    const paid = parseEventLogs({ abi: populationAbi, logs: mine, eventName: "SeasonPrizePaid" });

    if (!ended) {
      // The transaction succeeded — `send` already asserted `status === "success"` — so a
      // missing log means the ABI has drifted from the deployed contract, not that the
      // season did not close. Say which, because they need different fixes.
      warn(`season close landed but emitted no SeasonEnded this ABI can decode · ${explorerTx(hash)}`);
      return;
    }

    const d = m.collateralDecimals;
    const pot = ended.args.pot;
    const claimed = ended.args.paid;
    const rollover = pot - claimed;
    const names = labels(m.chainId);

    log(
      `SEASON ${ended.args.season} CLOSED · pot ${fmt(pot, d, 2)} tUSDC · ` +
        `paid ${fmt(claimed, d, 2)} to ${paid.length} winner${paid.length === 1 ? "" : "s"} · ` +
        `rolled over ${fmt(rollover, d, 2)} · ${explorerTx(hash)}`,
    );

    // THE PLACE COMES FROM THE SHARE OF THE POT, NOT FROM THE EMIT INDEX.
    //
    // `endSeason` SKIPS a slot rather than compacting it: `bestId[k] == 0` when fewer
    // than three organisms are living, `cut == 0` when the pot is too small to split,
    // and `to == address(0)` for a winner with no entrant. So the k-th log is not
    // necessarily the k-th place, and `["1st","2nd","3rd"][i]` is right only while
    // every skip happens to be trailing — a property of that season's standings, not
    // of this code. When it is not, the failure is silent and lands on the one line a
    // judge reads to learn who won: the true 3rd is announced as 2nd.
    //
    // 60/30/10 floors twice — once in `cut = pot * bps / 10_000`, once here — so a
    // share can land a basis point or two under its target. Nearest-of-three fixes
    // that with room to spare: the boundaries at 4500 and 2000 sit far from every
    // target. A share matching none of the three is printed as a raw percentage
    // instead of guessed at, because that is what a changed split in the contract
    // looks like from out here, and mislabelling it would hide the change.
    const placeOf = (amount: bigint): string => {
      if (pot === 0n) return "—";
      const bps = (amount * 10_000n) / pot;
      if (bps >= 4_500n) return "1st";
      if (bps >= 2_000n) return "2nd";
      if (bps >= 500n) return "3rd";
      return `${(Number(bps) / 100).toFixed(1)}% of pot`;
    };

    for (const e of paid) {
      const id = Number(e.args.prophetId);
      const name = names.get(id);
      log(
        `  ${placeOf(e.args.amount)} #${id}${name ? ` (${name})` : ""} · ` +
          `${fmt(e.args.amount, d, 2)} tUSDC to ${e.args.to}`,
      );
    }

    // NOT AN ERROR, AND WORTH A LINE. `endSeason` pays a slot only to a living, ranked
    // organism whose entrant is not the zero address, so fewer than three lines above is
    // the expected shape of an arena that has lost most of its population — and the
    // shortfall is exactly what `rollover` above carries forward.
    //
    // This line used to also offer "a founder has no entrant to pay". That reason is still
    // UNREACHABLE, but for a different cause than the one recorded here before, and the
    // difference is worth the paragraph. It used to be unreachable because `spawnGenesis`
    // passed `msg.sender` and is `onlyOwner`, so every founder was owned by the operator's
    // own EOA — which is the bug the Genesis Treasury fixed on 2026-09-05. It is now
    // unreachable because founders are owned by `genesisTreasury`, a contract address that
    // `spawnGenesis` REFUSES to leave zero (`NoGenesisTreasury`), so `endSeason`'s
    // `if (to == address(0)) continue;` still never fires. Either way, naming a cause that
    // cannot happen would send whoever reads this log looking for the wrong thing.
    //
    // A FOUNDER IN THE TOP THREE IS NOW PAID, and it is not the operator being paid: the
    // cut lands in the treasury, whose only outlet is a permissionless `recycle()` back
    // into `prizePool`. So a prize line naming the treasury address is the house's own
    // position taking a win, not a withdrawal. `placeOf` above already handles a skipped
    // middle slot if a zero entrant ever does become reachable.
    if (paid.length < 3) {
      log(
        `  ${3 - paid.length} of 3 prize${3 - paid.length === 1 ? "" : "s"} unclaimed ` +
          `(the dead are not ranked, and a slot too small to split pays nothing) — ` +
          `rolled into season ${expected + 1}`,
      );
    }
  } catch (err) {
    warn(`season ${expected} closed but the report failed to decode: ${describe(err)} · ${explorerTx(hash)}`);
  }
}

/*//////////////////////////////////////////////////////////////
                            PREFLIGHT
//////////////////////////////////////////////////////////////*/

/**
 *  Can this process actually drive, and does it still need to?
 *
 *  THE SECOND QUESTION IS NOT COSMETIC. `onlyDriver` accepts three senders — owner,
 *  `selectionEngine`, and the reactivity precompile — and only the first is this signer. So
 *  the two reads about the engine below decide what the operator's own log is allowed to say
 *  about the project's central claim:
 *
 *    - `Population.selectionEngine == address(0)` means `setWiring` never ran or was
 *      repointed to nothing. Reactivity then cannot settle a window at all, no matter what
 *      the subscription says, because the precompile's callback target is `SelectionEngine`
 *      and Population would reject the engine as a driver anyway. This keeper is the ONLY
 *      driver, `CADENCE_USE_REACTIVITY` is a lie waiting to waste `REACTIVITY_PATIENCE`
 *      seconds per window, and `doSettle`'s `poke` branch would revert against `address(0)`.
 *      Not fatal — the population still runs off `settleAll` — so it is a loud WARN and not
 *      a throw: refusing to start would take the population down over a claim, and the
 *      claim is not what keeps the organisms alive.
 *    - `fallbackEnabled` is the honesty flag itself. While it is `true` the licensed claim is
 *      *"selection is on-chain and atomic with redemption"*; only after `disableFallback()`
 *      is *"no keeper anywhere in the causal chain"* literally true. `README.md` and
 *      `npm run prove` both turn on that boolean, and this is the one place the operator sees
 *      it before a run rather than after. Printing it here is what stops an eleven-day soak
 *      being narrated with the stronger claim by accident.
 *
 *  The engine reads are wrapped and the failure is not fatal, deliberately. A repointed or
 *  not-yet-wired engine is a call to `address(0)` or to a contract without the fragment, and
 *  the cadence must still come up: `settleAll` needs none of this. What must not happen is
 *  silence, which is what the file did before — the preflight named `selectionEngine` in a
 *  comment and never read it.
 */
async function preflight(m: Manifest, signer: Address): Promise<void> {
  const id = await publicClient.getChainId();
  if (id !== m.chainId) throw new Error(`RPC is chain ${id} but the manifest is for ${m.chainId}`);

  const [owner, updater, gas] = await Promise.all([
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "owner" }),
    publicClient.readContract({ address: m.priceSource, abi: priceSourceAbi, functionName: "updater" }),
    publicClient.getBalance({ address: signer }),
  ]);

  // `think`/`commitAll`/`settleAll` are gated on owner ‖ selectionEngine ‖ precompile,
  // and `pushWindow` on updater ‖ owner. Discovering that from a reverted transaction at
  // 2am is worse than discovering it now.
  if (owner.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(`signer ${signer} is not Population.owner (${owner}) — think()/commitAll() will revert NotDriver`);
  }
  if (updater.toLowerCase() !== signer.toLowerCase() && owner.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(`signer ${signer} is neither updater (${updater}) nor owner — pushWindow() will revert`);
  }
  if (gas === 0n) throw new Error(`signer ${signer} has no native balance for gas`);

  await preflightSelection(m);

  log(`phase ${PHASE[Number(await read(m, "phase"))] ?? "?"} · window #${await read(m, "windowCount")}`);
}

/**
 *  The reactive half of the driver union, read from the chain rather than from the manifest.
 *
 *  FROM `Population.selectionEngine()`, NOT `m.selectionEngine`, and the two can disagree.
 *  The manifest records the engine deployed on day one; `setWiring` can repoint it in a
 *  single transaction, and the engine is deliberately plain and freely redeployable
 *  (`SelectionEngine.sol`'s ownership note says so as the recovery mechanism). So the
 *  manifest is what this process will call `poke` on and the chain is what `onlyDriver` will
 *  accept — a mismatch means `doSettle`'s fallback pokes an engine Population no longer
 *  trusts, which reverts `NotDriver` INSIDE the try/catch and surfaces as `ReactionFailed`
 *  with a settled-looking receipt. That is precisely the wedge (a) above now detects, and
 *  this is where it is cheap to predict instead.
 */
async function preflightSelection(m: Manifest): Promise<void> {
  let wired: Address;
  try {
    wired = await publicClient.readContract({
      address: m.population,
      abi: populationAbi,
      functionName: "selectionEngine",
    });
  } catch (err) {
    warn(`could not read Population.selectionEngine: ${describe(err)} — reactivity status unknown`);
    return;
  }

  if (wired === "0x0000000000000000000000000000000000000000") {
    warn(
      `Population.selectionEngine is UNSET. Reactivity cannot settle a window — the precompile's ` +
        `callback target is SelectionEngine and Population would reject it as a driver anyway — so ` +
        `this process is the only driver. Do not set CADENCE_USE_REACTIVITY, and expect ` +
        `doSettle's poke branch to fail. Fix with setWiring(0, <engine>, 0, 0).`,
    );
    return;
  }

  if (wired.toLowerCase() !== m.selectionEngine.toLowerCase()) {
    warn(
      `Population.selectionEngine is ${wired} but the manifest records ${m.selectionEngine}. ` +
        `This process pokes the MANIFEST's engine and Population only accepts the CHAIN's, so the ` +
        `fallback path will revert NotDriver inside SelectionEngine's try/catch and land as a ` +
        `successful receipt over an unsettled window.`,
    );
  }

  // Read the flag off the engine the CHAIN trusts. Reading the manifest's instead would
  // report the honesty posture of a contract that no longer drives anything.
  let fallbackOpen: boolean;
  try {
    fallbackOpen = await publicClient.readContract({
      address: wired,
      abi: selectionEngineAbi,
      functionName: "fallbackEnabled",
    });
  } catch (err) {
    warn(`SelectionEngine ${wired} has no readable fallbackEnabled: ${describe(err)}`);
    return;
  }

  log(
    `selectionEngine ${wired} · fallback ${fallbackOpen ? "OPEN" : "CLOSED"} — ` +
      (fallbackOpen
        ? `this keeper may still poke(), so the licensed claim is "selection is on-chain and ` +
          `atomic with redemption", NOT "no keeper anywhere in the causal chain". ` +
          `disableFallback() after npm run prove passes.`
        : `settlement is reactivity-only; poke() reverts FallbackClosed and doSettle will call ` +
          `settleAll directly if the precompile does not fire.`),
  );
}

/*//////////////////////////////////////////////////////////////
                             PLUMBING
//////////////////////////////////////////////////////////////*/

type WalletLike = ReturnType<typeof wallet>["client"];

/**
 *  A contract call, loosely typed on purpose.
 *
 *  viem's generic inference over a union of function names is more trouble than it is
 *  worth for four call sites; the ABIs are the source of truth and a wrong function name
 *  fails at the RPC, immediately and loudly.
 */
type Call = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  /**
   *  An explicit gas limit, and OPTIONAL only because `pushWindow` and `endSeason` do not
   *  need one — both are single-shot writes with no per-organism loop, so viem's estimate
   *  is sound for them. Every call that iterates `living` MUST pass this: the estimator
   *  cannot size a function whose per-organism failures are caught and whose phase advances
   *  regardless. `scripts/lib/gas.ts` carries the measurement.
   */
  gas?: bigint;
};

/** Typed convenience over the handful of Population reads this script makes. */
async function read<
  K extends
    | "phase"
    | "windowCount"
    | "aliveCount"
    | "requestDeposit"
    | "activeMarketId"
    | "snapshot"
    | "seasonId"
    | "seasonStartWindow"
    | "seasonWindows"
    | "prizePool",
>(m: Manifest, functionName: K): Promise<ReadResult<K>> {
  return (await publicClient.readContract({
    address: m.population,
    abi: populationAbi,
    functionName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as ReadResult<K>;
}

type Snapshot = {
  id: bigint;
  addr: Address;
  parentId: bigint;
  generation: number;
  treasury: bigint;
  streak: number;
  windowsLived: number;
  correctCount: number;
  wrongCount: number;
  abstainCount: number;
  birthWindow: bigint;
  deathWindow: bigint;
  dead: boolean;
  belief: number;
  thesis: number;
  genomeHash: Hex;
};

/**
 *  `seasonId` and `seasonWindows` are `number`, not `bigint`, and that is viem's rule
 *  rather than a preference: it decodes uint8..uint48 to `number` and uint56 upward to
 *  `bigint`. Both are `uint32` on chain, while `windowCount` and `seasonStartWindow` are
 *  `uint64`. Getting this wrong does not fail to compile — it produces
 *  `bigint - bigint >= number`, which TypeScript rejects, or worse a silent `0n` from an
 *  arithmetic mix somewhere downstream. The season comparison converts explicitly.
 */
type ReadResult<K> = K extends "snapshot"
  ? readonly Snapshot[]
  : K extends "activeMarketId"
    ? Hex
    : K extends "seasonId" | "seasonWindows"
      ? number
      : bigint;

/** Write, wait for the receipt, and fail loudly if it reverted. */
/**
 *  The gas limit for one driver call, read against the live population.
 *
 *  Wraps `driverGas` for one reason beyond the `aliveCount` read: the clamp has to be
 *  AUDIBLE. `driverGas` returns `capped` when the formula wanted more than a block can
 *  hold, and a silently clamped limit is exactly the failure this whole repair is about —
 *  a transaction that lands `status 1` having skipped the last organisms in the loop. So
 *  the one place that can say so says so, every time, rather than leaving the operator to
 *  infer it from a `SettleFailed` on the highest ids.
 *
 *  Never throws on the read. A failed `aliveCount` falls back to sizing for a full
 *  `maxPopulation` (24) rather than for one organism: over-sizing costs nothing because
 *  unused gas is refunded, while under-sizing on a read failure would reintroduce the
 *  defect through the error path.
 */
async function gasFor(m: Manifest, call: DriverCall): Promise<bigint> {
  let alive = 24n;
  try {
    alive = await read(m, "aliveCount");
  } catch (err) {
    warn(`could not read aliveCount to size ${call} gas — sizing for a full population: ${describe(err)}`);
  }

  const plan: GasPlan = driverGas(call, alive);
  if (plan.capped) {
    warn(
      `${call} wants ${plan.wanted} gas for ${alive} organisms but the limit is clamped to ` +
        `${BLOCK_GAS_CEILING} (one block). Organisms at the END of the loop may run out of gas and ` +
        `be skipped with a ${call === "settle" ? "SettleFailed" : call === "commit" ? "CommitFailed" : "ThinkFailed"} ` +
        `event while the transaction still reports success — this call needs splitting across ` +
        `transactions at this population size. See docs/ERROR_W68_MOMENTUM.md.`,
    );
  }
  return plan.gas;
}

async function send(client: WalletLike, call: Call): Promise<Hex> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await client.writeContract(call as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted on chain: ${explorerTx(hash)}`);
  return hash;
}

/** Turn a viem revert into a sentence. The ABIs carry the custom errors for this. */
function describe(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      const args = reverted.data?.args;
      if (name) return `${name}(${(args ?? []).join(", ")})`;
      if (reverted.reason) return reverted.reason;
    }
    return err.shortMessage || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const short = (h: string) => `${h.slice(0, 10)}…`;

/*//////////////////////////////////////////////////////////////
                            SELF-TEST
//////////////////////////////////////////////////////////////*/

/**
 *  `npm run cadence -- --self-test` — the season boundary, checked without a chain.
 *
 *  This exists because there is no deployment yet, so `npm run typecheck` is otherwise
 *  the only executable check on this file, and a typechecked off-by-one is still an
 *  off-by-one that costs a whole season. `seasonIsOver` is the only piece of the season
 *  work that is arithmetic rather than plumbing, so it is the only piece that can be
 *  exercised here — the reads, the send, the revert tolerance and the log decoding all
 *  need a chain, and this function does not pretend otherwise.
 *
 *  THE BOUNDARY CASES ARE THE POINT. `elapsed == windows - 1` must be false and
 *  `elapsed == windows` must be true; a test suite that only checked 0 and 1000 would
 *  pass on either side of the off-by-one it is meant to catch. The paired false/true rows
 *  around each boundary are the controls — delete one and the case stops being able to
 *  fail. Numbers come from `Population.initialize` (24 windows from 0, six hours at the
 *  15-minute cadence) so a drift in the contract's own defaults shows up here as a wrong
 *  comment, not a wrong pass. The long-season rows are kept as well: `setSeason` can still
 *  configure one, and the predicate must not have been tuned to the shipped default.
 */
type SeasonCase = { w: bigint; start: bigint; len: bigint; want: boolean; why: string };
type SeasonPredicate = (windowCount: bigint, seasonStartWindow: bigint, seasonWindows: bigint) => boolean;

function selfTestSeasonBoundary(): void {
  const cases: SeasonCase[] = [
    // Season 1 as `initialize` configures it: 24 windows dated from window 0.
    { w: 0n, start: 0n, len: 24n, want: false, why: "a fresh population has run no windows" },
    { w: 23n, start: 0n, len: 24n, want: false, why: "one window short — the control for the row below" },
    { w: 24n, start: 0n, len: 24n, want: true, why: "the exact boundary closes" },
    { w: 25n, start: 0n, len: 24n, want: true, why: "a late close is still a close" },

    // A second season, dated from wherever the first one closed — `endSeason` sets
    // `seasonStartWindow = windowCount`, which is why `start` is not a multiple of `len`.
    { w: 40n, start: 25n, len: 24n, want: false, why: "15 of 24 windows into season 2" },
    { w: 48n, start: 25n, len: 24n, want: false, why: "23 windows in — control" },
    { w: 49n, start: 25n, len: 24n, want: true, why: "24 windows after a LATE close" },

    // A LONG season, which `setSeason` can still configure — and which was the shipped
    // default until 2026-09-05. Kept so the predicate is not tuned to one magnitude.
    { w: 575n, start: 0n, len: 576n, want: false, why: "one window short of a six-day season" },
    { w: 576n, start: 0n, len: 576n, want: true, why: "576 of 576 — the old default's boundary" },

    // A short demo season, which is what `setSeason` is for.
    { w: 9n, start: 0n, len: 10n, want: false, why: "9 of a 10-window demo season" },
    { w: 10n, start: 0n, len: 10n, want: true, why: "10 of 10" },

    // The two degenerate reads. Neither should ever happen; both must not close a season.
    { w: 5n, start: 0n, len: 0n, want: false, why: "a zero-length season must never close, not close always" },
    { w: 5n, start: 9n, len: 24n, want: false, why: "start ahead of the count would underflow on chain" },
  ];

  const run = (p: SeasonPredicate, report: boolean): number => {
    let bad = 0;
    for (const c of cases) {
      const got = p(c.w, c.start, c.len);
      if (got === c.want) continue;
      bad++;
      if (report) console.error(`FAIL  window ${c.w}, start ${c.start}, len ${c.len} → ${got}, want ${c.want} — ${c.why}`);
    }
    return bad;
  };

  let failed = run(seasonIsOver, true);

  // THE DETECTOR'S OWN SELF-TEST, and it is not padding — `web/test/smoke.mjs` has six of
  // these for exactly the reason this one exists: a check whose subject is "the boundary
  // is not off by one" is worthless unless an off-by-one actually makes it fail. So run
  // the same table against the two mistakes this code was most likely to contain and
  // require both to be caught. If either of these passes the table, the table is inert.
  const offByOne: SeasonPredicate = (w, s, len) => len !== 0n && w >= s && w - s > len;
  const ignoresStart: SeasonPredicate = (w, _s, len) => len !== 0n && w >= len;
  if (run(offByOne, false) === 0) {
    failed++;
    console.error("FAIL  the table does not catch a `>` where `>=` belongs — it cannot detect an off-by-one");
  }
  if (run(ignoresStart, false) === 0) {
    failed++;
    console.error("FAIL  the table does not catch a predicate that ignores seasonStartWindow");
  }

  const total = cases.length + 2;
  if (failed > 0) {
    console.error(`${failed} of ${total} season-boundary checks failed`);
    process.exitCode = 1;
    return;
  }
  log(`season boundary: ${total} checks pass, 2 of them controls (no chain, no key, no deployment)`);

  selfTestSettleVerdict();
}

/**
 *  The other predicate that must not lie: did the settle actually move the machine?
 *
 *  WHY THIS IS TESTED AT ALL, given it is nine lines. Because the bug it replaces was not a
 *  wrong answer, it was a MISSING QUESTION — `doSettle` returned `true` on a successful receipt
 *  and never re-read the phase, so a settle that reverted inside `poke()`'s try/catch
 *  (`SelectionEngine.sol:222` catches it and emits `ReactionFailed`) reported progress. The loop
 *  then skipped its idle sleep and poked a wedged phase-2 population at RPC speed while logging
 *  advancement. A predicate whose failure mode is "reports success" is exactly the kind that has
 *  to be pinned by a control, because every one of its outputs looks plausible in a log.
 *
 *  THE CONTROLS ARE THE POINT: a phase-2 result must read as "wedged" on BOTH branches of
 *  `fallbackOpen`, because the flag governs only the wording of the message and must never be
 *  able to talk the verdict out of an alarm.
 */
function selfTestSettleVerdict(): void {
  type Case = { phase: number; open: boolean; reacted: boolean; want: SettleVerdict; why: string };
  const cases: Case[] = [
    // The ordinary success: settleAll wrote `phase = 0` (`Population.sol:1628`) and nothing
    // caught anything on the way.
    { phase: 0, open: true, reacted: false, want: "settled", why: "idle after settle is a closed window" },
    { phase: 0, open: false, reacted: false, want: "settled", why: "same, with the fallback closed" },

    // THE BUG. A successful receipt over a population still in phase 2.
    { phase: 2, open: true, reacted: true, want: "wedged", why: "poke() swallowed the revert — the whole defect" },
    { phase: 2, open: true, reacted: false, want: "wedged", why: "phase 2 is wedged even with no ReactionFailed log" },
    { phase: 2, open: false, reacted: false, want: "wedged", why: "CONTROL fallbackOpen must not excuse phase 2" },
    { phase: 2, open: false, reacted: true, want: "wedged", why: "CONTROL neither flag can excuse phase 2" },

    // A ReactionFailed log with the phase already advanced is a race we LOST, not a fault: some
    // other driver settled the window first and our poke found nothing to do. Alerting on it
    // would make every healthy reactivity-plus-keeper deployment cry wolf once a window.
    { phase: 0, open: true, reacted: true, want: "lost-race", why: "ReactionFailed but settled: another driver won" },

    // Phase 1 after a settle should be impossible, but it is not phase 2 and the window did
    // close, so it is progress — the loop's next tick will read the machine again either way.
    { phase: 1, open: true, reacted: false, want: "settled", why: "thinking again: the window did close" },
  ];

  let failed = 0;
  for (const c of cases) {
    const got = settleVerdict(c.phase, c.open, c.reacted);
    if (got === c.want) continue;
    failed++;
    console.error(`FAIL  phase ${c.phase}, open ${c.open}, reacted ${c.reacted} → ${got}, want ${c.want}: ${c.why}`);
  }

  // THE DETECTOR'S OWN CONTROL, in the idiom above: the table must be able to catch the exact
  // regression this predicate exists to prevent — a verdict that trusts the receipt and reports
  // progress regardless of the phase. If the always-settled stub passes, the table is inert and
  // the predicate is unprotected.
  const trustsReceipt = (_p: number, _o: boolean, _r: boolean): SettleVerdict => "settled";
  if (cases.every((c) => trustsReceipt(c.phase, c.open, c.reacted) === c.want)) {
    failed++;
    console.error("FAIL  the table does not catch a verdict that always reports progress — it cannot detect the bug");
  }

  const total = cases.length + 1;
  if (failed > 0) {
    console.error(`${failed} of ${total} settle-verdict checks failed`);
    process.exitCode = 1;
    return;
  }
  log(`settle verdict: ${total} checks pass, 3 of them controls (a phase-2 read can never report progress)`);

  selfTestCommitReadiness();
}

/**
 *  The commit-timing table — the arithmetic of the 29-window fix, checked without a chain.
 *
 *  Same idiom as the two tables above, and the controls are the point: the table must fail
 *  against the predicate this code REPLACED. `breaksOnEmpty` is that predicate, written
 *  out in one line, and if it passes this table then the table cannot detect the defect and
 *  is decoration.
 *
 *  The second control is the opposite mistake, and it is the one a careless fix would make:
 *  a predicate that waits for the floor unconditionally, ignoring `answered`. That is not a
 *  safety improvement — it adds a fixed delay to every healthy window for nothing, and on a
 *  short market it eats the margin between `pushWindow` and the commit deadline. The table
 *  must catch it too, which is why the "answered early" row exists.
 */
function selfTestCommitReadiness(): void {
  type Case = CommitInputs & { want: CommitReadiness["act"]; why: string };

  // The default shape of a healthy 8-organism window on the 1h ladder, so each row below
  // varies one thing and the reader can see which.
  const base: CommitInputs = {
    pending: 0,
    answered: 0,
    alive: 8,
    elapsed: 0,
    floor: 30,
    patience: 330,
    untilDeadline: 3540,
  };

  const cases: Case[] = [
    // THE DEFECT, as measured on 2026-09-06. `think()` has just landed, the requests have
    // not registered, and nobody has answered. The old code committed here — 29 times.
    { ...base, elapsed: 0, want: "wait", why: "THE BUG: empty pending set one second after think is not consensus" },
    { ...base, elapsed: 5, want: "wait", why: "still inside the floor with no belief landed" },
    { ...base, elapsed: 29, want: "wait", why: "one second short of the floor — the control for the row below" },
    { ...base, elapsed: 30, want: "commit", why: "the floor is exhausted and nothing is outstanding" },

    // THE ESCAPE HATCH. A real callback has landed, which proves the reads are seeing
    // post-think state, so the floor has nothing left to protect against.
    {
      ...base,
      elapsed: 8,
      answered: 8,
      want: "commit",
      why: "all eight answered in 8s — the floor must not delay a finished window",
    },
    {
      ...base,
      elapsed: 8,
      answered: 1,
      pending: 7,
      want: "wait",
      why: "one answer proves the reads are live, but seven are still out",
    },

    // PATIENCE. A request the validators dropped never clears, so the wait must be bounded
    // by something other than the deadline.
    { ...base, elapsed: 330, pending: 2, answered: 6, want: "commit-anyway", why: "patience exhausted, two never answered" },
    { ...base, elapsed: 329, pending: 2, answered: 6, want: "wait", why: "one second short of patience — control" },

    // THE DEADLINE OUTRANKS EVERYTHING, including the floor. A commitment after expiry is a
    // window every organism paid for and could not trade.
    {
      ...base,
      elapsed: 2,
      untilDeadline: 0,
      want: "commit-anyway",
      why: "at the deadline inside the floor: the market outranks the floor",
    },
    {
      ...base,
      elapsed: 2,
      untilDeadline: -30,
      pending: 8,
      want: "commit-anyway",
      why: "past the deadline with everyone still thinking",
    },
    {
      ...base,
      elapsed: 400,
      untilDeadline: 0,
      pending: 8,
      want: "commit-anyway",
      why: "deadline and patience both blown — still one commit, not a wait",
    },

    // A market whose expiry could not be read must not become an unbounded wait; patience
    // is what bounds it.
    { ...base, elapsed: 400, untilDeadline: undefined, pending: 3, want: "commit-anyway", why: "no deadline read, patience still binds" },
    { ...base, elapsed: 10, untilDeadline: undefined, pending: 3, answered: 5, want: "wait", why: "no deadline read, still early" },

    // AN EXTINCT POPULATION IS NOT A PENDING ONE. Guarded before the floor so a dead
    // population does not sit in the loop for 330 s on its way to reporting extinction.
    { ...base, alive: 0, elapsed: 0, want: "commit", why: "no living organisms — nothing to wait for" },
  ];

  let failed = 0;
  for (const c of cases) {
    const got = commitReadiness(c).act;
    if (got === c.want) continue;
    failed++;
    console.error(
      `FAIL  pending ${c.pending}, answered ${c.answered}/${c.alive}, elapsed ${c.elapsed}s, ` +
        `deadline ${c.untilDeadline} → ${got}, want ${c.want}: ${c.why}`,
    );
  }

  // CONTROL 1 — the predicate this replaced. It breaks out the instant nothing is pending,
  // which is the entire 29-window defect. If the table cannot fail it, the table is inert.
  const breaksOnEmpty = (i: CommitInputs): CommitReadiness["act"] => (i.pending === 0 ? "commit" : "wait");
  if (cases.every((c) => breaksOnEmpty(c) === c.want)) {
    failed++;
    console.error("FAIL  the table does not catch a predicate that commits on an empty pending set — it cannot detect the bug");
  }

  // CONTROL 2 — the careless fix: wait out the floor no matter what, ignoring `answered`.
  // Safe against the defect and wrong about every healthy window, which is why the
  // "answered in 8s" row is in the table.
  const ignoresAnswered = (i: CommitInputs): CommitReadiness["act"] => {
    if (i.untilDeadline !== undefined && i.untilDeadline <= 0) return "commit-anyway";
    if (i.alive === 0) return "commit";
    if (i.elapsed < i.floor) return "wait";
    if (i.pending === 0) return "commit";
    return i.elapsed >= i.patience ? "commit-anyway" : "wait";
  };
  if (cases.every((c) => ignoresAnswered(c) === c.want)) {
    failed++;
    console.error("FAIL  the table does not catch a floor that ignores `answered` — it would delay every healthy window");
  }

  // CONTROL 3 — the blind-window detector must fire on the defect's signature and stay
  // silent on a legitimate one. An abstention IS an answer, so `answered == alive` with
  // every organism abstaining is a real unanimous abstention and must NOT be flagged.
  if (!committedBlind(8, 0)) {
    failed++;
    console.error("FAIL  committedBlind does not flag a window in which no living organism answered");
  }
  if (committedBlind(8, 8)) {
    failed++;
    console.error("FAIL  committedBlind flags a unanimous abstention — an abstention is an answer, not a blind window");
  }
  if (committedBlind(0, 0)) {
    failed++;
    console.error("FAIL  committedBlind flags an extinct population as blind");
  }

  const total = cases.length + 5;
  if (failed > 0) {
    console.error(`${failed} of ${total} commit-readiness checks failed`);
    process.exitCode = 1;
    return;
  }
  log(`commit readiness: ${total} checks pass, 5 of them controls (an empty pending set inside the floor can never commit)`);

  selfTestDriverGas();
}

/**
 *  The gas table — the arithmetic of the window-68 fix, checked without a chain.
 *
 *  WHY THIS IS TESTED AT ALL, given `driverGas` is four lines. Because the defect it repairs
 *  was not a wrong number, it was a MISSING NUMBER: `send` passed no `gas` and viem estimated,
 *  and the estimate was structurally guaranteed to be too small on a call that cannot revert.
 *  A regression here is therefore not "the limit drifted"; it is someone deleting a `gas:`
 *  field, or a formula that quietly returns something a block cannot hold. Neither is visible
 *  in a log until an organism is skipped — which is exactly the class of fault the other three
 *  tables in this file exist for.
 *
 *  THE CONTROLS ARE THE POINT, in the idiom the rest of this file already uses. Two stubs
 *  represent the two ways to get this wrong, and each must fail the table:
 *
 *    - `estimatorShaped` — the bug itself, as a number: window 68's actual 2,592,003 limit,
 *      returned regardless of population. If the table passes it, the table cannot detect
 *      the defect and is decoration.
 *    - `noClamp` — the careless fix: scale per organism and never clamp. It agrees with
 *      `driverGas` on every small population and returns an unmineable 23.1M at
 *      `maxPopulation`, so only a row at 24 organisms can tell them apart. That row is the
 *      reason the clamp is testable at all.
 */
function selfTestDriverGas(): void {
  type Case = { call: DriverCall; alive: bigint; want: bigint; capped: boolean; why: string };

  const cases: Case[] = [
    // THE MEASURED CASE. Window 68 settled four organisms and was charged 2,465,478 on a
    // 2,592,003 limit while skipping one of them. The replay needed 774,291 for all four.
    // Whatever this formula returns for four organisms must exceed the limit that FAILED,
    // or the fix is not a fix — that is the assertion, and 5.1M does.
    { call: "settle", alive: 4n, want: 5_100_000n, capped: false, why: "the window-68 population: must exceed 2,592,003" },

    // The live population right after window 68's two deaths.
    { call: "settle", alive: 6n, want: 6_900_000n, capped: false, why: "six alive: floor 1.5M + 6 x 900k" },
    { call: "think", alive: 6n, want: 3_600_000n, capped: false, why: "think floor 600k + 6 x 500k" },
    { call: "commit", alive: 6n, want: 3_600_000n, capped: false, why: "commit floor 600k + 6 x 500k" },
    { call: "hatch", alive: 6n, want: 7_600_000n, capped: false, why: "hatch floor 400k + 6 x 1.2M" },

    // Generation 0 at full strength, which is what Seed produces.
    { call: "settle", alive: 8n, want: 8_700_000n, capped: false, why: "the eight founders" },

    // A ZERO-ORGANISM READ MUST STILL FUND THE FIXED WORK. An extinct population still has a
    // phase to advance, and a limit of exactly the floor is the one place the formula could
    // undercut the work it has to pay for. Clamped to 1, not to 0.
    { call: "settle", alive: 0n, want: 2_400_000n, capped: false, why: "extinct: sized for one, never for zero" },
    { call: "settle", alive: 1n, want: 2_400_000n, capped: false, why: "one organism — same as zero, the control for the row above" },

    // THE CLAMP, and the row that makes it testable. At `maxPopulation = 24` the settle
    // formula wants 23.1M, which is under a 30M block; at 33 it wants 31.2M, which is not.
    { call: "settle", alive: 24n, want: 23_100_000n, capped: false, why: "maxPopulation: 23.1M fits in a block uncapped" },
    { call: "hatch", alive: 24n, want: 29_200_000n, capped: false, why: "hatch at maxPopulation: 29.2M, one block short of the clamp" },
    { call: "hatch", alive: 25n, want: BLOCK_GAS_CEILING, capped: true, why: "30.4M wanted — clamped, and the operator must be told" },
    { call: "settle", alive: 33n, want: BLOCK_GAS_CEILING, capped: true, why: "31.2M wanted — clamped" },
  ];

  let failed = 0;
  for (const c of cases) {
    const got = driverGas(c.call, c.alive);
    if (got.gas === c.want && got.capped === c.capped) continue;
    failed++;
    console.error(
      `FAIL  ${c.call} at ${c.alive} alive → ${got.gas} capped=${got.capped}, ` +
        `want ${c.want} capped=${c.capped}: ${c.why}`,
    );
  }

  // THE INVARIANT BEHIND EVERY ROW, asserted separately because it is the property that
  // matters rather than any one number: no call may ever be sized below what window 68 was
  // charged while failing. A future edit that halves a floor would still pass every equality
  // row it was edited alongside; it cannot pass this.
  const W68_CHARGED = 2_465_478n;
  for (const call of ["think", "commit", "settle", "hatch"] as DriverCall[]) {
    const got = driverGas(call, 4n).gas;
    if (got > W68_CHARGED) continue;
    failed++;
    console.error(`FAIL  ${call} at 4 alive is ${got}, which does not exceed the ${W68_CHARGED} that silently skipped an organism`);
  }

  // AND THE CEILING IS NEVER EXCEEDED, at any population the contract can reach. A limit
  // above a block is not conservative, it is a transaction the chain will not accept.
  for (const call of ["think", "commit", "settle", "hatch"] as DriverCall[]) {
    for (const alive of [0n, 1n, 24n, 100n, 10_000n]) {
      if (driverGas(call, alive).gas <= BLOCK_GAS_CEILING) continue;
      failed++;
      console.error(`FAIL  ${call} at ${alive} alive returns a limit above the ${BLOCK_GAS_CEILING} block ceiling`);
    }
  }

  // CONTROL 1 — the defect as a number. Window 68's own limit, ignoring the population.
  const estimatorShaped = (_c: DriverCall, _a: bigint): bigint => 2_592_003n;
  if (cases.every((c) => estimatorShaped(c.call, c.alive) === c.want)) {
    failed++;
    console.error("FAIL  the table does not catch a flat estimator-sized limit — it cannot detect the window-68 defect");
  }

  // CONTROL 2 — the careless fix: right formula, no clamp. Indistinguishable from the real
  // thing on every small population, so the 25- and 33-organism rows are what catch it.
  const noClamp = (call: DriverCall, alive: bigint): bigint => driverGas(call, alive).wanted;
  if (cases.every((c) => noClamp(c.call, c.alive) === c.want)) {
    failed++;
    console.error("FAIL  the table does not catch an unclamped formula — it would emit a limit no block can hold");
  }

  const total = cases.length + 2;
  if (failed > 0) {
    console.error(`${failed} of ${total} driver-gas checks failed`);
    process.exitCode = 1;
    return;
  }
  log(`driver gas: ${total} checks pass, 2 of them controls (no limit may fall to the estimate that skipped MOMENTUM)`);
}

// ONE ENTRY POINT, and the `--self-test` branch is inside `main()` rather than here, so
// that the flag is checked in exactly one place. `main()` returns before `manifest()` and
// `wallet()` when the flag is present, which is the whole reason the self-test runs on a
// machine with no deployment and no key.
//
// GUARDED, because until 2026-09-04 it was not — and an unguarded `main()` at module scope
// makes this file's exports untouchable. `import { seasonIsOver } from "./cadence.js"` does
// not import a predicate; it STARTS A SECOND CADENCE inside the importing process. Before
// the deploy that is merely loud: the import dies on `manifest()`'s FATAL and takes its
// importer down with it, which is how it was found. After the deploy it stops being loud —
// the second cadence gets past `manifest()` and `wallet()` into the `for(;;)` loop and sends
// `pushWindow`/`think`/`endSeason` from whatever process imported it, racing the real
// cadence for nonces. `monitor.ts` wanting exactly that import is what surfaced this.
//
// Compared on REALPATH, not `import.meta.url` against `process.argv[1]` as a string: on
// Windows those two can differ in drive-letter or directory casing alone, and the compare
// would then be false — failing in the one direction that must never happen quietly, the
// cadence declining to start and exiting 0. `realpathSync` returns the filesystem's own
// casing for both sides, so they agree unless the file genuinely differs.
const invokedDirectly = (() => {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv1);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    console.error(`[${stamp()}] FATAL`, describe(err));
    process.exit(1);
  });
}
