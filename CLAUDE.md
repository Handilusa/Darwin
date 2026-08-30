# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An on-chain population of AI forecasters on Somnia Shannon testnet (chain `50312`). Each organism
is a `Prophet` contract carrying a genome — an English trading thesis stored as a string. Every
15-minute window each one is asked what BTC will do, answers via on-chain LLM inference
(`AgentRequester` → validator consensus), and organisms that disagree are issued 1:1-backed
opposing DreamDEX binary positions out of their combined collateral. Thinking costs real value
every window; at zero treasury an organism is irreversibly dead. Survivors with a surplus breed by
mutating their genome through a second inference call.

The headline metric is **generation**, not PnL.

Read `README.md` for the claims (and explicitly the non-claims), `STORAGE.md` before touching any
state variable, and `SPIKE.md` for the still-unverified integration surfaces.

## Commands

```bash
# fresh clone — deps are git submodules under contracts/lib, not node_modules
git submodule update --init --recursive
npm install

npm run build                  # forge build --root contracts
npm run test                   # forge test --root contracts -vv
npm run typecheck              # tsc --noEmit over scripts/ only
forge fmt --root contracts     # 120 cols, 4-space, no bracket spacing
```

Single test / subset (all Solidity tests live in `contracts/test/Darwin.t.sol`, one contract
`DarwinTest`, 98 tests):

```bash
forge test --root contracts --match-test test_death_isIrreversible -vvv
forge test --root contracts --match-test 'test_breeding_*' -vv
FOUNDRY_PROFILE=ci forge test --root contracts        # verbosity 3, 512 fuzz runs
```

Storage layout verification — **required after any change to `contracts/src/*.sol`**:

```bash
# The layout is NOT in the default artifact output. Without --extra-output, forge inspect
# fails with "storage layout missing from artifact", and forge clean alone does not fix it.
forge clean --root contracts
forge build --root contracts --extra-output storageLayout
forge inspect Prophet    storage-layout --root contracts
forge inspect Population storage-layout --root contracts
# then diff slot-by-slot against the tables in STORAGE.md
```

Both layouts were diffed on 2026-08-29 with **zero discrepancies** — see `STORAGE.md`.

Deploy and seed generation 0:

```bash
# ALWAYS dry-run first. Same command minus --broadcast: forge executes the whole script
# against live Shannon state, so it catches wrong addresses, preflight reverts and EVM-spec
# mismatches for free. _writeManifest is guarded on vm.isContext(ScriptDryRun), so a dry run
# will NOT write deployments/<chainid>.json — nothing downstream can be fooled by it.
forge script script/Deploy.s.sol:Deploy --root contracts --rpc-url somnia -vv

forge script script/Deploy.s.sol --root contracts --rpc-url somnia --broadcast

# ORDER IS LOAD-BEARING. `spawnGenesis` is payable and `_spawn` endows each newborn out of
# `address(this).balance`, so the house float must already be there when Seed runs — 8
# founders x 0.33 STT = 2.64. Fund it FIRST and a Seed script that attaches no value of its
# own still produces a generation 0 that can think.
npm run fund -- --faucet --collateral 200 --house 3
forge script script/Seed.s.sol --root contracts --rpc-url somnia --broadcast

# And --windows only AFTER seeding: it tops up living organisms one by one, so before
# generation 0 exists there is nobody to top up and it warns instead of acting.
npm run fund -- --windows 400
```

The deploy was dry-run clean against live Shannon on 2026-08-29: **~11.9M gas, ~0.143 STT**. Note the
script path needs the `:Deploy` suffix and must be run with the Foundry root as cwd or via `--root`;
`forge script script/Deploy.s.sol --root contracts` from `darwin/` fails with *"contract source info
format must be `<path>:<contractname>`"*, which is a path-resolution error, not a code error.

Operations (viem + tsx, no Hardhat on this path):

