# SESSION CHECKPOINT — 2026-08-29

Supersedes the 2026-08-28 checkpoint, several of whose claims are now false (see §7).
DARWIN build, Somnia × DreamDEX Event Contracts Hackathon (closes 2026-09-08).
Plan unchanged: `C:\Users\Handi\.claude\plans\delightful-coalescing-grove.md`.
Working directory: `C:\Users\Handi\Desktop\somnia_predict\darwin`.

This segment produced **no new architecture**, by instruction. It closed empirical gaps
using installed ABIs, primary docs and live Shannon reads, and recorded the results.

**Format rule for this file:** every statement in §2 names the primary source that
establishes it. Anything that cannot name one lives in §3 instead. Nothing may be repeated
in the pitch from §3.

---

## 1. What this segment was asked to do

Four blockers, in priority order:

| # | Blocker | Status |
|---|---|---|
| 1 | Obtain and verify `LLM_AGENT_ID` | **CLOSED** — measured from chain, confirmed by decoding a live payload |
| 2 | Read the installed Reactivity ABI, determine the exact callback signature | **CLOSED** — `onEvent(address,bytes32[],bytes)`; the name `onSomniaEvent` does not exist |
| 3 | Create the live subscription and prove the same-block trigger | **BLOCKED on a deploy — and the deploy is blocked only on a funded key.** The deploy script is now dry-run verified end-to-end against live Shannon (§2.12) |
| 4 | Measure `settlementFeeBpsTimes1k` | **MEASURED — 0 across 398/398 markets.** Found and fixed a bug that made the gate self-confirming |

Two further blockers were found and fixed while clearing the four above — neither was on the
list because neither was known to exist:

| Found | Status |
|---|---|
| `requestTimeout = 300` suspected below an enforced platform minimum, which would have silently extinguished the population in ~2 days | **NOT A BUG — proven safe.** No minimum is enforced, and measured inference latency is max 5.3 s against the 300 s deadline (§2.11). No code change |
| **`evm_version = "paris"` made the deploy fail at its first live call.** `--broadcast` simulates first, so the Day-2 deploy would have failed at the first command | **FIXED** — raised to `shanghai`; deploy now simulates clean. Plus a second fix: a dry run used to overwrite the deployment manifest every ops script reads (§2.12) |

---

## 2. CONFIRMED FACTS

### 2.1 Build and toolchain state — measured this segment

| Fact | How |
|---|---|
| `darwin/` **is** a git repository | `git rev-parse --is-inside-work-tree` → `true` |
| `contracts/lib/` is populated: `forge-std`, `openzeppelin-contracts`, `openzeppelin-contracts-upgradeable` | `ls contracts/lib` |
| **`forge test --root contracts` → 56 passed, 0 failed, 0 skipped** (63 ms) | run this segment |
| **`npm run typecheck` (`tsc --noEmit`) → clean** | run this segment |
| `@somnia-chain/reactivity@0.2.1`, `@somnia-chain/markets-sdk@0.28.1` installed | `node -e require(...).version` |
| **No deploy has happened.** `contracts/deployments/` holds only `.gitkeep` | `ls -a contracts/deployments` |

The correctness of this code is now a **compiler claim**, not a reading claim. That was the
single highest-value outstanding action in the previous checkpoint and it is done.
`markets-sdk@0.28.1` already matches the version `SPIKE.md` names as the pin candidate.

### 2.2 Priority 2 — the reactivity callback signature

Primary source: the installed package, `node_modules/@somnia-chain/reactivity/dist/`.

- **The callback is `onEvent(address emitter, bytes32[] eventTopics, bytes data)`**,
  `nonpayable returns ()` — `dist/index.d.ts` lines 448–466, `SomniaEventHandlerABI`,
  which declares exactly one function. The selector string appears literally as
  `"onEvent(address,bytes32[],bytes)"` at `dist/index.js:89`.
- **`onSomniaEvent` does not exist anywhere in the SDK.** It was a placeholder name this
  repo invented. `SelectionEngine.sol` already implements the real one, and
  `test_reactivity_handlerSelectorIsTheOneThePrecompileCalls` passes.
- Precompile address `0x0000000000000000000000000000000000000100` — `dist/index.js:68`.
- Gas rule: a non-zero `maxFeePerGas` must sit **≥ 6 gwei above** `priorityFeePerGas` —
  the error string at `dist/index.js:158`. The `subscribe.ts` fix recorded on 2026-08-28
  is therefore correct as written.
- `subscribe((bytes32[4],address,address,address,address,bytes4,uint64,uint64,uint64,bool,bool)) returns (uint256)`,
  plus `unsubscribe(uint256)` and `getSubscriptionInfo(uint256)`. Events: `BlockTick`,
  `Schedule`, `SubscriptionCreated`, `SubscriptionRemoved`.
- **Solidity subscriptions do NOT support `ethCalls`.** `SoliditySubscribeRequest` is
  `{ handlerContractAddress, filter?, options }` — no `ethCalls`, no
  `handlerFunctionSelector`. This closes `SPIKE.md` row 5, and it closes it the
  unfavourable way: the payload-delivered-atomically idea is not available to a Solidity
  handler. Immaterial here — the handler calls `settleAll()`, which reads window state on
  chain, so `REACTIVITY_INCLUDE_DATA=false` stands.

### 2.3 The precompile is live on Shannon and answers in the declared shape

- `eth_getCode(0x0100)` → `undefined`, i.e. no bytecode, exactly as documented. Presence
  cannot be probed that way.
- **`getSubscriptionInfo(1)` and `(2)` return real data that decodes cleanly against the
  11-field tuple above.** So the precompile responds and the ABI shape is right.
  `getSubscriptionInfo(0)` reverts — ids appear to be 1-based.
- Subscription 1's `topics[0]` is `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`
  = `Transfer(address,address,uint256)`. Third parties are already using reactivity on
  Shannon. This is the first direct evidence the mechanism works on this chain at all.

### 2.4 Priority 1 — `LLM_AGENT_ID = 12847293847561029384`

The docs are explicit that there is **no on-chain agent registry and no global HTTP
slug→id resolver**; the id comes from the Agent Explorer UI or from a receipt. So it was
measured from chain.

Scanned 60,000 blocks of `AgentRequester` logs → 37,340 logs → 6,236 request-creation
events (`topic0 0xb62339927ed9948fd837358a55f5b9a824f7b047043faece66965593ed726889`,
`topic1` = requestId, `topic2` = agentId). Exactly **three** distinct agentIds:

| agentId | hex | requests | payload carries `0xfe7ca098` (`inferString`) |
|---|---|---|---|
| **12847293847561029384** | `0xb24ac1afbcefc708` | 96 | **96 / 96** |
| 9911223344556677889 | `0x898bbd1eb5dc1b01` | 5,859 | 0 |
| 13174292974160097713 | `0xb6d47da8dbbcb1b1` | 281 | 0 |

An agentId is constant per agent and distinct across agents; a hash or a nonce would not
behave that way. One id, and only that id, carries the LLM agent's own function selector,
in every one of its requests.

**Conclusive confirmation** — decoded the payload of a live request (tx
`0x78b04fc8907178dce7e4a713d9549b6ecfb4ac36f59c5ed3ef3e88d75592548c`, block 474393064,
requestId 12650214, agentId matches). It decodes as
`inferString(string,string,bool,string[])` into real text:

- `arg0 prompt` — `"[INPUT]\nQuestion: What is the price of BTC in USDC at unix time 1788012600 UTC?\nPrompt:\n- JSON https://data-api.binance.vision/..."` (six exchange URLs with JSON paths)
- `arg1 system` — `"/no_think\n[SYSTEM POLICY]\nPolicy: Decentralized Oracle Question Safety\nINSTRUCTIONS\nYou are a Trust & Safety reasoning agent..."`
- `arg2 bool` — `false`
- `arg3 allowedValues` — `[]`

**Two corollaries, both closing the `VERIFY` block at the head of `ISomnia.sol`:**

1. `inferString(string prompt, string system, bool chainOfThought, string[] allowedValues)`
   is correct as declared — **arg1 is a system prompt, not a model name**, which is exactly
   what `Population.think` passes (`p.systemPrompt()`, `Population.sol:366`). This was the
   one thing in this segment that looked like it might be a live bug in our code. It is not.
