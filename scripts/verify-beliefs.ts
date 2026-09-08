/**
 *  Verification for HANDOVER_PRICE_FIX: check belief, lastReasoning, currentQuantity
 *  on a sample organism.
 *
 *  Usage:  tsx scripts/verify-beliefs.ts
 */
import "dotenv/config";
import {
  createPublicClient,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shannon = defineChain({
  id: 50312,
  name: "Somnia Shannon",
  nativeCurrency: { name: "Somnia", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.SOMNIA_RPC_URL ?? "https://dream-rpc.somnia.network"] },
  },
});

const publicClient = createPublicClient({ chain: shannon, transport: http() });

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "contracts", "deployments", "50312.json"), "utf8"),
);
const POPULATION = manifest.population as `0x${string}`;

const populationAbi = parseAbi([
  "function snapshot() view returns ((uint256 id,address addr,uint256 parentId,uint32 generation,uint256 treasury,uint32 streak,uint32 windowsLived,uint32 correctCount,uint32 wrongCount,uint32 abstainCount,uint64 birthWindow,uint64 deathWindow,bool dead,uint8 belief,uint8 thesis,bytes32 genomeHash)[])",
  "function windowCount() view returns (uint64)",
  "function phase() view returns (uint8)",
]);

const prophetAbi = parseAbi([
  "function belief() view returns (uint8)",
  "function lastReasoning() view returns (string)",
  "function currentQuantity() view returns (uint256)",
  "function currentStake() view returns (uint256)",
  "function pendingBeliefRequestId() view returns (uint256)",
]);

const BELIEF_NAMES = ["None", "Up", "Down", "Abstain"] as const;

async function main() {
  const [snap, window, phase] = await Promise.all([
    publicClient.readContract({ address: POPULATION, abi: populationAbi, functionName: "snapshot" }),
    publicClient.readContract({ address: POPULATION, abi: populationAbi, functionName: "windowCount" }),
    publicClient.readContract({ address: POPULATION, abi: populationAbi, functionName: "phase" }),
  ]);

  console.log(`\n=== VERIFICATION — window #${window}, phase ${phase} ===\n`);

  let anyBelief = false;
  let anyReasoning = false;
  let anyQuantity = false;

  for (const org of snap as any[]) {
    const addr = org.addr as `0x${string}`;
    const [belief, reasoning, quantity, stake] = await Promise.all([
      publicClient.readContract({ address: addr, abi: prophetAbi, functionName: "belief" }),
      publicClient.readContract({ address: addr, abi: prophetAbi, functionName: "lastReasoning" }),
      publicClient.readContract({ address: addr, abi: prophetAbi, functionName: "currentQuantity" }),
      publicClient.readContract({ address: addr, abi: prophetAbi, functionName: "currentStake" }),
    ]);

    const beliefName = BELIEF_NAMES[Number(belief)] ?? `unknown(${belief})`;
    const hasReasoning = reasoning !== "";
    const hasQuantity = quantity > 0n;

    if (belief !== 3) anyBelief = true;
    if (hasReasoning) anyReasoning = true;
    if (hasQuantity) anyQuantity = true;

    console.log(
      `  #${String(org.id).padStart(2)} | belief: ${beliefName.padEnd(7)} | ` +
      `reasoning: ${hasReasoning ? "YES" : "---"} | ` +
      `quantity: ${quantity > 0n ? String(quantity).padStart(10) : "         0"} | ` +
      `stake: ${stake > 0n ? String(stake).padStart(10) : "         0"} | ` +
      `abstains: ${org.abstainCount}`
    );
    if (hasReasoning) {
      const truncated = reasoning.length > 120 ? reasoning.slice(0, 120) + "…" : reasoning;
      console.log(`        "${truncated}"`);
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`  belief ≠ Abstain:     ${anyBelief ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  lastReasoning ≠ "":   ${anyReasoning ? "✓ PASS" : "✗ FAIL"}`);
  console.log(`  currentQuantity > 0:  ${anyQuantity ? "✓ PASS" : "✗ FAIL"}`);

  if (anyBelief && anyReasoning && anyQuantity) {
    console.log(`\n  ✓ ALL CHECKS PASS — the diagnosis was correct, organisms have real positions.`);
  } else if (anyBelief && anyReasoning && !anyQuantity) {
    console.log(`\n  ⚠ Organisms have beliefs and reasoning but no positions yet.`);
    console.log(`    This is expected before commit or if positions were settled already.`);
  } else {
    console.log(`\n  ✗ FAILED — investigate further.`);
    if (!anyBelief) console.log(`    All beliefs are Abstain — 0.07 STT may not be enough, try 0.15.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
