# DARWIN Arena Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn DARWIN from a closed exhibition that costs the house money into an open arena where entrants own organisms, pay for their own cognition, face an escalating ante, and pay a rake the protocol can withdraw — with the settlement venue behind an interface so DreamDEX is fitness function #1 rather than the product.

**Architecture:** Five sequential tasks, each independently testable. Task 1 extracts the venue seam (the only two DreamDEX-coupled call sites) behind `IArenaVenue` with a `DreamDEXVenue` adapter. Task 2 adds organism ownership and permissionless entry. Task 3 flips inference payment from the house to each organism. Task 4 replaces proportional staking with a geometrically escalating ante and adds seasons, prize pool and explicit rake accounting. Task 5 adds a second adapter, `DirectDuelVenue`, whose resolution is a price comparison rather than complete-set redemption — which is what makes the platform claim executable rather than asserted.

**Tech Stack:** Solidity 0.8.28 via Foundry (`via_ir = true`, `evm_version = "shanghai"`), OpenZeppelin upgradeable (UUPS for `Population`, `BeaconProxy` for `Prophet`), viem + tsx for ops scripts.

**Spec:** `docs/superpowers/specs/2026-08-29-arena-engine-design.md`

## Global Constraints

- **Storage layout freezes at the Season 0 deploy (2026-09-02).** Every declaration added by this plan must land before it. Append only; never reorder, retype, or remove an existing declaration.
- **All 56 existing tests must stay green.** Run `npm test` at every checkpoint. A task is not done with a red suite.
- **`Population.__gap` is `uint256[20]` at `Population.sol:88`.** New `Population` declarations go immediately before it and shrink it by the number of slots consumed, so the total slot count is unchanged.
- **Do NOT pack a new variable into a partially-filled existing slot — and a declaration alone will not stop it.** `CLAUDE.md` names this explicitly: *"`Prophet` slots 0 (31/32) and 15 (1/32 — thirty-one bytes spare) have free bytes. **Do not fill them.** Slot 15 holds only `positionOpen` and is the most inviting place in the contract to 'just add a bool'."* The design spec claimed `entrant` costs zero slots by packing into slot 15 — **that claim is withdrawn.** But so is the first correction to it: writing `address public entrant;` after `bool public positionOpen;` still lands at slot 15 offset 1, because Solidity packs any variable that fits into the trailing bytes of the previous slot. **A `uint256` pad is what forces the boundary**, so each such variable costs two slots, not one — `Prophet.__gap` `uint256[20]` → `uint256[18]`, and `Population.__gap` likewise for `venue`. Two slots out of twenty is free; violating an explicit repo constraint to save one is not a trade worth making, and the failure mode `CLAUDE.md` describes — a counter silently reading another field's bytes — is invisible until an organism is already corrupt. **The compiler, not this document, is what confirms the boundary landed.**
- **`Population.__gap` is `uint256[20]` at `Population.sol:88`.** Same rule: `CLAUDE.md` lists `Population` slots 13, 18, 21, 23, 26 as having free bytes and forbids filling them. New declarations go in fresh slots before `__gap`. Packing *new* variables with *each other* in a fresh slot is fine and is what the season block below does.
- **`--via-ir` stack limits are already at the edge in three places** and each carries a comment saying so: `_spawn` (`Population.sol:297-302`), `think`'s scoped block (`:337-343`), and `snapshot`'s field-by-field assignment (`:723-729`). Do not hoist declarations out of those scopes or tidy them into struct literals. If a new local pushes one over, scope it in a block rather than restructuring the function.
- **Never extend `setEconomics`.** Its seven positional arguments plus `vm.prank`'s one-call scope is a documented footgun (`Darwin.t.sol:172-186`), and the test suite wraps it in an `Econ` struct to contain it. New parameters go in a new `setSeason` function.
- **`stakeOut` carries the `alive` modifier** (`Prophet.sol:266-269`). Anything that drains an organism must run **before** `die()`, never after.
- **`Prophet.settleWindow` must stay callable inside the reactive callback**, in the same block the market resolves. This is the project's central technical claim. After Task 1, `npm run prove` must pass against Shannon before `SelectionEngine.disableFallback()` is ever called, and until it does only the weaker claim is licensed: *"selection is on-chain and atomic with redemption."*
- **6 decimals.** Shannon tUSDC is 6dp; the test suite's `ONE` is `1e6`. Never hardcode 18.
- **Commit discipline: every gate runs BEFORE its commit, never after.** Each task ends with a verification step and then a commit step, in that order. A commit is the record that the gates passed, so a commit made ahead of a green suite is a lie in the history. If a gate fails, fix it and re-run — do not commit "work in progress" and repair afterwards. The repo is at `C:/Users/Handi/Desktop/somnia_predict/darwin` on branch `master`.
- **The four phases map to six commits.** Phase 1 = Task 1, Phase 2 = Tasks 2A, 2 and 3 (the concurrent-population fix, ownership, and self-paid cognition are separately testable, so they get separate commits), Phase 3 = Task 4, Phase 4 = Task 5. Every phase therefore ends on a commit whose gates ran first. Task 2A was added on 2026-08-29 by the business-model compatibility review below; it is numbered "2A" rather than renumbering, so that every "Task N" cross-reference already written into Tasks 3, 4 and 5 keeps pointing at what it meant.
- **`npm run prove` cannot gate a commit in this plan.** It needs a live deployment that does not exist yet, so it gates `SelectionEngine.disableFallback()` after the Season 0 deploy, not any commit here. Tasks 1 and 5 note this at the point where it would otherwise be tempting to claim it passed.

---

### Task 1: Extract the `IArenaVenue` seam and the DreamDEX adapter

Exactly two call sites are hard-wired to DreamDEX. Everything else already flows through parameters, including `Prophet.settleWindow(settlement, pool, ...)`, which takes them as arguments rather than reading storage. This task changes *who gets called*, not the shape of the window.

> **CORRECTED WHILE IMPLEMENTING, 2026-08-29. Read this before Step 1.**
>
> Three things below are wrong. They were caught against the code rather than by review, so the steps they appear in are **void** and the shipped shape is what is described here. Tasks 2 and 5 depend on these corrections.
>
> **1. Redemption is PUSH, not pull. Steps 4, 10 and 11 are void.**
> The plan had the venue redeem on the organism's behalf using `IOutcomeToken6909.setOperator` rights granted at birth (`grantOperators`, `regrantVenue`). **That cannot work.** `finalizeAndRedeem` burns from `msg.sender` — DreamDEX's `Redeemed` event distinguishes `holder` from `to` for exactly that reason, and `MockSettlement.finalizeAndRedeem` (`test/mocks/Mocks.sol:202`) faithfully does `burn(msg.sender, ...)` — and `IOutcomeToken6909` (`interfaces/IDreamDEX.sol:257`) has **no `transferFrom`**. Operator rights therefore buy nothing at all: no grant lets a venue pull an organism's position.
>
> So the organism **pushes** the position to the venue inside `settleWindow`, and the venue redeems as holder with `to = organism`. Consequences:
> - `IArenaVenue` gains **`positionToken() returns (address)`**. Non-zero means "push before calling `redeemFor`"; `address(0)` means the venue has no transferable position token and its ids are pure bookkeeping. `DirectDuelVenue` returns zero, so Task 5 must not push.
> - `Prophet.grantPopulation` is **unchanged**. `grantOperators` and `regrantVenue` do not exist and must not be written. Swapping the venue needs no re-grant of any kind, which is *why* the seam is cheap — Task 5's operational note about a `regrantVenue` walk is void.
> - Passing `to = organism` rather than the venue is load-bearing, not a saved hop: settlement may CREDIT an owed balance instead of transferring, and the credit is booked against `to`. Routing it to the venue would strand a winner's payout somewhere with no claim path, where `Prophet._sweepOwed` can rescue it from the organism.
>
> **2. `redeemFor` must NOT read the price source. Step 5's body is void.**
> The first draft resolved the pool in `redeemFor` the same way `openOpposing` does. `IPriceSource.currentWindow` reverts `StalePrice` past `maxStaleness` = 180s (`PushedPriceSource.sol:115`), and **in the reactive path nobody pushes a price between resolution and the callback** — that is the central claim, not an oversight. The draft would have reverted every settlement on the path that matters while passing under a keeper-driven cadence that happened to push first.
>
> The venue therefore **records** `poolOf[positionId]` when it issues the position and reads it back at settlement. That is not the cache `CLAUDE.md` forbids: it is recorded truth about one specific position, the same shape as `Prophet.currentMarketId`, written every time a position is issued. `openOpposing` still resolves fresh, because pools *are* recycled. `test_venue_settlesAfterThePriceFeedHasGoneStale` is the regression guard and fails against the draft.
>
> **3. No `MockVenue`. Steps 2, 3, 4, 11 and 12 are void.**
> The harness wires the **real `DreamDEXVenue`** into `setUp` instead, so all existing tests exercise the real adapter through the interface. A call-counting double proves the interface is called, which is the uninteresting half of the claim. One fewer file, a stronger proof.
>
> **4. `Population.venue` costs TWO slots, not one. `__gap` goes 20 → 18.**
> Step 6 has `venue` declared straight after `uint8 phase`, which makes Solidity pack the 20-byte address into `phase`'s thirty-one spare bytes — the thing `CLAUDE.md` forbids, and the identical error this plan already withdrew for `Prophet.entrant` in Task 2. Committing both readings in one change would be incoherent. So a `uint256 private __slotAlign;` precedes `venue`: a `uint256` cannot fit in thirty-one bytes, so declaring one is what forces the fresh slot. One slot spent to keep every boundary where `STORAGE.md` says it is.
>
> Also implemented beyond the plan, because they are the same change: `script/Deploy.s.sol` deploys the venue between the price source and `Population`, threads it through `_wiring`, passes the new fourth `setWiring` argument, and writes `venue` into the deployment manifest. Without this the deploy does not compile.
>
> The seam tests that shipped: `test_venue_settlesAfterThePriceFeedHasGoneStale`, `test_venue_organismPushesRatherThanTheVenuePulling`, `test_venue_canBeRepointedBetweenWindows`, `test_venue_reportsItsOwnTokens`, `test_venue_rejectsAPositionItNeverIssued`. **The `positionToken() == address(0)` branch is deliberately unproven until Task 5** — `DirectDuelVenue` is the real venue that exercises it, and a throwaway escrow double written now would be deleted three days later. Task 5 must assert that branch.

**Files:**
- Create: `contracts/src/interfaces/IArenaVenue.sol`
- Create: `contracts/src/venues/DreamDEXVenue.sol`
- Modify: `contracts/src/Population.sol` — storage (`:88`), `Wiring`/`initialize` (`:141-180`), `executePair` (`:504-524`), `settleAll` (`:552-559`), `setWiring` (`:234-238`)
- Modify: `contracts/src/Prophet.sol` — `settleWindow` (`:310-330`)
- Modify: `contracts/script/Deploy.s.sol` — deploy the venue, thread it through `_wiring`, fourth `setWiring` argument, manifest
- Test: `contracts/test/Darwin.t.sol` — `setUp` (`:69-108`), plus the seam tests

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `IArenaVenue.openOpposing(address up, address down, uint256 amount) returns (uint256 upId, uint256 downId, uint256 quantity)`
  - `IArenaVenue.redeemFor(address organism, uint256 positionId, uint256 quantity) returns (uint256 collateralOut)` — caller must push the position first when `positionToken()` is non-zero
  - `IArenaVenue.positionToken() returns (address)`
  - `IArenaVenue.collateral() returns (address)`
  - `DreamDEXVenue.poolOf(uint256 positionId) returns (address)` and `DreamDEXVenue.UnknownPosition(uint256)`
  - `Population.venue` (public storage getter, `address`)
  - `Population.Wiring.venue` (new struct field, after `priceSource`)
  - `Population.setWiring(address priceSource_, address selectionEngine_, address prophetBeacon_, address venue_)` — **fourth argument added**
  - `Prophet.settleWindow(address venue, address collateral, uint256 metabolicCost) returns (uint256 collateralOut, bool starved)` — **note the changed signature**; Task 4 adds a third return value
  - `Prophet.grantPopulation(address outcomeToken, address collateral)` — **unchanged**, contrary to what Step 10 says

- [ ] **Step 1: Write the interface**

Create `contracts/src/interfaces/IArenaVenue.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 *  Where a window's POSITIONS live, and how a resolved position becomes
 *  collateral.
 *
 *  The companion to IPriceSource, which already abstracts what the window IS.
 *  Together they are DARWIN's whole dependency on any particular venue: bring a
 *  way to issue opposing backed positions and a way to pay the side reality
 *  agreed with, and the engine is indifferent to how that adjudication happens.
 *
 *  v1  DreamDEXVenue     — complete-set mint + finalizeAndRedeem.
 *  v2  DirectDuelVenue   — escrow resolved by the sign of a price change.
 *
 *  CONSTRAINT THAT OUTRANKS EVERY OTHER CONSIDERATION HERE: redeemFor is called
 *  from inside a reactivity callback, in the same block the underlying resolution
 *  lands. An implementation that needs a second transaction, a keeper, or a
 *  waiting period breaks the project's central technical claim, not merely its
 *  performance.
 */
interface IArenaVenue {
    /**
     *  Issue opposing, fully-backed positions out of `amount` collateral, which
     *  the venue pulls from msg.sender (Population holds it for the duration of
     *  one transaction and approves exactly this amount).
     *
     *  @return upId     Position id now held by `up`.
     *  @return downId   Position id now held by `down`.
     *  @return quantity Position units EACH side holds. NOT the same number as
     *                   either side's collateral contribution: a 1:1-backed pair
     *                   funded from both sides leaves each holding the pair's
     *                   whole backing. Conflating the two makes every winner read
     *                   as a break-even.
     */
    function openOpposing(address up, address down, uint256 amount)
        external
        returns (uint256 upId, uint256 downId, uint256 quantity);

    /**
     *  Convert `organism`'s resolved position into collateral paid to `organism`.
     *
     *  MUST return 0 for a losing position rather than reverting — a loser
     *  settling is the normal case, and a revert here would abort the window for
     *  every other organism. MUST be callable in the resolution block.
     *
     *  @return collateralOut What the position was WORTH. The caller separately
     *          measures what actually ARRIVED; the two differ whenever a venue
     *          credits an owed balance instead of transferring, and the
     *          difference is the fitness signal versus the ledger.
     */
    function redeemFor(address organism, uint256 positionId, uint256 quantity)
        external
        returns (uint256 collateralOut);

    /// @dev The collateral token this venue settles in.
    function collateral() external view returns (address);
}
```

- [ ] **Step 2: Write the failing test for venue indifference**

Add to `contracts/test/Darwin.t.sol`. This test is the platform claim expressed as an assertion — it will be run against a second real adapter in Task 5.

```solidity
function test_venue_windowRunsThroughTheVenueSeam() public {
    _seed(2);
    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _answer(2, "DOWN_REVERSION");
    _commit();

    // The seam is real only if the venue actually saw the pair.
    assertEq(mockVenue.openCalls(), 1, "venue did not receive openOpposing");

    _settle();

    assertEq(mockVenue.redeemCalls(), 2, "venue did not receive redeemFor per side");
    _assertLedgerMatchesBalance(1);
    _assertLedgerMatchesBalance(2);
}
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd C:/Users/Handi/Desktop/somnia_predict/darwin
forge test --root contracts --match-test test_venue_windowRunsThroughTheVenueSeam -vv
```

Expected: compile error — `mockVenue` is not declared, `MockVenue` does not exist.

- [ ] **Step 4: Write `MockVenue`**

Create `contracts/test/mocks/MockVenue.sol`. It counts calls and delegates the actual mechanics to the existing `MockBinaryPool` / `MockSettlement`, so it proves the seam without re-implementing settlement semantics.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IArenaVenue} from "../../src/interfaces/IArenaVenue.sol";
import {IBinaryPool, IBinarySettlement, IERC20Like} from "../../src/interfaces/IDreamDEX.sol";

/// @dev Counts what the seam carried, then defers to the DreamDEX mocks so the
///      assertions about settlement semantics stay meaningful.
contract MockVenue is IArenaVenue {
    address public pool;
    address public settlement;
    address public collateralToken;
    uint256 public upId;
    uint256 public downId;

    uint256 public openCalls;
    uint256 public redeemCalls;

    constructor(address pool_, address settlement_, address collateral_, uint256 upId_, uint256 downId_) {
        pool = pool_;
        settlement = settlement_;
        collateralToken = collateral_;
        upId = upId_;
        downId = downId_;
    }

    function collateral() external view returns (address) {
        return collateralToken;
    }

    function openOpposing(address up, address down, uint256 amount)
        external
        returns (uint256, uint256, uint256)
    {
        openCalls += 1;
        IERC20Like(collateralToken).transferFrom(msg.sender, address(this), amount);
        IERC20Like(collateralToken).approve(pool, amount);
        IBinaryPool(pool).mintSet(up, down, amount);
        return (upId, downId, amount);
    }

    function redeemFor(address organism, uint256 positionId, uint256 quantity)
        external
        returns (uint256)
    {
        redeemCalls += 1;
        return IBinarySettlement(settlement).finalizeAndRedeem(pool, positionId, quantity, organism);
    }
}
```

- [ ] **Step 5: Write `DreamDEXVenue`**

Create `contracts/src/venues/DreamDEXVenue.sol`. The pool must be resolved per window and never cached (`IDreamDEX.sol:18-20`), so it reads from `IPriceSource` on every call rather than holding an address.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IArenaVenue} from "../interfaces/IArenaVenue.sol";
import {IPriceSource} from "../interfaces/IPriceSource.sol";
import {IBinaryPool, IBinarySettlement, IERC20Like} from "../interfaces/IDreamDEX.sol";

/**
 *  Adapter one: DreamDEX event contracts.
 *
 *  Holds no per-window state. Pools are RECYCLED across windows and their
 *  outcome ids encode the pool nonce, so caching either is a correctness bug
 *  rather than an optimisation — both are re-resolved through IPriceSource on
 *  every call.
 */
contract DreamDEXVenue is IArenaVenue {
    IPriceSource public immutable priceSource;
    address public immutable settlement;
    address public immutable collateralToken;
    string public symbol;

    error NotTradeable();

    constructor(IPriceSource priceSource_, address settlement_, address collateral_, string memory symbol_) {
        priceSource = priceSource_;
        settlement = settlement_;
        collateralToken = collateral_;
        symbol = symbol_;
    }

    function collateral() external view returns (address) {
        return collateralToken;
    }

    function openOpposing(address up, address down, uint256 amount)
        external
        returns (uint256 upId, uint256 downId, uint256 quantity)
    {
        address pool;
        bool tradeable;
        (, pool, upId, downId,,,,, tradeable) = priceSource.currentWindow(symbol);
        if (!tradeable) revert NotTradeable();

        IERC20Like(collateralToken).transferFrom(msg.sender, address(this), amount);
        // Per-call approval, not infinite: pools are recycled, and a standing
        // allowance to a recycled address is a liability nobody is watching.
        IERC20Like(collateralToken).approve(pool, amount);
        IBinaryPool(pool).mintSet(up, down, amount);
        quantity = amount;
    }

    function redeemFor(address organism, uint256 positionId, uint256 quantity)
        external
        returns (uint256 collateralOut)
    {
        address pool;
        (, pool,,,,,,,) = priceSource.currentWindow(symbol);
        collateralOut = IBinarySettlement(settlement).finalizeAndRedeem(pool, positionId, quantity, organism);
    }
}
```