2. `abi.encodeCall(ILLMAgent.inferString, ...)` matches the live payload encoding: the
   selector computed from our declaration, `0xfe7ca098`, is the selector live requests
   actually carry. That is how the agent was found in the first place.

### 2.5 Inference cost — measured live, and it is ~4x cheaper than assumed

| Read | Value |
|---|---|
| `getRequestDeposit()` | 0.03 STT |
| `getAdvancedRequestDeposit(n)` | **exactly 0.01 STT × n** for n ∈ {1, 2, 3, 5, 10} |
| `defaultSubcommitteeSize()` | 3 |
| `defaultThreshold()` | 2 |
| `defaultTimeout()` | **600 s** |

At `Population`'s own defaults (`subcommitteeSize = 3`, `perAgentReward = 0.001 ether` since
§2.14 lowered it from 0.01), `requestDeposit()` = `0.03 + 0.003` = **0.033 STT per organism
per inference**. The 0.03 half is the platform floor and is fixed; §2.14 confirms it is
exactly `0.01 x subcommitteeSize`, linear across n = 1..21.

Budget consequence: 8 organisms → **0.264 STT per window** of thinking, plus one mutation
request per breeding organism. Across 400 windows ≈ **106 STT** plus breeding — and rising as
the population breeds toward `maxPopulation = 24`. See the table in §2.14.

Two doc figures are contradicted by the chain: the "0.07 SOMI per agent" price is not the
testnet floor (measured floor is 0.01 STT per agent), and the timeout default is 600 s,
not the 15 minutes the docs state.

### 2.6 Priority 4 — `settlementFeeBpsTimes1k == 0`, n = 398

`getSettlement` returns **one dynamic struct**, not nine flat values — the raw returndata
begins `0x…0020`, the offset word a single dynamic return carries.

Read every distinct finalized market in 80,000 blocks:

| Measurement | Result |
|---|---|
| distinct finalized marketKeys read | **398** (0 failures) |
| `settlementFeeBpsTimes1k` | **0 in 398 / 398** |
| `finalized` | 398 |
| `voided` | **0** |
| collateral token | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` (tUSDC) in all 398 — matches `Deploy.s.sol`'s `TUSDC` |
| payout vectors | `[10000000, 0]` ×231, `[0, 10000000]` ×167 |
| fee recipients | `0xE7eB5D2b5b188777df902e89c54570E7Ef4F59CE` ×322, `0xf685C1245b59800a9940131DC1952F39736DdC2a` ×76 |

- The load-bearing economic claim is now a **measurement across 398 markets**, not an
  anecdote and not documentation.
- Payout numerators are one-hot at exactly `1e7`, confirming `FEE_DENOMINATOR = 10_000_000`
  in `measure-fee.ts`. The 231/167 split shows markets resolving both ways.
- The fee recipient varies by market creator. Irrelevant while the fee is 0, but it means
  "there is no fee recipient" would be a false statement — there is one; it collects nothing.
- **`marketKey == (uint256(uint160(pool)) << 64) | nonce`** — verified: the pool derived
  from the key equals `struct.pool`. So a marketKey is readable straight off a settlement
  log's `topic1`, and the `finalize(pool)` simulation is not the only route to one.
- Reference market: key
  `0x000000000547acf67acc5e7db37ab810ce05ff02b48b94d70000000000000140`,
  pool `0x0547ACF67aCc5e7Db37aB810ce05Ff02b48B94d7`, nonce 320.

**Reproducing the n=398 sweep.** It was measured with a throwaway probe, now deleted, and
`measure-fee.ts` deliberately measures one market rather than sweeping. The method, in full,
so it does not have to be rediscovered: `eth_getLogs` on `BINARY_SETTLEMENT` in 1,000-block
pages (the RPC cap), filter `topics[0] === T_A` **client-side** (see §2.8), take
`[...new Set(logs.map(l => l.topics[1]))]` as the marketKeys, and `getSettlement` each one
using the struct ABI now in `measure-fee.ts`. Any single one of those keys can be re-checked
right now with `npm run fee -- --key 0x…`, no deploy needed.

### 2.7 A real bug in the fee gate — found and fixed

`scripts/measure-fee.ts` declared `getSettlement` **flat**. Against a struct return that
shifts every field by exactly one word (`flat[i+1] == struct[i]`), and both resulting
failure modes are silent:

- a market whose backing has been redeemed to 0 reads `finalized` from `backing == 0` →
  *"not finalized yet"*, and the fee is never measured at all;
- a market with non-zero backing reads `finalized` truthy and the fee from
  `voided == false` → `0`, and the script prints
  **`PASS — settlementFeeBpsTimes1k == 0` without ever reading the fee field.**

The second is the dangerous one: an honesty gate that confirms itself. Both were
demonstrated side-by-side against the live chain on the reference market — struct decode
gives `finalized=true, voided=false, fee=0`; flat decode gives `collateralToken=0x…0020`,
`backing=6.43e47`, `finalized=false`.

Fixed this segment; `npm run typecheck` clean. Changes to `measure-fee.ts`:

1. ABI corrected to the struct return, with the failure modes written at the site so nobody
   "tidies" the extra parentheses away.
2. Destructure switched to named struct fields.
3. Added `--key 0x…`, which takes a marketKey straight from a settlement log and skips the
   `finalize(pool)` simulation — the gate can now be pointed at any market the venue has
   already settled, including one this population never traded.
4. Corrected the header claim that `finalize(pool)` is the *only* way to obtain a marketKey.

### 2.8 The two `BinarySettlement` events, and which one to subscribe to

**RPC quirk that cost a wrong answer:** `dream-rpc.somnia.network` **ignores the `topics`
filter on `eth_getLogs`**. A filtered query returns the unfiltered set, so two different
topic0s produced byte-identical output in the first attempt. Filter client-side. (It also
caps `eth_getLogs` at a 1,000-block range.)

With client-side filtering and every print asserting `l.topics[0]`:

| | **T_A — finalize** | **T_B — redeem** |
|---|---|---|
| topic0 | `0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178` | `0xe31682dd835b7d7bcc4d22f343666af1cc50614bfa16f510ed812ad4ed56f3b4` |
| topics | 3 — `marketKey`, `pool` | 4 — `marketKey`, user, to |
| data | 256 B — nonce, collateralToken, backing, one unnamed scalar, `payoutNumerators[]` | 96 B |
| count / 40k blocks | 130 | 281 |
| emitted by | an oracle driver (tx → `0xee3aff92…`, selector `0x53edf33d`), **batching 2 markets per tx** | `finalizeAndRedeem` itself |

- **`0x17a10e13` = `finalizeAndRedeem(address,uint256,uint256,address)`**, confirmed by
  keccak match against the observed tx selector.
- **The subscription filter must be T_A.** Subscribing to T_B would trigger on DARWIN's own
  redemption — circular and useless.
- **Operationally important: finalize and redeem happen in different transactions.** The
  oracle driver finalizes markets in batch; a later `finalizeAndRedeem` finds the market
  already finalized and only redeems. This is *good* for the central claim and it is exactly
  the intended shape: the callback fires on T_A in the finalize block, and `settleAll()`'s
  `finalizeAndRedeem` redeems inside that same synthetic transaction.
- Useful for `prove-same-block.ts`: **T_A's `topic2` is the pool**, so correlation can match
  it directly instead of scanning topics and data for a left-padded address.
- `topic1` of both events resolves as a real marketKey via `getSettlement`.

### 2.9 Addresses

- `AGENT_REQUESTER` = `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` — docs (two pages),
  matches `Deploy.s.sol`, **and confirmed live**: it answers `getRequestDeposit()` /
  `getAdvancedRequestDeposit()` / `defaultSubcommitteeSize()` and emits the request events.
  It is an ERC-1967 proxy — live implementation `0x6d24b6757a2aaa139f613269ac425095e7028900`,
  implementation at construction `0xcfac1f3e888cf2a4248dd5ef8843f7b6fd1c94df`. Source is
  **not** verified on the explorer, so there is no ABI to fetch.
- `BINARY_SETTLEMENT` = `0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23` — **confirmed live**:
  it emits both settlement events and answers `getSettlement`.
- `TUSDC` = `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` — **confirmed live** as the
  collateral of all 398 settled markets.
- Mainnet `AgentRequester` `0x5E5205CF39E766118C01636bED000A54D93163E6` (docs; unused).
- The testnet agent explorer is **`agents.testnet.somnia.network`**. `CLAUDE.md` and the
  comment at `Deploy.s.sol:135` both cite the *mainnet* host `agents.somnia.network`.

---

### 2.10 The DreamDEX venue — module, token, and what durations it actually runs

Confirmed 2026-08-29 by live read, closing the last two unverified addresses.

**`BINARY_MARKETS_MODULE` = `0x3ecC694Cef705358864a646142ac17A90E29e388` — CONFIRMED.**
Not by a bytecode-exists check but by cross-referencing two independent contracts: 102
marketIds taken from the module's own logs returned populated markets, **all 102** with
`collateral == tUSDC`, and **72 of them return a `pool` that also appears as `topic2` of a
`BinarySettlement` finalize log**. A wrong address or a shifted tuple cannot produce that
agreement. This also confirms the 14-field `markets()` ABI in `scripts/lib/darwin.ts`,
including the field ordering `PushedPriceSource` depends on.

**`OUTCOME_TOKEN_6909` = `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` — CONFIRMED, first
hand:** the module itself exposes `outcomeToken()` and it returns exactly this address.
ERC-6909 reads work against it — for one sampled market, `totalSupply(yesId)` and
`totalSupply(noId)` are both 1,504,000,000 (equal, as paired `mintSet` implies) and
`balanceOf(pool, yesId)` is 990,000,000.

**Both are ERC-1967 proxies** — module implementation `0xdf87ac5c4760e2f1dd78e054ce0629a26a4ca5ca`,
token implementation `0x2e769a680e1f214c3922094677a81d2a1f22d14e`. They can be upgraded
underneath this build.

Across 297 populated markets:

| Property | Result |
|---|---|
| `outcomeSlotCount` | **2 in 297/297** — always binary. DARWIN's core assumption holds. |
| `voidPolicy` | **0 in 297/297** — uniform, and it explains the 0/398 voided markets in §2.6 |
| `noId == yesId + 1` | **297/297** — structural, not coincidental |

**Market durations (`expiry - tradingStart`) — the operationally important one:**

| Duration | Count | |
|---|---|---|
| 60 s | 160 | too short for inference |
| 300 s | 96 | too short for inference |
| **900 s (15 min)** | **23** | **what DARWIN's cadence assumes** |
| 3600 s | 11 | usable |
| 14400 s / 86400 s / ~608 s / ~280-298 s | 1 each | long tail |

Two conclusions, and they pull in opposite directions:

1. **The 15-minute window is now justified on hard grounds rather than taste.** Inference
   is asynchronous with `requestTimeout = 300 s` against a platform default of 600 s
   (§2.5). A 60 s or 300 s market **cannot** accommodate an on-chain LLM round trip at
   all, so 900 s is the shortest venue duration that fits one. That is a real answer to
   "why 15 minutes", and it is measured.
2. **But those are 23 of 297 markets — about 8%.** The durations DARWIN can actually use
   (900 s and longer) total roughly 38 of 297; the 86% that are 60 s or 300 s are
   unusable. Availability of a live 15-minute market at any given moment is therefore not
   guaranteed. See §3 row 13.

**Point-in-time availability check, 2026-08-29T15:04Z (block 474428619).** Of 205
populated markets, **11 were live** (`tradingStart <= now < expiry`) and **5 of those were
usable** at ≥ 900 s:

| Live duration | Count | |
|---|---|---|
| 60 s | 2 | unusable |
| 300 s | 4 | unusable |
| **900 s** | **2** | both closing in 644 s |
| 3600 s | 2 | both closing in 3344 s |
| 86400 s | 1 | closing in 32144 s |

Three things follow, and they are all load-bearing:

- **15-minute markets are continuously available, not occasional.** Two were live, in
  lockstep on the same closing time. That is consistent with a rolling 15-minute cycle
  creating two markets at a time — and it matches the finalize oracle batching **exactly 2
  markets per transaction** in §2.8. The two independent observations corroborate.
- **Nothing is pre-created: markets opening in the future = 0.** Markets appear at or just
  before `tradingStart`, so the cadence cannot look ahead and schedule; it must consume
  whatever is live at the moment it runs. This vindicates `PushedPriceSource` reading
  `markets()` on every call and the rule never to cache a pool or outcome id.
- **There are natural fallbacks.** A 3600 s and an 86400 s market were also live, so a
  brief gap between 900 s cycles need not mean "no market at all" — though trading a 24-hour
  market would cut the settlement rate that generation count depends on.

Residual risk, reduced but not eliminated: because nothing is pre-created, there may be
short gaps between one 900 s cycle closing and the next opening. A `think()` landing in
such a gap abstains and still pays metabolism.

### 2.11 `requestTimeout = 300` is safe, and inference is ~500x faster than that

Method: `eth_call` against `AgentRequester.createAdvancedRequest` with a `stateOverride`
supplying the caller a balance. **This needs no private key and no funds** — a payable call
can be simulated for free — so the whole parameter space was swept without broadcasting
anything. Payload was a real `inferString` encoding with all nine `allowedValues` and
`chainOfThought = true`.

**Accepted timeouts:** 1, 60, 120, 299, **300**, 301, 599, 600, 601, 900, 3600, 86400 s.
**Rejected:** `0` only, with `InvalidTimeout()` (`0x7fee1bc4`).

> **No minimum timeout is enforced.** The only constraint is non-zero. `requestTimeout = 300`
> sitting below `defaultTimeout()` of 600 s is a *default*, not a floor. The extinction
> scenario this was raised against does not exist, and `Population.sol` needs no change.

**The deposit floor is the real constraint, and it is exact:**

| `value` sent | Result |
|---|---|
| 0 | REVERT `0x25c3f46e` |
| `getAdvancedRequestDeposit(3) − 1 wei` = 0.029999… STT | REVERT `0x25c3f46e` |
| **0.03 STT exactly** | ACCEPTED |
| 0.06 STT (what `Population.requestDeposit()` sends) | ACCEPTED |

So the floor is `>= getAdvancedRequestDeposit(subcommitteeSize)` and `Population` clears it
with 2x margin. Overpaying is permitted. A non-contract callback address is also permitted,
so `Prophet` being a `BeaconProxy` raises no issue.

**Observed end-to-end latency, n = 6,231 completed request lifecycles** over 60,000 blocks
(block time measured at **0.1000 s**, so 60k blocks = 100 min):

| | blocks | seconds |
|---|---|---|
| min | 2 | 0.2 |
| p50 | 6 | 0.6 |
| p90 | 7 | 0.7 |
| p99 | 43 | 4.3 |
| max | 53 | **5.3** |

**0 of 6,231 exceeded even 6 seconds.** A 300 s timeout carries roughly 50x headroom over
the worst observed case. This closes the timeout question from both directions: the contract
accepts 300, and nothing on the platform comes close to needing it.

**The `AgentRequester` event lifecycle, from 37,328 logs:**

| topic0 | count | shape | reading |
|---|---|---|---|
| `0xb62339927ed9948f…` | 6,232 | 3 topics, 3,648 data bytes | request created (§2.4) |
| `0x1b44ed537f0ae64c…` | 18,597 | 3 topics, 4 words | **exactly 3 per request** — one per validator, matching `subcommitteeSize = 3` |
| `0x15863241ef82702f…` | 6,232 | 2 topics, 2 words | per-request aggregate |
| `0x65db1ef5b3bcd84f…` | 6,232 | 2 topics, 1 word | terminal status; the word is **2** on the decoded lifecycle |
| `0xa5b05eec8040da65…` | 35 | 2 topics, 1 word | not requestId-keyed; unidentified |

**6,232 creations → 6,232 terminal-status events. The platform completed every request in
the sample.** That is the number that matters for a population whose only failure mode is
not thinking.

Decoded lifecycle (requestId 12654824, created block 474437502, all follow-ups at +3 blocks):
each of the 3 validator events carries a constant `300000000000000` wei (0.0003 STT), and the
aggregate event carries `900000000000000` (= 3 x 0.0003) alongside the same 0.0003. See §3
row 14 — this is suggestive of actual consumption far below the 0.03 STT deposit, but the
event is unnamed and the refund question is **not** closed by it.

### 2.12 The deploy was broken, and `evm_version = "paris"` was why

Found by dry-running the deploy — `forge script … --rpc-url <shannon>` **without**
`--broadcast`, which executes the entire script against live chain state using a throwaway
key that was never funded and never broadcast. This costs nothing and needs no real key.

Under the repo's then-current `evm_version = "paris"`, the deploy died on the **first live
call it makes**, `IERC20Like(TUSDC).decimals()` in `_inputs`:

```
├─ [48] ::decimals() [staticcall]
│   └─ ← [NotActivated] EvmError: NotActivated
└─ ← [Revert] EvmError: Revert
Error: script failed: <empty revert data>
```

Cause: **`evm_version` sets both solc's target and the EVM spec forge executes with.** A
script that touches a live contract runs *that contract's* fetched bytecode under our spec,
and the deployed DreamDEX contracts use PUSH0 (Shanghai). The error message names neither
PUSH0 nor `evm_version`.

> **This was not a dry-run-only problem.** `forge script --broadcast` simulates the script
> before sending anything, so the simulation failure aborts the run. The Day-2 deploy would
> have failed at the first command, on the morning it was scheduled, with an error that
> points at nothing.

Confirmed by re-running the identical script under other specs:

| `--evm-version` | Result |
|---|---|
| `paris` (repo default) | **FAILS** at `decimals()`, `NotActivated` |
| `shanghai` | full deploy simulates clean — 11,896,341 gas, **0.1428 STT** |
| `cancun` | full deploy simulates clean — 11,838,018 gas, 0.1421 STT |

**Fix applied:** `foundry.toml` → `evm_version = "shanghai"`. Re-verified after the change:
`forge test` **56/56**, dry run clean **with no CLI flag**, and both storage layouts re-derived
**byte-identical** (`evm_version` targets codegen, not slot assignment — but it was re-run
rather than assumed, because the freeze is the next transaction).

`shanghai` over `cancun` deliberately: it is the minimum that works and the maximum the
evidence supports. **Shannon's fork is no longer unconfirmed — its own production contracts
contain PUSH0 and execute, so the chain is at least Shanghai.** The `cancun` simulation
passing proves nothing about Shannon; it only exercised local revm. This also leaves the
`_disableInitializers()` reasoning intact: EIP-6780 is a *Cancun* change, so `selfdestruct`
still cannot be assumed defused.

**A second bug fixed in the same pass.** `_writeManifest` wrote
`contracts/deployments/<chainid>.json` unconditionally — including on a dry run, whose
addresses are simulated and exist nowhere. Every ops script, `monitor.ts` and the frontend
read that manifest as the source of truth, so a dry run would have pointed the whole
operational surface at contracts that were never deployed, while looking exactly like a
successful deploy. Now guarded on `vm.isContext(VmSafe.ForgeContext.ScriptDryRun)`, which
makes dry-running safe to repeat — the point, since it is the cheapest check available.

Also recorded: the script argument needs the `:Deploy` suffix, and
`forge script script/Deploy.s.sol --root contracts` from `darwin/` fails with *"contract
source info format must be `<path>:<contractname>`"* — path resolution, not code.

### 2.13 The inference deposit is consumed, not refunded — the STT budget is real

This was §3 row 14, and it mattered: refunded meant ~6 STT for the whole run, consumed meant
~192 STT, and a testnet faucet may not cover the second.

First measurement (indicative but **not** decisive): `AgentRequester`'s own native balance
went 0.055442 → 0.031221 STT across **4,170 requests**. Had it retained the 0.03 floor it
would have accumulated ~125 STT. So the requester does not hoard deposits — but that cannot
distinguish *refunded to the caller* from *forwarded to validators*, and only the caller's
loss matters for our budget.

Decisive measurement, on the payer. Five single-request transactions from
`0x7ccae31e45693475be1e4baa2360d6997eb2d32b` (holding ~53,546 STT), each identical:

| | |
|---|---|
| `tx.value` | 0 — the deposit is pulled internally, not attached to the call |
| gas cost | 0.00064833 STT |
| payer balance decrease | 0.03154833 STT |
| **net cost of the request** | **0.03090000 STT**, five times out of five |

**Nothing is refunded.** And the number decomposes exactly:
`0.0309 = 0.03 (the deposit floor) + 0.0009 (= 3 x 0.0003)` — which is precisely the
per-validator quantity seen in the lifecycle events in §2.11. Two independent observations
agreeing to the wei.

Consequence for `Population`, which sends `requestDeposit()` = floor + `perAgentReward` x 3:
assume it is all consumed. At the settings in force when this was measured that was
0.03 + 0.03 = **0.06 STT**, i.e. 8 organisms x 400 windows ≈ 192 STT. §2.14 decomposes that
number and cuts it to ~106 STT; the *method* here is what stands.

It also shows `perAgentReward = 0.01 ether` was **~33x the rate live traffic actually pays**
(0.0003 per validator). It was lowered to 0.001 as a result — see §2.14.

**One sample was discarded, and why.** A sixth transaction (12 requests, payer
`0x463711ab…`) showed the payer's balance *rising*. Balance-delta measurement is only valid
when the address receives nothing else in that block, and that address appears to be paid in
the same block it pays. It is not evidence of a refund; it is a contaminated sample. The five
clean single-request samples agree exactly.

---

### 2.14 Where the 192 STT actually comes from, and what can and cannot be cut

Prompted by the right question — *"192 STT, why so much?"* — the budget was decomposed
instead of restated. Three findings, and the third changes the plan.

**1. The deposit floor is exactly `0.01 STT x subcommitteeSize`, linear.** Read live from
`getAdvancedRequestDeposit(n)` for n = 0, 1, 2, 3, 4, 5, 6, 10, 21 — every value is `0.01 * n`
to the wei, and `n = 0` returns 0. `getRequestDeposit()` returns 0.03, i.e. the n=3 case. So
the floor is a per-validator price, not a fixed fee, and it **corroborates §2.13 exactly**:
the 0.0309 STT that real payers spend is `3 x (0.01 + 0.0003)`.

**2. The cost is a request count, and the floor dominates it.** One request per alive organism
per window (`Population.sol:367-388`, `dep = requestDeposit()` inside the loop), so:

> cost = `subcommitteeSize x (0.01 + perAgentReward) x aliveCount x windows`

At the old settings, 8 organisms x 400 windows = 3,200 requests x 0.06 = 192 STT — of which
**96 STT was the platform floor and irreducible**, and 96 STT was our own reward. The reward
half is what was cut. Two caveats that make every figure a lower bound: breeding raises
`aliveCount` toward `maxPopulation = 24`, so **cost grows with evolutionary success**, and each
birth costs one extra mutation request.

| 8 organisms | @0.06 (old) | @0.033 (now) | @0.0206 (absolute floor, n=2) |
|---|---|---|---|
| 24 windows (6 h) | 11.5 STT | **6.3 STT** | 4.0 STT |
| 96 windows (1 day) | 46.1 STT | **25.3 STT** | 15.8 STT |
| 400 windows (4.2 days) | 192 STT | **106 STT** | 66 STT |
| 960 windows (Aug 30 → Sep 8) | 461 STT | **253 STT** | 158 STT |

**`perAgentReward` lowered 0.01 → 0.001** in `Population.initialize`. Still 3.3x the observed
live rate, so it keeps the margin `requestDeposit()`'s own comment argues for, and cuts every
window 45%. 56/56 tests pass; no state variable declaration changed, so **no storage layout
change is possible**, and `test_upgrade_preservesEveryOrganismField` still passes.

**What must NOT be cut:** `subcommitteeSize` to 1. `Prophet.sol:209` requires `agree >= 2`
independently of the platform's own tally, so a subcommittee of 1 abstains every window while
still paying. A subcommittee of 2 works but requires **unanimity**, so one dissenting
validator becomes an abstention — real reliability lost for 0.011 STT/request. Keep 3 unless
funding forces it.

**3. The run cannot be faucet-dripped, and this is the finding that changes the plan.** Somnia's
docs quantify exactly one faucet limit: the Google Cloud faucet is *"limited to 1 STT per
day"*. Nothing self-serve publishes more. Against 253 STT for a continuous run to submission,
dripping is not a strategy. The documented route for more is to ask the team directly —
Discord `#dev-chat` tagging DevRel, or `developers@somnia.foundation` with a description of
the project and a GitHub profile. Other listed faucets (official, Stakely, Thirdweb) can be
stacked but are unquantified.

