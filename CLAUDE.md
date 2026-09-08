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
`DarwinTest`, **152 tests as of 2026-09-07** — 152 `function test` declarations in the one file,
none of them fuzzed, so the suite count and the declaration count are the same number):

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

Both layouts were re-derived from a clean build and diffed on **2026-08-30** with **zero
discrepancies** — 29 `Prophet` rows, 47 `Population` rows, and `agentRequester` still alone at
slot 0 with nothing inherited ahead of it, so OZ v5 namespaced storage still holds. Same result
on 2026-08-29. See the changelog at the bottom of `STORAGE.md`.

**That paragraph is a dated record and the layout has since changed twice — do not read its row
counts as current.** Phase 4's escalating ante appended `windowAnte` on **2026-09-05**, taking slot
37 and shrinking `__gap` from `uint256[10]` to `uint256[9]`. Later the same day the Genesis Treasury
appended `genesisTreasury` (`address`, 20 bytes) at **slot 38 offset 0**, shrinking `__gap` again to
`uint256[8]` at **39–46**. The envelope still ends at 46 both times. `Population` is therefore **49
rows, not 47**; `Prophet` is untouched at 29, because `entrant` is still written in exactly one place
and N1 changed only what is passed to it. **Slot 38's other twelve bytes are do-not-fill** like every
other partial slot. `STORAGE.md`'s tables and changelog carry the current layout and were reconciled
against `forge inspect` the same day — walking the compiler's rows and requiring a table row for
each, rather than the reverse. Run the three commands above before relying on any of it for an
upgrade.

Deploy and seed generation 0:

```bash
# ALWAYS dry-run first. Same command minus --broadcast: forge executes the whole script
# against live Shannon state, so it catches wrong addresses, preflight reverts and EVM-spec
# mismatches for free. _writeManifest is guarded on vm.isContext(ScriptDryRun), so a dry run
# will NOT write deployments/<chainid>.json — nothing downstream can be fooled by it.
#
# THE SUBSHELL IS NOT STYLE. `forge script` is the one forge subcommand that will NOT take
# `--root` from a cwd above the root — see the paragraph under this block. `-g 3000` is not
# optional either; `docs/RUNBOOK.md` carries what omitting it cost.
(cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url somnia -g 3000 -vv)

(cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url somnia -g 3000 --broadcast)

# THE TREASURY COMES BEFORE THE FOUNDERS, and `spawnGenesis` enforces it rather than
# defaulting: it reverts `NoGenesisTreasury` while `genesisTreasury` is zero, because a
# founder minted against `address(0)` would be permanently ownerless AND permanently
# unretirable (`retire` needs `msg.sender == entrant`) with no repair path. `onlyOwner`,
# once ever — a second call reverts `TreasuryAlreadySet`, and there is no setter.
#
# DO NOT CALL IT BY HAND. `Seed.s.sol:51` calls it itself, one line before `spawnGenesis`,
# in the same broadcast — so a manual `cast send` first is not belt-and-braces, it makes
# the seed script permanently unrunnable (`TreasuryAlreadySet` with no setter to undo it).
# `NoGenesisTreasury` is only reachable by calling `spawnGenesis` outside that script.

# ORDER IS LOAD-BEARING. `spawnGenesis` is payable and `_spawn` endows each newborn out of
# `address(this).balance`, so the house float must already be there when Seed runs — 8
# founders x 0.33 STT = 2.64. Fund it FIRST and a Seed script that attaches no value of its
# own still produces a generation 0 that can think.
npm run fund -- --faucet --collateral 200 --house 3
(cd contracts && forge script script/Seed.s.sol:Seed --rpc-url somnia -g 3000 --broadcast)

# And --windows only AFTER seeding: it tops up living organisms one by one, so before
# generation 0 exists there is nobody to top up and it warns instead of acting.
npm run fund -- --windows 400
```

The deploy was dry-run clean against live Shannon on 2026-08-29: **~11.9M gas, ~0.143 STT**.

**`forge script` will not accept `--root`, and the reason this took two sessions to notice is that
the two failures look like one.** Both were re-measured on 2026-09-07, from `darwin/`:

| Command | What you get |
|---|---|
| `forge script script/Deploy.s.sol --root contracts` | *"contract source info format must be `<path>:<contractname>`"* |
| `forge script script/Deploy.s.sol:Deploy --root contracts` | *"no such path (os error 3)"* — never compiles |

