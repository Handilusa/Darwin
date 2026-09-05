/**
 *  Soak monitor. Runs from the go-live to submission.
 *
 *    npm run monitor              # forever, one status line per poll
 *    npm run monitor -- --once    # one check; exit code 1 if anything is wrong (cron)
 *
 *  WHAT IT IS ACTUALLY WATCHING FOR. The dangerous failures in this system are all
 *  quiet. An organism out of native STT does not crash — it fails to think, abstains,
 *  pays metabolism, and dies on schedule, producing a beautifully consistent record of
 *  nothing happening. A wedged phase does not crash either; it just stops advancing.
 *  Nothing here alerts on an exception, because the exceptions are not the problem: it
 *  alerts on the absence of progress.
 *
 *  AND IT WATCHES THE ORGANISMS' BALANCES, NOT POPULATION'S. Since organisms pay for
 *  their own cognition, the contract's own native balance is not the runway — it only
 *  funds births. A monitor pointed at it would have reported months of runway while
 *  every organism starved, which is the exact failure this file exists to catch.
 *
 *  AND IT WATCHES THE SEASON BOUNDARY, WHICH FAILS WITHOUT A SYMPTOM. Every other failure
 *  in here eventually stops something: a wedged phase stops advancing, a starved organism
 *  stops thinking. A season that is over and that nobody closes stops NOTHING. The windows
 *  keep trading, the ante keeps escalating past the season it was scaled for, and the prize
 *  pool sits there owed to entrants who were promised it at the door. There is no stall to
 *  find, so it is found as an overshoot: how many windows have opened since the boundary
 *  the closer should have acted on.
 */
import {
  BELIEF,
  PHASE,
  THESIS,
  fmt,
  labels,
  log,
  manifest,
  num,
  populationAbi,
  prophetAbi,
  publicClient,
  sleep,
  warn,
  type Manifest,
} from "./lib/darwin.js";
import { erc20Abi } from "./lib/darwin.js";
import type { Address, Hex } from "viem";

const INTERVAL = num("MONITOR_INTERVAL", 60) * 1000;
/** Longer than one 15-minute window, so a normal window does not read as a stall. */
const PHASE_STALL = num("MONITOR_PHASE_STALL", 1_200);
const WINDOW_STALL = num("MONITOR_WINDOW_STALL", 2_400);
const MIN_RUNWAY = num("MONITOR_MIN_RUNWAY", 96);

/**
 *  How many voided windows one organism may accumulate before that is a fault.
 *
 *  A void is the one settlement outcome that moves NO counter. `Prophet.settleWindow`
 *  advances `windowsLived` unconditionally and then takes exactly one of three
 *  branches — abstain, correct, wrong — so a window that was played with a real
 *  position and graded as neither leaves the three counters untouched. Nothing else
 *  in either contract writes them (four increment sites, all in that one function),
 *  which is what makes `windowsLived - (correct + wrong + abstain)` an exact void
 *  count rather than an estimate.
 *
 *  IT IS ALSO THE ONLY SIGNAL A VOID LEAVES OFF-CHAIN. `DirectDuelVenue` emits
 *  `DuelUnadjudicable` and calls it "the one to alert on" at its declaration, but a
 *  void is not a revert, so it fires no `SettleFailed`; check 5 below cannot see one
 *  either, because a void has `currentQuantity > 0` by definition. A population that
 *  voids every window looks perfectly healthy by every other check in this file:
 *  windows open, positions pair, organisms pay metabolism and die on schedule — and
 *  no forecast is ever graded, so selection is not happening at all. That is the
 *  failure this exists to catch, and it is silent in a way a stall is not.
 *
 *  NOT ZERO: a flat print voids honestly (`DirectDuelVenue._resolve`), and so does a
 *  settlement that lands with no attributable price. One is weather. Two on the same
 *  organism is the feed.
 */
const VOID_GRACE = num("MONITOR_VOID_GRACE", 1);