- [ ] **Step 6: Add `venue` to `Population` storage and wiring**

In `contracts/src/Population.sol`, immediately before `uint256[20] private __gap;` at line 88, add — and note the padding, which correction 4 in the banner explains and which is **not optional**:

```solidity
    // --- the venue seam ---
    /// @dev Forces `venue` onto a slot of its own. `phase` above is a `uint8`, so
    ///      its slot has 31 bytes spare and a 20-byte address would pack into
    ///      them, which `CLAUDE.md` forbids. A `uint256` cannot fit, so declaring
    ///      one here is what creates the boundary.
    uint256 private __slotAlign;

    address public venue;
```

and change the gap to absorb **both** slots:

```solidity
    uint256[18] private __gap;
```

Add `address venue;` to the `Wiring` struct (after `priceSource`, `:148`) and assign it in `initialize`:

```solidity
        venue = w.venue;
```

Extend `setWiring` so the venue is swappable by the owner:

```solidity
    function setWiring(address priceSource_, address selectionEngine_, address prophetBeacon_, address venue_)
        external
        onlyOwner
    {
        if (priceSource_ != address(0)) priceSource = priceSource_;
        if (selectionEngine_ != address(0)) selectionEngine = selectionEngine_;
        if (prophetBeacon_ != address(0)) prophetBeacon = prophetBeacon_;
        if (venue_ != address(0)) venue = venue_;
    }
```

- [ ] **Step 7: Route `executePair` through the venue**

Replace the body of `executePair` (`Population.sol:504-524`) from the `approve` line onward:

```solidity
    function executePair(Prophet up, Prophet down, uint256 stake) external {
        if (msg.sender != address(this)) revert NotDriver();

        uint256 fromUp = up.stakeOut(address(this), stake, collateral);
        uint256 fromDown = down.stakeOut(address(this), stake, collateral);
        uint256 amount = fromUp + fromDown;

        address v = venue;
        IERC20Like(collateral).approve(v, amount);
        (uint256 upId, uint256 downId, uint256 quantity) = IArenaVenue(v).openOpposing(address(up), address(down), amount);

        up.noteCommitted(upId, fromUp, quantity);
        down.noteCommitted(downId, fromDown, quantity);
        emit Paired(up.prophetId(), down.prophetId(), amount);
    }
```

Add the import at the top of the file, next to the existing `IDreamDEX` import at line 10:

```solidity
import {IArenaVenue} from "./interfaces/IArenaVenue.sol";
```

`activeUpId` / `activeDownId` remain in storage and are still set by `think()` — `_openEmpty` uses them for unpaired organisms, and the frontend reads them. Do not remove them.

- [ ] **Step 8: Route `Prophet.settleWindow` through the venue**

In `contracts/src/Prophet.sol`, change the signature and the redeem call:

```solidity
    function settleWindow(address venue, address collateral, uint256 metabolicCost)
        external
        onlyPopulation
        returns (uint256 collateralOut, bool starved)
    {
```

and replace the `finalizeAndRedeem` call at `:329-330` with:

```solidity
            collateralOut = IArenaVenue(venue).redeemFor(address(this), currentOutcomeId, quantity);
```

The `_sweepOwed` fallback at `:348` still reads the settlement address from Population config and is unchanged — a credited payout is a DreamDEX behaviour, and reading it through `IPopulationConfig` keeps a permissionless entrypoint from being handed a spoofed address (`Prophet.sol:417-420`).

Add the import next to the `IDreamDEX` import at `Prophet.sol:5`:

```solidity
import {IArenaVenue} from "./interfaces/IArenaVenue.sol";
```

- [ ] **Step 9: Update the `settleAll` call site**

In `Population.settleAll`, delete the now-unused `pool` local at `:552` and change the call at `:559`:

```solidity
        address v = venue;
        uint256 n = prophets.length;

        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[i]));
            if (p.dead() || !p.positionOpen()) continue;

            try p.settleWindow(v, collateral, metabolicCost) returns (uint256, bool starved) {
```

- [ ] **Step 10: Grant the venue operator rights at birth**

The venue must be able to move an organism's ERC-6909 outcome tokens to redeem them. Replace `grantPopulation` in `contracts/src/Prophet.sol:430-433`:

```solidity
    /// @dev Population must be an ERC-6909 operator to route this organism's
    ///      outcome tokens and hold a collateral allowance; the venue must be one
    ///      to redeem the organism's position on its behalf inside the settlement
    ///      block. Set once at birth. Swapping the venue on a running population
    ///      requires re-granting — see regrantVenue.
    function grantOperators(address outcomeToken, address collateral, address venue) external onlyPopulation {
        IOutcomeToken6909(outcomeToken).setOperator(population, true);
        IOutcomeToken6909(outcomeToken).setOperator(venue, true);
        IERC20Like(collateral).approve(population, type(uint256).max);
    }
```

Update the call in `Population._spawn` (`:311`):

```solidity
        Prophet(payable(p)).grantOperators(outcomeToken, collateral, venue);
```

Add the re-grant path to `Population`, since `setWiring` can change the venue under a live population:

```solidity
    /// @dev After setWiring changes the venue, existing organisms have granted
    ///      operator rights to the OLD one. Batched by id range because a full
    ///      population does not fit in one transaction at the gas limit.
    function regrantVenue(uint256 fromId, uint256 toId) external onlyOwner {
        for (uint256 id = fromId; id <= toId; ++id) {
            Prophet(payable(prophetAt(id))).grantOperators(outcomeToken, collateral, venue);
        }
    }
```

- [ ] **Step 11: Wire `MockVenue` into the test harness**

In `contracts/test/Darwin.t.sol`, add the field next to the other mocks (`:55-62`):

```solidity
    MockVenue mockVenue;
```

Add the import next to the existing mock imports (`:22`):

```solidity
import {MockVenue} from "./mocks/MockVenue.sol";
```

In `setUp`, construct it after `pool` and `settlement` exist (`:73`) and pass it in the wiring:

```solidity
        mockVenue = new MockVenue(address(pool), address(settlement), address(collateral), YES_ID, NO_ID);
```

Add `venue: address(mockVenue),` to the `Population.Wiring` literal (after `priceSource`, `:95`).

- [ ] **Step 12: Run the new test**

```bash
forge test --root contracts --match-test test_venue_windowRunsThroughTheVenueSeam -vv
```

Expected: PASS.

- [ ] **Step 13: Run the full suite and repair the fallout**

```bash
npm test
```

Expected failures to fix, all mechanical:
- Any direct `population.setWiring(a, b, c)` call now needs a fourth argument.
- Any test calling `p.settleWindow(...)` with the old four-argument signature.
- `Population.Wiring` literals — in `Darwin.t.sol:setUp` and in `Deploy.s.sol:_wiring` — need the new `venue` field.

Do not change an assertion to make it pass. If a test fails on *behaviour* rather than on a signature, the refactor changed semantics and that is the bug.

- [ ] **Step 14: Gate, then commit**

Gates first — a commit is the record that they passed:

```bash
npm test && npm run build
```

Expected: 56+ tests passing, clean build.

Then the storage gate, because this task adds declarations and `CLAUDE.md` requires the compiler to answer rather than reasoning:

```bash
forge clean --root contracts
forge build --root contracts --extra-output storageLayout
forge inspect Population storage-layout --root contracts
forge inspect Prophet    storage-layout --root contracts
```

Assert, slot by slot against `STORAGE.md`:
- `Prophet`'s layout is **byte-identical** — this task changed only function signatures there.
- `Population` gains exactly two slots: an unused `__slotAlign` and then `venue` **starting a fresh slot**, with `phase`'s spare bytes still spare. If `venue` shares a slot with `phase`, the padding did not work and the fix is not optional.
- `__gap` is `uint256[18]`.

Do not proceed to Task 2 with a red suite, and do not commit ahead of the gates.

The git root is `darwin/` itself — verified with `git rev-parse --show-toplevel`, on branch
`master`, three commits deep. So these paths are repo-relative as written. Stage them explicitly
anyway rather than reaching for `git add -A`: the phase, not the tree.

```bash
git add contracts/src/interfaces/IArenaVenue.sol contracts/src/venues/DreamDEXVenue.sol \
        contracts/src/Population.sol contracts/src/Prophet.sol \
        contracts/script/Deploy.s.sol contracts/test/Darwin.t.sol \
        scripts/lib/darwin.ts \
        STORAGE.md docs/superpowers/plans/2026-08-29-arena-engine.md \
        docs/superpowers/specs/2026-08-29-arena-engine-design.md
git commit -m "feat(venue): extract IArenaVenue seam behind DreamDEX

Population.mintSet and Prophet.finalizeAndRedeem were the only two call
sites hard-wired to DreamDEX. Both now route through IArenaVenue, with
DreamDEXVenue as adapter one, so the venue is a parameter of the arena
rather than its definition.

- IArenaVenue: openOpposing / redeemFor / positionToken / collateral
- Prophet.settleWindow takes the venue instead of (settlement, pool)
- Population.venue in storage and Wiring; __gap 20 -> 18
- Deploy.s.sol deploys the venue and records it in the manifest
- scripts/lib/darwin.ts reads venue(), because it is repointable

Three corrections the design spec got wrong, all closed against the
code or the compiler rather than by reasoning:

Redemption is PUSH, not pull. finalizeAndRedeem burns from msg.sender
and IOutcomeToken6909 has no transferFrom, so no operator grant lets a
venue pull an organism's position. The organism pushes; the venue
redeems as holder and passes to = organism, which also keeps a credited
payout rescuable by Prophet._sweepOwed. grantPopulation is unchanged
and grantOperators/regrantVenue were never needed.

redeemFor does not read the price source. currentWindow reverts
StalePrice past 180s and nothing pushes a price before a reactive
settlement, so the venue records poolOf[positionId] at open time
instead. test_venue_settlesAfterThePriceFeedHasGoneStale is the guard.

venue costs two slots, not one. Declared after uint8 phase it would
pack into phase's spare bytes, which CLAUDE.md forbids; __slotAlign
forces a fresh slot. Layout re-verified with the compiler.

The harness wires the real DreamDEXVenue rather than a MockVenue, so
every existing test now runs through the seam.

Same-block redemption is untouched in shape but changed in callee, so
npm run prove must be re-run against Shannon after the Season 0 deploy
and before disableFallback(). Until then only the weaker claim holds:
selection is on-chain and atomic with redemption."
```

---

## Business-model compatibility review — 2026-08-29, written after Task 1 and before any Phase 2 code

Tasks 2–5 were drafted against the spec. `docs/BUSINESS_PLAN.md` came afterwards, so before
writing a line of Phase 2 every load-bearing assumption in Tasks 2, 3 and 4 was re-checked
against it **and against the contracts as they actually stand**. Eight findings. Every one was
established by reading code, not inferred from the spec, and each names what establishes it.

| # | Finding | Established by | Resolved in |
|---|---|---|---|
| F1 | **`maxPopulation` is a lifetime birth cap, not a concurrent-population cap.** With 8 founders and `maxPopulation = 24`, only 16 further organisms can EVER exist. After that the generation counter freezes and `enter` reverts permanently while attrition empties the arena. | `Population.sol:327` gates on `prophets.length`; `:337` only pushes; `:742` makes ids array indices so `prophets` can never be compacted; `Prophet.die` (`:430`) only sets a flag | **new Task 2A**, below |
| F2 | **An entrant has no way to get capital back.** `stakeOut` is the only collateral exit and is `onlyPopulation alive`; `endSeason` pays the top three only. A 4th-place survivor is confiscated in full, which contradicts "zero entry fee". | `Prophet.sol:270`; Task 4's `endSeason`; no withdrawal exists among `Prophet`'s externals | Task 2, new Step 7 (`retire`) |
| F3 | **Breeding inference is still house-paid**, so §7's "the protocol's only recurring cost is cadence gas" stays false and the STT bill still grows with evolutionary success — the exact dynamic §2 says the redesign removes. | Task 3 Step 4 leaves `_requestMutation` (`Population.sol:645`) paying from Population's balance | Task 3, Step 4 (rewritten) |
| F4 | **The prize pool is fed only by deaths.** Task 4 books 100% of rent as `rakeAccrued`, but §8 promises a pool fed by residues **and a share of the rake** — so in a healthy season the pot is near-empty exactly when the payout event matters. | Task 4 Step 5: `rakeAccrued += charged`, no split | Task 4, Steps 3 and 5 (`prizeShareBps`) |
| F5 | **The entry floor is not ante-aware.** `minEndowment = 10 tUSDC` while the ante doubles past 16 tUSDC by level 6, so the contract would take money from an entrant who cannot post the current ante. | Task 2 Step 6 checks only `minEndowment`; Task 4's `ante()` schedule | Task 4, Step 6 (`enter` hardened) |
| F6 | **The default season outlives its population.** `seasonWindows = 576` with `levelWindows = 24` puts the ante above a 10 tUSDC treasury by window ~200–344; the last ~300 windows would be an empty arena with a leaderboard. | Task 4 Step 3 defaults, against `endowment = 10_000_000` and `metabolicCost = 50_000` (`Population.initialize`) | Task 4, Step 3 (`levelWindows = 72`) |
| F7 | **The failed-request leak is now an entrant's STT**, not house money moved between its own pockets — so the disclosure must change even though the mechanism does not. | Task 3 Step 4's note; `Prophet.sol:526` shows the *successful*-request rebate already lands on the organism | Task 3, Step 4 (`CognitionUnspent`) |
| F8 | **`rakeBps` is dead storage.** It is initialized, settable and publicly readable, and never read by any logic — so the rake on winnings that §6 lists as revenue line #2 does not exist. Same fingerprint as F2's unused `NotEntrant`. | grep of this plan: `rakeBps` appears at Steps 3 and 6 and in no expression | Task 4, Step 5 (skim on profit) |

Three of these — F1, F2, F8 — are capabilities the business plan asserts and the code does not
have. F1 is the one that matters most, because it is not a missing feature but an active
countdown: it degrades the headline metric (generation count) during the judging window.

**F1 in detail, since it justifies its own task.** Ids are array positions (`prophetAt` returns
`prophets[prophetId - 1]`), and lineage is the one asset the whole design refuses to rebuild, so
`prophets` is correctly append-only and must stay that way. The bug is that the *cap* and the
*per-window loops* both read that same append-only array. Consequences, in order of severity:

1. **The arena closes permanently.** Total organisms ever = `maxPopulation`. `enter` reverts
   `PopulationFull` forever once 24 have been born, with no death able to free a slot. "Entrants
   entering" (§9, *Demonstrable*) stops being demonstrable at exactly the moment the arena is
   worth entering.
2. **The generation counter freezes**, which is the headline metric (`CLAUDE.md`: *"The headline
   metric is generation, not PnL"*). §5's moat — *"every window deepens it"* — inverts: after the
   cap every window makes the population emptier and the number no larger.
3. **Per-window gas grows with cumulative deaths, against a fixed budget.** `settleAll` runs
   inside the reactivity callback, whose `gasLimit` is fixed when the subscription is created
   (`SPIKE.md:126-129`: default 10M, ceiling 200M). A loop over the ever-born set spends gas on
   every corpse forever. The moat is wall-clock time, so an unbounded per-window cost is
   disqualifying on its own — and it is the same-block claim (`npm run prove`) that breaks first.

Raising `maxPopulation` via `setEconomics` is not a fix: it buys entries by making (3) worse
linearly, and it needs a live owner transaction on the day. The fix is to separate the two roles
— `prophets` stays the append-only lineage, and a compactable `living` index becomes what the cap
and the loops read.

**Where this review did NOT find a problem**, recorded so it is not re-litigated:

- `_hatch` charges the **parent** for the child's endowment (`Population.sol:696`:
  `parent.stakeOut(address(this), endowment, collateral)`, with a refund path when the parent
  cannot afford it). Collateral is conserved, and Task 4's `rakeAccrued` therefore does not
  silently fund births. An earlier draft of this review claimed it did; that claim is withdrawn.
- `topUpCognition` and `fundProphet` being permissionless is not a capture vector: both can only
  move value *into* an organism, and neither confers any influence over what it concludes.
- Zero entry fee is compatible with revenue: rent + rake are charged for time in the arena, and
  F2/F5 are what make that a game rather than a confiscation.

---

### Task 2A: Separate the lineage from the living population

**Why this comes before Task 2:** Task 2 makes entry permissionless, and F1 makes it
permanently closable. Shipping `enter` on top of a lifetime birth cap ships a front door that
locks itself. This task changes no economics and adds no external behaviour except that the
population cap starts meaning what its name says.

**Files:**
- Modify: `contracts/src/Population.sol` — storage, `_spawn` (`:326-351`), `think` (`:415-417`),
  `commitAll` (`:474-493`), `settleAll` (`:601-623`), `hatchAll` (`:678-687`), new `livingCount`
- Test: `contracts/test/Darwin.t.sol`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `Population.living(uint256 index) returns (uint256 prophetId)` — the auto-getter
  - `Population.livingIndex(uint256 prophetId) returns (uint256)` — 1-based position, 0 = not living
  - `Population.livingCount() returns (uint256)`
  - `Population._removeLiving(uint256 prophetId)` — internal, idempotent

