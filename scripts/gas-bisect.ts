/**
 *  Measure what a driver call actually needs, by bisection, against a predicate the gas
 *  estimator cannot express.
 *
 *  WHY NOT `eth_estimateGas`. The estimator bisects on one question: did the call revert?
 *  For every driver call in this contract that question is the wrong one, because the
 *  per-organism work is wrapped in `try/catch` and the phase advances regardless
 *  (`Population.sol:1503-1529`). Starve `think()` and it does not revert — it emits
 *  `ThinkFailed` for the organisms it could not afford and returns success. The estimator
 *  sees success and reports that gas as sufficient. It is sufficient only for a window in
 *  which most of the population silently did not think. That is the whole reason
 *  `lib/gas.ts` carries a hand-written table instead of calling the estimator.
 *
 *  WHAT THIS DOES INSTEAD. It bisects on the LOG PROFILE. First it runs the call at the
 *  block gas ceiling to obtain a reference profile — every event the call emits, by name,
 *  with counts. Then it finds the smallest gas whose profile is IDENTICAL to that
 *  reference. Not "did it revert" but "did it do the same work".
 *
 *  Comparing against the reference rather than against a hardcoded zero-failures rule is
 *  what makes this correct for all four calls. `CommitFailed` and `ThinkFailed` also fire
 *  for honest economic reasons — an organism that cannot afford the deposit abstains, and
 *  that abstention belongs in the reference profile. What must not change with gas is the
 *  profile itself. Anything that appears only as gas falls is the artefact being hunted.
 *
 *  It needs `eth_simulateV1` for the logs. Where the RPC does not offer it the tool falls
 *  back to bisecting `eth_call` on revert — which is the estimator's own predicate, and is
 *  therefore reported as a FLOOR ONLY, loudly, because for `think` it is not sufficiency.
 *
 *  Sends nothing. Every request is a simulation.
 *
 *    tsx scripts/gas-bisect.ts think
 *    tsx scripts/gas-bisect.ts think --block 483919080     # against historical state
 */
import "dotenv/config";
import { decodeEventLog, encodeFunctionData, type Abi, type Hex } from "viem";
import { log, manifest, populationAbi, prophetAbi, publicClient, wallet, warn } from "./lib/darwin.js";
import { BLOCK_GAS_CEILING, driverGas, type DriverCall } from "./lib/gas.js";

const CALLS = {
  think: "think",
  commit: "commitAll",
  settle: "settleAll",
  hatch: "hatchAll",
} as const satisfies Record<DriverCall, string>;

/** An event profile: name → how many times it fired. Order-insensitive by construction. */
type Profile = Map<string, number>;
type Run = { ok: boolean; profile: Profile; gasUsed: bigint; revert?: string };

function sameProfile(a: Profile, b: Profile): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

function showProfile(p: Profile): string {
  if (p.size === 0) return "(no events)";
  return [...p.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => `${k}×${v}`).join("  ");
}

/** Name a log against the ABIs this repo hand-writes; fall back to its topic0. */
function nameOf(topics: readonly Hex[], data: Hex): string {
  for (const abi of [populationAbi, prophetAbi] as unknown as Abi[]) {
    try {
      return decodeEventLog({ abi, topics: topics as never, data, strict: false }).eventName ?? "unnamed";
    } catch {
      /* not this ABI */
    }
  }
  return `unknown(${(topics[0] ?? "0x").slice(0, 10)})`;
}