```bash
npm run cadence                # the state machine; keeps the population alive
npm run cadence:once           # one action then exit — for cron
npm run monitor                # alerts on absence of progress, not on exceptions
npm run fee                    # asserts settlementFeeBpsTimes1k == 0 on a real market
npm run prove                  # same-block settlement → selection (the honesty gate)
npm run subscribe -- --discover        # tallies settlement topic0s — but see below
npm run subscribe -- --topic0 0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178 --create
npm run subscribe -- --status          # is reactivity wired, is its gas payer funded?
```

Pass `--topic0` explicitly; do not let `--discover` choose. `BinarySettlement` emits two events and
`--discover` ranks them by frequency, which puts **redeem** (`0xe31682dd…`, 281 occurrences) above
**finalize** (`0xb1884334…`, 130). Subscribing to redeem would trigger the population on its own
redemption — circular, and it never fires first. The two also occur in different transactions: an
oracle driver batch-finalizes, and `finalizeAndRedeem` then only redeems. That is what makes the
central claim work — the callback fires in the finalize block and redeems inside that same synthetic
transaction.

`Deploy.s.sol` refuses to run without `LLM_AGENT_ID`. It was measured from Shannon on 2026-08-29:

```bash
LLM_AGENT_ID=12847293847561029384
```

Of the three agent ids in 6,236 request-creation logs, only this one carries `inferString`'s
selector `0xfe7ca098` in its payload — 96 of 96 times — and decoding one of its live payloads yields
an English oracle prompt. Method and evidence in `docs/SESSION_CHECKPOINT.md` §2.4. The testnet
roster UI, if it ever needs re-deriving, is `agents.testnet.somnia.network` — **not**
`agents.somnia.network`, which is mainnet. A population that cannot think abstains every window,
pays metabolism anyway, and dies of nothing.

The other inference parameters were measured on the same day and are **not** guesses:

| Parameter | Value | How it was established |
|---|---|---|
| minimum `timeout` | **none** — only `0` is rejected (`InvalidTimeout()`) | swept 1 → 86,400 s by `eth_call`; `defaultTimeout() = 600` is a default, not a floor |
| deposit floor | **exactly `0.01 STT x subcommitteeSize`**, linear | `getAdvancedRequestDeposit(n)` read for n = 0..21; 0.03 passes at n=3, 0.03 minus one wei reverts |
| what each request sends | 0.033 STT = 3 x (0.01 + 0.001) | 3.3x the reward live traffic pays, see below |
| observed latency | p50 0.6 s, p99 4.3 s, **max 5.3 s** | n = 6,231 completed request lifecycles |
| completion rate | 6,232 creations → 6,232 terminal-status events | 60,000 blocks of `AgentRequester` logs |
| **net cost per request, live traffic** | **0.0309 STT, nothing refunded** | 5 real single-request txs; payer's balance fell 0.0315 of which 0.00065 was gas |

The two measurements corroborate each other exactly: `0.0309 = 3 x (0.01 + 0.0003)`, so real
requests run a subcommittee of 3 and pay **0.0003 per validator** on top of the floor. That is
the empirical price of an inference on this platform.

**The deposit is not escrow.** Nothing comes back. So a window costs
`0.01 x subcommitteeSize x alive`, plus reward, plus cadence gas — and because the floor is
two thirds of what we pay, **the number of requests, not the reward, is the lever that
matters.** 8 organisms at a 15-minute cadence is 32 requests/hour, and the population grows
toward `maxPopulation = 24` as organisms breed.

**Since 2026-08-30 that bill is not the house's.** Each organism holds native STT of its own
and `think()` draws the deposit out of *its* balance via `Prophet.drawCognition`, so an
organism that cannot afford to think abstains, opens an empty position, and pays metabolism
anyway. Running out of STT is a way to die, and it is meant to be. What the house still pays
for is bounded and does not grow with success: `cognitionEndowment` per founder at
`spawnGenesis`, and `cognitionEndowment` per child at birth — `_spawn` funds a newborn only
if `address(this).balance` covers it, and an underfunded house still bears the child, just
brain-dead until someone calls `topUpCognition`. Entrants fund their own organisms at
`enter`, which is `payable` and reverts `CognitionTooSmall` below `cognitionEndowment`, and
get the unspent remainder back at `retire`. `_requestMutation` draws from the parent for the
same reason `think` does: breeding is an inference, and a house-paid one would have put the
recurring bill back on the growth curve.