/**
 *  How many windows a finished season may stay open before that is a fault.
 *
 *  WINDOWS, NOT SECONDS — the only threshold in this file that is not a clock, and
 *  deliberately so. An unclosed season is only a live fault while the population is still
 *  opening windows past its boundary; a population that stopped is already owned by the
 *  two stalls above. Counting windows also means this check holds nothing across polls, so
 *  a monitor restarted in the middle of the fault alerts on its first poll instead of
 *  restarting a patience timer the way a seconds-based threshold would.
 *
 *  NOT ZERO, for two mechanical reasons rather than taste. `windowCount` moves inside
 *  `think()`, so the final window of a season becomes "over" the moment it opens and the
 *  closer reaches it on its next tick seconds later: an overshoot of 0 is the ordinary
 *  in-flight state at every boundary. An overshoot of 1 is also reachable with nothing
 *  wrong — `maybeEndSeason` swallows a transient RPC error (`cadence.ts:573`) and `step()`
 *  then goes on to open the next window, so one blip at the boundary costs exactly one
 *  window and the tick after it closes the season. Two windows past the boundary means two
 *  consecutive ticks failed to close, which no transient explains. Set it to 0 to alert on
 *  the first missed close.
 */
const SEASON_GRACE = num("MONITOR_SEASON_GRACE", 1);

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

type Seen = { phase: number; window: bigint; at: number };

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const m = manifest();
  const names = labels(m.chainId);
  let seen: Seen | undefined;
  let worst = 0;

  for (;;) {
    try {
      const { alerts, next } = await check(m, names, seen);
      seen = next;
      worst = Math.max(worst, alerts);
    } catch (err) {
      warn(err instanceof Error ? err.message : String(err));
      worst = Math.max(worst, 1);
    }
    if (once) break;
    await sleep(INTERVAL);
  }

  if (once && worst > 0) process.exitCode = 1;
}