**The fallback is real and cheap: pausing costs nothing on chain.** Metabolism is charged in
`settleWindow`, per *settled window*, not per unit of wall-clock time — so a paused population
starves no faster than a running one. And `cadence.ts` is a state machine over the on-chain
`phase` that remembers nothing between iterations, so it can be killed and resumed at will.
Generation count, lineage and treasuries all persist. What a pause costs is the *claim* of
continuity, not the data — so if funding is short, run in bursts around the demo rather than
reducing the population or the subcommittee.

---

## 3. REMAINING ASSUMPTIONS

Nothing here may be stated as fact in the pitch. Each line names what would close it.

| # | Assumption | Closed by | Risk if wrong |
|---|---|---|---|
| 1 | ~~`BINARY_MARKETS_MODULE` and `OUTCOME_TOKEN_6909` unverified~~ | **CLOSED 2026-08-29 — both confirmed by live read. See §2.10.** The module by 102 markets cross-referenced against settlement logs (72 pool agreements, 102/102 tUSDC); the token because the module's own `outcomeToken()` returns it. |
| 2 | ~~`requestTimeout = 300` sits below `defaultTimeout()` of 600 s; whether a minimum is enforced is unknown~~ | **CLOSED 2026-08-29 — no minimum is enforced. See §2.11.** Swept by `eth_call` with a balance `stateOverride` (no key, no funds, nothing broadcast): every timeout from 1 to 86,400 s is accepted and only `0` reverts, with `InvalidTimeout()`. Independently, observed inference latency is **max 5.3 s over n = 6,231 completed lifecycles**, so 300 s carries ~50x headroom. `Population.sol` needs no change; `setInference` remains available if the platform ever changes. |
| 3 | **Constrained inference is not empirically demonstrated at the validator level.** Partially advanced 2026-08-29: a full payload with all nine `allowedValues` and `chainOfThought = true` was simulated and **accepted by `AgentRequester`**, so the request shape is not rejected. What remains unproven is whether the validators *honour* the constraint — the one live payload decoded from another agent used `allowedValues=[]` | one real request of our own, then read what `handleBelief` receives | `Genome.parseAnswer` maps anything unrecognised to `(Abstain, Unknown)`, so a broken constraint degrades to universal abstention rather than to a wrong trade — survivable, but it silences selection |
| 4 | **The void path is never exercised on Shannon** — 0 of 398 markets voided | find or wait for a voided market | `Prophet` treats void as neutral; `test_void_*` pass against mocks only |
| 5 | **T_A's unnamed data scalar is ambiguous** — always 0 across all 398 markets, so it could be `voided` or `settlementFeeBpsTimes1k`; there is no variance to disambiguate it | a voided market (see #4) | none operationally: the handler ignores the payload and `REACTIVITY_INCLUDE_DATA=false` |
| 6 | **No same-block proof exists.** The subscription has never been created and `npm run prove` has never run | a deploy, then `--create`, then `npm run prove` | until it passes *and* `fallbackEnabled` is false, only the weaker claim is licensed: *"selection is on-chain and atomic with redemption"* — **not** *"no keeper anywhere in the causal chain"* |
| 7 | **The agent id is identified by correlation, not from a UI listing.** No direct `createRequest` calldata was found: every observed request arrives through a wrapper contract using selector `0x53edf33d`, never a direct EOA call | the Agent Explorer at `agents.testnet.somnia.network`, or one real request of our own | evidence is strong (96/96 selector correlation plus a decoded English prompt), but it is inference from chain data rather than a published roster value |
| 8 | The other two agentIds (9911223344556677889 with 5,859 requests; 13174292974160097713 with 281) use payload selectors not in our list, and are unidentified | only matters if we later want JSON API Request | none for the current build |
| 9 | `0x53edf33d` — the same selector fronts both the agent-request wrappers and the settlement oracle driver, on three different addresses. Looks like a keeper/executor entrypoint. Unidentified | — | none; observation only |
| 10 | `.env.example` is in a permission-denied directory, so actual env **values** were never read | user confirms `PRIVATE_KEY` / RPC override are set | a deploy fails at the first cheatcode |
| 11 | ~~`STORAGE.md` not reconciled against `forge inspect`~~ | **CLOSED 2026-08-29** — both layouts diffed slot-by-slot, **zero discrepancies** across all 24 `Prophet` and 28 `Population` entries, all three packing claims (slots 0, 13, 14) and both `__gap` placements. `agentRequester` is at slot 0 with no inherited variable ahead of it, confirming OZ v5 ERC-7201 namespacing. Two process findings: `forge inspect ... storage-layout` **fails** on an ordinary build (`storage layout missing from artifact`) and needs `--extra-output storageLayout`, so the earlier "tool-verified" claim in `STORAGE.md` had been asserting its own conclusion; and `Prophet` slot 15 has **31 free bytes**, previously undocumented, now flagged do-not-fill. |
| 12 | Every 2026 competitor/novelty claim, including whether a prior Somnia reactivity project shipped population mechanics | WebSearch | nothing in the submission claims to be first |
| 13 | **Whether a `think()` can land in a gap between 900 s market cycles.** Largely mitigated, not closed: at 2026-08-29T15:04Z two 900 s markets were live in lockstep plus 3600 s and 86400 s fallbacks, and nothing is pre-created (0 future markets), so gaps between cycles are possible but appear short (§2.10) | run `npm run cadence:once` against a live 900 s market once deployed; or poll the module across an hour and look for windows with no usable market open | a `think()` in a gap abstains and still pays metabolism. Not fatal per-window, but it is the "dies of nothing" mechanism if it recurs |
| 14 | ~~Whether the 0.03 STT deposit is partly refunded~~ | **CLOSED 2026-08-29 — it is NOT refunded. See §2.13.** Measured on the payer, not inferred: 5 single-request transactions each cost the payer exactly **0.0309 STT** net of gas. The §2.5 figure of ~192 STT over 400 windows therefore **stands** and is not an over-estimate. The optimistic ~6 STT reading is dead. |
| 15 | ~~`perAgentReward = 0.01 ether` is ~33x the observed live rate~~ | **ACTED ON 2026-08-29 — lowered to 0.001 ether. See §2.14.** Still 3.3x the observed 0.0003/validator, cutting the deposit 0.06 → 0.033 and the 400-window run 192 → 106 STT. What remains open is narrower: whether the observed 0.0003 is a validator tip or a gas reimbursement is still unknown — the events are unnamed and no `AgentRequester` ABI is installed. Close it with one real `think()` and watch `ThinkFailed` / abstain counts; raise via `setInference` (one `onlyOwner` tx, no upgrade) if validators decline |
| 16 | **Whether the run is fundable at all.** The only faucet limit Somnia's docs quantify is Google Cloud's *"1 STT per day"*, against 253 STT for a continuous run to submission (§2.14). Unquantified: the official, Stakely and Thirdweb faucets, and whether the team grants hackathon allocations on request | ask via Discord `#dev-chat` (tag DevRel) or `developers@somnia.foundation`; and measure what each faucet actually drips once an address exists | **this is the top project risk now, ahead of any code issue.** Mitigation is known and cheap: pausing the cadence costs nothing on chain, since metabolism is per settled window rather than per unit of time, so a short-funded run becomes bursts rather than a smaller population |

