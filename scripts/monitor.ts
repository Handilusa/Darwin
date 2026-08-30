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

  const phase = Number(phaseRaw);
  const window = windowRaw as bigint;
  const snap = snapRaw as readonly Snapshot[];
  const living = snap.filter((o) => !o.dead);

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
    `phase ${PHASE[phase] ?? phase} · window #${window} · alive ${living.length}/${snap.length} · ` +
      `gen ${generations} · runway ${worstRunway}w worst / ${fmt(cognition, 18, 3)} STT held · ` +
      `${fmt(coll, m.collateralDecimals, 2)} tUSDC`,
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

  /* 6. Collateral for future births. */
  const endowment = await publicClient.readContract({
    address: m.population,
    abi: populationAbi,
    functionName: "endowment",
  });
  if (coll < endowment) {
    alert(`Population holds less collateral than one endowment — the next birth will revert. Run: npm run fund -- --collateral 200`);
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
