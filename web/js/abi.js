/**
 *  ABI fragments for the browser.
 *
 *  MIRROR, NOT SOURCE. Every fragment here is copied from `scripts/lib/darwin.ts`,
 *  which is the source of truth the operational scripts run against. The duplication is
 *  deliberate and the alternative was worse: `darwin.ts` opens with `import "dotenv/config"`
 *  and `node:fs`, so a browser cannot import it, and making it importable would mean
 *  refactoring the code path that keeps a live population breathing, days before a storage
 *  freeze. A build step that bundles the TS would also work, and would cost this directory
 *  its main property — that it runs with no install and no toolchain.
 *
 *  Every name and type below was checked against `contracts/src/` directly rather than
 *  trusted from the mirror:
 *
 *    - `Snapshot`'s sixteen fields and their order      Population.sol:1602-1618
 *    - `enum Belief`  = None, Up, Down, Abstain          Genome.sol:5-10
 *    - `enum Thesis`  = Unknown, Momentum, Reversion,
 *                       Breakout, Range                  Genome.sol:26-32
 *    - Population events                                 Population.sol:218-264
 *    - Prophet events                                    Prophet.sol:122-146
 *    - `phase` is `uint8`, 0 idle / 1 thinking /
 *       2 committed                                      Population.sol:92
 *
 *  If you change a signature in the contracts, change it in BOTH places. There is no
 *  compiler standing behind this file.
 */

import { parseAbi } from "./viem.js";

/*//////////////////////////////////////////////////////////////
                            POPULATION
//////////////////////////////////////////////////////////////*/

/**
 *  Reads only, plus the events the feed renders. No writes: this dashboard never asks for
 *  a wallet, because everything it shows is public state and every mutation belongs to the
 *  operator's scripts. That is a security property worth keeping — a judge can open this
 *  page without being prompted to connect anything.
 */
export const populationAbi = parseAbi([
  // The whole population in one call. Population.sol:1624 says in as many words that the
  // frontend renders from this, so no indexer sits between the chain and the UI.
  "function snapshot() view returns ((uint256 id,address addr,uint256 parentId,uint32 generation,uint256 treasury,uint32 streak,uint32 windowsLived,uint32 correctCount,uint32 wrongCount,uint32 abstainCount,uint64 birthWindow,uint64 deathWindow,bool dead,uint8 belief,uint8 thesis,bytes32 genomeHash)[])",

  // Cadence position.
  "function phase() view returns (uint8)",
  "function windowCount() view returns (uint64)",
  "function aliveCount() view returns (uint256)",
  "function prophetCount() view returns (uint256)",
  "function livingCount() view returns (uint256)",
  "function prophetAt(uint256 prophetId) view returns (address)",

  // The climate. `ante` is flat across the population and geometric in `level`, so it is
  // the single number that says how deep into a season the arena is.
  "function ante() view returns (uint256)",
  "function level() view returns (uint32)",
  "function baseAnte() view returns (uint256)",
  "function anteMultBps() view returns (uint16)",
  "function levelWindows() view returns (uint32)",
  "function seasonId() view returns (uint32)",
  "function seasonStartWindow() view returns (uint64)",
  "function seasonWindows() view returns (uint32)",

  // Costs of living.
  "function endowment() view returns (uint256)",
  "function metabolicCost() view returns (uint256)",
  "function minStake() view returns (uint256)",
  "function minEndowment() view returns (uint256)",
  "function cognitionEndowment() view returns (uint256)",
  "function requestDeposit() view returns (uint256)",

  // The three gates on reproduction. All are `setEconomics` constants, so they are discovered once
  // with the rest of the costs of living rather than polled — but the page cannot say how close
  // anything is to breeding without them, and `streak` alone is a number with no scale.
  // `_breedThreshold()` is `endowment + endowment * breedSurplusBps / 10_000` (Population.sol:1408),
  // and `maxPopulation` is the third gate: `hatchAll` breaks at the cap (:1490), so an organism can
  // clear both bars and still have nowhere to put a child.
  "function breedStreak() view returns (uint32)",
  "function breedSurplusBps() view returns (uint16)",
  "function maxPopulation() view returns (uint16)",

  // The two books. Both are ledgers over ONE token balance, so a reader must have both to
  // know what of this contract's collateral the house may actually spend: `rakeAccrued` is
  // revenue, `prizePool` is owed to the players.
  "function rakeAccrued() view returns (uint256)",
  "function prizePool() view returns (uint256)",
  "function rakeBps() view returns (uint16)",
  "function prizeShareBps() view returns (uint16)",

  // Wiring. These are why the UI needs ONE configured address: everything else it talks to
  // is discovered from the population itself, which also means the page cannot be pointed
  // at a stale venue or price source by a stale config file.
  "function collateral() view returns (address)",
  "function priceSource() view returns (address)",
  "function venue() view returns (address)",
  "function selectionEngine() view returns (address)",
  "function marketsModule() view returns (address)",
  "function symbol() view returns (string)",
  "function activeMarketId() view returns (bytes32)",
  "function activePool() view returns (address)",
  "function owner() view returns (address)",

  // Events, newest-first in the feed.
  "event WindowOpened(uint64 indexed window, bytes32 indexed marketId, address pool, uint256 openPrice)",
  "event WindowClosed(uint64 indexed window, uint256 aliveCount)",
  "event Spawned(uint256 indexed prophetId, address prophet, uint256 indexed parentId, uint32 generation)",
  "event Paired(uint256 indexed upId, uint256 indexed downId, uint256 amount)",
  "event Reaped(uint256 indexed prophetId, uint64 window, uint256 aliveRemaining)",
  "event Retired(uint256 indexed prophetId, address indexed entrant, uint256 collateralReturned, uint256 cognitionReturned)",
  "event ResidueForfeited(uint256 indexed prophetId, uint256 amount)",
  "event SeasonEnded(uint32 indexed season, uint256 pot, uint256 paid)",
  "event SeasonPrizePaid(uint32 indexed season, uint256 indexed prophetId, address indexed to, uint256 amount)",
  "event CognitionFunded(uint256 indexed prophetId, address indexed from, uint256 amount)",
  "event CognitionUnspent(uint256 indexed prophetId, uint256 amount)",
  "event BreedingRequested(uint256 indexed parentId, uint256 requestId)",
  "event BreedingUnaffordable(uint256 indexed prophetId)",
  "event ThinkFailed(uint256 indexed prophetId)",
  "event CommitFailed(uint256 indexed prophetId)",
  "event SettleFailed(uint256 indexed prophetId)",
]);

