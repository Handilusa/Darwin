# Cognition self-funding: the parent pays for the child's brain

**Date:** 2026-08-31
**Status:** design, awaiting approval
**Scope:** `Population._hatch`, plus the operational alert and docs that describe the house float
**Storage:** no new state variables — not gated by the 2026-09-02 freeze

---

## 1. The one-line problem

Every other cognition bill in this system is paid by whoever benefits from it. One is not:
a newborn's native STT endowment comes out of `address(this).balance` at
`Population.sol:542`, so **an entrant's breeding success is billed to the operator.**

```solidity
// Population._spawn, :542
if (cognitionEndowment > 0 && address(this).balance >= cognitionEndowment) {
    (bool ok,) = p.call{value: cognitionEndowment}("");
    if (!ok) revert TransferFailed();
    emit CognitionFunded(prophets.length, address(this), cognitionEndowment);
}
```

## 2. Why this is not primarily a money argument

At 0.33 STT a birth, the STT is real but small. The argument that decides it is different:

**`generation` is the headline metric** (`CLAUDE.md`, first section). If the house pays for
children, then the number the whole project is judged on is partly a measure of **operator
generosity** rather than of fitness. A population that breeds twelve times has extracted 3.96
STT from the operator, and a run that stops breeding may have stopped because the float ran
dry rather than because the organisms stopped winning. The metric and the funding must not
share a failure mode.

The secondary argument is the one the code already makes for `enter`, at `Population.sol:564`:
a house-funded grant is a farmable faucet. Breeding is harder to farm than entering — it costs
four correct windows — but it is farmable by anyone who can write a genome that wins four
windows, which is exactly the population we want to attract.

## 3. What is already correct — the scope fence

Three of the four cognition paths need no change. Stating them so the change stays small:

| Path | Who pays today | Verdict |
|---|---|---|
| `enter` | the entrant, to the wei (`:586` reverts `CognitionTooSmall`, `:600` forwards the remainder) | correct |
| `think` | the organism, via `Prophet.drawCognition` | correct |
| `_requestMutation` | the parent, same primitive | correct |
| **birth endowment (`_spawn:542`)** | **the house** | **the leak** |
| `spawnGenesis` founders | the house | **correct, and stays** |

Founders stay house-funded on purpose: `spawnGenesis` is `onlyOwner`, runs once, and costs a
fixed `cognitionEndowment × genesisCount` (8 × 0.33 = 2.64 STT). It is not farmable and it does
not grow with success. That is the whole test.

After this change the house float becomes a **fixed, computable, one-time number**: exactly
`cognitionEndowment × genesisCount`, and nothing else ever draws from it. That is a stronger
claim than "bounded" — it is closed-form.

## 4. The change

One function. `Population._hatch`, currently `:1352-1370`:

```solidity
function _hatch(Prophet parent) internal {
    // BOTH affordability checks are READS, and they happen BEFORE the prompt is
    // consumed. A parent that falls short keeps a breeding right it earned over
    // four correct windows and paid for with its own inference; losing it to a
    // temporary shortfall would delete earned fitness. `topUpCognition` and
    // `fundProphet` are then genuine rescues rather than consolation.
    if (address(parent).balance < cognitionEndowment) return;
    if (parent.treasury() < endowment) return;

    string memory childGenome = parent.consumeChildPrompt();
    if (bytes(childGenome).length == 0) return;

    // NATIVE BEFORE COLLATERAL, and the order is load-bearing. `drawCognition` is
    // the only all-or-nothing draw of the two (`Prophet.sol:691` returns 0 rather
    // than sending a partial amount), so taking it first means the one shortfall
    // worth worrying about strands nothing: the collateral has not moved yet.
    //
    // The parent's wei lands in THIS contract's balance, which is exactly the
    // state `enter` arranges with `msg.value` before calling `_spawn` — so the
    // branch at :542 forwards the parent's native, not the house's, with no
    // change to `_spawn` at all. Net effect on the house: zero, exactly.
    if (parent.drawCognition(cognitionEndowment) < cognitionEndowment) return;

    // Reproduction is expensive, as it should be: the parent funds the child out
    // of its own treasury AND out of its own cognition. A survivor that breeds is
    // deliberately more fragile immediately afterwards, in both currencies.
    uint256 taken = parent.stakeOut(address(this), endowment, collateral);
    if (taken < endowment) {
        // Unreachable given the treasury read above and the treasury==balance
        // invariant, and kept anyway: the mutation request and the birth are
        // separate transactions in the live cadence, and an invariant that holds
        // today is not a guarantee for a future venue. BOTH currencies go home —
        // returning here with the cognition still held would charge a parent for
        // a child it never had.
        if (taken > 0) {
            if (!IERC20Like(collateral).transfer(address(parent), taken)) revert TransferFailed();
            parent.fund(taken);
        }
        (bool back,) = address(parent).call{value: cognitionEndowment}("");
        if (!back) revert TransferFailed();
        return;
    }

    _spawn(parent.prophetId(), parent.generation() + 1, childGenome, parent.entrant(), endowment);
}
```

