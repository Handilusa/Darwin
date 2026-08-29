# Day-0 Spike — Findings

Run 2026-08-28 against `@somnia-chain/markets-sdk@0.28.1` (`npm pack`, read `package/src/`).
Source files: `moduleAbi.ts`, `tradeAbi.ts`, `readsAbi.ts`, `reactivity/index.ts`.

## Verdict: PATH A CONFIRMED — the organism is a fully autonomous on-chain actor

The blocking question ("can a contract place an order on a binary pool?") is **yes**.
No off-chain executor is needed anywhere in the causal chain.

```solidity
// BinaryPool — plain external function, no EOA gating, no signature path
function placeBinaryOrder(
    uint8 kind, uint256 price, uint256 quantity, uint64 expireTimestampNs,
    uint8 orderType, uint8 selfMatchingOption, address builder,
    uint96 builderFeeBpsTimes1k, uint64 userData
) payable returns (bool success, uint128 id);
```

`tradeAbi.ts:91-92` notes that *"an EOA cannot read a transaction's return data — the wrappers
reconstruct outcomes from receipt events."* A **contract** reads `(success, id)` directly.
Path A is therefore not merely viable, it is strictly more capable than the off-chain path.
Worth stating in the pitch: the organisms know whether their own order landed, atomically.

`scripts/executor.ts` (Path B) is **cut from the build.**

---

## Corrections to earlier assumptions — all selector-critical

| Assumed | Actual |
|---|---|
| `placeOrder` works on a binary pool | **Reverts `UseBinaryPlacement`.** So do `placeOrderFor`, `amendOrder`, `placeOrders`. `placeBinaryOrder` is the only placement path. |
| side is a bool | `kind` is an **OrderKind enum: 0 BUY_YES, 1 SELL_YES, 2 BUY_NO, 3 SELL_NO**. `price` is **always the YES-side price**. |
| `winningOutcome()` reads the result | **Removed in the payout-vector refactor; reverts on the deployed contract.** Derive the winning index as **argmax of `payoutNumerators()`**, gated on `isResolved()`. |
| `redeem` lives on the pool | **Gone from the pool in v2.** Routes: `BinaryMarketsModule.redeem(operatorId, venueId, marketId, outcomeIdx, amount)` for traders, or `BinarySettlement` directly. |
| `builderFeeBpsTimes1k` type is flexible | **Must be `uint96`.** Selector-critical, everywhere. |
| `userData` encodes the side | v2 **frees `userData`** for opaque bookkeeping — use it for our `prophetId`. |

Inherited-from-OrderBook and **not** placement-gated, so these DO work on binary pools:
`cancelOrder`, `cancelOrders`, `reduceOrder` (shrinks in place, keeps queue priority),
`reduceOrders`, `cancelExpiredOrders`, `sweepExpiredAtLevel`.

BinaryPool has **no** `setManualVaultMode` (SpotPool-only), and its vault accepts **only its
collateral** — a native deposit into a tUSDC binary pool reverts `InvalidDepositOrWithdrawal`
("verified live" per the SDK comment).

---

## The liquidity problem is solved by the pool itself

```solidity
function mintSet(address yesTo, address noTo, uint256 amount)   // BinaryPool
```

**`yesTo` and `noTo` are independent recipients.** Two organisms holding opposing beliefs can be
issued real, fully-backed positions in one call from combined collateral — no order book, no
external counterparty, no cold-start problem. The population self-supplies its own liquidity.

This is the answer to dossier question 6 ("what happens under low liquidity?"): on a quiet
testnet the population is its own counterparty, and the accounting is exact 1:1.

Design consequence: `commitAll()` pairs organisms with opposing beliefs via `mintSet` first, and
only routes the unmatched remainder to `placeBinaryOrder` on the book. Cheaper, deterministic,
and it degrades gracefully when the book is empty.

---

## Settlement — consequence is atomic with resolution

