# Genesis Treasury, and a season that actually closes

**Date:** 2026-09-05
**Status:** design, awaiting approval
**Scope:** `Population` (one new slot, three new functions, two literals, one guard), one new
non-upgradeable contract, `cadence.ts` season fixtures, `web/js/fixture.js`, four docs
**Storage:** **one new slot** — `genesisTreasury` at 38, `__gap` shrinks `uint256[9]` →
`uint256[8]`. Permitted: the 2026-09-02 freeze governs changes *after* the deploy, and nothing
is deployed yet. Logged in `STORAGE.md` either way.
**Decides:** N1 and N2 of `bugs_jueves.txt`, both of them operator decisions rather than
maintenance edits.

---

## 1. The two problems, in one line each

**N1.** `spawnGenesis` (`Population.sol:526`) passes `msg.sender` as the founders' `entrant`, and
it is `onlyOwner` — so the eight genesis organisms belong to the operator's EOA, and a founder in
the top three pays **60% of the players' pot to that EOA out of `prizePool`, without touching
`rakeAccrued`** and therefore outside `withdrawRake`'s `RakeExceeded` cap. Measured, not inferred:
a 42,500 pot paid the owner 25,500 with `rakeAccrued` unmoved.

**N2.** `seasonWindows = 576` (`:411`) is ~6 days at the 15-minute cadence. `Deploy.s.sol` never
calls `setSeason`, so a deploy this weekend closes season 1 around 2026-09-12 — four days after
submission. `SeasonEnded` and `SeasonPrizePaid` never emit, and the entire season/prize/ante
subsystem ships as code that has never run.

Both are decided here as **permanent product design**, not as a submission maneuver. The
rejected fourth option for N2 — lowering `seasonWindows` before submission and restoring it after
— is rejected on the record: it is the kind of thing this contract's own guards exist to prevent,
and a judge who spots it costs more credibility than the season close buys.

---

## 2. N1 — why a contract and not a signature change

The obvious minimal fix is to change one argument at `:526`. Three candidates for what it becomes:

### (a) `address(0)` — founders have no owner

**Rejected**, on two coupled consequences that make it worse than the bug:

- `_hatch` propagates `parent.entrant()` (`:1531`), so the **entire founder lineage** is ownerless.
  `_topThree` scores **lifetime** `correctCount - wrongCount` and the founders have the longest
  records, so the ownerless lineage leads the standings that pay while its share rolls over
  forever. The pot grows and never pays.
- `retire` requires `msg.sender == p.entrant()` (`:942`). An ownerless founder can **never** be
  retired, and its collateral plus unspent cognition is unrecoverable by anyone.

### (b) A second EOA

**Rejected.** It is the same object under another name. Nothing distinguishes it from the
operator's main wallet on an explorer, so there is nothing to verify. It converts an auditable
finding into an unauditable claim, which is strictly worse.

### (c) A `GenesisTreasury` contract — **chosen**

The reference is Hyperliquid's HLP: the protocol's own market-making capital and its P&L live in a
separate, publicly visible vault, so the house demonstrably has skin in the game without the
operator paying themselves outside the rules. Adapted rather than copied — DARWIN's house position
is eight organisms, not a market maker, and the vault's only outlet is the players' prize pool.

**Why the "no new storage" version of this does not get there.** Passing the treasury address as a
`spawnGenesis` argument avoids a slot, but then nobody can check *afterwards* who the founders pay
— it would have to be reconstructed from the calldata of one historical transaction. A public slot
makes it **one `eth_call`**, which is the whole point of the exercise. The slot costs nothing
before the first deploy.

### The property being bought

A reader with the explorer open can establish, in four reads and about forty seconds:

1. `Population.genesisTreasury()` → an address that is **not** the owner.
2. That address's code is `GenesisTreasury`, ~45 lines, **no owner, no withdraw, no arbitrary
   call, no `upgradeTo`, no `receive`**.
3. Its only state-changing function is `recycle()`, which is permissionless and sends the balance
   into `Population.donatePrizePool`.
4. `Population.sweep`'s collateral leg cannot reach `prizePool` (§4.5).

Point 4 is not optional. Without it, 1–3 are decorative.

---

## 3. N2 — why 24/4, and why six levels rather than eight

The pattern is Kalshi's and Polymarket's: many short repeated cycles instead of one long one. The
brief cited the 144/18 row. It does not survive contact with the budget:

| Row | Season length | STT per season, 8 organisms | Closes before 2026-09-08? |
|---|---|---|---|
| 576/72 (shipped) | ~6 days | 152 | No — ~4 days late |
| 144/18 (as briefed) | 36 h | 38 | One close, no margin |
| **24/4 (chosen)** | **6 h** | **6.3** | **Two closes, with margin** |
| 12/2 (considered) | 3 h | 3.2 | Two closes, less to show |

Cost basis: 0.033 STT per organism-window (`3 × (0.01 + 0.001)`, measured 2026-08-29 and
corroborated against live traffic at 0.0309), times `seasonWindows`, times the living population.
The collateral side is free — Shannon's tUSDC faucet is permissionless with no cooldown — so
**STT is the only budget that constrains season length.**

### Six levels, not eight — the mortality coupling

`seasonWindows / levelWindows` is the number of ante levels, and `anteMultBps = 20_000` doubles at
each one. 24/4 gives **six levels, indexed 0 through 5**, so the last level anything actually
trades under is 5 and the season closes at a **32× ante: 0.25 → 8 tUSDC**. Level 6 begins on
window 24, the first window that satisfies `endSeason`'s `>= seasonWindows`, so no pairing is ever
made at it unless the close is late. (Same structure as the shipped comment at `:406-410`, which
is why that comment is rewritten rather than deleted.)

Eight levels at this cadence would close at 128× — a 32 tUSDC ante against a 10 tUSDC endowment,
3.2× the whole treasury. `_pair` clamps both legs to the poorer treasury, so every late window
becomes all-in; `_topThree` skips the dead; and the season reaches its close with nobody to pay.
That is the exact failure the audit predicted from compressing `levelWindows`. At 32×, the final
ante is 8 tUSDC against 10 — genuinely lethal, survivable with winnings, and the first five hours
(0.25 → 4) are a real climate rather than a cull.

### The property that makes short seasons more than a demo trick

**A rolled-over pot stops being a failure.** `endSeason` already rolls any share it cannot pay
(`:854-855`). At 576 windows that means the pot is stranded for six days. At 24 it means the pot
is stranded for six hours, into a season that is already running. The short cadence does not just
make the close *visible* — it makes the close's only failure mode *harmless*. That is the argument
for adopting it permanently, and it is independent of the submission date.

### What is deliberately not changed

`cognitionEndowment` stays at **0.33 STT** (ten windows). Setting it to 0.8 (one full season)
is a tidier invariant and was rejected: `_hatch` draws a newborn's cognition out of the **parent**
(`drawCognition`), so at 0.8 a parent mid-season would usually be unable to fund a child and
"born brain-dead" would go from documented exception to common case. A season's cognition is
supplied by `npm run fund -- --windows 24`, which is already the documented flow. Side benefit
under budget uncertainty: season length and cognition budget stay independently tunable, and the
STT is spent incrementally rather than committed at spawn.

`anteMultBps` stays at 20_000 and `baseAnte` at 250_000. The doubling is the mechanism; only the
calendar moves.

---

## 4. The change

### 4.1 New file: `contracts/src/GenesisTreasury.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20Like} from "./interfaces/IDreamDEX.sol";

interface IArenaBooks {
    function collateral() external view returns (address);
    function donatePrizePool(uint256 amount) external;
}

/**
 *  The house's own position, held where anyone can see it.
 *
 *  The eight genesis organisms are the protocol's seed position, not the operator's
 *  private stake, so their prize money is paid HERE rather than to the deployer's
 *  EOA. This contract has no owner, no withdrawal, no arbitrary call and no upgrade
 *  path: the only thing that can be done with the collateral it accumulates is push
 *  it back into the players' prize pool, and anyone may do it.
 *
 *  Deliberately has no `receive()`. Nothing in `Population` sends native to an
 *  `entrant` — the only native transfers are `retire` (to `msg.sender`, and a
 *  founder can never be retired) and `sweep` (owner-directed) — so refusing native
 *  costs nothing and removes a balance with no outlet.
 *
 *  `collateral` is READ FROM THE ARENA at call time rather than stored as an
 *  immutable, so a `setWiring` repoint cannot strand this contract holding a token
 *  it has no code path for.
 */
