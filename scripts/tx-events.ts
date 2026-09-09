/**
 *  Decode every log in one transaction against the ABIs this repo hand-writes.
 *
 *  The explorer shows raw topics for custom events, and the interesting events in this
 *  system are all custom — `Believed`, `Paired`, `Unpaired`, `Settled`, `CommitFailed`,
 *  `CognitionUnspent`. A window's real outcome is in its logs and nowhere else: a
 *  successful receipt says the driver call ran, not what the population did.
 *
 *  Sends nothing. Needs no key.
 *
 *    tsx scripts/tx-events.ts 0x<txhash>
 *    tsx scripts/tx-events.ts 0x<txhash> --counts    # just the tally
 */
import "dotenv/config";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { decodeEventLog, type Abi, type AbiEvent, type Hex } from "viem";
import {
  binaryMarketAbi,
  erc20Abi,
  manifest,
  marketsModuleAbi,
  populationAbi,
  priceSourceAbi,
  prophetAbi,
  publicClient,
  selectionEngineAbi,
} from "./lib/darwin.js";

const ABIS: [string, unknown][] = [
  ["Population", populationAbi],
  ["Prophet", prophetAbi],
  ["SelectionEngine", selectionEngineAbi],
  ["PriceSource", priceSourceAbi],
  ["MarketsModule", marketsModuleAbi],
  ["BinaryMarket", binaryMarketAbi],
  ["ERC20", erc20Abi],
];

/**
 *  Every event the repo COMPILES, as a fallback behind the hand-written fragments above.
 *
 *  `lib/darwin.ts` carries only the fragments the operational scripts call, and that is
 *  deliberate — it is guarded by `abi:check` against drift. But a transaction emits
 *  whatever the contracts emit, including events no script ever reads, and those come back
 *  from this tool as `unknown 0x…` — which is exactly as useless as the explorer. Reading
 *  `contracts/out` closes that gap without widening the hand-written surface that
 *  `abi:check` has to police.
 *
 *  Returns an empty ABI when the project has not been built. That degrades this tool back
 *  to hand-written coverage rather than failing, because a post-mortem should still run on
 *  a machine with no toolchain.
 */
function artifactEventAbi(): Abi {
  const out = resolve(process.cwd(), "contracts", "out");
  if (!existsSync(out)) return [];
  const seen = new Set<string>();
  // `AbiEvent[]`, not `Abi`: viem's `Abi` is a READONLY array, so it has no `.push`. The
  // narrower mutable type builds the list and still satisfies the `Abi` return.
  const events: AbiEvent[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "build-info") walk(p);
      } else if (e.name.endsWith(".json")) {
        try {
          const abi = JSON.parse(readFileSync(p, "utf8")).abi;
          if (!Array.isArray(abi)) continue;
          for (const item of abi) {
            if (item?.type !== "event") continue;
            const sig = `${item.name}(${(item.inputs ?? []).map((i: { type: string }) => i.type).join(",")})`;
            if (seen.has(sig)) continue;
            seen.add(sig);
            events.push(item as AbiEvent);
          }
        } catch {
          /* not an artifact */
        }
      }
    }
  };
  walk(out);
  return events;
}

function show(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string" && v.length > 26) return `${v.slice(0, 10)}…${v.slice(-6)}`;
  return String(v);
}

async function main() {
  const hash = process.argv[2] as Hex | undefined;
  if (!hash?.startsWith("0x")) throw new Error("usage: tsx scripts/tx-events.ts 0x<txhash> [--counts]");
  const countsOnly = process.argv.includes("--counts");

  const m = manifest();
  const label = new Map<string, string>();
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) label.set(v.toLowerCase(), k);
  }

  const receipt = await publicClient.getTransactionReceipt({ hash });
  const fallback = artifactEventAbi();
  const pool: [string, unknown][] = [...ABIS, ["artifact", fallback]];
  console.log(`tx ${hash}`);
  console.log(
    `  block ${receipt.blockNumber} · status ${receipt.status} · gasUsed ${receipt.gasUsed} · ${receipt.logs.length} logs` +
      `${fallback.length > 0 ? ` · ${fallback.length} compiled events available` : ` · contracts/out not built`}\n`,
  );

  const counts = new Map<string, number>();
  for (const lg of receipt.logs) {
    let line = `  ${(label.get(lg.address.toLowerCase()) ?? lg.address).padEnd(16)}`;
    let named = false;
    for (const [, abi] of pool) {
      try {
        const d = decodeEventLog({ abi: abi as Abi, topics: lg.topics as never, data: lg.data, strict: false });
        const args = d.args as Record<string, unknown> | readonly unknown[] | undefined;
        const parts = Array.isArray(args)
          ? args.map(show)
          : Object.entries((args ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}=${show(v)}`);
        line += `${d.eventName}(${parts.join(", ")})`;
        counts.set(d.eventName ?? "unnamed", (counts.get(d.eventName ?? "unnamed") ?? 0) + 1);
        named = true;
        break;
      } catch {
        /* not this ABI */
      }
    }
    if (!named) {
      const t0 = lg.topics[0] ?? "0x";
      line += `unknown ${t0.slice(0, 10)}`;
      counts.set(`unknown ${t0.slice(0, 10)}`, (counts.get(`unknown ${t0.slice(0, 10)}`) ?? 0) + 1);
    }
    if (!countsOnly) console.log(line);
  }

  console.log(`\n  tally:`);
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)} × ${k}`);
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
