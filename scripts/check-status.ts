import "dotenv/config";
import { createPublicClient, defineChain, http, parseAbi } from "viem";
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
  readFileSync(resolve(process.cwd(), "contracts", "deployments", "50312.json"), "utf8")
);

const abi = parseAbi([
  "function phase() view returns (uint8)",
  "function windowCount() view returns (uint64)",
  "function activeMarketId() view returns (bytes32)"
]);

async function main() {
  const [phase, windowCount, activeMarketId] = await Promise.all([
    publicClient.readContract({ address: manifest.population, abi, functionName: "phase" }),
    publicClient.readContract({ address: manifest.population, abi, functionName: "windowCount" }),
    publicClient.readContract({ address: manifest.population, abi, functionName: "activeMarketId" }),
  ]);
  console.log({ phase, windowCount, activeMarketId });
}

main().catch(console.error);