Four properties worth naming:

- **`_spawn` is untouched.** `CLAUDE.md` flags it as one stack slot from the limit; adding a
  parameter is a `stack too deep` risk paid for nothing. The existing `:542` branch already
  does precisely the right thing once the wei is in the balance.
- **Neither failure branch abandons value, and neither reverts *for lack of funds*.** That
  qualifier is load-bearing and the first draft of this spec omitted it: the collateral branch
  does contain `revert TransferFailed()`, twice. The distinction is that an *affordability*
  shortfall always `return`s — reverting there would abort `hatchAll` for every other organism,
  which the repo's first convention forbids — whereas a *transfer that must succeed and does
  not* is a broken token or a broken parent, which is exactly the condition the existing code
  already reverts on at `:1362`. So the collateral branch gains one line (the native goes home
  with the collateral) and the native branch needs nothing, because it runs before anything has
  moved. The first draft also had the two draws in the opposite order and silently stranded the
  parent's collateral in `Population` on a native shortfall; the ordering above is that fix.
- **The guard covers both currencies.** Moving the guard before `consumeChildPrompt` fixes the
  collateral shortfall too — today *that* path also eats the prompt before discovering it
  cannot pay. The approved correction implies both; doing only the native half would leave
  half the bug.
- **`drawCognition` has no `alive` modifier and `stakeOut` does.** Both are safe here:
  `hatchAll:1345` skips dead organisms before calling `_hatch`.

## 5. Consequences that are not obvious

### 5.0 The brain-dead newborn stops being possible at all

This is the strongest property of the change and it is not the one it was designed for. Today
`_spawn:542` is guarded on `address(this).balance >= cognitionEndowment`, so **an underfunded
house bears a child that cannot think** — CLAUDE.md documents that degradation as intended, and
`monitor.ts` exists partly to warn about it.

