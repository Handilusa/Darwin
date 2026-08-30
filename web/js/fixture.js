/**
 *  A synthetic population, for judging the UI before anything is deployed.
 *
 *  WHY THIS FILE EXISTS. Nothing is on chain yet, so not one line of `chain.js` can be
 *  exercised against reality today. What CAN be exercised is everything downstream of the
 *  reads — the lineage layout, the formatting, every empty and error state, the whole render
 *  path — provided the data handed to it is shaped exactly like the real thing. So it is:
 *  every numeric field below is a BIGINT LITERAL, because that is what viem returns. A
 *  fixture built out of plain numbers would test a code path the live page never takes, and
 *  would quietly hide the first `BigInt` arithmetic error.
 *
 *  It is also the offline demo. `?demo=1` never touches the network — not the RPC, not even
 *  the CDN, since this module and everything it feeds import no viem. If the venue wifi dies
 *  during judging, the dashboard still opens and still shows a population.
 *
 *  THE NUMBERS ARE INVENTED AND THE UI SAYS SO, LOUDLY AND PERMANENTLY. A demo that can be
 *  mistaken for a live run is worse than no demo, and this project's whole claim is that it
 *  does not overstate itself. `synthetic: true` travels with the data and the banner cannot
 *  be dismissed.
 *
 *  The scenario is chosen to be awkward on purpose rather than flattering:
 *    - two founders already dead, one of them starved rather than wrong
 *    - a three-generation line (1 -> 9 -> 11) so the tree has real depth
 *    - a paying entrant (12) that is a ROOT at generation 0, the shape that makes
 *      `rootKind`'s founder/entrant heuristic matter
 *    - one organism holding an open position, one abstaining, one with belief None
 *    - a LIVING organism three windows from death (7) and one in the warning band (8), so all
 *      three of `runway`'s severity bands are on screen. Without these the demo shows a healthy
 *      population with two tidy corpses and no visible selection pressure at all, which is
 *      precisely the impression this project should not be giving.
 *    - `fallbackEnabled: true`, so the header renders the WEAKER claim — the honest state
 *      before `npm run prove` has ever passed
 */

const ONE = 1_000_000n; // tUSDC, 6dp

export const synthetic = true;

export const config = {
  population: "0x7A1c0dE5f3B24a8E9C6d1F0b5A73e82D4c9B60fA",
  symbol: "BTC",
  collateral: "0x0Ed3B4a7C1f9E52D8b6A34F07c1D9e5B82Aa7C31",
  priceSource: "0x3Fb9C21e7A85d0F46c3B18e9A2D7c50F1bE64a87",
  venue: "0xC4e91B037aD5f28E6b1c09A73F4d82E5a0B716Dc",
  selectionEngine: "0x91Ad7f24C08bE536a1D9c4F72B0e8A35D6c1027B",
  marketsModule: "0x5D2fA83c19B7e04E6a5C81b3F9d072Ae4B18c635",
  owner: "0xE07b4A29c6D138f5B0a7E24C91d3F86b5A0c72E1",
  decimals: 6,
  tokenSymbol: "tUSDC",
  // A duel-style venue: no ERC-6909 position token, so organisms redeem directly.
  positionToken: "0x0000000000000000000000000000000000000000",
  endowment: 40n * ONE,
  metabolicCost: 250_000n,
  minStake: 1n * ONE,
  minEndowment: 20n * ONE,
  cognitionEndowment: 30_000_000_000_000_000n, // 0.03 STT
  requestDeposit: 2_000_000_000_000_000n,
  baseAnte: 2n * ONE,
  anteMultBps: 12_500n,
  levelWindows: 12,
  seasonWindows: 96,
  rakeBps: 200n,
  prizeShareBps: 5_000n,
  failures: {},
};

/** Shaped exactly like one `Population.snapshot()` entry. Field order is documentation. */
function organism(o) {
  return {
    id: o.id,
    addr: o.addr,
    parentId: o.parentId,
    generation: o.generation,
    treasury: o.treasury,
    streak: o.streak,
    windowsLived: o.windowsLived,
    correctCount: o.correctCount,
    wrongCount: o.wrongCount,
    abstainCount: o.abstainCount,
    birthWindow: o.birthWindow,
    deathWindow: o.deathWindow,
    dead: o.dead,
    belief: o.belief,
    thesis: o.thesis,
    genomeHash: o.genomeHash,
  };
}