`perAgentReward` was lowered 0.01 → **0.001** on 2026-08-29 for exactly this reason: 0.01 was
~33x the observed rate and made every window 45% more expensive than it needed to be. 0.001
still clears the "a request funded at the floor is liable to be skipped" warning by 3.3x.
Raise it with `setInference` (one `onlyOwner` tx, no upgrade) if `ThinkFailed` fires or
abstain counts climb — a validator declining the work looks exactly like a silent population.
Do not go below 0.0003, and do not drop `subcommitteeSize` to 1: `Prophet.sol` requires
`agree >= 2` regardless of what the platform's own tally says, so a subcommittee of 1 always
abstains and a subcommittee of 2 needs unanimity.

**Funding reality, checked in the docs 2026-08-29:** the Google Cloud faucet is *"limited to
1 STT per day"* and no self-serve route publishes more. A continuous run to submission is
hundreds of STT, so it cannot be dripped — the documented path is to ask the team (Discord
`#dev-chat` tagging DevRel, or `developers@somnia.foundation` with the project and GitHub).
Plan the run around the STT actually in hand, and note that **pausing the cadence costs
nothing on chain**: metabolism is charged per settled window, not per unit of wall-clock
time, so a paused population starves no faster than a running one and resumes with its
generation count, lineage and treasuries intact.

Organism-paid cognition does not conjure STT, and it is worth being precise about what it
changes: while the operator is the only funder, the aggregate arithmetic above is unchanged.
What changes is that the bill is now **prepaid and bounded per organism** instead of drawn
from a house balance for as long as it lasts. So the shortfall shows up as one organism
starving — an event, an `alive` flag, a selection outcome — rather than as a whole population
silently abstaining when the paymaster empties. It also makes the demo's cost a *parameter*:
`cognitionEndowment` is windows-per-organism priced at 0.033 STT, so 0.33 STT buys ten
windows each and `setSeason` sizes a season to the STT actually in hand.

So `requestTimeout = 300` has roughly 50x headroom and needs no change — see `SPIKE.md` row 8.
Note the technique, because it is reusable: **`eth_call` with a `stateOverride` on `balance`
simulates a payable call with no private key and no funds**, so an integration surface's accepted
parameter range can be mapped exactly without broadcasting anything or spending STT.

### Foundry is the only compiler

`contracts/` resolves OpenZeppelin through `lib/` remappings, not `node_modules`. `hardhat.config.js`
deliberately points `paths.sources` at an empty directory, so **`npx hardhat compile` is a no-op by
design** — use `npm run build`. Hardhat exists solely to run `@somnia-chain/markets-sdk` and
`@somnia-chain/reactivity` (TypeScript-only, no Solidity equivalent):

```bash
npx hardhat console --network somnia
```

Nothing on the critical path imports `hardhat.config.js`.

## Architecture

### One window, four driver calls

The window is a phase machine held **on-chain** in `Population.phase` (`0` idle → `1` thinking →
`2` committed → `0`):

| Phase | Call | What happens |
|---|---|---|
| 0 | `think()` | Reads `IPriceSource.currentWindow`, records the active market, fires one `createAdvancedRequest` per living organism → `Prophet.handleBelief` |
| 1 | `commitAll()` | Partitions beliefs into Up/Down, pairs them via `IArenaVenue.openOpposing(up, down, amount)`; leftovers get a zero-size position |
| 2 | `settleAll()` | `IArenaVenue.redeemFor` per organism, grade fitness, skim rake on profit, charge metabolism, reap, flag breeding |
| — | `hatchAll()` | Births children whose mutated genomes landed — deliberately separate so slow inference never delays a settlement |

Each is gated by `onlyDriver`: **owner ‖ `SelectionEngine` ‖ reactivity precompile `0x0100`**. That
union is why cadence can migrate from a script to on-chain ticks without a code change.

### Contracts

