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
  priceSourceAbi,
  prophetAbi,
  publicClient,
  sleep,
  warn,
  type Manifest,
} from "./lib/darwin.js";
import { erc20Abi } from "./lib/darwin.js";
// The closer's own boundary, not a copy of it. `lib/season.ts` imports nothing, which is the
// whole reason the predicate moved there out of `cadence.ts` — see alert 7's note.
import { seasonOvershoot } from "./lib/season.js";
// Same contract, other half. `lib/commit.ts` is where the cadence's commit floor lives; this
// process imports the DETECTOR from it rather than restating the rule — see alert 5's note.
import { committedBlind } from "./lib/commit.js";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { parseAbi, type Address, type Hex } from "viem";

const failureEventsAbi = parseAbi([
  "event ThinkFailed(uint256 indexed prophetId)",
  "event CommitFailed(uint256 indexed prophetId)",
  "event SettleFailed(uint256 indexed prophetId)",
  "event ReapDeferred(uint256 indexed prophetId, uint256 residue)",
]);

const reactionFailedAbi = parseAbi([
  "event ReactionFailed(address indexed emitter, uint256 blockNumber, bytes reason)",
]);

const beaconAbi = parseAbi([
  "function implementation() view returns (address)",
]);

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
 *  wrong — `maybeEndSeason` swallows a transient RPC error (`cadence.ts:845`) and `step()`
 *  then goes on to open the next window, so one blip at the boundary costs exactly one
 *  window and the tick after it closes the season. Two windows past the boundary means two
 *  consecutive ticks failed to close, which no transient explains. Set it to 0 to alert on
 *  the first missed close.
 */
const SEASON_GRACE = num("MONITOR_SEASON_GRACE", 1);

/**
 *  How many newborns the house float must still be able to endow.
 *
 *  CHILDREN, NOT STT, because the float is only ever spent one `cognitionEndowment` at a
 *  time: `_houseCognition()` returns the endowment or zero, never a fraction, so the useful
 *  question is how many more births the balance covers. That is `native / endow` — the same
 *  division `fund.ts`'s report prints as "N more children".
 *
 *  NOT 1, and this is the whole point of the threshold. Until 2026-09-06 check 3b compared
 *  `native < endow`, which is the arithmetic of a house that bears one child at a time. The
 *  house does not: `spawnGenesis` loops over eight genomes and calls `_houseCognition()`
 *  once per iteration, re-reading `address(this).balance` each time, and the guard inside it
 *  returns 0 the moment the balance falls under one endowment. There is no revert and no
 *  event on that path — founders #2..#8 are simply born with no cognition — so a float
 *  holding 1.5 endowments passed the old check as HEALTHY while seven of eight founders came
 *  out brain-dead, and the first symptom was seven `ThinkFailed`s a window later.
 *
 *  8 covers that genesis case with the population's own number: `maxPopulation` is larger,
 *  but births after genesis come one at a time out of the PARENT's balance
 *  (`_hatch` → `parent.drawCognition`), and `enter` pays its own way, so the house float's
 *  only multi-child obligation is the founding loop. Raise it if you intend to seed more.
 */
const MIN_BIRTHS = num("MONITOR_MIN_BIRTHS", 8);

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

export type Seen = { phase: number; window: bigint; at: number; block?: bigint };

/*//////////////////////////////////////////////////////////////
                        PERSISTED OBSERVATION
//////////////////////////////////////////////////////////////*/

/**
 *  Where the last observation is remembered, and why remembering it is the whole point.
 *
 *  `--once` IS THE MODE THAT NEEDED THIS, AND IT WAS THE MODE THAT COULD NOT ALERT. `seen`
 *  was a process-local `let`, initialised `undefined`; both stall alerts open with
 *  `if (seen && …)`; and `--once` breaks after one poll. So the two checks whose entire
 *  purpose is detecting an absence of progress were unreachable in the only mode built to run
 *  unattended. A cadence that died three days ago produced one healthy-looking status line,
 *  zero alerts, and exit code 0, on every cron tick, forever — and the cron was installed
 *  precisely so that nobody had to watch. That is worse than having no monitor: an operator
 *  reads the green exit code as evidence.
 *
 *  A FILE, NOT A LONGER-LIVED PROCESS. The alternative is to say "run the daemon instead",
 *  which is not a fix — `--once` is documented at the top of this file, wired as
 *  `npm run monitor -- --once`, and a daemon is the thing whose death this is supposed to
 *  catch. A tiny JSON file is the smallest thing that makes the two alerts mean what they say.
 *
 *  ## Where
 *
 *  `.darwin/monitor-state.json`, under the repo root as the process sees it (`process.cwd()`,
 *  the same base `manifest()` resolves from, so both agree about which checkout they are in).
 *  `.gitignore` covers `.darwin/` as of the same change; state is never committed. It is
 *  overridable with `MONITOR_STATE` for the case an operator runs two monitors from one
 *  checkout, and settable to `-` to opt out entirely and get the old volatile behaviour back.
 *
 *  ## Keyed by chain id AND population address
 *
 *  Not by file path, and not by chain id alone. Two deployments on Shannon share a chain id,
 *  and `Deploy.s.sol` can be run again — a redeploy is a fresh `Population` at a fresh
 *  address with `windowCount` back at 0. A state file keyed only by chain would then hand the
 *  new population an observation from the old one, whose window number is higher and whose
 *  timestamp is days old, and the stall predicate would fire on the first poll of a perfectly
 *  healthy arena. A false stall alert is not a harmless one: it is how an operator learns that
 *  this file's alerts are noise, and after that the real stall arrives to a reader who has
 *  stopped looking. So observations are stored per `<chainId>:<population>` and a key that is
 *  not there is a first observation, which is exactly what it is.
 *
 *  ## Every failure degrades to "first observation"
 *
 *  Missing, unreadable, malformed JSON, right JSON with the wrong shape, a `window` that is
 *  not a decimal string — all of it returns `undefined` and none of it throws. The monitor's
 *  job is to keep running when everything else has stopped; a monitor that crashes on its own
 *  cache is the least useful possible outcome. The cost of degrading is one poll's worth of
 *  patience, which is why it is the right trade in every one of those cases.
 *
 *  `window` is written as a STRING because `JSON.stringify` throws on a `bigint` — not a
 *  style choice, and the read side parses it back with a guard rather than `BigInt()` bare,
 *  which throws on anything non-numeric.
 */
const STATE_DEFAULT = ".darwin/monitor-state.json";

/**
 *  Resolved per call, not captured at module scope, and that is a testability decision.
 *
 *  Read once into a `const` this would be fixed by the time any test could touch it, so the
 *  self-test would have to either write into the operator's real state file — corrupting the
 *  baseline of a live monitor to prove that corruption is survivable — or not exercise the file
 *  layer at all, which is the layer #46 turns on. Reading `process.env` here lets the self-test
 *  point it at a temp file and put it back. The cost is an `env` lookup and a `resolve` per poll,
 *  once a minute.
 */
function statePath(): string {
  const env = process.env.MONITOR_STATE;
  return resolve(process.cwd(), env && env !== "-" ? env : STATE_DEFAULT);
}