---

## 4. Code changed this segment

| File | Change |
|---|---|
| `scripts/measure-fee.ts` | `getSettlement` ABI flat → struct (the self-confirming-gate bug); named-field destructure; new `--key` flag; corrected header claim about `finalize(pool)` |
| `contracts/foundry.toml` | **`evm_version` `paris` → `shanghai`.** Paris made the deploy fail at its first live call — see §2.12 |
| `contracts/script/Deploy.s.sol` | `_writeManifest` guarded on `vm.isContext(ScriptDryRun)` so a dry run cannot poison `deployments/<chainid>.json`; imports `VmSafe` |
| `contracts/src/Population.sol` | Two changes, **neither touching a state variable declaration, so no layout change is possible.** (a) Comment at the `requestTimeout = 300` site recording that no platform minimum is enforced and that measured latency is max 5.3 s. (b) **`perAgentReward` 0.01 → 0.001 ether** — a value in `initialize`, cutting the per-inference deposit 0.06 → 0.033 and the run budget 45%. See §2.14 |

No architecture was added, by instruction. The contract-side changes are a build-config fix, a
dry-run safety guard and one initializer constant; none alters contract logic and none moves a
slot.

Verified after the changes: `forge test` **56/56** (including
`test_upgrade_preservesEveryOrganismField`), `npm run typecheck` clean, deploy dry run clean
against live Shannon, both storage layouts re-derived byte-identical.

