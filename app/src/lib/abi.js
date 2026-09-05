/**
 *  ABI fragments for the entry flow.
 *
 *  MIRROR, NOT SOURCE — the same relationship `web/js/abi.js` has to
 *  `scripts/lib/darwin.ts`. This file is deliberately NOT an import of that one: the
 *  dashboard's copy reaches viem through `web/js/viem.js`, which is
 *  `export * from "https://esm.sh/viem@2.56.0"`, and pulling a CDN URL into Vite's
 *  module graph would make the bundle fetch viem at runtime from a third party. So the
 *  app resolves viem from node_modules and carries its own fragments.
 *
 *  Both copies are pinned to viem 2.56.0, so calldata encoded here is byte-identical
 *  to calldata encoded by the dashboard and by the operational scripts.
 *
 *  WHAT IS DIFFERENT ABOUT THIS COPY: `web/js/abi.js` is read-only by design — grep it
 *  for `enter` and you get nothing. Everything below that writes state exists only here,
 *  because the arena console has no wallet and must keep it that way.
 *
 *  Every signature was checked against `contracts/src/` directly:
 *
 *    - `enter(string,uint256) payable returns (uint256)`   Population.sol:654
 *    - `retire(uint256)`                                    Population.sol:940
 *    - `topUpCognition(uint256) payable`                    Population.sol:1563
 *    - the four entry preconditions and their errors        Population.sol:655-667
 *    - `faucet(uint256)` on tUSDC                           scripts/lib/darwin.ts:319
 *
 *  If you change a signature in the contracts, change it in ALL THREE places. There is no
 *  compiler standing behind this file.
 */

import { parseAbi } from "viem";

/*//////////////////////////////////////////////////////////////
                        POPULATION — READS
//////////////////////////////////////////////////////////////*/

/**
 *  Read live, never hardcoded.
 *
 *  `ante()` escalates geometrically: `baseAnte * anteMultBps^level`, and with the shipped
 *  season (`levelWindows = 72`, `anteMultBps = 20_000`, `seasonWindows = 576`) that is
 *  eight doublings — 256x the base ante by the end of a season. An entry form carrying a
 *  minimum measured on Monday reverts `EndowmentBelowAnte` on Friday. So the form reads
 *  `minEndowment`, `ante()` and `cognitionEndowment` on every mount and quotes what the
 *  contract will actually accept at this block.
 */
export const populationReadAbi = parseAbi([
  // the two collateral floors — `enter` enforces BOTH, and they move independently
  "function minEndowment() view returns (uint256)",
  "function ante() view returns (uint256)",
  // the native floor
  "function cognitionEndowment() view returns (uint256)",

  // what the entrant is buying into
  "function collateral() view returns (address)",
  "function symbol() view returns (string)",
  "function metabolicCost() view returns (uint256)",
  "function maxPopulation() view returns (uint16)",

  // vital signs, for the counters on the landing
  "function aliveCount() view returns (uint256)",
  "function livingCount() view returns (uint256)",
  "function prophetCount() view returns (uint256)",
  "function windowCount() view returns (uint64)",
  "function phase() view returns (uint8)",

  // the season, so the form can say WHY the ante is what it is
  "function level() view returns (uint32)",
  "function baseAnte() view returns (uint256)",
  "function anteMultBps() view returns (uint16)",
  "function levelWindows() view returns (uint32)",
  "function seasonId() view returns (uint32)",
  "function seasonStartWindow() view returns (uint64)",
  "function seasonWindows() view returns (uint32)",

  // the whole population in one eth_call — sixteen fields, order per Population.sol:1602
  "function snapshot() view returns ((uint256 id,address addr,uint256 parentId,uint32 generation,uint256 treasury,uint32 streak,uint32 windowsLived,uint32 correctCount,uint32 wrongCount,uint32 abstainCount,uint64 birthWindow,uint64 deathWindow,bool dead,uint8 belief,uint8 thesis,bytes32 genomeHash)[])",
]);

/*//////////////////////////////////////////////////////////////
                        POPULATION — WRITES
//////////////////////////////////////////////////////////////*/

/**
 *  Three writes, and only three. The window itself (`think`/`commitAll`/`settleAll`/
 *  `hatchAll`) is `onlyDriver` and no entrant can call it — which is the honest thing for
 *  this page to say, so it says it rather than offering buttons that would revert.
 */
export const populationWriteAbi = parseAbi([
  "function enter(string genome, uint256 endowmentAmount) payable returns (uint256 prophetId)",
  "function retire(uint256 prophetId)",
  "function topUpCognition(uint256 prophetId) payable",
]);

/**
 *  Custom errors, so a rejected entry reads as a sentence instead of a hex blob.
 *
 *  viem decodes a revert against whatever ABI it was given; without these the user sees
 *  `0x1e4f...` and has no idea their endowment was one wei short of four antes. The two
 *  that carry arguments are the two an entrant can actually hit by being slightly wrong,
 *  and their arguments are exactly what the form needs to tell them what to change.
 */
export const populationErrorsAbi = parseAbi([
  "error EndowmentTooSmall()",
  "error EndowmentBelowAnte(uint256 supplied, uint256 required)",
  "error CognitionTooSmall()",
  "error TransferFailed()",
  "error PopulationFull()",
  "error NoSuchProphet()",
  "error NotEntrant()",
  "error ProphetIsDead()",
  "error PositionStillOpen()",
  "error WrongPhase(uint8 expected, uint8 actual)",
]);

/** What `useSimulateContract`/`writeContract` should be handed for a write. */
export const populationAbi = [...populationWriteAbi, ...populationReadAbi, ...populationErrorsAbi];

/*//////////////////////////////////////////////////////////////
                             PROPHET
//////////////////////////////////////////////////////////////*/

export const prophetAbi = parseAbi([
  "function systemPrompt() view returns (string)", // THE GENOME
  "function lastReasoning() view returns (string)",
  "function entrant() view returns (address)",
  "function positionOpen() view returns (bool)",
]);

/*//////////////////////////////////////////////////////////////
                          COLLATERAL
//////////////////////////////////////////////////////////////*/

/**
 *  `enter` moves collateral with `transferFrom` (Population.sol:666), so an approval is a
 *  hard prerequisite and not a nicety — which is why entry is three transactions and the
 *  form shows all three up front instead of surprising the user with a second signature.
 *
 *  `faucet(uint256)` is on the testnet tUSDC itself, not a separate contract. It is
 *  marked UNVERIFIED in `scripts/fund.ts:84` as to whether the argument is raw units or
 *  whole tokens; the scripts pass raw units and it works, so this does the same.
 */
export const collateralAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function faucet(uint256 amount)",
]);