/** `MONITOR_STATE=-` opts out entirely and restores the old volatile behaviour. */
const stateDisabled = (): boolean => process.env.MONITOR_STATE === "-";

/**
 *  How old an observation may be before its own age is reported.
 *
 *  A STALE STATE FILE IS SIGNAL, NOT JUST A BASELINE. The stall alerts compare `now - seen.at`
 *  against a threshold in the low thousands of seconds, so a state file from last week fires
 *  them — correctly, if the population really has been stuck since then. But there is a second
 *  reading, and it is the more likely one: the MONITOR has not run since then. A cron that
 *  stopped being scheduled, a machine that was rebooted, a container that never came back.
 *  That failure is invisible to every other check in this file, because a monitor that is not
 *  running cannot alert about itself — the only trace it leaves is the age of what it last
 *  wrote, which the next run holds in its hand.
 *
 *  So the age is reported as a distinct line, and only above a threshold well clear of a
 *  normal gap: a daemon writes every `MONITOR_INTERVAL` (60s) and a cron typically every few
 *  minutes, so six hours cannot be a schedule and can only be an outage. Reported rather than
 *  alerted, because it is a statement about the observer and not about the population — the
 *  population's own state is read fresh every poll and judged on its own alerts.
 */
const STATE_STALE_AFTER = num("MONITOR_STATE_STALE", 21_600);

type StateFile = { observations?: Record<string, { phase?: unknown; window?: unknown; at?: unknown }> };

/** `<chainId>:<population>`, lowercased — see the docblock above for why both halves. */
export function stateKey(chainId: number, population: string): string {
  return `${chainId}:${population.toLowerCase()}`;
}

/**
 *  Parse one stored observation, or `undefined` for anything that is not one.
 *
 *  Separated from the file read so the self-test can drive it with hand-built objects, and
 *  narrow rather than trusting: `noUncheckedIndexedAccess` is on, the file is untrusted input
 *  from a previous process that may have been a different version, and a `NaN` `at` would make
 *  `now - seen.at` a `NaN` that silences both stall alerts without a word.
 */
export function parseSeen(raw: unknown): Seen | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const phase = o["phase"];
  const window = o["window"];
  const at = o["at"];
  if (typeof phase !== "number" || !Number.isFinite(phase)) return undefined;
  if (typeof at !== "number" || !Number.isFinite(at)) return undefined;
  // Written as a decimal string, and only a decimal string is accepted: `BigInt("0x10")`
  // succeeds and would silently reinterpret a hex window, `BigInt("")` returns 0n, and
  // `BigInt("nope")` throws inside the poll.
  if (typeof window !== "string" || !/^\d+$/.test(window)) return undefined;
  const blockRaw = o["block"];
  const block = typeof blockRaw === "string" && /^\d+$/.test(blockRaw) ? BigInt(blockRaw) : undefined;
  return { phase, window: BigInt(window), at, ...(block !== undefined ? { block } : {}) };
}

/** The whole file, or an empty record. Never throws — see the docblock above. */
function readStateFile(): StateFile {
  try {
    const parsed: unknown = JSON.parse(readFileSync(statePath(), "utf8"));
    if (parsed === null || typeof parsed !== "object") return {};
    return parsed as StateFile;
  } catch {
    // ENOENT on the first ever run, a truncated write, a half-synced file, a directory where
    // a file should be. All of them are "no baseline yet", and none of them is worth a crash.
    return {};
  }
}

export function loadSeen(chainId: number, population: string): Seen | undefined {
  if (stateDisabled()) return undefined;
  return parseSeen(readStateFile().observations?.[stateKey(chainId, population)]);
}

/**
 *  Write the observation back, preserving every other deployment's.
 *
 *  READ-MODIFY-WRITE, not overwrite. One checkout may monitor two arenas (the DreamDEX
 *  population and a duel population are two `Population` proxies over the same code), and a
 *  writer that dropped the keys it did not own would leave each monitor destroying the other's
 *  baseline every minute — which reads as two monitors that never accumulate enough history to
 *  alert. The read is a few bytes off local disk once a minute.
 *
 *  Never throws, for the same reason the read does not: a read-only filesystem or a full disk
 *  is a lost baseline, not a reason to stop watching a live population.
 */
export function saveSeen(chainId: number, population: string, seen: Seen): void {
  if (stateDisabled()) return;
  const path = statePath();
  try {
    const state = readStateFile();
    const observations = state.observations ?? {};
    observations[stateKey(chainId, population)] = {
      phase: seen.phase,
      window: seen.window.toString(),
      at: seen.at,
      ...(seen.block !== undefined ? { block: seen.block.toString() } : {}),
    };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ...state, observations }, null, 2)}\n`, "utf8");
  } catch (err) {
    warn(`could not persist monitor state to ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/*//////////////////////////////////////////////////////////////
                               MAIN
//////////////////////////////////////////////////////////////*/

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) return selfTest();

  const once = process.argv.includes("--once");
  const m = manifest();

  // THE SAME ASSERTION `cadence.ts:preflight` MAKES, and for a sharper reason here. The
  // cadence throws on a chain mismatch before it can send anything; this process only reads,
  // so a `SOMNIA_RPC_URL` pointed at another chain reads a `Population` that is not there,
  // every read fails, and the poll degrades to a WARN — once a minute, forever, with not one
  // alert and, under `--once`, an exit code of 1 that says "something is wrong" and never says
  // what. Asserting it makes a misconfigured RPC a single fatal sentence instead of an
  // indefinite stream of symptoms.
  const id = await publicClient.getChainId();
  if (id !== m.chainId) throw new Error(`RPC is chain ${id} but the manifest is for ${m.chainId}`);

  const names = labels(m.chainId);
  let seen = loadSeen(m.chainId, m.population);
  let worst = 0;

  // The observer's own outage, reported once at startup rather than every poll: it is a fact
  // about the gap this process just closed, and repeating it after the first write would be
  // reporting its own uptime as an incident.
  if (seen !== undefined) {
    const age = Math.floor(Date.now() / 1000) - seen.at;
    if (age > STATE_STALE_AFTER) {
      log(
        `resuming from an observation ${Math.floor(age / 3600)}h old (phase ${PHASE[seen.phase] ?? seen.phase}, ` +
          `window #${seen.window}) — nothing wrote this state file in that time, so the MONITOR was ` +
          `down, not necessarily the population. The stall alerts below are computed against that ` +
          `timestamp and will fire on this poll if the window has not moved since.`,
      );
    } else {
      log(`resuming from an observation ${age}s old at window #${seen.window}`);
    }
  }

  for (;;) {
    try {
      const { alerts, next, readFailures } = await check(m, names, seen);
      // A poll that could not read the phase or the window returns the PREVIOUS observation
      // untouched, so `undefined` here means there has never been one. Saving is skipped in
      // that case rather than writing a placeholder — see `check`'s return for why the
      // timestamp must not be refreshed by a poll that observed nothing.
      seen = next;
      if (next !== undefined) saveSeen(m.chainId, m.population, next);
      worst = Math.max(worst, alerts, readFailures > 0 ? 1 : 0);
    } catch (err) {
      // Reserved for a failure the poll could not localise to one read — `check` itself
      // tolerates per-read failures now and reports them without throwing.
      warn(err instanceof Error ? err.message : String(err));
      worst = Math.max(worst, 1);
    }
    if (once) break;
    await sleep(INTERVAL);
  }

  if (once && worst > 0) process.exitCode = 1;
}

