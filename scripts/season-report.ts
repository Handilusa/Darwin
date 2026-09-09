/**
 *  Read-only. Prints the live season clock, the derived ante, and the eight
 *  `SeasonParams` fields verbatim.
 *
 *  It exists because `setSeason` takes the WHOLE struct — there is no partial
 *  setter — so changing one field means reading the other seven off chain and
 *  writing them back byte-identical. Guessing one of them silently retunes the
 *  economy. This prints them in struct order, as wei, ready to paste.
 *
 *  Sends nothing. No PRIVATE_KEY is read.
 *
 *  Usage:  tsx scripts/season-report.ts
 */
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
  readFileSync(resolve(process.cwd(), "contracts", "deployments", "50312.json"), "utf8"),
);
const POPULATION = manifest.population as `0x${string}`;

const abi = parseAbi([
  "function phase() view returns (uint8)",
  "function windowCount() view returns (uint64)",
  "function seasonId() view returns (uint64)",
  "function seasonStartWindow() view returns (uint64)",
  "function seasonWindows() view returns (uint32)",
  "function levelWindows() view returns (uint32)",
  "function level() view returns (uint32)",
  "function ante() view returns (uint256)",
  "function baseAnte() view returns (uint256)",
  "function anteMultBps() view returns (uint16)",
  "function minEndowment() view returns (uint256)",
  "function cognitionEndowment() view returns (uint256)",
  "function rakeBps() view returns (uint16)",
  "function prizeShareBps() view returns (uint16)",
  "function minStake() view returns (uint256)",
  "function prizePool() view returns (uint256)",
  "function rakeAccrued() view returns (uint256)",
]);

const names = [
  "phase",
  "windowCount",
  "seasonId",
  "seasonStartWindow",
  "seasonWindows",
  "levelWindows",
  "level",
  "ante",
  "baseAnte",
  "anteMultBps",
  "minEndowment",
  "cognitionEndowment",
  "rakeBps",
  "prizeShareBps",
  "minStake",
  "prizePool",
  "rakeAccrued",
] as const;

async function main() {
  const vals = await Promise.all(
    names.map((n) => publicClient.readContract({ address: POPULATION, abi, functionName: n })),
  );
  const v = Object.fromEntries(names.map((n, i) => [n, vals[i]])) as Record<
    (typeof names)[number],
    bigint | number
  >;

  const wc = BigInt(v.windowCount);
  const start = BigInt(v.seasonStartWindow);
  const sw = BigInt(v.seasonWindows);
  const elapsed = wc - start;

  console.log(`Population ${POPULATION}\n`);
  console.log(`  phase                ${v.phase}`);
  console.log(`  seasonId             ${v.seasonId}`);
  console.log(`  windowCount          ${wc}`);
  console.log(`  seasonStartWindow    ${start}`);
  console.log(`  elapsed              ${elapsed}   (windowCount - seasonStartWindow)`);
  console.log(`  seasonWindows        ${sw}`);
  console.log(`  endSeason() callable ${elapsed >= sw}   (needs elapsed >= seasonWindows)`);
  if (elapsed < sw) console.log(`  first callable at    window ${start + sw}`);
  console.log(`  levelWindows         ${v.levelWindows}`);
  console.log(`  level                ${v.level}`);
  console.log(`  ante                 ${Number(v.ante) / 1e6} tUSDC   (${v.ante} raw, 6dp)`);
  console.log(`  prizePool            ${Number(v.prizePool) / 1e6} tUSDC`);
  console.log(`  rakeAccrued          ${Number(v.rakeAccrued) / 1e6} tUSDC`);
  console.log(`  minStake             ${Number(v.minStake) / 1e6} tUSDC`);

  console.log(`\n  SeasonParams, live, in struct order — setSeason takes all eight:`);
  console.log(`    minEndowment        ${v.minEndowment}`);
  console.log(`    cognitionEndowment  ${v.cognitionEndowment}`);
  console.log(`    baseAnte            ${v.baseAnte}`);
  console.log(`    anteMultBps         ${v.anteMultBps}`);
  console.log(`    levelWindows        ${v.levelWindows}`);
  console.log(`    seasonWindows       ${v.seasonWindows}`);
  console.log(`    rakeBps             ${v.rakeBps}`);
  console.log(`    prizeShareBps       ${v.prizeShareBps}`);
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
