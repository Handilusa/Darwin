/**
 *  forcePhase(2) — escape hatch to unstick the phase machine.
 *  Population.sol:770-775, onlyOwner, does NOT revive or touch treasury.
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
const pk = process.env.PRIVATE_KEY as Hex;
const account = privateKeyToAccount(pk);
const walletClient = createWalletClient({ account, chain: shannon, transport: http() });

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "contracts", "deployments", "50312.json"), "utf8"),
);
const POPULATION = manifest.population as `0x${string}`;

const abi = parseAbi([
  "function forcePhase(uint8 p)",
  "function phase() view returns (uint8)",
  "function windowCount() view returns (uint64)",
]);

async function main() {
  const phaseBefore = await publicClient.readContract({ address: POPULATION, abi, functionName: "phase" });
  const wc = await publicClient.readContract({ address: POPULATION, abi, functionName: "windowCount" });
  console.log(`  phase before: ${phaseBefore}  windowCount: ${wc}`);

  if (Number(phaseBefore) === 2) {
    console.log("  already in phase 2 (SETTLE) — nothing to do");
    return;
  }

  console.log("  sending forcePhase(2)...");
  const hash = await walletClient.writeContract({
    address: POPULATION,
    abi,
    functionName: "forcePhase",
    args: [2],
  });
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`forcePhase REVERTED: ${hash}`);

  const phaseAfter = await publicClient.readContract({ address: POPULATION, abi, functionName: "phase" });
  console.log(`  ✓ forcePhase(2) confirmed — phase now: ${phaseAfter} (block ${receipt.blockNumber})`);
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