/*//////////////////////////////////////////////////////////////
                        PARTIAL READS
//////////////////////////////////////////////////////////////*/

/**
 *  Pull one value out of a settled batch, recording a failure instead of throwing.
 *
 *  WHY THIS EXISTS AT ALL — the single most damaging line in this file was `Promise.all`.
 *  Fifteen reads across two batches, and `Promise.all` rejects as a whole the instant ANY of
 *  them does, so one `eth_call` that timed out threw straight out of `check()` into `main`'s
 *  catch: one WARN, zero of the twelve checks, and no observation recorded. On a public
 *  testnet a single flaky read is an ordinary event, and the checks it silenced include both
 *  stall alerts — the ones that exist to notice that nothing is happening. A monitor that
 *  goes blind on exactly the kind of hiccup a struggling deployment produces most of is
 *  reporting the health of the RPC and calling it the health of the population.
 *
 *  `allSettled` plus this narrowing makes every check independent: the ones whose inputs
 *  arrived run, the ones whose inputs did not are skipped and SAID to be skipped. Nothing is
 *  swallowed — every failure is named in a WARN and counted into the `--once` exit code — but
 *  one bad read now costs one check instead of twelve. It is deliberately the same rule the
 *  contracts hold themselves to: one bad organism must never halt the population.
 */
type Failed = (name: string, why: unknown) => void;

function taken<T>(name: string, r: PromiseSettledResult<T>, failed: Failed): T | undefined {
  if (r.status === "fulfilled") return r.value;
  failed(name, r.reason);
  return undefined;
}

/** `undefined`-tolerant formatting, so a missing read prints as `?` instead of crashing the line. */
const q = (v: bigint | number | undefined, d: number, places = 2): string =>
  v === undefined ? "?" : typeof v === "number" ? String(v) : fmt(v, d, places);

/*//////////////////////////////////////////////////////////////
                        STALL PREDICATES
//////////////////////////////////////////////////////////////*/

export type Stall = { kind: "phase" | "window"; forSeconds: number };

/**
 *  The two stall alerts, as a pure function of the persisted observation and the current read.
 *
 *  EXTRACTED SO IT CAN BE PROVED TO FIRE. This is the pair of checks that #46 showed could not
 *  fire at all under `--once`: they compare against an in-memory `seen` that a one-shot process
 *  had no way to populate, so the branch was dead code in the only mode a cron ever runs. A
 *  predicate that cannot be executed without a chain cannot be tested without one either, which
 *  is how it stayed dead. Pulled out here it takes four numbers, and the self-test hands it a
 *  stale observation and asserts an alarm — the same shape as `cadence.ts`'s `seasonIsOver`.
 *
 *  A missing `phase` or `window` yields NO stall, deliberately. Both alerts mean "this value has
 *  not changed", and a value that was not read is not a value that did not change; claiming a
 *  stall from a failed `eth_call` would turn an RPC hiccup into "no new forecasts are being
 *  made". The failed read is reported on its own line instead.
 */
export function stalls(
  seen: Seen | undefined,
  phase: number | undefined,
  window: bigint | undefined,
  now: number,
  phaseLimit: number,
  windowLimit: number,
): Stall[] {
  if (seen === undefined || phase === undefined || window === undefined) return [];
  const age = now - seen.at;
  const out: Stall[] = [];
  if (seen.phase === phase && seen.window === window && age > phaseLimit) out.push({ kind: "phase", forSeconds: age });
  if (seen.window === window && age > windowLimit) out.push({ kind: "window", forSeconds: age });
  return out;
}

