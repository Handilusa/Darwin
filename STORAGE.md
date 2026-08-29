# Storage Layout — append-only log

The population goes live on **2026-08-30 (day 2)** and must never stop. From the
moment of that deploy, `Prophet` sits behind a beacon and `Population` behind a UUPS
proxy specifically so **logic can be repaired without resetting lineage** — the
ancestry graph is the one asset in this project that cannot be rebuilt in a hurry.

That guarantee holds only if storage never moves.

## The rule

**Append only, into `__gap`.** Never reorder a variable, never change a type, never
delete one, never insert between existing ones. Shrinking `__gap` by exactly the
number of slots you add is the only permitted edit to it. Every change gets a dated
entry in the changelog at the bottom, including changes made *before* the freeze.

Renaming a variable is safe (names are not on-chain). Changing `public` to
`internal` is safe for storage but breaks the frontend, so treat it as a breaking
change anyway.

## Status: TOOL-VERIFIED 2026-08-29 — freezes at the day-2 deploy

The tables below are now compiler-verified and are considered final. Freeze takes
effect at the day-2 deploy; any edit before then still needs a changelog entry *and*
a re-run of the two commands below.

> **Reconciled against the compiler on 2026-08-29, and this time the command actually
> ran.** `forge inspect Prophet storage-layout` and `forge inspect Population
> storage-layout` were executed and compared slot-by-slot against these tables.
> **Result: zero discrepancies.** All 24 `Prophet` entries and all 28 `Population`
> entries match on slot, offset, type, name and ordering — including the three packing
> claims that were previously only read off the source (`Prophet` slot 0 at 31/32 bytes,
> `Prophet` slot 14 at exactly 32/32, `Population` slot 13 at 10/32), and including
> `__gap` landing at `Prophet` slot 16 and `Population` slot 27 with 640 bytes each.
>
> The `Population` slot-0 check is the strongest one here and it holds: `forge inspect`
> reports `agentRequester` at slot 0 with **no inherited variable ahead of it**, which
> empirically confirms OZ v5 keeps `Ownable`/`UUPS`/`Initializable` in ERC-7201
> namespaced slots. A downgrade to a v4-style sequential-storage base would show up
> immediately as a shifted table, so this is a stronger check than trusting the OZ
> version string.
>
> **Reproducibility trap — read this before re-diffing.** `forge inspect <C>
> storage-layout` fails with `storage layout missing from artifact` against an ordinary
> build, because the layout is not part of the default artifact output. It is not a
> caching problem and `forge clean` alone does not fix it. The build must be told to
> emit it:
>
> ```bash
> forge clean --root contracts
> forge build --root contracts --extra-output storageLayout
> forge inspect Prophet    storage-layout --root contracts
> forge inspect Population storage-layout --root contracts
> ```
>
> Re-run all four if any `.sol` file under `src/` changes before the deploy. A packing
> assumption that is wrong here is invisible until an upgrade corrupts live organisms,
> at which point the run is over.
>
> **Re-verified 2026-08-29 after the venue seam landed, and the numbers above moved.**
> `Population` now has **30** entries and its `__gap` is `uint256[18]` starting at
> **slot 29** (576 bytes), because `venue` and its alignment pad took slots 27 and 28.
> Everything through slot 26 is unchanged, `phase` is still alone in slot 26, and
> `Prophet` is **byte-identical** — 24 entries, slot 14 still exactly 32/32, slot 15
> still 1/32, `__gap` still `uint256[20]` at slot 16. One deviation from the recipe
> above is worth recording because it works: `forge clean` is not the only way to get
> the layout emitted — `forge build --extra-output storageLayout --force` also does it,
> which matters when `forge clean` is unavailable.

---

## `Prophet` — one organism

Behind `BeaconProxy`. No constructor state; `initialize` guards on
`population != address(0)`.