- **`Population.sol`** — UUPS proxy. Registry, matchmaker, and the arena's treasury. It holds
  accumulated metabolic reimbursement in collateral, and a native STT float it uses to endow
  founders and newborns with cognition (plus any `CognitionUnspent` residue left by a failed
  inference, which `sweep` reconciles). It is **no longer the paymaster for thinking** — since
  2026-08-30 each organism pays its own inference deposits out of its own native balance.
  Every economic parameter lives here (not in `Prophet`) so the whole run is recalibrable from
  one `setEconomics` call without a beacon upgrade.
- **`Prophet.sol`** — `BeaconProxy` clone, one per organism. Owns its own collateral and ERC-6909
  outcome tokens; it is a *party*, not a registry row. Reads addresses back from `Population` via
  `IPopulationConfig` so a redeployed system contract is one write, not N beacon upgrades.
- **`SelectionEngine.sol`** — reactive adapter. The precompile calls a fixed selector
  `onEvent(address,bytes32[],bytes)`, which `settleAll()` cannot match, so something must adapt the
  handler shape; keeping it thin means the reactive surface is one replaceable contract. Plain,
  non-upgradeable, freely redeployable via `Population.setWiring`.
- **`PushedPriceSource.sol`** — only the opening and last prices are pushed. Pool address, outcome
  ids, `tradingStart`, `expiry` and resolved/voided state are read from
  `BinaryMarketsModule.markets()` on **every** call. Also plain and replaceable.
- **`Genome.sol`** — dependency-free library: prompt assembly, the nine `allowedValues`, answer
  parsing. `parseAnswer` maps anything unrecognised to `(Abstain, Unknown)` — never a coin flip.

### Settlement is a replaceable part

`Population` and `Prophet` never touch a market, a pool or a settlement contract directly. All of it
goes through **`IArenaVenue`** (`openOpposing`, `redeemFor`, `positionToken`, `collateral`), and two
adapters implement it. Both are plain and non-upgradeable, and either can be repointed with one
`setWiring` call — `test_venue_canBeRepointedBetweenWindows`.

- **`venues/DreamDEXVenue.sol`** — 1:1-backed complete sets on a DreamDEX binary pool, redeemed
  through `BinarySettlement.finalizeAndRedeem`. Holds no value between transactions.
- **`venues/DirectDuelVenue.sol`** — a two-party escrow resolved by the sign of a price change. It
  *does* hold both antes between `openOpposing` and redemption, so every path accounts for the whole
  backing exactly once. Three rules there are load-bearing rather than stylistic: the outcome is
  **frozen by the first claim** (otherwise the backing is paid twice), only a position's **own holder**
  may redeem it and there is no public `resolve` (otherwise a bystander chooses when the window
  closes), and an unadjudicable duel **refunds both antes** rather than paying zero (otherwise the
  collateral is stranded and both forecasters are graded wrong).

Two hard constraints the interface imposes on any future adapter, both documented at
`IArenaVenue`'s declaration: **`redeemFor` must return 0 for a loser rather than reverting** — a
losing settlement is the normal case and must not abort the window for anyone else — and **it must
not read a price feed**, because on the reactive path nobody pushes a price between resolution and
the callback, so `IPriceSource.currentWindow` reverts `StalePrice` there. Record the level at open;
read it back at settlement through a `try`/`catch`. `positionToken() == address(0)` tells
`Prophet.settleWindow` to skip the ERC-6909 push, which is the right answer for a venue that issues
no transferable position — the ERC-6909 surface has no `transferFrom`, so a venue can never *pull* a
position; the organism pushes.

The demo runs **two `Population` deployments sharing one `Prophet` beacon**, one per venue, rather
than swapping the venue under a live population — two concurrent leaderboards over identical
organism code. Note the limit of the claim: a duel arena settles without a market, but
`PushedPriceSource` still resolves a real market to compute `tradeable` and `think` refuses an
untradeable window, so *opening* a window still needs one. Cutting that thread is an `IPriceSource`
v2, not a venue change.

### The on-chain / off-chain seam

`scripts/cadence.ts` is a state machine over `Population.phase()` that **remembers nothing between
iterations** — active market, window number and phase all live on-chain. It can be killed,
restarted, or moved to another machine and resumes where the population actually is. It pushes two
prices and calls four functions; belief formation, pairing, fitness, death, mutation and lineage are
all on-chain.