---

## 5. What is still blocked, and on what

```
deploy  ──┬── requires PRIVATE_KEY + a funded key            [THE ONLY BLOCKER LEFT]
          ├── requires LLM_AGENT_ID                           [known: 12847293847561029384]
          ├── requires STORAGE.md reconciled and frozen        [done, zero discrepancies]
          ├── script itself verified end-to-end               [dry run clean, §2.12]
          ├── gas needed                                      [~0.15 STT, measured]
          └── writes contracts/deployments/50312.json          [manifest gate]
                        │
        ┌───────────────┴───────────────┬──────────────────┐
   npm run fee                  npm run subscribe    npm run prove
   (works now via --key         --topic0 T_A         (the honesty gate)
    once a manifest exists)     --create
```

`manifest()` in `scripts/lib/darwin.ts` throws when
`contracts/deployments/<chainId>.json` is absent, so all three ops scripts are gated on the
deploy.

**What actually blocks the deploy is now exactly one thing: a funded key.** Checked
2026-08-29 — no `.env` and no `.env.local` exist anywhere in `darwin/`, and `PRIVATE_KEY` is
unset in the shell (verified by length only; no value was ever printed). That is not caution
on my part, there is no key to use. Everything that *could* be verified without one has been:
the script executes cleanly against live Shannon state end to end, so the deploy is now a
one-command action whose only unknown is funding.

Needed in `darwin/.env`:

```
PRIVATE_KEY=0x…            # funded with ≳1 STT: ~0.15 for the deploy, the rest for cadence
SOMNIA_RPC_URL=https://dream-rpc.somnia.network
LLM_AGENT_ID=12847293847561029384
```

`SOMNIA_RPC_URL` is not optional despite looking it: `foundry.toml` defines
`somnia = "${SOMNIA_RPC_URL}"`, so `--rpc-url somnia` resolves to an empty string when it is
unset. `https://api.infra.testnet.somnia.network/` is the RPC the docs list and is a fallback
if `dream-rpc` degrades; every measurement in this checkpoint went through `dream-rpc`.

**Separate the two funding thresholds, because they are three orders of magnitude apart and
only one of them blocks tomorrow:**

| | Amount | Blocks |
|---|---|---|
| Deploy + seed + subscribe + `prove` | **≈1 STT** | the Day-2 deploy. Trivially faucet-obtainable |
| A 6-hour run, 8 organisms | 6.3 STT | a demo showing births and deaths |
| A continuous run to submission | ~253 STT | the "never stops" claim only |

So the deploy is **not** gated on solving the STT budget. Deploy, prove same-block, then let
the funding available decide how long the population runs — §2.14 on why pausing is free.

---

## 6. Next step

The whole deploy is **already dry-run verified against live Shannon** (§2.12), so step 2 is
the only unverified action left in this list, and only because it needs a funded key.

```bash
# 0. dry-run first, ALWAYS. Identical to step 2 minus --broadcast. Executes the entire
#    script against live Shannon state; _writeManifest is guarded on ScriptDryRun so it
#    cannot poison deployments/50312.json. Last run 2026-08-29: clean, ~11.9M gas.
LLM_AGENT_ID=12847293847561029384 SOMNIA_RPC_URL=https://dream-rpc.somnia.network \
  forge script script/Deploy.s.sol:Deploy --root contracts --rpc-url somnia -vv

# 1. storage layout — DONE 2026-08-29, zero discrepancies, re-verified after the
#    evm_version raise. Re-run only if src/*.sol changes. Needs --extra-output.
forge clean --root contracts
forge build --root contracts --extra-output storageLayout
forge inspect Prophet    storage-layout --root contracts
forge inspect Population storage-layout --root contracts

# 2. deploy. Needs ~0.15 STT for gas; note the :Deploy suffix. Writes deployments/50312.json.
LLM_AGENT_ID=12847293847561029384 \
  forge script script/Deploy.s.sol:Deploy --root contracts --rpc-url somnia --broadcast

# 3. collateral. On-chain faucet call, capped at 10,000 tUSDC per account (fund.ts:FAUCET_CAP).
npm run fund -- --faucet --collateral 200

# 4. seed the 8 founding organisms. MUST come before step 5 — see the ordering trap below.
LLM_AGENT_ID=12847293847561029384 \
  forge script script/Seed.s.sol:Seed --root contracts --rpc-url somnia --broadcast

# 5. inference runway. 0.033 STT/organism/window (§2.14), so 8 organisms x 400 windows = 106 STT.
#    Fund what you actually hold — this tops up, so it is safe to run repeatedly.
npm run fund -- --windows 400

# 6. subscribe to the FINALIZE event (T_A), not the redeem event
npm run subscribe -- --topic0 0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178 --create

# 7. the two honesty gates
npm run fee -- --key 0x000000000547acf67acc5e7db37ab810ce05ff02b48b94d70000000000000140
npm run prove
```

`npm run fund` with **no flags is report-only** — it prints the collateral, native balance,
per-window cost and remaining runway in windows and hours, and spends nothing. Safe to run
at any point, and the fastest way to see whether the population is about to go quiet.

**Ordering trap in step 5, verified by reading `fund.ts:88-101`.** `--windows` sizes the
top-up as `requestDeposit() * aliveCount()`, and it falls back to `1n` when `aliveCount()`
is 0. Run it before seeding and it funds **one** organism, not eight — 24 STT instead of
192, with no warning, and the population starves after ~50 windows instead of 400.

Two path traps, both hit for real: the script argument needs the **`:Deploy`** suffix, and
`forge script script/Deploy.s.sol --root contracts` run from `darwin/` fails with *"contract
source info format must be `<path>:<contractname>`"* — a path-resolution error wearing the
costume of a code error.

Note for step 6: `subscribe.ts --discover` measures topic0 from chain, but its tally cannot
distinguish finalize from redeem — and it would rank **redeem higher by frequency** (281 vs
130). Pass `--topic0` explicitly. Do not let frequency choose.

---

## 7. Corrections to the 2026-08-28 checkpoint

These statements in the previous checkpoint are now **false** and were the reason for
superseding rather than appending:

1. §3/§6.1 *"Nothing has been compiled or executed. No git repo, no `contracts/lib/`, no
   `node_modules`."* — all four are now present; 56/56 tests pass and `tsc` is clean.
2. §4.4 *"`marketKey` is only obtainable from `finalize(pool)`."* — it is
   `(uint160(pool) << 64) | nonce`, and it is `topic1` of every settlement log.
3. §6.3 *"`LLM_AGENT_ID` is unset."* — it is `12847293847561029384`.
4. §6.6 *"`settlementFeeBpsTimes1k` has never been measured."* — measured, 0 across 398
   markets. The tooling that would have measured it was also broken; both are fixed.
5. §5 *"The unverified callback selector lives behind `REACTIVITY_CALLBACK_SIG`."* — the
   selector is verified and the escape hatch is gone from `SelectionEngine`.