/*//////////////////////////////////////////////////////////////
                             PROPHET
//////////////////////////////////////////////////////////////*/

/**
 *  `snapshot()` already carries most of this, so the per-organism reads are only the two
 *  strings it cannot carry — the genome and the verbatim model output — plus the position
 *  fields. Strings are excluded from the snapshot for a good reason: sixteen organisms with
 *  a paragraph each would make one `eth_call` return tens of kilobytes every poll.
 */
export const prophetAbi = parseAbi([
  "function systemPrompt() view returns (string)", // THE GENOME
  "function lastReasoning() view returns (string)", // why it believed what it believed
  "function entrant() view returns (address)",
  "function positionOpen() view returns (bool)",
  "function currentStake() view returns (uint256)",
  "function currentQuantity() view returns (uint256)",
  "function currentMarketId() view returns (bytes32)",
  "function currentOutcomeId() view returns (uint256)",
  "function pendingBeliefRequestId() view returns (uint256)",
  "function pendingMutationRequestId() view returns (uint256)",

  // The organism's own log stream. `Believed` is the one that carries the attestation set,
  // and it is the only place the validator addresses appear — the claim that a language
  // model ran on chain, with consensus, is readable here and nowhere else.
  "event Born(uint256 indexed prophetId, uint256 indexed parentId, uint32 generation, bytes32 genomeHash)",
  "event Thinking(uint256 indexed prophetId, uint256 indexed requestId, bytes32 indexed marketId)",
  "event Believed(uint256 indexed prophetId, bytes32 indexed marketId, uint8 belief, uint8 thesis, string reasoning, address[] validators)",
  "event Committed(uint256 indexed prophetId, bytes32 indexed marketId, uint256 outcomeId, uint256 stake, uint256 quantity)",
  "event Settled(uint256 indexed prophetId, bytes32 indexed marketId, bool correct, uint256 collateralOut, uint256 treasury)",
  "event Starved(uint256 indexed prophetId, uint256 metabolicCost, uint256 treasury)",
  "event Raked(uint256 indexed prophetId, uint256 profit, uint256 amount)",
  "event Died(uint256 indexed prophetId, uint64 window, uint32 windowsLived, uint32 correct, uint32 wrong)",
]);

/*//////////////////////////////////////////////////////////////
                          THE SURROUNDINGS
//////////////////////////////////////////////////////////////*/

export const priceSourceAbi = parseAbi([
  "function currentWindow(string symbol) view returns (bytes32 marketId, address pool, uint256 outcomeIdUp, uint256 outcomeIdDown, uint256 openPrice, uint256 lastPrice, uint8 priceDecimals, uint64 secondsRemaining, bool tradeable)",
  "function rawWindow(string symbol) view returns ((bytes32 marketId,uint256 openPrice,uint256 lastPrice,uint8 priceDecimals,uint64 updatedAt))",
  "function maxStaleness() view returns (uint64)",
  "function updater() view returns (address)",
]);

/**
 *  `fallbackEnabled` is the honesty switch, and the reason the header renders a claim at all.
 *  While it is true, a keeper may still poke selection, so the page must print the WEAKER
 *  sentence. README.md:100-106 fixes both wordings; this dashboard quotes them rather than
 *  inventing its own.
 */
export const selectionEngineAbi = parseAbi([
  "function fallbackEnabled() view returns (bool)",
  "function population() view returns (address)",
  "function settlementEmitter() view returns (address)",
  "event Reacted(address indexed emitter, uint64 indexed window, uint256 blockNumber, bytes32 parentHash, bool viaReactivity)",
  "event ReactionFailed(address indexed emitter, uint256 blockNumber, bytes reason)",
]);

/** Enough of `IArenaVenue` to name the settlement mechanism in the UI. */
export const venueAbi = parseAbi([
  "function positionToken() view returns (address)",
  "function collateral() view returns (address)",
]);

export const erc20Abi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address account) view returns (uint256)",
]);

/*
 *  The enum labels deliberately do NOT live here. They are in `labels.js`, which imports
 *  nothing, so the fixture renderer can label a belief without pulling viem off a CDN.
 *  Everything in THIS file is unreachable unless the page is talking to a real chain.
 */