| Slot | Offset | Type | Name | Notes |
|---|---|---|---|---|
| 0 | 0 | `address` | `population` | 20 bytes |
| 0 | 20 | `uint32` | `generation` | |
| 0 | 24 | `uint32` | `streak` | consecutive correct calls |
| 0 | 28 | `bool` | `dead` | **irreversible** |
| 0 | 29 | `Belief` | `belief` | uint8 |
| 0 | 30 | `Thesis` | `lastThesis` | uint8 — 31/32 bytes used |
| 1 | — | `uint256` | `prophetId` | 1-based; 0 means "no parent" |
| 2 | — | `uint256` | `parentId` | |
| 3 | — | `uint256` | `treasury` | raw collateral units (6dp on tUSDC) |
| 4 | — | `bytes32` | `genomeHash` | `keccak256(systemPrompt)` |
| 5 | — | `string` | `systemPrompt` | **the genome** |
| 6 | — | `string` | `lastReasoning` | verbatim model answer |
| 7 | — | `bytes32` | `currentMarketId` | |
| 8 | — | `uint256` | `currentOutcomeId` | never cached across windows |
| 9 | — | `uint256` | `currentStake` | collateral **risked** |
| 10 | — | `uint256` | `currentQuantity` | outcome **tokens held** — not the same number |
| 11 | — | `uint256` | `pendingBeliefRequestId` | 0 = none in flight |
| 12 | — | `uint256` | `pendingMutationRequestId` | |
| 13 | — | `string` | `pendingChildPrompt` | mutated genome awaiting a birth |
| 14 | 0 | `uint64` | `birthWindow` | |
| 14 | 8 | `uint64` | `deathWindow` | |
| 14 | 16 | `uint32` | `windowsLived` | |
| 14 | 20 | `uint32` | `correctCount` | |
| 14 | 24 | `uint32` | `wrongCount` | |
| 14 | 28 | `uint32` | `abstainCount` | 32/32 bytes — **slot 14 is full** |
| 15 | 0 | `bool` | `positionOpen` | 1/32 bytes — **31 free. Do not fill.** |
| 16–35 | — | `uint256[20]` | `__gap` | 20 slots remaining |

**Slot 14 is exactly full.** A new packed counter cannot join it; it must start a new
slot out of `__gap`.

**Slots 0 and 15 have free bytes — do not fill them either.** Slot 0 is 31/32 (one
byte spare) and **slot 15 is 1/32 (thirty-one bytes spare)**, which makes it by far the
most inviting place in this contract to "just add a bool". It is the same trap as the
`Population` slots below: packing a new variable into a partially-used slot changes
nothing for a fresh deploy and corrupts nothing visibly until a beacon upgrade puts a
live organism's counter on top of someone else's bytes. Every addition takes a fresh
slot out of `__gap`, without exception.

### Why `currentStake` and `currentQuantity` are both here

A paired mint (`mintSet(yesTo, noTo, amount)`) is funded by *both* organisms, so each
side holds `amount` outcome tokens while having risked only its own contribution
(≈`amount / 2`). Redemption is denominated in tokens; profit and loss in collateral.
Storing one number and deriving the other would make **every winner read as a
break-even**, silently zeroing the fitness signal that the entire project rests on.

---

## `Population` — registry, paymaster, matchmaker

Behind a UUPS ERC-1967 proxy. OZ v5 keeps `Ownable`/`UUPS`/`Initializable` state in
ERC-7201 namespaced slots, so slot 0 below is genuinely slot 0 and nothing collides.
`forge inspect` confirms this empirically — it reports `agentRequester` at slot 0 with
no inherited variable ahead of it — which is a stronger check than trusting the OZ
version string, since a downgrade to a v4-style sequential-storage base would show up
here immediately as a shifted table.