Argument parsing runs before path resolution, so the missing `:Deploy` suffix masks the second
failure entirely. Adding the suffix — which is what this paragraph used to tell you to do — does not
fix the command, it just advances it to the next error. **`--root` is fine for `build`, `test`,
`fmt` and `inspect`, which is why those keep it above; for `script` the root must be the cwd.** Hence
the `(cd contracts && ...)` subshells. `docs/RUNBOOK.md`'s *"`forge script` and the working
directory"* is the authority and carries the measurement table.

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
| what each request sends | ~~0.033 STT = 3 x (0.01 + 0.001)~~ → **0.24 STT = 3 x (0.01 + 0.07)** | the floor is not the price of a request that SUCCEEDS; see the 2026-09-07 block below |
| observed latency | p50 0.6 s, p99 4.3 s, **max 5.3 s** | n = 6,231 completed request lifecycles |
| completion rate | 6,232 creations → 6,232 terminal-status events | 60,000 blocks of `AgentRequester` logs |
| **net cost per request, live traffic** | **0.0309 STT, nothing refunded** | 5 real single-request txs; payer's balance fell 0.0315 of which 0.00065 was gas |

The two measurements corroborate each other exactly: `0.0309 = 3 x (0.01 + 0.0003)`, so real
requests run a subcommittee of 3 and pay **0.0003 per validator** on top of the floor.

**BUT THAT IS THE PRICE OF SOMEBODY ELSE'S REQUEST, NOT OF ONE THAT SUCCEEDS FOR US — see the
2026-09-07 correction below before using any figure in this table as a budget.** The rows above
are all still individually true and were all individually measured; what was wrong was the
inference drawn from them, that 0.001 was a safe reward because it was 3.3x an observed rate.
The observed rate came from other people's traffic, and a request funded at the floor is one
validators are *entitled* to decline. Ours declined 104 of 104.

**The deposit is not escrow when a request succeeds** — nothing comes back. On a *failure*
~0.0292 of the 0.24 is refunded, and it goes to `msg.sender`, i.e. `Population`, never to the
organism whose balance was drawn. So a window costs `subcommitteeSize x (0.01 + perAgentReward)
x alive`, plus cadence gas — and at the corrected reward the floor is only **12%** of what we
pay, which inverts the old conclusion: **the reward, not the request count, is now the lever
that matters.** 8 organisms at a 15-minute cadence is 32 requests/hour = **7.68 STT/hour**, and
the population grows toward `maxPopulation = 24` as organisms breed.

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

**`perAgentReward` is 0.07 STT, measured 2026-09-07, and this is the most expensive mistake in
the project's history.** It was lowered 0.01 → 0.001 on 2026-08-29 on the reasoning above, and
that reasoning was wrong: 0.001 bought **zero** successful inferences. A census of 182 of our
own requests with `chainOfThought` held **false** throughout separates 182/182 — **78 of 78
Success at 0.07, 0 of 104 at 0.001**. The population had been abstaining every window with
completely innocent genomes.

**What told the two apart, and it is the reusable part:** `Believed` carried **zeroed validator
addresses**, which is `status != Success`, so `Genome.parseAnswer` had never run at all. Without
that field a dropped `allowedValues` constraint and an unserved request are indistinguishable
from outside — both produce a silent population — and `allowedValues` was the suspect for a week.
It is innocent: all 78 Successes carried the nine values, one carried 27.

Raise it with `setInference` (one `onlyOwner` tx, no upgrade) if `ThinkFailed` fires or abstain
counts climb. **Do not lower it below 0.07 without re-running that census**, and in particular do
not reason from the deposit floor or from other people's observed rate — that is exactly the
inference that cost 104 requests. Do not drop `subcommitteeSize` to 1 either: `Prophet.sol`
requires `agree >= 2` regardless of what the platform's own tally says, so a subcommittee of 1
always abstains and a subcommittee of 2 needs unanimity.

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
`cognitionEndowment` is windows-per-organism priced at the deposit, and **at 0.24 STT the
shipped 0.33 buys 1.375 windows, not ten** — the "ten windows each" this paragraph used to
claim was the 0.033 arithmetic. `npm run fund -- --windows N` is the operational remedy;
`setSeason` with `cognitionEndowment = 1.2 STT` (prepared in `docs/HANDOVER_PRICE_FIX.md`) is
the on-chain one, and it sizes a season to the STT actually in hand.

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
- **`GenesisTreasury.sol`** — the eight founders' `entrant`, and the house's own position held where
  anyone can see it. Non-upgradeable, 88 lines, **no owner, no withdraw, no arbitrary call, no
  `upgradeTo`, no `receive()`**. One state-changing function, `recycle()`, which is
  **permissionless** and pushes its whole collateral balance back into `prizePool` via
  `Population.donatePrizePool`. Deployed by `Population.deployGenesisTreasury()` (`onlyOwner`, once
  ever — `TreasuryAlreadySet`, and no setter exists), and `spawnGenesis` **reverts
  `NoGenesisTreasury`** until it has run. It reads `collateral` off the arena at call time rather
  than storing an immutable, so a `setWiring` repoint cannot strand it holding a token it has no
  path for. The no-owner argument depends on a fourth read that is **not optional**:
  `sweep`'s collateral leg is capped at `balance - (rakeAccrued + prizePool)` (`BooksReserved`), or a
  reader grepping `onlyOwner` would find a path from the players' pot to the operator anyway. The
  native leg is deliberately uncapped — it is the `CognitionUnspent` remedy, and both books are in
  collateral.