- [ ] **Step 1: Write the failing tests**

```solidity
function test_population_capIsConcurrentNotLifetime() public {
    Econ memory e = _econ();
    e.maxPopulation = 2;
    _setEconomics(e);

    _seed(2);
    assertEq(population.livingCount(), 2, "two organisms should be alive");

    // A third birth is refused while both are alive.
    string[] memory one = new string[](1);
    one[0] = "third";
    vm.prank(owner);
    vm.expectRevert(Population.PopulationFull.selector);
    population.spawnGenesis(one);

    // Kill one, and the slot must come back.
    _makeThinkingFatal();
    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _answer(2, "DOWN_REVERSION");
    _commit();
    _settle();

    assertLt(population.livingCount(), 2, "nothing died");
    vm.prank(owner);
    population.spawnGenesis(one); // must NOT revert
    assertGt(population.prophetCount(), 2, "lineage did not grow");
}

function test_population_livingIndexTracksAliveCount() public {
    _seed(4);
    assertEq(population.livingCount(), population.aliveCount(), "index and counter disagree");

    _makeThinkingFatal();
    _upWins();
    _think();
    for (uint256 id = 1; id <= 4; ++id) {
        _answer(id, id % 2 == 0 ? "UP_MOMENTUM" : "DOWN_REVERSION");
    }
    _commit();
    _settle();

    assertEq(population.livingCount(), population.aliveCount(), "index drifted from aliveCount");
    // Every id still in the index must actually be alive, and vice versa.
    uint256 n = population.prophetCount();
    for (uint256 id = 1; id <= n; ++id) {
        bool indexed_ = population.livingIndex(id) != 0;
        assertEq(indexed_, !_p(id).dead(), "livingIndex disagrees with dead()");
    }
}

function test_population_deadOrganismsCostNothingToIterate() public {
    // The lineage keeps growing while the living set stays small, which is the
    // whole point: per-window work is bounded by aliveCount, not by history.
    _seed(2);
    _makeThinkingFatal();
    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _answer(2, "DOWN_REVERSION");
    _commit();
    _settle();

    assertEq(population.livingCount(), 0, "both should have starved");
    assertEq(population.prophetCount(), 2, "lineage must not shrink");

    // A window over an empty living set must still advance the machine.
    _think();
    assertEq(population.phase(), 1, "think() did not advance the phase");
}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
forge test --root contracts --match-test "test_population_" -vv
```

Expected: compile error — `livingCount` and `livingIndex` do not exist. Note
`test_population_capIsConcurrentNotLifetime` would fail even if they did: `spawnGenesis` reverts
today on the *lifetime* count.

- [ ] **Step 3: Add the storage**

Immediately before `__gap` — which Task 1 left at `uint256[18]` — add:

```solidity
    // --- the living population, as distinct from the lineage ---
    /**
     *  Prophet ids of organisms that are still alive, in no particular order.
     *
     *  `prophets` is append-only and must stay that way: ids ARE array positions
     *  (`prophetAt` returns `prophets[prophetId - 1]`), and the ancestry graph is
     *  the one asset this design refuses to be able to rebuild. So the lineage
     *  cannot be compacted — which is exactly why the cap and the per-window loops
     *  must not read it. They read this instead.
     */
    uint256[] public living;
    /// @dev prophetId -> its 1-BASED position in `living`. Zero means "not living",
    ///      which is what makes `_removeLiving` idempotent.
    mapping(uint256 => uint256) public livingIndex;
```

and shrink the gap to `uint256[16]`.

Add the view, next to `prophetCount` (`:736`):

```solidity
    /// @dev The concurrent population. `prophetCount()` is the lineage; this is how
    ///      many are alive right now, and it is what `maxPopulation` bounds.
    function livingCount() external view returns (uint256) {
        return living.length;
    }
```

- [ ] **Step 4: Add the removal helper**

Next to `_breedThreshold` (`:629`):

```solidity
    /**
     *  Swap-remove an id from `living`.
     *
     *  Idempotent by construction: an id whose `livingIndex` is zero is simply not
     *  there, so a second reap — or a `retire` racing a starvation — cannot corrupt
     *  the array or underflow the pop.
     */
    function _removeLiving(uint256 prophetId) internal {
        uint256 pos = livingIndex[prophetId];
        if (pos == 0) return;
        uint256 last = living.length;
        if (pos != last) {
            uint256 movedId = living[last - 1];
            living[pos - 1] = movedId;
            livingIndex[movedId] = pos;
        }
        living.pop();
        livingIndex[prophetId] = 0;
    }
```

- [ ] **Step 5: Cap on the living set, and index every birth**

In `_spawn` (`:326-338`), change the cap and add the two index writes:

```solidity
    function _spawn(uint256 parentId, uint32 generation, string memory genome) internal returns (address p) {
        if (living.length >= maxPopulation) revert PopulationFull();

        // `id` IS NOT A LOCAL ON PURPOSE — the Yul optimizer inlines this into
        // spawnGenesis's loop and a local pushes it one stack slot over the limit,
        // under --via-ir too. `prophets.length` after the push IS the new id, so the
        // index writes below re-read it rather than caching it: SLOADs are cheap and
        // stack slots are what this function has run out of.
        p = address(new BeaconProxy(prophetBeacon, ""));
        Prophet(payable(p)).initialize(address(this), prophets.length + 1, parentId, generation, windowCount, genome);
        prophets.push(p);
        living.push(prophets.length);
        livingIndex[prophets.length] = living.length;
        aliveCount += 1;
```

Leave the rest of `_spawn` alone.

In `hatchAll` (`:684`), the same substitution:

```solidity
            if (living.length >= maxPopulation) break;
```

- [ ] **Step 6: Iterate the living set in the three window functions**

**Read this before editing:** in every one of these loops, `i` is a position in `living`, not an
id. The old code could use `i + 1` as an id because it walked `prophets` directly. There is
exactly one such site, inside `think`'s `ThinkFailed` emit, and it must become `living[i]`.
(Shipped: both emit sites in `think` now pass `living[i]`.) Emitting `i + 1` after this change reports a *different organism's* failure,
and `monitor.ts` would blame the wrong one. `prophets[living[i] - 1]` is used rather than
`prophetAt(living[i])` in all three: the bounds check `prophetAt` adds cannot fail here, and its
failure mode would be a reverting window.

`think` (`:415-417`):

```solidity
        uint256 n = living.length;
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[living[i] - 1]));
```

and the `catch` emit at `:435` (there are two `ThinkFailed(i + 1)` sites once Task 3 adds the
affordability skip — change both):

```solidity
                emit ThinkFailed(living[i]);
```

`commitAll` (`:475-482`) — note the `dead()` guard becomes unreachable rather than wrong, and
stays as a belt-and-braces check:

```solidity
        uint256 n = living.length;
        address[] memory ups = new address[](n);
        address[] memory downs = new address[](n);
        uint256 nu;
        uint256 nd;

        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[living[i] - 1]));
```

`settleAll` (`:603-623`) — **iterate BACKWARDS.** This is the one loop that removes elements
while walking, and swap-remove moves the *last* element into the hole. Going forwards, that
element is one the loop has not reached yet and would now skip: an organism would silently miss
settlement, keep its position open, and never be graded. Going backwards, the element moved in
has already been processed:

```solidity
        address v = venue;

        // Backwards, because a reap swap-removes from `living` and the element that
        // fills the hole comes from the end — already processed here, skipped
        // entirely if this loop ran forwards. Do not "tidy" this into a forward
        // loop.
        for (uint256 i = living.length; i > 0; --i) {
            Prophet p = Prophet(payable(prophets[living[i - 1] - 1]));
            if (p.dead() || !p.positionOpen()) continue;

            try p.settleWindow(v, collateral, metabolicCost) returns (uint256, bool starved) {
                if (starved || p.treasury() < metabolicCost) {
                    p.die(windowCount);
                    aliveCount -= 1;
                    _removeLiving(p.prophetId());
                    emit Reaped(p.prophetId(), windowCount, aliveCount);
                } else if (p.streak() >= breedStreak && p.treasury() >= _breedThreshold()) {
                    _requestMutation(p);
                }
            } catch {
                emit SettleFailed(p.prophetId());
            }
        }
```

`hatchAll` (`:679-681`) — forwards is correct here, because `_spawn` **appends** to `living` and
`n` is captured before the loop, so newborns are not iterated in the call that bore them:

```solidity
        uint256 n = living.length;
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[living[i] - 1]));
```

**Leave `snapshot` (`:767-771`) iterating `prophets`.** It is a view over the *lineage*, and the
dead are the interesting half of an evolutionary record. Task 4's `endSeason` also keeps walking
`prophets` — it must only pay survivors, but a season-end read is not a per-window cost.

**Stack-limit warning:** `prophets[living[i] - 1]` is one expression where `prophets[i]` was, so
it adds no live locals, and `think`'s scoped-block workaround (`:337-343`) is untouched. If
`forge build` nevertheless reports a stack error, hoist `living[i]` into the existing scoped
block rather than restructuring the loop, and report which function needed it.

- [ ] **Step 7: Run the new tests**

```bash
forge test --root contracts --match-test "test_population_" -vv
```

Expected: all three PASS.

- [ ] **Step 8: Run the full suite and repair the fallout**

```bash
npm test
```

The suite should be green with no edits: every existing test drives whole windows through
`think`/`commitAll`/`settleAll` and asserts on organisms by id, and ids are unchanged. If
something fails, suspect the `i + 1` → `living[i]` substitution first — a test asserting on a
`ThinkFailed` id is the likely tripwire, and it is catching a real bug if it fires.

- [ ] **Step 9: Measure what this bought**

Not a gate, but record it in the commit: the point of the task is that per-window gas stops
tracking history.

```bash
forge test --root contracts --match-test test_lifecycle --gas-report -vv | head -40
```

Note `settleAll`'s gas next to the pre-change figure if it is at hand. What matters is the
*shape*: it must now be a function of `livingCount()`, not of `prophetCount()`.

- [ ] **Step 10: Gate, then commit**

```bash
npm test && npm run build
```

Both must pass before the commit.

```bash
git add contracts/src/Population.sol contracts/test/Darwin.t.sol
git commit -m "fix(arena): maxPopulation bounds the living population, not the lineage

The cap read prophets.length, which is append-only because ids ARE array
positions and the ancestry graph must never be renumbered. So it was a
LIFETIME BIRTH CAP: 8 founders plus 16 more organisms, ever. After that
the generation counter — the headline metric — freezes permanently,
enter() reverts forever, and attrition empties an arena nobody can join.

Three consequences, all landing during the judging window:
- generation stops advancing while every window still costs gas
- 'entrants entering' stops being demonstrable exactly when the arena is
  worth entering
- settleAll's cost grew with cumulative DEATHS, against a gas limit that
  is fixed when the reactivity subscription is created (SPIKE.md: 10M
  default). The same-block settlement claim breaks before the cap does

Raising maxPopulation is not a fix: it buys entries by making the gas
problem worse, linearly, and needs a live owner tx on the day.

- living[] + livingIndex{} : the compactable view of prophets[]
- _spawn and hatchAll cap on living.length; _removeLiving on death
- think/commitAll/settleAll/hatchAll iterate living; snapshot and
  endSeason keep walking the lineage, where the dead are the point
- settleAll iterates BACKWARDS: swap-remove fills the hole from the end,
  which a forward loop would skip — an organism silently unsettled with
  its position left open
- ThinkFailed(i + 1) became ThinkFailed(living[i]). i is no longer an id,
  and emitting it would have blamed a different organism
- living.length == aliveCount is asserted; aliveCount stays because it is
  in the event stream and storage is append-only"
```

---

### Task 2: Organism ownership and permissionless entry

**Files:**
- Modify: `contracts/src/Prophet.sol` — storage (`:78-81`), `initialize` (`:142-159`)
- Modify: `contracts/src/Population.sol` — storage, `initialize`, `_spawn` (`:294-319`), `_hatch` (`:639-657`), new `enter`, new `setSeason`
- Test: `contracts/test/Darwin.t.sol`

**Interfaces:**
- Consumes: `Population.venue` from Task 1. `Population.living` / `livingIndex` / `_removeLiving` from Task 2A — `_spawn`'s Step 5 rewrite below is stated against **Task 2A's version of the function**, not the version currently in `Population.sol`. **Not `Prophet.grantOperators`** — see Task 1's correction banner; the grant path was never needed and `grantPopulation` is unchanged.
- Produces:
  - `Prophet.entrant() returns (address)`
  - `Prophet.initialize(address population_, uint256 prophetId_, uint256 parentId_, uint32 generation_, uint64 birthWindow_, address entrant_, string calldata systemPrompt_)` — **`entrant_` inserted before `systemPrompt_`**
  - `Population.enter(string calldata genome, uint256 endowmentAmount) returns (uint256 prophetId)` — Task 4 hardens the endowment check
  - `Population.retire(uint256 prophetId)`
  - `Population.minEndowment() returns (uint256)`
  - `Population.setSeason(uint256 minEndowment_, uint256 cognitionEndowment_)` — **Task 4 REPLACES this signature** with a single `SeasonParams` struct and rewrites both call sites. Write the two-argument form here anyway: it is what this task's tests need, and a struct with six fields this task cannot yet populate would be dead weight.

- [ ] **Step 1: Write the failing tests**

Add to `contracts/test/Darwin.t.sol`:

```solidity
function test_entry_isPermissionlessAndRecordsTheEntrant() public {
    address alice = address(0xA11CE);
    collateral.mint(alice, 100 * ONE);

    vm.startPrank(alice);
    collateral.approve(address(population), 100 * ONE);
    uint256 id = population.enter("buy when funding is negative", 10 * ONE);
    vm.stopPrank();

    assertEq(_p(id).entrant(), alice, "entrant not recorded");
    assertEq(_p(id).treasury(), 10 * ONE, "endowment not credited");
    assertEq(_p(id).generation(), 0, "an entrant's organism is generation 0");
    _assertLedgerMatchesBalance(id);
}

function test_entry_rejectsBelowMinEndowment() public {
    address alice = address(0xA11CE);
    collateral.mint(alice, 100 * ONE);

    vm.prank(owner);
    population.setSeason(10 * ONE, 0);

    vm.startPrank(alice);
    collateral.approve(address(population), 100 * ONE);
    vm.expectRevert(Population.EndowmentTooSmall.selector);
    population.enter("underfunded", 9 * ONE);
    vm.stopPrank();
}

function test_entry_childInheritsTheEntrant() public {
    address alice = address(0xA11CE);
    collateral.mint(alice, 1_000 * ONE);

    vm.startPrank(alice);
    collateral.approve(address(population), 1_000 * ONE);
    uint256 parent = population.enter("momentum", 100 * ONE);
    vm.stopPrank();

    // A second organism so the parent has a counterparty to beat.
    _seed(1);
    uint256 foil = population.prophetCount();

    _upWins();
    Econ memory e = _econ();
    e.breedStreak = 1;
    _setEconomics(e);

    _think();
    _answer(parent, "UP_MOMENTUM");
    _answer(foil, "DOWN_REVERSION");
    _commit();
    _settle();

    requester.deliver(_p(parent).pendingMutationRequestId(), "mutated momentum");
    vm.prank(owner);
    population.hatchAll();

    uint256 child = population.prophetCount();
    assertGt(child, foil, "no child was born");
    assertEq(_p(child).entrant(), alice, "child did not inherit the entrant");
    assertEq(_p(child).parentId(), parent, "child parentage is wrong");
}

function test_entry_genesisOrganismsBelongToTheHouse() public {
    _seed(1);
    assertEq(_p(1).entrant(), owner, "genesis organism should belong to the owner");
}

function test_retire_returnsTheEntrantsRemainingCapital() public {
    address alice = address(0xA11CE);
    collateral.mint(alice, 100 * ONE);

    vm.startPrank(alice);
    collateral.approve(address(population), 100 * ONE);
    uint256 id = population.enter("momentum", 10 * ONE);
    vm.stopPrank();

    uint256 before = collateral.balanceOf(alice);
    uint256 held = _p(id).treasury();
    uint256 livingBefore = population.livingCount();

    vm.prank(alice);
    population.retire(id);

    assertEq(collateral.balanceOf(alice) - before, held, "capital was not returned in full");
    assertEq(_p(id).treasury(), 0, "the organism kept collateral");
    assertTrue(_p(id).dead(), "retiring must kill the organism");
    assertEq(population.livingIndex(id), 0, "still in the living index");
    assertEq(population.livingCount(), livingBefore - 1, "living count did not fall");
}

function test_retire_isEntrantOnly() public {
    address alice = address(0xA11CE);
    collateral.mint(alice, 100 * ONE);
    vm.startPrank(alice);
    collateral.approve(address(population), 100 * ONE);
    uint256 id = population.enter("momentum", 10 * ONE);
    vm.stopPrank();

    // Not even the owner can retire someone else's organism: this is the entrant's
    // capital, and an owner-callable exit would be an admin drain path.
    vm.prank(owner);
    vm.expectRevert(Population.NotEntrant.selector);
    population.retire(id);

    // And an entrant cannot retire a house organism. `house` is hoisted out of the
    // call because a view read AFTER vm.prank consumes the prank — Darwin.t.sol:172.
    _seed(1);
    uint256 house = population.prophetCount();
    vm.prank(alice);
    vm.expectRevert(Population.NotEntrant.selector);
    population.retire(house);
}

function test_retire_refusesWhileAPositionIsOpen() public {
    address alice = address(0xA11CE);
    collateral.mint(alice, 100 * ONE);
    vm.startPrank(alice);
    collateral.approve(address(population), 100 * ONE);
    uint256 id = population.enter("momentum", 50 * ONE);
    vm.stopPrank();

    _seed(1);
    uint256 foil = population.prophetCount();

    _upWins();
    _think();
    _answer(id, "UP_MOMENTUM");
    _answer(foil, "DOWN_REVERSION");
    _commit();

    assertTrue(_p(id).positionOpen(), "the test needs an open position to be meaningful");
    vm.prank(alice);
    vm.expectRevert(Population.PositionStillOpen.selector);
    population.retire(id);

    // Once the window closes, the exit opens again.
    _settle();
    assertFalse(_p(id).dead(), "a 50 tUSDC organism must not have starved in one window");
    vm.prank(alice);
    population.retire(id);
    assertTrue(_p(id).dead(), "retire should succeed with no position open");
}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
forge test --root contracts --match-test "test_entry_" --match-test "test_retire_" -vv
```