```solidity
// BinarySettlement
function finalizeAndRedeem(address pool, uint256 outcomeId, uint256 amount, address to)
    returns (uint256 collateralOut);
function redeem(uint256 outcomeId, uint256 amount, address to) returns (uint256 collateralOut);
function finalize(address pool) returns (uint256 marketKey);
function claimOwed(address token) returns (uint256 amount);
function owed(address user, address token) view returns (uint256);
function getSettlement(uint256 marketKey) view returns (
    (address collateralToken, uint128 backing, bool finalized, bool voided,
     uint256 settlementFeeBpsTimes1k, address feeRecipient, address pool,
     uint64 nonce, uint256[] payoutNumerators)
);
```

**`finalizeAndRedeem` is the keystone.** It collapses what looked like a two-step keeper flow
(`BinaryMarketsModule.finalizeMarket` then redeem) into one call that returns `collateralOut`.
So inside the reactive callback we can, in the same block the market settles:
finalize → redeem the organism's winnings → apply fitness → kill or breed.

**No keeper step sits between resolution and consequence.** This is the demo's central claim and
it is now architecturally exact rather than aspirational.

`owed` / `claimOwed` exist because a payout can fall back to a credited balance instead of a
transfer. `Prophet` must expose a `claimOwed` path or winnings can silently strand.

---

## MUST VERIFY EMPIRICALLY — the load-bearing economic claim

`getSettlement` returns **`settlementFeeBpsTimes1k`** and a **`feeRecipient`**.

DARWIN's entire thesis is that zero fees make the fitness function unbiased — that a
coin-flipping organism has zero expected drift, so selection acts on edge rather than on rake.
**The docs say fees are zero; the settlement struct has a fee field anyway.**

Day 1, before writing fitness logic: read `settlementFeeBpsTimes1k` from a live finalized
testnet market and assert it is `0`. If it is non-zero, the metabolic model needs recalibrating
and the pitch line changes. Do not repeat "zero fees" in the video until it has been measured on
chain. Add it to the Foundry integration assertions so a future change is caught.

---

## Reactivity — cadence can also be on-chain

`@somnia-chain/reactivity` is a **separate optional peer dependency** (published on npmjs, not
bundled with markets-sdk). Install explicitly.

- Precompile `0x0000000000000000000000000000000000000100` has **no bytecode** — `eth_getCode`
  returns `0x`, so presence cannot be probed that way. Use `isLocalPrecompileUnavailable(chainId)`.
- **Solidity subscriptions do not exist on local chains (31337/1337).** `forge test` therefore
  cannot exercise the real subscription path — mock `0x0100` in unit tests and validate the real
  path only on Shannon. This is a hard constraint on the test plan, not a preference.
- Every upstream method resolves to `T | Error` instead of throwing — wrap in `unwrap()`.
- Subscription owner funds every callback.
- `DEFAULT_SUBSCRIPTION_OPTIONS = { priorityFeePerGas: 0n, maxFeePerGas: 20 gwei, gasLimit: 10_000_000n }`.
  Rules: `gasLimit ∈ (0, 200_000_000]`; a non-zero `maxFeePerGas` must sit ≥ 6 gwei above
  `priorityFeePerGas`. 10M default is ample for iterating 8 organisms; the 200M ceiling means
  population size is not gas-bound at our scale.
- **`ethCalls`**: a subscription can carry calls whose results are delivered *with* the event,
  read **at the same block** (`simulationResults: Hex[]`). The callback can be handed the payout
  vector atomically rather than re-reading it.
- The precompile emits its own **`Schedule` / `BlockTick` / `EpochTick`** system ticks, catchable
  by filtering on the precompile as `emitter`. Types: `ScheduleRequest`,
  `BlockTickSubscriptionRequest`, `EpochTickSubscriptionRequest`.

**Consequence: the commit cadence is on-chain too.** A `Schedule`/`BlockTick` subscription drives
`Population.commitAll()`. Combined with the settlement subscription, **there is no server in the
causal chain at all** — cadence, cognition, commitment, settlement, selection, death and
reproduction are every one of them chain-executed.

`Prophet` and `Population` both need to tolerate being entered from the precompile
(`msg.sender == 0x0100`) as well as from `SelectionEngine`.

