/**
 *  Shared plumbing: config, clients, ABIs, and the deploy manifest.
 *
 *  The ABIs here are hand-written `parseAbi` fragments rather than imports from
 *  `contracts/out/`. That is deliberate: the operational scripts have to run on a fresh
 *  clone, from a laptop that may not have compiled the contracts, at 3am on demo day.
 *  Coupling the population's life support to the presence of a build directory is a bad
 *  trade for the twenty lines it saves.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

/*//////////////////////////////////////////////////////////////
                              CHAIN
//////////////////////////////////////////////////////////////*/

export const SHANNON_ID = 50312;

export const shannon = defineChain({
  id: SHANNON_ID,
  name: "Somnia Shannon",
  nativeCurrency: { name: "Somnia", symbol: "STT", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.SOMNIA_RPC_URL ?? "https://dream-rpc.somnia.network"] },
  },
  blockExplorers: {
    default: {
      name: "Shannon Explorer",
      url: process.env.SOMNIA_EXPLORER ?? "https://shannon-explorer.somnia.network",
    },
  },
});

export const publicClient = createPublicClient({ chain: shannon, transport: http() });

/** Only built when a script actually needs to sign, so read-only scripts run without a key. */
export function wallet() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk || !pk.startsWith("0x") || pk.length !== 66) {
    throw new Error("PRIVATE_KEY missing or malformed (expected 0x + 64 hex chars). See .env.example.");
  }
  const account = privateKeyToAccount(pk as Hex);
  return { account, client: createWalletClient({ account, chain: shannon, transport: http() }) };
}

/*//////////////////////////////////////////////////////////////
                         DEPLOY MANIFEST
//////////////////////////////////////////////////////////////*/

export type Manifest = {
  chainId: number;
  deployedAtBlock: number;
  deployedAtTimestamp: number;
  deployer: Address;
  owner: Address;
  updater: Address;
  population: Address;
  populationImpl: Address;
  prophetBeacon: Address;
  prophetImpl: Address;
  priceSource: Address;
  selectionEngine: Address;
  agentRequester: Address;
  marketsModule: Address;
  settlement: Address;
  outcomeToken: Address;
  collateral: Address;
  collateralDecimals: number;
  llmAgentId: number;
  symbol: string;
};

export function manifest(chainId = SHANNON_ID): Manifest {
  const path = resolve(process.cwd(), "contracts", "deployments", `${chainId}.json`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Manifest;
  } catch {
    throw new Error(
      `No deploy manifest at ${path}. Run:\n` +
        `  forge script script/Deploy.s.sol --root contracts --rpc-url somnia --broadcast`,
    );
  }
}

/** id -> human label. Written by Seed.s.sol; names are presentation, not on-chain state. */
export type OrganismLabel = {
  id: number;
  name: string;
  address: Address;
  genomeHash: Hex;
  generation: number;
  birthWindow: number;
};

export function labels(chainId = SHANNON_ID): Map<number, string> {
  const path = resolve(process.cwd(), "contracts", "deployments", `${chainId}.organisms.json`);
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { organisms: OrganismLabel[] };
    return new Map(parsed.organisms.map((o) => [o.id, o.name]));
  } catch {
    // Absent labels are cosmetic. Never fatal — a population without nicknames still runs.
    return new Map();
  }
}

/*//////////////////////////////////////////////////////////////
                               ABIS
//////////////////////////////////////////////////////////////*/

export const populationAbi = parseAbi([
  // cadence
  "function think()",
  "function commitAll()",
  "function settleAll()",
  "function hatchAll()",
  "function forcePhase(uint8 p)",
  // reads
  "function phase() view returns (uint8)",
  "function windowCount() view returns (uint64)",
  "function aliveCount() view returns (uint256)",
  "function prophetCount() view returns (uint256)",
  "function prophetAt(uint256 prophetId) view returns (address)",
  "function requestDeposit() view returns (uint256)",
  "function endowment() view returns (uint256)",
  "function metabolicCost() view returns (uint256)",
  "function minStake() view returns (uint256)",
  "function collateral() view returns (address)",
  "function priceSource() view returns (address)",
  "function selectionEngine() view returns (address)",
  "function marketsModule() view returns (address)",
  "function symbol() view returns (string)",
  "function activeMarketId() view returns (bytes32)",
  "function activePool() view returns (address)",
  "function owner() view returns (address)",
  "function snapshot() view returns ((uint256 id,address addr,uint256 parentId,uint32 generation,uint256 treasury,uint32 streak,uint32 windowsLived,uint32 correctCount,uint32 wrongCount,uint32 abstainCount,uint64 birthWindow,uint64 deathWindow,bool dead,uint8 belief,uint8 thesis,bytes32 genomeHash)[])",
  // writes a human might make
  "function fundProphet(uint256 prophetId, uint256 amount)",
  "function breedProphet(uint256 prophetId)",
  // events
  "event WindowOpened(uint64 indexed window, bytes32 indexed marketId, address pool, uint256 openPrice)",
  "event ThinkFailed(uint256 prophetId)",
  "event Spawned(uint256 indexed prophetId, address prophet, uint256 parentId, uint32 generation)",
  // errors, so a revert reads as a sentence instead of a hex blob
  "error NotDriver()",
  "error WrongPhase(uint8 expected, uint8 actual)",
  "error MarketNotTradeable()",
  "error PopulationFull()",
  "error NoSuchProphet()",
  "error ProphetIsDead()",
  "error NotEligibleToBreed()",
  "error TransferFailed()",
  "error NothingToHatch()",
]);