Expected: compile error — `enter`, `retire`, `setSeason`, `entrant`, `EndowmentTooSmall`, `PositionStillOpen` do not exist. (`forge` takes the last `--match-test`; run the two patterns as two invocations, or use `--match-test "test_(entry|retire)_"`.)

- [ ] **Step 3: Add `entrant` to `Prophet`**

In `contracts/src/Prophet.sol`, **do not touch the slot-15 block.** `CLAUDE.md` forbids filling it. And note that "do not touch it" is not achieved by declaring the next variable after it — an `address` is 20 bytes and slot 15 holds one `bool`, so Solidity packs `entrant` into slot 15 unless something forces a boundary. A `uint256` cannot fit in the 31 spare bytes, so declaring one is that force. This mirrors `Population.__slotAlign` from Task 1, for the same reason and at the same cost:

```solidity
    // slot 15
    bool public positionOpen;

    /**
     *  PADDING, AND NOT DEAD WEIGHT. Slot 15 above holds one `bool` and has
     *  thirty-one bytes spare, so `address public entrant` declared straight
     *  after it lands AT offset 1 of slot 15 rather than on a slot of its own.
     *  `CLAUDE.md` names slot 15 as *"the most inviting place in the contract to
     *  'just add a bool'"* and forbids filling it: packing into a partially-used
     *  slot is invisible on a fresh deploy and only surfaces once a counter
     *  starts reading another field's bytes. Two slots, one of them unused, is
     *  the cheap side of that trade.
     */
    uint256 private __slotAlign;

    // slot 17 — reached because the padding above forced a boundary, NOT because
    // declaration order alone would have put it here.
    /// @dev Who owns this organism: whoever paid to enter it, or the parent's
    ///      entrant for a child. Zero for organisms predating the open arena.
    address public entrant;

    uint256[18] private __gap;
```

Verify it with the compiler rather than with this comment — `forge inspect Prophet storage-layout` must report `entrant` at slot 17 offset 0, and `positionOpen` alone in slot 15. Step 10's storage gate is where that happens.

Add `entrant_` to `initialize`:

```solidity
    function initialize(
        address population_,
        uint256 prophetId_,
        uint256 parentId_,
        uint32 generation_,
        uint64 birthWindow_,
        address entrant_,
        string calldata systemPrompt_
    ) external {
        if (population != address(0)) revert AlreadyInitialized();
        population = population_;
        prophetId = prophetId_;
        parentId = parentId_;
        generation = generation_;
        birthWindow = birthWindow_;
        entrant = entrant_;
        systemPrompt = systemPrompt_;
        genomeHash = keccak256(bytes(systemPrompt_));
        emit Born(prophetId_, parentId_, generation_, genomeHash);
    }
```

- [ ] **Step 4: Add the new `Population` storage**

Immediately before `__gap` — which Task 2A left at `uint256[16]` — add:

```solidity
    // --- open arena ---
    uint256 public minEndowment; // floor on what an entrant must stake to play
    uint256 public cognitionEndowment; // native STT handed to a newborn to think with
```

and shrink the gap to `uint256[14]`. No padding is needed here, unlike `venue` and `Prophet.entrant`: a `uint256` occupies a whole slot by definition, so two of them cannot pack into the trailing bytes of anything before them.

In `initialize`, after `maxPopulation = 24;`:

```solidity
        minEndowment = 10_000_000; // 10 tUSDC — the same as a house endowment
        cognitionEndowment = 0; // set per-deploy; Task 3 makes it load-bearing
```

Add the errors next to the others (`:132-139`) — `ProphetIsDead` and `NoSuchProphet` already exist and `retire` reuses both:

```solidity
    error EndowmentTooSmall();
    error NotEntrant();
    error PositionStillOpen();
```

and the event next to `Reaped` (`:120`):

```solidity
    /// @dev An entrant left voluntarily and took what the organism still held.
    ///      Distinct from `Reaped`, which is death by starvation and forfeits.
    event Retired(uint256 indexed prophetId, address indexed entrant, uint256 returned);
```

- [ ] **Step 5: Thread the entrant through `_spawn`**

`_spawn` currently endows from Population's own collateral balance. Keep that: `enter` pulls the entrant's collateral into Population *first*, so `_spawn` stays a single code path for genesis, entry and hatching. Change the signature and the lines that use it — **this is stated against Task 2A's version**, so the `living` cap and the two index writes are already present and must survive:

```solidity
    function _spawn(uint256 parentId, uint32 generation, string memory genome, address entrant, uint256 endow)
        internal
        returns (address p)
    {
        if (living.length >= maxPopulation) revert PopulationFull();

        // `id` IS NOT A LOCAL ON PURPOSE — see the note below; the Yul optimizer
        // inlines this into spawnGenesis's loop and a local pushes it one stack
        // slot over the limit, under --via-ir too.
        p = address(new BeaconProxy(prophetBeacon, ""));
        Prophet(payable(p)).initialize(
            address(this), prophets.length + 1, parentId, generation, windowCount, entrant, genome
        );
        prophets.push(p);
        living.push(prophets.length);
        livingIndex[prophets.length] = living.length;
        aliveCount += 1;

        Prophet(payable(p)).grantPopulation(outcomeToken, collateral);

        if (endow > 0) {
            if (!IERC20Like(collateral).transfer(p, endow)) revert TransferFailed();
            Prophet(payable(p)).fund(endow);
        }

        emit Spawned(prophets.length, p, parentId, generation);
    }
```

**Stack-limit warning:** this adds two parameters to a function the optimizer inlines into a loop, and the existing comment at `:297-302` records that it already sits exactly one slot from the limit. If `forge build` fails with a stack error, do **not** reintroduce an `id` local or restructure the loop — instead stop inlining by marking the endowment transfer as its own external step, or scope the `BeaconProxy` construction in a block. Report the failure and the fix used.

Update `spawnGenesis` (`:288-292`) so house organisms belong to the owner:

```solidity
    function spawnGenesis(string[] calldata genomes) external onlyOwner {
        for (uint256 i; i < genomes.length; ++i) {
            _spawn(0, 0, genomes[i], msg.sender, endowment);
        }
    }
```

Update `_hatch` (`:656`) so children inherit ownership and are funded by the parent:

```solidity
        _spawn(parent.prophetId(), parent.generation() + 1, childGenome, parent.entrant(), endowment);
```

- [ ] **Step 6: Write `enter` and `setSeason`**

Add to the GENESIS section of `contracts/src/Population.sol`, after `spawnGenesis`:

```solidity
    /**
     *  Enter the arena.
     *
     *  Permissionless and deliberately free at the door: entrants are the scarce
     *  input, so revenue comes from time spent in the arena (metabolism, and the
     *  rake on settlement) rather than from a toll. What the entrant must supply
     *  is their own organism's backing — they are not paying the house, they are
     *  funding their player.
     */
    function enter(string calldata genome, uint256 endowmentAmount) external returns (uint256 prophetId) {
        if (endowmentAmount < minEndowment) revert EndowmentTooSmall();
        if (!IERC20Like(collateral).transferFrom(msg.sender, address(this), endowmentAmount)) {
            revert TransferFailed();
        }
        _spawn(0, 0, genome, msg.sender, endowmentAmount);
        prophetId = prophets.length;
    }

    function setSeason(uint256 minEndowment_, uint256 cognitionEndowment_) external onlyOwner {
        minEndowment = minEndowment_;
        cognitionEndowment = cognitionEndowment_;
    }
```

- [ ] **Step 7: Write `retire`, the entrant's exit**