---

## Other facts worth keeping

- `BinaryMarketsModule.markets(bytes32 marketId)` returns the full record including
  `pool`, `yesId`, `noId`, `tradingStart`, `expiry`, `oracleQuestionId`, `collateral`.
  **This is the only correct way to reach a pool.** Pools are recycled: `poolCreator`,
  `getFreePools(creator, collateral)`, `freePoolCount`, `releasePool(marketId)`.
- `marketNonce(bytes32)` is part of the outcome-id encoding — a recycled pool's ids differ
  by nonce, so **never cache an outcome id across windows.**
- `pokeOracle(uint256 oracleQuestionId)` is keyed by **oracle question, not market**: it fans
  out to every market bound to that question. Partial success counts as success; reverts
  `OracleNotAnswered` only when none answered.
- `syncSettlement(marketId)` repairs the case where `voidExpired()` flipped a market Voided
  directly, bypassing the module, so the hub earmark release never fired.
- `settlementWindow()` on the market is the instant `voidExpired()` becomes callable.
- DreamDEX's own `SpotStopOrderRegistry` funds reactivity gas via
  `msg.value == somiPaymentPerOrder()` — production precedent for how to fund our subscription,
  and confirmation that reactivity is load-bearing in shipped DreamDEX code.

## Still unverified after this spike

Each item now names the thing that resolves it, so this list is a work queue rather than a
disclaimer. Nothing here may be stated as fact in the pitch until its line is closed.

| # | Unverified | Resolved by |
|---|---|---|
| 1 | `settlementFeeBpsTimes1k == 0` on a live market — **load-bearing** | `npm run fee`. Simulates `finalize(pool)` to recover the marketKey, reads `getSettlement`, and if the fee is non-zero computes fee-drag-per-window against metabolic-cost-per-window so the wording change is forced by arithmetic instead of taste. |
| 2 | Exact agent ids and per-agent inference prices | `agents.somnia.network`, `/agents/invoking-agents/gas-fees.md`. `Deploy.s.sol` refuses to deploy with `LLM_AGENT_ID=0`. |
| 3 | The settlement resolution event's topic0 | `npm run subscribe -- --discover`. No event signature is declared in any doc we have, so it is measured from the singleton's own logs rather than guessed — a wrong topic0 produces a subscription that silently never fires, which is the worst failure mode available here. |
| 4 | The precompile's real callback selector, and the 11-parameter `subscribe(...)` ABI | Read from `@somnia-chain/reactivity`; override via `REACTIVITY_CALLBACK_SIG` without a redeploy. Until then `ISomniaEventHandler.onSomniaEvent` is a placeholder name, not a transcribed signature. |
| 5 | Whether Solidity subscriptions support `ethCalls` | `SoliditySubscribeRequest` in `@somnia-chain/reactivity`. Not on the critical path — the handler calls `settleAll()`, which reads window state on chain, so `REACTIVITY_INCLUDE_DATA=false` and the payload is not needed. |
| 6 | What `Response.receipt` commits to; behaviour when validators disagree | Open. Non-`Success` is already handled as an abstain, so this is a question about what the attestation *means*, not about whether the contract survives it. |
| 7 | Whether a prior Somnia reactivity hackathon project already shipped population/evolution mechanics | **Unchecked** — WebSearch was unavailable for the whole research phase. This is the most exposed novelty claim available, so nothing in the submission claims to be first. |

## Consequences already taken into the build

- `placeBinaryOrder` is contract-callable (Path A), but this build does **not** route orders.
  Organisms take positions only via `mintSet` pairing; an organism nobody contradicted emits
  `Unpaired` and takes no position. Deterministic and cold-start-proof, at the cost that a
  unanimous window puts nothing at stake — which `monitor.ts` alerts on, since it is also the
  signature of genomes converging.
- `scripts/executor.ts` (Path B) is cut.
- `Schedule` / `BlockTick` subscriptions would move the cadence on-chain too and remove the
  last keeper. Real and unbuilt; the README says so rather than implying otherwise.