| Slot | Offset | Type | Name |
|---|---|---|---|
| 0 | — | `address` | `agentRequester` |
| 1 | — | `address` | `settlement` |
| 2 | — | `address` | `marketsModule` |
| 3 | — | `address` | `outcomeToken` |
| 4 | — | `address` | `collateral` |
| 5 | — | `address` | `prophetBeacon` |
| 6 | — | `address` | `priceSource` |
| 7 | — | `address` | `selectionEngine` |
| 8 | — | `uint256` | `llmAgentId` |
| 9 | — | `string` | `symbol` |
| 10 | — | `uint256` | `endowment` |
| 11 | — | `uint256` | `metabolicCost` |
| 12 | — | `uint256` | `minStake` |
| 13 | 0 | `uint16` | `stakeBps` |
| 13 | 2 | `uint16` | `breedSurplusBps` |
| 13 | 4 | `uint32` | `breedStreak` |
| 13 | 8 | `uint16` | `maxPopulation` |
| 14 | — | `uint256` | `perAgentReward` |
| 15 | — | `uint256` | `subcommitteeSize` |
| 16 | — | `uint256` | `threshold` |
| 17 | — | `uint256` | `requestTimeout` |
| 18 | 0 | `bool` | `chainOfThought` |
| 19 | — | `address[]` | `prophets` (length; elements at `keccak256(19)`) |
| 20 | — | `uint256` | `aliveCount` |
| 21 | 0 | `uint64` | `windowCount` |
| 22 | — | `bytes32` | `activeMarketId` |
| 23 | 0 | `address` | `activePool` |
| 24 | — | `uint256` | `activeUpId` |
| 25 | — | `uint256` | `activeDownId` |
| 26 | 0 | `uint8` | `phase` |
| 27 | — | `uint256` | `__slotAlign` (private, permanently unused — see below) |
| 28 | 0 | `address` | `venue` |
| 29–46 | — | `uint256[18]` | `__gap` |

`__slotAlign` is padding and it is load-bearing. `phase` at slot 26 is a `uint8`,
so its slot has thirty-one bytes spare, and `address public venue` declared after
it would have landed at **slot 26 offset 1** — the packing this document and
`CLAUDE.md` both forbid. A `uint256` cannot fit in thirty-one bytes, so declaring
one is what forces `venue` onto a slot of its own; there is no padding primitive
that does it more directly. The compiler confirms the outcome: `phase` is alone in
slot 26 and `venue` is alone at slot 28 offset 0. Cost: two slots out of twenty,
one of them never read, in exchange for every pre-existing boundary staying where
this table says it is.

Slots 13, 18, 21, 23 and 26 all have free bytes. **Do not fill them** — packing a new
variable into a partially-used slot is exactly the edit that looks safe and is not,
because it changes nothing for a fresh deploy and corrupts nothing visibly until an
organism's counter starts reading someone else's bytes. Take a fresh slot from
`__gap`.

## Deliberately NOT in Prophet

Every economic parameter — `endowment`, `metabolicCost`, `minStake`, `stakeBps`,
`breedStreak`, `breedSurplusBps` — lives in `Population` and is passed in per call.
The whole ten-day run can therefore be recalibrated from a single transaction without
a beacon upgrade and without touching organism storage. If death turns out to be too
slow or too fast to film, that is a `setEconomics` call, not a migration.

## Contracts with no storage constraint

`SelectionEngine` and `PushedPriceSource` are plain, non-upgradeable contracts and can
be redeployed and re-pointed freely (`Population.setWiring`). That is intentional:
both wrap the parts of the integration that are still unverified — the reactivity
callback selector and the price read — so the risky surfaces are the replaceable ones.

---

## Changelog

