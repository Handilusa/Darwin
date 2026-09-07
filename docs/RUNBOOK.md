# RUNBOOK — deploying DARWIN to Shannon

Every command is on its own line. **Nothing is chained with `&&`** — Windows PowerShell 5.1 has no
pipeline chain operator and `A && B` is a parser error there, not a failed command. Run the lines in
order, read the output of each, and only then run the next.

The order below is not a preference. Four of these steps have on-chain preconditions that revert if
the previous step did not happen, one of them is once-ever with no repair path, and one gates on a
balance that a later step spends. Section [Why this order](#why-this-order) says which is which.

---

## Before you start

You need three things in the shell, and none of them are optional.

```powershell
$env:PRIVATE_KEY = "0x..."
$env:LLM_AGENT_ID = "12847293847561029384"
$env:SOMNIA_RPC_URL = "https://dream-rpc.somnia.network"
```

`.env` is read by the TypeScript scripts (`scripts/*.ts` load it through `dotenv`), but **`forge`
does not read `.env` for the `somnia` RPC alias** — `foundry.toml` resolves `${SOMNIA_RPC_URL}` out
of the process environment. If that variable is unset, `--rpc-url somnia` fails with a URL parse
error that names neither the alias nor the variable. Either export it as above, or pass the literal
URL everywhere `--rpc-url somnia` appears below.

`LLM_AGENT_ID` is refused if absent — `Deploy.s.sol` reverts `PlaceholderAgentId()`. The value above
was measured off Shannon: of three agent ids appearing in 6,236 request-creation logs, only this one
carries `inferString`'s selector in its payload. A population deployed against a wrong agent id
abstains every window, pays metabolism anyway, and dies of nothing.

### Foundry on this machine

`forge` and `cast` are not on the default `PATH`.

```powershell
$env:PATH = "$env:USERPROFILE\.foundry\bin;$env:PATH"
```

**Never test success with `$?` after a `forge` command.** Forge writes its lints to stderr, and
PowerShell 5.1 turns any stderr output from a native executable into a failure indication — so a
clean build reports as exit 1. Read the output instead: a good build ends in `Compiler run
successful!`.

### `forge script` and the working directory

Measured, because this costs half an hour if you hit it under pressure:

| cwd | invocation | result |
| --- | --- | --- |
| `darwin/` | `forge script script/Deploy.s.sol:Deploy --root contracts` | `os error 3`, path not found |
| `darwin/` | `forge script contracts/script/Deploy.s.sol:Deploy --root contracts` | runs, then `Chain 50312 not supported` |
| `darwin/contracts/` | `forge script script/Deploy.s.sol:Deploy --rpc-url ...` | **works** |

So **`cd` into `contracts/` for every `forge script` line.** The `--root` flag works fine for `forge
build`, `forge test` and `forge fmt`; it is `forge script` with a cwd above the root that breaks.
Also note the `:Deploy` suffix is required — without it forge reports *"contract source info format
must be `<path>:<contractname>`"*, which is a path-resolution error and not a code error.

### The contract size warning is not a failure

`forge script` prints this after its logs:

```
Error: `Population` is above the contract size limit (33620 > 24576).
```

**Shannon does not enforce EIP-170.** Verified directly: `eth_call` performing a `CREATE` that
deposits 24,577, 25,000 and 33,620 bytes of code all return that code successfully, and 24,576
behaves no differently from 24,577. The line comes from forge's local revm, which does enforce it.
The simulation completes and the transactions it printed are the ones that will be sent. To silence
it:

```powershell
$env:FOUNDRY_CODE_SIZE_LIMIT = "60000"
```

---

## The budget, in real numbers

With **100 STT** and **1000 tUSDC** in the deployer wallet, at the 6 gwei Shannon reports for both
`eth_gasPrice` and the base fee.

### tUSDC — not the constraint

| item | amount |
| --- | --- |
| held | 1000 tUSDC |
| 8 founders x `endowment` | **80 tUSDC** |
| left over | 920 tUSDC |

The faucet is permissionless and needs nothing from us. `faucet(uint256)` takes **raw units** (tUSDC
is 6dp) and mints them verbatim, capped at **10,000 tUSDC per call** — `faucet(10_000e6)` succeeds
and `faucet(10_000e6 + 1)` reverts `FaucetCapExceeded()` (`0x37583762`). Per call, not per account,
and no cooldown, so collateral is never the thing that stops a run.

### STT — the constraint

| item | STT |
| --- | --- |
| deploy + seed gas, pessimistic | 2.04 |
| house birth float, 8 x `cognitionEndowment` | 2.64 |
| **setup subtotal** | **4.68** |
| reactivity floor the signer must still HOLD | 32.00 |
| left to spend on windows | **63.32** |

Per window, for eight organisms:

| leg | STT | paid by |
| --- | --- | --- |
| inference, 8 x `requestDeposit()` (0.033 each) | 0.264 | the organisms, prepaid |
| cadence gas | 0.163 | the signer, every window |
| **total** | **0.427** | |

**63.32 / 0.427 = 148 windows ≈ 37 hours** at the 15-minute cadence. That number is what the deploy
script prints, and it is the only budget figure worth planning from.

Two honest caveats on it, in opposite directions.

The gas half is pessimistic on purpose, and **the deploy half is no longer an estimate**: it ran on
2026-09-06 and metered **180,575,218 gas = 1.0835 STT** at 6 gwei, against the 1.65 the script
claims. Shannon meters a code deposit at **3,295 gas/byte** — fitted from the two largest creations
in those receipts (`Population` 113,145,022 gas at 34,226 runtime bytes, `Prophet` 32,501,123 at
9,754) over a ~358k fixed base, against the EVM-standard 200. That agrees to within 5% with the
earlier `eth_call` probe (0 bytes ~454k, 1,000 ~3.58M, 10,000 ~31.7M, a clean 3,125/byte marginal),
so **3,295 is the metered number and 3,125 was close**. `eth_estimateGas` returns exactly **1.50x**
the metered cost on both creations — a flat safety factor, not the both-directions noise measured on
ordinary transactions (fourteen replays, ratios 0.52 to 10.92, median 3.23). **Real receipts meter a
plain transfer at exactly 21,000** (six samples), so calldata and simple compute settle at standard
prices. The seed leg has still never been metered, which is why the total stays pessimistic:
overstating cost hands you more runway than promised, understating it strands a population
mid-season.

### `-g 3000` is mandatory, on BOTH scripts

**`forge script` never asks the chain what a creation costs.** It estimates in local revm, which
charges the standard 200 gas/byte, and applies `-g` (default **130**, i.e. 130%). Against Shannon's
real 3,295 that default is short by **22.7x**.

This is not theoretical. The first attempt at this deploy, without the flag, mined **seven
transactions with `gasUsed == gasLimit` and status `0x0`** — the exact out-of-gas signature, six
independent failures rather than a cascade. `Population` was assigned 9,723,927 gas against the
113,145,022 it needed. It burned **0.0966 STT** and, worse, still wrote `deployments/50312.json`
naming seven addresses that held **zero bytes of code** — poison for `fund.ts`, `Seed.s.sol`, the
cadence and the dashboard, all of which read that file.

So:

```powershell
forge script script/Deploy.s.sol:Deploy --rpc-url somnia --broadcast -g 3000 -vv
forge script script/Seed.s.sol:Seed     --rpc-url somnia --broadcast -g 3000 -vvv
```

`Seed.s.sol` needs it too — `spawnGenesis` creates eight 250-byte `BeaconProxy`, underestimated the
same way.

**The flag is free.** A `gasLimit` is a ceiling, not a charge: unused gas is not billed. The
successful run returned between **1.98x and 6.92x** of every limit unused and still cost 1.0835 STT.
`-g 2500` would also have cleared `Population`, at 1.10x margin; 3000 gives 1.32x and sits 67x under
Shannon's 15,000,000,000 block limit. Only a *failure* burns the whole limit — which is precisely
what the first attempt paid for.

**Do not reach for `--skip-simulation` instead.** It trades a gas problem for blindness: the
simulation against live Shannon state is what catches wrong addresses and preflight reverts for free,
before a wei is spent.

**Always verify code landed, not just that the manifest exists.** The manifest is written by the
script regardless:

```powershell
node -e "const RPC='https://dream-rpc.somnia.network';const m=require('./contracts/deployments/50312.json');(async()=>{for(const k of ['population','populationImpl','prophetBeacon','prophetImpl','priceSource','venue','selectionEngine']){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_getCode',params:[m[k],'latest']})}).then(r=>r.json());console.log(k,m[k],(r.result.length-2)/2);}})();"
```

All seven must report more than 0 bytes. Note also that `broadcast/run-latest.json` **misaligns its
`contractName` column against the real transaction hashes** — the on-chain receipts are the
authority, that column is not.

The 32 STT is a **balance gate, not a spend** — the reactivity precompile refuses `subscribe` while
its owner holds less, exactly (31.9 reverts, 32 returns a subscription id, and `gasLimit` changes
nothing at any balance). You get it back to spend afterwards, which is precisely why the subscribe
step comes *before* prepaying cognition. Skip reactivity entirely and the same 100 STT buys ~223
windows instead of 148 — but then `npm run prove` cannot pass, and the central claim goes unproven.

**Do not run `npm run fund -- --windows 400`** on this budget, whatever any older note says. 400
windows is 8 x 400 x 0.033 = **105.6 STT of prepaid cognition alone**, before a single unit of gas.
The deploy script prints the affordable number; use that or less.

---

## The sequence

### 0. Build, and dry-run against live Shannon

Set the repo root once. Every `cd` in this runbook is relative to it, and `forge script` in
particular insists on `contracts/` as its cwd — see the working-directory table above.

```powershell
$DARWIN = "C:\path\to\your\clone\Darwin"    # wherever you cloned it
```

```powershell
cd $DARWIN
npm run build
```

```powershell
cd $DARWIN\contracts
forge script script/Deploy.s.sol:Deploy --rpc-url somnia -g 3000 -vv
```

Same command as the real deploy, minus `--broadcast`. Forge executes the whole script against live
Shannon state, so this catches wrong addresses, preflight reverts and EVM-spec mismatches for free,
and it is safe to repeat: `_writeManifest` is guarded on `vm.isContext(ScriptDryRun)` and prints
`DRY RUN - manifest NOT written` instead of writing `deployments/50312.json`. Nothing downstream can
be fooled by a dry run.

**Read the `NATIVE STT BUDGET` block it prints and stop here if the warnings fire.** Three are
possible: cannot cover setup, setup fits but the 32 STT floor does not, and under one season of
runway. Each names what to do.

**Check:** the last line is `SIMULATION COMPLETE`. The `contract size limit` line above it is
expected — see [above](#the-contract-size-warning-is-not-a-failure).

### 1. Deploy

```powershell
cd $DARWIN\contracts
forge script script/Deploy.s.sol:Deploy --rpc-url somnia --broadcast -g 3000 -vv
```

Seven creations and two calls, in one broadcast: `Prophet` implementation, `UpgradeableBeacon`,
`PushedPriceSource`, `DreamDEXVenue`, the `Population` implementation, `ERC1967Proxy` with
`initialize` inside it, `SelectionEngine`, then `setWiring` and (if the owner differs from the
deployer) `transferOwnership`.

**Check:** `contracts/deployments/50312.json` now exists and its `population` matches the address in
the `=== DARWIN deployed ===` block. Then read the `NEXT, IN ORDER` block — it prints the live
`cognitionEndowment` and `endowment` off the proxy you just deployed, so its numbers are the real
ones and not this document's.

```powershell
cd $DARWIN
cat contracts\deployments\50312.json
```

**If it fails:** nothing is half-deployed in a way that matters — the addresses are fresh and a
re-run simply deploys again at new addresses. The manifest is the only thing downstream reads, and it
is written last.

### 2. Collateral into Population

```powershell
cd $DARWIN
npm run fund -- --faucet
```

```powershell
npm run fund -- --collateral 100
```

Two lines, not one, deliberately: each `fund.ts` leg is independently wrapped, so a failing faucet no
longer silently skips the legs after it, but running them separately means you *see* the faucet land
before you spend against it. The faucet mints 10,000 tUSDC; `--collateral 100` moves 100 into
`Population`, comfortably over the 80 the eight founders need.

**Check:**

```powershell
npm run fund
```

With no flags `fund.ts` only reports. Its `collateral` line, under the `Population` address, should
read at least 80 tUSDC.

**If it reverts:** `InsufficientCollateral(have, need)` comes from `Seed.s.sol`'s preflight in the
next-but-one step, not from here. `FaucetCapExceeded()` means you asked for more than 10,000 in one
call — ask twice.

### 3. Native STT into Population — the birth float

```powershell
npm run fund -- --house 4
```

**This is a hard floor, not a target.** `spawnGenesis` computes `genomes.length *
cognitionEndowment` and reverts `HouseCannotEndowFounders(got, want)` if `address(this).balance` is
under it — atomically, up front, before any founder exists. Eight founders at 0.33 STT is **2.64
STT**; 4 leaves room for the first child born after that.

The float exists because `_spawn` endows each newborn out of `address(this).balance`. An underfunded
house still bears a child, just brain-dead until someone calls `topUpCognition` — so the floor is
enforced only for the founders, where a brain-dead generation 0 would mean no run at all.

**Check:** `npm run fund` reports its `birth float` line at or above 2.64 STT. The report also warns
explicitly when the float cannot endow eight founders pre-seed, and tells you the `--house` number to
pass.

### 4. Seed generation 0

```powershell
cd $DARWIN\contracts
forge script script/Seed.s.sol:Seed --rpc-url somnia --broadcast -g 3000 -vvv
```

**Do not call `deployGenesisTreasury()` by hand.** `Seed.s.sol` calls it itself, in the same
broadcast, one line before `spawnGenesis`. It is `onlyOwner` and **once ever** — a second call
reverts `TreasuryAlreadySet()`, there is no setter, and no path clears it. Calling it manually first
therefore makes the seed script permanently unrunnable against this `Population`, and the only
recovery is a fresh `Population` deploy.

`NoGenesisTreasury()` is the other side of the same coin: `spawnGenesis` refuses to run while
`genesisTreasury` is zero, rather than defaulting. A founder minted against `address(0)` would be
permanently ownerless *and* permanently unretirable, since `retire` requires `msg.sender ==
entrant`. You only see this error by calling `spawnGenesis` outside this script.

**Check:** `prophetCount()` is 8 and `aliveCount()` is 8 — the two must agree, or something was
minted and reaped. `genesisTreasury()` must also be non-zero now.

```powershell
cd $DARWIN\contracts
$P = (Get-Content ..\contracts\deployments\50312.json | ConvertFrom-Json).population
cast call $P 'prophetCount()(uint256)'     --rpc-url somnia
cast call $P 'aliveCount()(uint256)'       --rpc-url somnia
cast call $P 'genesisTreasury()(address)'  --rpc-url somnia
```

```powershell
cd $DARWIN
npm run fund
```

**If it reverts:** the preflight names the reason before spending anything.

| revert | meaning |
| --- | --- |
| `AlreadySeeded(existing)` | generation 0 exists. Set `ALLOW_RESEED=true` only if you mean it |
| `InsufficientCollateral(have, need)` | go back to step 2 |
| `HouseCannotEndowFounders(got, want)` | go back to step 3 |
| `NoGenomes()` | `genomes/genesis.json` is missing or empty |
| `GenomeNameMismatch(g, n)` | the genomes and names arrays are different lengths |
| `TooManyGenomes(got, max)` | over `maxPopulation` |

### 5. Subscribe the selection engine — while you still hold 32 STT

```powershell
npm run subscribe -- --status
```

```powershell
npm run subscribe -- --create --topic0 0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178
```

**This comes before funding cognition, because it gates on a balance that funding cognition
spends.** The precompile refuses while the owner holds under 32 STT. Prepay 148 windows first and you
can find the gate unsatisfiable with the STT already locked inside eight organisms, recoverable only
by retiring them.

**Pass `--topic0` explicitly. Never take it from `--discover`.** That topic0 is `MarketFinalized`.
`BinarySettlement` emits two events and `--discover` ranks them by frequency, which puts **redeem**
(`0xe31682dd…`, 281 occurrences) above **finalize** (`0xb1884334…`, 130). Subscribing to redeem is
circular — our own redemption is downstream of the settlement we are waiting for, so it never fires
first. The two also land in different transactions: an oracle driver batch-finalizes, and
`finalizeAndRedeem` then only redeems. That separation is what makes the central claim work at all,
because the callback fires in the finalize block and redeems inside that same synthetic transaction.

Do **not** set `REACTIVITY_CALLBACK_SIG`. It exists in `subscribe.ts` as an escape hatch against a
future SDK change, and setting it wrongly is the one remaining way to build a subscription that can
never fire.

**Check:**

```powershell
npm run subscribe -- --status
```

It reports whether reactivity is wired and whether its gas payer is funded.

**If it fails:** an empty revert from the precompile at this step is almost always the balance gate.
Check the signer's STT before looking anywhere else.

### 6. Fund the organisms' thinking

Take the number from step 5 of the deploy script's `NEXT, IN ORDER` output — it is recomputed after
the deploy has spent real gas, and it counts *both* legs of a window (prepaid inference and the
signer's ongoing cadence gas), which sizing against inference alone does not.

```powershell
npm run fund -- --windows 140
```

One `topUpCognition` per **living** organism, so this only works after step 4 — before the seed there
is nobody to top up and it warns instead of acting.

**Overfunding is not a rounding error.** The STT ends up inside the organisms and only `retire` gets
it back. Fund a season, watch it, fund another.

**Check:** `npm run fund` shows each organism's native STT at roughly `windows * 0.033`.

### 7. Start the cadence

```powershell
npm run cadence
```

Leave it running. It is a state machine over `Population.phase()` that **remembers nothing between
iterations** — active market, window number and phase all live on chain — so it can be killed,
restarted, or moved to another machine and it resumes where the population actually is.

In a second terminal:

```powershell
npm run monitor
```

The monitor alerts on the **absence of progress**, not on exceptions, which is the failure mode that
matters: per-organism failures are caught and emitted as `ThinkFailed` / `CommitFailed` /
`SettleFailed` precisely so one bad organism never halts the population, and a population that has
quietly stopped advancing looks identical to a healthy idle one from any single read.

**Do not push a window by hand.** `pushWindow` and `think()` must go back-to-back:
`PushedPriceSource.maxStaleness` is **180 seconds**, so any delay between them makes `think()` revert
`StalePrice(age, limit)`. The cadence does both in one pass, which is why nothing in this runbook
pushes a price.

Two other reverts you may see in the cadence log, both normal rather than broken:

- `NoWindow(symbol)` — no market resolved for the symbol yet. Wait for the next one.
- `MarketNotTradeable()` / `NotTradeable()` — `think` refuses an untradeable window rather than
  opening a position it cannot settle.

### 8. The honesty gates

```powershell
npm run fee
```

```powershell
npm run prove
```

`fee` asserts `settlementFeeBpsTimes1k == 0` on a real finalized market — zero fees are what make
metered cognition the only selection pressure, and if it is non-zero the script computes the fee drag
against the metabolic cost per window and tells you which is actually doing the selecting.

`prove` is the gate for the central claim. It passes only on a `Reacted` event with `viaReactivity ==
true` sharing a block with a real settlement log, and because `BinarySettlement` is a shared
singleton it recovers the marketId and pool *this* population committed to from its own
`WindowOpened` log and requires the settlement log to reference one of them. A coincidence fails.

Until `prove` passes, and while `SelectionEngine.fallbackEnabled` is `true`, the claim you are
licensed to make is *"selection is on-chain and atomic with redemption"* — **not** *"no keeper
anywhere in the causal chain."* Only after `disableFallback()` is the stronger claim true.

---

## Why this order

| step | precondition, enforced where |
| --- | --- |
| 2 before 4 | `Seed.s.sol` preflight reverts `InsufficientCollateral(have, need)` |
| 3 before 4 | `spawnGenesis` reverts `HouseCannotEndowFounders(got, want)`, atomically |
| treasury inside 4 | `spawnGenesis` reverts `NoGenesisTreasury()`; `deployGenesisTreasury` reverts `TreasuryAlreadySet()` on a second call |
| 5 before 6 | not enforced anywhere. **Convention, and the reason is money**: 5 gates on a 32 STT balance that 6 spends into organisms you can only get it back out of by retiring them |
| 4 before 6 | `fund.ts` warns instead of acting — `--windows` tops up living organisms and before the seed there are none |
| cadence, never split | `maxStaleness` 180s between `pushWindow` and `think()`, or `StalePrice` |

---

## Rollback and recovery

Be precise about this, because the three irreversible things are irreversible in different ways.

### Cannot be undone, ever

**Death.** No path anywhere clears `dead` — not the owner, not `Population`, not a beacon upgrade.
The `alive` modifier gates every state transition. This is deliberate and load-bearing: a judge
should be able to grep for an admin recovery path and fail to find one. Do not add one.

**`deployGenesisTreasury()`.** `onlyOwner`, once ever, `TreasuryAlreadySet()` on a second call, no
setter. If it is pointed at the wrong thing, the repair is a fresh `Population`.

**Storage layout, from the moment you deploy.** Append into `__gap` only, shrinking it by exactly the
slots you add. Never reorder, retype, delete, or insert between existing variables. `Population`
slots 13, 18, 21, 23, 26, 33 and 38 have free bytes and `Prophet` slots 0 and 15 do; **do not fill
them** — packing into a partially-used slot changes nothing for a fresh deploy and corrupts nothing
visibly until an organism's counter starts reading someone else's bytes. Read `STORAGE.md` first, and
every change gets a dated changelog row there plus a re-derivation.

**The ancestry graph.** This is the one asset that cannot be rebuilt. Generation, lineage and
treasuries only exist in the deployed contracts' storage. A redeploy resets all of it to generation 0
— and generation, not PnL, is the headline metric.

### Can be repaired without losing lineage

That is exactly why `Prophet` sits behind a beacon and `Population` behind a UUPS proxy: **logic is
repairable mid-run.**

- **An economic parameter is wrong** — `setEconomics`, one `onlyOwner` transaction, no upgrade. Every
  economic parameter lives in `Population` rather than in `Prophet` for this reason.
- **Inference is failing or abstain counts are climbing** — `setInference`, one transaction.
  `perAgentReward` is 0.001 STT, about 3.3x the 0.0003 real traffic pays. Raise it if `ThinkFailed`
  fires; a validator declining the work looks exactly like a silent population. Do not go below
  0.0003, and do not drop `subcommitteeSize` to 1 — `Prophet.sol` requires `agree >= 2` regardless of
  the platform's own tally, so a subcommittee of 1 always abstains.
- **The price source, venue or selection engine is wrong** — `setWiring`. All three are plain,
  non-upgradeable and freely redeployable.
- **A bug in `Prophet`** — one beacon upgrade, all organisms at once, lineage intact.
- **A bug in `Population`** — one UUPS upgrade.

**`setWiring` has no phase guard.** Repoint the venue **only in phase 0, with no position open**, or
you will ask a new venue to settle a position it never issued. And note that nothing tests migrating
a population *across* adapter types — `test_venue_canBeRepointedBetweenWindows` repoints to a fresh
instance of the *same* adapter. Doing it mid-run across types is unsafe.

### Costs nothing

**Pausing.** Metabolism is charged per settled window, not per unit of wall-clock time. A paused
population starves no faster than a running one and resumes with its generation count, lineage and
treasuries intact. Stop the cadence, think, restart it.

---

## If the wallet runs dry mid-run

The failure is visible rather than silent, which is the point of organism-paid cognition: an organism
that cannot afford its deposit abstains, opens an empty position, and pays metabolism anyway. So a
shortfall shows up as **one organism starving** — an event, an `alive` flag, a selection outcome —
rather than as a whole population quietly abstaining when a house paymaster empties.

```powershell
npm run fund -- --windows 20
```

Tops up every living organism again. If the signer itself is out of STT, the cadence stops advancing
and `monitor.ts` says so. The self-serve faucet publishes **1 STT per day**, which cannot fund a
continuous run — the documented path for more is the Somnia team directly (Discord `#dev-chat`
tagging DevRel, or `developers@somnia.foundation` with the project and GitHub). Plan the run around
the STT actually in hand, and use the pause above rather than letting a season die halfway.
