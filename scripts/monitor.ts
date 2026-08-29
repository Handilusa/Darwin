/**
 *  Soak monitor. Runs from the go-live to submission.
 *
 *    npm run monitor              # forever, one status line per poll
 *    npm run monitor -- --once    # one check; exit code 1 if anything is wrong (cron)
 *
 *  WHAT IT IS ACTUALLY WATCHING FOR. The dangerous failures in this system are all
 *  quiet. A population out of native SOMI does not crash — every organism fails to
 *  think, abstains, pays metabolism, and dies on schedule, producing a beautifully
 *  consistent record of nothing happening. A wedged phase does not crash either; it just
 *  stops advancing. Nothing here alerts on an exception, because the exceptions are not
 *  the problem: it alerts on the absence of progress.
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

  const [phaseRaw, windowRaw, alive, deposit, native, coll, snapRaw] = await Promise.all([
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "phase" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "windowCount" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "aliveCount" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "requestDeposit" }),
    publicClient.getBalance({ address: m.population }),
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

  const perWindow = (deposit as bigint) * (alive === 0n ? 1n : (alive as bigint));
  const runway = perWindow === 0n ? 0n : native / perWindow;
  const generations = snap.length === 0 ? 0 : Math.max(...snap.map((o) => o.generation));

  log(
    `phase ${PHASE[phase] ?? phase} · window #${window} · alive ${living.length}/${snap.length} · ` +
      `gen ${generations} · runway ${runway}w · ${fmt(coll, m.collateralDecimals, 2)} tUSDC`,
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

  /* 3. Cognition runway. The quiet killer. */
  if (runway < BigInt(MIN_RUNWAY)) {
    alert(
      `only ${runway} windows of inference runway (${fmt(native, 18, 4)} SOMI). Organisms that ` +
        `cannot think still pay metabolism. Run: npm run fund -- --windows 400`,
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

  if (alerts === 0) roll(snap, names, m.collateralDecimals);

  const advanced = seen === undefined || seen.phase !== phase || seen.window !== window;
  return {
    alerts,
    next: { phase, window, at: advanced ? now : seen.at },
  };
}

/** One compact line per organism, only when nothing is wrong. */
function roll(snap: readonly Snapshot[], names: Map<number, string>, decimals: number): void {
  for (const o of snap) {
    const id = Number(o.id);
    const state = o.dead ? `dead@${o.deathWindow}` : `${BELIEF[o.belief] ?? "?"}/${THESIS[o.thesis] ?? "?"}`;
    console.log(
      `    #${String(id).padStart(2)}${label(names, o.id).padEnd(11)} gen${o.generation} ` +
        `${o.correctCount}-${o.wrongCount}-${o.abstainCount} streak${o.streak} ` +
        `${fmt(o.treasury, decimals, 2).padStart(8)}  ${state}`,
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