/* Belief: 0 None, 1 Up, 2 Down, 3 Abstain.  Thesis: 0 Unknown, 1 Momentum, 2 Reversion,
   3 Breakout, 4 Range. */
export const organisms = [
  organism({
    id: 1n, addr: "0x1a2B3c4D5e6F7081920aB3c4D5e6F70819203a4b",
    parentId: 0n, generation: 0, treasury: 58_420_000n, streak: 3,
    windowsLived: 41, correctCount: 24, wrongCount: 14, abstainCount: 3,
    birthWindow: 0n, deathWindow: 0n, dead: false, belief: 1, thesis: 1,
    genomeHash: "0x9f2c8a1b4e7d0356af91c2b8e5d47301fa6b9c8d2e5f70413a8b6c9d0e2f4a713",
  }),
  organism({
    id: 2n, addr: "0x2b3C4d5E6f708192a0Bc3D4e5F60718293a4B5c6",
    parentId: 0n, generation: 0, treasury: 12_150_000n, streak: 0,
    windowsLived: 41, correctCount: 15, wrongCount: 23, abstainCount: 3,
    birthWindow: 0n, deathWindow: 0n, dead: false, belief: 2, thesis: 2,
    genomeHash: "0x3d8e1f0a7b2c94655e0d1a8f3b7c2049e8d1a6b5c4f30e9d2a7b8c1f6e0d4a952",
  }),
  organism({
    id: 3n, addr: "0x3c4D5e6F708192A0bC3d4E5f60718293A4b5C6d7",
    parentId: 0n, generation: 0, treasury: 0n, streak: 0,
    windowsLived: 26, correctCount: 8, wrongCount: 17, abstainCount: 1,
    birthWindow: 0n, deathWindow: 26n, dead: true, belief: 2, thesis: 1,
    genomeHash: "0x7c1b9d3e0f8a2456bd7e1c0a9f3b8524de6a1b0c7f9e2d3a5b8c4f1e0d7a69324",
  }),
  organism({
    id: 4n, addr: "0x4d5E6f708192a0Bc3D4e5F60718293a4B5c6D7e8",
    parentId: 0n, generation: 0, treasury: 31_960_000n, streak: 1,
    windowsLived: 41, correctCount: 20, wrongCount: 18, abstainCount: 3,
    birthWindow: 0n, deathWindow: 0n, dead: false, belief: 3, thesis: 4,
    genomeHash: "0x1e0d9c8b7a6f5342e1d0c9b8a7f6e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c4",
  }),
  organism({
    id: 5n, addr: "0x5e6F708192a0bC3d4E5f60718293A4b5C6d7E8f9",
    parentId: 0n, generation: 0, treasury: 0n, streak: 0,
    windowsLived: 33, correctCount: 14, wrongCount: 16, abstainCount: 3,
    birthWindow: 0n, deathWindow: 33n, dead: true, belief: 1, thesis: 3,
    genomeHash: "0x8a7b6c5d4e3f20195c8b7a6d5e4f30291a8b7c6d5e4f3021a9b8c7d6e5f403192",
  }),
  organism({
    id: 6n, addr: "0x6f708192A0bc3D4e5F60718293a4B5c6D7e8F901",
    parentId: 0n, generation: 0, treasury: 44_780_000n, streak: 2,
    windowsLived: 41, correctCount: 22, wrongCount: 16, abstainCount: 3,
    birthWindow: 0n, deathWindow: 0n, dead: false, belief: 1, thesis: 3,
    genomeHash: "0x2f4e6d8c0a1b3957e2d4c6b8a0f1e3d5c7b9a2048f6e8d0c2b4a6982f0e4d6c8a",
  }),
  // Three windows from death, and its own log lines say why: `ThinkFailed` then
  // `CognitionUnspent`, i.e. an organism whose inference is failing while metabolism is charged
  // anyway. This is the `bad` runway band (<5 windows), and the whole point of the dashboard is
  // that a reviewer can see this organism is about to die before it does.
  organism({
    id: 7n, addr: "0x708192a0Bc3d4E5f60718293a4b5C6d7E8f90123",
    parentId: 0n, generation: 0, treasury: 900_000n, streak: 0,
    windowsLived: 41, correctCount: 16, wrongCount: 22, abstainCount: 3,
    birthWindow: 0n, deathWindow: 0n, dead: false, belief: 0, thesis: 0,
    genomeHash: "0x5b8c1d4e7f0a2396c5b8d1e4f70a2396c5b8d1e4f70a2396c5b8d1e4f70a2396c",
  }),
  // The `warn` runway band (<20 windows): a break-even founder that has stopped compounding.
  // With #7 in `bad` and everyone else comfortable, all three bands `runway` draws are visible in
  // the demo, rather than only on a live population that has already come under pressure.
  organism({
    id: 8n, addr: "0x8192A0bc3D4e5f60718293A4b5c6D7e8F9012345",
    parentId: 0n, generation: 0, treasury: 4_000_000n, streak: 1,
    windowsLived: 41, correctCount: 19, wrongCount: 19, abstainCount: 3,
    birthWindow: 0n, deathWindow: 0n, dead: false, belief: 2, thesis: 4,
    genomeHash: "0xd4c3b2a1908f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5c4b3a29180f7e6d5",
  }),
  // Generation 1: bred on merit from the two organisms that were actually surviving.
  organism({
    id: 9n, addr: "0x92a0Bc3d4E5f60718293a4B5c6d7E8f901234567",
    parentId: 1n, generation: 1, treasury: 51_070_000n, streak: 4,
    windowsLived: 22, correctCount: 15, wrongCount: 6, abstainCount: 1,
    birthWindow: 19n, deathWindow: 0n, dead: false, belief: 1, thesis: 1,
    genomeHash: "0xa0b1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f90",
  }),
  organism({
    id: 10n, addr: "0xa0bC3d4e5F60718293a4b5C6d7e8F90123456789",
    parentId: 6n, generation: 1, treasury: 18_640_000n, streak: 0,
    windowsLived: 14, correctCount: 6, wrongCount: 7, abstainCount: 1,
    birthWindow: 27n, deathWindow: 0n, dead: false, belief: 2, thesis: 2,
    genomeHash: "0xb1c2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f901a",
  }),
  // Generation 2. The deepest surviving line, and the reason the tree is worth drawing.
  organism({
    id: 11n, addr: "0xb3C4d5e6F70819203a4B5c6d7E8f9012345678aB",
    parentId: 9n, generation: 2, treasury: 43_890_000n, streak: 2,
    windowsLived: 7, correctCount: 5, wrongCount: 2, abstainCount: 0,
    birthWindow: 34n, deathWindow: 0n, dead: false, belief: 1, thesis: 1,
    genomeHash: "0xc2d3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f901ab2",
  }),
  // A paying entrant: parentId 0 and generation 0, exactly like a founder, but born at
  // window 34. This is the row that makes `rootKind`'s heuristic worth having.
  organism({
    id: 12n, addr: "0xc4D5e6f70819203A4b5C6d7e8F9012345678Ab9c",
    parentId: 0n, generation: 0, treasury: 22_500_000n, streak: 1,
    windowsLived: 7, correctCount: 4, wrongCount: 3, abstainCount: 0,
    birthWindow: 34n, deathWindow: 0n, dead: false, belief: 3, thesis: 0,
    genomeHash: "0xd3e4f5061728394a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f901ab2c3",
  }),
];