Stale elsewhere in the repo, not yet edited:

- `SPIKE.md` rows 1, 2, 3, 4 and 5 of the "Still unverified" table are all now closed or
  contradicted (row 5 unfavourably: Solidity subscriptions have no `ethCalls`).
- `CLAUDE.md` and `Deploy.s.sol:135` tell the reader to fetch the agent id from
  `agents.somnia.network`, the **mainnet** host. Testnet is `agents.testnet.somnia.network`.
- `SPIKE.md` and `CLAUDE.md` state the inference timeout default as 15 minutes; the chain
  says 600 s.

---

## 8. The arena-engine rework — Phase 1 (venue seam) as of 2026-08-29

Spec: `darwin/docs/superpowers/specs/2026-08-29-arena-engine-design.md`.
Plan: `darwin/docs/superpowers/plans/2026-08-29-arena-engine.md` (four phases, each ending in
its own commit, with the verification gates running *before* the commit and not after).

Phase order is a dependency order, not a preference: venue → ownership → ante/seasons → second
adapter. The second adapter exists to prove the seam is a seam.

### What Phase 1 changed

| File | Change |
|---|---|
| `contracts/src/interfaces/IArenaVenue.sol` | **New.** `collateral()`, `positionToken()`, `openOpposing(up, down, amount) → (upId, downId, quantity)`, `redeemFor(organism, positionId, quantity) → collateralOut` |
| `contracts/src/venues/DreamDEXVenue.sol` | **New.** Adapter one. Resolves the pool fresh through `IPriceSource` at open, **records** it in `poolOf[id]`, reads it back at settle |
| `contracts/src/Population.sol` | `_pair` approves the venue and calls `openOpposing` instead of `pool.mintSet`; `settleAll` passes the venue to each organism; **`__slotAlign` + `venue` appended, `__gap` `[20]` → `[18]`** |
| `contracts/src/Prophet.sol` | `settleWindow(settlement, pool, collateral, cost)` → `settleWindow(venue, collateral, cost)`; pushes the position to the venue then calls `redeemFor`; `IBinaryPool` import dropped |
| `contracts/script/Deploy.s.sol` | Deploys the venue, passes it in `_wiring`, logs it, writes `"venue"` into the manifest |
| `contracts/test/Darwin.t.sol` | Harness constructs a `DreamDEXVenue`; new 5-test section "THE VENUE SEAM" |
| `scripts/lib/darwin.ts` | `populationAbi` gains `venue()` — readable because it is repointable |

`Population` and `Prophet` no longer name a DreamDEX pool or `BinarySettlement` anywhere on the
window path. **Where positions live and how a resolved position becomes collateral is now a
parameter of the arena rather than part of its definition** — the companion to `IPriceSource`,
which already abstracted *what the window is*.

### Two design points worth not rediscovering

**Push, not pull.** `finalizeAndRedeem` burns from `msg.sender` and `IOutcomeToken6909` has no
`transferFrom`, so a venue *cannot* pull an organism's position even if it wanted to. The
organism transfers the position to the venue and the venue redeems as holder with
`to = organism`. That is why `setWiring` can repoint the venue mid-run with no re-grant from
existing organisms: there is no standing authorisation to migrate. It is also why `redeemFor`
passes `organism` as `to` — settlement may *credit* an `owed` balance instead of transferring,
and the credit is booked against `to`; routing it to the venue would strand a winner's payout
somewhere with no claim path, whereas `Prophet._sweepOwed` can rescue it from the organism.

**`poolOf` is recording, not caching.** `IPriceSource.currentWindow` reverts `StalePrice` past
180 s and nothing pushes a price before a reactive settlement, so a `redeemFor` that read the
price source would revert on exactly the path that is the project's central claim, and pass only
under a keeper-driven cadence that happened to push first. So the pool is recorded per position
id at open. That does not violate the never-cache-a-pool rule: the rule forbids caching *"the
current pool"*, and this is recorded truth about one specific position, the same shape as
`Prophet.currentMarketId`, rewritten every time a position is issued.

Known and accepted: `redeemFor` is permissionless. It burns from the venue's own balance, and
positions only sit there transiently *within a single transaction*, so there is no window for a
third party. Outcome tokens sent to the venue by anyone else could be redeemed by anyone to any
address — a donation loss, not a protocol loss, and the venue is documented as holding nothing
of value between transactions.

### The storage cost, which is the transferable lesson

One new state variable cost **two slots**. Declared where it belongs — immediately after
`uint8 phase` — Solidity packed `address venue` into **slot 26 offset 1**, because `phase`
leaves thirty-one bytes spare and an address fits in twenty. That is the exact edit `STORAGE.md`
and `CLAUDE.md` both forbid, and it would have been invisible: correct for a fresh deploy,
corrupting only once a later upgrade appended a variable expecting slot 26 to be closed.

`uint256 private __slotAlign;` declared before it is the fix — a `uint256` cannot fit in
thirty-one bytes, so it is the boundary. **A declaration alone does not create one.** There is
no padding primitive that does this more directly, so every variable added after a partially
filled slot costs two slots, one of them permanently unread.

This was caught only because the layout was re-derived **from the compiler** rather than from
the source. The same misreading had already been written into the spec and the plan for
`Prophet.entrant` in Phase 2, asserting a "fresh slot 16" where Solidity would pack into slot 15
offset 1; both are now corrected the same way, with the downstream `__gap` arithmetic recomputed
end to end (18 → 16 → 12) and every corrected passage deferring to the compiler rather than to
prose.

### Gate status — all four closed

| Gate | Status |
|---|---|
| `forge build` + `tsc --noEmit` | **passed** |
| Storage layout re-verified against the compiler | **passed.** `Population`: slots 0–26 unchanged, `phase` still alone in 26 with its spare bytes spare, `__slotAlign` 27, `venue` 28 offset 0, `__gap` `uint256[18]` at 29. `Prophet`: **byte-identical** — 24 entries, slot 14 exactly 32/32, slot 15 1/32, `__gap` `uint256[20]` at 16 |
| `forge test` | **passed, 61/61** — 56 existing + 5 new venue-seam tests |
| Commit | **`07bb747`** on `master`, local only. Not pushed |

One of the five new tests failed on its first run, and the defect was in the assertion rather
than the contracts. `vm.expectRevert(bytes4)` compares the **whole** revert data, so the bare
`PushedPriceSource.StalePrice` selector could not match `StalePrice(181, 180)`:

```
[FAIL: Error != expected error: StalePrice(181, 180) != custom error 0x2ccfc2ca]
```

`vm.expectPartialRevert(selector)` is the selector-only form and is what that line wanted. Worth
keeping in mind because the failure is misleading in the exact direction that matters: the test
exists to prove settlement survives a stale feed, and it reported as though the feed had *not*
gone stale. `test_priceSource_refusesStalePrice` encodes the full data instead, correctly — there
the age and the limit **are** the claim; in the seam test they are an artifact of harness timing.

Static review while the shell was unavailable had already covered the four things the compiler
cannot check, and found nothing: `MockSettlement.finalizeAndRedeem` burns from `msg.sender`,
which is now the **venue** — correct, because `Prophet.settleWindow` transfers the position there
first and `MockOutcomeToken.transfer` debits `msg.sender`; the credit path books `owed[to]` with
`to == organism`, exactly what `Prophet._sweepOwed` later claims as itself;
`MockBinaryPool.mintSet` pulls with `transferFrom(msg.sender, …)`, covered by the venue's
per-call `approve(pool, amount)`; and `Population.settlement` survives the refactor as both a
state variable and a `Wiring` field, so `IPopulationConfig(population).settlement()` still
resolves — had the struct dropped it alongside the pool, `_sweepOwed` would have silently pointed
at `address(0)`.

### Where the repository actually is

`git rev-parse --show-toplevel` says the root is **`darwin/` itself**, on branch `master`. The
session environment reports "Is a git repository: false" for `darwin/`, which is stale — the repo
was initialised after that snapshot. Ask git, not the banner.

**This file is outside `darwin/`, so it is not under version control.** No commit carries it and
nothing but a backup protects it. Worth knowing before relying on it as the source of truth.

