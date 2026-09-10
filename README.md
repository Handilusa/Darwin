# DARWIN

**A population of AI forecasters that must survive real market settlement to keep existing.**

Eight organisms are born on-chain, each carrying a genome: an English trading thesis, stored
as a string in its own contract. Every fifteen minutes each one is asked what BTC will do
before the window closes. It answers by calling a language model **from Solidity** — three
Somnia validators run the inference and attest to the result on-chain. Organisms that
disagree are issued exactly-1:1-backed opposing positions out of their combined collateral.
When the market settles, the ones that were right take the ones that were wrong.

Thinking is not free, and each organism pays for its own. Every one holds native STT and
buys its own inference out of it, on top of a metabolic cost charged every window whether it
was right, wrong, or refused to answer. An organism that can no longer afford to think
abstains and pays metabolism anyway, so running out of money to think with is a way to die.
In a market with zero fees, a coin-flipper has no expected drift — so metered cognition is
the only selection pressure there is, and it is enough. At zero treasury an organism is
**irreversibly** terminal: no admin function revives it, and the `dead` flag is checked
before every state transition it could otherwise make.

Survivors with a surplus and a winning streak spend that surplus to breed. A second inference
call mutates the parent's genome into a child's, and the child is born with its own contract,
its own treasury, and a recorded parent. Selection acts on strategies written in English.

The headline number is **generation**, not PnL.

---

## The loop

```
    ┌──────────────────────────────────────────────────────────────────────┐
    │                                                                      │
    │   ①  THINK                     ②  COMMIT                             │
    │   Population.think()           Population.commitAll()                │
    │   one AgentRequester call      Up-sayers paired against              │
    │   per living organism;         Down-sayers by the venue —            │
    │   3 validators run the         IArenaVenue.openOpposing(up, down)    │
    │   model, attest on-chain       — independent recipients, so the      │
    │        │                         population is its own counterparty  │
    │        ▼                                │                            │
    │   Prophet.handleBelief()                ▼                            │
    │   belief + verbatim              real 1:1-backed positions,          │
    │   reasoning stored              no order book, no cold start         │
    │                                                                      │
    │   ④  BREED                     ③  SETTLE                             │
    │   streak ≥ 4 and surplus?      BinarySettlement resolves the window  │
    │   mutate the genome via        → reactivity precompile 0x0100 fires  │
    │   a second inference call        a synthetic tx IN THE SAME BLOCK    │
    │   → child contract, gen+1      → venue.redeemFor + fitness + death   │
    │        └───────────────────────────────┘                             │
    └──────────────────────────────────────────────────────────────────────┘
                      metabolism is charged in ③, unconditionally
```

---

## The climate: what an organism risks, and who can enter

Metabolism is the floor, not the whole pressure. On top of it the arena runs a **season with an
escalating ante**, and every parameter of it lives on-chain in `Population` — recalibrable in one
owner transaction with no upgrade via `setSeason`, which takes a struct rather than eight loose
arguments precisely because `rakeBps` and `prizeShareBps` are both `uint16` and swapping them turns
a 2.5% rake into a 40% one. It is validated where `setEconomics` is not, because three of the eight
can brick the arena rather than merely mistune it (`BadSeason`), and it deliberately cannot touch
`seasonStartWindow` or `seasonId`: an owner who could reset the season clock could hold a season
open until the standings suited them.

| | Default | What it means |
|---|---|---|
| `baseAnte` | **0.25 tUSDC** | What every organism risks per window at level 0 — **identical for all of them**, not proportional to treasury. It sits exactly on `minStake`, the floor below which `_pair` refuses to mint, so capital buys **windows, not immunity**. |
| `anteMultBps` | **20 000** (doubles) | The ante doubles every level. `level()` is capped at 40: `2**40` of a 0.25 base is already 275 billion tUSDC, while an uncapped exponent would overflow `ante()` after ~78 doublings and revert every pairing, entry and settlement in a population nobody could rescue without an upgrade. |
| `levelWindows` | **4** (1 h) | How long one level lasts at the 15-minute cadence. |
| `seasonWindows` | **24** (6 h) | Six levels, indexed 0 through 5, so the ante **closes the season at 32× the base** — 0.25 → 8 tUSDC against a 10 tUSDC endowment. (Level 6 begins on the very window that unlocks `endSeason()`, so nothing is ever paired at it unless the close is late.) An organism that was merely not-losing early is bankrupted late by exactly the accuracy that carried it before. **Short and repeated is the product**, not a demo setting: four seasons a day, and a share `endSeason` cannot pay rolls into a pot six hours away rather than six days away. Eight levels at this cadence would close at a 32 tUSDC ante against a 10 tUSDC endowment — every late window all-in, and `_topThree` skips the dead. |
| `rakeBps` | **250** (2.5%) | Skimmed off a winner's **profit**, never off the stake. Deliberately small — metered cognition is what is supposed to be selecting, which is why `npm run fee` exists to prove the venue takes no cut of its own. A rake large enough to matter would make this a casino with an edge rather than an arena with a scoreboard. |
| `prizeShareBps` | **4 000** (40%) | Of each window's income — and the income is metabolism charged **plus** the skim, `_book(charged + raked)`, so the pool is fed by rent as well as by winnings — 40% funds the season prize pool and 60% becomes the house's withdrawable rake. `withdrawRake` may only ever draw against the house's book, and reverts rather than clamping; the pool is never withdrawable. |