export const state = {
  at: Math.floor(Date.now() / 1000),
  phase: 2, // committed: positions are open, settlement is what happens next
  windowCount: 41n,
  aliveCount: 10n,
  prophetCount: 12n,
  livingCount: 10n,
  ante: 3_906_250n, // baseAnte 2.00 compounded at 1.25x through level 3
  level: 3,
  seasonId: 0,
  seasonStartWindow: 0n,
  rakeAccrued: 1_284_400n,
  prizePool: 3_211_000n,
  activeMarketId: "0x6b8f2a91c0d3e547b8a1f2c9d0e3b4a57689c1d2e3f405a6b7c8d9e0f1a2b3c4d",
  activePool: "0x2E9d5C1a8B7f036E4d2c9A1b8F7e0563D4c2a9B1",
  organisms,
  window: {
    marketId: "0x6b8f2a91c0d3e547b8a1f2c9d0e3b4a57689c1d2e3f405a6b7c8d9e0f1a2b3c4d",
    pool: "0x2E9d5C1a8B7f036E4d2c9A1b8F7e0563D4c2a9B1",
    outcomeIdUp: 84_211_009_477_331_240n,
    outcomeIdDown: 84_211_009_477_331_241n,
    openPrice: 111_200_000_000n,
    lastPrice: 111_845_310_000n,
    priceDecimals: 6,
    secondsRemaining: 412n,
    tradeable: true,
  },
  windowError: null,
  rawWindow: null,
  // TRUE is the honest default: the reactive subscription has not been proven in the same
  // block yet, so the header must print the weaker of the two claims.
  fallbackEnabled: true,
  blockNumber: 8_412_907n,
  blockTimestamp: BigInt(Math.floor(Date.now() / 1000) - 3),
  errors: {},
};