contract GenesisTreasury {
    address public immutable arena;
    uint256 public totalRecycled;

    event Recycled(address indexed caller, uint256 amount);

    error ZeroArena();
    error NothingToRecycle();
    error ApprovalFailed();

    constructor(address arena_) {
        if (arena_ == address(0)) revert ZeroArena();
        arena = arena_;
    }

    function collateral() external view returns (address) {
        return IArenaBooks(arena).collateral();
    }

    /// @dev Permissionless by design. There is no privileged caller because there is
    ///      no privileged destination: the funds can only go one place.
    function recycle() external returns (uint256 amount) {
        address token = IArenaBooks(arena).collateral();
        amount = IERC20Like(token).balanceOf(address(this));
        if (amount == 0) revert NothingToRecycle();
        if (!IERC20Like(token).approve(arena, amount)) revert ApprovalFailed();
        IArenaBooks(arena).donatePrizePool(amount);
        totalRecycled += amount;
        emit Recycled(msg.sender, amount);
    }
}
```

`totalRecycled` exists so the frontend reads a number instead of replaying events. It is the one
concession to convenience in the file and it is one `SSTORE`.

### 4.2 `Population` — the slot

At `:212`, `uint256[9] private __gap;` becomes:

```solidity
/// @dev Where the eight founders' prize money goes. Not the owner's EOA: see
///      `spawnGenesis` and
///      `docs/superpowers/specs/2026-09-05-genesis-treasury-and-season-cadence-design.md`. Zero until
///      `deployGenesisTreasury()` runs, and `spawnGenesis` refuses to run while it
///      is zero — a founder minted against a zero treasury would be permanently
///      ownerless and permanently unretirable.
address public genesisTreasury;

