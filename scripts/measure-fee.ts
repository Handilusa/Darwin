/**
 *  The load-bearing economic measurement.
 *
 *    npm run fee                      # newest of this population's own settled windows
 *    npm run fee -- --pool 0x…        # a specific pool
 *    npm run fee -- --key 0x…         # a specific marketKey, straight from a settlement log
 *    npm run fee -- --windows 8       # try the last N of our windows until one answers
 *
 *  DARWIN's whole selection story rests on one number being zero.
 *
 *  The argument: DreamDEX charges no maker, taker or settlement fee, so a coin-flipping
 *  forecaster has *zero* expected drift. Nothing in the market kills a bad organism. The
 *  only cost it cannot avoid is the cost of having thought — so metered cognition is the
 *  only selection pressure in the system, and metabolism alone decides who dies.
 *
 *  If `settlementFeeBpsTimes1k` is not zero, that argument is false in a specific and
 *  fixable way: the market itself now drains every organism in proportion to position
 *  size, cognition is no longer the only pressure, and whether it is even the *dominant*
 *  one becomes an arithmetic question. This script does that arithmetic. The docs say the
 *  fee is zero; the settlement struct has a fee field anyway; a claim this central is not
 *  something to take on documentation.
 *
 *  HOW THE marketKey IS OBTAINED. `getSettlement` is keyed by `marketKey`. `finalize(pool)`
 *  returns one, and is run here through `eth_call` simulation so nothing is broadcast and no
 *  market is finalized as a side effect of measuring it. That simulation only succeeds on a
 *  market that is actually finalizable, so `--key` takes one directly instead: the key is
 *  `(uint256(uint160(pool)) << 64) | nonce`, which is exactly topic1 of a settlement log.
 */
import { fmt, log, manifest, populationAbi, publicClient, warn, type Manifest } from "./lib/darwin.js";
import { scanRange } from "./lib/logscan.js";
import { parseAbi, parseAbiItem, type Address } from "viem";

/**
 *  `getSettlement` returns ONE DYNAMIC STRUCT, not nine flat values — note the extra
 *  parentheses. Measured on Shannon 2026-08-29: the raw returndata begins `0x…0020`,
 *  the offset word that a single dynamic return value carries. Declaring it flat shifts
 *  every field by exactly one word (`flat[i + 1] == struct[i]`), and both resulting
 *  failure modes are silent:
 *
 *    - a settled market whose backing has been redeemed to 0 reads `finalized` from
 *      `backing == 0` => "not finalized yet", and the fee is never measured at all;
 *    - a market with non-zero backing reads `finalized` truthy and the fee from
 *      `voided == false` => `0`, and the script prints
 *      "PASS — settlementFeeBpsTimes1k == 0" WITHOUT EVER READING THE FEE FIELD.
 *
 *  The second is the dangerous one: an honesty gate that confirms itself. Verified
 *  against marketKey 0x…0547acf6…0140 (pool 0x0547ACF6…, nonce 320), where the struct
 *  decode gives finalized=true / voided=false / fee=0 and the flat decode gives
 *  finalized=false. This shape is load-bearing. Do not flatten it.
 */
const settlementAbi = parseAbi([
  "function finalize(address pool) returns (uint256 marketKey)",
  "function getSettlement(uint256 marketKey) view returns ((address collateralToken, uint128 backing, bool finalized, bool voided, uint256 settlementFeeBpsTimes1k, address feeRecipient, address pool, uint64 nonce, uint256[] payoutNumerators))",
]);

const WINDOW_OPENED = parseAbiItem(
  "event WindowOpened(uint64 indexed window, bytes32 indexed marketId, address pool, uint256 openPrice)",
);

/**
 *  Block paging now lives in `lib/logscan.ts` — see `LOG_SPAN` there for the measurement.
 *
 *  This file used to own a `const CHUNK`, first as `9_000n` (nine times over dream-rpc's real
 *  cap, which made `npm run fee` fail on its first call) and then as a corrected `1_000n`
 *  copied into three scripts. The shared helper shrinks on refusal, retries transient
 *  failures, and has a self-test that runs with no chain (`npx tsx scripts/lib/logscan.ts`).
 */

/** `settlementFeeBpsTimes1k` is basis points x1000, so a fraction is /1e7. */
const FEE_DENOMINATOR = 10_000_000n;