Phase 1 is done. Next is Task 2 (`Prophet.entrant`, `Population.enter()`, `minEndowment` /
`cognitionEndowment`) — and its `entrant` declaration needs the same `uint256` pad for the same
reason, which the plan now says explicitly.

---

## 2026-08-30 — Task 3 (organism-paid cognition): written, green, NOT committed

### State of the tree

Three files modified, **nothing committed**. `git status --short` from `darwin/`:

```
 M contracts/src/Population.sol
 M contracts/src/Prophet.sol
 M contracts/test/Darwin.t.sol
```

Last commit is `479db96 feat(arena): give every organism an entrant, and a way out` (Task 2).
Branch `master`, no remote — **do not push**.

**`forge test --root . -vv` from `contracts/`: 81 passed, 0 failed** — measured after the
`initialize` default change, so the whole change set compiles and the suite is green. The count
grew 56 → 81 over Tasks 1–3.

### The one thing left unverified

The very last edit — `test_cognition_freshDeployIsNotBornBrainDead` in `Darwin.t.sol`, plus the
`defaultCognitionEndowment` state variable it reads and the `setUp` line that captures it — **was
added after that run and has never been compiled.** Resume with:

```bash
cd darwin/contracts && /c/Users/Handi/.foundry/bin/forge test --root . -vv
```

Expect 82 tests. If anything fails it will be that one test, and the fix is local to it.

### What the task did

The protocol stopped subsidising thought. `think()` used to spend `requestDeposit()` per living
organism out of `Population`'s own native balance with nothing refunded, so the recurring bill grew
linearly with the number of living organisms — linearly with evolutionary success, the one thing the
system exists to maximise. Now the organism pays and `Population` is a conduit that keeps nothing.

Zero new storage: a native balance is `address(this).balance`, and both contracts already had
`receive() external payable {}`. **`STORAGE.md` needs no new slot entry for this task** — but see
the stale-docs list below.

- **`Prophet.drawCognition(uint256) returns (uint256 sent)`**, `onlyPopulation`, deliberately no
  `alive` modifier (a dead organism is never in `living`, and its residue should stay drainable by
  the same path that funded it).
- **`Population.think`** draws per organism and skips on a short draw (`ThinkFailed`, then
  `continue`). **`_requestMutation`** draws the parent's deposit and skips on a short draw
  (`BreedingUnaffordable` — the parent keeps its streak and its surplus and may breed later).
- **`_spawn`** stakes `cognitionEndowment` to every newborn, guarded on the house balance so an
  underfunded house can still bear children. **`spawnGenesis` is now `payable`.**
- **`topUpCognition(uint256) payable`** — permissionless sponsorship of any living organism.
- New events: `CognitionFunded`, `CognitionUnspent`, `BreedingUnaffordable`. `Retired` gained a
  fourth field: `(prophetId, entrant, collateralReturned, cognitionReturned)`.

### Five deliberate deviations from the plan — each is a defect the plan would have shipped

1. **`drawCognition` is all-or-nothing.** The plan sent `min(amount, balance)` and let the caller
   reject the short draw — which moved the organism's entire remaining balance into `Population` and
   bought it no inference, so one entrant's residual STT quietly funded other entrants' thinking
   with no event to reconcile against. Sending nothing when the balance is short leaves the residue
   where it belongs and makes a top-up cumulative instead of a payment into a leak.
2. **`enter` is `payable` and entrant-funded** (`CognitionTooSmall`), forwarding every wei to the
   organism. The plan had the house grant `cognitionEndowment` at entry — but entry is free and
   `retire` refunds the collateral, so that is an unbounded free-inference faucet: enter, retire,
   repeat, against a documented 1-STT/day funding reality. Founders (owner-only) and children
   (earned over four correct windows) stay house-funded because neither is farmable.
3. **`retire` returns unspent cognition too.** The plan left it stranded in a dead organism, which
   turned `enter`'s native requirement into a one-way ratchet. The native send is placed **after**
   every state write: it is the only call in `retire` that hands control to arbitrary code, and a
   reentrant `retire` reaching `_removeLiving` twice would run the swap-remove twice and corrupt
   `living`. A bounced refund is non-fatal — logged as `CognitionUnspent` for the owner to `sweep`.
4. **`cognitionEndowment` defaults to `0.33 ether`, not the plan's `0` / `0.1 ether`.**
   `Deploy.s.sol` never calls `setSeason`, so a zero default ships to Shannon and `think` skips
   **every** organism for want of native: the population abstains its way to extinction while
   emitting nothing but `ThinkFailed`, which looks exactly like an inference outage. 0.33 STT is ten
   windows at the measured live price of `3 x (0.01 + 0.001) = 0.033`. Tests use
   `setSeason(10 * ONE, 1 ether)` in `setUp` because the mock deposit is 0.093 and a child that
   could afford exactly one thought would make every multi-window breeding test depend on funding
   order rather than on what it asserts.
5. **`test_cognition_unaffordableBreedingIsSkippedNotFatal` was vacuous and is not any more.** It
   asserted `pendingMutationRequestId() == 0`, which is also true of a parent that was never
   eligible — and that is exactly what was happening: `_breedThreshold()` is measured against the
   HOUSE `endowment`, and a founder that wins one window off a same-sized opponent does not clear it
   (the pair is capped at the smaller side's stake). Both breeding tests now go through a
   `_breedingCandidate()` helper that funds a real surplus, and the skip test asserts eligibility
   from the post-settlement numbers `settleAll` itself compared before asserting the skip.

### Docs made stale by this task — not yet updated

- **`CLAUDE.md`** — the `Population.sol` bullet still says it "Holds nothing between transactions
  except accumulated metabolic reimbursement" (`sweep`'s docstring was corrected in the source, the
  architecture section was not), and the funding-reality paragraph now describes a bill the
  organisms pay.
- **`STORAGE.md`** — the Task 2 changelog entry documents `Retired` with three fields; it has four.
- **`README.md`** — its cost narration predates organism-paid cognition.
- **`docs/superpowers/plans/2026-08-29-arena-engine.md`** — Task 3's step text still contains the
  five shapes listed above, and Task 4 is written against them.

### `script/Seed.s.sol` EXISTS — the earlier "it is missing" finding was wrong

`Glob`, `Read` and even `test -f` report nothing, but **`forge fmt --check` lists a diff in
`contracts/script/Seed.s.sol`**, and forge does its own filesystem walk. The file is on disk and is
simply **denied to this session by permission rules** — which is also why `Read` refused it. Task
#15 in the task list is therefore mis-framed: nothing needs writing, but nobody in this session can
see or amend it. **Someone must check by hand that the seeder now (a) calls `setSeason` before
`spawnGenesis` and (b) attaches STT to the `spawnGenesis` call, which is `payable` as of this
task.** A seeder that predates Task 3 will produce a generation 0 that cannot think.

Also note **`forge fmt --check` reports diffs in all ten Solidity files**, including ones this
session never touched. The repo has never been `forge fmt`-clean, so do not run `forge fmt` before
committing — it would bury this change set in a whole-repo reformat.

### Resume here

1. Run the suite (command above); expect 82 green.
2. Run the `npm test && npm run build` gate from `darwin/`.
3. Re-verify the storage layout per `CLAUDE.md` (`forge clean` → build with
   `--extra-output storageLayout` → `forge inspect`). Task 3 adds no declarations, so this is a
   confirmation rather than a diff — and it is worth having the compiler say so rather than a
   document.
4. Commit locally, with a message recording the five deviations. **Local only — no push.**
5. Then Task 4: escalating ante, seasons, `prizePool`, `rakeAccrued`, `prizeShareBps`, the
   profit-based `rakeBps` skim, `withdrawRake`, `endSeason`, and `SeasonParams` replacing
   `setSeason(uint256, uint256)`. Task 4 must re-verify storage for real — it adds slots — and its
   Step 6 is where `enter` becomes ante-aware (plan defect F5).

Still open beyond the plan: the live reactivity subscription and `npm run prove` (blocked on the
deploy, which is the user's call), and `web/`, which does not exist and is the largest schedule
risk.