uint256[8] private __gap;
```

**Slot 38, alone, 20/32 bytes used.** The twelve spare bytes are spare and stay spare — the same
rule that applies to slots 13, 18, 21, 23, 26 and `Prophet` 0 and 15. `__gap` now spans 39–46.
`Population` goes from 48 declarations to 49.

### 4.3 `Population` — the factory

New `onlyOwner` function, placed next to `spawnGenesis`:

```solidity
function deployGenesisTreasury() external onlyOwner returns (address t) {
    if (genesisTreasury != address(0)) revert TreasuryAlreadySet();
    t = address(new GenesisTreasury(address(this)));
    genesisTreasury = t;
    emit GenesisTreasuryDeployed(t);
}
```

**A factory, not a setter, for three reasons.** `contracts/script/` is permission-denied to Claude
sessions, so a setter would mean hand-editing `Seed.s.sol` at deploy time with a copied address —
the highest-risk possible moment for a manual step. The factory makes provenance on-chain: the
arena created its own treasury, so it cannot be a wallet dressed up as one. And there is no
setter to point at an EOA later, which removes a question a reader would otherwise have to answer
by reading access control.

There is deliberately **no** `setGenesisTreasury`. Note that a setter would in any case not
redirect existing founders — `entrant` is written exactly once ever, in `Prophet.initialize` — so
its only effect would be on future `spawnGenesis` calls. YAGNI plus one less rug vector.

### 4.4 `Population` — `spawnGenesis` and `donatePrizePool`

`:526-530` becomes:

```solidity
function spawnGenesis(string[] calldata genomes) external payable onlyOwner {
    if (genesisTreasury == address(0)) revert NoGenesisTreasury();
    for (uint256 i; i < genomes.length; ++i) {
        _spawn(0, 0, genomes[i], genesisTreasury, endowment, address(this), _houseCognition());
    }
}
```

**The `SLOAD` stays inside the loop and is not cached in a local.** `_spawn`'s prophet id is
documented as deliberately not a local because the Yul optimizer inlines `_spawn` into this loop
and one more local pushes it over the stack limit. A cached `address` here is exactly that local.
Reading the slot per iteration costs 100 gas warm and cannot fail to compile. **This must be
confirmed by the compiler, not by argument** — see §8.

New external function, placed after `withdrawRake` (`:803`) so the two books stay adjacent:

```solidity
/// @dev The only way collateral enters the players' book from outside. `rakeAccrued`
///      is untouched, so this can never become a house withdrawal path in reverse.
///      Permissionless: a pot anyone may add to is not a pot anyone may take from.
function donatePrizePool(uint256 amount) external {
    if (amount == 0) revert ZeroAmount();
    if (!IERC20Like(collateral).transferFrom(msg.sender, address(this), amount)) {
        revert TransferFailed();
    }
    prizePool += amount;
    emit PrizePoolFunded(msg.sender, amount);
}
```

Before this, `prizePool` had four write sites and **no funding path** (`:796`, `:862`, `:1368`,
plus the read in `endSeason`). This is the fifth and the first inbound one.

### 4.5 `Population` — the `sweep` cap

`sweep` (`:1683`) is `onlyOwner`, takes an arbitrary amount, and does not subtract the two books
from what it may move. So the owner can drain `prizePool` with it, bypassing `RakeExceeded`
entirely. This is already pinned as a known finding in
`test_sweep_canOverdrawTheBooksAndStrandTheSeason` (`Darwin.t.sol:3676`), whose comment argues
against a guard because *"`sweep` is the documented remedy for stranded cognition and a
book-aware cap would block the recovery it exists for."*

**That argument generalises one step too far, and the over-reach is checkable.** Stranded
cognition is **native** — `CognitionUnspent` is a native amount, and the documented remedy is
`sweep(address(0), organism, amount)`. The remedy lives entirely in the `token == address(0)` leg.
Capping **only the collateral leg** therefore preserves it exactly:

```solidity
function sweep(address token, address to, uint256 amount) external onlyOwner {
    if (token == address(0)) {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    } else {
        // The two books are claims on this contract's collateral balance. Native is
        // NOT capped, because `sweep(address(0), …)` is the documented
        // `CognitionUnspent` remedy and a cap would block it. That leaves the native
        // leg operator-trusted rather than guaranteed — part of this balance is owed
        // to organisms and nothing on chain separates it from the birth float. See
        // the note in `Population.sweep` as shipped.
        if (token == collateral) {
            uint256 reserved = rakeAccrued + prizePool;
            uint256 held = IERC20Like(token).balanceOf(address(this));
            if (held < reserved || amount > held - reserved) revert BooksReserved();
        }
        if (!IERC20Like(token).transfer(to, amount)) revert TransferFailed();
    }
}
```

Without this, §2's point 3 is worthless: a reader who greps `onlyOwner` finds a path from the
players' pot to the operator, and the Genesis Treasury reads as theatre.

Note the second-order gain: this also removes the state
`test_sweep_canOverdrawTheBooksAndStrandTheSeason` documents, in which `endSeason` reverts on
`TransferFailed` forever and `seasonId` never advances again.

### 4.6 `Population` — errors, events, comment

Appended after `BadSeason` (`:295`): `NoGenesisTreasury()`, `TreasuryAlreadySet()`,
`BooksReserved()`, `ZeroAmount()`. Appended to the events block:
`GenesisTreasuryDeployed(address indexed treasury)`, `PrizePoolFunded(address indexed from,
uint256 amount)`. `GenesisTreasury` declares its own three errors; nothing is shared between the
two files except `IERC20Like`, and `Population` imports the new contract as
`import {GenesisTreasury} from "./GenesisTreasury.sol";` — a named import, so
`GenesisTreasury.sol`'s file-scope `IArenaBooks` interface does not enter `Population`'s scope and
there is no import cycle (`GenesisTreasury` never imports `Population`).

`endSeason`'s comment at `:850-853` currently says *"A founder has no entrant. Its winnings roll
over rather than being swept."* That has been false in production since `spawnGenesis` was
written. It becomes a description of what the guard is actually for:

```solidity
// `to == address(0)` is not reachable for any organism minted by `spawnGenesis` or
// `enter` — founders pay `genesisTreasury` and entrants pay themselves. The guard
// stays because `endSeason` must not be able to revert on a single unpayable
// winner: a share it cannot deliver rolls into the next season's pot, which at a
// 24-window season is six hours away.
```

### 4.7 `Population` — the two N2 literals

`:405` and `:411`, with the comment block at `:406-410` rewritten:

```solidity
levelWindows = 4; // 1 h at the 15-minute cadence
// 6 h. 24/4 = 6 levels, INDEXED 0 THROUGH 5, so the last level an organism
// actually trades under is 5 and the season closes at a 32x ante (0.25 -> 8
// tUSDC, against a 10 tUSDC endowment). Level 6 begins on window 24 — the very
// window that first satisfies `endSeason`'s `>= seasonWindows` — so no pairing
// is ever made at it unless the close is late.
//
// SHORT AND REPEATED IS THE PRODUCT, not a demo setting: four seasons a day,
// and a share `endSeason` cannot pay rolls into a pot six hours away instead of
// six days away. Eight levels at this cadence would close at a 32 tUSDC ante
// against a 10 tUSDC endowment, and `_topThree` skips the dead.
seasonWindows = 24;
```

---

## 5. Consequences that are not obvious

### 5.1 Founders can never be retired, and that is the design

`retire` requires `msg.sender == p.entrant()` (`:942`) and `GenesisTreasury` has no path to
`Population.retire`. So the eight founders — and, through `_hatch`'s propagation at `:1531`, their
whole lineage — are permanently unretirable. **8 × 10 tUSDC of house collateral is committed for
the life of the arena.**

This is the correct outcome and it is the HLP parallel done honestly: HLP's capital is not
withdrawable at the operator's convenience either. The arena's own organisms leave the arena the
same way every other organism does — by dying. And death is not a leak: an organism dies at zero
treasury, so nothing is stranded on the way out.

A `retireFounder(uint256)` on the treasury was considered and cut. Permissionless it is griefing
(anyone kills the house's position); owner-gated it is safe but the native STT that `retire`
returns would land in a contract with no native outlet, which would mean either a `receive()` plus
a `topUpCognition` forwarding path or stranded funds. Forty-five auditable lines with one outlet
is worth more than a recovery path for testnet collateral.

### 5.2 The house crowds the arena only until it starts losing

`maxPopulation = 24`. A founder lineage that cannot retire and keeps breeding could occupy most of
those slots and lock paying entrants out with `PopulationFull`. The mitigation is already in the
mechanics rather than in new code: slots are freed by **death** (`_removeLiving`), not by
retirement, and the ante ladder guarantees deaths — by level 5 the ante is 80% of a full
endowment. Worth stating in the README; not worth code.

### 5.3 `CognitionFunded.from` and `endSeason`'s payee now disagree about who the house is

Nothing breaks, but two log streams change meaning. `spawnGenesis` still funds founder cognition
from `address(this)` (the house float, the operator's STT), while founder *prizes* now go to the
treasury. That is intentional and worth one sentence in the README: **the operator pays for the
house's thinking and does not collect the house's winnings.**

### 5.4 `monitor.ts` alert 7b becomes unreachable, and stays

Alert 7b's predicate is `pool + rake > coll`, which was reachable exactly through the sweep hole.
With §4.5 it should be unreachable. **The alert stays.** Deleting a detector because an invariant
now holds is how you lose the detector that would have caught the invariant breaking.

### 5.5 Copy that becomes false

- `cadence.ts:1074` — operator/`address(0)` copy about founders.
- `cadence.ts:1336-1337` (cited here as `:552`, `:896`, `:904-922`, which is where those rows sat
  on 2026-09-05) — **Done, and the line references were refreshed 2026-09-07 by `cite:check` after
  the predicate moved out of this file.** The instruction was carried out but not the way it is
  written above: `seasonIsOver` now lives in `scripts/lib/season.ts` and `cadence.ts` only
  re-exports it (`:865`) and drives the fixture table (`:1359`). The table was rebuilt around the
  shipped 24 — `initialize`'s own default, with paired false/true controls on each boundary — and
  **two `576` rows were kept on purpose**, labelled *"the old default's boundary"*. That is the
  opposite of stale copy: `setSeason` can still configure a long season, and a predicate exercised
  at only one magnitude is a predicate that was tuned to it.
- `web/js/fixture.js:70-72` — comments explaining that the shipped 576 *"can never show a close"*.
  **Corrected 2026-09-05, after checking the file rather than the comment: only the comment
  changes, and the fixture keeps `seasonWindows: 42` / `levelWindows: 12`.** The original
  instruction here — make the fixture 24/4 "so the demo and the deployment describe the same
  climate" — is built on a false premise. The fixture already runs a **deliberately different
  economy**, not merely a different calendar: `endowment: 40 tUSDC` against the contract's 10,
  `baseAnte: 2` against 0.25, `anteMultBps: 12_500` (1.25×) against 20_000 (2×),
  `metabolicCost: 0.25` against 0.05. Matching two of those fields would not make the climates
  agree, and it would break three things that are derived from the pair: `windowCount: 41n` with
  `seasonStartWindow: 0n` is a legal mid-season state at 42 and an **illegal** one at 24 (17
  windows past a close the contract would not have left standing — the fixture's own comment
  forbids exactly that); `level: 3` / `ante: 3_906_250n` (`:215`, `:224`) are `(41-0)/12` and
  `2 × 1.25³`, and at `levelWindows: 4` become level 10 and an 18.6 tUSDC ante — larger than five
  of the twelve organisms' entire treasuries; and `RESIDUE_8` (`:495`) would go negative, which is
  the scripted death the four-frame season is built around. Re-deriving that season means
  re-tuning the four frames and the 44 arithmetic assertions in `web/test/smoke.mjs` two days
  before submission, for a page that already prints `synthetic: true` on an undismissable banner
  and recomputes every figure from its own `config`. What is actually false after N2 is the
  **comment's factual claim** (that the shipped season is 576 windows and that a fixture at the
  contract's scale can never show a close — at 24/4 it could). So the comment is rewritten to
  state the contract's real 24/4 and to say plainly that the divergence is deliberate. Estimate
  drops from 1.0 h to 0.3 h; the hour table in §11 keeps the 1.0 and spends the balance on the
  `cadence.ts` rows, which are a table of literals whose stated purpose is to track
  `initialize`.
- `README.md:74` (the `seasonWindows` row: 576, eight levels, 128×, 0.25 → 32 tUSDC) and `:219`
  (*"A season is 576 windows — about six days"*).
- `CLAUDE.md` — the `spawnGenesis` funding paragraph, and the `Population` row count (48 → 49).
- `STORAGE.md` — a dated entry, and its 2026-09-04 retraction of the founders claim gets its
  resolution.

---

## 6. The assertions

Eleven tests: **eight new, one assertion rewritten in place, two deleted.** All in
`contracts/test/Darwin.t.sol`, one contract. 124 today → **130** after.

(The count was 129 in the first draft of this section, against "+6 new, −1 deleted". Two
corrections, both found while decomposing the plan. Item 2 below asserts two different errors
that become reachable in two different tasks, so it is **split into two tests** rather than
straddling a task boundary; and `test_sweep_canOverdrawTheBooksAndStrandTheSeason` is a **second
deletion** the first draft did not count — §4.5 removes the state it pins, so it does not merely
change, it stops having a subject. A new test for `donatePrizePool` in isolation makes eight.
124 + 8 − 2 = 130.)

**New:**

1. `test_genesis_foundersBelongToTheTreasuryNotTheOwner` — after `deployGenesisTreasury()` and
   `spawnGenesis`, `_p(1).entrant() == population.genesisTreasury()` and `!= owner`.
2. `test_genesis_spawnRefusesWithoutATreasury` — `spawnGenesis` reverts `NoGenesisTreasury` before
   the factory has run, and `deployGenesisTreasury` reverts `TreasuryAlreadySet` on the second
   call. This is the assertion that stops a permanently-ownerless founder from ever existing.
3. `test_season_founderPrizeGoesToTheTreasuryAndNotTheOwner` — the replacement for the pinned
   finding. Asserts three numbers off one `endSeason`: the treasury's collateral balance rises by
   the 60% cut, `rakeAccrued` does **not** move, and the **owner's balance does not move**. The
   third is the actual claim; the first two are what make it non-vacuous.
4. `test_genesisTreasury_recycleIsPermissionlessAndOnlyReachesThePlayers` — a non-owner calls
   `recycle()`; `prizePool` rises by exactly the treasury balance, the treasury goes to zero,
   `rakeAccrued` does not move, `totalRecycled` matches. Plus `NothingToRecycle` on an empty
   treasury as the control.
5. `test_genesis_lineageInheritsTheTreasuryAndCannotBeRetired` — a hatched child of a founder has
   the treasury as `entrant`, and `retire` from the **owner** reverts `NotEntrant`. This test
   exists to pin §5.1 as intended behaviour rather than let it be discovered later as a bug.
6. `test_sweep_cannotOverdrawTheCollateralBooksButStillRecoversStrandedCognition` — two halves,
   and the second is the control that stops the first from being vacuous: sweeping collateral down
   to `pot + rake` succeeds, one wei more reverts `BooksReserved`, and then
   `sweep(address(0), organism, amount)` still returns stranded native, proving the cap did not
   break the remedy `sweep` exists for.

**Rewritten:**

7. `Darwin.t.sol:633` — `"genesis organism should belong to the owner"` becomes the treasury.
8. `Darwin.t.sol:3105` (the A2 test) — `"a genesis founder's entrant is the OWNER, not the zero
   address"` becomes the treasury, and its name and comment change with it. Its point survives:
   the founder's entrant is **not** `address(0)`.
