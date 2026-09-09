/**
 *  Move `seasonWindows` — and NOTHING else — with one owner transaction.
 *
 *  `Population.setSeason` takes the whole eight-field struct and there is no partial
 *  setter (`Population.sol:1058`), so changing one number means restating the other
 *  seven. Restating them BY HAND is the hazard this script exists to remove: `rakeBps`
 *  and `prizeShareBps` are both `uint16` and swapping them turns a 2.5% rake into a 40%
 *  one, silently, with a successful receipt. Here the seven come from a live read inside
 *  this same run, so they cannot be mistyped — and after the send they are read BACK and
 *  every one is required to equal what went in. A green receipt is not the check; the
 *  re-read is.
 *
 *  DRY BY DEFAULT, like every other write path in this repo. Without `--broadcast` it
 *  reads, validates, SIMULATES against the deployed contract, and prints the diff — but
 *  sends nothing. It needs `PRIVATE_KEY` either way, because the simulation is only worth
 *  anything if it runs as the owner.
 *
 *    tsx scripts/set-season-windows.ts --to 20               # show me what you would do
 *    tsx scripts/set-season-windows.ts --to 20 --broadcast   # do it
 *    tsx scripts/set-season-windows.ts --to 24 --broadcast   # put it back afterwards
 *
 *  WHY ANYONE WOULD RUN THIS. `endSeason` needs `windowCount - seasonStartWindow >=
 *  seasonWindows`, and the ante is derived from the SAME clock — `(windowCount -
 *  seasonStartWindow) / levelWindows` doublings of `baseAnte`. So the end of a season is
 *  also the most expensive part of it, and a population that has drifted past the level
 *  its treasuries can post is stuck: it cannot pair, and it cannot reach the close that
 *  would reset the ante. Lowering `seasonWindows` to a value the clock has already passed
 *  brings that close forward. It is the owner knob for recalibration the contract
 *  documents at `setSeason`, used for exactly what it is for.
 *
 *  It deliberately does NOT call `endSeason` itself. That is permissionless, `cadence`
 *  already re-derives it every tick before the phase switch (`cadence.ts:272`), and a
 *  close bundled into an owner script would hide which of the two actually did it.
 */
import "dotenv/config";
import {
  explorerTx,
  fmt,
  log,
  manifest,
  populationAbi,
  publicClient,
  wallet,
  warn,
  type Manifest,
} from "./lib/darwin.js";

/** The eight fields of `Population.SeasonParams`, in declaration order. */
type SeasonParams = {
  minEndowment: bigint;
  cognitionEndowment: bigint;
  baseAnte: bigint;
  anteMultBps: number;
  levelWindows: number;
  seasonWindows: number;
  rakeBps: number;
  prizeShareBps: number;
};

const ORDER = [
  "minEndowment",
  "cognitionEndowment",
  "baseAnte",
  "anteMultBps",
  "levelWindows",
  "seasonWindows",
  "rakeBps",
  "prizeShareBps",
] as const satisfies readonly (keyof SeasonParams)[];

async function readSeason(m: Manifest): Promise<SeasonParams> {
  const P = { address: m.population, abi: populationAbi } as const;
  const [minEndowment, cognitionEndowment, baseAnte, anteMultBps, levelWindows, seasonWindows, rakeBps, prizeShareBps] =
    await Promise.all([
      publicClient.readContract({ ...P, functionName: "minEndowment" }),
      publicClient.readContract({ ...P, functionName: "cognitionEndowment" }),
      publicClient.readContract({ ...P, functionName: "baseAnte" }),
      publicClient.readContract({ ...P, functionName: "anteMultBps" }),
      publicClient.readContract({ ...P, functionName: "levelWindows" }),
      publicClient.readContract({ ...P, functionName: "seasonWindows" }),
      publicClient.readContract({ ...P, functionName: "rakeBps" }),
      publicClient.readContract({ ...P, functionName: "prizeShareBps" }),
    ]);
  return {
    minEndowment: BigInt(minEndowment),
    cognitionEndowment: BigInt(cognitionEndowment),
    baseAnte: BigInt(baseAnte),
    anteMultBps: Number(anteMultBps),
    levelWindows: Number(levelWindows),
    seasonWindows: Number(seasonWindows),
    rakeBps: Number(rakeBps),
    prizeShareBps: Number(prizeShareBps),
  };
}

/**
 *  `setSeason`'s own guards, restated here so a bad value is refused BEFORE it costs gas
 *  and before it can be blamed on the chain. Mirrored from `Population.sol:1059-1069`; if
 *  that list ever grows, this one is stale and the send will simply revert, which is the
 *  safe direction for a mirror to fail in.
 */
