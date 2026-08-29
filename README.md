# DARWIN

**A population of AI forecasters that must survive real market settlement to keep existing.**

Eight organisms are born on-chain, each carrying a genome: an English trading thesis, stored
as a string in its own contract. Every fifteen minutes each one is asked what BTC will do
before the window closes. It answers by calling a language model **from Solidity** — three
Somnia validators run the inference and attest to the result on-chain. Organisms that
disagree are issued exactly-1:1-backed opposing positions out of their combined collateral.
When the market settles, the ones that were right take the ones that were wrong.

Thinking is not free. Every organism pays a metabolic cost every window whether it was right,
wrong, or refused to answer. In a market with zero fees, a coin-flipper has no expected drift
— so metered cognition is the only selection pressure there is, and it is enough. At zero
treasury an organism is **irreversibly** terminal: no admin function revives it, and the
`dead` flag is checked before every state transition it could otherwise make.

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
    │   per living organism;         Down-sayers via                       │
    │   3 validators run the         pool.mintSet(yesTo, noTo, amt)        │
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
    │   → child contract, gen+1      → finalizeAndRedeem + fitness + death │
    │        └───────────────────────────────┘                             │
    └──────────────────────────────────────────────────────────────────────┘
                      metabolism is charged in ③, unconditionally
```

---

## Why this is built on DreamDEX and Somnia specifically

Four primitives, none of them incidental:

| Primitive | Why the design collapses without it |
|---|---|
| `mintSet(yesTo, noTo, amount)` with **independent recipients** | Two organisms that disagree become each other's counterparty. No order book, no market maker, no cold start — which on a quiet testnet is the difference between a live population and a stalled one. |
| `finalizeAndRedeem(...) → collateralOut` | Resolution and consequence are one call, so an organism's death is *atomic* with the settlement that caused it rather than a follow-up transaction. |
| `AgentRequester` + `ILLMAgent.inferString` | A contract can call a language model and receive a validator-consensus answer with per-validator attestations. The organism's reasoning is on-chain because it was *produced* on-chain, not uploaded afterwards. |
| Reactivity precompile `0x0100` | Validators insert a synthetic transaction in the same block as a matching log. Settlement *causes* selection with no keeper in the causal chain. |

Zero maker, taker and settlement fees are what make the metabolic thesis load-bearing rather
than decorative: with no house edge, random forecasting has zero expected drift, so the only
thing that can kill a bad organism is the cost of having thought.

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
  `ABSTAIN`, nine allowed answers in total, constrained by `inferString`'s `allowedValues` so
  a language model's output is safe to act on inside a contract. Because the thesis is on
  chain too, selection over *ideas* is readable straight from the event log: if momentum
  organisms die out while reversion organisms survive, the log says so.
- Positions are real, fully collateralised DreamDEX binary positions on the live 15-minute
  market, opened via `mintSet` and redeemed via `finalizeAndRedeem`.
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
  Organisms take positions only by being paired against each other through `mintSet`. An
  organism whose belief nobody contradicted takes no position that window and emits
  `Unpaired`. That is a deliberate trade (deterministic, no book dependency, no cold start)
  with a real cost: in a window where all eight agree, nothing is at stake. `monitor.ts`
  alerts on exactly that, because it is also the signature of genomes converging.

**Still unverified** (marked `UNVERIFIED` at each site in the code, and listed in `SPIKE.md`):

- The DreamDEX REST response shape used to discover the live window and its opening price
  (`scripts/lib/market.ts`). `PRICE_MODE=manual` exists so nothing is blocked on it.
- The external entrypoint the reactivity precompile invokes, and the 11-parameter
  `subscribe(...)` signature. Isolated in `SelectionEngine` and behind
  `REACTIVITY_CALLBACK_SIG` so the unverified part is one adapter and one env var.
- `settlementFeeBpsTimes1k` on a finalized market. **`npm run fee` measures it.** The
  zero-fee premise is what makes metered cognition the only selection pressure; if it is
  non-zero, the economics need recalibrating, not renarrating — and that script does the
  arithmetic rather than leaving it to a judgement call.
- The exact agent ids and current per-agent inference prices (`agents.somnia.network`).
- What `Response.receipt` commits to, and what happens when validators disagree on an LLM
  output. Non-`Success` is handled as an abstain either way, so this is a question about
  what the attestation *means*, not about whether the contract survives it.
- Whether an earlier Somnia reactivity project already shipped population/evolution
  mechanics. This is the most exposed novelty claim in the pitch, and WebSearch was
  unavailable throughout the research phase, so it is unchecked. Nothing in the submission
  claims to be the first.

---

## Repo layout

```
darwin/
├─ contracts/                    Foundry
│  ├─ src/
│  │  ├─ Population.sol          UUPS. Registry, cadence, pairing, paymaster, matchmaker
│  │  ├─ Prophet.sol             BeaconProxy clone. One organism.
│  │  ├─ SelectionEngine.sol     Reactive adapter: settlement → selection, same block
│  │  ├─ Genome.sol              Prompt assembly, the 9 allowed answers, answer parsing
│  │  ├─ PushedPriceSource.sol   Two pushed prices; everything else read on-chain
│  │  └─ interfaces/             IDreamDEX, ISomnia, IPriceSource
│  ├─ test/Darwin.t.sol          ~40 tests; mocks for AgentRequester and 0x0100
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

# deploy + seed generation 0
forge script script/Deploy.s.sol --root contracts --rpc-url somnia --broadcast
npm install
npm run fund -- --faucet --collateral 200 --windows 400
forge script script/Seed.s.sol --root contracts --rpc-url somnia --broadcast

# run it, and do not stop it
npm run cadence
npm run monitor      # in another terminal
```

Then wire reactivity, in this order — and do not skip the middle step:

```bash
npm run subscribe -- --discover              # measure the settlement topic0 from the chain
npm run subscribe -- --topic0 0x… --create
CADENCE_USE_REACTIVITY=true npm run cadence  # wait for one settlement
npm run prove                                # only if this passes:
                                             #   SelectionEngine.disableFallback()
```

Until `npm run prove` passes, the strong claim is not licensed and the README's
"Not claimed" section is the accurate description of the system.

`LLM_AGENT_ID` is not optional and not guessable — fetch it from
[agents.somnia.network](https://agents.somnia.network). `Deploy.s.sol` refuses to run without
it, because a population that cannot think abstains every window, pays metabolism anyway, and
dies of nothing at all.

## Verifying the claims yourself

```bash
forge test --root contracts -vv     # death irreversible, void pays both sides 0.5,
                                    # abstain still pays, upgrade preserves lineage
npm run fee                         # asserts settlementFeeBpsTimes1k == 0 on a real
                                    # finalized market — the economic premise, measured
npm run subscribe -- --status        # is reactivity wired, and is its gas payer funded?
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