export const prophetAbi = parseAbi([
  "function prophetId() view returns (uint256)",
  "function parentId() view returns (uint256)",
  "function generation() view returns (uint32)",
  "function treasury() view returns (uint256)",
  "function streak() view returns (uint32)",
  "function dead() view returns (bool)",
  "function belief() view returns (uint8)",
  "function lastThesis() view returns (uint8)",
  "function systemPrompt() view returns (string)",
  "function lastReasoning() view returns (string)",
  "function genomeHash() view returns (bytes32)",
  "function positionOpen() view returns (bool)",
  "function currentStake() view returns (uint256)",
  "function currentQuantity() view returns (uint256)",
  "function pendingBeliefRequestId() view returns (uint256)",
  "function pendingMutationRequestId() view returns (uint256)",
  "function windowsLived() view returns (uint32)",
  "function correctCount() view returns (uint32)",
  "function wrongCount() view returns (uint32)",
  "function abstainCount() view returns (uint32)",
  "function claimOwed() returns (uint256)",
]);

export const priceSourceAbi = parseAbi([
  "function pushWindow(string symbol, bytes32 marketId, uint256 openPrice, uint256 lastPrice, uint8 priceDecimals)",
  "function currentWindow(string symbol) view returns (bytes32 marketId, address pool, uint256 outcomeIdUp, uint256 outcomeIdDown, uint256 openPrice, uint256 lastPrice, uint8 priceDecimals, uint64 secondsRemaining, bool tradeable)",
  "function rawWindow(string symbol) view returns ((bytes32 marketId,uint256 openPrice,uint256 lastPrice,uint8 priceDecimals,uint64 updatedAt))",
  "function maxStaleness() view returns (uint64)",
  "function updater() view returns (address)",
  "error NotAuthorized()",
  "error NoWindow(string symbol)",
  "error StalePrice(uint64 age, uint64 limit)",
]);

export const selectionEngineAbi = parseAbi([
  "function poke()",
  "function fallbackEnabled() view returns (bool)",
  "function population() view returns (address)",
  "function settlementEmitter() view returns (address)",
  "event Reacted(address indexed emitter, uint64 indexed window, uint256 blockNumber, bytes32 parentHash, bool viaReactivity)",
  "event ReactionFailed(address indexed emitter, uint256 blockNumber, bytes reason)",
  "error FallbackClosed()",
]);

/**
 *  `markets()` returns fourteen fields; only the last six are used here. The names are
 *  from the SDK's `binaryModuleReadAbi`. Indices 8..13 are market, pool, yesId, noId,
 *  tradingStart, expiry.
 */
export const marketsModuleAbi = parseAbi([
  "function markets(bytes32 marketId) view returns (uint256 oracleQuestionId, uint8 outcomeSlotCount, uint8 voidPolicy, address collateral, uint32 originOperatorId, bytes32 originVenueId, address oracleAdapter, address creator, address market, address pool, uint256 yesId, uint256 noId, uint64 tradingStart, uint64 expiry)",
]);

export const binaryMarketAbi = parseAbi([
  "function isResolved() view returns (bool)",
  "function isVoided() view returns (bool)",
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export const faucetAbi = parseAbi(["function faucet(uint256 amount)"]);

/*//////////////////////////////////////////////////////////////
                            FORMATTING
//////////////////////////////////////////////////////////////*/

export const PHASE = ["THINK", "COMMIT", "SETTLE"] as const;
export const BELIEF = ["None", "Up", "Down", "Abstain"] as const;
export const THESIS = ["Unknown", "Momentum", "Reversion", "Breakout", "Range"] as const;

export function fmt(units: bigint, decimals: number, places = 4): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, places).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function stamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function log(...parts: unknown[]): void {
  console.log(`[${stamp()}]`, ...parts);
}

export function warn(...parts: unknown[]): void {
  console.warn(`[${stamp()}] WARN`, ...parts);
}

export function explorerTx(hash: Hex): string {
  return `${shannon.blockExplorers.default.url}/tx/${hash}`;
}

/** Truthy env flag, tolerant of `1`, `true`, `yes`. */
export function flag(name: string, dflt = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}

export function num(name: string, dflt: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} is not a number: ${v}`);
  return n;
}
