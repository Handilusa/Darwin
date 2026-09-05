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

/** How long to wait for validator responses before committing on whatever arrived. */
const INFERENCE_PATIENCE = num("CADENCE_INFERENCE_PATIENCE", 330);

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
 *  `windowCount` is incremented in `think()` (`Population.sol:1151`), not in
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

  const hash = await send(client, {
    address: m.population,
    abi: populationAbi,
    functionName: "think",
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
  const patienceEndsAt = Math.floor(Date.now() / 1000) + INFERENCE_PATIENCE;

  for (;;) {
    const now = Math.floor(Date.now() / 1000);
    const pending = await pendingThinkers(m);

    if (pending.length === 0) {
      log(`all beliefs in (${await beliefSummary(m)})`);
      break;
    }
    if (deadline !== undefined && now >= deadline) {
      warn(`committing at the deadline with ${pending.length} organism(s) still thinking: ${pending.join(", ")}`);
      break;
    }
    if (now >= patienceEndsAt) {
      warn(`inference patience exhausted with ${pending.length} still pending: ${pending.join(", ")}`);
      break;
    }

    await sleep(POLL);
  }

  // An organism with no consensus answer opens a zero-size position and is scored as an
  // abstain. That is the intended mechanic, not a failure: it failed to think, it acts
  // on nothing, and it still pays metabolism.
  const hash = await send(client, {
    address: m.population,
    abi: populationAbi,
    functionName: "commitAll",
  });
  log(`commit · ${explorerTx(hash)}`);
  await reportStragglers(m, hash, "commit");
  return true;
}

/** Seconds-since-epoch by which the commitment must land, from the market's own expiry. */
async function commitDeadline(m: Manifest): Promise<number | undefined> {
  const marketId = await read(m, "activeMarketId");
  if (marketId === "0x0000000000000000000000000000000000000000000000000000000000000000") return undefined;
  const rec = await publicClient.readContract({
    address: m.marketsModule,
    abi: marketsModuleAbi,
    functionName: "markets",
    args: [marketId as Hex],
  });
  const expiry = Number(rec[13]);
  return expiry - COMMIT_LEAD;
}

/** Ids of living organisms whose inference request has not come back yet. */
async function pendingThinkers(m: Manifest): Promise<number[]> {
  const snap = await read(m, "snapshot");
  const out: number[] = [];
  for (const o of snap) {
    if (o.dead) continue;
    const pending = await publicClient.readContract({
      address: o.addr,
      abi: prophetAbi,
      functionName: "pendingBeliefRequestId",
    });
    if (pending !== 0n) out.push(Number(o.id));
  }
  return out;
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

  const hash = fallbackOpen
    ? await send(client, { address: m.selectionEngine, abi: selectionEngineAbi, functionName: "poke" })
    : await send(client, { address: m.population, abi: populationAbi, functionName: "settleAll" });

  log(`settle${voided ? " (voided)" : ""} via ${fallbackOpen ? "SelectionEngine.poke" : "settleAll"} · ${explorerTx(hash)}`);
  // Works on both branches: `poke()` calls `settleAll` internally, so Population's own
  // logs are in this receipt either way — the filter is on the emitter, not the callee.
  await reportStragglers(m, hash, "settle");
  await reportDeaths(m);
  await hatch(m, client);
  return true;
}

/*//////////////////////////////////////////////////////////////
                        BIRTHS — hatchAll
//////////////////////////////////////////////////////////////*/

/**
 *  Children whose mutation consensus arrived are born here. One transaction, best effort.
 *
 *  A SEPARATE TRANSACTION FROM SETTLEMENT, ON PURPOSE, AND THAT IS THE CONTRACT'S
 *  DECISION RATHER THAN THIS SCRIPT'S. `hatchAll` is the one driver call with no
 *  `inPhase` modifier (`Population.sol:1593`) precisely so a mutation inference that is
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
    const hash = await send(client, { address: m.population, abi: populationAbi, functionName: "hatchAll" });
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
 *  `endSeason`'s own guard, in TypeScript.
 *
 *  Exported and pure so the comparison can be exercised without a chain — it is the one
 *  piece of this file that is arithmetic rather than plumbing, and the arithmetic is
 *  where an off-by-one would cost a whole season. `scripts/lib/season.test.ts` does not
 *  exist; the check lives at the bottom of this file behind `--self-test`, which needs
 *  no RPC, no key and no deployment.
 *
 *  MIRRORS `Population.sol:940` EXACTLY (verified against that line, not remembered),
 *  including the subtraction order:
 *
 *      if (windowCount - seasonStartWindow < seasonWindows) revert SeasonNotOver();
 *
 *  so `>=` here is `!<` there. Written as `count - start >= windows` rather than the
 *  more readable `count >= start + windows` on purpose: the on-chain expression
 *  underflows and reverts if `start` ever exceeds `count`, and a local predicate that
 *  quietly returned `false` where the contract reverts would be a different function.
 *  `bigint` throughout — `windowCount` is a `uint64` and viem hands it over as a
 *  `bigint`, while `seasonWindows` is a `uint32` and arrives as a `number`, so the
 *  widening is explicit at the call site rather than accidental here.
 */
export function seasonIsOver(windowCount: bigint, seasonStartWindow: bigint, seasonWindows: bigint): boolean {
  // A `seasonWindows` of zero would make every window a season boundary. `setSeason`
  // rejects it (`BadSeason`) and `initialize` sets 24, so this is only reachable on a
  // proxy upgraded from a build that predates the field — the same case `level()` guards.
  // Treat it as "no season configured" and never close.
  if (seasonWindows === 0n) return false;
  if (windowCount < seasonStartWindow) return false;
  return windowCount - seasonStartWindow >= seasonWindows;
}

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
 *  (`Population.sol:981`/`971`, with `seasonId += 1` after the emit), so the season
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

  log(`phase ${PHASE[Number(await read(m, "phase"))] ?? "?"} · window #${await read(m, "windowCount")}`);
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
