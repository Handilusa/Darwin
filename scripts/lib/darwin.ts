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
  "function livingCount() view returns (uint256)",
  "function prophetAt(uint256 prophetId) view returns (address)",
  "function requestDeposit() view returns (uint256)",
  "function endowment() view returns (uint256)",
  "function metabolicCost() view returns (uint256)",
  "function minStake() view returns (uint256)",
  // Season floors. `cognitionEndowment` is the one an operator reads most: it is the
  // native STT an organism is born or admitted with, and since organisms pay for their
  // own inference it is the unit every runway number in `fund.ts`/`monitor.ts` is in.
  "function minEndowment() view returns (uint256)",
  "function cognitionEndowment() view returns (uint256)",
  // The climate. `ante()` is what every organism risks THIS window — flat across the
  // population and geometric in `level()`, so it is the one number that says how far
  // into a season the arena is without reading the window count against a schedule.
  "function ante() view returns (uint256)",
  "function level() view returns (uint32)",
  "function baseAnte() view returns (uint256)",
  "function anteMultBps() view returns (uint16)",
  "function levelWindows() view returns (uint32)",
  // The two books. Both are ledgers over ONE token balance, so a monitor must read
  // both to know what of this contract's collateral is actually spendable by the
  // house: `rakeAccrued` is revenue, `prizePool` is owed to the players.
  "function rakeAccrued() view returns (uint256)",
  "function prizePool() view returns (uint256)",
  "function rakeBps() view returns (uint16)",
  "function prizeShareBps() view returns (uint16)",
  "function seasonId() view returns (uint32)",
  "function seasonStartWindow() view returns (uint64)",
  "function seasonWindows() view returns (uint32)",
  "function collateral() view returns (address)",
  "function priceSource() view returns (address)",
  // Where positions live and how a resolved position becomes collateral. Readable
  // because it is repointable: the manifest records the venue deployed on day two,
  // and this is how a script confirms the population is still wired to that one.
  "function venue() view returns (address)",
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
  // Arena entry and exit. `enter` and `topUpCognition` are both payable and the value
  // is native STT for cognition, NOT collateral — the collateral half of `enter` is
  // pulled with transferFrom, so it needs an allowance first, exactly like fundProphet.
  "function enter(string genome, uint256 endowmentAmount) payable returns (uint256)",
  "function retire(uint256 prophetId)",
  "function topUpCognition(uint256 prophetId) payable",
  // ONE struct rather than a growing argument list, because every field is a climate
  // knob and they are only ever coherent together: raising `baseAnte` without raising
  // `minEndowment` admits entrants who cannot post the ante they are being admitted
  // to pay. Field order matters — viem encodes the tuple positionally.
  "function setSeason((uint256 minEndowment,uint256 cognitionEndowment,uint256 baseAnte,uint16 anteMultBps,uint32 levelWindows,uint32 seasonWindows,uint16 rakeBps,uint16 prizeShareBps) s)",
  // Revenue out, and the season close. `endSeason` is PERMISSIONLESS and reverts
  // `SeasonNotOver` before its window, so a script may simply attempt it each cadence
  // tick; `withdrawRake` is owner-only and bounded by `rakeAccrued`, which is what
  // makes it distinct from `sweep`.
  "function withdrawRake(address to, uint256 amount)",
  "function endSeason()",
  "function sweep(address token, address to, uint256 amount)",
  // events
  "event WindowOpened(uint64 indexed window, bytes32 indexed marketId, address pool, uint256 openPrice)",
  "event ThinkFailed(uint256 indexed prophetId)",
  "event Spawned(uint256 indexed prophetId, address prophet, uint256 indexed parentId, uint32 generation)",
  "event Reaped(uint256 indexed prophetId, uint64 window, uint256 aliveRemaining)",
  "event Retired(uint256 indexed prophetId, address indexed entrant, uint256 collateralReturned, uint256 cognitionReturned)",
  // The cognition ledger. `CognitionUnspent` is the one to alert on: it means a deposit
  // was drawn from an organism for a request that then reverted, so the native is sitting
  // in Population and `sweep(address(0), organism, amount)` is how it goes home.
  "event CognitionFunded(uint256 indexed prophetId, address indexed from, uint256 amount)",
  "event CognitionUnspent(uint256 indexed prophetId, uint256 amount)",
  "event BreedingUnaffordable(uint256 indexed prophetId)",
  // The arena's money events. `ResidueForfeited` is the pool's other source besides
  // the rake split, and a `Reaped` with no `ResidueForfeited` beside it means the
  // organism died with an empty treasury rather than that collateral went missing.
  "event Raked(uint256 indexed prophetId, uint256 profit, uint256 amount)",
  "event ResidueForfeited(uint256 indexed prophetId, uint256 amount)",
  "event SeasonEnded(uint32 indexed season, uint256 pot, uint256 paid)",
  "event SeasonPrizePaid(uint32 indexed season, uint256 indexed prophetId, address indexed to, uint256 amount)",
  "event RakeWithdrawn(address indexed to, uint256 amount)",
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
  "error EndowmentTooSmall()",
  "error CognitionTooSmall()",
  "error NotEntrant()",
  "error PositionStillOpen()",
  // Parameterized, and both numbers matter: this is the revert a stranger's entry
  // transaction is most likely to meet, and "supplied 10, required 40" is the only
  // form of it that tells them what to do next.
  "error EndowmentBelowAnte(uint256 supplied, uint256 required)",
  "error RakeExceeded()",
  "error SeasonNotOver()",
  "error BadSeason()",
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
  // Who admitted this organism, and therefore the only address `retire` pays out.
  // Founders carry the owner (`spawnGenesis` passes msg.sender) and a CHILD INHERITS
  // its parent's entrant, so a lineage stays with whoever seeded it — winning a window
  // and breeding grows the entrant's position rather than handing it to the house.
  "function entrant() view returns (address)",
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