`pushWindow` then `think()` must go back-to-back: `PushedPriceSource.maxStaleness` is 180s, so any
delay between them is a reverting `think()`.

### Selection over ideas

`Belief` is direction (`Up`/`Down`/`Abstain`/`None`); `Thesis` is *why*
(`Momentum`/`Reversion`/`Breakout`/`Range`/`Unknown`). Both are on-chain and both are in the
`Believed` event, so selection over strategies is readable straight from the log stream. The nine
`allowedValues` are the cross product plus `ABSTAIN` — one constrained inference call, still safe to
act on inside a contract.

## Hard constraints

### Storage is append-only

`Prophet` sits behind a beacon and `Population` behind a UUPS proxy specifically so logic can be
repaired mid-run **without resetting lineage** — the ancestry graph is the one asset that cannot be
rebuilt. That guarantee holds only if storage never moves.

Append into `__gap` only, shrinking it by exactly the slots you add. Never reorder, retype, delete,
or insert between existing variables. Every change gets a dated changelog entry in `STORAGE.md`.

- `Prophet` slot 14 is **exactly full** (32/32) — a new packed counter must start a fresh slot.
- `Prophet` slots 0 (31/32) and **15 (1/32 — thirty-one bytes spare)** have free bytes. **Do not
  fill them.** Slot 15 holds only `positionOpen` and is the most inviting place in the contract to
  "just add a bool"; it is the same trap as the `Population` slots below.
- `Population` slots 13, 18, 21, 23, 26 have free bytes. **Do not fill them.** Packing into a
  partially-used slot changes nothing for a fresh deploy and corrupts nothing visibly until an
  organism's counter starts reading someone else's bytes. Take a fresh slot from `__gap`.
- Layout freezes at the deploy, moved to **2026-09-02** so the storage-affecting half of the
  arena-engine rework lands before the freeze rather than after it. Phases 1, 2, 2A and 3 are in;
  phase 4 (escalating ante, seasons, prize pool, rake) is the last change that can still take
  slots, and it takes four. Until the deploy, changes are allowed but still logged.

### Do not "tidy" the stack-limit workarounds

`via_ir = true` is **required**, not a preference: `IPriceSource.currentWindow` returns nine values
and the legacy codegen cannot even build that return frame. Even under IR, several functions sit
within one slot of the stack limit. These shapes are load-bearing and each is commented as such at
the site — a refactor that looks like cleanup will fail to compile:

- `Population._spawn` — the prophet id is **not** a local (the Yul optimizer inlines this into
  `spawnGenesis`'s loop; a local pushes it one slot over).
- `Population.think` — the nine-value `currentWindow` destructure is inside a scoped block, and the
  `WindowOpened` emit lives inside that block because it is the last use of `openPrice`/`pool`.
- `Population.snapshot` — fields assigned one at a time, not a `Snapshot({...})` literal.
- `Genome.beliefPrompt` — formatting staged into `head`/`body` rather than one `string.concat`.
- `PushedPriceSource._resolveMarket` — split into its own frame because destructuring a 14-tuple
  needs fourteen slots; `currentWindow` has nine named returns live for its whole body.
- `PushedPriceSource.currentWindow` — the window read is scoped so `w` and `age` do not stay live.

### `evm_version = "shanghai"` — and why it is not `paris`

It was `paris` until 2026-08-29. **`paris` made the deploy impossible.** `evm_version` sets both
solc's target *and* the EVM spec forge executes with, so any script that touches a live Shannon
contract runs that contract's fetched bytecode under this spec — and the deployed DreamDEX contracts
use PUSH0. Under `paris`, `forge script Deploy.s.sol --rpc-url <shannon>` dies on its first live
call, `IERC20Like(TUSDC).decimals()`:

```
EvmError: NotActivated  →  Error: script failed: <empty revert data>
```

which names neither PUSH0 nor `evm_version`. **`--broadcast` simulates before sending, so this was
never dry-run-only — the deploy itself would have failed at the first command.** The same script
unchanged under `shanghai` simulates the full deploy clean. Tests: 56/56 under both. Storage layout:
byte-identical (`evm_version` does not affect it).

Shannon's supported fork is therefore no longer unconfirmed — its own production contracts contain
PUSH0 and execute, so the chain is at least Shanghai. `shanghai` is deliberately chosen over
`cancun`: the minimum that works and the maximum the evidence supports. A passing `cancun`
simulation proves nothing about Shannon, only about local revm.

This does **not** weaken the reasoning behind `Population`'s explicit
`constructor() { _disableInitializers(); }` — that guards against `selfdestruct` bricking the
implementation, and EIP-6780 is a *Cancun* change, still not assumed. `Prophet` deliberately does not
get one: it uses a manual `AlreadyInitialized` guard, is beacon-backed, and exposes no
`upgradeToAndCall`.

### Death is irreversible

No path anywhere clears `dead` — not owner, not `Population`, not a beacon upgrade. The `alive`
modifier gates every state transition. `test_death_isIrreversible` and `test_upgrade_cannotRevive`
assert it. Do not add an admin recovery path; a judge should be able to grep for one and fail.

### `currentStake` vs `currentQuantity`

Not the same number, and conflating them is a real bug. A paired position is funded by both
organisms, so each side *holds* `amount` tokens while having *risked* exactly `amount / 2` — exactly,
because `_pair` clamps both legs to the same `want` before opening, which is the invariant
`DirectDuelVenue`'s void refund depends on and cannot itself check. Redemption is denominated in
tokens, profit and loss in collateral. Deriving one from the other would make every winner read as
break-even and silently zero the fitness signal.

Likewise in `settleWindow`: `IArenaVenue.redeemFor`'s return value is what the position was
**worth** (the fitness signal); the collateral **balance delta** is what the organism now custodies. Settlement
may credit an `owed` balance instead of transferring, so `treasury` is ledgered from the delta and
`_sweepOwed` rescues the difference. `treasury == collateral.balanceOf(prophet)` is an asserted
invariant.

## Conventions

- **One bad organism must never halt the population.** Per-organism failures are caught and emitted
  as `ThinkFailed` / `CommitFailed` / `SettleFailed` so `monitor.ts` can see them. `_pair` goes
  through `this.executePair(...)` purely to get a revert boundary. The deliberate exception is
  `IArenaVenue.redeemFor` in `Prophet.settleWindow` — it is *not* wrapped, because a genuinely
  reverting settlement is an integration break that should abort rather than be silenced. That is
  precisely why the interface requires a loser to be paid **0** instead of reverting, and why a venue
  that cannot observe a close must void rather than propagate: an unwrapped revert there leaves the
  position open with the ante already escrowed.
- **Non-`Success` inference collapses to `Abstain`**, never a revert. An infrastructure failure is
  absorbed as a biological one. `_modalResult` additionally requires ≥2 agreeing validators
  regardless of what the platform's own tally says.
- **Script ABIs are hand-written `parseAbi` fragments** in `scripts/lib/darwin.ts`, not imports from
  `contracts/out/`. The operational scripts must run on a fresh clone from a machine that never
  compiled. Custom errors are included so a revert reads as a sentence, not a hex blob.
- **Never cache a pool address or outcome id across windows.** Pools are recycled; outcome ids encode
  the pool nonce. A cached pool will eventually point at a different market's book.
- **Foundry `fs_permissions` are narrow on purpose** — read `../genomes`, read-write `./deployments`,
  nothing else. `contracts/deployments/<chainid>.json` is the manifest every script and the frontend
  reads, and it is committed.
- **`vm.prank` in tests binds to the next call — and a `view` read is a call.** Solidity evaluates
  arguments before the call, so `vm.prank(owner)` followed by an argument that reads
  `population.endowment()`, or `_p(1)`, or `address(new ProphetV2())`, consumes the prank on the
  wrong thing. This caused 14 test failures once. Use the `_econ()` / `_setEconomics()` helpers and
  bind pranks only to calls with no intervening argument read.
- **`vm.expectRevert(bytes4)` compares the WHOLE revert data**, so a bare selector matches only a
  *parameterless* error. Against `error StalePrice(uint64 age, uint64 limit)` it fails with
  `StalePrice(181, 180) != custom error 0x2ccfc2ca`, which reads as "it did not revert as
  expected" when it reverted for exactly the expected reason. Two correct forms, and the choice is
  a claim about what the test is asserting: `abi.encodeWithSelector(E.selector, a, b)` when the
  arguments *are* the claim (`test_priceSource_refusesStalePrice` — the age and the limit are the
  point), and `vm.expectPartialRevert(E.selector)` when the revert reason is the claim and the
  arguments are incidental (`test_venue_settlesAfterThePriceFeedHasGoneStale` — a precondition
  proving the feed is stale, where the age is an artifact of harness timing).
- TypeScript is `strict` with `noUncheckedIndexedAccess`; `scripts/` uses ESM syntax with `.js`
  import specifiers, run through `tsx`. `package.json` has no `"type": "module"` — that is what lets
  `hardhat.config.js` stay CommonJS.

## The honesty gates

The README's "Not claimed" section is load-bearing, and two scripts enforce it:

- **`npm run prove`** is the gate for the central claim. It passes only on a `Reacted` event with
  `viaReactivity == true` sharing a block with a real settlement log — and because
  `BinarySettlement` is a shared singleton, it recovers the marketId and pool *this* population
  committed to from its own `WindowOpened` log and requires the settlement log to reference one of
  them. A coincidence fails. Until it passes, and while `SelectionEngine.fallbackEnabled` is `true`,
  the licensed claim is *"selection is on-chain and atomic with redemption"* — **not** *"no keeper
  anywhere in the causal chain."* Only after `disableFallback()` is the stronger claim true.
- **`npm run fee`** measures `settlementFeeBpsTimes1k` on a real finalized market. Zero fees are what
  make metered cognition the only selection pressure. If it is non-zero the script computes the fee
  drag against the metabolic cost per window and tells you which is actually doing the selecting — a
  measured number changes the claim, not the narration.

`forge test` cannot exercise either live primitive: the reactivity precompile **does not exist** on
chain ids 31337/1337 (absent, not reverting) and `AgentRequester` has real validators behind it. Both
are mocked in `contracts/test/mocks/Mocks.sol`. That split is a platform constraint, not a testing
preference — which is why `prove-same-block.ts` owns the one property the mocks cannot support.

When code is uncertain about an external surface, it is marked `UNVERIFIED` at the site and listed in
`SPIKE.md`. Keep that convention.

## Notes on the docs

- `web/` now exists: a zero-build static dashboard (ES modules + viem from a pinned CDN, no
  bundler, no install, no backend, no wallet). It configures **only** the `Population` address and
  discovers `collateral`, `priceSource`, `venue`, `selectionEngine`, `marketsModule` and `symbol`
  on-chain, because `venue` is repointable and a stale config could aim the page at an abandoned
  arena. `?demo=1` renders `web/js/fixture.js` through the identical renderer, so the frontend is
  reviewable before Season 0 exists. See `web/README.md`; the invariant most worth preserving is
  that there is **no `innerHTML`** anywhere in it — `Population.enter` is permissionless, so every
  genome the page displays is untrusted input from a public write path.
- `npm test --prefix web` runs the real renderer against the fixture under a 60-line fake DOM
  (`web/test/smoke.mjs`) — twenty render calls, thirty-one assertions, no network and no browser.
  Run it after touching anything under `web/js/`. It is the only executable check this repo has on
  the frontend, and it exists because everything else about `web/` had only ever been verified by
  reading. `web/package.json` is there solely to tell Node these `.js` files are ES modules; it
  declares no dependencies, so "no install, no build" still holds.

- `README.md` still mentions a `REACTIVITY_CALLBACK_SIG` env var. The handler selector
  `onEvent(address,bytes32[],bytes)` was verified on 2026-08-29 against `SomniaEventHandlerABI` in
  `@somnia-chain/reactivity@0.2.1`, and `SelectionEngine` no longer has that escape hatch. The
  `fallbackEnabled` path remains, because a subscription can still be unfunded or unfired.
</content>