### Settlement is a replaceable part

`Population` and `Prophet` never touch a market, a pool or a settlement contract directly. All of it
goes through **`IArenaVenue`** (`openOpposing`, `redeemFor`, `positionToken`, `collateral`), and two
adapters implement it. Both are plain and non-upgradeable, and the venue field is repointable with
one `setWiring` call — but read `test_venue_canBeRepointedBetweenWindows` before citing it: it
repoints to a **fresh instance of the same adapter**, and asserts the seam (the new venue issues the
pair; the organism is graded through both windows). Nothing tests migrating a population *across*
adapters, and doing it mid-run is unsafe — see the repoint hazard in `STORAGE.md`'s "Contracts with
no storage constraint": **repoint only in phase 0, with no position open.**

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

The duel arena is a **second `Population` proxy over the same `Prophet` beacon and price source**,
with only the `venue` field differing (`_duelArena` in the test file, plus two end-to-end tests) —
two concurrent leaderboards over identical organism code, rather than swapping the venue under a
live population. **In the test suite only:** `Deploy.s.sol` deploys one `Population` on one
`DreamDEXVenue`, so a second live arena is a second deploy, not a flag. Do not describe it as
shipped until that script grows the second one. Note the limit of the claim too: a duel arena
settles without a market, but `PushedPriceSource` still resolves a real market to compute
`tradeable` and `think` refuses an untradeable window, so *opening* a window still needs one.
Cutting that thread is an `IPriceSource` v2, not a venue change.

### The on-chain / off-chain seam

`scripts/cadence.ts` is a state machine over `Population.phase()` that **remembers nothing between
iterations** — active market, window number and phase all live on-chain. It can be killed,
restarted, or moved to another machine and resumes where the population actually is. It pushes two
prices and calls five functions; belief formation, pairing, fitness, death, mutation and lineage are
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
- `Population` slots 13, 18, 21, 23, 26, 33 and **38** have free bytes. **Do not fill them.** Packing
  into a partially-used slot changes nothing for a fresh deploy and corrupts nothing visibly until an
  organism's counter starts reading someone else's bytes. Take a fresh slot from `__gap`.
- Layout freezes **at the deploy, not on a calendar date**. The freeze was written against
  2026-09-02 and that date passed with nothing deployed, so the envelope is still open: `windowAnte`
  (slot 37) and `genesisTreasury` (slot 38) both landed after it. Until the deploy, changes are
  allowed but still logged — every one needs a `STORAGE.md` changelog row *and* a re-derivation.

### Do not "tidy" the stack-limit workarounds

`via_ir = true` is **required**, not a preference: `IPriceSource.currentWindow` returns nine values
and the legacy codegen cannot even build that return frame. Even under IR, several functions sit
within one slot of the stack limit. These shapes are load-bearing and each is commented as such at
the site — a refactor that looks like cleanup will fail to compile:

- `Population._spawn` — the prophet id is **not** a local (the Yul optimizer inlines this into
  `spawnGenesis`'s loop; a local pushes it one slot over).
- `Population.spawnGenesis` — the `genesisTreasury` **`SLOAD` stays inside the loop, uncached**, for
  the same reason: the inlined `_spawn` body sits exactly one slot under the limit and a cached
  `address` local is precisely that slot. Verified by compiling, not by argument. ~100 warm gas per
  founder, eight founders, once ever. Do not hoist it.
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
unchanged under `shanghai` simulates the full deploy clean. Tests: 56/56 under both — that is the
suite **as it stood on 2026-08-29**, not a current count (it is 152 now), and the figure is left
alone deliberately: the claim is that one identical suite passed under both EVM versions, and
substituting today's number would assert a `paris` run that never happened. Storage layout:
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
  (`web/test/smoke.mjs`) — **66 renderer call sites and 211 `assert()` call sites, executing 231
  checks, re-measured 2026-09-07** (the earlier "fifty / 167 / 313 / 189" was true when written and
  the suite has grown; the render-call runtime figure is dropped rather than guessed, because it
  needs instrumenting render.js and the static site count is what a reader can reproduce). No network
  and no browser. Run it after touching anything under `web/js/`. It is the only executable check this repo
  has on the frontend, and it exists because everything else about `web/` had only ever been verified
  by reading. It also loads `chain.js` with no network, which is what proves viem and `abi.js` are
  reached only through lazy `import()` — make one of them a static import and that assertion fails.
  `web/package.json` is there solely to tell Node these `.js` files are ES modules; it declares no
  dependencies, so "no install, no build" still holds. Forty-four of the assertions recompute the
  scripted demo season's arithmetic from `config` and `Population.sol` — they fail if someone tunes a
  number to make the demo look better, and all of them were confirmed capable of failing by
  perturbing the fixture rather than by inspection. (That count is the `assert()` call sites between
  `season plays 4 frames` and `the header follows the script to window 42`; the earlier note said
  thirty-four on a boundary that can no longer be reproduced, so the boundary is now written down.
  New assertions go OUTSIDE that range or the documented sub-count breaks.)
- **Twelve of those assertions are detector self-tests, and they are not padding.** Two checks in this
  suite once asserted a string no code path can emit (`"unknown event"`, which `generic()` never
  prints) and stayed green on exactly the state they were written to catch. So a check whose subject
  is "X cannot happen" is now paired with one that makes X happen on purpose and requires the same
  detector to fire. Delete a control and you are back to a test that cannot fail. (Three came with
  the settlement/null-key work on 2026-09-02; three more with the read-verdict work on 2026-09-03 —
  a mixed read batch must flip verdict when its successes are removed, the three error banners must
  not share a headline, and an `unreachable` chain must leave the address form closed. Six more came
  with the season close on 2026-09-05, at `web/test/smoke.mjs:806`, `:811`, `:826`, `:835`, `:841`
  and `:855` — each one sits next to the assertion it protects and says so in the comment above it.)
- **`absent` is not `unreachable`, on either surface.** `web/js/chain.js`'s `readVerdict` and
  `app/src/lib/reads.js`'s `readReport` are deliberately the same classifier: any answered read means
  `live`, and a batch where everything failed is `absent` only if viem raised
  `ContractFunctionZeroDataError` (*"returned no data (\"0x\")"*) — otherwise `unreachable`. The two
  cases get opposite copy and opposite affordances, because their remedies are opposite: `absent`
  means edit the address (and the arena's setup form is forced open), `unreachable` means leave it
  alone and retry. Never re-derive this from a failure count; a tally cannot tell the two apart, and
  guessing sends someone on a testnet hiccup off to edit a perfectly good address.
- **Animation on that page is driven by a diff, not by rendering**, and `web/vendor/gsap.min.js` is
  a committed file rather than a CDN import — `?demo=1` is documented three times as working with
  the network unplugged. `main.js` compares snapshots, `render.js` stamps `data-fx`, `js/motion.js`
  plays one timeline per stamp; nothing stamped animates nothing. Two rules there are load-bearing:
  without GSAP or under `prefers-reduced-motion` every timeline is a no-op and the page renders
  static, and any tween starting from `opacity: 0` must sit in a timeline carrying `guarantee()`'s
  deadline — otherwise a stalled frame clock leaves the whole population laid out and invisible.
  `onClockAlive()` is the defence in front of that one: timelines are built inside the first
  `requestAnimationFrame` callback, so a page that is never composited never hides anything.
- **`?demo=1` is not a still image.** `fixture.season()` scripts the next window as four snapshots
  fed through the same `advance()` path a live poll uses, so the `died` / `born` / `treasury` /
  `phase` timelines actually fire in the only mode that exists before Season 0. It runs forward and
  stops — looping would resurrect the starved organism and contradict `test_death_isIrreversible` on
  screen. Every figure in it is derived from `config` and the breeding rules, never chosen.
- **Do not time-verify the frontend's motion with `--virtual-time-budget`.** Chrome races the virtual
  clock while GSAP's ticker reads `performance.now()`, so a capture labelled 2200ms shows a timeline
  fifty real milliseconds in — an entire population at `opacity: 0`, indistinguishable from the bug
  the two defences above exist to prevent. Drive the page over CDP and sample on the wall clock
  (Node's global `WebSocket` needs no dependencies); a `--dump-dom` at the same budget is the quick
  way to tell a stalled clock from a stalled *measurement*. Measured properly: population fully
  visible 1.0s after navigation, last lineage edge at 1.6s.


- The handler selector `onEvent(address,bytes32[],bytes)` was verified on 2026-08-29 against
  `SomniaEventHandlerABI` in `@somnia-chain/reactivity@0.2.1`, and `SelectionEngine` no longer
  has a selector escape hatch. `subscribe.ts:132` keeps `REACTIVITY_CALLBACK_SIG` as an env
  override against a future SDK change; it should not normally be set, and setting it wrongly is
  the one remaining way to build a subscription that can never fire. `README.md` no longer
  advertises it (corrected 2026-08-30). The `fallbackEnabled` path remains, because a
  subscription can still be unfunded or unfired.
</content>
