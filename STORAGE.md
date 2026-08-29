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

## Status: NOT YET FROZEN

Freeze happens at the day-2 deploy. Until then the tables below may change freely,
and each change is still logged.

> **These tables were read off the source, not produced by a tool.** Before the day-2
> deploy, run `forge inspect Prophet storage-layout` and `forge inspect Population
> storage-layout` and reconcile against what follows. A packing assumption that is
> wrong here is invisible until an upgrade corrupts live organisms, at which point
> the run is over. Do not skip the reconciliation.

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
| 15 | 0 | `bool` | `positionOpen` | |
| 16–35 | — | `uint256[20]` | `__gap` | 20 slots remaining |

**Slot 14 is exactly full.** A new packed counter cannot join it; it must start a new
slot out of `__gap`.

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
| 27–46 | — | `uint256[20]` | `__gap` |

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