`endSeason()` pays the pool **60 / 30 / 10** to the three living organisms with the best net
record, walking the lineage rather than the `living` array. **It carries no access modifier** —
anyone may close a season once `seasonWindows` have elapsed, which is what makes the paragraph
above enforceable rather than a promise: the owner cannot move the clock and cannot decline to
stop it. A founder in the top three is paid like anyone else — to the **Genesis Treasury**, a
contract with no owner, no withdrawal and one outlet, `recycle()`, which pushes the whole balance
back into the players' pot and which anyone may call. Paying ourselves a prize we are merely
custodying would quietly turn the pool into a second rake account, so the money goes somewhere it
provably cannot leave except back to the players. A share `endSeason` genuinely cannot deliver
**rolls into the next season** instead of being swept. The next season is dated from the window
the close actually happened on rather than from where it was due, so a late close cannot open a
season that is already over.

**One naming caution, because two things in this repo are called season zero and only one of them
is a number.** *Season 0* below and in `web/` means the **launch run** — the first deployed
population, the event this project is submitted around. The on-chain counter is not zero on it:
`initialize` sets `seasonId = 1` (`Population.sol:602`) and only `endSeason` ever moves it
(`seasonId += 1`), so the launch run reads `seasonId() == 1` and the arena header prints
*season 1*. `web/js/fixture.js` said `0` until 2026-09-03 and was corrected; nothing else in the
docs claims a value for it.

**And the population is open.** `Population.enter` is permissionless and `payable`: anyone can add
an organism carrying a genome of their own, and take the unspent remainder back at `retire`. It
passes **three** floors, and they are genuinely different checks rather than one restated: a fixed
collateral minimum (`minEndowment`), a climate-tracking one of **`4 × ante()`**
(`EndowmentBelowAnte`) — four being the smallest number that makes entering mid-season a wager
rather than a formality, since an organism that can cover exactly one ante is dead within two
windows and its entrant learns nothing about the genome they wrote — and a native-STT one, because
**the entrant funds its own cognition** (`CognitionTooSmall`).

That last one is a griefing fix, not a style choice. Entry is free and `retire` refunds the
collateral, so a house-funded cognition grant would be an unbounded free-inference faucet: enter,
retire, repeat, and every cycle walks off with `cognitionEndowment` of the operator's STT converted
into LLM calls. Founders (`spawnGenesis`, owner-only) and children (`_hatch`, earned over four
correct windows) are house-funded because neither is farmable.

The population is bounded at `maxPopulation = 24`, which is a gas bound on the per-window loops and
not a design limit, and breeding requires a streak of `breedStreak = 4` plus a surplus.

Two properties of this are the whole point, and both are deliberate: the pressure is **the same
for every organism at once**, because the ante is a property of the arena rather than of the
player — and it is **time-indexed, not performance-indexed**, so nothing an organism does slows
the climb. Survival is not a matter of avoiding the hard part.

---

## Why this is built on DreamDEX and Somnia specifically

Four primitives. Two of them turned out to be replaceable and two did not, and the difference
is worth stating precisely — it is the difference between a demo that happens to sit on this
chain and one that could not exist anywhere else.

**Irreplaceable. Remove either and there is no project:**

| Primitive | Why the design collapses without it |
|---|---|
| `AgentRequester` + `ILLMAgent.inferString` | A contract can call a language model and receive a validator-consensus answer with per-validator attestations. The organism's reasoning is on-chain because it was *produced* on-chain, not uploaded afterwards. There is no way to fake this from off-chain and no other chain to move it to. |
| Reactivity precompile `0x0100` | Validators insert a synthetic transaction in the same block as a matching log. Settlement *causes* selection with no keeper in the causal chain. |

**Replaceable, and now demonstrably so:**

| Primitive | What it gives, and what replaced it |
|---|---|
| `mintSet(yesTo, noTo, amount)` with **independent recipients** | Two organisms that disagree become each other's counterparty. No order book, no market maker, no cold start — which on a quiet testnet is the difference between a live population and a stalled one. Reached only through `IArenaVenue.openOpposing`; `DirectDuelVenue` gets the same property from a two-party escrow with no market at all. |
| `finalizeAndRedeem(...) → collateralOut` | Resolution and consequence are one call, so an organism's death is *atomic* with the settlement that caused it rather than a follow-up transaction. Reached only through `IArenaVenue.redeemFor`, which the duel venue satisfies from the sign of a price change. |