| Date | Change |
|---|---|
| 2026-08-28 | Initial layout drafted. Pre-freeze. |
| 2026-08-28 | `Prophet`: added `lastThesis` at slot 0 offset 30, and `Thesis` to the `Believed` event. Reason: `allowedValues` constrains the model to a single token, so a bare `"UP"` would have made "readable on-chain reasoning" untrue. Encoding the thesis in the enum makes selection over *strategies* observable from logs at no extra inference cost. |
| 2026-08-28 | `Prophet`: added `currentQuantity` at slot 10; shifted the pending-request and counter slots down by one. Reason: tokens held ≠ collateral risked under paired minting — see above. |
| 2026-08-28 | `Prophet`: `Belief` moved from a contract-level enum to a file-level enum in `Genome.sol`, shared with `Population`. ABI-neutral (still `uint8`), storage-neutral. |
| 2026-08-28 | `Prophet`: **logic only, no layout change.** `settleWindow` now grades fitness on `finalizeAndRedeem`'s return value but ledgers the *collateral balance delta* into `treasury`, and a new `claimOwed()` / `_sweepOwed` rescues a credited-but-untransferred payout. Reason: `BinarySettlement` may credit an `owed` balance instead of transferring, in which case ledgering the return value books collateral the organism does not hold — permanently — and a **winner** could then be starved by metabolism while its winnings sat in escrow. `treasury == collateral.balanceOf(prophet)` is now an asserted invariant. |
| 2026-08-29 | `Population`: **no layout change.** Added `constructor() { _disableInitializers(); }`. Constructors allocate no storage, so every slot below is untouched. Reason: `initialize` was externally callable on the *implementation* contract, letting anyone become its `owner()`, satisfy `_authorizeUpgrade`, and `upgradeToAndCall` into a `selfdestruct`. Pre-Cancun that destroys the implementation, and because the proxy's upgrade logic lives *in* the implementation, the proxy is bricked with no recovery path — the ancestry graph would be permanently unrecoverable, which is the exact outcome this document exists to prevent. We compile for `paris` because Shannon's fork is unconfirmed, so EIP-6780 cannot be assumed to defuse it. `Prophet` deliberately does **not** get this: it uses a manual `AlreadyInitialized` guard, is beacon-backed rather than UUPS, and so exposes no `upgradeToAndCall`, meaning ownership of its implementation confers nothing. |
| 2026-08-29 | Layout reconciled against source declaration order for both contracts: order, types, names and count match these tables exactly. **Still not tool-verified** — `forge inspect ... storage-layout` has not run, so the packing assumptions in slots 0, 13, 14 remain reading claims. Freeze still pending. |
| 2026-08-29 | `Darwin.t.sol`: **no contract change; test harness only.** Fixed all 14 pre-existing test failures. Root cause was uniformly prank/expectRevert semantics: Solidity evaluates arguments *before* the call, a `view` read is a call, and so every `vm.prank(owner)` followed by an argument that read `population.endowment()` literally consumed the prank — likewise `_p(1)`, a `prophetAt` view read after a prank, and `address(new ProphetV2())`, a CREATE after a prank. Added `_econ()/_setEconomics` helpers and made the harness bind pranks only to calls with no intervening argument read. This is a test-side change, so it carries no storage-layout implications: `Population` and `Prophet` themselves are untouched, and the layout tables above remain as reconciled. |
| 2026-08-29 | **No layout change. Tool verification actually performed, closing the entry above.** `forge inspect Prophet storage-layout` and `forge inspect Population storage-layout` were run and diffed slot-by-slot: **zero discrepancies** across all 24 `Prophet` and 28 `Population` entries, all three packing claims (slots 0, 13, 14) and both `__gap` placements. The packing assumptions are no longer reading claims. Two process findings recorded in the status block: (1) `forge inspect ... storage-layout` **fails** against an ordinary build with `storage layout missing from artifact` — the layout is not in the default artifact output and `forge clean` alone does not fix it; the build needs `--extra-output storageLayout`, which is why the previous entry could not have verified anything and why the earlier "tool-verified" wording in the status block was asserting its own conclusion. (2) `Prophet` slot 15 holds only `positionOpen` and has **31 free bytes**, which was undocumented here and in `CLAUDE.md`; it is now flagged do-not-fill alongside slot 0 and the `Population` slots. |
| 2026-08-29 | **No layout change. `evm_version` raised `paris` → `shanghai`; layout re-verified byte-identical afterwards.** Both tables re-derived with `forge clean && forge build --extra-output storageLayout && forge inspect …`: `Prophet` slot 14 still exactly 32/32, slot 15 still 1/32, `__gap` still at 16; `Population` slot 13 still 10/32, `phase` at 26, `__gap` at 27. `evm_version` targets codegen, not slot assignment, so this is confirmation rather than a change — but it was re-run rather than assumed because the freeze is the next transaction. Tests 56/56 under the new spec. Reason for the raise: `paris` made the deploy **impossible**, not merely conservative. `evm_version` also sets the EVM spec forge *executes* with, so `forge script Deploy.s.sol --rpc-url <shannon>` ran the live tUSDC bytecode — which uses PUSH0 — under a spec lacking it, and died on the first line of `_inputs` with `EvmError: NotActivated`. `--broadcast` simulates before sending, so the day-2 deploy would have failed at the first command. This also retires the "Shannon's fork is unconfirmed" caveat in the 2026-08-29 `_disableInitializers` entry above: Shannon's own production contracts contain PUSH0 and execute, so the chain is at least Shanghai. That entry's *conclusion* stands unchanged regardless — EIP-6780 is a **Cancun** change, so `selfdestruct` still cannot be assumed defused, and the constructor guard is still required. |
| 2026-08-29 | **`Population` +2 slots: `__slotAlign` at 27 (unused padding) and `venue` at 28; `__gap` `uint256[20]` → `uint256[18]` at slot 29. `Prophet` byte-identical. Compiler-verified, not reasoned.** Phase 1 of the arena-engine rework extracts an `IArenaVenue` seam so *where positions live and how a resolved position becomes collateral* is a parameter of the arena rather than its definition — `Population` and `Prophet` no longer name a DreamDEX pool or `BinarySettlement` anywhere on the window path, and `DreamDEXVenue` is adapter one. That needs exactly one new state variable, `address venue`, and the interesting part is what it cost. Declared where it belongs — immediately after `uint8 phase` — Solidity packed it into slot 26 offset 1, because `phase` leaves thirty-one bytes spare and an address fits. That is precisely the edit this document and `CLAUDE.md` forbid (*"`Population` slots 13, 18, 21, 23, 26 have free bytes. Do not fill them."*), and it would have been invisible: the tables would still have been correct for a fresh deploy, and the corruption would only surface once a later upgrade appended a variable expecting slot 26 to be closed. The fix is a `uint256 private __slotAlign;` declared before it — a `uint256` cannot fit in thirty-one bytes, so it is the boundary — and `forge inspect` now reports `phase` alone in 26 and `venue` alone at 28 offset 0. Two slots out of twenty, one permanently unread, is the whole price. **Caught only because the layout was re-derived from the compiler rather than from the source; the same misreading had already been written into the design spec and the implementation plan for `Prophet.entrant` (Phase 2), where it is now corrected the same way — `entrant` costs two slots, not one.** Prophet's layout is untouched by this phase: `settleWindow`'s signature changed from `(settlement, pool, collateral, metabolicCost)` to `(venue, collateral, metabolicCost)`, which is calldata, not storage. **The `forge test` gate then ran: 61/61 (56 existing + 5 new seam tests), plus a clean `forge build` and `tsc`.** One of the five needed a fix, and it was in the assertion rather than the contracts: `vm.expectRevert(bytes4)` compares the *whole* revert data, so the bare `StalePrice` selector could not match `StalePrice(181, 180)` and the precondition read as "the feed was not stale" when it was. `vm.expectPartialRevert` is the selector-only form and is what that line wanted. |
| 2026-08-29 | **No layout change, and none is possible.** `Population.initialize` now sets `perAgentReward = 0.001 ether` instead of `0.01 ether`. This is a numeric literal in a function body — Solidity assigns slots from state variable *declarations* only, and no declaration was added, removed, reordered or retyped, so the tables above cannot be affected and were not re-derived. Recorded here anyway because the change lands in the same transaction as the freeze and a reader diffing `Population.sol` against the frozen tables deserves to find it accounted for. `forge test` 56/56, including `test_upgrade_preservesEveryOrganismField`, which exercises field-by-field preservation across a real proxy upgrade. Reason: the deposit floor is exactly `0.01 STT x subcommitteeSize` (measured live across n = 1..21) and live traffic pays only 0.0003 per validator on top, so 0.01 was ~33x the going rate and made every window of the run 45% more expensive than it needed to be. The value stays 3.3x above observed, which preserves the anti-skip margin `requestDeposit()`'s own comment argues for, and it is adjustable post-deploy through `setInference` without an upgrade. See docs/SESSION_CHECKPOINT.md §2.14. |
