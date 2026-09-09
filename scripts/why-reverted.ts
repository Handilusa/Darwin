/**
 *  Read-only post-mortem for one reverted transaction.
 *
 *  Re-runs the transaction as an `eth_call` AT THE BLOCK BEFORE IT LANDED — the only
 *  state under which its revert reason is the one it actually hit. Re-simulating against
 *  HEAD instead is the classic way to misdiagnose this class of failure: a price push
 *  goes stale, a phase moves on, and the second reason gets reported as the first.
 *
 *  Decodes the revert against every ABI this repo hand-writes, so a custom error reads as
 *  a sentence rather than a selector.
 *
 *  Sends nothing. Needs no key.
 *
 *  Usage:  tsx scripts/why-reverted.ts 0x<txhash>
 */
import "dotenv/config";
import { decodeErrorResult, decodeFunctionData, type Hex } from "viem";
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

const ABIS = [
  ["Population", populationAbi],
  ["Prophet", prophetAbi],
  ["PriceSource", priceSourceAbi],
  ["SelectionEngine", selectionEngineAbi],
  ["MarketsModule", marketsModuleAbi],
  ["BinaryMarket", binaryMarketAbi],
  ["ERC20", erc20Abi],
] as const;

/** Pull the revert payload out of whatever viem wrapped it in. */
function revertData(err: unknown): Hex | undefined {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const rec = cur as Record<string, unknown>;
    if (typeof rec.data === "string" && rec.data.startsWith("0x") && rec.data.length > 2) return rec.data as Hex;
    cur = rec.cause;
  }
  // Some RPCs only put it in the human-readable blob. Scrape it — but a blob also contains
  // the `from` and `to` ADDRESSES, and a 42-char address matches any loose hex regex, which
  // is how a sender address gets reported as a revert selector. An ABI-encoded revert is a
  // 4-byte selector plus whole 32-byte words, so its hex length is always 10 + 64k; an
  // address (42) never is. That shape check is the whole filter.
  const blob = err instanceof Error ? `${err.message}` : String(err);
  for (const cand of blob.match(/0x[0-9a-fA-F]{8,}/g) ?? []) {
    if ((cand.length - 10) % 64 === 0) return cand as Hex;
  }
  return undefined;
}

function describeSelector(data: Hex, kind: "function" | "error"): string {
  for (const [name, abi] of ABIS) {
    try {
      if (kind === "function") {
        const d = decodeFunctionData({ abi: abi as never, data });
        return `${name}.${d.functionName}(${(d.args ?? []).map(String).join(", ")})`;
      }
      const d = decodeErrorResult({ abi: abi as never, data });
      return `${name}: ${d.errorName}(${(d.args ?? []).map(String).join(", ")})`;
    } catch {
      /* not this ABI */
    }
  }
  return `unrecognised ${kind} ${data.slice(0, 10)}`;
}

async function main() {
  const hash = process.argv[2] as Hex | undefined;
  if (!hash || !hash.startsWith("0x")) throw new Error("usage: tsx scripts/why-reverted.ts 0x<txhash>");

  const m = manifest();
  // Built from whatever the manifest actually holds rather than a hand-listed set of
  // fields: every address in it gets labelled, so a contract added to the deployment
  // shows up here by name without this file needing to know it exists.
  const known = new Map<string, string>();
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) known.set(v.toLowerCase(), k);
  }

  const [tx, receipt] = await Promise.all([
    publicClient.getTransaction({ hash }),
    publicClient.getTransactionReceipt({ hash }),
  ]);

  const to = (tx.to ?? "0x") as Hex;
  console.log(`tx      ${hash}`);
  console.log(`  from    ${tx.from}`);
  console.log(`  to      ${to}  ${known.get(to.toLowerCase()) ?? "(unknown contract)"}`);
  console.log(`  block   ${receipt.blockNumber}`);
  console.log(`  status  ${receipt.status}`);
  console.log(`  gasUsed ${receipt.gasUsed} of ${tx.gas} requested`);
  console.log(`  calling ${describeSelector(tx.input as Hex, "function")}`);

  /**
   *  TWO REPLAYS, AND THE PAIR IS THE MEASUREMENT — one replay cannot tell the two
   *  candidate causes apart.
   *
   *  `eth_call` with no `gas` field is given the node's default allowance, which is far
   *  above any driver call's limit. So a replay that succeeds without a limit proves only
   *  that the transaction works WHEN GAS IS NOT THE CONSTRAINT — which is exactly what a
   *  gas failure looks like, and exactly what a same-block-state failure looks like too.
   *
   *  Replaying a second time with the transaction's OWN limit separates them:
   *
   *    reverts with limit, succeeds without  → gas. The limit is too small.
   *    succeeds both ways                    → state moved inside its own block.
   *    reverts both ways                     → an ordinary logical revert; read the error.
   */
  const at = receipt.blockNumber - 1n;
  const replay = async (gas?: bigint) => {
    try {
      await publicClient.call({ to, data: tx.input, account: tx.from, value: tx.value, blockNumber: at, gas });
      return { ok: true as const };
    } catch (err) {
      const data = revertData(err);
      return {
        ok: false as const,
        why:
          data && data.length >= 10
            ? `${describeSelector(data, "error")}  [${data.slice(0, 10)}]`
            : `no decodable payload — ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      };
    }
  };

  console.log(`\n  replaying as eth_call at block ${at} (the state it actually ran against):`);
  const capped = await replay(tx.gas);
  const uncapped = await replay(undefined);
  console.log(`    with its own gas limit (${tx.gas}): ${capped.ok ? "SUCCEEDED" : `reverted — ${capped.why}`}`);
  console.log(`    with no gas limit:              ${uncapped.ok ? "SUCCEEDED" : `reverted — ${uncapped.why}`}`);

  console.log();
  if (!capped.ok && uncapped.ok) {
    console.log(`  VERDICT: GAS. The work fits; the limit does not. Raise it in scripts/lib/gas.ts.`);
  } else if (capped.ok && uncapped.ok) {
    console.log(`  VERDICT: SAME-BLOCK STATE. Something in its own block moved under it.`);
  } else if (!capped.ok && !uncapped.ok) {
    console.log(`  VERDICT: LOGICAL REVERT, independent of gas. The error above is the real one.`);
  } else {
    console.log(`  VERDICT: succeeded capped but not uncapped — implausible; treat both lines as suspect.`);
  }

  // Where the machine sits NOW, so the fault can be told apart from its aftermath.
  const P = { address: m.population, abi: populationAbi } as const;
  const [phase, windowCount, seasonId, seasonStartWindow, level, ante] = await Promise.all([
    publicClient.readContract({ ...P, functionName: "phase" }),
    publicClient.readContract({ ...P, functionName: "windowCount" }),
    publicClient.readContract({ ...P, functionName: "seasonId" }),
    publicClient.readContract({ ...P, functionName: "seasonStartWindow" }),
    publicClient.readContract({ ...P, functionName: "level" }),
    publicClient.readContract({ ...P, functionName: "ante" }),
  ]);
  console.log(
    `\n  now: phase ${phase} · window ${windowCount} · season ${seasonId} ` +
      `· opened ${seasonStartWindow} · level ${level} · ante ${Number(ante) / 1e6} tUSDC`,
  );
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
