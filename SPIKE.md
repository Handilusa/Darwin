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

**Rows 1–5 were closed on 2026-08-29.** Full evidence in `docs/SESSION_CHECKPOINT.md`; summary
here so this table is not read as current.

| # | Was unverified | Outcome |
|---|---|---|
| 1 | `settlementFeeBpsTimes1k == 0` on a live market — **load-bearing** | **CLOSED — measured 0 across 398 of 398 finalized markets** (80,000 blocks), all collateralised in tUSDC, 0 voided. Also found and fixed a real bug: `npm run fee` declared `getSettlement` flat when it returns one dynamic struct, which made the gate print `PASS` **without ever reading the fee field**. See checkpoint §2.6–2.7. |
| 2 | Exact agent ids and per-agent inference prices | **CLOSED — `LLM_AGENT_ID = 12847293847561029384`**, identified by a 96/96 selector correlation and confirmed by decoding a live payload into English. Prices measured live: `getAdvancedRequestDeposit(n)` is exactly 0.01 STT × n, so at this repo's defaults `requestDeposit()` = **0.06 STT per organism per window** — about 4× cheaper than the figure this document assumed. Checkpoint §2.4–2.5. |
| 3 | The settlement resolution event's topic0 | **CLOSED — the filter is `0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178` (finalize).** Two caveats that this row got wrong: (a) `--discover` ranks by frequency and would pick the **redeem** event instead (281 vs 130 occurrences), which fires on our own redemption and is circular — pass `--topic0` explicitly; (b) this RPC **silently ignores the `topics` filter** on `eth_getLogs`, so filtering must happen client-side. Checkpoint §2.8. |
| 4 | The precompile's real callback selector, and the 11-parameter `subscribe(...)` ABI | **CLOSED — `onEvent(address,bytes32[],bytes)`**, from `SomniaEventHandlerABI` in the installed `@somnia-chain/reactivity@0.2.1`. `onSomniaEvent` does not exist anywhere in the SDK; it was this repo's placeholder. The `REACTIVITY_CALLBACK_SIG` escape hatch is gone. The 11-field tuple is confirmed by live reads: `getSubscriptionInfo(1)`/`(2)` decode cleanly against it on Shannon. Checkpoint §2.2–2.3. |
| 5 | Whether Solidity subscriptions support `ethCalls` | **CLOSED, unfavourably — they do not.** `SoliditySubscribeRequest` is `{ handlerContractAddress, filter?, options }`: no `ethCalls`, no `handlerFunctionSelector`. Immaterial as this row predicted — the handler calls `settleAll()`, which reads window state on chain, so `REACTIVITY_INCLUDE_DATA=false` stands. |

Still genuinely open:

| # | Unverified | Resolved by |
|---|---|---|
| 6 | What `Response.receipt` commits to; behaviour when validators disagree | Open. Non-`Success` is already handled as an abstain, so this is a question about what the attestation *means*, not about whether the contract survives it. |
| 7 | Whether a prior Somnia reactivity hackathon project already shipped population/evolution mechanics | **Unchecked** — WebSearch was unavailable for the whole research phase. This is the most exposed novelty claim available, so nothing in the submission claims to be first. |
| 8 | ~~Whether the platform enforces a minimum inference timeout~~ | **CLOSED 2026-08-29 — it does not.** Swept by `eth_call` with a balance `stateOverride`, which needs no private key and no funds, so nothing was broadcast: timeouts of 1, 60, 120, 299, **300**, 301, 599, 600, 601, 900, 3600 and 86400 s are all accepted, and only `0` reverts (`InvalidTimeout()`, `0x7fee1bc4`). `defaultTimeout() = 600` is a default, not a floor. Settled independently by measurement too: **observed end-to-end latency over n = 6,231 completed request lifecycles is p50 0.6 s, p99 4.3 s, max 5.3 s** — 300 s carries ~50x headroom over the worst case, and **6,232 of 6,232 requests reached a terminal status event**. The same sweep pinned the real constraint: `value >= getAdvancedRequestDeposit(subcommitteeSize)` **exactly** (0.03 STT passes, 0.03 minus one wei reverts), which `Population`'s 0.06 STT clears with 2x margin. `Population.sol` needs no change. Checkpoint §2.11. |
| 9 | Constrained inference with a non-empty `allowedValues` | **Half closed 2026-08-29.** A payload carrying all nine `allowedValues` with `chainOfThought = true` was simulated against the live `AgentRequester` and **accepted** — the request shape is not rejected. Whether the validators *honour* the constraint still needs one real request. Degrades safely: `Genome.parseAnswer` maps anything unrecognised to `(Abstain, Unknown)`, but a broken constraint silences selection. |
| 10 | ~~`BINARY_MARKETS_MODULE` and `OUTCOME_TOKEN_6909` addresses~~ | **CLOSED 2026-08-29.** Module confirmed by cross-referencing two contracts: 102 marketIds from its own logs return populated markets, 102/102 with `collateral == tUSDC`, and 72 return a `pool` that independently appears in a `BinarySettlement` finalize log — which also confirms the 14-field `markets()` ABI and its field ordering. Token confirmed first-hand: the module's own `outcomeToken()` returns `0xB52c5934…`. Both are ERC-1967 proxies. Also measured across 297 markets: `outcomeSlotCount == 2` in 297/297, `voidPolicy == 0` in 297/297 (which explains 0/398 voided), `noId == yesId + 1` in 297/297. |
| 11 | **Whether a `think()` can land in a gap between 900 s market cycles** | Largely mitigated 2026-08-29. Durations across 297 markets: 60 s ×160, 300 s ×96, **900 s ×23**, 3600 s ×11, long tail ×6. The 15-minute window is *justified* — inference has a 300 s timeout against a 600 s platform default, so 900 s is the shortest venue duration that fits an on-chain LLM round trip, and the 86% at 60 s or 300 s are unusable. Point-in-time check at 15:04Z: 11 markets live, **5 usable**, including **two 900 s markets in lockstep** (same 644 s to close), which corroborates the finalize oracle batching exactly 2 markets per tx. Also: **markets opening in the future = 0**, so nothing is pre-created — the cadence must consume what is live, which vindicates reading `markets()` every call and never caching a pool. Residual risk is only a short gap between cycles. |

## Consequences already taken into the build

- `placeBinaryOrder` is contract-callable (Path A), but this build does **not** route orders.
  Organisms take positions only via `mintSet` pairing; an organism nobody contradicted emits
  `Unpaired` and takes no position. Deterministic and cold-start-proof, at the cost that a
  unanimous window puts nothing at stake — which `monitor.ts` alerts on, since it is also the
  signature of genomes converging.
- `scripts/executor.ts` (Path B) is cut.
- `Schedule` / `BlockTick` subscriptions would move the cadence on-chain too and remove the
  last keeper. Real and unbuilt; the README says so rather than implying otherwise.