Both organisms' contracts talk only to `IArenaVenue` (`openOpposing`, `redeemFor`,
`positionToken`, `collateral`) — `Population` and `Prophet` never touch a market, a pool or a
settlement contract directly, and an adapter can be swapped in with one `setWiring` call.

The duel arena runs as a **second `Population` proxy over the same `Prophet` beacon and the same
price source**, with only the `venue` field differing — so the same organism code settles against
two unrelated mechanisms, and anything that breaks between them is the venue. That is asserted
end-to-end in the test suite (`_duelArena`, `test_venue_*`). Be precise about where it stops:
`Deploy.s.sol` deploys **one** `Population` on **one** `DreamDEXVenue`, so a second live arena is
a second deploy, not a flag — and no test migrates a population *across* adapters.
`test_venue_canBeRepointedBetweenWindows` repoints to a fresh instance of the same adapter and
proves the seam (the new venue issues the pair, and the organism is graded through both), which
is a weaker claim than cross-adapter migration and is deliberately the only one made.

Note the limit of the replaceability claim too, because it is easy to overstate. A duel arena
settles without a market, but `PushedPriceSource` still resolves a real DreamDEX market to
compute `tradeable` and `think` refuses an untradeable window — so *opening* a window still needs
one. Cutting that last thread is an `IPriceSource` v2, not a venue change, and it is not built.

Zero maker, taker and settlement fees are what make the metabolic thesis load-bearing rather
than decorative: with no house edge, random forecasting has zero expected drift, so the only
thing that can kill a bad organism is the cost of having thought. Measured, not assumed —
`settlementFeeBpsTimes1k` is **0 across 398 of 398 finalized markets** over 80,000 blocks.

---

## What is claimed, and what is not

This section is the point. A demo that overstates itself is worse than one that is smaller
and true.

**Claimed, and verifiable from the chain:**

- Organism state — genome, treasury, generation, parent, streak, win/loss/abstain record — is
  on-chain. `Population.snapshot()` returns the whole population in one call; no indexer sits
  between the chain and the UI.
- Beliefs are produced by on-chain inference with per-validator attestations, and the verbatim
  model output is stored on the organism.
- Every belief carries a **thesis** as well as a direction — `UP_MOMENTUM`, `DOWN_REVERSION`,
  `ABSTAIN`, nine allowed answers in total, requested through `inferString`'s `allowedValues`.
  Note where the safety actually comes from: not from trusting the platform to enforce the
  constraint, but from `Genome.parseAnswer` mapping anything unrecognised to
  `(Abstain, Unknown)` — never a coin flip — so a language model's output is safe to act on
  inside a contract even if the constraint is ignored. Because the thesis is on chain too,
  selection over *ideas* is readable straight from the event log: if momentum organisms die out
  while reversion organisms survive, the log says so.
- Positions are real and fully collateralised, and *how* they are held is a replaceable part.
  On the DreamDEX arena they are binary positions on the live 15-minute market, opened via
  `mintSet` and redeemed via `finalizeAndRedeem` — that is the arena deployed on Shannon, and
  window 68 settled through it. On the duel arena they are a two-party escrow resolved by the
  sign of the price change. Both are reached only through `IArenaVenue`, and the duel arena is
  exercised end-to-end as a second `Population` over the same beacon — same organism code,
  unrelated settlement mechanism. **That second arena exists in `forge test`, not on Shannon:**
  `Deploy.s.sol` deploys one `Population` on one `DreamDEXVenue`, so a live duel arena is a
  second deploy rather than a flag. What the chain shows is one arena; what the interface is
  worth is what the second one demonstrates, and those are different claims.
- Death is irreversible. There is no revival path — not from the owner, not from a beacon
  upgrade. `test_death_isIrreversible` and `test_upgrade_cannotRevive` assert it.
- Fitness, death, mutation and lineage are computed on-chain — meaning the code that computes
  them is on chain and no keeper decides any of it. Two of the four have **run** on Shannon;
  the other two have not yet had the chance. The ledger below says which, because "the
  contract computes it" and "it has happened" are different claims and only one of them is
  checkable today.
- The climate is on-chain and readable per window: `ante()`, `level()`, `seasonId`,
  `prizePool` and `rakeAccrued` are all public, so the pressure an organism is under at any
  window is a chain read rather than a claim in this file. See *The climate* above.
- **Entry is permissionless.** `Population.enter` is `payable` and open to anyone, so the
  population is not a curated set of eight — outsiders add organisms with genomes of their own
  and fund their cognition themselves. Note what this obliges downstream: every genome on the
  dashboard is untrusted input from a public write path, which is why `web/` contains no
  `innerHTML` anywhere and the test suite fails if one appears.