9. `test_season_founderPrizeIsPaidToTheOwner_theRolloverBranchIsDead` (`:3097`) — deleted,
   replaced by (3). This test was deliberately built to fail from both directions, and it **will
   fail** as soon as `spawnGenesis` changes. That is the test working, not the change breaking it.

**Every new assertion gets perturbed to prove it can fail**, per the standing rule in this repo —
the twelve detector self-tests in `web/test/smoke.mjs` exist because two checks once asserted a
string no code path could emit and stayed green.

### N2's tests need no new assertions, and that is checked rather than assumed

`seasonWindows` appears 15 times in `Darwin.t.sol`. Fourteen are `s.seasonWindows = …` through the
`_season()` / `_setSeason()` helpers, so they override the value locally and never read
`initialize`'s literal. **One reads it live:** `:2733` asserts
`population.seasonWindows() > 1` — *"the default season must be longer than one window"* — which
24 satisfies, so it passes unchanged and keeps guarding the thing it was written to guard.

`web/test/smoke.mjs`'s 44 arithmetic assertions recompute from `config`, so they follow a fixture
change automatically. What does need editing is `cadence.ts`'s eight hard-coded 576 rows (§5.5),
which are a table of literals rather than derivations.

---

## 7. What this does not change

- **No `Prophet` change.** `entrant` is still written exactly once, in `Prophet.initialize`.
  `Prophet`'s layout stays at 29 rows.
