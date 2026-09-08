/**
 *  HANDOVER_PRICE_FIX step 1 & 2: setInference + verify requestDeposit.
 *
 *  Step 1: setInference(12847293847561029384, 70000000000000000, 3, 2, 300, false)
 *  Step 2: verify requestDeposit() == 240000000000000000
 *
 *  Usage:  tsx scripts/price-fix.ts
 */
import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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

const pk = process.env.PRIVATE_KEY;
if (!pk || !pk.startsWith("0x") || pk.length !== 66) {
  throw new Error("PRIVATE_KEY missing or malformed");
}
const account = privateKeyToAccount(pk as Hex);
const walletClient = createWalletClient({ account, chain: shannon, transport: http() });

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "contracts", "deployments", "50312.json"), "utf8"),
);
const POPULATION = manifest.population as `0x${string}`;

const abi = parseAbi([
  "function setInference(uint256 llmAgentId_, uint256 perAgentReward_, uint256 subcommitteeSize_, uint256 threshold_, uint256 requestTimeout_, bool chainOfThought_)",
  "function requestDeposit() view returns (uint256)",
  "function perAgentReward() view returns (uint256)",
  "function subcommitteeSize() view returns (uint256)",
  "function threshold() view returns (uint256)",
  "function requestTimeout() view returns (uint256)",
  "function chainOfThought() view returns (bool)",
  "function phase() view returns (uint8)",
]);

async function main() {
  console.log("=== PRICE FIX: Step 1 — setInference ===\n");

  // Read current values first
  const [curReward, curPhase] = await Promise.all([
    publicClient.readContract({ address: POPULATION, abi, functionName: "perAgentReward" }),
    publicClient.readContract({ address: POPULATION, abi, functionName: "phase" }),
  ]);
  console.log(`  phase:           ${curPhase}`);
  console.log(`  perAgentReward:  ${curReward} (${Number(curReward) / 1e18} STT)`);

  // Step 1: setInference
  const args = [
    12847293847561029384n,  // llmAgentId
    70000000000000000n,     // perAgentReward = 0.07 STT
    3n,                      // subcommitteeSize
    2n,                      // threshold
    300n,                    // requestTimeout
    false,                   // chainOfThought
  ] as const;

  console.log(`\n  Sending setInference(${args.join(", ")})...`);
  const hash = await walletClient.writeContract({
    address: POPULATION,
    abi,
    functionName: "setInference",
    args,
  });
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`setInference REVERTED: ${hash}`);
  }
  console.log(`  ✓ setInference confirmed (block ${receipt.blockNumber})`);

  // Step 2: verify requestDeposit
  console.log("\n=== PRICE FIX: Step 2 — verify requestDeposit ===\n");
  const deposit = await publicClient.readContract({
    address: POPULATION,
    abi,
    functionName: "requestDeposit",
  });
  const expected = 240000000000000000n;
  console.log(`  requestDeposit:  ${deposit}`);
  console.log(`  expected:        ${expected}`);
  console.log(`  match:           ${deposit === expected}`);

  if (deposit !== expected) {
    console.error(`\n  ✗ STOP — requestDeposit is ${deposit}, not ${expected}. Do NOT proceed to fund.`);
    process.exit(1);
  }

  console.log(`\n  ✓ requestDeposit confirmed at 0.24 STT. Proceed to: npm run fund -- --windows 12`);
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