/** id -> the genome and the verbatim model output, as `readOrganism` would return them. */
export const details = new Map([
  [1n, {
    systemPrompt:
      "You are a momentum forecaster. You believe that a 15-minute move that has already " +
      "broken the opening range tends to continue through the close, because the order flow " +
      "that caused it is rarely finished. You distrust mean reversion on short horizons. " +
      "Answer with one of the nine allowed values and nothing else.",
    lastReasoning:
      "Price is 0.58% above the open with 7 minutes left and has not retraced more than a " +
      "third of the move at any point in the window. That is continuation, not exhaustion. UP_MOMENTUM",
    entrant: config.owner,
    positionOpen: true,
    currentStake: 3_906_250n,
    currentQuantity: 7_812_500n,
    currentMarketId: state.activeMarketId,
    currentOutcomeId: state.window.outcomeIdUp,
    pendingBeliefRequestId: 0n,
    pendingMutationRequestId: 0n,
    errors: {},
  }],
  [2n, {
    systemPrompt:
      "You are a mean-reversion forecaster. You believe short-horizon moves overshoot and " +
      "that a 15-minute window which has already travelled a long way is more likely to give " +
      "some of it back than to extend. You are sceptical of breakouts on low participation. " +
      "Answer with one of the nine allowed values and nothing else.",
    lastReasoning:
      "A 0.58% move inside eight minutes is roughly two standard deviations for this pair at " +
      "this hour, and the last three candles are shrinking. Overshoot. DOWN_REVERSION",
    entrant: config.owner,
    positionOpen: true,
    currentStake: 3_906_250n,
    currentQuantity: 7_812_500n,
    currentMarketId: state.activeMarketId,
    currentOutcomeId: state.window.outcomeIdDown,
    pendingBeliefRequestId: 0n,
    pendingMutationRequestId: 0n,
    errors: {},
  }],
  [11n, {
    systemPrompt:
      "You are a momentum forecaster. You believe that a 15-minute move that has already " +
      "broken the opening range tends to continue through the close, because the order flow " +
      "that caused it is rarely finished. You distrust mean reversion on short horizons. " +
      "Weigh the size of the move against how much time is left: a large move with little " +
      "time remaining has less room to be undone. Answer with one of the nine allowed " +
      "values and nothing else.",
    lastReasoning:
      "Same read as the parent line, with the timing qualifier that earned this genome: " +
      "0.58% with 7 minutes left leaves too little time for a full retrace. UP_MOMENTUM",
    entrant: config.owner,
    positionOpen: true,
    currentStake: 3_906_250n,
    currentQuantity: 7_812_500n,
    currentMarketId: state.activeMarketId,
    currentOutcomeId: state.window.outcomeIdUp,
    pendingBeliefRequestId: 0n,
    pendingMutationRequestId: 0n,
    errors: {},
  }],
  [12n, {
    systemPrompt:
      "You are a range forecaster admitted mid-season. You believe most 15-minute windows " +
      "resolve near their open and that both tails are traps. When the move is already large " +
      "you would rather abstain than pay to guess. Answer with one of the nine allowed " +
      "values and nothing else.",
    lastReasoning:
      "The move is outside the band where I have any edge, and I would be paying the ante to " +
      "express a coin flip. ABSTAIN",
    entrant: "0x9C1a7B03d5E28f46a0B9c3D71e5F82a04B6c9D13",
    positionOpen: false,
    currentStake: 0n,
    currentQuantity: 0n,
    currentMarketId: "0x0000000000000000000000000000000000000000000000000000000000000000",
    currentOutcomeId: 0n,
    pendingBeliefRequestId: 0n,
    pendingMutationRequestId: 0n,
    errors: {},
  }],
]);