Add immediately after `enter`. **Why this exists:** without it, collateral could enter an organism
and leave only through starvation or a top-three season finish (Task 4's `endSeason`). A
fourth-placed *survivor* would be confiscated in full — that is not a zero-entry-fee tournament,
it is a toll moved from the door to the exit, and it is the kind of detail that turns "anyone can
enter" into a claim nobody should act on. The unused `NotEntrant` error declared in Step 4 is the
fingerprint of this capability having been designed and then dropped.

```solidity
    /**
     *  Leave the arena and take what the organism still holds.
     *
     *  Rent already charged and antes already lost stay lost — this is an exit,
     *  not a refund. What it guarantees is that the *remaining* stake belongs to
     *  whoever put it in, which is what makes entering a wager rather than a
     *  donation.
     *
     *  `positionOpen` is the entire anti-rage-quit gate, and it needs no new
     *  state: it is true from `commitAll` until `settleAll`, so an entrant cannot
     *  watch a market move against their organism and pull the stake out from
     *  under the counterparty it is already paired 1:1 with. Between windows,
     *  leaving is free — an organism nobody wants to keep funding should stop
     *  costing its entrant money.
     */
    function retire(uint256 prophetId) external {
        Prophet p = Prophet(payable(prophetAt(prophetId)));
        if (msg.sender != p.entrant()) revert NotEntrant();
        if (p.dead()) revert ProphetIsDead();
        if (p.positionOpen()) revert PositionStillOpen();

        // `stakeOut` carries the `alive` modifier (Prophet.sol:266-269), so the
        // drain MUST come before die(). Reversing these two lines silently
        // confiscates the entrant's capital, and the tests above would catch it.
        uint256 remaining = p.treasury();
        if (remaining > 0) p.stakeOut(msg.sender, remaining, collateral);

        p.die(windowCount);
        aliveCount -= 1;
        _removeLiving(prophetId);
        emit Retired(prophetId, msg.sender, remaining);
    }
```

Three things to notice, because each is a decision rather than an implementation detail:

- **The organism dies; it is not un-spawned.** `prophets` stays append-only and the lineage keeps
  the record, which is the whole point of Task 2A's split. A retired organism's descendants and
  its generation number remain part of the run's history.
- **`p.dead()` is checked explicitly** even though `die` is idempotent (`Prophet.sol:431`:
  `if (dead) return;`). Without the check, a second `retire` would underflow `aliveCount`, and
  `stakeOut`'s `alive` modifier would revert with an error that says nothing about why.
- **A reaped organism's residue is NOT returned here.** `settleAll` kills starvers, and
  BUSINESS_PLAN §8 forfeits their residue to the prize pool — Task 4 books that. `retire` is the
  voluntary path only, which is exactly why it is gated on the organism still being alive.

- [ ] **Step 8: Run the new tests**

```bash
forge test --root contracts --match-test "test_(entry|retire)_" -vv
```

Expected: all seven PASS.

- [ ] **Step 9: Run the full suite and repair the fallout**

```bash
npm test
```

Expected failures, all mechanical: `test_access_prophetCannotBeReinitialized` (`:1106`) and `test_upgrade_preservesEveryOrganismField` (`:897`) call `Prophet.initialize` directly and need the `entrant_` argument. The upgrade test should additionally assert `entrant` survives the upgrade — add it to the field list it checks, since a new field that is not in that test is a field the freeze does not protect.

- [ ] **Step 10: Re-derive both storage layouts from the compiler**

This task is the first to touch `Prophet`'s layout, and `CLAUDE.md` makes the check mandatory
after any change to `contracts/src/*.sol`. The layout is **not** in the default artifact output,
so `--extra-output` is required and `forge clean` alone does not fix its absence:

```bash
forge clean --root contracts
forge build --root contracts --extra-output storageLayout
forge inspect Prophet    storage-layout --root contracts
forge inspect Population storage-layout --root contracts
```

Assert, against the output and not against this document:

1. `positionOpen` is **alone** in `Prophet` slot 15 — no `entrant` packed at offset 1.
2. `Prophet.entrant` is at slot **17**, offset 0.
3. `Prophet.__gap` begins at slot **18** with **18** entries.
4. `Population.minEndowment` is at slot **31** and `cognitionEndowment` at **32**, following
   Task 2A's `living` (29) and `livingIndex` (30).
5. Every pre-existing declaration in both contracts is at the slot `STORAGE.md` records for it —
   in particular `Population.phase` still at 26 with its spare bytes still spare.

If (1) fails, the `uint256 private __slotAlign;` pad is missing or in the wrong place. Then add a
dated changelog entry to `STORAGE.md` for both contracts, listing every new variable with its slot
as the compiler reports it.

- [ ] **Step 11: Gate, then commit**

```bash
npm test && npm run build
```

Both must pass before the commit.

```bash
git add contracts/src/Population.sol contracts/src/Prophet.sol contracts/test/Darwin.t.sol STORAGE.md
git commit -m "feat(arena): organisms have owners, entry is open, and exit exists

Prophet gains \`entrant\`, Population.enter() lets anyone stake an
organism into the arena, and retire() lets them leave with what is
left. A tournament with no players could not charge for anything; this
is the change that makes the arena a game rather than an exhibition.

- Prophet.entrant on a slot of its own, reached by declaring a uint256
  pad first: an address after slot 15's lone bool would have PACKED into
  slot 15, which CLAUDE.md forbids. Prophet.__gap 20 -> 18
- Population.minEndowment / cognitionEndowment; Population.__gap 16 -> 14
- Prophet.initialize takes entrant_ before systemPrompt_
- Population.enter(genome, endowmentAmount): zero entry fee, mandatory
  minEndowment. Entrants are the scarce input, so revenue comes from
  time in the arena rather than a toll at the door
- Population.retire(prophetId): the entrant's exit. Without it the only
  ways collateral could leave an organism were starvation and a
  top-three season finish, so a fourth-placed SURVIVOR was confiscated
  in full — a toll moved from the door to the exit. Gated on
  !positionOpen, which is true only between windows and is therefore
  the whole anti-rage-quit rule with no new state. Drains BEFORE die(),
  because stakeOut carries the alive modifier
- Children inherit the parent's entrant, so a good genome reproducing
  means the entrant owns more organisms
- spawnGenesis attributes house organisms to the owner
- _spawn takes (entrant, endowment); callers ensure Population holds
  the collateral first, which unifies genesis, entry and hatching
- setSeason added rather than extending setEconomics, whose seven
  positional args plus vm.prank's one-call scope is a known footgun
- both storage layouts re-derived from the compiler; STORAGE.md updated"
```

---

### Task 3: Organisms pay for their own cognition

This is the change that removes the cost centre. `Prophet` already has `receive() external payable {}` (`:494`) and a native balance is `address(this).balance`, not storage, so this task adds **no** storage.

> **CORRECTED WHILE IMPLEMENTING, 2026-08-30. Read this before Step 1, and before Task 4.**
>
> Shipped as `2915aeb`. Five things below are wrong, and Task 4 is written against the wrong ones — its Step 6 and Step 7 in particular. The shipped shape is what is described here.
>
> **1. `drawCognition` is ALL-OR-NOTHING. Its stated signature is a trap.**
> The plan has it return "what it could actually afford", i.e. `min(amount, balance)`. That is unusable: `AgentRequester.createAdvancedRequest` reverts unless it is paid the full `requestDeposit`, so a partial draw would forward a short payment and revert the *whole* `think()` — one poor organism killing the window for all of them. It therefore sends `amount` or sends nothing, and returns `0` in the second case, which is what lets `think` skip that organism and charge it an abstain. **It also carries no `alive` modifier**, deliberately: `settleAll` must be able to sweep a corpse's unspent native.
>
> **2. `enter` is ENTRANT-funded and `payable`. The house does not grant cognition.**
> The plan has `_spawn` endow every organism from `Population`'s float. For `enter` that is an unbounded free-inference faucet: entry is free and `retire` refunds the collateral, so enter → retire → repeat walks off with `cognitionEndowment` of the operator's STT per cycle, converted into LLM calls. So `enter(string genome, uint256 endowmentAmount)` is **`payable`** and reverts **`CognitionTooSmall()`** below the floor; every wei of `msg.value` is forwarded to the organism, the excess emitting `CognitionFunded`. `spawnGenesis` (owner-only) and `_hatch` (earned over four correct windows) stay house-funded because neither is farmable.
>
> **The check order inside `enter` is `EndowmentTooSmall` (`Population.sol:484`) then `CognitionTooSmall` (`:485`)**, collateral before native.
>
> **3. `retire` returns unspent cognition**, with the native send placed after every state write, and guarded by `NotEntrant` / `ProphetIsDead` / `PositionStillOpen`. `Retired` carries four fields.
>
> **4. `cognitionEndowment` defaults to `0.33 ether`, not `0`.** `Deploy.s.sol` never calls `setSeason`, so a zero default ships a population that is born unable to think and dies of nothing at all. The default is the deployed value, not a placeholder.
>
> **5. `Population.topUpCognition` takes the id and is `payable`** as stated — but the fund tooling calls it once per organism to reach a target window count, so it must stay idempotent and must not require the organism to be alive-and-solvent.
>
> **What Task 4 must not copy verbatim:**
> - Task 4's tests call `population.enter("momentum", 10 * ONE)` with **no `{value:}`** (plan lines ~2061, ~2099). Under the shipped `payable enter` that reverts `CognitionTooSmall` before reaching the check the test exists to prove. Every `enter` in Task 4 needs a `{value:}`, and `EndowmentBelowAnte` belongs beside `EndowmentTooSmall` — in the collateral group, before the native check — so that no test depends on guard ordering to pass.
> - Task 4 Step 7 quotes `setUp`'s line as `population.setSeason(10 * ONE, 0.1 ether)`. The shipped line (`Darwin.t.sol:138`) is **`population.setSeason(10 * ONE, 1 ether)`**.
> - The harness helpers that actually exist are `_enter(who, genome, amount)` (which reads `cognitionEndowment` *before* the prank, because a `view` read is a call and `vm.prank` binds to the next one) and `_fundCognition(uint256 id)` at `Darwin.t.sol:180`, called by `_seed`.
>
> Storage: **unchanged, and the absence is the point** — re-derived from the compiler anyway and recorded in `STORAGE.md`. Task 4 is the next task that moves `__gap`.

**Files:**
- Modify: `contracts/src/Prophet.sol` — new `drawCognition`
- Modify: `contracts/src/Population.sol` — `think` (`:381-405`), `_requestMutation` (`:608`), `_spawn`, `spawnGenesis`, new `topUpCognition`
- Test: `contracts/test/Darwin.t.sol`

**Interfaces:**
- Consumes: `Population.cognitionEndowment` from Task 2; `living` / `livingIndex` from Task 2A — `think`'s loop below is stated against Task 2A's version.
- Produces:
  - `Prophet.drawCognition(uint256 amount) returns (uint256 sent)` — `onlyPopulation`, sends native to Population, returns what it could actually afford
  - `Population.topUpCognition(uint256 prophetId)` — `payable`, permissionless
  - `Population.spawnGenesis(string[] calldata genomes)` becomes `payable`
  - Events `CognitionUnspent(uint256 prophetId, uint256 amount)` and `BreedingUnaffordable(uint256 prophetId)`

- [ ] **Step 1: Write the failing tests**

```solidity
function test_cognition_organismPaysItsOwnInference() public {
    _seed(1);
    Prophet p = _p(1);

    vm.deal(address(p), 1 ether);
    uint256 popBefore = address(population).balance;
    uint256 orgBefore = address(p).balance;
    uint256 dep = population.requestDeposit();

    _think();

    assertEq(orgBefore - address(p).balance, dep, "organism did not pay its own deposit");
    // Population forwarded exactly what it drew, so its balance is unchanged.
    assertEq(address(population).balance, popBefore, "population subsidised the request");
    assertGt(p.pendingBeliefRequestId(), 0, "no request was made");
}

function test_cognition_brokeOrganismAbstainsAndStillPaysMetabolism() public {
    _seed(2);
    Prophet broke = _p(1);
    Prophet solvent = _p(2);

    vm.deal(address(broke), 0);
    vm.deal(address(solvent), 1 ether);

    uint256 treasuryBefore = broke.treasury();
    _think();

    assertEq(broke.pendingBeliefRequestId(), 0, "broke organism should not have a request");
    assertGt(solvent.pendingBeliefRequestId(), 0, "solvent organism should have thought");

    _answer(2, "UP_MOMENTUM");
    _commit();
    _upWins();
    _settle();

    assertEq(broke.abstainCount(), 1, "failure to afford thought is an abstention");
    assertEq(treasuryBefore - broke.treasury(), population.metabolicCost(), "metabolism was not charged");
}

function test_cognition_topUpIsPermissionless() public {
    _seed(1);
    address stranger = address(0x51A5);
    vm.deal(stranger, 1 ether);

    vm.prank(stranger);
    population.topUpCognition{value: 0.5 ether}(1);

    assertEq(address(_p(1)).balance, 0.5 ether, "top-up did not land");
}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
forge test --root contracts --match-test "test_cognition_" -vv
```

Expected: `test_cognition_organismPaysItsOwnInference` fails on the balance assertion (Population still pays); `test_cognition_topUpIsPermissionless` fails to compile.

- [ ] **Step 3: Add `drawCognition` to `Prophet`**

Add to the HOUSEKEEPING section of `contracts/src/Prophet.sol`, after `fund`:

```solidity
    /**
     *  Hand Population the native balance for one inference.
     *
     *  Cognition is metered, and from here an organism pays for its own. Returns
     *  what it could actually afford rather than reverting, because a broke
     *  organism must degrade into an abstention — which still costs it
     *  metabolism — instead of halting the window for everyone else.
     */
    function drawCognition(uint256 amount) external onlyPopulation returns (uint256 sent) {
        sent = amount > address(this).balance ? address(this).balance : amount;
        if (sent > 0) {
            (bool ok,) = population.call{value: sent}("");
            if (!ok) revert TransferFailed();
        }
    }
```

- [ ] **Step 4: Draw from the organism in `think`**

In `Population.think`, replace the request loop body (`:384-405`). **Stated against Task 2A's
version of the loop** — `i` indexes `living`, so `i + 1` is not an id and every `ThinkFailed` emit
takes `living[i]`:

```solidity
        uint256 n = living.length;
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[living[i] - 1]));
            if (p.dead()) continue;

            // The organism funds its own thought. One that cannot is skipped: it
            // forms no belief, opens an empty position in commitAll, and pays
            // metabolism anyway. Starving because you could not afford to think is
            // the intended selection pressure, not a failure mode.
            if (p.drawCognition(dep) < dep) {
                emit ThinkFailed(living[i]);
                continue;
            }

            bytes memory payload =
                abi.encodeCall(ILLMAgent.inferString, (context, p.systemPrompt(), chainOfThought, allowed));

            try IAgentRequester(agentRequester).createAdvancedRequest{value: dep}(
                llmAgentId,
                address(p),
                Prophet.handleBelief.selector,
                payload,
                subcommitteeSize,
                threshold,
                ConsensusType.Majority,
                requestTimeout
            ) returns (uint256 requestId) {
                p.noteThinking(requestId, marketId);
            } catch {
                emit ThinkFailed(living[i]);
            }
        }
```

**The failed-request leak, and why the disclosure changes even though the mechanism does not.** If
`createAdvancedRequest` reverts after the draw, the drawn native stays in Population instead of
returning to the organism. Before this task that was house money moving between its own pockets;
after it, **it is an entrant's STT**, bounded by one deposit per failed request. Do **not** add a
refund inside the `catch`: `think` is already at the `--via-ir` stack limit (`:337-343`) and this
loop is the exact scope that overflows. Make it accountable instead — emit alongside
`ThinkFailed`, which needs no new stack slot because both arguments are already live:

```solidity
    /// @dev A drawn cognition deposit that bought no inference. The native stays in
    ///      Population and belongs, morally, to the organism. Reconciled by the
    ///      operator, not on chain: refunding inside think()'s loop would push it
    ///      over the --via-ir stack limit.
    event CognitionUnspent(uint256 indexed prophetId, uint256 amount);
```

`ThinkFailed`'s own signature is deliberately left alone: `monitor.ts` filters on its topic0, and
changing the event would silently stop the monitor matching the failure it exists to catch.

- [ ] **Step 4b: Charge the parent for breeding inference too**

`_requestMutation` (`:608`) still pays from Population's balance. **Leaving it there would make
this task's headline claim false**: §7 of `docs/BUSINESS_PLAN.md` rests on *"once organisms pay for
their own cognition, the protocol's only recurring cost is cadence gas"*, and breeding is an
inference. Worse, the residual bill is proportional to *evolutionary success* — exactly the
dynamic the redesign exists to remove — against a documented 1 STT/day faucet limit.

An earlier draft of this plan kept it house-paid on the grounds that "draining a parent
mid-settlement" was the worse trade. That objection confuses two balances: `settleWindow` moves
**collateral**, `drawCognition` moves **native**, and they do not interact. Nothing about the
settlement is at risk.

Rewrite the deposit line so the parent pays, and make unaffordability a skip rather than a revert:

```solidity
    function _requestMutation(Prophet p) internal {
        uint256 dep = requestDeposit();

        // The parent pays to reproduce. An organism that cannot afford the
        // inference simply does not breed this window — it keeps its streak and
        // its surplus, and may try again next window. Reverting here would abort
        // the whole settlement over one organism's empty pocket.
        if (p.drawCognition(dep) < dep) {
            emit BreedingUnaffordable(p.prophetId());
            return;
        }

        bytes memory payload =
            abi.encodeCall(ILLMAgent.inferString, (Genome.mutationPrompt(p.systemPrompt()), MUTATION_SYSTEM, true, new string[](0)));

        try IAgentRequester(agentRequester).createAdvancedRequest{value: dep}(
            llmAgentId,
            address(p),
            Prophet.handleMutation.selector,
            payload,
            subcommitteeSize,
            threshold,
            ConsensusType.Majority,
            requestTimeout
        ) returns (uint256 requestId) {
            p.noteMutating(requestId);
            emit BreedingRequested(p.prophetId(), requestId);
        } catch {
            emit CognitionUnspent(p.prophetId(), dep);
        }
    }
```

with the new event next to the others:

```solidity
    /// @dev Bred on merit, could not afford the thought. Not a failure — an
    ///      organism keeps its streak and may breed in a later window.
    event BreedingUnaffordable(uint256 indexed prophetId);
```

**Match the real function when you edit it.** The body above shows the shape, not a verbatim
replacement: read `_requestMutation` at `Population.sol:645` first and change only the deposit
source, the affordability guard and the `catch`. In particular do not alter how the mutation prompt
or `MUTATION_SYSTEM` is built — that is existing, working code, and `Genome.beliefPrompt`'s sibling
is another of the stack-limit-fragile sites `CLAUDE.md` lists.

A test for it, added to Step 1's block:

```solidity
function test_cognition_breedingIsPaidByTheParent() public {
    _seed(2);
    Prophet winner = _p(1);

    Econ memory e = _econ();
    e.breedStreak = 1;
    _setEconomics(e);

    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _answer(2, "DOWN_REVERSION");
    _commit();

    uint256 popBefore = address(population).balance;
    uint256 orgBefore = address(winner).balance;
    uint256 dep = population.requestDeposit();

    _settle();

    assertGt(winner.pendingMutationRequestId(), 0, "the winner should be breeding");
    assertEq(orgBefore - address(winner).balance, dep, "the parent did not pay for the mutation");
    assertEq(address(population).balance, popBefore, "population subsidised the breeding");
}
```

- [ ] **Step 5: Fund newborns with cognition and add the top-up**

In `_spawn`, after the collateral endowment block:

```solidity
        if (cognitionEndowment > 0 && address(this).balance >= cognitionEndowment) {
            (bool ok,) = p.call{value: cognitionEndowment}("");
            if (!ok) revert TransferFailed();
        }
```

Make `spawnGenesis` payable so a deploy can seed cognition in the same transaction:

```solidity
    function spawnGenesis(string[] calldata genomes) external payable onlyOwner {
```

Add the top-up next to `fundProphet`:

```solidity
    /// @dev Pay for an organism's thinking. Permissionless, like fundProphet: it
    ///      can only ever move value INTO an organism, and buying someone else's
    ///      cognition confers no control over what they conclude.
    function topUpCognition(uint256 prophetId) external payable {
        address p = prophetAt(prophetId);
        if (Prophet(payable(p)).dead()) revert ProphetIsDead();
        (bool ok,) = p.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
    }
```

- [ ] **Step 6: Give organisms native balance in the test harness**

Every existing test relies on Population paying. Add a helper to `Darwin.t.sol` next to `_seed`:

```solidity
    /// @dev Cognition is now paid by each organism, so seeding a population means
    ///      funding its thinking too. Kept separate from _seed so a test can
    ///      deliberately leave an organism unable to afford a thought.
    function _fundCognition(uint256 n) internal {
        for (uint256 id = 1; id <= n; ++id) {
            vm.deal(population.prophetAt(id), 1 ether);
        }
    }
```

and change `_seed` to call it, so existing tests keep working unchanged:

```solidity
    function _seed(uint256 n) internal {
        string[] memory genomes = new string[](n);
        for (uint256 i; i < n; ++i) {
            genomes[i] = string.concat("organism ", vm.toString(i));
        }
        vm.prank(owner);
        population.spawnGenesis(genomes);
        _fundCognition(population.prophetCount());
    }
```

Newly hatched children are funded by `cognitionEndowment`, which is 0 by default — so any test that breeds and then runs another window must either set `cognitionEndowment` via `setSeason` or call `_fundCognition` again. Prefer setting it once in `setUp`:

```solidity
        vm.prank(owner);
        population.setSeason(10 * ONE, 0.1 ether);
```

- [ ] **Step 7: Run the new tests**

```bash
forge test --root contracts --match-test "test_cognition_" -vv
```

Expected: all four PASS. Note `test_cognition_failedRequestsDoNotHaltPopulation` (`:373`) already exists and must also still pass — it uses `_makeThinkingFatal`, which is about metabolism rather than native balance, so it should be unaffected.

- [ ] **Step 8: Run the full suite and repair the fallout**

```bash
npm test
```

Expected: tests that breed and continue may now abstain unexpectedly if children have no native balance. Fix by ensuring `cognitionEndowment` is set in `setUp`, not by giving the child balance inside individual tests.

- [ ] **Step 9: Gate, then commit**

```bash
npm test && npm run build
```

Both must pass before the commit.

```bash
git add contracts/src/Population.sol contracts/src/Prophet.sol contracts/test/Darwin.t.sol
git commit -m "feat(arena): organisms pay for their own cognition

This is the change that removes the cost centre. think() previously sent
requestDeposit() per living organism from Population's own native
balance, and nothing is refunded, so the protocol's bill grew linearly
with evolutionary success — and success is the goal.

Now each organism holds native STT and think() draws from it. An
organism that cannot afford to think abstains, opens an empty position,
and still pays metabolism. Dying because you can no longer afford to
think is the intended selection pressure, not a failure mode.

- Prophet.drawCognition returns what it could afford rather than
  reverting, so one broke organism cannot halt the window
- Population.topUpCognition is payable and permissionless: it can only
  move value INTO an organism, and buying someone's cognition confers
  no control over what they conclude
- spawnGenesis is payable; newborns get cognitionEndowment
- _requestMutation ALSO draws from the parent. Breeding is an inference,
  so leaving it house-paid would have left the recurring bill growing
  with evolutionary success — the exact dynamic this removes. An
  organism that cannot afford to reproduce keeps its streak and its
  surplus and may breed in a later window (BreedingUnaffordable).
  The earlier objection, that this drains a parent mid-settlement,
  confused two balances: settleWindow moves collateral, drawCognition
  moves native, and they do not interact
- Zero new storage. A native balance is address(this).balance, and
  Prophet already had receive() external payable

Known leak, bounded and observable: if createAdvancedRequest reverts
after the draw, up to one deposit stays in Population. It is now an
ENTRANT's STT rather than the house's own, so it is emitted as
CognitionUnspent(prophetId, amount) and reconciled by the operator. Not
refunded inside think()'s loop because that scope is already at the
--via-ir stack limit. ThinkFailed's signature is unchanged on purpose:
monitor.ts filters on its topic0.

The protocol's only recurring cost is now cadence gas, so
sustainability reduces to metabolicCost * aliveCount > gas per window."
```

---

### Task 4: Escalating ante, seasons, prize pool, and explicit rake

The largest task, and the one that adds declarations — so it is the one whose storage layout must be compiler-verified.

> **CORRECTED WHILE IMPLEMENTING, 2026-08-30. Six things below are wrong; the shipped shape is what is described here.**
>
> Storage landed exactly as predicted — packed season group at slot 33, `baseAnte` 34, `rakeAccrued` 35, `prizePool` 36, `__gap uint256[10]` at 37, `Prophet` byte-identical — so Steps 3 and 10 need no correction and are the parts of this task to trust. The defects are all in Step 1's tests and Step 6's `endSeason`.
>
> **1. `test_ante_isFlatWithinALevelAndIgnoresTreasury` cannot pass as written.** It mints to `address(population)` and then calls `vm.prank(owner); population.fundProphet(...)`, but `fundProphet` pulls with `transferFrom(msg.sender, ...)` — so the pranked owner has neither the balance nor the allowance. The shipped test uses the pattern `_breedingCandidate` already uses: mint to `address(this)`, `approve`, and **no prank at all**.
>
> **2. `test_season_endsPermissionlesslyAndPaysTheEntrant` never asserted the payout its name promises** — only `seasonId`. The shipped version asserts the entrant's balance rose by 60% of the pot, that `seasonStartWindow == windowCount`, and that `prizePool` holds exactly the unawarded remainder. A test that would pass against an `endSeason` which paid nobody is not a test of a payout.
>
> **3. Step 9's `test_accounting_…` is near-vacuous.** `assertLe(booked, balance)` compares two books against a ~10,000 tUSDC harness float, so it passes for almost any bug. The shipped version brackets the three windows and asserts **`booked - bookedBefore == held - heldBefore`** plus an `assertGt` for non-vacuity — sound because pairing nets to zero through `Population` and redemption pays the organism directly, so the only thing that may move the arena's balance across those windows is income the books name.
>
> **4. `_topThree()` was split out from the start**, not as the stack-error contingency Step 6 describes. The search alone holds two fixed arrays and a signed score; splitting it is the remedy the plan already sanctions, and doing it up front avoids a build-fail cycle for nothing.
>
> **5. The rake forces a FIFTH winner-net assertion the plan does not list.** Step 9 names four; `test_creditedPayout_survivesAnUnavailableClaim` is the fifth. The skim is levied on **worth-based** profit (`collateralOut - staked`) and clamped to `treasury`, so a winner whose payout was credited rather than transferred still owes it — and the later `claimOwed` rescue is untaxed, which is what makes it rake-once rather than rake-twice. Any implementation that skims the balance delta instead would leave that assertion failing, which is the point of having it.
>
> **6. `Seed.s.sol` does not call the two-argument `setSeason`.** Recorded because it was an open risk while implementing: that file is unreadable to the implementing session, so a stale call site would have been a compile error in a file that could not be edited. It compiles clean against the struct form. No `.ts` script calls `setSeason` either — only the ABI in `scripts/lib/darwin.ts` declared it.
>
> **Process note:** an em dash inside a Solidity **string literal** is `Error (8936): Invalid character in string`. This codebase's comments use them everywhere and safely; an assertion message is a literal, and that is the one place they cannot go.

**Files:**
- Modify: `contracts/src/Population.sol` — storage, `initialize`, `_pair`/`_stakeOf` (`:477-536`), `settleAll` (`:551-577`), `setSeason`, new `withdrawRake`, new `endSeason`
- Modify: `contracts/src/Prophet.sol` — `settleWindow` return signature (`:310-313`, `:383-389`)
- Test: `contracts/test/Darwin.t.sol`
- Modify: `STORAGE.md`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces:
  - `Population.ante() returns (uint256)` and `Population.level() returns (uint32)`
  - `Population.rakeAccrued()`, `prizePool()`, `seasonId()`, `seasonStartWindow()`, `seasonWindows()`, `levelWindows()`, `baseAnte()`, `anteMultBps()`, `rakeBps()`
  - `Population.prizeShareBps()`
  - `Population.SeasonParams` — a struct with named fields `minEndowment`, `cognitionEndowment`, `baseAnte`, `anteMultBps`, `levelWindows`, `seasonWindows`, `rakeBps`, `prizeShareBps`
  - `Population.setSeason(SeasonParams calldata s)` — **replaces Task 2's two-argument version**; every earlier call site is rewritten in Step 7
  - `Population.withdrawRake(address to, uint256 amount)` — `onlyOwner`, draws only against `rakeAccrued`
  - `Population.endSeason()` — permissionless once the season is over
  - `Population.EndowmentBelowAnte(uint256 supplied, uint256 required)` — the second entry floor
  - `Prophet.settleWindow(address venue, address collateral, uint256 metabolicCost, uint16 rakeBps_) returns (uint256 collateralOut, bool starved, uint256 charged, uint256 raked)` — **one parameter and two return values added**

- [ ] **Step 1: Write the failing tests**

First two harness helpers, next to the existing `_econ()` / `_setEconomics()` pair they are modelled
on. Read-modify-write is the only safe shape here: `setSeason` takes eight fields, and a test that
wants to change one of them must not have to restate the other seven.

```solidity
    /// @dev Read the live season into a struct so a test can change ONE field and
    ///      write it back. Every read happens outside the prank, which is the whole
    ///      point — `vm.prank` binds to the next call and a `view` read IS a call,
    ///      so `population.setSeason(_season())` would consume the prank on the
    ///      first getter and send the real transaction unpranked.
    function _season() internal view returns (Population.SeasonParams memory s) {
        s.minEndowment = population.minEndowment();
        s.cognitionEndowment = population.cognitionEndowment();
        s.baseAnte = population.baseAnte();
        s.anteMultBps = population.anteMultBps();
        s.levelWindows = population.levelWindows();
        s.seasonWindows = population.seasonWindows();
        s.rakeBps = population.rakeBps();
        s.prizeShareBps = population.prizeShareBps();
    }

    function _setSeason(Population.SeasonParams memory s) internal {
        vm.prank(owner);
        population.setSeason(s);
    }
```

Then the tests:

```solidity
function test_ante_isFlatWithinALevelAndIgnoresTreasury() public {
    _seed(2);
    // Make one organism rich. Under the old min()-of-proportional rule this
    // capped exposure at the poorer side; under a flat ante it must not matter.
    collateral.mint(address(population), 1_000 * ONE);
    vm.prank(owner);
    population.fundProphet(1, 1_000 * ONE);

    uint256 expected = population.ante();
    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _answer(2, "DOWN_REVERSION");
    _commit();

    assertEq(_p(1).currentStake(), expected, "rich organism did not risk the ante");
    assertEq(_p(2).currentStake(), expected, "poor organism did not risk the ante");
}

function test_ante_escalatesByLevel() public {
    Population.SeasonParams memory s = _season();
    s.baseAnte = 1 * ONE;
    s.levelWindows = 2;
    _setSeason(s);

    assertEq(population.level(), 0, "level should start at 0");
    uint256 l0 = population.ante();

    // windowCount advances once per think(); drive two windows to reach level 1.
    _seed(2);
    _upWins();
    for (uint256 i; i < 2; ++i) {
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();
    }

    assertEq(population.level(), 1, "level did not advance");
    assertEq(population.ante(), l0 * 2, "ante did not double at level 1");
}

function test_rake_isBookedSeparatelyFromEntrantCollateral() public {
    _seed(2);
    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _answer(2, "DOWN_REVERSION");
    _commit();

    uint256 rakeBefore = population.rakeAccrued();
    uint256 poolBefore = population.prizePool();
    uint256 staked = _p(1).currentStake(); // read before settlement zeroes it
    _settle();

    // Income this window is BOTH revenue lines: rent from both organisms, plus the
    // skim on the winner's profit — which under a flat ante is exactly the ante,
    // because the winner redeems 2x what it risked.
    uint256 income = 2 * population.metabolicCost() + (staked * population.rakeBps()) / 10_000;
    uint256 toPool = (income * population.prizeShareBps()) / 10_000;
    assertGt(toPool, 0, "test is vacuous: prizeShareBps or income is zero");

    assertEq(population.prizePool() - poolBefore, toPool, "pool did not take its share of income");
    assertEq(population.rakeAccrued() - rakeBefore, income - toPool, "revenue not booked as rake");
}

function test_rake_isTakenOnProfitNotOnGrossRedemption() public {
    _seed(2);
    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _answer(2, "DOWN_REVERSION");
    _commit();

    uint256 staked = _p(1).currentStake();
    uint256 held = _p(1).treasury(); // endowment minus the ante it just risked
    _settle();

    // A paired mintSet gives each side `2 * staked` tokens for `staked` risked, so
    // the winner's redemption is 2x and its PROFIT is exactly `staked`. Taxing the
    // gross would take twice this and would tax the organism's own returned stake.
    uint256 skim = (staked * population.rakeBps()) / 10_000;
    assertGt(skim, 0, "test is vacuous: rakeBps or the ante is zero");
    assertEq(
        _p(1).treasury(),
        held + 2 * staked - skim - population.metabolicCost(),
        "winner's net is not redemption - skim - rent"
    );
    _assertLedgerMatchesBalance(1);
}

function test_rake_withdrawalCannotTouchEntrantCollateral() public {
    _seed(2);
    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _answer(2, "DOWN_REVERSION");
    _commit();
    _settle();

    uint256 accrued = population.rakeAccrued();
    vm.prank(owner);
    vm.expectRevert(Population.RakeExceeded.selector);
    population.withdrawRake(owner, accrued + 1);

    vm.prank(owner);
    population.withdrawRake(owner, accrued);
    assertEq(population.rakeAccrued(), 0, "rake not drawn down");
}

function test_death_residueForfeitsToThePrizePool() public {
    _seed(2);
    _makeThinkingFatal();

    uint256 poolBefore = population.prizePool();
    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _answer(2, "DOWN_REVERSION");
    _commit();
    _settle();

    assertGt(population.prizePool(), poolBefore, "residue did not reach the prize pool");
    // And nothing is stranded in a dead organism.
    assertEq(_p(1).treasury(), 0, "dead organism still holds a ledger balance");
    assertEq(collateral.balanceOf(address(_p(1))), 0, "dead organism still holds collateral");
}

function test_season_endsPermissionlesslyAndPaysTheEntrant() public {
    address alice = address(0xA11CE);
    collateral.mint(alice, 100 * ONE);
    vm.startPrank(alice);
    collateral.approve(address(population), 100 * ONE);
    population.enter("momentum", 10 * ONE);
    vm.stopPrank();
    _fundCognition(population.prophetCount());

    Population.SeasonParams memory s = _season();
    s.seasonWindows = 1;
    _setSeason(s);

    _upWins();
    _think();
    _answer(1, "UP_MOMENTUM");
    _commit();
    _settle();

    // Season length is one window, so anyone may close it.
    uint256 seasonBefore = population.seasonId();
    vm.prank(address(0xDEAD));
    population.endSeason();
    assertEq(population.seasonId(), seasonBefore + 1, "season did not roll over");
}

function test_enter_refusesAnEndowmentThatCannotCoverTheAnte() public {
    // Put the OTHER floor out of the way so this test can only pass or fail on the
    // ante floor. `minEndowment` is a fixed number; the ante doubles every level,
    // so these are genuinely two different checks and only one of them tracks the
    // climate.
    Population.SeasonParams memory s = _season();
    s.minEndowment = 1;
    s.baseAnte = 10 * ONE;
    _setSeason(s);

    address bob = address(0xB0B);
    collateral.mint(bob, 100 * ONE);
    vm.startPrank(bob);
    collateral.approve(address(population), 100 * ONE);
    // Parameterized error, so the WHOLE revert data must be matched — a bare
    // selector fails here for the reason CLAUDE.md documents.
    vm.expectRevert(abi.encodeWithSelector(Population.EndowmentBelowAnte.selector, 20 * ONE, 40 * ONE));
    population.enter("dead on arrival", 20 * ONE);
    vm.stopPrank();
}
```

- [ ] **Step 2: Run them to verify they fail**

```bash
forge test --root contracts --match-test "test_ante_|test_rake_|test_death_residue|test_season_|test_enter_refuses" -vv
```

Expected: compile errors for every new symbol.

- [ ] **Step 3: Add the season storage**

Immediately before `__gap` — `uint256[14]` after Task 2 — add:

```solidity
    // --- seasons, ante schedule, and revenue ---
    // Packs into one slot: 4 + 8 + 4 + 4 + 2 + 2 + 2 = 26 bytes.
    uint32 public seasonId;
    uint64 public seasonStartWindow;
    uint32 public seasonWindows; // season length; endSeason opens after this many
    uint32 public levelWindows; // windows per ante level
    uint16 public anteMultBps; // ante multiplier per level, in bps of 10_000
    uint16 public rakeBps; // skim on a winning settlement, in bps of PROFIT
    uint16 public prizeShareBps; // share of ALL income diverted to the pot

    uint256 public baseAnte; // the level-0 ante
    uint256 public rakeAccrued; // protocol revenue, withdrawable
    uint256 public prizePool; // forfeited residues + prizeShareBps of income
```

and shrink the gap to `uint256[10]` — four slots consumed: one packed group plus three `uint256`. The packed group lands on a fresh slot with no padding needed, because the declaration before it (`cognitionEndowment`) is a full-width `uint256`. Packing NEW variables with EACH OTHER is fine; the rule `CLAUDE.md` states is about packing into slots that already hold live data.

That leaves **10 of the original 20 gap slots**, which is the budget for post-freeze repairs after Sep 2. Spend the rest deliberately.

Add the errors:

```solidity
    error RakeExceeded();
    error SeasonNotOver();
```

In `initialize`, after the `cognitionEndowment` line:

```solidity
        // The ante is FLAT within a level and ESCALATES between them, which is the
        // mechanism that makes a season terminate. Under the old proportional
        // rule — min() of 10%-of-treasury on both sides — a 1,000 tUSDC organism
        // facing 10 tUSDC opponents risked 1 tUSDC per window against 0.05 of
        // rent, so it survived ~950 windows losing EVERY call and ~20,000 at even
        // odds. A flat ante alone does not fix that (0.25 + 0.05 per window is
        // still ~3,300 windows); geometric escalation does, in a logarithmic
        // number of levels. It is also the honest metaphor: the climate hardens.
        baseAnte = minStake; // 0.25 tUSDC
        anteMultBps = 20_000; // doubles per level

        // 72 windows per level = ~18h at a 15-minute cadence, so level 6 (ante 16
        // tUSDC, above a 10 tUSDC entry) arrives at window 432 and the arena is
        // still populated when the season closes at 576. levelWindows = 24 was the
        // first draft and was WRONG for a 576-window season: level 6 would land at
        // window 144 and rent alone would empty the arena by ~window 200-340,
        // leaving roughly 300 windows of empty arena with a leaderboard on it —
        // during the judging period. The two numbers are a pair: changing one
        // without the other is what produces either an unfinishable season or an
        // extinct one.
        levelWindows = 72;
        seasonWindows = 576; // ~6 days

        rakeBps = 250; // 2.5% of a winner's PROFIT, not of its gross redemption
        prizeShareBps = 4_000; // 40% of income funds the pot; 60% is revenue
        seasonStartWindow = 0;
        seasonId = 1;
```

`stakeBps` and `minStake` stay declared — the layout is append-only and the test suite's `Econ` struct depends on them. `minStake` remains the pairing floor; `stakeBps` becomes unused, and its declaration should say so.

- [ ] **Step 4: Replace proportional staking with the escalating ante**

Replace `_stakeOf` (`:534-536`) with the schedule, and add the public views:

```solidity
    /// @dev Windows elapsed in this season, divided into ante levels.
    function level() public view returns (uint32) {
        if (windowCount <= seasonStartWindow || levelWindows == 0) return 0;
        return uint32((windowCount - seasonStartWindow) / levelWindows);
    }

    /**
     *  The flat amount every organism risks this window.
     *
     *  Capped at 40 doublings so the loop cannot be turned into a gas bomb by a
     *  season left running for months; at 40 levels the ante already exceeds any
     *  plausible treasury by many orders of magnitude, so the cap is unreachable
     *  in practice and exists only to bound the arithmetic.
     */
    function ante() public view returns (uint256 a) {
        a = baseAnte;
        uint32 l = level();
        if (l > 40) l = 40;
        for (uint32 i; i < l; ++i) {
            a = (a * anteMultBps) / 10_000;
        }
    }
```

Replace `_pair` (`:477-496`) so both sides risk the same absolute amount:

```solidity
    function _pair(Prophet up, Prophet down) internal {
        uint256 want = ante();

        // An organism that cannot cover the ante is not paired. It still opens an
        // empty position and still pays metabolism, so it dies shortly after —
        // which is clean elimination rather than a special case.
        if (want < minStake || up.treasury() < want || down.treasury() < want) {
            _openEmpty(up, activeUpId);
            _openEmpty(down, activeDownId);
            return;
        }

        try this.executePair(up, down, want) {
            // handled in executePair
        } catch {
            emit CommitFailed(up.prophetId());
            emit CommitFailed(down.prophetId());
            _openEmpty(up, activeUpId);
            _openEmpty(down, activeDownId);
        }
    }
```

- [ ] **Step 5: Skim the rake on profit, and split protocol income**

Two revenue lines start existing in this step, and `BUSINESS_PLAN.md` §6 lists them separately:
rent (metabolism), which until now vanished into a balance indistinguishable from custody, and
**the rake on a winning settlement**, which does not exist at all — before this step `rakeBps` is
declared, initialized, settable and publicly readable, and **read by nothing**.

In `contracts/src/Prophet.sol`, extend `settleWindow` — one parameter in, two return values out:

```solidity
    function settleWindow(address venue, address collateral, uint256 metabolicCost, uint16 rakeBps_)
        external
        onlyPopulation
        returns (uint256 collateralOut, bool starved, uint256 charged, uint256 raked)
    {
```

`rakeBps_` is passed in rather than read back through `IPopulationConfig` for the same reason
`metabolicCost` already is: every economic parameter lives in `Population` so the run is
recalibrable from one call without a beacon upgrade, and `settleWindow` is `onlyPopulation`, so
there is exactly one caller to keep in step.

Insert the skim AFTER `bool won = collateralOut > staked;` and after `treasury += received;`
(`Prophet.sol:384-390`), and BEFORE the metabolism block:

```solidity
        // THE RAKE — taken on PROFIT, never on the gross redemption, and that is
        // why it sits after the grading rather than before it. A paired mintSet
        // hands each side `amount` tokens for `amount / 2` risked
        // (`Population.executePair`, :536-539), so a winner redeems ~2x its stake:
        // skimming the gross would tax the organism's own returned collateral at
        // twice the intended rate. It would also tax a VOIDED market, which pays
        // both sides 0.5 and is deliberately scored as neither a win nor a loss.
        // `won` is already `collateralOut > staked`, so reuse it rather than
        // recomputing a second, subtly different, definition of winning.
        //
        // Computed from WORTH but paid out of CUSTODY — the same distinction that
        // makes `collateralOut` and `received` different numbers — so it is clamped
        // to `treasury`. A winner can never be STARVED by this: the skim is a small
        // fraction of a gain realized in this very call. The clamp is there because
        // a settlement that CREDITED rather than paid would otherwise underflow.
        if (won && rakeBps_ > 0) {
            uint256 skim = ((collateralOut - staked) * rakeBps_) / 10_000;
            if (skim > treasury) skim = treasury;
            if (skim > 0) {
                treasury -= skim;
                raked = skim;
                if (!IERC20Like(collateral).transfer(population, skim)) revert TransferFailed();
            }
        }
```

Keep `skim` inside that block's scope. `settleWindow` is not on `CLAUDE.md`'s list of
stack-fragile functions, but it now carries four named returns plus `quantity`, `staked`,
`received` and `won`; a local that stays live to the end of the body is the cheapest way to put it
on that list.

Then the metabolism block (`:415-418`) assigns the third return instead of a local:

```solidity
        charged = treasury >= metabolicCost ? metabolicCost : treasury;
        starved = charged < metabolicCost;
        treasury -= charged;
        if (charged > 0 && !IERC20Like(collateral).transfer(population, charged)) revert TransferFailed();
```

Replace the later uses of the old `charge` local in the same function with `charged`.

In `contracts/src/Population.sol`, add the one place income is divided — next to `_breedThreshold`:

```solidity
    /**
     *  Split protocol income between the prize pool and withdrawable revenue.
     *
     *  EVERY unit of collateral this contract takes from an organism passes through
     *  here — rent, and the rake on a winning settlement — so the split is decided
     *  in one place and the two counters can be audited against the balance
     *  together. `BUSINESS_PLAN.md` §8 funds the pot from forfeited residues AND a
     *  share of the rake; `prizeShareBps` is that share.
     *
     *  Forfeited residue does NOT come through here. It goes to `prizePool` whole,
     *  which is the only thing "residue forfeits to the prize pool" can honestly
     *  mean when it is said to an entrant.
     */
    function _book(uint256 amount) internal {
        if (amount == 0) return;
        uint256 toPool = (amount * prizeShareBps) / 10_000;
        prizePool += toPool;
        rakeAccrued += amount - toPool;
    }
```

Now `settleAll`'s loop body. **Three things carry over from Task 2A and must not be dropped:** the
loop runs BACKWARDS, it indexes `prophets[living[i - 1] - 1]`, and a reap calls `_removeLiving`.

```solidity
        address v = venue;
        uint16 rb = rakeBps;

        // Backwards — see Task 2A. A reap swap-removes from `living` and the
        // element that fills the hole comes from the end.
        for (uint256 i = living.length; i > 0; --i) {
            Prophet p = Prophet(payable(prophets[living[i - 1] - 1]));
            if (p.dead() || !p.positionOpen()) continue;

            try p.settleWindow(v, collateral, metabolicCost, rb) returns (
                uint256, bool starved, uint256 charged, uint256 raked
            ) {
                // Rent plus skim, booked as revenue and pot rather than left
                // indistinguishable from collateral this contract merely routes.
                _book(charged + raked);

                if (starved || p.treasury() < metabolicCost) {
                    // RESIDUE FORFEITS, WHOLE. Drain BEFORE die(): `stakeOut`
                    // carries the `alive` modifier (`Prophet.sol:266-269`), so the
                    // reverse order reverts and strands the collateral inside a
                    // dead organism permanently.
                    uint256 residue = p.treasury();
                    if (residue > 0) prizePool += p.stakeOut(address(this), residue, collateral);
                    p.die(windowCount);
                    aliveCount -= 1;
                    _removeLiving(p.prophetId());
                    emit Reaped(p.prophetId(), windowCount, aliveCount);
                } else if (p.streak() >= breedStreak && p.treasury() >= _breedThreshold()) {
                    _requestMutation(p);
                }
            } catch {
                emit SettleFailed(p.prophetId());
            }
        }
```

`rakeBps` is hoisted into `rb` before the loop: it cannot change mid-loop, and re-reading a
`uint16` out of a packed slot once per organism per window buys nothing.

- [ ] **Step 6: Replace `setSeason`, harden `enter`, add `withdrawRake` and `endSeason`**

Declare the parameter struct next to `Wiring`:

```solidity
    /**
     *  Season parameters, as a struct rather than eight positional arguments.
     *
     *  This is not style. `levelWindows` and `seasonWindows` are adjacent `uint32`s
     *  whose names are one word apart, and `anteMultBps`, `rakeBps` and
     *  `prizeShareBps` are three adjacent `uint16`s the compiler cannot tell apart.
     *  A transposition compiles, deploys, and becomes visible several hundred
     *  windows later — as a season that ends before its first ante level, or an
     *  ante that never escalates. `setEconomics`'s seven positional arguments are
     *  already recorded in this plan's Global Constraints as a documented footgun
     *  that cost fourteen test failures once; this is the one place where the same
     *  mistake has not been made yet.
     */
    struct SeasonParams {
        uint256 minEndowment;
        uint256 cognitionEndowment;
        uint256 baseAnte;
        uint16 anteMultBps;
        uint32 levelWindows;
        uint32 seasonWindows;
        uint16 rakeBps;
        uint16 prizeShareBps;
    }
```

A struct is safe to add at any time — it is a type, not storage, so it consumes no slot and cannot
move one.

Replace the two-argument `setSeason` written in Task 2 Step 6:

```solidity
    function setSeason(SeasonParams calldata s) external onlyOwner {
        minEndowment = s.minEndowment;
        cognitionEndowment = s.cognitionEndowment;
        baseAnte = s.baseAnte;
        anteMultBps = s.anteMultBps;
        levelWindows = s.levelWindows;
        seasonWindows = s.seasonWindows;
        rakeBps = s.rakeBps;
        prizeShareBps = s.prizeShareBps;
    }
```

Then harden `enter` (Task 2 Step 6), which until now had only `minEndowment` to check because no
ante existed yet. Add the second floor immediately after the first:

```solidity
        if (endowmentAmount < minEndowment) revert EndowmentTooSmall();

        // THE ANTE FLOOR. An organism that cannot cover several antes is dead on
        // arrival: it pays rent every window whether or not it is paired, and it is
        // not paired AT ALL if it cannot cover the ante — so at 1x the ante an
        // entry is not a bet, it is a donation to the prize pool. Taking a
        // stranger's collateral for that is the kind of detail that makes "anyone
        // can enter" true in the letter and false in the substance.
        //
        // `minEndowment` cannot express this on its own, because the ante DOUBLES
        // every `levelWindows`: a fixed 10 tUSDC floor that is generous at level 0
        // is unplayable by level 6, and an owner would have to raise it by hand on
        // a schedule. Four antes is the smallest multiple that survives a losing
        // streak long enough to be graded rather than eliminated by arithmetic.
        uint256 floor = 4 * ante();
        if (endowmentAmount < floor) revert EndowmentBelowAnte(endowmentAmount, floor);
```

and declare its error alongside the two added in Step 3:

```solidity
    error EndowmentBelowAnte(uint256 supplied, uint256 required);
```

Parameterized deliberately: it is the error most likely to be met by a stranger's transaction,
`scripts/lib/darwin.ts` carries the custom-error fragments so a revert reads as a sentence, and both
numbers are needed for the sentence to say anything. Note the consequence for tests —
`vm.expectRevert(bytes4)` compares the WHOLE revert data, so this one needs
`abi.encodeWithSelector(Population.EndowmentBelowAnte.selector, supplied, required)`.

Task 2's `test_entry_rejectsBelowMinEndowment` still passes unchanged apart from its `setSeason`
call: it sets `minEndowment = 10 tUSDC` and enters with 9, while the ante floor at level 0 is
`4 x 0.25 = 1 tUSDC`, so `EndowmentTooSmall` is still the error that fires. That ordering is worth
keeping — the fixed floor is the cheaper check and the more legible message.

Then the two functions that spend and close:

```solidity
    /**
     *  Draw down protocol revenue.
     *
     *  Bounded by rakeAccrued, so this can never reach an entrant's collateral
     *  even though both sit in this contract's balance. `sweep` remains as the
     *  emergency escape but stops being the revenue path — an owner function that
     *  cannot distinguish revenue from custody is not an accounting system.
     */
    function withdrawRake(address to, uint256 amount) external onlyOwner {
        if (amount > rakeAccrued) revert RakeExceeded();
        rakeAccrued -= amount;
        if (!IERC20Like(collateral).transfer(to, amount)) revert TransferFailed();
    }

    /**
     *  Close the season and open the next.
     *
     *  Permissionless once the season is over, so a season cannot be held open by
     *  an absent owner — the payout is a promise to entrants and must not depend
     *  on us being awake.
     *
     *  Pays 60/30/10 to the top three SURVIVING organisms by net correct calls,
     *  to each one's entrant. If fewer than three survive, the remainder rolls
     *  into the next season's pool rather than to the house: the alternative
     *  gives the operator a reason to prefer mass extinction.
     */
    function endSeason() external {
        if (windowCount < seasonStartWindow + seasonWindows) revert SeasonNotOver();

        uint256[3] memory bestId;
        int256[3] memory bestScore;
        bestScore[0] = type(int256).min;
        bestScore[1] = type(int256).min;
        bestScore[2] = type(int256).min;

        uint256 n = prophets.length;
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[i]));
            if (p.dead()) continue;
            int256 score = int256(uint256(p.correctCount())) - int256(uint256(p.wrongCount()));
            if (score > bestScore[0]) {
                bestScore[2] = bestScore[1];
                bestId[2] = bestId[1];
                bestScore[1] = bestScore[0];
                bestId[1] = bestId[0];
                bestScore[0] = score;
                bestId[0] = p.prophetId();
            } else if (score > bestScore[1]) {
                bestScore[2] = bestScore[1];
                bestId[2] = bestId[1];
                bestScore[1] = score;
                bestId[1] = p.prophetId();
            } else if (score > bestScore[2]) {
                bestScore[2] = score;
                bestId[2] = p.prophetId();
            }
        }

        uint256 pot = prizePool;
        uint16[3] memory splitBps = [uint16(6000), 3000, 1000];
        uint256 paid;
        for (uint256 k; k < 3; ++k) {
            if (bestId[k] == 0) continue;
            uint256 cut = (pot * splitBps[k]) / 10_000;
            address to = Prophet(payable(prophetAt(bestId[k]))).entrant();
            if (to == address(0) || cut == 0) continue;
            if (!IERC20Like(collateral).transfer(to, cut)) revert TransferFailed();
            paid += cut;
        }

        // Whatever was not paid rolls forward.
        prizePool = pot - paid;
        seasonId += 1;
        seasonStartWindow = windowCount;
        emit SeasonEnded(seasonId - 1, pot, paid);
    }
```

Add the event next to the others:

```solidity
    event SeasonEnded(uint32 indexed season, uint256 pot, uint256 paid);
```

**Stack-limit warning:** `endSeason` holds three fixed arrays and several locals. If `forge build` reports a stack error under `--via-ir`, split the winner search into an internal `_topThree()` returning the ids, rather than reducing the number of winners.

- [ ] **Step 7: Update the test harness for the new stake rule and the new `setSeason`**

`_stake()` (`Darwin.t.sol:229-231`) computes `endowment * stakeBps / 10_000`. It is the single point
every staking assertion reads through, which is why this refactor is survivable. Change it:

```solidity
    function _stake() internal view returns (uint256) {
        return population.ante();
    }
```

Then rewrite the two `setSeason` call sites written in earlier tasks. Replacing a signature means
they will not compile, so this is not fallout to discover in Step 9 — it is part of this step:

1. Task 2 Step 1, in `test_entry_rejectsBelowMinEndowment`:

```solidity
    // was: vm.prank(owner); population.setSeason(10 * ONE, 0);
    Population.SeasonParams memory s = _season();
    s.minEndowment = 10 * ONE;
    s.cognitionEndowment = 0;
    _setSeason(s);
```

2. Task 3 Step 6, in `setUp`:

```solidity
    // was: vm.prank(owner); population.setSeason(10 * ONE, 0.1 ether);
    Population.SeasonParams memory s = _season();
    s.minEndowment = 10 * ONE;
    s.cognitionEndowment = 0.1 ether;
    _setSeason(s);
```

Both go through `_season()` rather than restating all eight fields, so a later change to a default
in `initialize` does not silently reset six unrelated parameters in the harness.

- [ ] **Step 8: Run the new tests**

```bash
forge test --root contracts --match-test "test_ante_|test_rake_|test_death_residue|test_season_|test_enter_refuses" -vv
```

Expected: all eight PASS.

- [ ] **Step 9: Run the full suite and repair the fallout**

```bash
npm test
```

Expected failures and how to fix each:
- **`Prophet.settleWindow`'s arity changed twice in this plan** — Task 1 added `venue`, this task adds `rakeBps_` and two return values. Run `grep -rn "settleWindow" contracts/` before `npm test` so every caller and mock is a known list rather than a sequence of compile errors.
- `test_pairing_winnerNetsLoserStake` (`:390`) asserts the winner nets exactly the loser's stake. It now nets **stake minus the skim**, so the assertion must subtract `(stake * population.rakeBps()) / 10_000`. Do NOT repair this by zeroing `rakeBps` in the harness: that deletes the coverage this task exists to add. The test's name stays true — the skim is the house's cut of that stake, not a different stake.
- Any test manipulating `stakeBps` to change stake size (`test_dustStakeOpensEmptyAndStillPays` at `:554` is the likely one) must set `baseAnte` through `_season()`/`_setSeason` instead.
- Tests asserting Population's collateral balance after settlement may now need to account for `rakeAccrued` and `prizePool` being tracked.
- `_assertLedgerMatchesBalance` must still hold for every organism: the skim decrements `treasury` and transfers in the same breath, exactly as metabolism does. If it fails, the skim was booked without being moved.

Add one more test capturing the invariant that makes the accounting trustworthy:

```solidity
function test_accounting_rakeAndPoolAndTreasuriesNeverExceedHoldings() public {
    _seed(4);
    _upWins();
    for (uint256 w; w < 3; ++w) {
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "UP_MOMENTUM");
        _answer(3, "DOWN_REVERSION");
        _answer(4, "DOWN_REVERSION");
        _commit();
        _settle();
    }

    uint256 booked = population.rakeAccrued() + population.prizePool();
    assertLe(booked, collateral.balanceOf(address(population)), "books claim more than the contract holds");

    for (uint256 id = 1; id <= 4; ++id) {
        _assertLedgerMatchesBalance(id);
    }
}
```

- [ ] **Step 10: Re-verify the storage layout against the compiler**

This task added declarations, and unlike the earlier `perAgentReward` change, **adding declarations can move slots.** Reasoning is not sufficient here.

```bash
cd C:/Users/Handi/Desktop/somnia_predict/darwin
forge clean --root contracts
forge build --root contracts --extra-output storageLayout
forge inspect --root contracts Population storage-layout > "$CLAUDE_JOB_DIR/tmp/pop-layout.txt"
forge inspect --root contracts Prophet storage-layout > "$CLAUDE_JOB_DIR/tmp/prophet-layout.txt"
```

`forge inspect` previously returned *"storage layout missing from artifact"* even with `--extra-output storageLayout`; the `forge clean` before the `via_ir` rebuild is what fixes it. If it still fails, report that rather than asserting the layout is fine.

Assert six things from the output:
1. `Prophet.positionOpen` is still at **slot 15, offset 0**, and **nothing else shares that slot** — the packing `CLAUDE.md` forbids did not happen by accident. Thirty-one spare bytes next to a `bool` is the most inviting place in the contract to "just add a flag", and this task adds none.
2. `Prophet.__slotAlign` occupies **slot 16**, unused, which is the whole reason (1) holds.
3. `Prophet.entrant` occupies **slot 17 alone**, at offset 0.
4. `Prophet.__gap` begins at **slot 18** and has **18** entries.
5. Every pre-existing `Population` declaration is at the slot it occupied before this plan — `phase` still at 26 with its spare bytes still spare — and the new declarations sit between `phase` and `__gap`, in this order: `__slotAlign` **27** (Task 1), `venue` **28** (Task 1), `living` **29** (Task 2A), `livingIndex` **30** (Task 2A), `minEndowment` **31** (Task 2), `cognitionEndowment` **32** (Task 2), the packed season group **33** (this task), `baseAnte` **34**, `rakeAccrued` **35**, `prizePool` **36**.
6. `Population.__gap` begins at **slot 37** and has **10** entries. `20 - 2 - 2 - 2 - 4 = 10`: two for Task 1, two for Task 2A, two for Task 2, four for this task. If the number is not 10, one of the four tasks consumed a slot it did not declare — an `address` after a `bool` silently packs, and a `uint256` pad silently does not, so the arithmetic is the only thing that catches a miscount.

Also assert that the packed season group really is **one** slot: `seasonId`, `seasonStartWindow`,
`seasonWindows`, `levelWindows`, `anteMultBps`, `rakeBps` and `prizeShareBps` must all report slot
**33** with ascending offsets 0, 4, 12, 16, 20, 22, 24. Twenty-six of thirty-two bytes used. If any
of them reports slot 34, the group split and every number in (5) and (6) above is off by one.

Then regenerate `STORAGE.md` with the new layout and a changelog entry naming this plan.

- [ ] **Step 11: Gate, then commit**

All three gates before the commit — this is the task that moved storage, so the layout check is part of the gate, not a follow-up:

```bash
npm test && npm run build
```

Expected: full suite green, including `test_upgrade_preservesEveryOrganismField` with `entrant` added to it, and the storage layout from Step 10 verified against `STORAGE.md`.

```bash
git add contracts/src/Population.sol contracts/src/Prophet.sol \
        contracts/test/Darwin.t.sol STORAGE.md
git commit -m "feat(arena): escalating ante, seasons, and explicit rake accounting

Replaces min(stakeOf(up), stakeOf(down)) — 10% of treasury each side —
with a flat ante that doubles every levelWindows.

The old rule let capital buy immortality. A 1,000 tUSDC organism against
10 tUSDC opponents risked ~1 tUSDC per window against 0.05 of rent, so
it survived ~950 windows losing EVERY call and ~20,000 at even odds, and
fundProphet is permissionless. A flat ante alone does not fix that
(0.25 + 0.05 is still ~3,300 windows); geometric escalation does, in a
logarithmic number of levels, so a season terminates by construction.

Proportional staking also broke the science: a rich and a poor organism
were not playing the same game, so measured fitness was capital-weighted
luck rather than forecasting skill. Comparability is what makes the
graded lineage worth selling.

- ante() / level(); _pair no longer takes a min(). An organism that
  cannot cover the ante is not paired, pays rent anyway, and dies —
  clean elimination rather than a special case
- enter() gains a second floor of 4x the ante. minEndowment is a fixed
  number and the ante doubles every level, so a floor that is generous
  at level 0 is unplayable by level 6; at 1x the ante an entry is not a
  bet, it is a donation to the prize pool
- rakeBps was declared, initialized, settable, publicly readable and
  read by NOTHING. It now exists: settleWindow skims it and returns the
  amount. Taken on PROFIT (collateralOut - staked), never on the gross
  redemption — a paired mintSet pays a winner ~2x its stake, so a gross
  rake would tax the organism's own returned collateral at twice the
  intended rate, and would tax a voided market besides
- settleWindow returns the metabolic charge and the skim so Population
  can book both instead of leaving revenue indistinguishable from
  collateral it merely custodies. _book() splits every unit of income
  prizeShareBps to the pot and the rest to revenue, in one place
- withdrawRake draws only against rakeAccrued, so protocol revenue can
  never reach an entrant's collateral. sweep stays as the emergency
  escape but stops being the revenue path
- Death forfeits residue to prizePool WHOLE (not through _book), drained
  BEFORE die() because stakeOut is alive-gated and the reverse order
  strands it forever
- endSeason is permissionless once the season is over, so a payout does
  not depend on the owner being awake. 60/30/10 to the top three
  survivors by correctCount - wrongCount, paid to each entrant; with
  fewer than three survivors the remainder rolls forward rather than
  going to the house, which would give us a reason to prefer extinction
- setSeason takes a SeasonParams struct rather than eight positional
  arguments: levelWindows/seasonWindows are adjacent uint32s and
  anteMultBps/rakeBps/prizeShareBps three adjacent uint16s, so a
  transposition would compile, deploy, and surface hundreds of windows
  later. setEconomics's seven positional arguments already cost this
  suite fourteen failures once
- levelWindows defaults to 72, not 24: paired with a 576-window season,
  24 puts level 6 at window 144 and leaves ~300 windows of empty arena
  under a leaderboard during judging
- stakeBps is now unused but stays declared: the layout is append-only
- Storage re-verified with forge clean + --extra-output storageLayout;
  STORAGE.md regenerated. __gap is down to 10 of its original 20 slots
```

---

### Task 5: `DirectDuelVenue` — the second settlement mechanism

> **CORRECTED WHILE IMPLEMENTING, 2026-08-30. The sketch in Steps 1–4 does not survive contact with the codebase; nine things below are wrong. The shipped shape is what is described here.**
>
> The framing is right and needed no change: two `Population` deployments sharing one beacon, the `positionToken() == address(0)` branch owned by this task, and a full window through the engine rather than direct venue calls. Every defect is in the sketch of the contract itself, and four of them are the same mistake seen from different sides — **the sketch adjudicates each redemption against the price live at the moment of that redemption.**
>
> **1. The sketch omits `positionToken()`, so it does not compile as `IArenaVenue`.** The one function this whole task exists to exercise is the one the sketch forgot to declare.
>
> **2. Its `redeemFor` reads `priceSource.currentWindow`, which the codebase forbids in two places** — `DreamDEXVenue`'s header and `Population.settleAll`'s docblock (`Population.sol:1188-1189`). It is not a style rule: `PushedPriceSource.currentWindow` reverts `StalePrice(age, 180)`, and on the reactive path nobody pushes a price between resolution and the callback. The sketch's settlement therefore reverts in production with the ante already escrowed and the position still open. The shipped venue **records** the opening level at `openOpposing` — where a `StalePrice` revert is the correct outcome, and `Population._pair` already unwinds both antes into a `CommitFailed` — and at settlement reads the close through a `try`/`catch` that turns absence into a void.
>
> **3. Its flat-print branch returns 0 to both sides, which strands the entire backing in the venue forever and grades both organisms WRONG** — the opposite of its own comment that a flat print is "scored as neither a win nor a loss." `Prophet.settleWindow` derives the grade from `collateralOut` against `staked`, so zero reads as a loss for both. The shipped venue pays each side `backing / 2`, which is exactly one ante because `Population._pair` clamps both legs equal before opening, and an equal number is what makes the grading neutral.
>
> **4. Adjudicating per redemption is a solvency bug, not just an inefficiency.** Redeem the up side while the price is high and the down side after it falls, and both are paid the whole backing out of an escrow holding one. The shipped venue **freezes the outcome on the first claim**. This is verified by mutation rather than by argument: with `_resolve`'s `Pending` guard commented out, `test_directDuel_cannotPayBothSidesWhenThePriceMovesBetweenClaims` is the only test in the file that fails, and it fails as `panic: arithmetic underflow` inside the collateral transfer — the double payment itself.
>
> **5. The sketch's `redeemFor` is callable by anyone, which hands the choice of closing price to a bystander.** Resolution reads whatever price is current, so whoever triggers it decides when the window closes; an entrant watching the feed would resolve at the instant their own organism was ahead. The shipped venue requires `msg.sender == organism` and reverts `NotHolder` otherwise. The only path in is `Prophet.settleWindow`, which is `onlyPopulation` and reachable only from `settleAll` in phase 2 — so the cadence driver decides, exactly as it does for the DreamDEX arena.
>
> **6. The `Produces:` line below promises `DirectDuelVenue.resolve(bytes32 duelId)`, which the sketch's own code does not contain.** The shipped contract deliberately has **no public `resolve` at all**, for the reason in item 5. Read-only `outcomeOf(uint256)` and `positionIdsOf(uint256)` are what it exposes instead; note also that duel ids are `uint256`, not `bytes32`.
>
> **7. "No market availability dependency" is overstated, here and in the spec.** This venue needs no market to settle — but it reads prices through `IPriceSource`, whose v1 implementation resolves a real DreamDEX market to compute `tradeable`, and `Population.think` refuses a window whose market is not tradeable. So a duel arena still cannot **open** a window without a live market today. Removing that last thread is an `IPriceSource` v2, not a venue change. The claim that is true and still worth having is narrower: settlement itself cannot fail for want of a market, a pool, or a counterparty contract. §3.2 is written to say that and nothing more.
>
> **8. It reuses `NotOpen()` as a transfer-failure error.** Shipped errors are `NothingStaked`, `NoOpenPrice`, `UnknownDuel`, `NotHolder`, `TransferFailed` — a revert should read as a sentence about what actually happened.
>
> **9. The "Deferred, deliberately" bullet claiming `_requestMutation` keeps paying from `Population` is stale.** Task 3 changed it to draw from the parent, for the reason recorded in that task's banner: a house-paid breeding inference puts the recurring bill back on the growth curve.
>
> **The test block is six tests, not the two the plan lists**, because four of the defects above are only visible as behaviour: the flat-print refund, the first-claim freeze, the bystander refusal, and a settlement whose close cannot be observed at all. The last of these is reachable in production — `settleAll` reads no price of its own — so it is asserted at the engine level, where `outcomeOf(1)` reverts `UnknownDuel` if the duel never opened, which is what keeps that test from passing vacuously.

**Refinement of the spec:** the spec says "the same population against two settlement sources." Implement it instead as **two `Population` deployments sharing one codebase and beacon, one per venue, running concurrently.** Two arenas are simpler to operate and a stronger demo — two live leaderboards rather than one that changed adapters — while exercising exactly the same claim. `setWiring`'s fourth argument remains the escape hatch for repointing a single arena, and Task 1's `test_venue_canBeRepointedBetweenWindows` proves it works. Update the spec's §3.2 to match.

> **Correction, 2026-08-30 — two words in the paragraph above outran the code, and both reached three
> other documents before anyone checked.** *"Running concurrently"* describes the **test suite**:
> `_duelArena` builds the second `Population` through `ERC1967Proxy` and the two arena tests run full
> windows through it, but `Deploy.s.sol:177-186` deploys **one** `Population` on **one**
> `DreamDEXVenue` and calls no configuration setter at all, so a second *live* arena is a second
> deploy rather than a flag — a scripting task, not done. And *"proves it works"* overstates
> `test_venue_canBeRepointedBetweenWindows`, which repoints to a **fresh instance of the same
> adapter** (`Darwin.t.sol:1372` constructs another `DreamDEXVenue`). It proves the seam, not
> cross-adapter migration; nothing tests that, and mid-run it is unsafe, because `setWiring` has no
> phase guard and the two adapters fail in opposite directions on a position the new venue never
> issued — one of them silently. `README.md`, `CLAUDE.md`, `docs/BUSINESS_PLAN.md` and spec §3.2 all
> carried one or both claims and are corrected; the operator rule lives in `STORAGE.md`.

*(An earlier draft of this paragraph justified two deployments by claiming a venue swap "invalidates every organism's operator grant and needs a batched `regrantVenue` walk." That is void — see Task 1's correction banner. There is no grant and no walk, because organisms push their positions rather than the venue pulling them. Two deployments remain the right call on the demo argument alone.)*

**`positionToken()` MUST return `address(0)`, and this task owns proving that branch.** `DirectDuelVenue` issues no transferable position token, so `Prophet.settleWindow` must skip the push and call `redeemFor` directly. Task 1 shipped that branch **untested on purpose** — a throwaway escrow double written then would have been deleted here. So the test block below must run a full window (`_think` → `_answer` → `_commit` → `_settle`) through a `Population` wired to `DirectDuelVenue`, not just call the venue directly, or the address-zero path reaches Season 0 unexercised.

**Files:**
- Create: `contracts/src/venues/DirectDuelVenue.sol`
- Test: `contracts/test/Darwin.t.sol` — a second harness block
- Modify: `docs/superpowers/specs/2026-08-29-arena-engine-design.md` — §3.2

**Interfaces:**
- Consumes: `IArenaVenue` from Task 1.
- Produces: `DirectDuelVenue` implementing `IArenaVenue`, plus the read-only `outcomeOf(uint256 duelId)` and `positionIdsOf(uint256 duelId)`. ~~plus `DirectDuelVenue.resolve(bytes32 duelId)`~~ — **there is deliberately no public `resolve`; see item 5 of the correction banner.**

- [ ] **Step 1: Write the failing test**

```solidity
function test_directDuel_settlesFromAPriceComparison() public {
    DirectDuelVenue duel = new DirectDuelVenue(address(collateral), IPriceSource(address(priceSource)), "BTC");

    address up = address(0x1111);
    address down = address(0x2222);
    collateral.mint(address(this), 100 * ONE);
    collateral.approve(address(duel), 100 * ONE);

    (uint256 upId, uint256 downId, uint256 qty) = duel.openOpposing(up, down, 10 * ONE);
    assertEq(qty, 10 * ONE, "quantity should be the pooled backing");
    assertTrue(upId != downId, "sides must hold distinct positions");

    // Price rose, so UP is right.
    vm.prank(owner);
    priceSource.pushWindow("BTC", MARKET_ID, 100_000 * ONE, 101_000 * ONE, 6);

    uint256 winner = duel.redeemFor(up, upId, qty);
    uint256 loser = duel.redeemFor(down, downId, qty);

    assertEq(winner, 10 * ONE, "winner should take the whole backing");
    assertEq(loser, 0, "loser should receive nothing, not revert");
    assertEq(collateral.balanceOf(up), 10 * ONE, "winner was not paid");
}
```

- [ ] **Step 2: Run it to verify it fails**

```bash
forge test --root contracts --match-test test_directDuel -vv
```

Expected: compile error — `DirectDuelVenue` does not exist.

- [ ] **Step 3: Write `DirectDuelVenue`**

Create `contracts/src/venues/DirectDuelVenue.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IArenaVenue} from "../interfaces/IArenaVenue.sol";
import {IPriceSource} from "../interfaces/IPriceSource.sol";
import {IERC20Like} from "../interfaces/IDreamDEX.sol";

/**
 *  Adapter two: a duel resolved by the sign of a price change.
 *
 *  It exists to make one claim executable rather than asserted: the engine does
 *  not care HOW reality is adjudicated. There are no complete sets here, no order
 *  book, no external venue and no market that can fail to exist — resolution is
 *  a comparison between the window's open price and its last price, read through
 *  the same IPriceSource the population already uses.
 *
 *  It also removes a dependency from the demo. DreamDEX 900-second markets are
 *  continuously available but nothing is pre-created, so an arena that cannot
 *  find one stalls; this one cannot.
 *
 *  HONEST LIMITATION: a venue we wrote ourselves is a weaker generality proof
 *  than a third-party integration. What it does establish is that the settlement
 *  MECHANISM is swappable, which is the claim the platform story rests on.
 */
contract DirectDuelVenue is IArenaVenue {
    address public immutable collateralToken;
    IPriceSource public immutable priceSource;
    string public symbol;

    struct Position {
        address holder;
        uint256 backing; // the pair's whole backing, claimable by the winner
        uint256 openPrice;
        bool isUp;
        bool claimed;
    }

    /// @dev Position ids are sequential and never recycled, so a stale id can
    ///      never be mistaken for a live one.
    uint256 public nextPositionId = 1;
    mapping(uint256 => Position) public positions;

    error NotOpen();

    constructor(address collateral_, IPriceSource priceSource_, string memory symbol_) {
        collateralToken = collateral_;
        priceSource = priceSource_;
        symbol = symbol_;
    }

    function collateral() external view returns (address) {
        return collateralToken;
    }

    function openOpposing(address up, address down, uint256 amount)
        external
        returns (uint256 upId, uint256 downId, uint256 quantity)
    {
        (,,,, uint256 openPrice,,,, bool tradeable) = priceSource.currentWindow(symbol);
        if (!tradeable) revert NotOpen();

        IERC20Like(collateralToken).transferFrom(msg.sender, address(this), amount);

        upId = nextPositionId++;
        downId = nextPositionId++;
        positions[upId] = Position(up, amount, openPrice, true, false);
        positions[downId] = Position(down, amount, openPrice, false, false);
        quantity = amount;
    }

    /**
     *  Pay the side the price agreed with.
     *
     *  `quantity` is accepted for interface compatibility and deliberately
     *  ignored: this venue tracks backing per position rather than issuing
     *  fungible outcome units, so the position id alone determines the payout.
     *  Returns 0 for a loser rather than reverting — a losing settlement is the
     *  normal case and must not abort the window for anyone else.
     */
    function redeemFor(address organism, uint256 positionId, uint256 /* quantity */ )
        external
        returns (uint256 collateralOut)
    {
        Position storage pos = positions[positionId];
        if (pos.claimed || pos.holder != organism || pos.backing == 0) return 0;
        pos.claimed = true;

        (,,,,, uint256 lastPrice,,,) = priceSource.currentWindow(symbol);
        bool rose = lastPrice > pos.openPrice;
        // A flat print pays nobody and is scored as neither a win nor a loss,
        // matching how a voided DreamDEX market behaves.
        if (lastPrice == pos.openPrice) return 0;
        if (rose != pos.isUp) return 0;

        collateralOut = pos.backing;
        if (!IERC20Like(collateralToken).transfer(organism, collateralOut)) revert NotOpen();
    }
}
```

- [ ] **Step 4: Run the test**

```bash
forge test --root contracts --match-test test_directDuel -vv
```

Expected: PASS. Add the imports it needs to `Darwin.t.sol`:

```solidity
import {DirectDuelVenue} from "../src/venues/DirectDuelVenue.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
```

- [ ] **Step 5: Prove venue indifference end to end**

Add the test that makes the platform claim an assertion rather than a slide. It runs a full window through `DirectDuelVenue` on a second `Population`.

```solidity
function test_venue_engineIsIndifferentToTheSettlementMechanism() public {
    DirectDuelVenue duel = new DirectDuelVenue(address(collateral), IPriceSource(address(priceSource)), "BTC");

    Population impl2 = new Population();
    bytes memory init2 = abi.encodeCall(
        Population.initialize,
        (
            owner,
            Population.Wiring({
                agentRequester: address(requester),
                settlement: address(settlement),
                marketsModule: address(module),
                outcomeToken: address(outcomeToken),
                collateral: address(collateral),
                prophetBeacon: address(beacon),
                priceSource: address(priceSource),
                venue: address(duel),
                llmAgentId: 1,
                symbol: "BTC"
            })
        )
    );
    Population arena2 = Population(payable(address(new ERC1967Proxy(address(impl2), init2))));

    vm.deal(address(arena2), 100 ether);
    collateral.mint(address(arena2), 10_000 * ONE);

    string[] memory genomes = new string[](2);
    genomes[0] = "duel momentum";
    genomes[1] = "duel reversion";
    vm.prank(owner);
    arena2.spawnGenesis(genomes);
    vm.deal(arena2.prophetAt(1), 1 ether);
    vm.deal(arena2.prophetAt(2), 1 ether);

    vm.prank(owner);
    arena2.think();
    requester.deliver(Prophet(payable(arena2.prophetAt(1))).pendingBeliefRequestId(), "UP_MOMENTUM");
    requester.deliver(Prophet(payable(arena2.prophetAt(2))).pendingBeliefRequestId(), "DOWN_REVERSION");
    vm.prank(owner);
    arena2.commitAll();

    // Price rose after the window opened, so the UP organism is right.
    vm.prank(owner);
    priceSource.pushWindow("BTC", MARKET_ID, 100_000 * ONE, 101_000 * ONE, 6);

    vm.prank(owner);
    arena2.settleAll();

    Prophet winner = Prophet(payable(arena2.prophetAt(1)));
    Prophet loser = Prophet(payable(arena2.prophetAt(2)));
    assertEq(winner.correctCount(), 1, "winner was not graded correct on the duel venue");
    assertEq(loser.wrongCount(), 1, "loser was not graded wrong on the duel venue");
    assertGt(winner.treasury(), loser.treasury(), "the duel did not transfer value to the winner");
}
```

- [ ] **Step 6: Run it**

```bash
forge test --root contracts --match-test test_venue_engineIsIndifferent -vv
```

Expected: PASS. If the price push between `commitAll` and `settleAll` trips `PushedPriceSource`'s staleness or resolved-market guards (see `test_priceSource_refusesStalePrice` at `:987`), push a fresh window with the same `MARKET_ID` and an advanced timestamp via `vm.warp` rather than weakening the guard.

- [ ] **Step 7: Update the spec to match the two-deployment decision**

Edit `docs/superpowers/specs/2026-08-29-arena-engine-design.md` §3.2, replacing "the same population against two different settlement sources" with two concurrent `Population` deployments sharing one beacon, and state the reason (operator re-grants).

- [ ] **Step 8: Gate, then commit**

```bash
npm test && npm run build && npm run typecheck
```

Then the fee gate, which does not need a deployment:

```bash
npm run fee     # settlement fee must still measure 0
```

All four must pass before the commit.

```bash
git add contracts/src/venues/DirectDuelVenue.sol contracts/test/Darwin.t.sol \
        docs/superpowers/specs/2026-08-29-arena-engine-design.md
git commit -m "feat(venue): DirectDuelVenue, a second settlement mechanism

Adapter two resolves on the sign of a price change read through
IPriceSource — no complete sets, no order book, no external venue, no
market that can fail to exist. One adapter is a demo; two is a platform,
and this is the difference between asserting that the engine does not
care how reality is adjudicated and executing it.

It also removes a dependency from the recorded demo: DreamDEX 900-second
markets are continuously available but nothing is pre-created, so an
arena that cannot find one stalls. This one cannot.

- test_venue_engineIsIndifferentToTheSettlementMechanism runs a full
  window on a second Population wired to the duel venue, and asserts
  the same grading. That test IS the platform claim
- redeemFor returns 0 for a loser rather than reverting; a flat print
  pays nobody, matching how a voided DreamDEX market behaves
- Position ids are sequential and never recycled, so a stale id cannot
  be mistaken for a live one
- Spec 3.2 updated: two Population deployments sharing one beacon, one
  per venue, rather than swapping venue under a live population. Two
  concurrent arenas are simpler to operate and the stronger demo; a
  swap is still supported and tested, it is just a worse demo
- positionToken() returns address(0), so Prophet skips the push and
  redeems directly — the branch Task 1 left deliberately unexercised

Honest limitation, stated in the contract header: a venue we wrote
ourselves is a weaker generality proof than a third-party integration.
What it establishes is that the settlement MECHANISM is swappable.

npm run prove is NOT run here — it needs a live deployment. It gates
disableFallback() after the Season 0 deploy. Until it passes, only the
weaker claim is licensed: selection is on-chain and atomic with
redemption."
```

The remaining gate is not a commit gate:

```bash
npm run prove   # AFTER the Season 0 deploy — see below
```

`npm run prove` needs a live deployment and cannot pass before Season 0 exists. It is the gate on `SelectionEngine.disableFallback()`, not on this plan. Until it passes, the licensed claim stays *"selection is on-chain and atomic with redemption."*

---

## Deferred, deliberately

- **`fundProphet` stays permissionless.** With a flat escalating ante, funding an organism no longer buys immortality — the exploit's payoff is gone, so patching it is unnecessary. It remains what its comment says: a spectator putting backing behind an organism they believe in.
- **~~`_requestMutation` keeps paying from Population.~~** **Reversed in Task 3** — it draws from the parent, like `think`. Breeding *is* rare relative to thinking, but that is what makes the subsidy affordable rather than what makes it right: a house-paid inference of any kind puts the recurring bill back on the growth curve, which is the dynamic this rework exists to remove. See Task 3's correction banner and the F3 row above.
- **`Prophet.sol:209`'s hard-coded `agree >= 2`** is independent of `threshold`, so raising `subcommitteeSize` does not raise the consensus floor. Out of scope; do not let it be forgotten.
- **The `think` refund leak** (Task 3, Step 4): up to one deposit per failed request stays in Population. Bounded, observable via `ThinkFailed`, and not worth the stack pressure to fix inside that loop.
- **`web/` frontend.** Task #6 in the tracker, not in this plan. It is the largest schedule risk after this rework and a running population with a thin UI beats a polished UI over a dead one.
