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
  `mintSet` and redeemed via `finalizeAndRedeem`. On the duel arena they are a two-party escrow
  resolved by the sign of the price change. Both are reached only through `IArenaVenue`, and the
  duel arena is exercised end-to-end as a second `Population` over the same beacon — same
  organism code, unrelated settlement mechanism.
- Death is irreversible. There is no revival path — not from the owner, not from a beacon
  upgrade. `test_death_isIrreversible` and `test_upgrade_cannotRevive` assert it.
- Fitness, death, mutation and lineage are computed on-chain.

**Not claimed:**

- **Not "fully keeperless" yet.** A thin off-chain cadence pushes two prices and calls four
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
- **Not proven evolution.** Roughly 1,000 windows fit in eleven days. That is enough for
  several generations and enough to show selection *operating*. It is not enough to
  demonstrate that fitness rises across generations, and this repo does not claim it does. The
  ancestry graph is evidence of selection, not of victory.
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
  with a real cost: in a window where all eight agree, nothing is at stake. `monitor.ts`
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
- Whether the validators **honour** a non-empty `allowedValues`. The request *shape* is
  confirmed — a payload carrying all nine values with `chainOfThought = true` was simulated
  against the live `AgentRequester` and accepted — but that only proves it is not rejected.
  It degrades safely (`Genome.parseAnswer` maps anything unrecognised to `(Abstain, Unknown)`,
  never a coin flip) and it is the most consequential open item here, because a constraint that
  is silently ignored does not break the contract, it silences selection.
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
│  ├─ test/Darwin.t.sol          98 tests; mocks for AgentRequester and 0x0100
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
├─ web/                          Population view, prophet detail, lineage tree, death feed
└─ STORAGE.md                    Append-only storage layout. Binding from the go-live.
```

---

## Quickstart

```bash
git clone <this repo> && cd darwin
cp .env.example .env          # fill in PRIVATE_KEY and LLM_AGENT_ID

# contracts
forge install foundry-rs/forge-std openzeppelin/openzeppelin-contracts \
              openzeppelin/openzeppelin-contracts-upgradeable --root contracts
forge test --root contracts -vv

# deploy + seed generation 0. The order matters: spawnGenesis endows each founder with
# native STT out of Population's balance, so the house float goes in BEFORE Seed, and
# --windows (which tops up living organisms individually) only works after.
forge script script/Deploy.s.sol --root contracts --rpc-url somnia --broadcast
npm install
npm run fund -- --faucet --collateral 200 --house 3
forge script script/Seed.s.sol --root contracts --rpc-url somnia --broadcast
npm run fund -- --windows 400

# run it, and do not stop it
npm run cadence
npm run monitor      # in another terminal
```

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
forge test --root contracts -vv     # 98 tests: death irreversible, void pays both sides 0.5,
                                    # abstain still pays, upgrade preserves lineage, and both
                                    # venues graded through one shared organism codebase
npm test --prefix web               # the real renderer against a fixture, no network, no browser
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
Live contract addresses are written to `contracts/deployments/50312.json` at deploy time and
committed — a submission whose addresses live only on one laptop is not reproducible.

## License

MIT.