async function main(): Promise<void> {
  const m = manifest();
  const explicitKey = arg("--key");
  const explicit = arg("--pool") as Address | undefined;
  const tries = Number(arg("--windows") ?? "8");

  // A marketKey lifted straight out of a settlement log skips the `finalize(pool)`
  // simulation, so the gate can be run against any market the venue has already
  // settled — including one this population never traded. Measured on Shannon:
  //   marketKey == (uint256(uint160(pool)) << 64) | nonce
  // so the pool is recoverable from the key and nothing else is needed.
  if (explicitKey !== undefined) {
    const key = BigInt(explicitKey);
    const pool = `0x${((key >> 64n) & ((1n << 160n) - 1n)).toString(16).padStart(40, "0")}` as Address;
    if (!(await measure(m, pool, key))) process.exitCode = 1;
    return;
  }

  const pools = explicit ? [explicit] : await recentPools(m, tries);
  if (pools.length === 0) {
    throw new Error(
      "no pools to measure. Either pass --pool 0x…, or run the cadence through at least one\n" +
        "window so this population has a WindowOpened log to work from.",
    );
  }

  for (const pool of pools) {
    const key = await marketKey(m, pool);
    if (key === undefined) {
      log(`pool ${pool} — finalize() does not simulate (not expired, or already closed out). Next.`);
      continue;
    }
    const done = await measure(m, pool, key);
    if (done) return;
  }

  warn(
    `none of the ${pools.length} pool(s) tried returned a finalized settlement.\n` +
      `  The measurement is still OUTSTANDING — do not repeat the zero-fee claim until it is made.`,
  );
  process.exitCode = 1;
}

/*//////////////////////////////////////////////////////////////
                          THE MEASUREMENT
//////////////////////////////////////////////////////////////*/

async function measure(m: Manifest, pool: Address, key: bigint): Promise<boolean> {
  const s = await publicClient.readContract({
    address: m.settlement,
    abi: settlementAbi,
    functionName: "getSettlement",
    args: [key],
  });

  const {
    collateralToken,
    backing,
    finalized,
    voided,
    settlementFeeBpsTimes1k: feeBpsTimes1k,
    feeRecipient,
    pool: recordedPool,
    nonce,
    payoutNumerators: payouts,
  } = s;

  if (!finalized) {
    log(`pool ${pool} — settlement exists but is not finalized yet. Next.`);
    return false;
  }

  const dec = m.collateralDecimals;

  console.log("");
  console.log("=== SETTLEMENT ==============================================");
  console.log(`pool             ${recordedPool}`);
  console.log(`marketKey        ${key}`);
  console.log(`collateral       ${collateralToken}`);
  console.log(`backing          ${fmt(backing, dec, 6)}`);
  console.log(`finalized        ${finalized}`);
  console.log(`voided           ${voided}`);
  console.log(`nonce            ${nonce}`);
  console.log(`payoutNumerators [${payouts.join(", ")}]`);
  console.log(`feeRecipient     ${feeRecipient}`);
  console.log(`settlementFee    ${feeBpsTimes1k}  (bps x1000)`);
  console.log("=============================================================");

  // The void claim, checked while we are here: a voided market is documented to pay both
  // sides 0.5, and `Prophet` treats void as neutral rather than as a loss on that basis.
  if (voided) {
    const equal = payouts.length === 2 && payouts[0] === payouts[1];
    console.log("");
    if (equal) {
      log(`void confirmed: payout vector is equal on both sides — neutral fitness is correct.`);
    } else {
      warn(
        `VOIDED but the payout vector is [${payouts.join(", ")}], not equal halves.\n` +
          `  Prophet treats void as neutral. If this is asymmetric, that is wrong. Investigate.`,
      );
      process.exitCode = 1;
    }
  }

  console.log("");
  if (feeBpsTimes1k === 0n) {
    console.log("PASS — settlementFeeBpsTimes1k == 0.");
    console.log("       Zero settlement fee confirmed on a real finalized market. A coin-flipper");
    console.log("       has no expected drift, so metered cognition is the only selection");
    console.log("       pressure in the system. The economic claim is measured, not assumed.");
    return true;
  }

  await recalibrate(m, feeBpsTimes1k);
  return true;
}