function validate(s: SeasonParams, minStake: bigint): string[] {
  const bad: string[] = [];
  if (s.levelWindows === 0) bad.push("levelWindows == 0 → BadSeason");
  if (s.seasonWindows === 0) bad.push("seasonWindows == 0 → BadSeason");
  if (s.anteMultBps < 10_000) bad.push(`anteMultBps ${s.anteMultBps} < 10000 → BadSeason`);
  if (s.rakeBps > 10_000) bad.push(`rakeBps ${s.rakeBps} > 10000 → BadSeason`);
  if (s.prizeShareBps > 10_000) bad.push(`prizeShareBps ${s.prizeShareBps} > 10000 → BadSeason`);
  if (s.baseAnte < minStake) bad.push(`baseAnte ${s.baseAnte} < minStake ${minStake} → StakeFloorAboveAnte`);
  return bad;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

async function main() {
  const broadcast = process.argv.includes("--broadcast");
  const raw = arg("--to");
  if (raw === undefined) throw new Error("--to <n> is required, e.g. --to 20");
  const to = Number(raw);
  if (!Number.isInteger(to) || to <= 0 || to > 0xffff_ffff) {
    throw new Error(`--to must be a positive uint32, got ${raw}`);
  }

  const m = manifest();
  const P = { address: m.population, abi: populationAbi } as const;

  const [live, phase, windowCount, seasonStartWindow, seasonId, minStake, level, ante, prizePool] = await Promise.all([
    readSeason(m),
    publicClient.readContract({ ...P, functionName: "phase" }),
    publicClient.readContract({ ...P, functionName: "windowCount" }),
    publicClient.readContract({ ...P, functionName: "seasonStartWindow" }),
    publicClient.readContract({ ...P, functionName: "seasonId" }),
    publicClient.readContract({ ...P, functionName: "minStake" }),
    publicClient.readContract({ ...P, functionName: "level" }),
    publicClient.readContract({ ...P, functionName: "ante" }),
    publicClient.readContract({ ...P, functionName: "prizePool" }),
  ]);

  const elapsed = BigInt(windowCount) - BigInt(seasonStartWindow);
  const d = m.collateralDecimals;

  log(`Population ${m.population}`);
  log(`  season ${seasonId} · window ${windowCount} · opened ${seasonStartWindow} · elapsed ${elapsed}`);
  log(`  phase ${phase} · level ${level} · ante ${fmt(BigInt(ante), d, 4)} tUSDC · pool ${fmt(BigInt(prizePool), d, 4)}`);

  /**
   *  PHASE 0 ONLY, and this is a stop rather than a warning. `setSeason` is ungated on
   *  the phase by design, but every reason to run THIS script assumes no position is
   *  open: outside phase 0 there are organisms holding a paired position that was
   *  opened under the old clock, and a season boundary brought forward underneath them
   *  is a change to the terms of a bet already placed. Nothing in the contract forbids
   *  it; the operator should still not do it by accident.
   */
  if (Number(phase) !== 0) {
    warn(`phase is ${phase}, not 0 — a window is in flight with positions open. STOPPING.`);
    warn(`  let cadence finish the window (settleAll) and run this again in phase 0.`);
    process.exit(1);
  }

  if (live.seasonWindows === to) {
    log(`\n  seasonWindows is already ${to} — nothing to do.`);
    return;
  }

  const next: SeasonParams = { ...live, seasonWindows: to };

  log(`\n  setSeason — one field changes, the other seven are read from chain and restated:`);
  for (const k of ORDER) {
    const a = live[k];
    const b = next[k];
    const mark = a === b ? "   " : " → ";
    log(`    ${k.padEnd(20)} ${String(a).padStart(20)}${mark}${a === b ? "" : String(b)}`);
  }

  const bad = validate(next, BigInt(minStake));
  if (bad.length > 0) {
    warn(`\n  REFUSED — would revert:`);
    for (const b of bad) warn(`    ${b}`);
    process.exit(1);
  }
  log(`\n  all six guards pass (BadSeason x5, StakeFloorAboveAnte)`);

  const wasOver = elapsed >= BigInt(live.seasonWindows);
  const willBeOver = elapsed >= BigInt(to);
  log(`  endSeason callable   ${wasOver} → ${willBeOver}   (elapsed ${elapsed} >= seasonWindows)`);
  if (willBeOver && !wasOver) {
    log(`  after the close, seasonStartWindow becomes ${windowCount}, level 0, ante ${fmt(next.baseAnte, d, 4)} tUSDC`);
  }

  /**
   *  SIMULATE EVEN ON THE DRY RUN, and this is the point of the dry run rather than a
   *  nicety. The `validate()` above is a hand-written MIRROR of the contract's guards and
   *  can only ever be as current as the day it was copied; `eth_call` from the owner runs
   *  the real `setSeason` against real state, so `onlyOwner`, every revert this build
   *  actually has, and anything the mirror does not know about are all exercised for free.
   *  A dry run that passes here is a claim about the deployed contract, not about this file.
   */
  const { account, client } = wallet();
  const { request } = await publicClient.simulateContract({
    ...P,
    functionName: "setSeason",
    args: [next],
    account,
  });
  log(`  simulated clean from ${account.address} — the deployed contract accepts this struct`);

  if (!broadcast) {
    log(`\n  dry run — nothing sent. Re-run with --broadcast to send.`);
    return;
  }

  log(`\n  broadcasting as ${account.address}...`);
  const hash = await client.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`setSeason REVERTED: ${hash}`);
  log(`  ok ${explorerTx(hash)}`);

  /**
   *  THE ACTUAL CHECK. A successful receipt proves the transaction executed, not that it
   *  wrote what was intended — a struct assembled in the wrong order produces exactly the
   *  same receipt. So every one of the eight is read back and compared, including the
   *  seven that were supposed to stay still.
   */
  const after = await readSeason(m);
  const drift = ORDER.filter((k) => after[k] !== next[k]);
  if (drift.length > 0) {
    warn(`\n  ✗ MISMATCH after write — the chain does not hold what was sent:`);
    for (const k of drift) warn(`    ${k}: sent ${next[k]}, chain has ${after[k]}`);
    process.exit(1);
  }
  log(`  ✓ all 8 fields verified on chain; the 7 untouched ones are byte-identical`);

  const [wc2, sw2] = await Promise.all([
    publicClient.readContract({ ...P, functionName: "windowCount" }),
    publicClient.readContract({ ...P, functionName: "seasonStartWindow" }),
  ]);
  const nowOver = BigInt(wc2) - BigInt(sw2) >= BigInt(after.seasonWindows);
  log(`  endSeason callable now: ${nowOver}`);
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