async function check(m: Manifest, names: Map<number, string>, seen: Seen | undefined) {
  const now = Math.floor(Date.now() / 1000);

  const [phaseRaw, windowRaw, alive, deposit, native, endow, coll, snapRaw] = await Promise.all([
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "phase" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "windowCount" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "aliveCount" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "requestDeposit" }),
    publicClient.getBalance({ address: m.population }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "cognitionEndowment" }),
    publicClient.readContract({
      address: m.collateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [m.population],
    }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "snapshot" }),
  ]);

  /*
   *  THE SEASON GROUP IS SEVEN MORE READS, NOT A FIELD OF `snapshot()`. `snapshot()` is
   *  sixteen per-ORGANISM fields (`Population.sol:1602`) and carries nothing about the
   *  season, so there is no free ride here.
   *
   *  A SECOND BATCH RATHER THAN SEVEN MORE ENTRIES IN THE FIRST, and this is not style.
   *  Folded into the batch above it makes a fifteen-element `Promise.all` over viem's
   *  generics, and at that width TypeScript's inference stops being dependable: the same
   *  file typechecked clean, then reported `windowRaw` — the line above, untouched for
   *  months — as a `number` being cast to `bigint`. Whatever the exact limit is, a batch
   *  wide enough to reach it silently widens the casts BELOW it, which is the mechanism
   *  those casts exist to catch. Two batches of eight and seven each infer exactly.
   *
   *  It costs one more round trip and buys nothing in consistency either way: these are
   *  separate `eth_call`s at "latest" whether they share a `Promise.all` or not, so a season
   *  that closes mid-poll can pair a fresh `seasonStartWindow` with a stale `windowCount`
   *  regardless. That skew can only shrink the overshoot, so it may silence one poll and can
   *  never invent an alert.
   */
  const [seasonIdRaw, startRaw, lenRaw, poolRaw, rakeRaw, anteRaw, levelRaw] = await Promise.all([
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "seasonId" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "seasonStartWindow" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "seasonWindows" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "prizePool" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "rakeAccrued" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "ante" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "level" }),
  ]);

  const phase = Number(phaseRaw);
  const window = windowRaw as bigint;
  const snap = snapRaw as readonly Snapshot[];
  const living = snap.filter((o) => !o.dead);

  // THE WIDTHS ARE VIEM'S, NOT A PREFERENCE, and the casts are here so `tsc` checks them:
  // uint8..uint48 decode to `number` and uint56 upward to `bigint`, so `seasonId`/
  // `seasonWindows`/`level` (uint32) arrive as numbers while `seasonStartWindow` (uint64)
  // and the two books (uint256) arrive as bigints. Same boundary `cadence.ts:749` documents;
  // getting it wrong here would produce a `bigint - number` that does not compile, which is
  // the point of writing it out rather than reaching for `Number()`.
  const seasonId = seasonIdRaw as number;
  const startWindow = startRaw as bigint;
  const seasonWindows = lenRaw as number;
  const pool = poolRaw as bigint;
  const rake = rakeRaw as bigint;
  const ante = anteRaw as bigint;
  const level = levelRaw as number;

  // Windows into the season, and windows past its end. `overshoot` is `undefined` where the
  // season has no boundary to be past, mirroring both guards in `cadence.ts:495`: a
  // `seasonWindows` of 0 is an unconfigured season rather than one that ends every window,
  // and a `seasonStartWindow` ahead of `windowCount` is the read that underflows on chain.
  const seasonLen = BigInt(seasonWindows);
  const elapsed = window < startWindow ? 0n : window - startWindow;
  const overshoot = seasonLen > 0n && window >= startWindow ? elapsed - seasonLen : undefined;

  // RUNWAY IS PER ORGANISM, NOT PER POPULATION. Each organism pays its own inference
  // deposits out of its own native balance, so Population's balance says nothing about
  // whether anybody can think — it only says whether the next CHILD can. Averaging
  // across organisms would hide the failure too: the population does not stop when the
  // total runs low, it stops one organism at a time, and the minimum is the one that
  // is about to go quiet. So poll the organisms and rank them.
  const dep = deposit as bigint;
  const runways = await Promise.all(
    living.map(async (o) => {
      const bal = await publicClient.getBalance({ address: o.addr });
      return { o, bal, windows: dep === 0n ? 0n : bal / dep };
    }),
  );
  const runwayOf = new Map(runways.map((r) => [r.o.addr, r.windows]));
  const cognition = runways.reduce((sum, r) => sum + r.bal, 0n);
  const worstRunway = runways.reduce((lo, r) => (r.windows < lo ? r.windows : lo), runways[0]?.windows ?? 0n);
  const generations = snap.length === 0 ? 0 : Math.max(...snap.map((o) => o.generation));

  log(
    `phase ${PHASE[phase] ?? phase} · window #${window} · season ${seasonId} ${elapsed}/${seasonWindows} · ` +
      `alive ${living.length}/${snap.length} · gen ${generations} · ` +
      `runway ${worstRunway}w worst / ${fmt(cognition, 18, 3)} STT held · ` +
      `ante ${fmt(ante, m.collateralDecimals, 2)} · ` +
      `${fmt(coll, m.collateralDecimals, 2)} tUSDC (pool ${fmt(pool, m.collateralDecimals, 2)})`,
  );

  let alerts = 0;
  const alert = (msg: string) => {
    alerts++;
    console.error(`ALERT ${msg}`);
  };

  /* 1. Extinction. Not a bug — but the run is over and it needs a human. */
  if (living.length === 0 && snap.length > 0) {
    alert(`the population is EXTINCT after ${window} windows. Reseed or accept it as the result.`);
  }

  /* 2. A phase that has not moved. */
  if (seen && seen.phase === phase && seen.window === window) {
    const stuckFor = now - seen.at;
    if (stuckFor > PHASE_STALL) {
      alert(
        `phase has been ${PHASE[phase] ?? phase} for ${stuckFor}s. The cadence is down, or a ` +
          `driver call is reverting. Check the cadence log; forcePhase(0) as a last resort.`,
      );
    }
  }
  if (seen && seen.window === window && now - seen.at > WINDOW_STALL) {
    alert(`window #${window} has not advanced in ${now - seen.at}s — no new forecasts are being made.`);
  }

  /* 3. Cognition runway. The quiet killer — now per organism, because that is who pays. */
  const starving = runways.filter((r) => r.windows < BigInt(MIN_RUNWAY));
  if (starving.length > 0) {
    const who = starving
      .sort((a, b) => (a.windows < b.windows ? -1 : 1))
      .map((r) => `#${r.o.id}${label(names, r.o.id)} ${r.windows}w`)
      .join(", ");
    alert(
      `${starving.length} organism(s) under ${MIN_RUNWAY} windows of inference runway: ${who}. ` +
        `An organism that cannot think abstains and still pays metabolism, so this is a death ` +
        `sentence on a timer. Run: npm run fund -- --windows 400`,
    );
  }

  /* 3b. The house float. Not what pays for thinking — what pays for being BORN. */
  if (native < (endow as bigint)) {
    alert(
      `Population holds ${fmt(native, 18, 4)} STT, under one cognitionEndowment ` +
        `(${fmt(endow as bigint, 18, 4)}). The next child is born brain-dead and needs a manual ` +
        `topUpCognition. Run: npm run fund -- --house 5`,
    );
  }

  /* 3c. The two population counters must agree. A drift is a bookkeeping bug, not attrition. */
  if ((alive as bigint) !== BigInt(living.length)) {
    alert(
      `aliveCount is ${alive} but snapshot shows ${living.length} undead organisms. The counter ` +
        `and the living index have drifted — settleAll's reap path is the only place both move.`,
    );
  }

  /* 4. Requests that never came back. */
  if (phase !== 1) {
    const stuck: string[] = [];
    for (const o of living) {
      const pending = await publicClient.readContract({
        address: o.addr,
        abi: prophetAbi,
        functionName: "pendingBeliefRequestId",
      });
      if (pending !== 0n) stuck.push(`#${o.id}${label(names, o.id)} (request ${pending})`);
    }
    if (stuck.length > 0) {
      alert(`inference never returned for ${stuck.join(", ")} — a timed-out request scores as an abstain.`);
    }
  }

  /* 5. A window in which nobody actually took a position. */
  if (phase === 2 && living.length > 0) {
    let withPosition = 0;
    for (const o of living) {
      const q = await publicClient.readContract({
        address: o.addr,
        abi: prophetAbi,
        functionName: "currentQuantity",
      });
      if (q > 0n) withPosition++;
    }
    if (withPosition === 0) {
      alert(
        `window #${window} has zero real positions. Every organism was unpaired or abstained — ` +
          `if this repeats, the genomes have converged and there is no counterparty left to pair against.`,
      );
    }
  }

  /*
   *  5b. WINDOWS THAT WERE PLAYED AND NEVER GRADED. See `VOID_GRACE` above for why
   *  this arithmetic is exact and why no other check in this file can see it.
   *
   *  Costs nothing: all four counters are already fields of `snapshot()`, so this
   *  adds no reads. Reported per organism rather than as a population total, because
   *  a total cannot tell "the feed is misaligned for everyone" from "one organism
   *  keeps drawing the flat print", and those have different remedies.
   */
  const voided = living
    .map((o) => ({ o, n: o.windowsLived - (o.correctCount + o.wrongCount + o.abstainCount) }))
    .filter((v) => v.n > VOID_GRACE);
  if (voided.length > 0) {
    const worst = voided.map((v) => `#${v.o.id}${label(names, v.o.id)} (${v.n})`).join(", ");
    alert(
      `${voided.length} organism(s) have more than ${VOID_GRACE} VOIDED window(s): ${worst}. A void ` +
        `pays both sides back and grades nobody, so these windows cost metabolism and produced no ` +
        `fitness signal — selection is running on fewer windows than the population has lived. On the ` +
        `duel arena that is DuelUnadjudicable: the closing price could not be attributed to the ` +
        `window the duel opened in, which is a cadence problem (settle is landing after the next ` +
        `pushWindow) or a stale feed, not an organism problem. On the DreamDEX arena it is a market ` +
        `that resolved void. Check that pushWindow and settleAll are hitting the same market.`,
    );
  }

  /*
   *  6. THE HOUSE FLOAT, WHICH IS NOT THE WHOLE BALANCE.
   *
   *  This check used to read `coll < endowment` and warn that "the next birth will revert".
   *  Both halves were wrong once seasons landed, and they were wrong in the dangerous
   *  direction — the alert goes QUIET as the arena gets closer to trouble.
   *
   *  Wrong predicate: `prizePool` and `rakeAccrued` are claims on this same balance (see
   *  `Population.sol`'s "THE TWO BOOKS"), so a growing pot makes `coll` grow and pushes the
   *  comparison further from firing precisely as the free float drains. What is spendable is
   *  the balance MINUS both books, and nothing else.
   *
   *  Wrong diagnosis: a birth cannot revert for lack of house collateral. `_hatch` pulls the
   *  child's endowment out of the PARENT (`Population.sol:1495`) and `_spawn` pays the same
   *  amount straight back out, so a hatch is net-neutral here by construction; `enter` has
   *  already pulled the entrant's own in. `spawnGenesis` is the one birth that spends the
   *  house's collateral, and it runs once, under the operator's hand, at seed.
   *
   *  So this is now a float check, one endowment ahead of the state 7b calls unpayable: it
   *  fires while there is still room to act, and 7b fires when the books have already
   *  overdrawn the balance. Deliberately NOT folded into 7b — different remedies deserve
   *  different alerts, and a single threshold would have to pick one of them to report.
   */
  const endowment = await publicClient.readContract({
    address: m.population,
    abi: populationAbi,
    functionName: "endowment",
  });
  const free = coll > pool + rake ? coll - pool - rake : 0n;
  if (free < endowment) {
    alert(
      `Population's FREE collateral is ${fmt(free, m.collateralDecimals, 2)} tUSDC — under one ` +
        `endowment (${fmt(endowment, m.collateralDecimals, 2)}). It holds ` +
        `${fmt(coll, m.collateralDecimals, 2)} but ${fmt(pool, m.collateralDecimals, 2)} is the prize ` +
        `pool and ${fmt(rake, m.collateralDecimals, 2)} is rake, and neither is the house's to spend. ` +
        `Nothing breaks this window — births are funded by the parent — but the float that covers a ` +
        `sweep() shortfall and any further spawnGenesis is gone, and one more endowment of drift puts ` +
        `the pot beyond what this balance can pay. Run: npm run fund -- --collateral 200`,
    );
  }

  /*
   *  7. A SEASON THAT IS OVER AND STILL OPEN. The one cadence job that fails quietly.
   *
   *  REPORTED AS AN OVERSHOOT, NOT AS A REVERT, and that is the whole design of this check.
   *  `maybeEndSeason` already logs every `endSeason:` failure it meets and then keeps the
   *  population trading, exactly as intended, so the revert is not the scarce signal — a
   *  monitor waiting for an exception would call a healthy population one that never closes
   *  a season because nothing ever errors: a cadence built without the season branch, a
   *  driver being run by hand, a process wedged before the check, a `--once` cron that
   *  stopped being scheduled. What is common to all of those is an absence, so an absence is
   *  what is measured: windows opened since the boundary the closer should have acted on.
   *
   *  THE BOUNDARY IS `Population.sol:834` — `windowCount - seasonStartWindow < seasonWindows`
   *  reverts `SeasonNotOver` — and `cadence.ts:495`'s exported `seasonIsOver` is the closer's
   *  copy of it. This check SHOULD import that predicate and deliberately does not, for one
   *  reason worth knowing before anyone "fixes" it: `cadence.ts` calls `main()` at module
   *  scope (`cadence.ts:879`) with no entry-point guard, so `import { seasonIsOver } from
   *  "./cadence.js"` starts a SECOND CADENCE inside the monitor process. Verified rather than
   *  assumed — the import today dies inside the cadence's own `manifest()` and takes the
   *  monitor's process down with it (`process.exit(1)`), and once a deployment exists it
   *  would instead reach `wallet()` and drive the population from in here, racing the real
   *  cadence for nonces. One entry-point guard around that call — the usual `import.meta.url`
   *  against `process.argv[1]` — or moving the predicate down into `scripts/lib/` makes the
   *  import safe, and at that point the gate below becomes
   *  `seasonIsOver(window, startWindow, seasonLen)` and the overshoot stays only as the
   *  number in the message. Until then the two guards above are written to mirror it exactly.
   */
  if (overshoot !== undefined && overshoot > BigInt(SEASON_GRACE)) {
    alert(
      `season ${seasonId} has been over since window #${startWindow + seasonLen} and is still open ` +
        `${overshoot} window(s) later. ${fmt(pool, m.collateralDecimals, 2)} tUSDC of prize money is ` +
        `owed to entrants and nothing is paying it out, and the ante keeps escalating past the season ` +
        `it was scaled for (level ${level}, ante now ${fmt(ante, m.collateralDecimals, 2)}) because ` +
        `endSeason is what resets it. The cadence's season branch is not running or its send is ` +
        `failing — check the cadence log for "endSeason:". It is permissionless, so any funded ` +
        `address can close it: npm run cadence:once`,
    );
  }

  /* 7b. The two books against the balance. A pot that cannot be paid is a season that cannot close. */
  if (pool + rake > coll) {
    alert(
      `the books claim ${fmt(pool + rake, m.collateralDecimals, 2)} tUSDC ` +
        `(${fmt(pool, m.collateralDecimals, 2)} prize pool + ${fmt(rake, m.collateralDecimals, 2)} rake) ` +
        `but Population holds ${fmt(coll, m.collateralDecimals, 2)}. endSeason pays the pot 60/30/10 out ` +
        `of this balance, so the close reverts TransferFailed as soon as a winner's share exceeds what ` +
        `is actually here, and the season can then never close. No settlement path can do this — rent, ` +
        `rake and a corpse's residue are all transferred in before either book is credited, and a ` +
        `child's endowment comes from its parent. Since 2026-09-05 sweep() cannot do it either: its ` +
        `collateral leg is capped at balance - (rake + pool) and reverts BooksReserved. So this alert ` +
        `should now be unreachable, and it is kept precisely for that reason — an unreachable alert ` +
        `that fires is telling you the cap is not doing what the contract says. Put the collateral ` +
        `back either way: npm run fund -- --collateral <shortfall>`,
    );
  }

  if (alerts === 0) roll(snap, names, m.collateralDecimals, runwayOf);

  const advanced = seen === undefined || seen.phase !== phase || seen.window !== window;
  return {
    alerts,
    next: { phase, window, at: advanced ? now : seen.at },
  };
}

/** One compact line per organism, only when nothing is wrong. */
function roll(
  snap: readonly Snapshot[],
  names: Map<number, string>,
  decimals: number,
  runwayOf: Map<Address, bigint>,
): void {
  for (const o of snap) {
    const id = Number(o.id);
    const state = o.dead ? `dead@${o.deathWindow}` : `${BELIEF[o.belief] ?? "?"}/${THESIS[o.thesis] ?? "?"}`;
    // Two currencies, two lifelines: treasury is what it stakes and eats, runway is how
    // many more times it can afford to think. Either hitting zero ends the organism, so
    // the roll shows both or it is not a health check.
    const runway = o.dead ? "  —" : `${runwayOf.get(o.addr) ?? 0n}w`;
    console.log(
      `    #${String(id).padStart(2)}${label(names, o.id).padEnd(11)} gen${o.generation} ` +
        `${o.correctCount}-${o.wrongCount}-${o.abstainCount} streak${o.streak} ` +
        `${fmt(o.treasury, decimals, 2).padStart(8)} ${runway.padStart(5)}  ${state}`,
    );
  }
}

const label = (names: Map<number, string>, id: bigint) => {
  const n = names.get(Number(id));
  return n ? ` ${n}` : "";
};

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