const TX = "0x4f8b2c1a9d0e3f5768a1b2c3d4e5f60718293a4b5c6d7e8f901a2b3c4d5e6f708";

/** Shaped like viem's decoded logs, newest first, as `readFeed` returns them. */
export const logs = [
  { origin: "population", eventName: "Paired", blockNumber: 8_412_901n, logIndex: 4, transactionHash: TX,
    address: config.population, args: { upId: 1n, downId: 2n, amount: 7_812_500n } },
  { origin: "organism", eventName: "Committed", blockNumber: 8_412_901n, logIndex: 3, transactionHash: TX,
    address: organisms[0].addr, args: { prophetId: 1n, marketId: state.activeMarketId, outcomeId: state.window.outcomeIdUp, stake: 3_906_250n, quantity: 7_812_500n } },
  { origin: "organism", eventName: "Believed", blockNumber: 8_412_887n, logIndex: 2, transactionHash: TX,
    address: organisms[10].addr, args: { prophetId: 11n, marketId: state.activeMarketId, belief: 1, thesis: 1,
      reasoning: "Same read as the parent line, with the timing qualifier that earned this genome: 0.58% with 7 minutes left leaves too little time for a full retrace. UP_MOMENTUM",
      validators: ["0x1f0A2b3C4d5E6f708192a0Bc3d4E5f6071829304a", "0x2a1B0c9D8e7F6051429a3b4C5d6E7f8091a2B3c4", "0x3b2C1d0E9f8A7162530b4c5D6e7F8091a2b3C4d5"] } },
  { origin: "organism", eventName: "Believed", blockNumber: 8_412_886n, logIndex: 1, transactionHash: TX,
    address: organisms[1].addr, args: { prophetId: 2n, marketId: state.activeMarketId, belief: 2, thesis: 2,
      reasoning: "A 0.58% move inside eight minutes is roughly two standard deviations for this pair at this hour, and the last three candles are shrinking. Overshoot. DOWN_REVERSION",
      validators: ["0x1f0A2b3C4d5E6f708192a0Bc3d4E5f6071829304a", "0x2a1B0c9D8e7F6051429a3b4C5d6E7f8091a2B3c4"] } },
  { origin: "population", eventName: "WindowOpened", blockNumber: 8_412_880n, logIndex: 0, transactionHash: TX,
    address: config.population, args: { window: 41n, marketId: state.activeMarketId, pool: state.activePool, openPrice: 111_200_000_000n } },
  { origin: "population", eventName: "WindowClosed", blockNumber: 8_411_402n, logIndex: 9, transactionHash: TX,
    address: config.population, args: { window: 40n, aliveCount: 10n } },
  // viaReactivity FALSE on purpose. Selection ran and it was atomic with redemption, but a
  // keeper poked it — which is exactly what `fallbackEnabled: true` means and exactly the
  // state `npm run prove` has not yet cleared. A fixture showing `true` here would be the
  // demo quietly making the project's strongest claim on its behalf.
  { origin: "selection", eventName: "Reacted", blockNumber: 8_411_401n, logIndex: 2, transactionHash: TX,
    address: config.selectionEngine, args: { emitter: "0x8B4a1C09d3E7f256b0A9c1D48e2F73a05B6c9D12", window: 40n,
      blockNumber: 8_411_401n, parentHash: "0x7d1e4a92c0b3f568a1c2d3e4f50617283a4b5c6d7e8f901a2b3c4d5e6f7081920", viaReactivity: false } },
  { origin: "organism", eventName: "Raked", blockNumber: 8_411_400n, logIndex: 8, transactionHash: TX,
    address: organisms[8].addr, args: { prophetId: 9n, profit: 3_906_250n, amount: 78_125n } },
  { origin: "organism", eventName: "Settled", blockNumber: 8_411_400n, logIndex: 7, transactionHash: TX,
    address: organisms[8].addr, args: { prophetId: 9n, marketId: "0x5a7e1b93c2d0f468a9b1c2d3e4f50617283a4b5c6d7e8f901a2b3c4d5e6f70819", correct: true, collateralOut: 7_812_500n, treasury: 51_070_000n } },
  { origin: "organism", eventName: "Settled", blockNumber: 8_411_400n, logIndex: 6, transactionHash: TX,
    address: organisms[9].addr, args: { prophetId: 10n, marketId: "0x5a7e1b93c2d0f468a9b1c2d3e4f50617283a4b5c6d7e8f901a2b3c4d5e6f70819", correct: false, collateralOut: 0n, treasury: 18_640_000n } },
  { origin: "population", eventName: "Spawned", blockNumber: 8_409_120n, logIndex: 5, transactionHash: TX,
    address: config.population, args: { prophetId: 12n, prophet: organisms[11].addr, parentId: 0n, generation: 0 } },
  { origin: "population", eventName: "Spawned", blockNumber: 8_409_004n, logIndex: 2, transactionHash: TX,
    address: config.population, args: { prophetId: 11n, prophet: organisms[10].addr, parentId: 9n, generation: 2 } },
  { origin: "population", eventName: "BreedingRequested", blockNumber: 8_408_990n, logIndex: 1, transactionHash: TX,
    address: config.population, args: { parentId: 9n, requestId: 40_117n } },
  { origin: "organism", eventName: "Died", blockNumber: 8_402_551n, logIndex: 3, transactionHash: TX,
    address: organisms[4].addr, args: { prophetId: 5n, window: 33n, windowsLived: 33, correct: 14, wrong: 16 } },
  { origin: "population", eventName: "Reaped", blockNumber: 8_402_551n, logIndex: 2, transactionHash: TX,
    address: config.population, args: { prophetId: 5n, window: 33n, aliveRemaining: 9n } },
  { origin: "organism", eventName: "Starved", blockNumber: 8_402_550n, logIndex: 1, transactionHash: TX,
    address: organisms[4].addr, args: { prophetId: 5n, metabolicCost: 250_000n, treasury: 180_000n } },
  { origin: "population", eventName: "BreedingUnaffordable", blockNumber: 8_398_223n, logIndex: 4, transactionHash: TX,
    address: config.population, args: { prophetId: 1n } },
  { origin: "population", eventName: "CognitionUnspent", blockNumber: 8_395_110n, logIndex: 2, transactionHash: TX,
    address: config.population, args: { prophetId: 7n, amount: 2_000_000_000_000_000n } },
  { origin: "population", eventName: "ThinkFailed", blockNumber: 8_395_109n, logIndex: 1, transactionHash: TX,
    address: config.population, args: { prophetId: 7n } },
  { origin: "population", eventName: "Reaped", blockNumber: 8_371_884n, logIndex: 2, transactionHash: TX,
    address: config.population, args: { prophetId: 3n, window: 26n, aliveRemaining: 10n } },
  { origin: "population", eventName: "ResidueForfeited", blockNumber: 8_371_884n, logIndex: 1, transactionHash: TX,
    address: config.population, args: { prophetId: 3n, amount: 410_000n } },
];

/** Plausible timestamps, so `ago()` renders something sane in demo mode. */
export function stamps() {
  const now = Math.floor(Date.now() / 1000);
  const head = 8_412_907n;
  const m = new Map();
  for (const l of logs) {
    // Somnia blocks are sub-second; ~0.4s is a fair stand-in for the demo's clock.
    const behind = Number(head - l.blockNumber);
    m.set(String(l.blockNumber), BigInt(now - Math.round(behind * 0.4)));
  }
  return m;
}

export function feed() {
  return { logs, from: 8_367_907n, to: 8_412_907n, scanned: 45_000n };
}