- **No change to who pays for cognition.** Organisms still fund their own inference; the house
  still subsidises founders and newborns through `_houseCognition()`.
- **No admin recovery path for death**, and no change to the `alive` modifier or `dead`.
- **No change to `rakeBps`, `prizeShareBps`, `baseAnte`, `anteMultBps`, `endowment`,
  `cognitionEndowment`, `maxPopulation`, or the 60/30/10 split.**
- **No `setSeason` call in the deploy path.** The numbers change in `initialize`, so a fresh
  deploy is correct with no post-deploy transaction. `setSeason` remains the live-tuning lever.
- **`_topThree` still scores lifetime net correct calls.** Changing it to per-season scoring is a
  real design question and is out of scope; short seasons reduce its impact, since a founder
  lineage's lifetime lead is a smaller edge over 24 windows than over 576.

---

## 8. Verification

```bash
# 1. It compiles AT ALL — the stack-limit check on spawnGenesis (§4.4).
#    This is the step that can invalidate the design, so it runs first.
npm run build

# 2. Storage, re-derived rather than reasoned. An ordinary `forge build` strips
#    storageLayout back out, and an absent layout is a FAILED check, not a passed one.
forge clean --root contracts
forge build --root contracts --extra-output storageLayout
forge inspect Population storage-layout --root contracts   # expect genesisTreasury at slot 38
forge inspect Prophet    storage-layout --root contracts   # expect NO change, 29 rows
# then diff slot-by-slot against STORAGE.md

# 3. The suite. 124 tests today; expect 130 after (+8 new, -2 deleted).
npm run test

# 3b. The one suite-wide hazard: `_seed()` (`Darwin.t.sol:159`) calls `spawnGenesis` and is
#     called by 77 tests, and `_duelArena()` (`:3773`) spawns into a SECOND proxy. Both must
#     call `deployGenesisTreasury()` first or ~100 tests revert `NoGenesisTreasury` at once
#     and read as a broken design rather than an unfixed helper.
forge test --root contracts --match-test test_entry_genesisOrganismsBelongToTheHouse -vvv

# 4. The frontend's arithmetic, which recomputes the season from config.
npm test --prefix web

# 5. Live dry run — executes against real Shannon state, catches EVM-spec and
#    address problems for free, and writes no manifest (guarded on ScriptDryRun).
forge script script/Deploy.s.sol:Deploy --root contracts --rpc-url somnia -vv
```