/**
 *  What a non-zero fee actually costs the argument.
 *
 *  Not a warning but a calculation, because "the fee is not zero" on its own does not tell
 *  you whether the thesis is dead or merely imprecise. The comparison that matters is fee
 *  drag per window against metabolic cost per window: if the fee dominates, the market is
 *  the selector and cognition is decoration.
 */
async function recalibrate(m: Manifest, feeBpsTimes1k: bigint): Promise<void> {
  const [endowment, metabolism] = await Promise.all([
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "endowment" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "metabolicCost" }),
  ]);

  const dec = m.collateralDecimals;
  const dragOnEndowment = (endowment * feeBpsTimes1k) / FEE_DENOMINATOR;
  const bps = Number(feeBpsTimes1k) / 1000;

  console.error("");
  console.error(`FAIL — settlementFeeBpsTimes1k == ${feeBpsTimes1k} (${bps} bps), not zero.`);
  console.error("");
  console.error(`  fee on an endowment-sized stake   ${fmt(dragOnEndowment, dec, 6)}`);
  console.error(`  metabolic cost per window         ${fmt(metabolism, dec, 6)}`);
  console.error("");

  if (dragOnEndowment === 0n) {
    console.error("  At current position sizes the fee rounds to zero in collateral units, so the");
    console.error("  mechanism still works. But the sentence 'zero fees' is false — say 'negligible");
    console.error("  fees' and show this number.");
  } else if (dragOnEndowment > metabolism) {
    const ratio = Number(dragOnEndowment) / Number(metabolism);
    console.error(`  The market drains ${ratio.toFixed(1)}x more than metabolism does.`);
    console.error("  The thesis as written is WRONG: the market is the dominant selector, not");
    console.error("  cognition. Two options, and only these two:");
    console.error("    1. Raise metabolicCost until it dominates again (setEconomics), and say so.");
    console.error("    2. Change the claim to 'cognition is a selection pressure', not 'the only one'.");
    console.error("  Do not keep the current sentence. Renarrating a measured number is the one");
    console.error("  thing that would make this submission dishonest rather than merely wrong.");
  } else {
    const ratio = Number(metabolism) / Number(dragOnEndowment);
    console.error(`  Metabolism still dominates by ${ratio.toFixed(1)}x, so cognition remains the`);
    console.error("  primary pressure — but it is no longer the ONLY one. Adjust the wording to");
    console.error("  'the dominant selection pressure' and keep this number to hand.");
  }
  process.exitCode = 1;
}

/*//////////////////////////////////////////////////////////////
                             PLUMBING
//////////////////////////////////////////////////////////////*/

/** Simulate `finalize(pool)` to read back the marketKey without broadcasting anything. */
async function marketKey(m: Manifest, pool: Address): Promise<bigint | undefined> {
  try {
    const { result } = await publicClient.simulateContract({
      address: m.settlement,
      abi: settlementAbi,
      functionName: "finalize",
      args: [pool],
      account: m.owner,
    });
    return result;
  } catch {
    return undefined;
  }
}

/** This population's most recent windows, newest first. Every one had a real position. */
async function recentPools(m: Manifest, limit: number): Promise<Address[]> {
  const latest = await publicClient.getBlockNumber();
  const floor = BigInt(m.deployedAtBlock);
  const out: Address[] = [];

  // Backward, newest first, and it STOPS as soon as `limit` distinct pools have been collected
  // rather than sweeping every block since deployment. Accumulation happens in `onPage` because
  // the stop condition is a property of what has been gathered so far, not of the current page.
  await scanRange(
    floor,
    latest,
    (pageFrom, pageTo) =>
      publicClient.getLogs({
        address: m.population,
        event: WINDOW_OPENED,
        fromBlock: pageFrom,
        toBlock: pageTo,
      }),
    {
      direction: "backward",
      onPage: (logs) => {
        for (const l of [...logs].reverse()) {
          const pool = l.args.pool;
          if (pool && !out.includes(pool)) out.push(pool);
          if (out.length >= limit) return true;
        }
        return out.length >= limit;
      },
      onShrink: (at, span, reason) =>
        warn(`RPC refused the block range at ${at}; retrying with ${span}-block pages (${reason})`),
    },
  );

  log(`measuring against ${out.length} of this population's own recent pool(s)`);
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