After the change the house balance at the moment `_spawn` reads it is `houseBefore +
cognitionEndowment`, because `_hatch` has just deposited the parent's draw. That is `>=
cognitionEndowment` **unconditionally, for any `houseBefore` including zero**. So the guard can
no longer fail on a birth-by-breeding:

> Either the parent could pay and the child is born fully funded, or the parent could not pay
> and there is no child. A brain-dead newborn is no longer a reachable state on this path.

The failure mode moves from "a birth silently produces a dud organism" to "a birth does not
happen and the parent keeps its prompt" — an event a monitor can see, and one the parent can
recover from with `topUpCognition`. Founders via `spawnGenesis` remain the only path that can
still produce an unfunded organism, which is the one place the operator is the payer anyway.

### 5.1 Breeding now requires native runway, and founders are the edge case

`cognitionEndowment` stops being only "ten thoughts" and becomes **also the price of a child's
brain**. An organism holding exactly `cognitionEndowment` can think ten times or breed once,
never both.

That has a sharp operational edge: `spawnGenesis` endows each founder with exactly
`cognitionEndowment`, so **a founder that is never topped up can never breed** — it will have
spent some of its 0.33 thinking by the time it qualifies. Generation 0 would sit at generation
0 forever, which is the metric.

This is already handled by the existing runbook, and the change makes it load-bearing rather
than merely prudent:

```bash
npm run fund -- --windows 400     # 400 × 0.033 = 13.2 STT per organism
```

`fund.ts` tops each living organism *up to* a runway, so it is idempotent and it is what makes
reproduction affordable. **The spec's requirement is that `--windows` is documented as a
precondition for reproduction, not just for survival.** `--house 3` stays, and after this
change it is sized once, for founders, and never again.

### 5.2 `monitor.ts` starts crying wolf

`scripts/monitor.ts:175-179` alerts on the house float with *"The next child is born brain-dead
and needs a manual …"*. After this change that is false: the next child is born with the
parent's STT or is not born at all. Left as is, it fires on a healthy population and trains the
operator to ignore it. Two concrete changes:

- **Re-scope the house-float alert to founders.** It is only meaningful before `Seed` runs, and
  the number it should compare against is `cognitionEndowment × genesisCount`, once.
- **Add the alert that is now the true one:** a living organism whose native balance is below
  `cognitionEndowment` **cannot breed even when it qualifies**. `monitor.ts` already reads every
  organism's native balance for the *"STT held"* line, so this needs no new ABI fragment — it is
  a threshold on a number the script already has.

### 5.3 `CognitionFunded.from` will name the wrong payer

`_spawn:545` emits `from == address(this)` unconditionally. After this change a birth's wei
came from the parent, so a naive sum over `CognitionFunded` misattributes it to the operator.
Rather than emit a second event (which double-counts in any naive sum), the payer stays
**derivable from the pair of events in the same transaction**, since `Spawned` carries
`parentId` and `_spawn` records `entrant`:

| `Spawned.parentId` | `Prophet.entrant()` | payer |
|---|---|---|
| `> 0` | inherited from parent | **the parent** |
| `0` | `== owner()` | the house (`spawnGenesis`) |
| `0` | `!= owner()` | the entrant (`enter`) |

So "operator STT spent this season" is computable exactly, and it is a fixed 2.64. Rendering it
on `/arena/` is **out of scope here** and belongs to P3 — noted so the derivation rule is
recorded where the mechanism is.

### 5.4 Three comments and five docs become false

Not cosmetic: each one is a claim a judge can check.

- `Population.sol:1779` — `receive()`'s comment (*"Keep it above `cognitionEndowment` or
  children are born brain-dead"*) is true only of founders after this.
- `Population.sol:535-541` — `_spawn`'s comment says "the house stakes it enough native".
- `CLAUDE.md:147-149`, `README.md:274`, `docs/SESSION_CHECKPOINT.md:924` and `:1168`,
  `STORAGE.md:230`'s description of `cognitionEndowment`, and `scripts/fund.ts:8, 20, 151, 165,
  249`.

## 6. The five assertions

New tests in `contracts/test/Darwin.t.sol`, following the naming already there
(`test_cognition_*`). Each is listed with **how it fails**, because an assertion that cannot
fail is not evidence — and each must be confirmed to fail by perturbation, not by inspection.

1. **`test_cognition_brokeParentDoesNotBreedAndKeepsItsPrompt`** — a parent with collateral
   surplus and streak, whose mutated genome has already landed, drained with
   `vm.deal(parent, 0)` **after** `pendingChildPrompt()` is set and before `hatchAll`:
   `prophetCount` unchanged and `pendingChildPrompt()` **still set**.
   **Vacuity guard, mandatory:** assert `bytes(parent.pendingChildPrompt()).length > 0` *before*
   the drain. Without it, "prophetCount unchanged" is also what a parent that never had a prompt
   produces, and the test passes for the wrong reason. This is not hypothetical bookkeeping —
   `test_cognition_unaffordableBreedingIsSkippedNotFatal:987-992` carries a comment recording
   that this exact class of vacuity bit this suite once ("It did once").
   *Not a duplicate of that test*, which drains before `_settle` and therefore blocks the
   **mutation request** — it never reaches a birth. This one drains after the prompt exists and
   blocks the **birth**. Two different stages, two different currencies of failure; the existing
   test's `assertEq(pendingMutationRequestId, 0)` cannot see this bug.
   *Fails today:* today it breeds (the house pays), so the `prophetCount` assertion fails on
   current code. *Fails on a wrong fix:* if the guard sits after `consumeChildPrompt`, the
   prompt assertion fails.

2. **`test_cognition_toppedUpParentBreedsOnTheNextHatch`** — same parent, then a stranger calls
   `topUpCognition{value: cognitionEndowment}`, then `hatchAll` again: the child is born.
   *Fails:* if the guard consumed the prompt in step 1, there is nothing left to hatch. This is
   the assertion that proves the rescue is real rather than rhetorical.
   Note the top-up is **exactly** `cognitionEndowment` on purpose: the guard is `<`, and
   `drawCognition`'s check is `amount > balance`, so exact equality must pass both. A test that
   tops up generously would not pin the boundary.

3. **`test_cognition_birthDoesNotTouchTheHouseFloat`** — `address(population).balance` is
   **unchanged** across a `hatchAll` that bears a child.
   *Fails today:* the balance drops by exactly `cognitionEndowment`. This is the anti-subsidy
   assertion, and it is the sibling of the existing
   `test_cognition_breedingIsPaidByTheParent:972`, which asserts the same property across
   `settleAll` (the mutation inference) but **not** across `hatchAll` (the birth) — confirmed by
   reading `_settle():203-206`, which calls `settleAll()` and nothing else. So this is genuinely
   new coverage, not a restatement.
   **Bracket `hatchAll` alone.** Measuring across a settle-then-hatch sequence makes the
   assertion unsound in both directions: a settlement draws think and mutation deposits *into*
   the house balance, and a failed inference leaves the deposit there as `CognitionUnspent`
   residue (`Population.sol:1331`). Snapshot immediately before `population.hatchAll()` and
   immediately after.

4. **`test_cognition_childIsBornWithTheParentsSTT`** — child balance `== cognitionEndowment`
   **and** the parent's native fell by exactly `cognitionEndowment`, both measured across
   `hatchAll` alone for the same reason as #3.
   The two halves are not equally informative and the test should say so: **the child-balance
   half passes on today's code too** (today the house funds it to the same figure), so the
   *parent-side* half is the new evidence and the child-side half is what stops the fix from
   being "just delete the endowment". Distinct from #3: #3 proves the house did not pay, #4
   proves the child was actually funded rather than born brain-dead.
   *Fails:* on any partial-draw or double-draw mistake.

5. **`test_cognition_genesisFoundersAreStillHouseFunded`** — after `spawnGenesis`, each
   founder's balance is `cognitionEndowment` and the house float fell by
   `cognitionEndowment × n`.
   **This one is a regression guard, not evidence of the change, and calling it evidence would
   be an overclaim.** It passes on today's code *and* on the correct fix — that is the point of
   it. It also would not catch the wrong fix the first draft of this spec claimed it would: an
   implementation that drew from a parent inside `_spawn` would still leave `parentId == 0`
   genesis house-funded, so #5 would pass on it. Assertion #3 is what catches that.
   *Confirmed failure mode, by perturbation:* delete the `:542` branch outright — founders are
   then born with zero native and the house float does not move. That is the regression it
   exists to prevent, and it is the assertion that pins the scope fence in §3.

### Existing tests: expected impact

Checked by arithmetic against the harness's own parameters, to be confirmed by running.

**The deposit in tests is not the deposit in production, and the spec's first draft got this
wrong by 3×.** `Mocks.sol:369` set `depositFloor = 0.03 ether` at the time of this spec and returns
`depositFloor × subcommitteeSize` from `getAdvancedRequestDeposit`, so in the suite:

```
requestDeposit() = (0.03 x 3) + (0.001 x 3) = 0.093 STT per inference
```

against the **measured live** figure of `0.033` (`0.01 x 3 + 0.001 x 3`, CLAUDE.md's table). The
harness is therefore ~2.8x pessimistic on cognition cost, and `_fundCognition`'s 1 ether buys
about **ten test inferences**, not thirty. Every number below is the harness's, not production's.

- `test_breeding_mutatesAndInheritsGeneration:1550` is **the only existing test that reaches the
  new guard** (the other two never call `hatchAll`). It runs `breedStreak = 4` winning windows,
  each `_runWinningWindow():1963` firing exactly one `think()`, plus the mutation request drawn
  at the fourth settlement — **five draws, 0.465 STT**. The parent enters with 1 ether
  (`_fundCognition:185`), so it faces the guard holding **0.535 vs the 0.33 required**. It
  passes, with about **two draws of headroom**.
- **The ceiling, stated so a future test author does not trip it silently:** the fixture
  tolerates **seven** inference draws before a birth (0.651, leaving 0.349). **Eight breaks it**
  (0.744, leaving 0.256 < 0.33) and the symptom would be a birth that silently does not happen.
  Any test that lengthens the run before breeding must raise `_fundCognition`'s 1 ether.
- `test_cognition_breedingIsPaidByTheParent:961` and
  `test_cognition_unaffordableBreedingIsSkippedNotFatal:978` both stop at `_settle()` and never
  call `hatchAll`, so the new guard is not on their path at all. Unaffected regardless of
  funding.
- `test_breeding_respectsMaxPopulation:1621` sets `maxPopulation = 2` on a `_seed(2)` population,
  so `hatchAll:1347` breaks before `_hatch` is ever entered. Confirmed independent of this change.
- `test_cognition_freshDeployIsNotBornBrainDead:952` is a `view` comparison over
  `cognitionEndowment` and `requestDeposit()` and is untouched.
- The collateral assertions in the breeding test — `child.treasury() == endowment`,
  `parent.treasury() == before - endowment`, and both `_assertLedgerMatchesBalance` calls — are
  untouched by design: P1 changes no collateral flow, only native.

**If `test_breeding_mutatesAndInheritsGeneration` does fail, the fixture is the suspect, not the
design** — the arithmetic above says it passes with two draws to spare, so a failure means one of
those numbers is wrong, and the first thing to print is the parent's native balance immediately
before `hatchAll`. A fixture change must then be argued rather than made silently, and it cuts
both ways: `_fundCognition`'s 1 ether is what makes that test representative of a *funded*
organism, so raising it to buy headroom also weakens its claim to be one.

## 7. What this does not change

- No new storage. No `__gap` slot, no `STORAGE.md` changelog entry required — but the layout
  re-derivation in `CLAUDE.md` is still mandatory after any `contracts/src/*.sol` edit, and its
  result (expected: zero discrepancies) goes in the commit message.
- No new economic parameter, so no `setEconomics`/`setSeason` field and no ABI change for
  `scripts/lib/darwin.ts`.
- No change to `enter`, `think`, `_requestMutation`, `spawnGenesis`, `topUpCognition`, or any
  venue.
- `maxPopulation`, the breeding eligibility rules, and death remain exactly as they are.

## 8. Verification

```bash
export PATH="$HOME/.foundry/bin:$PATH"
npm run build
forge test --root contracts --match-test 'test_cognition_*' -vv
forge test --root contracts --match-test 'test_breeding_*' -vv
npm run test                       # all 98 + 5

# required after any contracts/src change
forge clean --root contracts
forge build --root contracts --extra-output storageLayout
forge inspect Population storage-layout --root contracts   # diff against STORAGE.md
```

Note for this machine: forge's lints go to stderr, so PowerShell reports a clean build as exit
1 — read the output, do not chain on `$?`.

## 9. Adversarial review: what was attacked and survived

Recorded so none of it is re-litigated during implementation, and so a reader can see which
claims rest on reading the source rather than on running it. Seven axes; five findings, all
folded in above. What follows is what produced **no** finding.

- **`_hatch` has exactly one caller.** `hatchAll:1348`, and nothing else in the tree reaches it.
  That caller filters in the right order: `p.dead()` → `continue` (`:1345`), empty prompt →
  `continue` (`:1346`), cap → `break` (`:1347`). Two consequences the design leans on are
  therefore sound rather than lucky: `drawCognition`'s **missing `alive` modifier** cannot be
  reached with a dead parent, and `_spawn:502`'s `PopulationFull()` revert is unreachable from a
  birth, because `living.length` cannot change between `:1347` and `_spawn` inside one iteration.
- **No reentrancy surface is added.** Both `receive()` bodies are empty — `Population.sol:1501`
  and `Prophet.sol:626` — so neither the draw nor the refund hands control to anything. The only
  way to obtain a hostile `Prophet.receive()` is a beacon upgrade, which is `onlyOwner` and sits
  behind the same authority as `_authorizeUpgrade` and `setEconomics`; an owner who wants to
  break the population has shorter paths. Worth one line in the implementation comment and no
  code.
- **`cognitionEndowment == 0` degrades correctly, checked opcode by opcode.** `balance < 0` is
  never true so the guard passes; `drawCognition(0)` takes `amount > balance` as false, sets
  `sent = 0`, skips the transfer and returns `0`; the comparison `0 < 0` is false so `_hatch`
  does **not** early-return; `_spawn:542`'s `cognitionEndowment > 0` then skips the funding.
  Net effect zero and no spurious skipped birth. (The constructor comment at `:349-360` argues a
  zero must never be *configured*; this is about not adding a second failure mode if one is.)
- **Stack depth at the `_spawn` call site is unchanged.** The live locals there are `parent`,
  `childGenome` and `taken` — exactly today's three. The two pre-read temporaries die before
  `consumeChildPrompt`, `drawCognition`'s return is consumed inline by the comparison, and
  `bool back` lives only inside a branch that returns. So `CLAUDE.md`'s "one slot from the limit"
  warning about `_spawn` is not tightened by this change. The residual risk is not the frame but
  `via_ir`'s **inlining decisions** — a new external call in `_hatch` can shift them. If
  `stack too deep` does appear, the cheapest fix is extracting the two pre-reads into an
  `internal view` helper, which moves them into their own frame; **do not do this pre-emptively**,
  because an extra frame is a cost paid for a compile error that has not happened.
- **Gas is not the binding constraint.** `_spawn` deploys a `BeaconProxy` per birth, which
  dominates; the three added external calls are noise beside it, and `maxPopulation = 24` already
  sets the ceiling for a worst-case `hatchAll`. No change to the bound.
- **`Prophet.fund` is `onlyPopulation` with no `alive` modifier** (`Prophet.sol:664`), so the
  refund branch is callable exactly where it needs to be.
- **Reverts inside `_spawn` are safe by construction.** If anything past the two draws reverts,
  the whole `hatchAll` transaction rolls back and the parent's payment rolls back with it. Value
  can only be stranded on a `return` path, which is why every `return` after a draw is the thing
  §4 audits line by line.

## 10. Open question, deliberately not answered here

The requester's deadline for this work was left as an unfilled placeholder. The dates on record
are the storage freeze (**2026-09-02**) and submission (**2026-09-08**). This change takes no
storage slot, so the freeze does not bind it — but the **deploy** does, because after Season 0
is live a `_hatch` change is a UUPS upgrade against a running lineage rather than an edit. The
working assumption is therefore **complete before the deploy**, and it needs confirming rather
than inferring.