async function main() {
  const which = (process.argv[2] ?? "") as DriverCall;
  if (!(which in CALLS)) throw new Error(`usage: tsx scripts/gas-bisect.ts <think|commit|settle|hatch> [--block <n>]`);
  const bi = process.argv.indexOf("--block");
  const at = bi === -1 ? undefined : BigInt(process.argv[bi + 1] ?? "0");

  const m = manifest();
  const P = { address: m.population, abi: populationAbi } as const;
  const { account } = wallet();
  const data = encodeFunctionData({ abi: populationAbi, functionName: CALLS[which] });

  const [phase, windowCount, alive] = await Promise.all([
    publicClient.readContract({ ...P, functionName: "phase" }),
    publicClient.readContract({ ...P, functionName: "windowCount" }),
    publicClient.readContract({ ...P, functionName: "aliveCount" }),
  ]);

  log(`Population ${m.population}`);
  log(`  measuring ${CALLS[which]}() as ${account.address}`);
  log(`  phase ${phase} · window ${windowCount} · alive ${alive}${at === undefined ? " · at HEAD" : ` · at block ${at}`}`);

  const plan = driverGas(which, BigInt(alive));
  log(`  lib/gas.ts currently sends ${plan.gas}${plan.capped ? ` (capped from ${plan.wanted})` : ""}\n`);

  /** One simulated run at a fixed gas limit. Prefers eth_simulateV1 so logs come back. */
  let viaSimulate = true;
  const run = async (gas: bigint): Promise<Run> => {
    if (viaSimulate) {
      try {
        const { results } = await publicClient.simulateCalls({
          account: account.address,
          // viem's `Call` type has no per-call gas field; `eth_simulateV1` accepts one and
          // it is the entire point of this tool, so it goes past the type deliberately.
          calls: [{ to: m.population, data, gas } as never],
          ...(at === undefined ? {} : { blockNumber: at }),
        });
        const r = results[0] as { status: string; logs?: readonly { topics: readonly Hex[]; data: Hex }[]; gasUsed?: bigint } | undefined;
        if (!r) throw new Error("eth_simulateV1 returned no result");
        const profile: Profile = new Map();
        for (const lg of r.logs ?? []) {
          const n = nameOf(lg.topics as readonly Hex[], lg.data as Hex);
          profile.set(n, (profile.get(n) ?? 0) + 1);
        }
        return { ok: r.status === "success", profile, gasUsed: BigInt(r.gasUsed ?? 0n) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not (be )?(supported|available)|method .* not found|unsupported method|-32601/i.test(msg)) {
          warn(`  eth_simulateV1 unavailable — falling back to eth_call bisection on REVERT ONLY.`);
          warn(`  For ${CALLS[which]}() that is the estimator's own predicate: a FLOOR, not sufficiency.\n`);
          viaSimulate = false;
        } else {
          throw err;
        }
      }
    }
    try {
      await publicClient.call({ to: m.population, data, account: account.address, gas, ...(at === undefined ? {} : { blockNumber: at }) });
      return { ok: true, profile: new Map(), gasUsed: 0n };
    } catch (err) {
      return { ok: false, profile: new Map(), gasUsed: 0n, revert: err instanceof Error ? err.message.split("\n")[0] : String(err) };
    }
  };

  // THE REFERENCE. Everything below is measured against what the call does when gas is
  // not the constraint. If it cannot even do that, the fault is not gas and bisecting
  // would just be finding the cheapest way to fail.
  const ref = await run(BLOCK_GAS_CEILING);
  if (!ref.ok) {
    warn(`  at the full ${BLOCK_GAS_CEILING} block ceiling the call still fails:`);
    warn(`    ${ref.revert ?? showProfile(ref.profile)}`);
    warn(`  this is not a gas problem. Nothing to bisect.`);
    process.exit(1);
  }
  log(`  reference at ${BLOCK_GAS_CEILING}: ${showProfile(ref.profile)}`);
  if (viaSimulate) log(`  reference gasUsed: ${ref.gasUsed}`);

  const good = (r: Run) => r.ok && (!viaSimulate || sameProfile(r.profile, ref.profile));

  // Bisect for the smallest gas that reproduces the reference exactly.
  let lo = 21_000n; // assumed bad
  let hi = BLOCK_GAS_CEILING; // known good
  let probes = 0;
  while (hi - lo > 5_000n) {
    const mid = (lo + hi) / 2n;
    const r = await run(mid);
    probes += 1;
    const verdict = r.ok ? (good(r) ? "full" : `DEGRADED ${showProfile(r.profile)}`) : "reverted";
    log(`    ${String(mid).padStart(10)}  ${verdict}`);
    if (good(r)) hi = mid;
    else lo = mid;
  }

  log(`\n  minimum gas for a FULL ${CALLS[which]}(): ${hi}   (${probes} probes)`);
  if (viaSimulate) {
    log(`  the estimator's answer would have been the smallest non-reverting gas, which may be far below this.`);
  }

  const n = BigInt(alive) > 0n ? BigInt(alive) : 1n;
  const headroom = (plan.gas * 100n) / hi;
  log(`\n  lib/gas.ts sends ${plan.gas} → ${headroom}% of measured need`);
  if (plan.gas < hi) {
    warn(`  ✗ TOO LOW by ${hi - plan.gas}. ${CALLS[which]}() cannot complete at ${alive} organisms.`);
    const want = ((hi * 2n) / n / 100_000n + 1n) * 100_000n; // 2x measured, per organism, rounded up to 100k
    warn(`  suggestion: PER_ORGANISM.${which} = ${want}n  → ${driverGas(which, n).gas - plan.gas + want * n}`);
  } else if (headroom < 150n) {
    warn(`  ⚠ only ${headroom}% — thin. A window whose organisms all respond costs more than one where they abstain.`);
  } else {
    log(`  ✓ comfortable`);
  }
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