On this machine `forge` needs `.foundry/bin` prepended per call, and its lints go to stderr, so
PowerShell reports a clean build as exit 1 — never chain on `$?`.

`forge fmt` on this machine rewrites ten tracked `.sol` files nobody edited (Foundry 1.5.1 vs the
version that formatted the tree). Run it or don't, but do not let `git diff` imply those nine
files are part of this change.

---

## 9. Adversarial review

**"`donatePrizePool` is permissionless — can someone grief the pot?"** They can only add to it.
`prizePool` is never withdrawable by the owner (`endSeason`-only, and after §4.5 not sweepable
either), so a donation is a gift to the players with no path back to the donor. Griefing by
inflating a number that only pays out to the top three is not griefing.

**"Can `donatePrizePool` desynchronise the two books from the balance?"** It increments
`prizePool` by exactly the amount transferred in, in the same call, so
`balance >= rakeAccrued + prizePool` is preserved. tUSDC is a fixed, trusted, non-callback ERC20
set at wiring; there is no hook to reenter through, and the increment follows the transfer anyway.

**"Does the treasury break if `setWiring` repoints `collateral`?"** No — that is why `collateral`
is read from the arena at call time instead of being an immutable. A repoint leaves the treasury
holding an old token with no code path; reading live means `recycle()` always addresses whatever
the arena currently calls collateral. Residue in a de-pointed token would need a new treasury, and
repointing collateral mid-run is already documented as unsafe.

**"Can the owner become the treasury?"** Only by `CREATE`-address collision. There is no setter,
`deployGenesisTreasury` reverts on a second call, and the address is produced by `new` from the
arena itself.

**"Does the sweep cap brick the `CognitionUnspent` remedy?"** No, and test (6)'s second half is
the executable form of that claim rather than the assertion of it. The remedy is native; the cap
is collateral-only.

