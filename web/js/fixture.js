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
  // NOT the owner, and the distinction is the whole point of the contract. The eight founders'
  // `entrant` is `GenesisTreasury` (`Population.sol:585`), so the season close pays first place
  // into a no-owner contract whose only function pushes it back into `prizePool`. `discover` does
  // not read this — `Population` exposes `genesisTreasury()` but the dashboard has no use for it
  // yet — so it lives here only to keep `entrantOf`'s fallback honest.
  genesisTreasury: "0x2B8fC5a1E934d70A6b8C2f5D91e04A73B6c58E2F",
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
  // FORTY-TWO IS THE ONLY VALUE THAT LETS THIS DEMO SHOW A SEASON CLOSE, and it is derived rather
  // than chosen. `endSeason` opens when `windowCount - seasonStartWindow >= seasonWindows`
  // (`Population.sol:940`). The snapshot below sits at window 41 with `seasonStartWindow: 0` and has
  // to still be mid-season — a demo whose opening frame is already a closeable season would be
  // showing a state the contract would not have left standing — so `seasonWindows > 41`; and the
  // scripted window turns to 42, the only turnover a judge watches, so `seasonWindows <= 42`. One
  // integer satisfies both, and the header now reads `41 / 42` on the frame a judge lands on.
  //
  // THE CONTRACT NOW SHIPS 24/4 — six hours, six levels — and this fixture deliberately does NOT
  // follow it. The comment that used to live here said the shipped season was 576/72, about six days,
  // so a fixture at the contract's own scale could never show the 60/30/10 payout. That justification
  // expired on 2026-09-05: at 24/4 a fixture at the contract's scale COULD show a close. The
  // divergence is kept anyway, and the reason is arithmetic rather than laziness. Every figure in the
  // four scripted frames below is derived from THESE numbers — the 41/42 header, the ante ladder, the
  // pot, and `RESIDUE_8`, which goes negative at a smaller `seasonWindows` and is the scripted death
  // the whole demo is built around. Re-deriving the season means re-tuning four frames and the 44
  // arithmetic assertions in `web/test/smoke.mjs`, on a page that prints `synthetic: true` on an
  // undismissable banner and recomputes every figure from this `config`. So the numbers stay, and
  // what is stated instead is the truth: this economy is NOT the contract's, on purpose. Read
  // `Population.initialize` for the real one (`levelWindows = 4`, `seasonWindows = 24`, closing at a
  // 32x ante); 42/12 here is 3.5 levels against the contract's six.
  seasonWindows: 42,
  rakeBps: 200n,
  prizeShareBps: 5_000n,
  // The three gates on reproduction, at `Population.initialize`'s defaults (Population.sol:412-414).
  // `season()` below derives who breeds from exactly these, so tuning one to make the demo look
  // better moves the answer and the smoke suite notices.
  breedStreak: 4,
  breedSurplusBps: 5_000n,
  maxPopulation: 24,
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
    birthWindow: 0n, deathWindow: 26n, dead: true, belief: 0, thesis: 1,
    genomeHash: "0x7c1b9d3e0f8a2456bd7e1c0a9f3b8524de6a1b0c7f9e2d3a5b8c4f1e0d7a69324",
  }),
  organism({
    id: 4n, addr: "0x4d5E6f708192a0Bc3D4e5F60718293a4B5c6D7e8",
    parentId: 0n, generation: 0, treasury: 31_960_000n, streak: 1,
    windowsLived: 41, correctCount: 20, wrongCount: 18, abstainCount: 3,
    birthWindow: 0n, deathWindow: 0n, dead: false, belief: 3, thesis: 0,
    genomeHash: "0x1e0d9c8b7a6f5342e1d0c9b8a7f6e5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c4",
  }),
  organism({
    id: 5n, addr: "0x5e6F708192a0bC3d4E5f60718293A4b5C6d7E8f9",
    parentId: 0n, generation: 0, treasury: 0n, streak: 0,
    windowsLived: 33, correctCount: 14, wrongCount: 16, abstainCount: 3,
    birthWindow: 0n, deathWindow: 33n, dead: true, belief: 0, thesis: 3,
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
  // ONE, NOT ZERO, AND IT IS THE CONTRACT'S NUMBER, NOT A PREFERENCE. `initialize` sets
  // `seasonId = 1` (`Population.sol:456`) and only `endSeason` ever moves it, by `seasonId += 1`
  // (`:870`) — which cannot have run here, because `endSeason` requires
  // `windowCount - seasonStartWindow >= seasonWindows` and this snapshot is 41 into 42. So a
  // freshly deployed arena on its first season reports exactly 1, and the rest of the season block
  // below has to agree with that reading: `seasonStartWindow: 0n` is the initializer's value
  // untouched, `windowCount: 41n` puts the demo 41/42 through the FIRST season, and `level: 3` with
  // `ante: 3_906_250n` are `level()`/`ante()` recomputed at that window ((41-0)/12 = 3, and
  // 2.00 x 1.25^3). This said 0 until 2026-09-03, which made the demo and the live chain disagree
  // about the same nominal state — the one thing `?demo=1` exists to rule out.
  //
  // ONE WINDOW SHORT OF THE CLOSE, deliberately. `seasonWindows: 42` above is the only length that
  // leaves this frame mid-season and still lets the scripted turnover close it, so the demo opens on
  // a season about to end and the script ends it — see THE SEASON, SCRIPTED below.
  seasonId: 1,
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
    entrant: config.genesisTreasury,
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
    entrant: config.genesisTreasury,
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
    entrant: config.genesisTreasury,
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
  // `Starved` ALWAYS REPORTS A TREASURY OF ZERO, and this row said 0.18 until 2026-09-06.
  //
  // `Prophet.settleWindow` (`Prophet.sol:576-579`) takes `charge = min(treasury, metabolicCost)`,
  // sets `starved = charge < metabolicCost`, then subtracts. Starving therefore MEANS the charge was
  // the whole treasury, so the treasury the event carries is `0` in every case the chain can produce
  // — a non-zero one is an organism that paid the full cost and did not starve at all. The figure
  // that varies is `metabolicCost`, which is what it could not reach.
  //
  // The pair below is the other half of the same reading: #5 starved, so there was nothing left to
  // forfeit and no `ResidueForfeited` row follows it. #3's forfeit at the bottom of this feed is the
  // OTHER death, and the two are mutually exclusive per organism per window — see `:1748-1762` of
  // `Population.sol`, where `residue = p.treasury()` is read after that subtraction.
  { origin: "organism", eventName: "Starved", blockNumber: 8_402_550n, logIndex: 1, transactionHash: TX,
    address: organisms[4].addr, args: { prophetId: 5n, metabolicCost: config.metabolicCost, treasury: 0n } },
  { origin: "population", eventName: "BreedingUnaffordable", blockNumber: 8_398_223n, logIndex: 4, transactionHash: TX,
    address: config.population, args: { prophetId: 1n } },
  { origin: "population", eventName: "CognitionUnspent", blockNumber: 8_395_110n, logIndex: 2, transactionHash: TX,
    address: config.population, args: { prophetId: 7n, amount: 2_000_000_000_000_000n } },
  { origin: "population", eventName: "ThinkFailed", blockNumber: 8_395_109n, logIndex: 1, transactionHash: TX,
    address: config.population, args: { prophetId: 7n } },
  { origin: "population", eventName: "Reaped", blockNumber: 8_371_884n, logIndex: 2, transactionHash: TX,
    address: config.population, args: { prophetId: 3n, window: 26n, aliveRemaining: 10n } },
  // A FORFEIT IS ALWAYS SMALLER THAN THE METABOLIC COST. This said 0.41 against a 0.25 charge until
  // 2026-09-06, which is an organism that could afford to think and would not have been reaped.
  //
  // The reachable shape is narrow. `Population.sol:1796` reaps on `starved || treasury < cost`, and
  // `residue` is read after the charge, so a non-zero residue means the organism was NOT starved —
  // it paid the full cost — and was still reaped, which requires what remained to be under one more
  // charge. So `0 < amount < metabolicCost`, strictly, and this row is the other death: #3 covered
  // its rent and then could not cover the next one.
  { origin: "population", eventName: "ResidueForfeited", blockNumber: 8_371_884n, logIndex: 1, transactionHash: TX,
    address: config.population, args: { prophetId: 3n, amount: config.metabolicCost - 90_000n } },
];

/** Plausible timestamps, so `ago()` renders something sane in demo mode. */
export function stampsFor(rows, head) {
  const now = Math.floor(Date.now() / 1000);
  const m = new Map();
  for (const l of rows) {
    // Somnia blocks are sub-second; ~0.4s is a fair stand-in for the demo's clock.
    const behind = Math.max(0, Number(head - l.blockNumber));
    m.set(String(l.blockNumber), BigInt(now - Math.round(behind * 0.4)));
  }
  return m;
}

export function stamps() {
  return stampsFor(logs, 8_412_907n);
}

export function feed() {
  return { logs, from: 8_367_907n, to: 8_412_907n, scanned: 45_000n };
}

/*//////////////////////////////////////////////////////////////
                      THE SEASON, SCRIPTED
//////////////////////////////////////////////////////////////*/

/**
 *  One window of the machine, in four frames, so the moments that matter can actually happen.
 *
 *  WHY THIS EXISTS. Everything above is a single frozen snapshot, and a frozen snapshot cannot show
 *  the only things this project is actually about. `motion.js` animates a DIFF — birth, death, a
 *  treasury moving, the phase advancing — so against one static frame not one of those timelines can
 *  ever fire. The demo was showing an arena where nothing was at stake, which is the opposite of the
 *  claim. Four frames later a judge has watched an organism lose an ante it could not afford and be
 *  reaped, watched a survivor spend forty percent of its treasury on a child, and watched the window
 *  turn over.
 *
 *  IT IS NOT A SIMULATOR. It is data, and it plays through the real pipeline: `main.js` swaps the
 *  snapshot, `advance()` diffs it exactly as it diffs a chain read, `render.js` stamps what changed
 *  and `motion.js` plays it. Nothing here calls an animation, and nothing downstream can tell these
 *  frames from an RPC. That is the same discipline `?demo=1` already keeps — swap the data source
 *  and only the data source.
 *
 *  IT RUNS FORWARD AND STOPS. It does not loop, and the reason is not brevity: **death is
 *  irreversible**, on chain and in `Prophet.sol`, with no path anywhere that clears `dead`. A demo
 *  that wrapped back to the first frame would resurrect #8 every twenty seconds and quietly
 *  contradict the hardest invariant the project has. So it plays one window and rests.
 *
 *  AND IT RESTS ON THE SEASON CLOSING. The window it turns to is 42, which is the window
 *  `seasonWindows: 42` makes closeable, so `closeSeason` runs at the end of that frame and the demo's
 *  final beat is the prize pool paying out 60/30/10 to the three best living records. That beat had
 *  never been on screen: `SUMMARY.SeasonEnded` and `SUMMARY.SeasonPrizePaid` (`render.js:1463-1464`)
 *  existed and had never once executed, so the one thing the arena is FOR — a pot the survivors are
 *  competing for — was the only part of the machine no reviewer could see. The pot is not a number in
 *  this file; it is what the settlement two frames earlier put into it.
 *
 *  EVERY NUMBER BELOW IS DERIVED, NOT CHOSEN. The deltas come from `config`, and who breeds comes
 *  from `Population.sol` — `_breedThreshold()` is `endowment + breedSurplusBps`, so 40 + 50% = 60
 *  tUSDC, and `breedStreak` is 4. After this settlement exactly one organism clears both bars, and
 *  it is not the one that would have made the better picture: #11 is the deepest line and stays at
 *  streak 3. #1 breeds because the rules say so.
 *
 *  ONE MODELLING CHOICE, STATED. A window's whole effect lands at SETTLEMENT here, and commitment
 *  moves no treasury. On chain the stake leaves at commit and comes back at redemption, so the real
 *  balance dips in between; the net per window is identical either way. Frame 0 above is already a
 *  committed window whose treasuries are not net of stake, and matching it beats being more precise
 *  than the frame this progression starts from.
 */

const ANTE = state.ante; // 3.90625 tUSDC — baseAnte compounded to level 3
const RAKE_ON_WIN = (ANTE * config.rakeBps) / 10_000n; // 78,125 — the skim is on profit only
const META = config.metabolicCost; // 0.25 tUSDC, charged per settled window

// A paired winner takes the whole backing, so its profit is exactly one ante.
const WON = ANTE - RAKE_ON_WIN - META; // +3.578125
const LOST = -(ANTE + META); // -4.156250
const IDLE = -META; // abstained, unpaired, or never formed a belief

const TX2 = "0x5a9c3d2b1e0f4867a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70819";
// `endSeason` IS ITS OWN TRANSACTION, AND ANYBODY'S. It is permissionless (`Population.sol:981` takes
// no modifier and `Darwin.t.sol` closes a season from `address(0xDEAD)`), so it cannot share TX2 with
// the driver's `commitAll` — and it lands in the block after it, because the commits are what filled
// the window it closes. A close folded into the commit transaction would be claiming the driver did
// it, which is the one thing this project's whole argument says is not required.
const TX3 = "0x6b0d4e3c2f1a5978b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081920";
const CLOSE_BLOCK = 8_413_121n;
const VALIDATORS = [
  "0x1f0A2b3C4d5E6f708192a0Bc3d4E5f6071829304a",
  "0x2a1B0c9D8e7F6051429a3b4C5d6E7f8091a2B3c4",
  "0x3b2C1d0E9f8A7162530b4c5D6e7F8091a2b3C4d5",
];

const at = (id) => organisms.find((o) => o.id === id);
const money = (id, delta) => at(id).treasury + delta;

// WHAT #8'S ANTE LEAVES BEHIND, as the subtraction rather than as a number. 4.00 held against a
// level-3 ante of 3.90625 leaves 0.09375, which is less than the 0.25 metabolic charge — so the
// forfeit, the two rows that report it and the prize pool it lands in all move together if anyone
// re-tunes `baseAnte` or `anteMultBps`, instead of three literals drifting apart.
const RESIDUE_8 = at(8n).treasury - ANTE;

/**
 *  `_book` (`Population.sol:1136`), mirrored, because a prize pool is not a number this file gets to
 *  pick — it is what the settlement paid into it.
 *
 *  `settleAll` calls `_book(charged + raked)` ONCE PER ORGANISM (`:1791`), and each call splits that
 *  organism's income at `prizeShareBps`, keeping integer division's remainder in the rake. Per
 *  organism is the part that matters: a winner books 0.328125, which halves with one wei left over,
 *  nine times over rather than once. A pool computed off the summed income is three wei out — small
 *  enough to read as a typo and large enough to make the payout below unfalsifiable.
 */
const bookPool = (income) => (income * config.prizeShareBps) / 10_000n;
const bookRake = (income) => income - bookPool(income);

/**
 *  Window 41's income, one entry per organism that settles.
 *
 *  #1, #6 and #11 won, so each pays the metabolic charge AND the rake on one ante of profit; #2, #4,
 *  #7, #9, #10 and #12 settle and pay rent only. The three winners are exactly the rows carrying a
 *  `Raked` log in frame 0, and the six others are the rest of the living population.
 *
 *  #8 PAYS WHAT IT HAS AS RENT, AND FORFEITS NOTHING. This was a `Starved` row and a
 *  `ResidueForfeited` row both carrying 0.09375 until 2026-09-06 — the same money reported twice, in
 *  a pair the contract cannot emit for one organism in one window.
 *
 *  `Prophet.settleWindow` charges `min(treasury, metabolicCost)` (`Prophet.sol:576-579`), so an
 *  organism that starves has paid its ENTIRE balance as rent and its `treasury` is 0 by the time
 *  `settleAll` reads it. `Population.sol:1757` computes `residue = p.treasury()` after that. So a
 *  starved organism has nothing to forfeit, and an organism WITH a residue was not starved. The two
 *  events are mutually exclusive per organism per window, and #8 is the starving one: 0.09375 against
 *  a 0.25 charge.
 *
 *  It matters to the pot rather than only to the feed, which is why this is not a cosmetic edit. The
 *  forfeit would have sent all 0.09375 to the players whole (`Population.sol:1760`); the charge sends
 *  it through `_book`, which halves it at `prizeShareBps` and gives the house the other half. The
 *  demo's pot is 0.046875 smaller for following the contract, and every figure below re-derives.
 */
const INCOME_41 = [
  ...[1n, 6n, 11n].map(() => META + RAKE_ON_WIN),
  ...[2n, 4n, 7n, 9n, 10n, 12n].map(() => META),
  // The organism that starved is income too — `settleAll` calls `_book(charged + raked)` for every
  // organism it settles, "including one that dies in the same breath: the rent was paid, and rent is
  // income" (`Population.sol:1738-1743`). What it paid is all it had.
  RESIDUE_8,
];
const POOL_41 = INCOME_41.reduce((a, i) => a + bookPool(i), 0n);
const RAKE_41 = INCOME_41.reduce((a, i) => a + bookRake(i), 0n);

// Window 42's market. A NEW pool address and new outcome ids, because pools are recycled and
// outcome ids encode the pool nonce — the one thing `chain.js` is forbidden to cache.
const MARKET_42 = "0x7c9a3b02d1e4f658c9b2d3e4f50617283a4b5c6d7e8f901a2b3c4d5e6f708192";
const POOL_42 = "0x3F0e6D2b9C8a147F5e3d0B2c9A8f1674E5d3b0C2";

/** The child #1 earns in frame 1 and receives in frame 2. */
const CHILD = {
  id: 13n,
  addr: "0xD5e6F70819203a4B5c6D7e8f9012345678aB9c1d",
  parentId: 1n,
  generation: 1,
  treasury: config.endowment,
  streak: 0,
  windowsLived: 0,
  correctCount: 0,
  wrongCount: 0,
  abstainCount: 0,
  birthWindow: 41n,
  deathWindow: 0n,
  dead: false,
  belief: 0,
  thesis: 0,
  genomeHash: "0xe5f6071829304a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f901ab2c3d",
};

// Selectable the moment it exists. The genome is #1's with one clause rewritten, which is what
// mutation actually produces — a child is not a fresh idea, it is a parent's idea with a variation
// that either survives contact with the market or does not.
details.set(13n, {
  systemPrompt:
    "You are a momentum forecaster. You believe that a 15-minute move that has already " +
    "broken the opening range tends to continue through the close, because the order flow " +
    "that caused it is rarely finished. You require that the move still be accompanied by " +
    "participation, and you treat a continuation on thinning volume as exhaustion instead. " +
    "Answer with one of the nine allowed values and nothing else.",
  lastReasoning:
    "First window. The inherited read plus the clause that was mutated into it: continuation is " +
    "the base case, but only while the move is still being paid for. It is. UP_MOMENTUM",
  entrant: config.genesisTreasury,
  positionOpen: true,
  currentStake: ANTE,
  currentQuantity: 7_812_500n,
  currentMarketId: MARKET_42,
  currentOutcomeId: 84_211_009_477_331_244n,
  pendingBeliefRequestId: 0n,
  pendingMutationRequestId: 0n,
  errors: {},
});

/**
 *  The frames, each expressed as what CHANGED — which is the same thing `advance()` will recover
 *  from it, so writing them any other way would hide the arithmetic this file is asserting.
 *
 *  `after` is milliseconds to wait before playing the frame. They are deliberately uneven: the two
 *  frames carrying a death and a birth get room to be read, and the two that only move the phase
 *  machine along do not need it.
 */
const SCRIPT = [
  {
    note: "settleAll — window 41 pays out, #8 cannot cover the ante, #1 earns a child",
    after: 4200,
    state: {
      phase: 0,
      aliveCount: 9n,
      livingCount: 9n,
      // BOTH BOOKS MOVE, and the pool moves further than the rake. This line credited three winners'
      // skim to `rakeAccrued` and left `prizePool` untouched until 2026-09-04 — in the very frame that
      // forfeits a corpse's residue INTO the prize pool, so the header's pool sat still while the feed
      // said it had just been paid. See `bookPool`/`bookRake` above: nine organisms paid rent, three of
      // them also paid a skim, `prizeShareBps: 5_000` halves each of those payments as it arrives, and
      // the forfeit goes to the players whole (`Population.sol:1831`).
      rakeAccrued: state.rakeAccrued + RAKE_41,
      prizePool: state.prizePool + POOL_41,
      blockNumber: 8_412_950n,
      window: { ...state.window, secondsRemaining: 0n },
    },
    // EVERY SETTLED ROW CLEARS ITS BELIEF, because `Prophet.settleWindow` does: `belief =
    // Belief.None` at `Prophet.sol:610`, and `die` does the same at `:618`. `lastThesis` is
    // deliberately NOT cleared alongside it — it has exactly one writer, `:263`, in the thinking
    // path — so a settled organism carries no direction and still remembers why it last had one.
    // Without this the window-41 tags rode through settlement, through the birth, and into window
    // 42, which made a belief read as a permanent attribute of the organism rather than as this
    // window's answer.
    rows: {
      // Up was right: the close is 0.58% above the open.
      1: { treasury: money(1n, WON), streak: 4, windowsLived: 42, correctCount: 25, belief: 0 },
      2: { treasury: money(2n, LOST), streak: 0, windowsLived: 42, wrongCount: 24, belief: 0 },
      4: { treasury: money(4n, IDLE), windowsLived: 42, abstainCount: 4, belief: 0 },
      6: { treasury: money(6n, WON), streak: 3, windowsLived: 42, correctCount: 23, belief: 0 },
      // Still alive, and now two windows from starving instead of three. The dashboard's job is
      // to show this before it happens.
      7: { treasury: money(7n, IDLE), windowsLived: 42, belief: 0 },
      // THE ESCALATING ANTE DOES THE KILLING. #8 had 4.00 and the ante at level 3 is 3.90625, so
      // one wrong call leaves 0.09375 against a metabolic charge of 0.25. It starves inside the
      // same settlement and is reaped. Nothing chose it. It forfeits NOTHING — `Prophet.sol:596`
      // charges `min(treasury, metabolicCost)`, so starving means the charge took everything and
      // `Population.sol:1828` reads the residue after that. See `INCOME_41`.
      8: { treasury: 0n, streak: 0, windowsLived: 42, wrongCount: 20, dead: true, deathWindow: 41n, belief: 0 },
      // Up, but every Down was already taken, so it held a zero-size position: no stake at risk,
      // metabolism charged anyway. Its streak of 4 survives untested.
      9: { treasury: money(9n, IDLE), windowsLived: 23, belief: 0 },
      10: { treasury: money(10n, LOST), streak: 0, windowsLived: 15, wrongCount: 8, belief: 0 },
      11: { treasury: money(11n, WON), streak: 3, windowsLived: 8, correctCount: 6, belief: 0 },
      12: { treasury: money(12n, IDLE), windowsLived: 8, abstainCount: 1, belief: 0 },
    },
    // Newest first, which for one transaction means descending `logIndex`.
    logs: [
      { origin: "population", eventName: "WindowClosed", blockNumber: 8_412_950n, logIndex: 14, transactionHash: TX2,
        address: config.population, args: { window: 41n, aliveCount: 9n } },
      { origin: "organism", eventName: "Raked", blockNumber: 8_412_950n, logIndex: 13, transactionHash: TX2,
        address: at(11n).addr, args: { prophetId: 11n, profit: ANTE, amount: RAKE_ON_WIN } },
      { origin: "organism", eventName: "Settled", blockNumber: 8_412_950n, logIndex: 12, transactionHash: TX2,
        address: at(11n).addr, args: { prophetId: 11n, marketId: state.activeMarketId, correct: true, collateralOut: 7_812_500n, treasury: money(11n, WON) } },
      { origin: "organism", eventName: "Settled", blockNumber: 8_412_950n, logIndex: 11, transactionHash: TX2,
        address: at(10n).addr, args: { prophetId: 10n, marketId: state.activeMarketId, correct: false, collateralOut: 0n, treasury: money(10n, LOST) } },
      { origin: "population", eventName: "Reaped", blockNumber: 8_412_950n, logIndex: 10, transactionHash: TX2,
        address: config.population, args: { prophetId: 8n, window: 41n, aliveRemaining: 9n } },
      { origin: "organism", eventName: "Died", blockNumber: 8_412_950n, logIndex: 9, transactionHash: TX2,
        address: at(8n).addr, args: { prophetId: 8n, window: 41n, windowsLived: 42, correct: 19, wrong: 20 } },
      // NO `ResidueForfeited` HERE — see `INCOME_41`. #8 starved, which means the charge took its
      // whole 0.09375 as rent, which means there was nothing left for the forfeit to move. This block
      // emitted both events with the same amount until 2026-09-06, reporting one payment twice in a
      // combination `settleAll` cannot produce for one organism in one window.
      //
      // `Settled` and `Starved` both report the treasury AFTER the charge, and `Prophet.sol:576-579`
      // makes that exactly 0 whenever `starved` is true.
      { origin: "organism", eventName: "Starved", blockNumber: 8_412_950n, logIndex: 7, transactionHash: TX2,
        address: at(8n).addr, args: { prophetId: 8n, metabolicCost: META, treasury: 0n } },
      { origin: "organism", eventName: "Settled", blockNumber: 8_412_950n, logIndex: 6, transactionHash: TX2,
        address: at(8n).addr, args: { prophetId: 8n, marketId: state.activeMarketId, correct: false, collateralOut: 0n, treasury: 0n } },
      { origin: "organism", eventName: "Raked", blockNumber: 8_412_950n, logIndex: 5, transactionHash: TX2,
        address: at(6n).addr, args: { prophetId: 6n, profit: ANTE, amount: RAKE_ON_WIN } },
      { origin: "organism", eventName: "Settled", blockNumber: 8_412_950n, logIndex: 4, transactionHash: TX2,
        address: at(6n).addr, args: { prophetId: 6n, marketId: state.activeMarketId, correct: true, collateralOut: 7_812_500n, treasury: money(6n, WON) } },
      { origin: "organism", eventName: "Settled", blockNumber: 8_412_950n, logIndex: 3, transactionHash: TX2,
        address: at(2n).addr, args: { prophetId: 2n, marketId: state.activeMarketId, correct: false, collateralOut: 0n, treasury: money(2n, LOST) } },
      { origin: "population", eventName: "BreedingRequested", blockNumber: 8_412_950n, logIndex: 2, transactionHash: TX2,
        address: config.population, args: { parentId: 1n, requestId: 40_118n } },
      { origin: "organism", eventName: "Raked", blockNumber: 8_412_950n, logIndex: 1, transactionHash: TX2,
        address: at(1n).addr, args: { prophetId: 1n, profit: ANTE, amount: RAKE_ON_WIN } },
      { origin: "organism", eventName: "Settled", blockNumber: 8_412_950n, logIndex: 0, transactionHash: TX2,
        address: at(1n).addr, args: { prophetId: 1n, marketId: state.activeMarketId, correct: true, collateralOut: 7_812_500n, treasury: money(1n, WON) } },
    ],
  },

  {
    note: "hatchAll — #1 pays a full endowment out of its own treasury for generation 1",
    after: 5200,
    state: { prophetCount: 13n, aliveCount: 10n, livingCount: 10n, blockNumber: 8_413_002n },
    // The count-down on this card is the point. Breeding is not a reward, it is a purchase.
    rows: { 1: { treasury: money(1n, WON) - config.endowment } },
    add: [CHILD],
    logs: [
      { origin: "population", eventName: "Spawned", blockNumber: 8_413_002n, logIndex: 0, transactionHash: TX2,
        address: config.population, args: { prophetId: 13n, prophet: CHILD.addr, parentId: 1n, generation: 1 } },
    ],
  },

  {
    note: "think — window 42 opens, beliefs land, #7's inference fails again",
    after: 4600,
    state: {
      phase: 1,
      windowCount: 42n,
      activeMarketId: MARKET_42,
      activePool: POOL_42,
      blockNumber: 8_413_060n,
      window: {
        marketId: MARKET_42,
        pool: POOL_42,
        outcomeIdUp: 84_211_009_477_331_244n,
        outcomeIdDown: 84_211_009_477_331_245n,
        openPrice: 111_845_310_000n,
        lastPrice: 111_902_770_000n,
        priceDecimals: 6,
        secondsRemaining: 793n,
        tradeable: true,
      },
    },
    rows: {
      2: { belief: 2, thesis: 2 },
      4: { belief: 3, thesis: 0 },
      6: { belief: 1, thesis: 3 },
      10: { belief: 2, thesis: 2 },
      12: { belief: 3, thesis: 0 },
      13: { belief: 1, thesis: 1 }, // its first thought, on the thesis it inherited
    },
    logs: [
      { origin: "population", eventName: "CognitionUnspent", blockNumber: 8_413_060n, logIndex: 4, transactionHash: TX2,
        address: config.population, args: { prophetId: 7n, amount: config.requestDeposit } },
      { origin: "population", eventName: "ThinkFailed", blockNumber: 8_413_060n, logIndex: 3, transactionHash: TX2,
        address: config.population, args: { prophetId: 7n } },
      { origin: "organism", eventName: "Believed", blockNumber: 8_413_060n, logIndex: 2, transactionHash: TX2,
        address: CHILD.addr, args: { prophetId: 13n, marketId: MARKET_42, belief: 1, thesis: 1,
          reasoning: "First window. The inherited read plus the clause that was mutated into it: continuation is the base case, but only while the move is still being paid for. It is. UP_MOMENTUM",
          validators: VALIDATORS } },
      { origin: "organism", eventName: "Believed", blockNumber: 8_413_060n, logIndex: 1, transactionHash: TX2,
        address: at(1n).addr, args: { prophetId: 1n, marketId: MARKET_42, belief: 1, thesis: 1,
          reasoning: "The close held the whole of last window's gain and the new window has opened above it. Nothing here says the flow is finished. UP_MOMENTUM",
          validators: VALIDATORS } },
      { origin: "population", eventName: "WindowOpened", blockNumber: 8_413_060n, logIndex: 0, transactionHash: TX2,
        address: config.population, args: { window: 42n, marketId: MARKET_42, pool: POOL_42, openPrice: 111_845_310_000n } },
    ],
  },

  {
    note: "commitAll — positions are open again, and then the season ends and pays out",
    after: 4000,
    // AND THE SEASON CLOSES ON THIS FRAME. Not a fifth frame: `endSeason` is a separate,
    // permissionless call in the next block, and `closeSeason` below appends it to this one so the
    // demo's last beat is the pot being paid instead of a window merely reopening. See `closeSeason`
    // for why every figure it emits is computed off the state this frame lands in.
    close: true,
    state: {
      phase: 2,
      blockNumber: 8_413_120n,
      window: { marketId: MARKET_42, pool: POOL_42, outcomeIdUp: 84_211_009_477_331_244n,
        outcomeIdDown: 84_211_009_477_331_245n, openPrice: 111_845_310_000n, lastPrice: 111_960_400_000n,
        priceDecimals: 6, secondsRemaining: 640n, tradeable: true },
    },
    logs: [
      { origin: "population", eventName: "Paired", blockNumber: 8_413_120n, logIndex: 3, transactionHash: TX2,
        address: config.population, args: { upId: 13n, downId: 10n, amount: 7_812_500n } },
      { origin: "organism", eventName: "Committed", blockNumber: 8_413_120n, logIndex: 2, transactionHash: TX2,
        address: CHILD.addr, args: { prophetId: 13n, marketId: MARKET_42, outcomeId: 84_211_009_477_331_244n, stake: ANTE, quantity: 7_812_500n } },
      { origin: "population", eventName: "Paired", blockNumber: 8_413_120n, logIndex: 1, transactionHash: TX2,
        address: config.population, args: { upId: 1n, downId: 2n, amount: 7_812_500n } },
      { origin: "organism", eventName: "Committed", blockNumber: 8_413_120n, logIndex: 0, transactionHash: TX2,
        address: at(1n).addr, args: { prophetId: 1n, marketId: MARKET_42, outcomeId: 84_211_009_477_331_244n, stake: ANTE, quantity: 7_812_500n } },
    ],
  },
];

/**
 *  `entrant` for any id, by the rule the contract uses rather than by lookup.
 *
 *  `spawnGenesis` passes `genesisTreasury` as the entrant of every founder
 *  (`Population.sol:585`), and `_hatch` passes `parent.entrant()` (`:1643`), so an entrant is
 *  inherited the whole way down a line and only a ROOT can differ. #12 is the one row here that
 *  differs: it paid its own way in. That makes `entrant() == address(0)` unreachable on any
 *  organism this contract can create, which is worth knowing before reading `endSeason`'s
 *  roll-over branch — see `closeSeason`.
 *
 *  The founders' entrant is therefore the TREASURY, not the operator, and this fixture models it
 *  that way: `config.genesisTreasury` is what the fallback returns. It matters for the season
 *  close specifically — first place here is a founder, so 60% of the pot is paid to a contract
 *  whose only function is `recycle()`, which pushes it straight back into `prizePool`. Written as
 *  `config.owner` the same row would show the house taking the players' pot, which is the exact
 *  reading `GenesisTreasury` exists to make impossible.
 */
function entrantOf(id, rows) {
  const known = details.get(id)?.entrant;
  if (known) return known;
  const o = rows.find((x) => x.id === id);
  return o && o.parentId !== 0n ? entrantOf(o.parentId, rows) : config.genesisTreasury;
}

/**
 *  `_topThree` (`Population.sol:998`), mirrored: the three living organisms with the best net record.
 *
 *  Written as the contract's cascade and NOT as a comparison anyone reinvented, because the strictness
 *  is the whole content of it. The contract walks the lineage in id order and replaces a slot only on a
 *  STRICT improvement, so a tie is kept by whoever got there first, which is the LOWER id. Write `>=`
 *  instead and every tie is promoted to the LATER id — which is a real payout going to the wrong
 *  organism, and `web/test/smoke.mjs` keeps a `>=` twin of this function purely to prove that its tie
 *  check can tell the two apart. (A stable `sort` by score is NOT the hazard: `Array.prototype.sort`
 *  has been stable since ES2019, and perturbing this function into one changed no winner. The comment
 *  here said otherwise until it was actually tried.) The score is signed for the contract's own reason:
 *  an organism can be net-wrong, and clamping that to zero would make it indistinguishable from one
 *  that never called.
 */
function topThree(rows) {
  const net = (o) => (o == null ? null : BigInt(o.correctCount) - BigInt(o.wrongCount));
  let best = [null, null, null];
  for (const o of rows) {
    if (o.dead) continue;
    const s = net(o);
    if (best[0] == null || s > net(best[0])) best = [o, best[0], best[1]];
    else if (best[1] == null || s > net(best[1])) best = [best[0], o, best[1]];
    else if (best[2] == null || s > net(best[2])) best = [best[0], best[1], o];
  }
  return best;
}

/**
 *  `endSeason()` (`Population.sol:939`), mirrored over a frame — the one beat this demo could not show.
 *
 *  WHY IT IS A FUNCTION AND NOT FOUR HAND-WRITTEN LOG ROWS. The payout is not a figure anyone here is
 *  entitled to choose: it is 60/30/10 of whatever the settlement above left in the pool, paid to
 *  whichever three living organisms have the best net record. Written out as literals it would be four
 *  numbers that agree with the population by coincidence until somebody re-tuned a record, and the
 *  season-close row on screen would then be quietly lying about the arena underneath it. Written as
 *  this function it cannot be: the pot is read off the frame, the shares are `splitBps` applied to it,
 *  the winners come from the same cascade the contract runs, and `web/test/smoke.mjs` recomputes all
 *  of it a second time from `Population.sol`'s constants.
 *
 *  WHAT THE CONTRACT DOES THAT THE FEED THEREFORE SHOWS:
 *    - the pot is read ONCE (`:894`), so all three shares divide the same number and the two rounded
 *      wei that integer division loses roll over instead of being paid;
 *    - `paid` is the SUM OF WHAT WAS ACTUALLY TRANSFERRED, so `prizePool = pot - paid` (`:922`) is the
 *      roll-over — `Darwin.t.sol` calls this out: unawarded places must roll over, not vanish;
 *    - the events carry the season that ENDED (`:910`, `:916`), and `seasonId += 1` happens after
 *      (`:923`), so the feed says "season 1 ended" while the header has already moved to season 2;
 *    - `seasonStartWindow = windowCount` (`:980`), which resets `level()` to 0 and `ante()` to
 *      `baseAnte` — the escalating ante starts over, which is the point of having seasons at all.
 *
 *  ONE BRANCH IS DELIBERATELY NOT EXERCISED, and it is not an oversight. `:966-967` skips a winner
 *  whose `entrant()` is `address(0)`. That guard's comment used to reason "a founder has no
 *  entrant", which was false from the day `spawnGenesis` was written and is now false twice over:
 *  founders pay `genesisTreasury` (`:585`), entrants pay themselves, and `_hatch` inherits
 *  (`:1643`), so no organism this contract can create ever has a zero entrant. The guard stays in
 *  the contract because `endSeason` must not be able to REVERT on one unpayable winner — a share it
 *  cannot deliver rolls into the next pot. All three winners here are paid, because on the deployed
 *  path all three would be.
 */
function closeSeason({ state: s, logs: l }) {
  const pot = s.prizePool;
  const splitBps = [6_000n, 3_000n, 1_000n];
  const winners = topThree(s.organisms);

  let paid = 0n;
  const rows = [];
  winners.forEach((o, k) => {
    if (o == null) return;
    const cut = (pot * splitBps[k]) / 10_000n;
    if (cut === 0n) return;
    const to = entrantOf(o.id, s.organisms);
    if (to === "0x0000000000000000000000000000000000000000") return;
    paid += cut;
    rows.push({
      origin: "population", eventName: "SeasonPrizePaid", blockNumber: CLOSE_BLOCK, logIndex: k,
      transactionHash: TX3, address: config.population,
      args: { season: s.seasonId, prophetId: o.id, to, amount: cut },
    });
  });
  rows.push({
    origin: "population", eventName: "SeasonEnded", blockNumber: CLOSE_BLOCK, logIndex: rows.length,
    transactionHash: TX3, address: config.population,
    args: { season: s.seasonId, pot, paid },
  });

  return {
    state: {
      ...s,
      prizePool: pot - paid,
      seasonId: s.seasonId + 1,
      seasonStartWindow: s.windowCount,
      // `level()` is `(windowCount - seasonStartWindow) / levelWindows` and the line above just made
      // those equal, so the new season opens at level 0 with the ante un-compounded. The organisms
      // already holding positions staked the level-3 ante minutes ago; that is not a contradiction,
      // it is what a season boundary IS.
      level: 0,
      ante: config.baseAnte,
      blockNumber: CLOSE_BLOCK,
    },
    // Newest-first, which is the order `main.js` hands the feed. `endSeason` emits the payouts first
    // and `SeasonEnded` last (`:908` then `:914`), so reversing the chain's own log order puts the
    // close on top and the placings climbing UP from tenth to sixtieth beneath it. That is not the
    // flattering order — first place is at the bottom — and it is the only one a chain read produces.
    logs: [...rows.reverse(), ...l],
  };
}

/**
 *  The script as complete frames: `{ after, note, state, logs }`, each one a whole snapshot shaped
 *  exactly like a chain read, because that is what `main.js` is going to hand to `advance()`.
 *
 *  Built by folding the patches above over the base, which keeps the source auditable — a frame
 *  that only says "#8 is dead now" cannot silently disagree with the eleven rows it left alone.
 *  `at` and `blockTimestamp` are deliberately NOT set here: they are wall-clock, and the caller
 *  stamps them when the frame is actually played. See `bootDemo` in `main.js`.
 */
export function season() {
  const frames = [];
  let prev = { state, logs };

  for (const spec of SCRIPT) {
    const rows = prev.state.organisms.map((o) => {
      const changes = spec.rows?.[Number(o.id)];
      return changes ? { ...o, ...changes } : o;
    });
    for (const c of spec.add || []) rows.push(organism(c));

    const next = {
      state: { ...prev.state, ...spec.state, organisms: rows },
      logs: [...spec.logs, ...prev.logs],
    };
    const done = spec.close ? closeSeason(next) : next;
    frames.push({ after: spec.after, note: spec.note, ...done });
    prev = done;
  }
  return frames;
}