async function check(m: Manifest, names: Map<number, string>, seen: Seen | undefined) {
  const now = Math.floor(Date.now() / 1000);

  // NAMED, COUNTED, AND NOT FATAL — reported the moment the failure is known rather than
  // tallied at the end, so a failure always prints ABOVE the check that had to skip because of
  // it. Nothing is swallowed: each one is a WARN and each one feeds the `--once` exit code, so
  // a cron quietly reading half a population still exits non-zero.
  let readFailures = 0;
  const failed = (name: string, why: unknown) => {
    readFailures++;
    warn(
      `read failed: ${name} — ${why instanceof Error ? why.message.split("\n")[0] : String(why)}. ` +
        `The checks that need it are skipped and say so; every other check below still runs.`,
    );
  };

  /** A one-off read, tolerated the same way the batched ones are. */
  const one = async <T>(name: string, thunk: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await thunk();
    } catch (err) {
      failed(name, err);
      return undefined;
    }
  };

  const core = await Promise.allSettled([
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
   *  sixteen per-ORGANISM fields (`Population.sol:2162`) and carries nothing about the
   *  season, so there is no free ride here.
   *
   *  A SECOND BATCH RATHER THAN SEVEN MORE ENTRIES IN THE FIRST, and this is not style.
   *  Folded into the batch above it makes a fifteen-element settled batch over viem's
   *  generics, and at that width TypeScript's inference stops being dependable: the same
   *  file typechecked clean, then reported `windowRaw` — the line above, untouched for
   *  months — as a `number` being cast to `bigint`. Whatever the exact limit is, a batch
   *  wide enough to reach it silently widens the casts BELOW it, which is the mechanism
   *  those casts exist to catch. Two batches of eight and seven each infer exactly.
   *
   *  It costs one more round trip and buys nothing in consistency either way: these are
   *  separate `eth_call`s at "latest" whether they share a batch or not, so a season
   *  that closes mid-poll can pair a fresh `seasonStartWindow` with a stale `windowCount`
   *  regardless. That skew can only shrink the overshoot, so it may silence one poll and can
   *  never invent an alert.
   */
  const seasonReads = await Promise.allSettled([
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "seasonId" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "seasonStartWindow" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "seasonWindows" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "prizePool" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "rakeAccrued" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "ante" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "level" }),
  ]);

  const infraReads = await Promise.allSettled([
    publicClient.readContract({ address: m.priceSource, abi: priceSourceAbi, functionName: "rawWindow", args: [m.symbol] }),
    publicClient.readContract({ address: m.priceSource, abi: priceSourceAbi, functionName: "maxStaleness" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "venue" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "selectionEngine" }),
    publicClient.readContract({ address: m.prophetBeacon, abi: beaconAbi, functionName: "implementation" }),
  ]);

  const currentBlock = await publicClient.getBlockNumber().catch(() => undefined);
  type FailureLog = { eventName: string; blockNumber: bigint; prophetId?: bigint; reason?: string };
  const failureLogs: FailureLog[] = [];

  if (currentBlock !== undefined) {
    const fromBlock =
      seen?.block !== undefined && seen.block < currentBlock
        ? currentBlock - seen.block > 500n
          ? currentBlock - 500n
          : seen.block + 1n
        : currentBlock > 100n
          ? currentBlock - 100n
          : 0n;

    if (fromBlock <= currentBlock) {
      const [popLogs, engLogs] = await Promise.all([
        publicClient
          .getLogs({
            address: m.population,
            events: failureEventsAbi,
            fromBlock,
            toBlock: currentBlock,
          })
          .catch(() => []),
        publicClient
          .getLogs({
            address: m.selectionEngine,
            events: reactionFailedAbi,
            fromBlock,
            toBlock: currentBlock,
          })
          .catch(() => []),
      ]);

      for (const l of popLogs) {
        failureLogs.push({
          eventName: l.eventName,
          blockNumber: l.blockNumber,
          prophetId: (l.args as { prophetId?: bigint }).prophetId,
        });
      }
      for (const l of engLogs) {
        failureLogs.push({
          eventName: "ReactionFailed",
          blockNumber: l.blockNumber,
          reason: String((l.args as { reason?: unknown }).reason ?? ""),
        });
      }
    }
  }

  const phaseRaw = taken("phase", core[0], failed);
  const windowRaw = taken("windowCount", core[1], failed);
  const alive = taken("aliveCount", core[2], failed);
  const deposit = taken("requestDeposit", core[3], failed);
  const native = taken("balance", core[4], failed);
  const endow = taken("cognitionEndowment", core[5], failed);
  const coll = taken("collateral.balanceOf", core[6], failed);
  const snapRaw = taken("snapshot", core[7], failed);

  const phase = phaseRaw === undefined ? undefined : Number(phaseRaw);
  const window = windowRaw as bigint | undefined;
  const snap = snapRaw as readonly Snapshot[] | undefined;
  const living = snap?.filter((o) => !o.dead);

  // THE WIDTHS ARE VIEM'S, NOT A PREFERENCE, and the casts are here so `tsc` checks them:
  // uint8..uint48 decode to `number` and uint56 upward to `bigint`, so `seasonId`/
  // `seasonWindows`/`level` (uint32) arrive as numbers while `seasonStartWindow` (uint64)
  // and the two books (uint256) arrive as bigints. Same boundary `cadence.ts` documents at
  // its `ReadResult` type; getting it wrong here would produce a `bigint - number` that does
  // not compile, which is the point of writing it out rather than reaching for `Number()`.
  // The `| undefined` on each is the read having failed, and every use below is guarded.
  const seasonId = taken("seasonId", seasonReads[0], failed) as number | undefined;
  const startWindow = taken("seasonStartWindow", seasonReads[1], failed) as bigint | undefined;
  const seasonWindows = taken("seasonWindows", seasonReads[2], failed) as number | undefined;
  const pool = taken("prizePool", seasonReads[3], failed) as bigint | undefined;
  const rake = taken("rakeAccrued", seasonReads[4], failed) as bigint | undefined;
  const ante = taken("ante", seasonReads[5], failed) as bigint | undefined;
  const level = taken("level", seasonReads[6], failed) as number | undefined;

  const rawWin = taken("rawWindow", infraReads[0], failed) as
    | { marketId: Hex; openPrice: bigint; lastPrice: bigint; priceDecimals: number; updatedAt: bigint }
    | undefined;
  const maxStale = taken("maxStaleness", infraReads[1], failed) as bigint | undefined;
  const onChainVenue = taken("venue", infraReads[2], failed) as Address | undefined;
  const onChainEngine = taken("selectionEngine", infraReads[3], failed) as Address | undefined;
  const onChainBeaconImpl = taken("beacon.implementation", infraReads[4], failed) as Address | undefined;

  // Windows into the season, and windows past its end. `overshoot` used to be derived here by
  // hand-mirroring both of `seasonIsOver`'s guards; since 2026-09-06 it comes from
  // `lib/season.ts`, which is the closer's own predicate rather than a copy of it — see the
  // note above alert 7. `elapsed` stays local because it is display only: the status line
  // prints `n/24` every poll, including mid-season, where there is no overshoot to speak of.
  const seasonLen = seasonWindows === undefined ? undefined : BigInt(seasonWindows);
  const elapsed =
    window === undefined || startWindow === undefined ? undefined : window < startWindow ? 0n : window - startWindow;
  const overshoot = seasonOvershoot(window, startWindow, seasonLen);

  // RUNWAY IS PER ORGANISM, NOT PER POPULATION. Each organism pays its own inference
  // deposits out of its own native balance, so Population's balance says nothing about
  // whether anybody can think — it only says whether the next CHILD can. Averaging
  // across organisms would hide the failure too: the population does not stop when the
  // total runs low, it stops one organism at a time, and the minimum is the one that
  // is about to go quiet. So poll the organisms and rank them.
  // `deposit` missing costs the RATIO, not the balances: without it there is no windows-per-
  // organism figure, so the runway check is the one that skips while the STT totals still print.
  // `snapshot` missing costs the whole fan-out, since there is nobody to poll.
  const dep = deposit as bigint | undefined;
  const runways = await Promise.all(
    (living ?? []).map(async (o) => {
      const bal = await one(`balance of #${o.id}`, () => publicClient.getBalance({ address: o.addr }));
      const windows = bal === undefined || dep === undefined || dep === 0n ? undefined : bal / dep;
      return { o, bal, windows };
    }),
  );
  const runwayOf = new Map(runways.flatMap((r) => (r.windows === undefined ? [] : [[r.o.addr, r.windows] as const])));
  const cognition = runways.reduce((sum, r) => sum + (r.bal ?? 0n), 0n);
  const measured = runways.flatMap((r) => (r.windows === undefined ? [] : [r.windows]));
  const worstRunway = measured.length === 0 ? undefined : measured.reduce((lo, w) => (w < lo ? w : lo));
  const generations = snap === undefined || snap.length === 0 ? undefined : Math.max(...snap.map((o) => o.generation));

  log(
    `phase ${(phase === undefined ? undefined : PHASE[phase]) ?? phase ?? "?"} · window #${window ?? "?"} · ` +
      `season ${seasonId ?? "?"} ${elapsed ?? "?"}/${seasonWindows ?? "?"} · ` +
      `alive ${living?.length ?? "?"}/${snap?.length ?? "?"} · gen ${generations ?? "?"} · ` +
      `runway ${worstRunway ?? "?"}w worst / ${fmt(cognition, 18, 3)} STT held · ` +
      `ante ${q(ante, m.collateralDecimals)} · ` +
      `${q(coll, m.collateralDecimals)} tUSDC (pool ${q(pool, m.collateralDecimals)})`,
  );

  let alerts = 0;
  const alert = (msg: string) => {
    alerts++;
    console.error(`ALERT ${msg}`);
  };

  /* 1. Extinction. Not a bug — but the run is over and it needs a human. */
  if (living !== undefined && snap !== undefined && living.length === 0 && snap.length > 0) {
    alert(`the population is EXTINCT after ${window ?? "?"} windows. Reseed or accept it as the result.`);
  }

  /* 2. A phase that has not moved, and 2b. a window that has not advanced. */
  for (const s of stalls(seen, phase, window, now, PHASE_STALL, WINDOW_STALL)) {
    if (s.kind === "phase") {
      alert(
        `phase has been ${(phase === undefined ? undefined : PHASE[phase]) ?? phase} for ${s.forSeconds}s. The ` +
          `cadence is down, or a driver call is reverting. Check the cadence log; forcePhase(0) as a last resort.`,
      );
    } else {
      alert(`window #${window} has not advanced in ${s.forSeconds}s — no new forecasts are being made.`);
    }
  }

  /* 3. Cognition runway. The quiet killer — now per organism, because that is who pays. */
  const starving = runways.flatMap((r) =>
    r.windows !== undefined && r.windows < BigInt(MIN_RUNWAY) ? [{ o: r.o, windows: r.windows }] : [],
  );
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

  /*
   *  3b. The house float. Not what pays for thinking — what pays for being BORN.
   *
   *  Measured in CHILDREN rather than in STT, because that is the unit the contract spends
   *  it in; see `MIN_BIRTHS` for why the threshold is eight and not one. `endow == 0n` is
   *  not a fault — an endowment of zero means births need no float at all, and dividing by
   *  it would throw inside the poll and be reported as an RPC error.
   */
  const births = endow === undefined || native === undefined || endow === 0n ? undefined : native / endow;
  if (births !== undefined && births < BigInt(MIN_BIRTHS)) {
    alert(
      `Population holds ${fmt(native as bigint, 18, 4)} STT = ${births} more endowed ` +
        `${births === 1n ? "child" : "children"} at ${fmt(endow as bigint, 18, 4)} STT each, under ` +
        `the ${MIN_BIRTHS} the house is expected to cover. Births past that point are silent: ` +
        `_houseCognition() returns 0 without reverting, so the child is born brain-dead and needs ` +
        `a manual topUpCognition. Run: npm run fund -- --house 5`,
    );
  }

  /* 3c. The two population counters must agree. A drift is a bookkeeping bug, not attrition. */
  if (alive !== undefined && living !== undefined && (alive as bigint) !== BigInt(living.length)) {
    alert(
      `aliveCount is ${alive} but snapshot shows ${living.length} undead organisms. The counter ` +
        `and the living index have drifted — settleAll's reap path is the only place both move.`,
    );
  }

  /* 4. Requests that never came back. */
  if (phase !== undefined && phase !== 1 && living !== undefined) {
    const stuck: string[] = [];
    for (const o of living) {
      const pending = await one(`pendingBeliefRequestId of #${o.id}`, () =>
        publicClient.readContract({
          address: o.addr,
          abi: prophetAbi,
          functionName: "pendingBeliefRequestId",
        }),
      );
      if (pending !== undefined && pending !== 0n) stuck.push(`#${o.id}${label(names, o.id)} (request ${pending})`);
    }
    if (stuck.length > 0) {
      alert(`inference never returned for ${stuck.join(", ")} — a timed-out request scores as an abstain.`);
    }
  }

  /*
   *  5. A window in which nobody actually took a position.
   *
   *  `polled` rather than `living.length` in the gate below, because a per-organism read that
   *  failed is not an organism that abstained. Zero positions out of zero SUCCESSFUL reads is an
   *  RPC outage already reported above, and firing this alert on it would report "the genomes
   *  have converged" when nothing was measured at all.
   */
  if (phase === 2 && living !== undefined && living.length > 0) {
    let withPosition = 0;
    let polled = 0;
    for (const o of living) {
      const qty = await one(`currentQuantity of #${o.id}`, () =>
        publicClient.readContract({
          address: o.addr,
          abi: prophetAbi,
          functionName: "currentQuantity",
        }),
      );
      if (qty === undefined) continue;
      polled++;
      if (qty > 0n) withPosition++;
    }
    if (polled > 0 && withPosition === 0) {
      /*
       *  TWO DIFFERENT FAULTS SHARE THIS SYMPTOM, and until 2026-09-07 both got the
       *  convergence message — which sent the operator to look at the genomes when the
       *  actual fault was in the cadence's clock.
       *
       *  `committedBlind` separates them with the one fact that needs no timing: did ANY
       *  living organism form a belief? An abstention is an answer — `handleBelief`
       *  initialises `b` to `Belief.Abstain` (`contracts/src/Prophet.sol:271`) and writes it
       *  through on every non-Success status — so a delivered callback always moves
       *  `belief` off `None`. Zero answers across a living population therefore cannot be
       *  unanimous scepticism. It is a window that committed before the subcommittee could
       *  reply, or a total validator outage, and neither is a fact about the genomes.
       *
       *  The predicate is imported rather than restated here for the reason `season.ts`
       *  exists: the cadence uses the same one to refuse the commit in the first place
       *  (`cadence.ts` `doCommit`), and a monitor carrying its own copy of the rule is how
       *  the alert that should have caught the defect goes quiet at the same time the
       *  cadence starts causing it.
       */
      if (committedBlind(living.length, living.filter((o) => o.belief !== 0).length)) {
        alert(
          `window #${window} committed BLIND: not one of ${living.length} living organisms has a ` +
            `belief, so commitAll scored every one of them as an abstention and opened no ` +
            `positions. This is NOT convergence — an abstention is an answer, so zero answers ` +
            `means the window committed before the subcommittee replied (check the cadence's ` +
            `CADENCE_COMMIT_FLOOR) or the validators are not responding at all.`,
        );
      } else {
        alert(
          `window #${window} has zero real positions. Every organism was unpaired or abstained — ` +
            `if this repeats, the genomes have converged and there is no counterparty left to pair against.`,
        );
      }
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
  const voided = (living ?? [])
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
   *  child's endowment out of the PARENT (`Population.sol:1790`) and `_spawn` pays the same
   *  amount straight back out, so a hatch is net-neutral here by construction; `enter` has
   *  already pulled the entrant's own in. `spawnGenesis` is the one birth that spends the
   *  house's collateral, and it runs once, under the operator's hand, at seed.
   *
   *  So this is now a float check, one endowment ahead of the state 7b calls unpayable: it
   *  fires while there is still room to act, and 7b fires when the books have already
   *  overdrawn the balance. Deliberately NOT folded into 7b — different remedies deserve
   *  different alerts, and a single threshold would have to pick one of them to report.
   */
  const endowment = await one("endowment", () =>
    publicClient.readContract({
      address: m.population,
      abi: populationAbi,
      functionName: "endowment",
    }),
  );
  const books = pool === undefined || rake === undefined ? undefined : pool + rake;
  const free = coll === undefined || books === undefined ? undefined : coll > books ? coll - books : 0n;
  if (free !== undefined && endowment !== undefined && free < endowment) {
    alert(
      `Population's FREE collateral is ${fmt(free, m.collateralDecimals, 2)} tUSDC — under one ` +
        `endowment (${fmt(endowment, m.collateralDecimals, 2)}). It holds ` +
        `${q(coll, m.collateralDecimals)} but ${q(pool, m.collateralDecimals)} is the prize ` +
        `pool and ${q(rake, m.collateralDecimals)} is rake, and neither is the house's to spend. ` +
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
   *  THE BOUNDARY IS `Population.endSeason`'s guard — `windowCount - seasonStartWindow <
   *  seasonWindows` reverts `SeasonNotOver` — and `lib/season.ts`'s `seasonIsOver` is the
   *  closer's copy of it, which `seasonOvershoot` above is built on. CLOSED 2026-09-06: this
   *  check now shares the predicate instead of mirroring it, and the history is worth keeping
   *  because it explains why the fix is a new module rather than an import of the cadence.
   *
   *  Importing it from `cadence.ts` used to be unsafe: that file called `main()` at module
   *  scope with no entry-point guard, so `import { seasonIsOver } from "./cadence.js"` started
   *  a SECOND CADENCE inside the monitor process — verified rather than assumed, the import
   *  died inside the cadence's own `manifest()` and took the monitor down with it
   *  (`process.exit(1)`), and after a deployment it would instead have reached `wallet()` and
   *  driven the population from in here, racing the real cadence for nonces. That hazard was
   *  closed first, by `cadence.ts`'s `invokedDirectly` realpath gate.
   *
   *  What remained after that was smaller but real, and is why the predicate moved DOWN rather
   *  than sideways: importing `cadence.ts` pulls its whole module graph — viem, the manifest
   *  reader, a `wallet()` that wants a key — into a process whose entire job is to keep running
   *  when the cadence cannot. `lib/season.ts` imports nothing at all, so it cannot do that.
   *  `cadence.ts` re-exports the same symbol, so its `--self-test` table still exercises it.
   */
  if (overshoot !== undefined && overshoot > BigInt(SEASON_GRACE)) {
    alert(
      `season ${seasonId ?? "?"} has been over since window #${(startWindow as bigint) + (seasonLen as bigint)} and ` +
        `is still open ${overshoot} window(s) later. ${q(pool, m.collateralDecimals)} tUSDC of prize money is ` +
        `owed to entrants and nothing is paying it out, and the ante keeps escalating past the season ` +
        `it was scaled for (level ${level ?? "?"}, ante now ${q(ante, m.collateralDecimals)}) because ` +
        `endSeason is what resets it. The cadence's season branch is not running or its send is ` +
        `failing — check the cadence log for "endSeason:". It is permissionless, so any funded ` +
        `address can close it: npm run cadence:once`,
    );
  }

  /* 7b. The two books against the balance. A pot that cannot be paid is a season that cannot close. */
  if (books !== undefined && coll !== undefined && books > coll) {
    alert(
      `the books claim ${fmt(books, m.collateralDecimals, 2)} tUSDC ` +
        `(${q(pool, m.collateralDecimals)} prize pool + ${q(rake, m.collateralDecimals)} rake) ` +
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

  /* 8. Price feed staleness. Audit item #47. */
  if (rawWin !== undefined && maxStale !== undefined) {
    const updatedAt = Number(rawWin.updatedAt);
    const limit = Number(maxStale);
    const feedAge = now - updatedAt;
    if (updatedAt > 0 && feedAge > limit) {
      alert(
        `price feed for "${m.symbol}" is STALE: last updated ${feedAge}s ago (limit ${limit}s). ` +
          `The price updater has stopped pushing prices. think() and settleAll() will revert StalePrice.`,
      );
    }
  }

  /* 9. Infrastructure drift: venue, engine, or beacon implementation repointed. Audit item #48. */
  const manifestVenue = (m as { venue?: Address }).venue;
  if (onChainVenue !== undefined && manifestVenue !== undefined && onChainVenue.toLowerCase() !== manifestVenue.toLowerCase()) {
    alert(`Population.venue on chain (${onChainVenue}) does NOT match manifest (${manifestVenue}). Repointed!`);
  }
  if (onChainEngine !== undefined && onChainEngine.toLowerCase() !== m.selectionEngine.toLowerCase()) {
    alert(`Population.selectionEngine on chain (${onChainEngine}) does NOT match manifest (${m.selectionEngine}). Repointed!`);
  }
  if (onChainBeaconImpl !== undefined && onChainBeaconImpl.toLowerCase() !== m.prophetImpl.toLowerCase()) {
    alert(`ProphetBeacon implementation on chain (${onChainBeaconImpl}) does NOT match manifest (${m.prophetImpl}). Upgraded!`);
  }

  /* 10. Silent failure events in logs. Audit item #45. */
  for (const f of failureLogs) {
    const who = f.prophetId !== undefined ? `#${f.prophetId}${label(names, f.prophetId)}` : "";
    alert(`failure event ${f.eventName} ${who} observed at block ${f.blockNumber} — check transaction logs.`);
  }

  if (alerts === 0 && snap !== undefined) roll(snap, names, m.collateralDecimals, runwayOf);

  /*
   *  THE OBSERVATION, AND WHY A FAILED POLL MUST NOT PRODUCE ONE.
   *
   *  `at` is the timestamp of the last CHANGE, not of the last poll, which is what lets a stall
   *  be measured in hours from a process that restarts every five minutes. That also makes it
   *  the one field a partial poll can corrupt: if `phase` or `window` did not arrive and this
   *  returned a fresh observation anyway, the next poll would compare against a timestamp
   *  stamped by a poll that saw nothing, and every RPC outage would silently reset the stall
   *  clock — the alert would recede exactly as the trouble deepened. So a poll that could not
   *  read both returns the PREVIOUS observation unchanged (`undefined` if there was none), and
   *  `main` skips the save. Nothing is lost: the failed reads were reported above.
   */
  if (phase === undefined || window === undefined) return { alerts, next: seen, readFailures };

  const advanced = seen === undefined || seen.phase !== phase || seen.window !== window;
  const lastObservedBlock = currentBlock ?? seen?.block;
  return {
    alerts,
    next: {
      phase,
      window,
      at: advanced ? now : seen.at,
      ...(lastObservedBlock !== undefined ? { block: lastObservedBlock } : {}),
    },
    readFailures,
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

/*//////////////////////////////////////////////////////////////
                            SELF-TEST
//////////////////////////////////////////////////////////////*/

/**
 *  `npm run monitor:selftest` — no chain, no manifest, no wallet.
 *
 *  WHAT IS ACTUALLY WORTH TESTING HERE, given that the interesting failures in this file are
 *  absences. Two things, and they are the two halves of #46: that an observation survives a
 *  process boundary (so `--once` HAS a baseline), and that the stall predicate FIRES when handed
 *  a stale one (so the baseline is worth having). Either one alone reproduces the original bug in
 *  a new shape — a state file nothing reads, or a predicate nothing can trigger — which is why
 *  the controls below are not decoration.
 *
 *  The file-layer cases run against a temp path via `MONITOR_STATE`, restored in a `finally`, so
 *  a developer's real `.darwin/monitor-state.json` is never touched by a test run.
 */
function selfTest(): void {
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail = ""): void => {
    if (ok) {
      pass++;
      console.log(`  ok   ${name}`);
    } else {
      fail++;
      console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
  };
  const eq = (name: string, got: unknown, want: unknown): void =>
    check(name, got === want, `got ${String(got)}, want ${String(want)}`);

  const POP = "0x1111111111111111111111111111111111111111";
  const OTHER = "0x2222222222222222222222222222222222222222";
  const now = 1_757_000_000;

  console.log("\nmonitor self-test\n");

  /*//////////////////////////////////////////////////////////////
                    1. THE KEY: CHAIN *AND* ADDRESS
  //////////////////////////////////////////////////////////////*/
  console.log("state key");
  eq("chain + address", stateKey(50312, POP), `50312:${POP}`);
  eq("address is lowercased", stateKey(50312, POP.toUpperCase()), `50312:${POP}`);
  check("a redeploy on the same chain is a different key", stateKey(50312, POP) !== stateKey(50312, OTHER));
  check("the same address on another chain is a different key", stateKey(50312, POP) !== stateKey(1, POP));

  /*//////////////////////////////////////////////////////////////
              2. PARSING: EVERY MALFORMED SHAPE IS "NO BASELINE"
  //////////////////////////////////////////////////////////////*/
  console.log("\nparseSeen");
  const good = parseSeen({ phase: 2, window: "41", at: now });
  check("a well-formed record round-trips", good?.phase === 2 && good?.window === 41n && good?.at === now);
  check("window comes back as a bigint", typeof good?.window === "bigint");
  eq("undefined", parseSeen(undefined), undefined);
  eq("null", parseSeen(null), undefined);
  eq("a string", parseSeen("nope"), undefined);
  eq("an array", parseSeen([1, 2, 3]), undefined);
  eq("no fields", parseSeen({}), undefined);
  eq("phase missing", parseSeen({ window: "41", at: now }), undefined);
  eq("phase as a string", parseSeen({ phase: "2", window: "41", at: now }), undefined);
  eq("at missing", parseSeen({ phase: 2, window: "41" }), undefined);
  // A NaN `at` is the one that matters: `now - NaN` is NaN, `NaN > PHASE_STALL` is false, and
  // both stall alerts go quiet with no message at all. Exactly the failure mode of #46, arriving
  // through the cache instead of through the process boundary.
  eq("at as NaN", parseSeen({ phase: 2, window: "41", at: Number.NaN }), undefined);
  eq("window as a number", parseSeen({ phase: 2, window: 41, at: now }), undefined);
  eq("window as a bigint-ish hex string", parseSeen({ phase: 2, window: "0x29", at: now }), undefined);
  eq("window as an empty string", parseSeen({ phase: 2, window: "", at: now }), undefined);
  eq("window as junk", parseSeen({ phase: 2, window: "nope", at: now }), undefined);
  eq("window negative", parseSeen({ phase: 2, window: "-1", at: now }), undefined);

  /*//////////////////////////////////////////////////////////////
                3. THE FILE: ROUND-TRIP AND EVERY DEGRADATION
  //////////////////////////////////////////////////////////////*/
  console.log("\nstate file");
  const dir = mkdtempSync(join(tmpdir(), "darwin-monitor-"));
  const file = join(dir, "state.json");
  const saved = process.env.MONITOR_STATE;
  try {
    process.env.MONITOR_STATE = file;

    eq("a missing file is a first observation", loadSeen(50312, POP), undefined);

    saveSeen(50312, POP, { phase: 2, window: 41n, at: now });
    const back = loadSeen(50312, POP);
    check(
      "an observation survives the process boundary",
      back?.phase === 2 && back?.window === 41n && back?.at === now,
      JSON.stringify(back, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)),
    );

    // The read-modify-write property, which is what stops two monitored arenas from erasing each
    // other's baseline once a minute.
    saveSeen(50312, OTHER, { phase: 0, window: 7n, at: now - 10 });
    eq("writing another deployment preserves the first", loadSeen(50312, POP)?.window, 41n);
    eq("and stores its own", loadSeen(50312, OTHER)?.window, 7n);
    eq("a key that is not there is a first observation", loadSeen(1, POP), undefined);

    // Corruption, in the four shapes a real file reaches this code in.
    writeFileSync(file, "{ this is not json", "utf8");
    eq("truncated/invalid JSON degrades to first observation", loadSeen(50312, POP), undefined);
    writeFileSync(file, "", "utf8");
    eq("an empty file degrades to first observation", loadSeen(50312, POP), undefined);
    writeFileSync(file, "[]", "utf8");
    eq("valid JSON of the wrong type degrades", loadSeen(50312, POP), undefined);
    writeFileSync(file, JSON.stringify({ observations: { [stateKey(50312, POP)]: { phase: 2 } } }), "utf8");
    eq("right shape, missing fields, degrades", loadSeen(50312, POP), undefined);

    // And a corrupt file must not be a dead end: the next successful poll re-establishes it.
    saveSeen(50312, POP, { phase: 1, window: 42n, at: now });
    eq("a corrupt file is rebuilt by the next write", loadSeen(50312, POP)?.window, 42n);

    process.env.MONITOR_STATE = "-";
    eq("MONITOR_STATE=- reads nothing", loadSeen(50312, POP), undefined);
    saveSeen(50312, POP, { phase: 0, window: 999n, at: now });
    process.env.MONITOR_STATE = file;
    eq("MONITOR_STATE=- wrote nothing either", loadSeen(50312, POP)?.window, 42n);
  } finally {
    if (saved === undefined) delete process.env.MONITOR_STATE;
    else process.env.MONITOR_STATE = saved;
    rmSync(dir, { recursive: true, force: true });
  }

  /*//////////////////////////////////////////////////////////////
                4. THE STALL PREDICATE — DOES IT FIRE?
  //////////////////////////////////////////////////////////////*/
  console.log("\nstall predicates");
  const P = 1_200;
  const W = 2_400;
  const kinds = (s: Stall[]): string => s.map((x) => x.kind).join("+") || "none";

  // THE CONTROL #46 EXISTS FOR. A stale observation, the shape `--once` now loads off disk,
  // must produce alarms. If this line ever reads "none" the persistence above is decoration and
  // the original bug is back in a new costume.
  const stale: Seen = { phase: 2, window: 41n, at: now - 86_400 };
  eq("CONTROL a day-old observation fires BOTH stalls", kinds(stalls(stale, 2, 41n, now, P, W)), "phase+window");

  // CONTROL 2: it is the AGE that fires them, not the mere presence of a baseline.
  eq("CONTROL a fresh observation fires neither", kinds(stalls({ ...stale, at: now - 60 }, 2, 41n, now, P, W)), "none");

  eq("no baseline fires nothing", kinds(stalls(undefined, 2, 41n, now, P, W)), "none");
  eq("a moved window clears both", kinds(stalls(stale, 2, 42n, now, P, W)), "none");
  // A phase that moved inside the same window: the window stall still stands, because a window
  // that has not advanced in 24h is not made healthy by the phase churning inside it.
  eq("a moved phase in the same window leaves the window stall", kinds(stalls(stale, 0, 41n, now, P, W)), "window");
  // Between the two thresholds only the phase stall is due.
  eq("past PHASE_STALL only", kinds(stalls({ ...stale, at: now - 1_800 }, 2, 41n, now, P, W)), "phase");
  eq("exactly at the threshold does not fire", kinds(stalls({ ...stale, at: now - P }, 2, 41n, now, P, W)), "none");
  eq("one second past it does", kinds(stalls({ ...stale, at: now - P - 1 }, 2, 41n, now, P, W)), "phase");
  eq("age is reported in seconds", stalls(stale, 2, 41n, now, P, W)[0]?.forSeconds, 86_400);

  // A FAILED READ IS NOT A STALL. Both alerts assert "this value did not change"; a value that
  // never arrived did not fail to change. Firing here would print "no new forecasts are being
  // made" on an RPC timeout — the false-alarm path that teaches an operator to ignore the file.
  eq("a missing phase fires nothing", kinds(stalls(stale, undefined, 41n, now, P, W)), "none");
  eq("a missing window fires nothing", kinds(stalls(stale, 2, undefined, now, P, W)), "none");

  /*//////////////////////////////////////////////////////////////
                5. THE FRESHNESS THRESHOLDS AGREE WITH THE PROSE
  //////////////////////////////////////////////////////////////*/
  console.log("\nthresholds");
  check(`PHASE_STALL (${PHASE_STALL}s) is longer than one 15-minute window`, PHASE_STALL > 900);
  check(`WINDOW_STALL (${WINDOW_STALL}s) is not shorter than PHASE_STALL`, WINDOW_STALL >= PHASE_STALL);
  // The observer-outage line is only meaningful if it cannot be triggered by an ordinary gap
  // between polls; six hours of missed minute-polls is an outage by any reading.
  check(
    `STATE_STALE_AFTER (${STATE_STALE_AFTER}s) is far past one poll interval`,
    STATE_STALE_AFTER > (INTERVAL / 1000) * 10,
  );
  check("a stale state file is itself past both stall thresholds", STATE_STALE_AFTER > WINDOW_STALL);

  /*//////////////////////////////////////////////////////////////
        6. THE SEASON BOUNDARY, SHARED WITH THE CLOSER
  //////////////////////////////////////////////////////////////*/
  /*
   *  `seasonOvershoot` is now the sole source of alert 7's gate, and until 2026-09-06 the
   *  arithmetic was inline here with no test at all. The rows that matter are the ones either
   *  side of the boundary: `elapsed == len - 1` must be `undefined` and `elapsed == len` must be
   *  `0n`, because `0n` is what makes the ordinary in-flight state at every boundary sit BELOW
   *  `SEASON_GRACE` instead of alerting. A table checking only "far past" and "far short" would
   *  pass on either side of the off-by-one it exists to catch.
   *
   *  The three `undefined` rows are the ones that keep this monitor quiet when it should be:
   *  a zero-length season, a start ahead of the count, and a read that never arrived. Each is a
   *  DIFFERENT reason and the same answer — nothing is known to be overdue — and an alert that
   *  fired on any of them would be reporting an unconfigured or unreadable season as a cadence
   *  failure, which is how an operator learns to ignore the file.
   */
  console.log("\nseason overshoot");
  eq("mid-season is not overdue", seasonOvershoot(23n, 0n, 24n), undefined);
  eq("CONTROL one window short of the boundary", seasonOvershoot(23n, 0n, 24n), undefined);
  eq("the exact boundary is overdue by zero", seasonOvershoot(24n, 0n, 24n), 0n);
  eq("one window past the boundary", seasonOvershoot(25n, 0n, 24n), 1n);
  eq("a season dated from a late close", seasonOvershoot(49n, 25n, 24n), 0n);
  eq("far past the boundary", seasonOvershoot(100n, 0n, 24n), 76n);
  eq("a zero-length season is never overdue", seasonOvershoot(5n, 0n, 0n), undefined);
  eq("a start ahead of the count is never overdue", seasonOvershoot(5n, 9n, 24n), undefined);
  eq("a missing windowCount is not overdue", seasonOvershoot(undefined, 0n, 24n), undefined);
  eq("a missing startWindow is not overdue", seasonOvershoot(24n, undefined, 24n), undefined);
  eq("a missing seasonWindows is not overdue", seasonOvershoot(24n, 0n, undefined), undefined);
  // THE GATE ITSELF, not just the arithmetic. `SEASON_GRACE` has to swallow the boundary poll
  // and the one after it, or alert 7 fires once per season on a perfectly healthy cadence.
  check(
    `SEASON_GRACE (${SEASON_GRACE}) swallows the in-flight overshoot at the boundary`,
    (seasonOvershoot(24n, 0n, 24n) as bigint) <= BigInt(SEASON_GRACE),
  );
  check(
    "an overshoot far past the boundary is not swallowed by SEASON_GRACE",
    (seasonOvershoot(100n, 0n, 24n) as bigint) > BigInt(SEASON_GRACE),
  );

  /*//////////////////////////////////////////////////////////////
        7. THE BLIND-WINDOW DETECTOR, SHARED WITH THE CADENCE
  //////////////////////////////////////////////////////////////*/
  /*
   *  Alert 5 fires on zero positions, and until 2026-09-07 it gave one message for two faults
   *  with opposite remedies: converged genomes (nothing to do) and a window committed before the
   *  subcommittee could answer (fix the cadence's floor). `committedBlind` is what separates
   *  them, and it comes from `lib/commit.ts` — the same module whose `commitReadiness` refuses
   *  the early commit in the first place — so the detector cannot drift away from the rule while
   *  the cadence still enforces it.
   *
   *  THE TABLE'S REAL SUBJECT IS THE DISCRIMINATION, not the arithmetic. The defect being
   *  detected produces an all-`Abstain` scoreboard on chain (`Population.sol:1608` sends
   *  `Belief.None` down `_openEmpty` exactly as it does `Belief.Abstain`), so an eight-abstention
   *  window is EITHER fault. The one distinguishing fact is whether the beliefs are `None` — an
   *  abstention having been WRITTEN means a callback landed. Hence the two controls: a unanimous
   *  genuine abstention must NOT be called blind, or every converged season gets a false alarm
   *  pointing the operator at CADENCE_COMMIT_FLOOR; and a single answer among many must not be
   *  called blind either, because one landed callback proves the validators were reachable.
   */
  console.log("\nblind-window detector");
  check("nobody answered across a living population is blind", committedBlind(8, 0));
  check("CONTROL a unanimous genuine abstention is NOT blind", !committedBlind(8, 8));
  check("CONTROL one answer among eight is NOT blind", !committedBlind(8, 1));
  check("a lone survivor that never answered is blind", committedBlind(1, 0));
  check("a lone survivor that answered is not", !committedBlind(1, 1));
  check("an extinct population is not blind — there was nothing to ask", !committedBlind(0, 0));
  // The gate as alert 5 actually composes it: `polled > 0 && withPosition === 0` is the
  // precondition, and this predicate only chooses WHICH message. Both branches must be
  // reachable from that precondition or one of the two messages is dead code.
  check(
    "both branches of alert 5 are reachable from zero positions",
    committedBlind(8, 0) !== committedBlind(8, 8),
  );

  console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

/*
 *  ONLY DRIVE A MONITOR WHEN RUN AS ONE.
 *
 *  This file exports `stalls`, `parseSeen`, `loadSeen` and `saveSeen`, and the top of it
 *  documents at length why `monitor.ts` must not import from `cadence.ts` at module scope. The
 *  same hazard runs the other way: without this guard, anything importing a predicate from here
 *  would start a real monitor — reading a manifest, dialling an RPC, polling forever — inside
 *  another process. Realpaths rather than raw strings, matching `cadence.ts`'s guard, because on
 *  Windows `process.argv[1]` and the module URL differ in drive-letter case and in short-name
 *  form, and a string comparison silently answers "no" for the one file it must answer "yes" for.
 */
const invokedDirectly = (() => {
  try {
    const self = realpathSync(fileURLToPath(import.meta.url));
    const argv = process.argv[1];
    return argv !== undefined && realpathSync(argv) === self;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((err) => {
    console.error("FATAL", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