**"Six levels instead of eight weakens the ante narrative."** It changes 128× to 32×. The
mechanism — an ante that doubles until accuracy bankrupts the accurate — is untouched, and 8 tUSDC
against a 10 tUSDC endowment is the point at which that mechanism actually bites. 32 tUSDC against
10 is not a harder climate, it is an unpayable season.

**"Two closes may still not happen."** They are 6 h apart, so the binding constraint is STT and
wall clock, not design. If only one close happens, one close is still infinitely more than the
shipped 576 could produce, and `SeasonEnded` / `SeasonPrizePaid` will have fired on Shannon.

---

## 10. Where the deploy wallet blocks the sequence

Stated here so it is not discovered at the blocking step. The wallet must exist and hold STT
**before step 4** below; steps 1–3 need nothing on chain.

| Step | Needs the wallet? | STT |
|---|---|---|
| 1. N1 contracts + tests | no | — |
| 2. N2 literals + docs + suite | no | — |
| 3. Clean build, storage diff, live **dry run** | RPC only, no key | 0 |
| 4. **`Deploy` + `deployGenesisTreasury` + `fund` + `Seed`** | **yes** | ~2 deploy + 2.64 founder cognition |
| 5. `fund -- --windows 24`, start `cadence` | yes | ~6.3 per season, 8 organisms |
| 6. subscribe → `prove` → `fee` → `disableFallback()` | yes | ~0.1 gas |
| 7. Second season | yes | ~6.3, more as the population breeds |

**Absolute minimum to not stop the plan: ~5 STT** — ~2 for the deploy plus 2.64 for the founders'
cognition, which is itself ten windows of thinking (0.33 STT × 8), so it needs no separate top-up.
That reaches a live arena, a first `think()` and a frontend reading real state, but not a close.
**~15 STT** reaches two closes at 8 organisms (48 windows × 8 × 0.033 = 12.7 of cognition, of
which 2.64 arrives at spawn and ~10 through `--windows` top-ups, plus ~2 of deploy). **~25 STT**
covers two closes with the population breeding toward `maxPopulation`, where the per-window bill
roughly doubles. Pausing the cadence costs nothing on chain — metabolism is charged per settled
window, not per unit of wall-clock time — so a thin wallet delays the close rather than losing the
run, and no architecture changes.

The deploy-cost line is corrected from the documented figure. `CLAUDE.md` records the 2026-08-29
dry run at *"~11.9M gas, ~0.143 STT"*, which was local revm pricing code deposits at 200 gas/byte.
Measured read-only against Shannon on 2026-09-05: code deposit is linear at **~4,928 gas/byte**
(four points, 4927.79 → 4927.94), `Population`'s implementation alone estimates at **152,789,967
gas ≈ 0.917 STT** at the observed 6 gwei, and the full deploy lands near **1.5–2 STT**. The same
probe established that `Population`'s **30,791-byte** runtime — 6,215 over EIP-170, with no
`code_size_limit` set in `foundry.toml`, so neither the local suite nor the dry run could have
proven deployability — **is accepted by Shannon**: `eth_estimateGas` on the real initcode returns
a number rather than reverting, and a synthetic 30,791-byte creation does too. Block gas limit is
15,000,000,000. Adding `GenesisTreasury`'s initcode to `Population` therefore costs roughly
0.03 STT per KB and hits no size wall.

---

## 11. Hour estimate

| | h |
|---|---|
| `GenesisTreasury.sol`, the four `Population` edits, the sweep cap | 1.5 |
| Nine tests, each perturbed to prove it can fail | 1.5 |
| Clean build, storage diff, `STORAGE.md`, README, `CLAUDE.md`, `cadence.ts:1074` | 1.0 |
| **N1** | **4.0** |
| Two literals + the comment block | 0.5 |
| `cadence.ts` fixture rows (`:552`, `:896`, `:904-922`) | 0.5 |
| `web/js/fixture.js` to the contract's climate + `npm test --prefix web` | 1.0 |
| `README.md:74`, `:219`, docs, full suite | 1.0 |
| **N2** | **3.0** |

---

## 12. Deliberately not decided here

- **`_topThree` scoring lifetime rather than per-season.** Real design question, out of scope,
  reduced in impact by short seasons (§7).
- **A second live arena** (`DirectDuelVenue`). `Deploy.s.sol` deploys one `Population`; a second
  is a second deploy, not a flag.
- **N3** (`Deploy.s.sol:508`'s missing `:Seed` suffix) and **N4** (`MONITOR_SEASON_GRACE` absent
  from `.env.example`). Both files are permission-denied to Claude sessions; the operator applies
  exact text supplied separately.