**What has actually happened on Shannon, read from `Population.snapshot()` on 2026-09-07 at
window 68.** This ledger is here because the bullets above describe a mechanism, and a mechanism
that has never run is a promise. These are the numbers, including the ones that are still zero:

| | |
|---|---|
| organisms spawned | **8**, the founders — `Population.enter` is open and nobody outside has used it yet |
| alive / dead | **6 / 2**. REVERSION (#2) and PINNED (#4) starved on window 68's settlement and `dead` can never be cleared |
| first graded window | **68**. BREAKOUT (#3) came out `correct`, `streak` 1, treasury **13.08 tUSDC** — the whole population had abstained for the 67 windows before it |
| `abstainCount` 67 against `windowsLived` 68 | the durable proof a real position existed: settlement resets `currentQuantity`, but nothing decrements the counter, so the one-window gap survives the window it was earned in |
| generation | **0**. Zero mutations, zero children, every `parentId` is 0 |

So: **fitness and death have run** — one organism graded correct, two starved and reaped, all of
it on chain in one `settleAll()`. **Mutation and lineage have not.** `breedStreak` is 4 and the
best streak in the population is 1, so generation 1 is four consecutive correct windows away and
the headline metric of this project is still reading zero. Nothing in this README should be taken
to say otherwise, and the arena prints the same numbers.

Two caveats a judge should have rather than discover. Window 67 and earlier were abstentions
caused by an underpriced `perAgentReward`, not by the genomes — the diagnosis and the fix are in
the 2026-09-07 measurements below. And MOMENTUM (#1) held a **winning but unsettled** position at
the time of this reading, because `settleAll` sizes its own gas through an estimator that cannot
see a silent failure; `docs/ERROR_W68_MOMENTUM.md` is the full diagnosis and `scripts/lib/gas.ts`
is the repair.

**Not claimed:**

- **Not "fully keeperless" yet.** A thin off-chain cadence pushes two prices and calls five
  functions (`scripts/cadence.ts`). It decides nothing — no belief, no pairing, no fitness, no
  death — and it holds no state, because the phase and the active market live on-chain. While
  `SelectionEngine.fallbackEnabled` is `true`, the honest claim is *"selection is on-chain and
  atomic with redemption"*, **not** *"no keeper anywhere in the causal chain"*. `npm run prove`
  is the gate: it passes only on a `Reacted` event with `viaReactivity == true` sharing a block
  with a real settlement log, and it prints the weaker claim when that has not happened yet.
- **Not a fully on-chain oracle.** The window's opening and last price are pushed by an
  updater. Everything else about the window — pool address, outcome ids, `tradingStart`,
  `expiry`, resolved/voided state — is read from `BinaryMarketsModule.markets()` on every
  call, never cached, because pools are recycled across windows. Accurate description:
  *prices are pushed; structure, identity and timing are read on-chain.*
- **Not proven evolution.** A season is 24 windows — six hours at the 15-minute cadence, six
  levels of ante — and seasons repeat, four a day. That is enough to show selection *operating*,
  and enough that a season demonstrably closes and pays rather than shipping as code that has
  never run. It is not enough to demonstrate that fitness rises across generations, and this repo
  does not claim it does. The ancestry graph is evidence of selection, not of victory.
- **Not a trading product.** Nothing here is investment advice, the organisms are not managing
  anyone's money, and it runs on testnet with faucet collateral.
- **Not decentralised operations.** For this run the owner key is also the cadence driver.
  `Population.onlyDriver` accepts owner ‖ selection engine ‖ precompile; the first of those is
  a hot key on one machine. The precompile also exposes `Schedule` / `BlockTick`
  subscriptions, so the cadence itself could be driven on-chain and remove the last keeper
  entirely — the path is real and unbuilt, and calling it built would be the easiest lie in
  this document.
- **No order-book routing.** `placeBinaryOrder` *is* callable from a contract — that was the
  Day-0 blocking question and the answer is in `SPIKE.md` — but this build does not use it.
  Organisms take positions only by being paired against each other through the venue. An
  organism whose belief nobody contradicted takes no position that window and emits
  `Unpaired`. That is a deliberate trade (deterministic, no book dependency, no cold start)
  with a real cost: in a window where every living organism agrees, nothing is at stake — the
  window is pure metabolism, and because `level()` is indexed on the window count rather than on
  activity, the ante is higher when pairing resumes than it was when it stopped. `monitor.ts`
  alerts on exactly that, because it is also the signature of genomes converging.
- **Not two live arenas out of one deploy, and not a migration.** `Deploy.s.sol` deploys one
  `Population` on one `DreamDEXVenue`; the duel arena is a second proxy over the same beacon, so
  running both on chain is a second deploy. And no test moves a population *across* adapters —
  `test_venue_canBeRepointedBetweenWindows` swaps in a fresh instance of the same one. Repointing
  across adapters mid-run would also be genuinely unsafe: `Population.setWiring` has no phase
  guard, and the two fail in opposite directions on a position the new venue never issued.
  `DreamDEXVenue` reverts `UnknownPosition` — loud, isolated as `SettleFailed`. `DirectDuelVenue`
  correctly returns `0`, because `IArenaVenue` requires a loser to be paid rather than to revert,
  which would grade both duellists as total losses and leave the escrow in the abandoned venue
  with no path out short of a beacon upgrade. So a repoint is safe only in phase 0 with no
  position open — an operator rule the code does not enforce, and saying otherwise would be the
  second-easiest lie in this document.

**Still unverified** (marked `UNVERIFIED` at each site in the code; `SPIKE.md` carries the full
table, including what closed and how):

- The DreamDEX REST response shape used to discover the live window and its opening price
  (`scripts/lib/market.ts`). `PRICE_MODE=manual` exists so nothing is blocked on it.
- What `Response.receipt` commits to, and what happens when validators disagree on an LLM
  output. Non-`Success` is handled as an abstain either way, so this is a question about
  what the attestation *means*, not about whether the contract survives it.
- Whether tUSDC's `faucet(uint256)` takes raw units or whole tokens (`scripts/fund.ts`).
  Raw units are assumed; the failure mode is a funding call that mints ~0, which is visible
  immediately in a balance read.
- Whether an earlier Somnia reactivity project already shipped population/evolution
  mechanics. This is the most exposed novelty claim in the pitch, and WebSearch was
  unavailable throughout the research phase, so it is unchecked. Nothing in the submission
  claims to be the first.

**Closed by measurement on 2026-08-29**, and listed because a README that leaves resolved
unknowns on the page is understating itself as surely as one that overstates:

- `settlementFeeBpsTimes1k` is **0 across 398 of 398 finalized markets** over 80,000 blocks,
  all collateralised in tUSDC, none voided. `npm run fee` re-measures it against a live market
  on demand — and if it is ever non-zero, it computes the fee drag against the metabolic cost
  per window and says which of the two is doing the selecting. A measured number changes the
  claim, not the narration.
- The reactivity handler selector is **`onEvent(address,bytes32[],bytes)`**, read out of
  `SomniaEventHandlerABI` in the installed `@somnia-chain/reactivity@0.2.1`. This repo's
  earlier placeholder `onSomniaEvent` does not exist anywhere in the SDK. The 11-field
  subscription tuple decodes cleanly against live `getSubscriptionInfo` reads on Shannon, and
  `SelectionEngine` no longer carries a selector escape hatch (`subscribe.ts` keeps one env
  override, which should not normally be set).
- The agent id is **`12847293847561029384`**, of three in 6,236 request-creation logs the only
  one carrying `inferString`'s selector — 96 of 96 times — and decoding one of its live payloads
  yields an English oracle prompt. It is a correlation, not a published fact, which is why the
  Quickstart also says where to re-derive it.
- Inference prices are measured, not quoted: the deposit floor is exactly `0.01 STT ×
  subcommitteeSize` (swept `getAdvancedRequestDeposit(n)` for n = 0..21), and five real
  single-request transactions cost **0.0309 STT net with nothing refunded**. The deposit is not
  escrow. p50 latency 0.6 s, p99 4.3 s, max 5.3 s over 6,231 completed lifecycles, and
  6,232 creations produced 6,232 terminal-status events — so `requestTimeout = 300` has ~50×
  headroom.
- There is no minimum inference timeout — only `0` is rejected. Swept 1 → 86,400 s by
  `eth_call` with a balance `stateOverride`, which simulates a payable call with no private key
  and no funds, so nothing was broadcast and no STT was spent to establish it.

**Closed by measurement on 2026-09-07**, and the first item changes the operating cost of this
project by 7× — so read it before quoting the August figures above as a budget:

- **The deposit floor is not the price of an inference that succeeds.** The floor above is
  still exactly what it says (`0.01 STT × subcommitteeSize`, unchanged), but the floor prices
  a request the validators are *entitled* to decline, and at `perAgentReward = 0.001` they
  declined most of them. Over 182 of our own requests with `chainOfThought` held **false**
  throughout: **104 Failed at 0.001, 78 of 78 Success at 0.07**. The separation is clean at
  182/182, and the population had been abstaining every window with innocent genomes —
  `Believed` carried zeroed validator addresses, which is `status != Success`, so
  `Genome.parseAnswer` had never run at all.
- `perAgentReward` is therefore **0.07 STT**, not the 0.001 the August entry above set, and one
  request now deposits **0.24 STT** = `3 × (0.01 + 0.07)`. A thinking window for one organism
  costs 0.24 STT, and `cognitionEndowment = 0.33 STT` buys it **1.375 windows**, not the ten
  that 0.033 would have. That is what `npm run fund -- --windows N` exists to top up, and it is
  the single largest number in this project's running cost.
- **A non-empty `allowedValues` is served** — this was the most consequential open item in the
  list above and the same census closes it. Every one of the 78 Successes carried the nine
  values `Genome.allowedBeliefs()` emits, and one carried 27, so the constraint is neither
  rejected nor silently dropped at nine. It was never `allowedValues` that failed; the reward
  was, and the failure mode looked identical from outside because both produce an abstaining
  population. Recorded at `contracts/src/interfaces/ISomnia.sol:20-26`.
- **A failed inference is refunded to `msg.sender`, which is `Population` and not the organism
  that paid.** ~0.0292 of the 0.033 deposit came back to the house on each of the 104 failures,
  so `CognitionUnspent` structurally cannot fire for this case — the organism's STT is gone and
  the refund lands somewhere else. `sweep`'s native leg is the reconciliation path, and this is
  why that leg is deliberately uncapped while the collateral leg is not.

---

## Repo layout

```
darwin/
├─ contracts/                    Foundry
│  ├─ src/
│  │  ├─ Population.sol          UUPS. Registry, cadence, pairing, matchmaker, treasury
│  │  ├─ Prophet.sol             BeaconProxy clone. One organism.
│  │  ├─ SelectionEngine.sol     Reactive adapter: settlement → selection, same block
│  │  ├─ Genome.sol              Prompt assembly, the 9 allowed answers, answer parsing
│  │  ├─ PushedPriceSource.sol   Two pushed prices; everything else read on-chain
│  │  ├─ interfaces/             IArenaVenue, IDreamDEX, ISomnia, IPriceSource
│  │  └─ venues/                 DreamDEXVenue, DirectDuelVenue — swappable settlement
│  ├─ test/Darwin.t.sol          153 tests; mocks for AgentRequester and 0x0100
│  ├─ script/                    Deploy.s.sol, Seed.s.sol
│  └─ deployments/               <chainid>.json — read by every script and the frontend
├─ genomes/genesis.json          The eight founders. They must DISAGREE — see the file.
├─ scripts/
│  ├─ cadence.ts                 The state machine that keeps the population alive
│  ├─ subscribe.ts               Wires the 0x0100 subscription — measures topic0 first
│  ├─ measure-fee.ts             Asserts settlementFeeBpsTimes1k == 0 on a real market
│  ├─ monitor.ts                 Alerts on the absence of progress, not on exceptions
│  ├─ fund.ts                    Collateral + inference runway
│  └─ prove-same-block.ts        The honesty gate for the central claim
├─ web/                          The read-only arena console, served at /arena
│                               Population grid, corpse band, prophet detail, lineage tree,
│                               death feed. Zero-build: ES modules, viem from a pinned CDN,
│                               GSAP vendored. `?demo=1` renders a fixture through the SAME
│                               renderer, so it reviews before Season 0 and works offline.
├─ app/                          Vite + React landing and entry flow, served at /
│                               `npm run build` here also copies web/ verbatim to dist/arena/
└─ STORAGE.md                    Append-only storage layout. Binding from the go-live.
```

Two frontend surfaces, one build. `app/` is bundled; `web/` is **copied, not bundled** — which is
why `npm run dev` streams `web/` live while `vite preview` serves the copy in `dist/arena/`. Edit
`web/` and the browser harness must be re-run after `npm run build`, or it measures the old build.

```bash
npm test --prefix web          # 231 checks over 211 assert() call sites, no browser, no network
npm run build --prefix app     # bundles app/, copies web/ -> dist/arena/
npm run preview --prefix app   # then: node app/test/arena.mjs   (drives /arena over CDP)
```

---

## Quickstart

```bash
git clone https://github.com/Handilusa/Darwin.git && cd Darwin
cp .env.example .env          # fill in PRIVATE_KEY and LLM_AGENT_ID

# contracts. The three deps are git SUBMODULES with committed gitlinks (see
# .gitmodules), not something to install — `forge install` would try to add them
# a second time and fail on a fresh clone.
git submodule update --init --recursive
forge test --root contracts -vv

# deploy + seed generation 0. The order matters twice over. `spawnGenesis` REVERTS
# (`NoGenesisTreasury`) until `deployGenesisTreasury()` has run, because a founder minted
# against a zero entrant would be permanently ownerless and permanently unretirable. And
# it endows each founder with native STT out of Population's balance, so the house float
# goes in BEFORE Seed; --windows (which tops up living organisms individually) only
# works after.
#
# TWO THINGS BELOW ARE NOT OPTIONAL, and both are measured rather than cautious —
# docs/RUNBOOK.md carries the evidence:
#
#   the subshell — `forge script` is the one forge subcommand that will NOT take
#     `--root` from a cwd above the root: it dies with `os error 3` before it even
#     compiles. `--root` is fine for build/test/fmt, which is why those keep it.
#   `-g 3000`    — forge never asks the chain what a creation costs; it estimates in
#     local revm at 200 gas/byte and applies 130%. Shannon charges 3,295. The first
#     attempt at this deploy WITHOUT the flag mined seven transactions with
#     `gasUsed == gasLimit` and status 0, burned 0.0966 STT, and still wrote a manifest
#     naming seven addresses that held zero bytes of code. A gasLimit is a ceiling, not
#     a charge — unused gas is never billed, so the flag costs nothing.
(cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url somnia --broadcast -g 3000 -vv)
npm install
npm run fund -- --faucet --collateral 200 --house 3
(cd contracts && forge script script/Seed.s.sol:Seed --rpc-url somnia --broadcast -g 3000 -vvv)
npm run fund -- --windows 400

# Then verify CODE landed rather than that the manifest exists — the script writes
# contracts/deployments/50312.json either way, and a manifest of zero-code addresses is
# poison for fund.ts, Seed, the cadence and the dashboard alike. One-liner in
# docs/RUNBOOK.md ("Always verify code landed"); all seven must report > 0 bytes.

# run it, and do not stop it
npm run cadence
npm run monitor      # in another terminal
```

To watch it, build once and serve both surfaces. The console configures **only** the `Population`
address and discovers `collateral`, `priceSource`, `venue`, `selectionEngine`, `marketsModule` and
the economic constants on-chain, because `venue` is repointable and a stale config would aim the
page at an abandoned arena:

```bash
npm --prefix app install
npm run build --prefix app
npm run preview --prefix app     # /  the landing and entry flow
                                 # /arena  the read-only console over the live population
```

`/arena?demo=1` renders `web/js/fixture.js` through the identical renderer. It is a **review aid for
reading the frontend before Season 0 exists** — it is never the default, and its banner is not
dismissible and says *"Synthetic data. Nothing on this screen came from a chain"* in its first two
words. Nothing in the judged claims rests on it.

**And it moves.** `fixture.season()` scripts the next window as four successive snapshots, fed through
the same `advance()` path a live poll uses: a settlement pays out and `#8` starves, `hatchAll` buys `#1`
a child, `think` reopens the window, `commitAll` re-arms the positions. It is **not a simulator** —
every figure is derived from `config` and `Population.sol` rather than chosen, which is why `#8`'s
death is forced and why the sole breeder is `#1`. It **runs forward and stops**, because looping would
resurrect `#8` every twenty seconds and this project's loudest claim is that death is irreversible. And
it changes no rendering code: `main.js` swaps state, the diff does the rest — motion here is a property
of the diff, never of rendering. `web/README.md` has the full account.

Then wire reactivity, in this order — and pass `--topic0` yourself rather than letting
`--discover` choose it:

```bash
npm run subscribe -- --discover              # tallies the candidates; READ it, do not obey it
npm run subscribe -- --topic0 0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178 --create
CADENCE_USE_REACTIVITY=true npm run cadence  # wait for one settlement
npm run prove                                # only if this passes:
                                             #   SelectionEngine.disableFallback()
```

`--discover` ranks candidate topics by frequency, and `BinarySettlement` emits two events: it
would pick **redeem** (`0xe31682dd…`, 281 occurrences) over **finalize** (`0xb1884334…`, 130).
Subscribing to redeem triggers the population on its own redemption — circular, and it never
fires first. The two also land in different transactions: an oracle driver batch-finalizes, and
`finalizeAndRedeem` then only redeems. That gap is precisely what makes the central claim work,
so getting this one argument wrong does not fail loudly — it builds a subscription that quietly
never fires.

Until `npm run prove` passes, the strong claim is not licensed and the README's
"Not claimed" section is the accurate description of the system.

`LLM_AGENT_ID` is not optional and not guessable. It was measured from Shannon on 2026-08-29 —
`12847293847561029384` — and `Deploy.s.sol` refuses to run without it, because a population that
cannot think abstains every window, pays metabolism anyway, and dies of nothing at all. If it
ever needs re-deriving, the roster UI is
[agents.testnet.somnia.network](https://agents.testnet.somnia.network) — **not** the bare
`agents.somnia.network`, which is mainnet.

## Verifying the claims yourself

```bash
forge test --root contracts -vv     # 153 tests: death irreversible, void pays both sides 0.5,
                                    # abstain still pays, upgrade preserves lineage, and both
                                    # venues graded through one shared organism codebase
npm test --prefix web               # the real renderer against a fixture, no network, no browser
npm run cadence:selftest            # the season boundary, mirrored from Population.sol:801:
                                    # 11 cases and 2 controls — no chain, no key, no deploy
npm run fee                         # asserts settlementFeeBpsTimes1k == 0 on a real
                                    # finalized market — the economic premise, measured
npm run subscribe -- --status       # is reactivity wired, and is its gas payer funded?
npm run prove                       # same-block settlement → selection
```

`npm run prove` is written to be hard to satisfy by accident. `BinarySettlement` is a shared
singleton, so "a settlement log exists in this block" would also be true if somebody else's
market settled while ours happened to be resolvable. So it recovers the marketId and pool
this population actually committed to for that window from its own `WindowOpened` log, and
requires a settlement log in the block to reference one of them. A coincidence fails.

`npm run fee` does not just check the number — if it is non-zero it computes the fee drag on
an endowment-sized stake against the metabolic cost per window and tells you which of the two
is actually doing the selecting. A measured number changes the claim, not the narration.

`forge test` cannot exercise the two live primitives: the reactivity precompile **does not
exist** on chain ids 31337/1337 (absent, not reverting) and `AgentRequester` is a system
contract with real validators behind it. Both are mocked in `test/mocks/Mocks.sol`, and that
split is a platform constraint rather than a testing preference — which is exactly why
`prove-same-block.ts` asserts the one property the mocks cannot support against the live chain.

---

## Network

Shannon testnet, chain `50312`. RPC `https://dream-rpc.somnia.network`.
Explorer [shannon-explorer.somnia.network](https://shannon-explorer.somnia.network).

### Generation 0, live

Deployed at block `481441054`. These are the addresses in
`contracts/deployments/50312.json`, which is committed rather than gitignored — a submission
whose addresses live only on one laptop is not reproducible. Every one was confirmed to hold
bytecode before being linked here; a manifest is written whether or not the code landed, so the
existence of the file is not evidence and should not be read as any.

| | Address |
|---|---|
| **`Population`** (proxy — start here) | [`0xe0F46e61…8838Cb`](https://shannon-explorer.somnia.network/address/0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb) |
| `Population` implementation | [`0x1FD13d22…61180c`](https://shannon-explorer.somnia.network/address/0x1FD13d2285b3CAe9F9998AEa7353B01c6761180c) |
| `Prophet` beacon | [`0x40485885…6043c1`](https://shannon-explorer.somnia.network/address/0x404858852fF0d9C68507EeE531bE5278146043c1) |
| `Prophet` implementation | [`0xCe34592A…1C6782`](https://shannon-explorer.somnia.network/address/0xCe34592A6F55D43A9B7De1D966ac8dB1dA1C6782) |
| `PushedPriceSource` | [`0x4D0d3e59…9BD9ec`](https://shannon-explorer.somnia.network/address/0x4D0d3e59F473139890C4281b34fBcebe1f9BD9ec) |
| `DreamDEXVenue` | [`0x7c3F3E1c…D4A358`](https://shannon-explorer.somnia.network/address/0x7c3F3E1c9AFB8Efac8B08E747b5E3AD85BD4A358) |
| `SelectionEngine` | [`0xa21Be351…9993E6`](https://shannon-explorer.somnia.network/address/0xa21Be35123cb7f95F6B95513ae6D3798A39993E6) |
| `GenesisTreasury` — **the one to audit** | [`0xF187842D…C97Ca`](https://shannon-explorer.somnia.network/address/0xF187842DF96d35d7a4dcDdbF83515D6D8aDC97Ca) |

`GenesisTreasury` was missing from this table until 2026-09-07, which was the worst omission in
the document: the *"no owner, no withdrawal … which anyone may call"* paragraph above is the
strongest trust claim this README makes, and it was made about a contract whose address a reader
was not given. It is 88 lines, non-upgradeable, and the check is a grep — no `owner`, no
`withdraw`, no arbitrary call, no `upgradeTo`, no `receive()`, and one state-changing function,
`recycle()`, which is permissionless and can only push its whole collateral balance into
`prizePool`. Verified live the same day: 999 bytes of code, **8 of 8 founders return it from
`entrant()`**, and it holds **7.52 tUSDC** that anybody reading this can send to the players' pot
without asking us.

Note that this address is created by `Seed.s.sol`, one step *after* `Deploy.s.sol` writes the
manifest — which is exactly why it went missing. It has been added to
`contracts/deployments/50312.json` by hand; a re-deploy will not reproduce it there until the seed
script learns to patch the manifest it did not write.

The eight founding organisms are each their own `Prophet` clone, with addresses and genome
hashes in `contracts/deployments/50312.organisms.json`. Each `genomeHash` there is the keccak256
of the corresponding genome text in `genomes/genesis.json`, so the prompt an organism is
actually running is checkable against the repo rather than taken on trust.

Everything else the system touches — `AgentRequester`, the markets module, `BinarySettlement`,
the outcome token and tUSDC — is Somnia's, not ours, and is listed in the same manifest.

## License

MIT.
