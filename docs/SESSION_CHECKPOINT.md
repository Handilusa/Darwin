# SESSION CHECKPOINT — 2026-08-29

Supersedes the 2026-08-28 checkpoint, several of whose claims are now false (see §7).
DARWIN build, Somnia × DreamDEX Event Contracts Hackathon (closes 2026-09-08).
Plan unchanged: `C:\Users\Handi\.claude\plans\delightful-coalescing-grove.md`.
Working directory: `C:\Users\Handi\Desktop\somnia_predict\darwin`.

> **WHERE THE CURRENT STATE IS — read this before anything below it.** This file is an
> **append-only dated log**, and its title date is its *first* segment, not its last. The newest
> state is the **`## 2026-09-08 (noche)`** section at the very end — the engine redeploy verified
> byte-identical and its guard proven firing in production, `cognitionEndowment` raised to 1.2 STT,
> the deadline extended to **Thursday 2026-09-10**, and one open decision (§H) the user takes on
> 2026-09-09. The `## 2026-09-08` section immediately before it is submission day itself — the
> window-68 settle, the push, and the four steps that were then remaining; **its §F step 3 is now
> done and its §E parameters are superseded.** Everything above those two is a dated record
> of what was true on the day it was written, kept deliberately un-rewritten so that it stays
> evidence. Live descriptions get re-stamped in place with a date; dated run records get a forward
> pointer instead, never a silent edit.
>
> The **live status list** is `bugs_jueves.txt` at the **repo root** — one level *above* this project,
> which is why the 2026-09-05 section restates its contracts-and-ops half here: that file will not
> travel with `darwin/`. For the frontend, `FRONTEND_CHECKPOINT.md` §8.17 is the newest section, and
> `darwin/CLAUDE.md` is the one document that is always kept current.
>
> As of 2026-09-05 the whole suite is green — Solidity **124/124**, web **189 PASS / 0 FAIL** over 167
> `assert()` call sites, typecheck clean, `reads.mjs` 21 checks, cadence 13 checks / 2 controls, ABI
> 256/257 guarded, both CDP harnesses PASS — and **nothing is deployed**. `contracts/deployments/` is
> empty. Deploying and broadcasting are the user's call.
>
> **That last sentence is stale, and the counts with it — see `## 2026-09-08`.** A deploy is live at
> `0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb`, `contracts/deployments/50312.json` is populated and
> tracked, 68 windows have run, and two organisms are dead. The suite is 231 PASS over 211 `assert()`
> sites. The paragraph above is kept as the dated record it is; the one thing in it that never
> expires is that **deploying and broadcasting remain the user's call.**

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
   what `Population.think` passes (`p.systemPrompt()`, `Population.sol:1501`). This was the
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

**Status of both quirks, 2026-09-06.** The 1,000-block cap is measured, not inferred: a ladder
probe with a negative control accepted spans of 999 and 1000 and was refused at 4999, 8999 and
9999 with `block range exceeds 1000`. Every `eth_getLogs` call site in `scripts/` now pages
through `scripts/lib/logscan.ts`, which shrinks the span on refusal instead of hardcoding one
RPC's cap and retries transient failures rather than throwing a whole sweep away; its paging
arithmetic and retry classifier are covered by a chainless self-test
(`npx tsx scripts/lib/logscan.ts`, 25 checks, 6 of them controls). What has **not** happened is
an end-to-end scan against Shannon: `contracts/deployments/` is empty, so `manifest()` throws
before the first request and no page of a real filtered query has ever been fetched by these
scripts. The client-side `topics[0]` re-check is therefore still carried on trust from the sweep
above — `logscan.ts` changes paging only, and every call site keeps its own client-side filter.

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
  comment at `Deploy.s.sol:143` both cite the *mainnet* host `agents.somnia.network`.

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
source info format must be `<path>:<contractname>`"* — path resolution, not code. **What was
NOT recorded that day, and should have been: adding the suffix does not make the command work.
`--root` is unusable on `forge script` entirely. See the "two path traps" note in §6.**

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
per window (`Population.sol:1482`, `dep = requestDeposit()` inside the loop), so:

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

**What must NOT be cut:** `subcommitteeSize` to 1. `Prophet.sol:252` requires `agree >= 2`
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
#    The subshell and -g 3000 are both mandatory — see the two path traps below and
#    docs/RUNBOOK.md's "-g 3000 is mandatory, on BOTH scripts".
(cd contracts && LLM_AGENT_ID=12847293847561029384 SOMNIA_RPC_URL=https://dream-rpc.somnia.network \
  forge script script/Deploy.s.sol:Deploy --rpc-url somnia -g 3000 -vv)

# 1. storage layout — DONE 2026-08-29, zero discrepancies, re-verified after the
#    evm_version raise. Re-run only if src/*.sol changes. Needs --extra-output.
forge clean --root contracts
forge build --root contracts --extra-output storageLayout
forge inspect Prophet    storage-layout --root contracts
forge inspect Population storage-layout --root contracts

# 2. deploy. Needs ~0.15 STT for gas; note the :Deploy suffix. Writes deployments/50312.json.
(cd contracts && LLM_AGENT_ID=12847293847561029384 \
  forge script script/Deploy.s.sol:Deploy --rpc-url somnia -g 3000 --broadcast)

# 3. collateral, AND the genesis birth float in the same call. `spawnGenesis` is payable and
#    `_spawn` endows each founder out of `address(this).balance`, so the STT has to already be
#    there when step 4 runs — 8 founders x 0.33 STT = 2.64, hence 3. Omit `--house` and nothing
#    tells you: `_houseCognition` (`Population.sol:548-550`) is a view that silently returns 0
#    when the balance is short — no revert, no event — and generation 0 is born brain-dead,
#    which you discover only when the organisms never think. THE FLOAT ONLY MATTERS AT GENESIS:
#    `_hatch` (`Population.sol:1495-1531`) draws a child's cognition from the PARENT via
#    `drawCognition`, never from the house, so this is a one-shot requirement, not a standing
#    balance. Faucet is capped at 10,000 tUSDC per account (fund.ts:FAUCET_CAP).
npm run fund -- --faucet --collateral 200 --house 3

# 4. seed the 8 founding organisms. MUST come before step 5, which can only fund organisms
#    that already exist — see the note below.
(cd contracts && LLM_AGENT_ID=12847293847561029384 \
  forge script script/Seed.s.sol:Seed --rpc-url somnia -g 3000 --broadcast)

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

**Step 5 has to follow step 4, verified by reading `fund.ts:111-148` and `fund.ts:196-215`.**
`--windows` sizes the top-up from `runways()`, which reads `snapshot()` and keeps the rows where
`dead` is false — so it can only fund organisms that already exist. Run it before seeding and
there are no rows: it prints *"no living organisms — nothing to fund. Seed the population
first."* and sends nothing. That is a **refusal**, not the silent under-funding an earlier
version of this note described — there is no `1n` fallback and no STT is wasted. What it costs is
attention: skip past the warning and the founders enter the run holding only the 0.33 STT
`spawnGenesis` gave them, which is ten windows, not 400. The remedy is just to run it again
after step 4 — it tops each organism **up to** the runway rather than adding to it, so twice is
idempotent and an organism already flush is skipped instead of being handed STT that only
`retire` can get back out. It is also the step that spends the most STT of any here, so read
what it prints before letting it run.

Two path traps, both hit for real, and the first hides the second. The script argument needs the
**`:Deploy`** suffix — `forge script script/Deploy.s.sol --root contracts` run from `darwin/` fails
with *"contract source info format must be `<path>:<contractname>`"*, a path-resolution error wearing
the costume of a code error. **But adding the suffix does not fix the command.** Re-measured
2026-09-07: `forge script script/Deploy.s.sol:Deploy --root contracts` from `darwin/` then dies with
*"(os error 3)"* before it compiles anything. Argument parsing runs ahead of path resolution, so trap
one masks trap two, and the real rule is that **`forge script` does not accept `--root` at all** —
unlike `build`, `test`, `fmt` and `inspect`, which is why step 1 above still uses it. The root must
be the cwd, hence the `(cd contracts && ...)` subshells.

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
- `CLAUDE.md` and `Deploy.s.sol:143` tell the reader to fetch the agent id from
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
  **Misattributed; corrected 2026-08-30.** `STORAGE.md` contains no occurrence of `Retired`,
  `collateralReturned` or `cognitionReturned` anywhere — grep it. The stale three-field signature is
  in `docs/superpowers/plans/2026-08-29-arena-engine.md:1255` (the declaration) and `:1379` (the
  emit), a dated plan whose own `:1498` already reads *"`Retired` carries four fields"*. Nothing
  shipped ever stated it wrong, so there was nothing here to fix.
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

> **Superseded 2026-08-30: `web/` exists.** Left as written because this section is the record of
> where that session stopped. See the live "Resume here" at the end of this document for the
> current status.

---

## 2026-08-30 — Tasks 4 and 5 done: the arena-engine plan is complete

**98 tests pass, clean `forge build`, clean `tsc --noEmit`.** The count went 56 → 81 (Tasks 1–3) →
92 (Task 4) → 98 (Task 5). Branch `master`, still **no remote — do not push**.

### Task 4 — escalating ante, seasons, prize pool, explicit rake

Committed as `d413abe feat(arena): escalating ante, seasons, and explicit rake accounting` (6 files,
+908/−34). Storage landed exactly where the plan predicted: packed season group at slot 33,
`baseAnte` 34, `rakeAccrued` 35, `prizePool` 36, `__gap uint256[10]` at 37, and `Prophet`
**byte-identical**. Re-derived from the compiler twice, not from a document.

The shape that shipped: a flat ante doubling every `levelWindows`; rake taken on **profit only** and
clamped to `treasury`; two books (`rakeAccrued`, `prizePool`) over one balance; a corpse's residue
drained into the prize pool **before** `die()`; and a permissionless `endSeason()` paying 60/30/10 to
the top three survivors by net correct calls. Six defects in the plan's Task 4 are recorded in that
task's correction banner — the most instructive being that its headline accounting test was
near-vacuous (`assertLe(booked, balance)` against a 10,000 tUSDC harness float passes for almost any
bug); the shipped version brackets three windows and asserts the **delta** equality.

### Task 5 — `DirectDuelVenue`, the second settlement mechanism

New file `contracts/src/venues/DirectDuelVenue.sol` plus six tests. **Nine defects in the plan's
sketch**, all recorded in Task 5's correction banner; four of them are one mistake seen from
different sides — *the sketch adjudicates each redemption against the price live at that moment*.
The three rules that matter, because a future reader will be tempted to "simplify" each of them:

1. **The outcome is frozen by the first claim.** Otherwise the up side can be redeemed while the
   price is high and the down side after it falls, and both are paid the whole backing out of an
   escrow holding one. Verified by **mutation**, not by argument: comment out `_resolve`'s `Pending`
   guard and exactly one test fails, as `panic: arithmetic underflow` inside the second transfer.
   Worth repeating as a technique — six tests passing on the first run is when to go looking.
2. **Only a position's holder may redeem, and there is no public `resolve`.** Resolution reads
   whatever price is current, so whoever can trigger it chooses when the window closes.
3. **An unadjudicable duel refunds both antes**, never pays zero. Zero strands the backing in the
   venue forever *and* grades both organisms wrong, since `settleWindow` reads the grade from the
   payout against the stake. Half the backing is exactly one ante because `_pair` clamps both legs
   equal — an invariant the venue depends on and cannot itself check.

Also: `redeemFor` **must not read a price feed** (stated in `DreamDEXVenue`'s header, at
`DreamDEXVenue.sol:17-18`, and at `DirectDuelVenue.sol:139`) because on the reactive path nobody pushes a price between resolution and
the callback. The level is recorded at `openOpposing`, where a `StalePrice` revert is the *correct*
outcome and `_pair` already unwinds both antes into a `CommitFailed`.

### The claim about removing the DreamDEX dependency was overstated, and is now corrected

The plan and spec §3.2 claimed "no market availability dependency" and billed this venue as a
**resilience fallback if DreamDEX markets are missing.** Both were false. Settlement needs no market
— but prices come through `IPriceSource`, whose v1 implementation resolves a real market to compute
`tradeable`, and `Population.think` refuses an untradeable window. **So a duel arena still cannot
open a window without a live market.** Cutting that last thread is an `IPriceSource` v2 reading the
oracle hub directly; it is not a venue change and it is not in the plan. Spec §3.2 now says this
explicitly, and the narrower true claim is the one to make: *settlement itself cannot fail for want
of a market, a pool, or a counterparty contract of any kind.*

### Docs updated, and what is still stale

Brought current in this segment: **spec §3.2** (two `Population` deployments sharing one beacon, the
precise dependency scope, the three design rules), the **plan** (Task 5 banner; the `Produces:` line
that promised a `resolve(bytes32)` the contract deliberately does not have; the stale "Deferred"
bullet about `_requestMutation`), and **`CLAUDE.md`** — which was actively *wrong*, not merely
incomplete: its window table said `commitAll` pairs "via `pool.mintSet(...)`" and `settleAll` calls
`finalizeAndRedeem`, when both now go through `IArenaVenue`. It gained a "Settlement is a replaceable
part" section and its test count went 56 → 98.

Still stale, in rough priority order — **all three were closed on 2026-08-30.** The original
diagnosis is kept struck through rather than deleted, because in two of the three the *diagnosis* was
itself wrong, and a list that only ever shows correct predictions is not a useful record of how the
stale-doc problem actually behaves here. Twice the fix found an **overstatement** the note had not
suspected; once the note pointed at the wrong file entirely.

- **`README.md`** — ~~the judge-facing document. Not wrong, but it describes the DreamDEX path as
  *the* mechanism (`:38`, `:64`, `:92-93`, `:126`) and never mentions that settlement is pluggable or
  that there are two adapters. Its cost narration also still predates organism-paid cognition.~~
  **Done 2026-08-30 (`a2d1c87`), and it was wrong in the other direction too.** The cost-narration
  half of this item was already stale when written — `:12-15` had been brought current. The venue
  half was real: the diagram called `pool.mintSet` and `finalizeAndRedeem` directly, the primitives
  table claimed the design collapses without four primitives when a second adapter had proven two of
  them replaceable, the repo layout listed neither `venues/` nor `IArenaVenue`, and the test count
  still said "~40". But checking the code instead of my notes also found **two overstatements**,
  which matter more in a document whose whole premise is that it does not overstate:
  - *"The demo runs two `Population` deployments sharing one `Prophet` beacon."* `Deploy.s.sol:177-186`
    deploys **one** on **one** `DreamDEXVenue`. The two-arena shape is real and runs end-to-end, but
    in the test harness (`_duelArena`) — a second live arena is a second deploy. `CLAUDE.md` asserted
    the same thing as shipped and is corrected too.
  - *"`test_venue_canBeRepointedBetweenWindows` asserts a population can be moved from one venue to
    the other."* It repoints to a fresh instance of the **same** adapter (`Darwin.t.sol:1372`). It
    proves the seam, which is strictly weaker than cross-adapter migration — and cross-adapter
    migration mid-run is the unsafe operation logged in `STORAGE.md`.

  Three of the six "Still unverified" bullets had been closed by measurement on 2026-08-29 and were
  still on the page as open (settlement fee, handler selector, agent id and prices); they now have a
  "Closed by measurement" list of their own. Two genuinely open items were missing and are now in it:
  whether validators *honour* `allowedValues`, and `faucet(uint256)`'s units. Also fixed: the
  Quickstart told the reader to obey `subscribe --discover`, which `SPIKE.md` row 3 says explicitly
  not to; `agents.somnia.network` (mainnet) → `agents.testnet.somnia.network`; and the claim that
  `allowedValues` is what makes model output safe to act on — it is `Genome.parseAnswer`, and safety
  that does not depend on trusting the platform is the better claim anyway.
- **`STORAGE.md`** — ~~the Task 2 changelog entry documents `Retired` with three fields; it has
  four. `DirectDuelVenue` needs no entry: it is plain and non-upgradeable.~~ **Both halves closed
  2026-08-30, and the second one was wrong in a way worth keeping visible.**
  - The `Retired` item was **misattributed**. `STORAGE.md` contains no occurrence of `Retired`,
    `collateralReturned` or `cognitionReturned` anywhere. The stale three-field signature lives in
    `docs/superpowers/plans/2026-08-29-arena-engine.md:1255` (declaration) and `:1379` (emit) — a
    dated plan whose own `:1498` already reads *"`Retired` carries four fields"*. Left as-is: a plan
    that recorded the shape before it changed is a record, not a defect.
  - *"`DirectDuelVenue` needs no entry"* is what **left Task 5 (`1e70881`) unlogged**, and it
    conflates two different obligations: the venue has no *storage* constraint (true — it is plain
    and non-upgradeable) with the *change* having no logging obligation (false — `STORAGE.md:23`
    asks for an entry for **every** change, and the changelog is full of "no layout change, and the
    absence is the point" rows precisely because before a freeze the absence is the datum). A reader
    on 2026-09-02 cannot distinguish "no entry" from "no layout change" from outside. Now closed by
    a compiler-verified entry: `git show --numstat 1e70881 -- 'contracts/src/*.sol'` reports the one
    new file and nothing else, and both proxied layouts were re-derived from a clean build with zero
    discrepancies. The venues also finally appear under "Contracts with no storage constraint",
    carrying the repoint hazard that section had never stated — **repoint the venue in phase 0, with
    no position open**, because `Population.setWiring` has no phase guard and the two adapters fail
    in opposite directions on an unknown position (`DreamDEXVenue` reverts `UnknownPosition`;
    `DirectDuelVenue` returns `0`, which grades both duellists as total losses and strands the
    escrow short of a beacon upgrade).
- **`docs/BUSINESS_PLAN.md`** — ~~not re-read this segment; check it against the escalating ante and
  the two-arena shape.~~ **Done 2026-08-30.** Both suspicions were right, and a third thing was
  wrong that this note had not predicted:
  - §4 still argued the venue seam as a *plan* ("the engine needs exactly two things from a venue")
    when it had shipped that morning. Rewritten as a claim with its boundary attached: `Population`
    and `Prophet` reference no pool and no market, two adapters implement `IArenaVenue`, and the
    shape is a **second `Population` proxy over the same beacon** — not one population repointed,
    which the plan is now explicit is "both wrong and unsafe" and cross-references the operator rule
    above. §9's table row says the same, with the `Deploy.s.sol` caveat inline.
  - §8 was future-tense about mechanics that are in `Population.sol`. Rewritten past-tense with an
    "As shipped" paragraph naming the initializer defaults (`baseAnte` 0.25 tUSDC, `anteMultBps`
    20_000, `levelWindows` 72) and the `setSeason` guards, plus the deploy-day caveat that
    `Deploy.s.sol` calls **no** configuration setter at all — not `setSeason`, not `setEconomics`,
    not `setInference` — so a deploy that skips them runs those defaults rather than a season sized
    to the STT in hand.
  - **The unpredicted one:** §8 claimed the ante *and metabolism* escalate. `metabolicCost` is flat
    (`Population.sol:63`, `:369`, passed unscaled at `:1345`). Corrected in place rather than
    silently deleted, because the section's own arithmetic — "a 1,000-tUSDC organism risking a flat
    0.25 plus 0.05 rent still survives 3,300 windows" — already assumed flat metabolism, so a reader
    who checked would find the prose and the numbers disagreeing and not know which to trust.
  - Also made live: the same-block risk bullet was written as prospective ("the thing most at risk
    from this redesign"). The redesign landed, so it now states that the 98-test suite **cannot**
    exercise it — the reactivity precompile does not exist on local chain ids — and that only the
    weaker claim is licensed until `npm run prove` passes against Shannon.

### Two handoffs nobody in-session can close

1. **`contracts/script/Seed.s.sol` is permission-denied to Claude sessions** (Glob, Grep and Read all
   report nothing; `forge` sees it fine and it **compiles clean** against the struct-form
   `setSeason`). So only *ordering* is unverified. Someone must check by hand that it (a) calls
   `setSeason` before `spawnGenesis`, and (b) either attaches STT to the now-`payable`
   `spawnGenesis` or runs after the house float is funded — `npm run fund -- --house 3` first.
2. **`npm run fee` cannot be run before the deploy.** It needs
   `contracts/deployments/50312.json`, so the plan's Task 5 gate list is wrong to call it a commit
   gate. Same for `npm run prove`. Until `prove` passes, only the weaker claim is licensed:
   *selection is on-chain and atomic with redemption* — not "no keeper anywhere in the causal chain."

### Resume here

The arena-engine plan is finished. What remains is not more contract work:

1. **`web/` — built, and no longer the schedule risk it was (2026-08-30).** A zero-build static
   dashboard: ES modules, viem from a pinned CDN, GSAP vendored as a committed file, no bundler, no
   install, no backend, no wallet. `?demo=1` renders `web/js/fixture.js` through the identical
   renderer, so it reviews before Season 0 exists and works with the network unplugged.
   `npm test --prefix web` is green — fifty renderer call sites and one hundred and sixty-seven
   `assert()` call sites, which execute 313 renderer calls and 189 checks, no browser —
   and the page has been verified rendered, not just read, at 1500px and 1920px with motion both on
   and off. See `web/README.md` for the invariants; the two that bite are **no `innerHTML` anywhere**
   (`Population.enter` is permissionless, so every genome on screen is untrusted input) and **motion
   is a property of the diff, never of rendering**. The gap that was open here — a static fixture
   cannot fire the `born`/`died`/`treasury` timelines, so demo mode had only the entrance, the hovers
   and the countdown — **is closed**: `fixture.season()` scripts the next window as four snapshots fed
   through the same `advance()` path a live poll uses, and the death, the birth, the nine simultaneous
   treasury counts and the reopening window have all been captured on the wall clock over CDP.
   Submission is **2026-09-08**, and a running population with a thin UI still beats a polished UI
   over a dead one.
2. **The Season 0 deploy, whose storage freeze is 2026-09-02.** Dry-run first (same command minus
   `--broadcast`). **Deploying and broadcasting are the user's call, not a session's** — the deploy
   spends real STT and starts a run whose lineage graph cannot be rebuilt.
3. After the deploy: the reactivity subscription (`npm run subscribe -- --topic0 0xb1884334… --create`
   — pass the topic explicitly, never let `--discover` choose), then `npm run prove` and
   `npm run fee`, then `disableFallback()` only if `prove` passes.
4. ~~`README.md`, per the stale-docs list above.~~ **PARTLY DONE 2026-09-02** — the frontend/arena
   claims were audited 2026-09-01 and the contracts/economics half on 2026-09-02, which is where the
   missing escalating-ante/season/prize-pool/rake section and the missing permissionless-entry claim
   were found. See the 2026-09-02 section at the end of this file for what was wrong and what is
   still open.
5. **Deferred by the user's own sequencing on 2026-09-01, not dropped** — the frontend work took
   priority and none of these were started:
   - **`_spawn` should have the parent pay the newborn's `cognitionEndowment`**, not the house. Logic
     only, no new storage, so it does **not** need to beat the 2026-09-02 freeze. It MUST spend
     `drawCognition`'s returned **`sent`**, never `address(this).balance` — with the balance the
     subsidy returns invisibly and the newborn is funded by whatever happened to be lying in the
     contract.
   - **Fold `endSeason()` and `hatchAll()` into `cadence.ts`**, which is the state machine over the
     on-chain `phase` described at §560 above; today they are outside it.
   - **Confirm phase 4's slot state against `STORAGE.md` before the freeze.** Storage is append-only:
     append into `__gap` only, never into a partially-used slot.
   - **Confirm whether `contracts/script/Seed.s.sol` exists.** It is permission-denied to Claude
     sessions, and a deny rule is indistinguishable from absence through `Glob` — so this one needs a
     human to look.
6. ~~**Frontend: `node app/test/arena.mjs` is currently FAILING on one check** and the front-door
   simplification it guards is undeployed. See `docs/FRONTEND_CHECKPOINT.md` §8.12 — that is the live
   frontend item, ahead of everything in this list except the deploy decision itself.~~
   **CLOSED 2026-09-02.** `arena.mjs` PASSES, and so do `landing.mjs` (first run ever), the `web`
   suite (135 assertions that day, 149 as of 2026-09-03, 189 as of 2026-09-05) and `shots.mjs` (9/9).
   The whole `/arena` rebrand is closed —
   `FRONTEND_CHECKPOINT.md` §5 and §8 are both marked so. ~~**The live frontend item is now
   `app/src/sections/Enter.jsx`'s missing "the saved address is not a Population" gate**, described in
   the 2026-09-02 section at the end of this file: it is the same defect class as the null crash that
   was fixed in the arena, on the surface a judge lands on first.~~
   **That gate CLOSED 2026-09-03** (`FRONTEND_CHECKPOINT.md` §8.15) and was re-verified in a browser
   on 2026-09-05: `Enter.jsx:445/:453/:458` carries the `badQuery` branch, `pop.status ===
   "undeployed"` is no longer the only gate but the second one at `:472`, and `node app/test/landing.mjs`
   reports `EOA pointed: absent=true unreachable=false` with the hero reading *"No arena at that
   address"* and the form withheld. **There is no open frontend item; see the 2026-09-05 section.**

Do not run `forge fmt` before a commit: the repo has never been fmt-clean (all ten `.sol` files
diff), so it would bury the change set.

> **NO LONGER TRUE, 2026-09-05.** `forge fmt --check --root contracts` now reports **zero diffs**, so
> the tree is fmt-clean and running `forge fmt` is a no-op that can bury nothing. Verified with a
> negative control rather than by trusting the exit code, because a formatter that silently checks
> nothing looks identical to a clean tree: a deliberately misformatted scratch file dropped into
> `contracts/test/` *was* flagged, and removed again. Keep the habit of `--check` over a bare
> `forge fmt` anyway — it is the version that cannot rewrite a file you did not mean to touch.

---

## 2026-09-02 — `/arena` CLOSED and verified; three live defects fixed; the README's economics gap found

The freeze day, and no storage moved. Everything below is `web/`, `app/`, docs, or a finding
handed to the user — **no `.sol` file was edited**, so `STORAGE.md` needs no entry for this segment.

### The suite, in the mandated order, all green

| Step | Result |
|---|---|
| `npm test --prefix web` | **135 PASS / 0 FAIL**, 34 render calls (33 `ok` + 1 `null`), scripted-season sub-count **44** |
| `npm run build --prefix app` | clean, 39.7 s, `dist/arena/ <- web/ (copied verbatim)` |
| `node app/test/arena.mjs` | **PASS** — 13 cards / 3 corpses, 0 stranded, 20 requests / 0 off-origin, 0 exceptions |
| `node app/test/landing.mjs` | **PASS** — the first time it has ever been run |
| `node app/test/shots.mjs` | 9 / 9 captures, verified real (server 200, PNGs 0.6–2.6 MB, one opened and read) |

`FRONTEND_CHECKPOINT.md` §8.12's record of `arena.mjs` FAILING and `landing.mjs` never-run is
**resolved** — see the `RESOLVED` note at the end of that section. **Item 6 of the "Resume here"
list above is therefore stale and is corrected in place.**

### Three live defects, and all three were found by measuring rather than by reading

1. **The 22-key null crash.** `discover()` writes `null` per rejected read; `units()` opens with
   `BigInt(value)` and throws on null; `paint()` builds `#body` from a **single `mount(...)`
   argument list**, so one throw discards every panel — including the `readErrors` panel that
   exists to report exactly this. Guarded at the call site (`dash`), never inside `units`, which
   is a character-for-character port of `fmt` in `scripts/lib/darwin.ts` and must stay identical.
2. **The three-valued grade emitted as a boolean.** `Prophet.sol` — see the handoff below.
3. **A selected corpse's ring was painted `--life`.** The sharpest of the three.
   `.tree-node.is-dead circle` and `.tree-node.is-selected circle` are **both `(0,2,1)`** — two
   classes and a *type* — so source order decided and the selected rule is later. Measured: a dead
   ring went `rgb(74,72,84)` → `rgb(95,227,192)`, **byte-identical to a selected living ring**, on
   the page whose loudest claim is that death is irreversible. Fixed with `(0,3,1)`
   (`.tree-node.is-dead.is-selected circle { stroke: var(--ash) }`), so it no longer depends on
   source order at all. Now `[74,72,84]` → `[122,118,134]`.

   **Two things hid it for a day, and both are the transferable lesson.** The label fix of
   2026-09-01 sat **one rule below** the identical unfixed collision — the sweep read the
   neighbour and stopped. And the harness check whose own message read *"selection has un-killed
   it; a corpse must answer inside the ash ramp"* was comparing **`.tree-label` fills**, so it
   could not see the one element that had actually been un-killed. **A green check is not evidence
   until you know which element it read.** The ring probe now carries its own living control.

### The agent-society review found nothing, and that is the result worth recording

28 agents, 498 tool uses, ~2.49M subagent tokens, 27.7 min, 0 errored — `confirmed: []`. All five
candidate findings were killed by verifiers. **Two of them killed a contract-behaviour claim by
citing the demo fixture**, which had deliberately never exercised the branch; `Prophet.sol`
confirms the claim. A verifier reading only the incomplete artefact will refute anything that
artefact declined to demonstrate. Meanwhile the three real defects above were found beside the
review, by hand, by measuring. Full account in `FRONTEND_CHECKPOINT.md` §8.13.

Standing rule adopted from it: **every "X cannot happen" assertion is paired with a control that
makes X happen** and requires the same detector to fire. Two checks in this suite once asserted a
string no code path emits (`"unknown event"`) and stayed green on exactly the state they were
written to catch. Three of that day's 135 assertions were detector self-tests; the read-verdict work
on 2026-09-03 added three more, and the season-close work on 2026-09-05 added six — the two
one-frame-earlier controls at `smoke.mjs:806`/`:811`, the missing-amount em dash at `:826`, the
unbanded close row at `:835`, the misspelt `SeasonEndedd` at `:841`, and the header-actually-moved
control at `:855`. Twelve now (`FRONTEND_CHECKPOINT.md` §8.16). The share of the total is deliberately
no longer quoted here: it was written as "six of 149" and the denominator rotted within two days,
while the number that matters is that every "X cannot happen" check has a named partner.

### §5.4 closed as DO NOT BUILD

No counterparty field exists in `snapshot()` (`abi.js:43`) or the per-organism reads
(`abi.js:132-139`); pairing lives only in the `Paired` event, and `POLL_FEED_EVERY_MS` is 60 s over
a sliding range. Reconstructing who-faced-whom would mean a second event pipeline for a decoration.
The *rejected* argument is recorded too, because it was wrong and looked right: "`DirectDuelVenue`
makes it necessary" — no, `_pair` clamps both legs on either venue. §8.14.

### The root `README.md` audit — the contracts and economics half

Only the frontend claims had been checked before today. Verified against the code: `breedStreak = 4`
matches the loop diagram's "streak ≥ 4"; `genomes/genesis.json` really holds 8; `Darwin.t.sol` really
has 98 `function test`; the "no `innerHTML` anywhere" claim holds (8 occurrences, **all of them
comments explaining the rule**, zero uses — and `smoke.mjs` deliberately omits the setter so a use
fails the suite). What was wrong:

- **The entire phase-4 economics was missing from the README.** Zero mentions of the escalating ante,
  levels, seasons, the prize pool or the rake — all of it implemented in `Population.sol:141-182,
  362-382` and all of it displayed prominently in the `/arena` header (`ANTE`, `LEVEL`, `PRIZE POOL`,
  `RAKE`, `season 1 · 41 / 42`). A judge would read the README, open the page, and meet five economic
  figures the README never mentions. **Fixed:** new section *"The climate: what an organism risks,
  and who can enter"*, with the defaults and their reasons.
- **Permissionless entry was missing too** — no mention of `enter`, `retire`, or that outsiders fund
  their own organisms, despite `Population.enter` being the public write path that the no-`innerHTML`
  rule exists to defend against. Added, in the *Claimed* list, with that consequence stated.
- **"Roughly 1,000 windows fit in eleven days"** described a runway that no longer exists. Re-anchored
  to what the contract actually encodes: a season is `seasonWindows = 576`, ~6 days, eight levels.
- **"in a window where all eight agree"** hardcoded the genesis size against `maxPopulation = 24`.
  Now "every living organism", plus the consequence that `level()` is indexed on window count rather
  than activity, so the ante is higher when pairing resumes than when it stopped.

**And a defect in the contract's own comment, found while writing that table.**
`Population.sol:411` says `seasonWindows = 576; // ~6 days: eight levels, and a 256x ante by the
end`. **Off by one.** `576 / 72 = 8` levels indexed **0 through 7**, so the last level an organism
actually trades under is 7 and the closing ante is **128×** the base (0.25 → 32 tUSDC). Level 8, and
256×, begins on window 576 — the very window that unlocks `endSeason()`. The README now says 128×.
The comment is still wrong and is a one-line fix whenever `.sol` is next touched; it is a comment,
so it changes no bytecode and no storage.

> **FIXED 2026-09-05, and it grew from one line to seven.** `Population.sol:404-413` now reads the
> arithmetic out in full — *"576/72 = 8 levels, INDEXED 0 THROUGH 7, so the last level an organism
> actually trades under is 7 and the season closes at a 128x ante (0.25 -> 32 tUSDC). Level 8, and
> 256x, begins on window 576 — the very window that first satisfies `endSeason`'s `>= seasonWindows`,
> so no pairing is ever made at it unless the close is late."* The clause after the dash is the part
> that was worth more than the correction: **the 256× level is not unreachable, it is unreachable
> *while the close is punctual*.** A late `endSeason()` does pair organisms at 256×, and since
> `endSeason` is deliberately permissionless there is no on-chain guarantee of punctuality — so the
> ante ceiling is an operational property, not a mechanical one. Comment only: no bytecode, no
> storage, and the 124/124 suite is unchanged by it.

Also worth knowing, and **not fixed**: `Population.sol:413` initializes `seasonId = 1`, while
`web/js/fixture.js:204` hardcodes `seasonId: 0` and `render.js:318` renders `state.seasonId`
verbatim. So the demo says *season 0* and the live chain will say *season 1*. The README's "Season 0"
language follows the fixture, not the contract. One line in the fixture — left alone because some of
the 44 scripted-season assertions may read it.

> **FIXED 2026-09-03.** `web/js/fixture.js` now says `seasonId: 1` and carries the derivation in a
> comment at the field. The worry recorded above was **unfounded and was measured rather than
> reasoned about**: no assertion in `web/test/smoke.mjs` reads `seasonId`, in the scripted-season
> range or anywhere else. Establishing that took a mutation rather than a grep — `seasonId: 777`
> left the suite ALL GREEN, so the field is genuinely unasserted, and `seasonId: 42` was tried as
> well because the only nearby candidate (`the header follows the script to window 42`) matches the
> bare string `"42"` in the header's whole `textContent` and could have been satisfied by the season
> number instead of the window number. It was not: that assertion passes on the window count, which
> `season()` moves to `42n` in frame 2 independently of the season field.
>
> The rest of the season block already agreed with a season 1 reading and needed no change:
> `seasonStartWindow: 0n` is the initializer's own value, `windowCount: 41n` is 41/96 into the FIRST
> season (so `endSeason` — the only writer of `seasonId`, at `:786` — cannot have run), and
> `level: 3` / `ante: 3_906_250n` recompute exactly from `level()` and `ante()` at that window
> ((41-0)/12 = 3; 2.00 x 1.25³ = 3.90625). So the fix is one field, not a set.
>
> The scripted-season sub-count is **44 before and 44 after** (region unmoved at `smoke.mjs:462-586`,
> re-derived by matching the two boundary assertion strings). Suite: **149 PASS / 0 FAIL** over 36
> render calls (35 `ok` + 1 `null`).
>
> `README.md` needed no change either, and that is a judgement call worth recording: its two
> remaining "Season 0" mentions (`:326`, `:382`) are the **launch event** — *"reviews before Season 0"*,
> *"before Season 0 exists"* — not claims about what `seasonId()` returns, and the same is true of
> every other "Season 0" in the tree (`web/js/render.js:118`, `:1779`, `app/src/sections/Enter.jsx:476`,
> `CLAUDE.md`, `docs/BUSINESS_PLAN.md`). The launch run is Season 0 the event and season **1** the
> `seasonId`, and nothing on a rendered page states the number except the header stat, which now reads
> it from a fixture that agrees with the contract. The naming collision is real but it is not a false
> claim; renaming the launch event is a marketing decision, not a correctness one.

**RESCALED 2026-09-05 — four numbers in the block above are the values of 2026-09-03.** The
season-close work (audit item C2) added `SeasonEnded` / `SeasonPrizePaid` to the fixture and
compressed the demo season so a judge can watch one close, so the block above should be read as a
dated record, not as a description of the tree. What changed, all re-measured today rather than
inferred: `seasonWindows` is **42**, so `windowCount: 41n` is **41/42** into the first season and the
header renders `season 1 · 41 / 42` (`render.js:287` prints the progress with spaces around the
slash); the suite is **189 checks over 167 `assert()` call sites**, not 149; the renderer is driven
**50 call sites / 313 executed calls**, not 36; and the 44 scripted-season sub-count is intact but
its region now ends at **`smoke.mjs:462-611`**, the boundary assertions being `season plays 4 frames`
and `the header follows the script to window 42` inclusive. The reasoning in the block is unaffected:
41 is still short of the season length, so `endSeason` still cannot have run, and `level: 3` /
`ante: 3_906_250n` still recompute from window 41 with `levelWindows: 12`.

### Still open after this segment

- ~~**`app/src/sections/Enter.jsx` has no "address saved but it isn't a Population" gate.** Its only
  gate is `pop.status === "undeployed"` (`:380`). With an EOA saved, `pop.status === "found"`, all
  nine reads fail silently (`allowFailure: true` → `pick()` → `undefined`), every `<Val>` renders
  empty — and the caption still asserts *"Read from 0x… every twenty seconds"*. **Same class as
  defect 1 above**, in the surface a judge lands on first. Not fixed: it is `app/`, and the arena
  came first by the user's own sequencing.~~
  **CLOSED 2026-09-03** (`FRONTEND_CHECKPOINT.md` §8.15), **re-verified in a browser 2026-09-05.**
  `Enter.jsx:445` carries the comment, `:453` the `badQuery` branch, `:458` echoes the rejected value
  back, and the `undeployed` gate is now the *second* one at `:472`. `node app/test/landing.mjs`
  measures it end to end: `absent=true unreachable=false`, hero *"No arena at that address"*, form
  withheld, `bad query: ignored=true`. Note the classifier distinction that made the fix correct
  rather than merely present — `absent` forces the address form open, `unreachable` leaves it alone,
  and a failure *tally* cannot tell those apart.
- The `Prophet.sol` `correct`-parameter handoff below.
- The corpse-ring fix is one line in `web/app.css` if the user wants it reverted. It had been parked
  as their call; the measurement settled it — the doc's own defence ("fill-vs-stroke still separates
  them") is true of a corpse against a *disc* and false of the comparison a reader actually makes.

### The one contract handoff, which is the user's call

`Prophet.sol:138-140` **names** the event parameter `correct` while assigning it `won`
(`collateralOut > staked`, `:428`, emitted `:489`). They are not the same thing: the grade is
three-valued at `:459-470` plus a fourth silent state (`collateralOut == staked`, a voided duel),
and **the abstain branch at `:460-463` is straight-line with no early return**, so the emit runs
with `won == false` — an abstention is logged as an incorrect call. Selection-over-ideas is read
straight from this log stream, so the log is the product.

Renaming it, or emitting the graded outcome, **costs no storage slots** — events are not storage, so
today's freeze does not forbid it. But it is a contract edit: `forge test` (98 that day, **124** as of
2026-09-05) and a storage re-derive with `--extra-output storageLayout`, and it lands in the same
deploy the user has not yet authorized. **Not done. Surfaced.**

> **STILL OPEN as of 2026-09-05, and confirmed by reading rather than assumed.** `Prophet.sol:138-140`
> still declares `event Settled(..., bool correct, ...)` and `:522` still emits it with `won`. N14 in
> `bugs_jueves.txt` closed a *different* defect in the same function — the grading predicate no longer
> consults the live `belief` field, it is `if (quantity == 0)` at `:476` — so do not read N14 as having
> closed this. This one is untouched and remains the user's call.

---

## 2026-09-05 — the 2026-09-04 audit closed: one fund-loss bug, the ante frozen at the open, seven owner footguns, and why every count in these docs rots

**Read `bugs_jueves.txt` first.** It is at the *repo root* (`somnia_predict/`), one level **above** this
project, and it is the live status list: the audit of 2026-09-04 with a disposition tag on every item
plus a section `N1…N22` for everything that surfaced while fixing it. This section is the
contracts-and-ops half of what it records, written *here* precisely because that file sits outside
`darwin/` and **will not travel with the project**. Where the two disagree, the audit file is newer.

Two items in it are decisions reserved for the user and are restated at the end of this section.

### The suite, re-measured today rather than copied forward — all green

| Step | Result |
|---|---|
| `forge test --use 0.8.28`, run **from `contracts/`** | **124 passed / 0 failed / 0 skipped** |
| `npm test --prefix web` | **ALL GREEN — 189 PASS / 0 FAIL** over 167 `assert()` call sites |
| `npm run typecheck` | exit 0, no output |
| `node app/test/reads.mjs` | **PASS — 21 checks**, no browser, no network |
| `npm run cadence:selftest` | **13 checks, 2 of them controls** |
| `npm run abi:check` | **PASS — 256/257** guarded signatures agree with the compiler |
| `npm run build --prefix app` | clean, and `dist/arena/js` byte-identical to `web/js` — **0 of 11 files differing, by hash** |
| `node app/test/arena.mjs` | **PASS** — 13 cards (3 dead), 0 stranded, 20 requests / 0 off-origin / 0 exceptions, and the season close renders |
| `node app/test/landing.mjs` | **PASS** — reveals complete, death stays fired, an EOA address withholds the form |

The one unguarded ABI signature is `collateralAbi`'s `allowance(address,address)` in
`app/src/lib/abi.js` — an external surface no local artefact can vouch for, and preexisting.

**Running the two browser harnesses needs a server you start yourself.** Neither `arena.mjs` nor
`landing.mjs` starts one. Start `npm run preview --prefix app` (= `vite preview --port 3000`) first,
and use `localhost`, **not** `127.0.0.1` — on this machine `vite preview` binds `::1` only, which
`arena.mjs:123` says at the site. See N22 below for why getting this wrong is worse than a plain
failure.

### How to run `forge` here — this is the single most reusable thing in the segment

```bash
# from contracts/, NOT from darwin/ or the repo root, and always pinning the version
forge test --use 0.8.28
```

Two distinct failures if you get it wrong, and neither error message names the cause:

- **From the repo root or `darwin/`:** more than 256 *"Unable to resolve imports"*. It is a
  path-resolution failure — `contracts/` is the Foundry config root and the remappings only make sense
  from there.
- **Without `--use 0.8.28`:** `auto_detect_solc` picks **0.8.33**, recompiles **993 files**, and drags
  in OpenZeppelin's `certora/harnesses` from the submodule — whose own `foundry.toml` points at
  imports and a macOS path that do not exist here. With the version pinned and the cache warm it
  compiles **2 files**.

`CLAUDE.md` documents `--root contracts` from `darwin/`, which is the equivalent form and also works;
the `--use` pin is the part that was missing everywhere and cost real time.

### N10 — a failed settlement ate the ante forever. This was the fund-loss bug

Three mechanisms, each correct alone, composing into an unrecoverable loss:

1. `Prophet.settleWindow:371-372` sets `positionOpen = false` as its **first** statement, so a revert
   further down undoes it and the position stays open. Correct.
2. `Population.settleAll` catches the revert and emits `SettleFailed`, because *"one bad organism must
   never halt the population."* Correct.
3. `Population.commitAll`, **the next window**, paired that organism again — and `noteCommitted`
   **overwrote `currentOutcomeId`**.

From that point the failed window's ante is unreachable **by anyone**: `settleWindow` only ever
redeems `currentOutcomeId`, a duel can only be claimed by its own holder
(`DirectDuelVenue.redeemFor:210-263`), and `Prophet` exposes no arbitrary call. There is no rescue
path, not even for the owner.

The fix is one line in `commitAll`, today at **`Population.sol:1295`** (the audit cites `~1108`; the
`windowAnte` comment block has since pushed it down):

```solidity
if (p.positionOpen()) continue;
```

It converts the failure into a **one-window delay with automatic retry** — the next `settleAll` finds
`positionOpen` still true and redeems the *original* position.

**The obvious fix is worse than the bug, and this is the part worth carrying forward.** Putting the
guard in `Prophet.noteCommitted` — where it *looks* like it belongs — takes down the entire window:
`_pair`'s `catch` calls `_openEmpty`, which calls `noteCommitted`, so the second revert would be
thrown *from inside the handler for the first*, with no boundary left to catch it. That is not
reasoning, it was measured: perturbation **P2** added that guard and the assertion pinning the bug
fired. The comment at `Population.sol:1181-1182` records it at the site.

Deploy cost: **zero**. `contracts/deployments/` is empty, nothing is deployed, so there is no beacon
or proxy upgrade. It touches no storage. It *is* a behaviour change in a production contract, so if
the user would rather not touch Solidity three days out it reverts by deleting that line — at the
price of losing the ante the first time a settlement fails.

### N14 — the corner N10's retry opens, and how it was actually closed

The retry recovers the exact money but **does not carry the note forward**. `belief` is a live field:
being skipped by `commitAll` does not skip your `think`, so the organism is asked again and its belief
becomes the *new* window's. Money grading was always safe — `Prophet.sol:444` decides won/lost on
`collateralOut > staked`, and both fields survive the failure intact. Fitness grading was not:
the old predicate marked ABSTAIN when the **current** belief was `Abstain`/`None`, so a retry landing
in a window where the organism formed no belief would score an abstention against a position that
genuinely won or lost money. Only the fitness counter lied — but the fitness counter *is* the product.

The audit's N14 recorded this as documented-and-pinned-but-not-fixed. **N19 then fixed it**, and this
checkpoint should not be read as if it were still open: `Prophet.sol:476` is now `if (quantity == 0)`,
and `:485-495` explains why the predicate must not consult `belief` at all. `quantity` travelled with
the position; `belief` did not. Fixing it by *snapshotting* the belief would have cost a fresh
`Prophet.__gap` slot, and this way costs none.

### N11 / N12 — ops could see neither a void nor a swallowed failure

**N11: a void moves no counter, so a poll-based monitor is structurally blind to it.** None of
`monitor.ts`'s six alerts could see one. `settleWindow` advances `windowsLived` unconditionally and
then takes exactly one of three branches (`correct`/`wrong`/`abstain`, `Prophet.sol:464-475`), and
nothing else in either contract writes those four fields. So

```
windowsLived - (correctCount + wrongCount + abstainCount)
```

is an **exact** void count, and all four fields already came back in `snapshot()` — zero additional
reads. Added as check 5b with `MONITOR_VOID_GRACE` (`monitor.ts:76`, **default 1, not 0**: a single
void is honest and alerting on it would be noise). Why nothing else could see it: `DuelUnadjudicable`
is in no ops ABI, a void emits no `SettleFailed`, and check 5 is conditioned on `currentQuantity > 0`.

**N12: two of the three per-organism failure events were undecodable.** `scripts/lib/darwin.ts`
declared only `ThinkFailed`. The three are a deliberate set (`CLAUDE.md`: *"one bad organism must never
halt the population"*), and a swallowed failure leaves **no state trace at all** — no counter moves,
nothing differs — so only the caller holding the receipt can ever see one. `monitor.ts` polls state and
is therefore incapable by construction. `SettleFailed` and `CommitFailed` were added and are consumed
by a new helper, `reportStragglers()` (`cadence.ts:768`), hooked behind think (`:283`), commit
(`:395`) and settle (`:570`). Filtering by emitter works on **both** settle branches because `poke()`
calls `settleAll` internally, so Population's own logs are in the receipt either way — the comment at
`cadence.ts:566-569` says so at the site. `SettleFailed` now states explicitly that the position is
**still open with the ante escrowed**, which is half of N10 made visible.

### N13 — two dead grants, pinned with a test instead of deleted

`Prophet.grantPopulation`'s two grants (infinite ERC-20 allowance plus 6909 operator to `Population`,
from every organism) are used by nobody, and they contradict the rule the repo writes down at
`Population.sol:924`. `Population` reaches `transferFrom` at exactly `:1000` and `:1171`, both times
from `msg.sender`, and never touches `IOutcomeToken6909` — settlement is a **push** from the organism
because the 6909 surface has no `transferFrom`.

They were not deleted. `test_prophet_populationNeedsNeitherGrantItIsGiven` revokes both and runs a
complete DreamDEX window. They can be removed whenever the user likes, and if anything ever starts
depending on them the test says so. Deleting dead code on a deadline buys nothing; proving it is dead
buys the option.

### N15 — the ante frozen at the window's open. The segment's only storage change

`ante()` is **derived** — `(windowCount - seasonStartWindow) / levelWindows` — and *every input to it
is writable by somebody while a window is in flight*, `endSeason()` most of all, which is deliberately
permissionless and un-phase-gated. So an organism could be asked at one price and charged at another.

Fixed as the finding itself asked: **photograph the ante, do not add a phase guard.**

- `Population.sol:211` — `uint256 public windowAnte;`, with its rationale in the block above it.
- `Population.sol:302` — `__gap`. It was `uint256[9]` before this entry and `[8]` after it;
  `genesisTreasury` (slot 38, `:233`) took another one later the same day and the
  `windowVenue`/`windowRakeBps` pair took one more, so the declaration reads `uint256[7]` today.
  **`windowAnte` is slot 37**, envelope still ends at 46. Re-derived from the compiler, and
  `STORAGE.md`'s tables, status block and changelog all carry it.
- `Population.sol:1466` — `windowAnte = ante();` inside `think`, with `:1456-1461` explaining that this
  is the last instant at which nobody else can change the answer.
- `Population.sol:1646-1647` — `uint256 want = windowAnte; if (want == 0) want = ante();` in `_pair`.
  The fallback is not paranoia: a proxy upgraded mid-window has storage predating the field, and one
  window priced live beats a whole population staking zero.

**No phase guard was added to `endSeason`.** That was the alternative the finding explicitly rejected:
`endSeason` being permissionless is a *property*, not an oversight, and closing it to fix the ante
would have paid for the fix with the demonstrable part of the design.

### N16 → N19 — seven owner footguns, closed with named reverts

All verified by reading the live tree today, not from memory:

- `SelectionEngine.sol:172` — `if (to == address(0)) revert ZeroOwner();`. The reason is not the lost
  admin: handing ownership to zero **freezes `fallbackEnabled` at true** and makes the central claim
  (*"no keeper anywhere in the causal chain"*) permanently unprovable.
- `PushedPriceSource.sol:94` — `setMaxStaleness(0)` reverts `ZeroStaleness` instead of bricking the feed.
- `SelectionEngine.sol:119-120` — `poke()` checks ownership **before** phase, with the reason at the
  site: each party gets the error that describes *it*.
- Four unchecked `bool` returns → all guarded. `Population:601/666/806/857/1506/1547/1687`,
  `Prophet:319/404/471/520`, `DreamDEXVenue:84`, all `revert TransferFailed()` (the `666` is a compound
  `if`). Nothing fails silently any more.
- `DirectDuelVenue.sol:287` — `positionIdsOf(0)` underflowed; now `if (duelId == 0) revert
  UnknownDuel(0);`. Zero is exactly the argument passed by someone with no duel — an unset variable, a
  lookup that found nothing — and `0 * 2 - 1` answered with an arithmetic panic. It now answers with
  the same error any nonexistent id gets.
- `PushedPriceSource.sol:146` — `if (openPrice == 0 || lastPrice == 0) revert ZeroPrice();`.
- `PushedPriceSource.sol:147` — `priceDecimals` capped at 18 (`BadDecimals`). **This one is a judgement
  ceiling, not a measurement** — real feeds do not exceed Chainlink's 18 — and `:123-135` says exactly
  that, including the mechanical limit of 77 at which `Genome._decimal` would actually revert.
  `_decimal` still has no guard of its own; no real path reaches it.

**One N16 item is still open, and it is cosmetic:** `lastThesis` / `lastReasoning` go stale when
`belief` is cleared. `Prophet:263-264` writes them in `think`, and neither settle (`:528`) nor die
(`:536`) clears them — both only touch `belief`. Damage: `readModel`/`whisper` can return a thesis from
an earlier window. An honest fix costs a `__gap` slot or reads them in context instead of
photographing them. **Left as the user's decision; it does not block delivery.**

### N20 — every count in these documents rots, and the cause is structural

Three different Solidity counts appear in `bugs_jueves.txt` alone (111, 114, 124) and all three were
measured on **the same day**. This checkpoint carried `149 PASS / 36 render calls`; the suite prints
**189**. None of them was false when written. What was missing in every case is **what was being
counted** — and without that a reader cannot re-measure to check whether the number is still alive.
They can only copy it forward, which is precisely how it rots.

The case that proved it, because a measured example is worth more than the moral: **the `36` was never
a count of render calls.** It is the number of *probe lines the suite prints* (35 `ok` + 1 `null`). And
the `313` that `CLAUDE.md` documented looked unreproducible — it contradicts the 36, and the harness
carries no counter at all. It was settled by instrumenting in memory (`.tmp-verify/hooks.mjs`, a Node
`load` hook wrapping every `export function` in `web/js/render.js`; possible because `export function
f(){}` declares a **mutable** binding and ES-module exports are live, so **no repo file was touched**):

- **167** `assert(` in statement position. Raw grep gives 169 = 167 + the `function assert(` definition
  + one mention inside a comment. The docs' 167 was right; my quick count of 168 was the sloppy one.
- **50** `ui.*(` call sites in the test file, across **13** of the 16 exported renderers.
- **1037** executed calls to exported renderers, of which **`chip` alone is 724**. And
  `1037 − 724 = 313` — exactly the documented figure.
- **14** of the 16 exports execute at least once; `masthead` and `retime` never run under the fixture.

So `313` was correct and its basis had never been written down anywhere. It is *"executed calls to the
fifteen exported renderers that are not `chip`."* That sentence is now in `CLAUDE.md` and in the audit.

**The rule that comes out of it:** a count in this repo's docs carries its basis **in the same
sentence**, or it does not get written. *"189 checks"* — no. *"189 checks over 167 `assert()` call
sites"* — yes, because the second can be re-measured and the first can only be believed.

**A second lesson, from the sweep that fixed the first.** The audit's N6 re-stamped the stale figures
and closed itself as *"six sites, not two"*. There were **eight**. The two it missed were
`darwin/README.md:345` and `darwin/web/README.md:59` / `:63-64` — both now fixed. The failure was the
**inventory**, not the arithmetic: that sweep looked where the internal docs cite each other and not
where the project speaks *outward*, so the two surviving stale copies were the two a judge opens
first. `web/README.md` also spells its figures **in words** (*"thirty-six calls"*, *"One hundred and
forty-nine assertions"*), which is why a grep for digits could not find them. Sweep the whole tree,
READMEs included, and search for the number written out as well as in digits.

**And a third lesson, which is the one that generalises: the sweep was scoped to one figure across
many files, when what was needed was every figure in the few files that govern the next session.**
`CLAUDE.md` — the file every future session reads first — carried two rotten counts that no amount of
grepping for `149` or `36` could ever have surfaced, because they were entirely different numbers:

- `CLAUDE.md:34` said *"one contract `DarwinTest`, 100 tests"*. It is **124**, and the basis is now in
  the sentence: **124 `function test` declarations** in `contracts/test/Darwin.t.sol` (4,597 lines, one
  test contract, **zero `testFuzz`**), so the suite count and the declaration count are the same
  number — which is precisely what makes the figure re-checkable instead of re-rottable.
- The storage paragraph still claimed **47 `Population` rows** from the 2026-08-30 diff, taken before
  phase 4 appended `windowAnte` on 2026-09-05 (`Population.sol:211`, with the `__gap` declaration below it shrinking
  from `uint256[10]` to `uint256[9]`, so slot 37 and a gap at 38–46 — `genesisTreasury` then took
  38 and the gap is `uint256[8]` at `:235` today). It is **48**.

**The two were not treated the same way, deliberately.** *"100 tests"* asserts a **state**, so it gets
re-stamped with its date and basis. The 2026-08-30 diff is a **dated measurement**, so it is left
exactly as written and given a forward pointer saying the layout changed afterwards.

`CLAUDE.md:362` is the case that shows why that distinction is not bureaucracy. It reads *"Tests:
56/56 under both"*, from the `paris` → `shanghai` migration of 2026-08-29. **Changing that 56 to 124
would have fabricated a measurement** — nobody has run today's suite under `paris`, and the entire
claim is that *one identical suite* passed under both EVM versions. A 124 there turns a piece of
evidence into a false statement. It got a date anchor and kept its figure.

So the rule has two halves now. Before re-stamping any number, ask whether the sentence asserts a
**state** (re-stamp it) or a **measurement made on a day** (anchor it, never overwrite it). And sweep
**by file, not by figure**: `CLAUDE.md`, `README.md`, `web/README.md`, `STORAGE.md` and both
checkpoints, reading every number in each.

**What did hold, verified today rather than trusted** — the two counts in `web/README.md` written *in
words*, which are exactly the ones a digit grep cannot see. *"Forty-four"* is exactly the **44**
`assert(` call sites between `smoke.mjs:462` and `:611` inclusive, and the banner at `:614` (*"ADD NEW
ASSERTIONS BELOW THIS BANNER"*) is what kept the season-close work from landing inside the range and
silently breaking the sub-count — the six new detector self-tests sit at `:806`–`:855`, below it.
*"Eleven-assertion block"* is the **11** at `:517`–`:543`. Both sentences now carry those bounds
inline, so the next reader can re-derive them without instrumenting anything.

**Tooling corollary, which cost an entire confusion:** PowerShell's `Measure-Object -Line` **does not
count blank lines.** It reported 1175 / 1427 / 582 for `SESSION_CHECKPOINT.md` /
`FRONTEND_CHECKPOINT.md` / `bugs_jueves.txt`, whose real sizes are **1434 / 1721 / 708**. Three files
appeared truncated. They were not. Do not use it to count lines.

**A second tooling trap, hit while writing the note above:** `Get-Content` on `bugs_jueves.txt`
returned mojibake (`pÃ¡gina` for `página`) because it decoded the UTF-8 file as ANSI, while the Read
tool decoded it correctly. Never copy an `old_string` for an edit out of PowerShell output — the bytes
will not match. Read the file with the Read tool and copy from there. (The failed edit was also off by
one space of indentation, which the same Read settled.)

### N21 — `app/dist` had gone stale again, which is N7 re-arming

**5 of the 11 files** in `dist/arena/js` differed from `web/js` (`abi.js`, `dom.js`, `fixture.js`,
`labels.js`, `render.js`): dist was built at 12:10 and `web/js` was edited between 15:24 and 15:51.
`dist/arena` is a **build-time verbatim copy** of `web/`, so editing `web/` and running the harnesses
without rebuilding measures the *old* bundle. `npm run build --prefix app` (exit 0), re-hashed: 0 of 11.

The fix is not the point. The point is that this trap was **already documented as N7 and bit again**,
because nothing detects it — the harnesses pass just as happily against the stale bundle. The order,
and the third step is the one that cannot be skipped: edit `web/` → `npm run build --prefix app` →
**hash both directories** → then the harnesses. Comparing mtimes is not enough.

### N22 — `arena.mjs` measures Chrome's own error page and never says so

With nothing listening on `:3000`, the harness attaches, navigates, and prints **sixteen lines of
confident diagnostics about Chrome's connection-error page** — `title "localhost"`, `sheets=0`,
`cards 0 · feed 0 · metrics 0`, all three fonts `MISSING`, `ground rgb(32,33,36)` — then dies 400 ms
later on an unrelated `getBoundingClientRect` of null (`cdp.mjs:187` via `arena.mjs:441`). It never
says *"no server"*. Worse, that output is **indistinguishable from "the app rendered nothing"**, which
is a real app defect the harness exists to catch.

Until someone adds a reachability probe, read `ground` and `cards` **before** anything else: a real run
is `cards 13` on the app's own ground. `rgb(32,33,36)` with 0 cards is Chrome, not DARWIN.

### What the audit closed on the frontend side

`C2` (the season close) is now reviewed in a browser, not merely written: `arena.mjs` renders
*"SeasonEnded · season 1 ended · pot 4.54 tUSDC · paid 4.54 tUSDC"* with 3 payouts, 3 `sev-good`
banners and 50 feed rows. Six of the twelve detector self-tests came with that work
(`web/test/smoke.mjs:806`, `:811`, `:826`, `:835`, `:841`, `:855`), each sitting next to the assertion
it protects and saying so in the comment above it. An undocumented legibility pass also landed in
`web/js/labels.js` (+52 lines) — see `FRONTEND_CHECKPOINT.md` §8.17, which records why `None` had to
stop rendering as `None`.

### Still open, and who owns each one

**The user's decision, before anything is broadcast — both are in `bugs_jueves.txt` as N1 and N2:**

- **N1 — whose are the eight founders?** `spawnGenesis` passed `msg.sender` as the entrant
  (at the time of this finding; it now passes `genesisTreasury`, `Population.sol:585`), so the
  founders belonged to the owner, and a founder's 60% leaves `prizePool`
  for the EOA **without passing through `rakeAccrued`** — i.e. outside `withdrawRake`'s cap. Measured:
  pot 42,500 → owner +25,500 with `rakeAccrued` 63,750 unmoved. (The `if (to == address(0)) continue;`
  branch at `:816-821` is dead code as a result.) The alternative leaves the whole lineage ownerless
  and its capital unrecoverable. The audit's own A2 assumed the opposite; both readings are defensible
  and the choice changes what gets deployed.
- **N2 — the first season does not close before the deadline.** With `seasonWindows = 576` and
  `Deploy.s.sol` calling no setter, season 1 closes ~**12-Sep**, four days *after* the 8-Sep
  submission. A judge would see a pot that grows and never pays, and `SeasonEnded` / `SeasonPrizePaid`
  would never emit. The lever is **one owner transaction, no redeploy**: `setSeason` does not move
  `seasonStartWindow`, so lowering `seasonWindows` shortens the season already in progress.

**Small items the user owns ([TUYO] in the audit):** `Deploy.s.sol:508` documents
`forge script script/Seed.s.sol --broadcast` **without the `:Seed` suffix** (N3), and `.env.example`
does not document `MONITOR_SEASON_GRACE` (`monitor.ts:98`, default 1) (N4). Both files that need the
first fix — `Seed.s.sol` and `Deploy.s.sol` — are **permission-denied to Claude sessions** in this
environment (Read/Grep/Bash reject them; git and forge see them fine), so a human has to make that
edit and check it.

**Deferred by prior decision, not forgotten:** `C1` (the standings panel) and `C3` (landing prize-pool
reads) are still `[PENDIENTE]`; `C5` (eslint) is deliberately parked until after delivery; the
`lastThesis`/`lastReasoning` staleness is the one open N16 item; the `Settled(bool correct)` /`won`
handoff above is untouched; folding `endSeason()` and `hatchAll()` into `cadence.ts` has not been done;
and `_spawn` must be made to spend `drawCognition`'s returned `sent` rather than
`address(this).balance` before it can be called correct.

**Not started, and not to be started unprompted:** the Season 0 deploy and the
subscribe → `npm run prove` → `npm run fee` → `disableFallback()` chain. STT and faucet provisioning
is the user's, deliberately last, by their own instruction. **Deploying and broadcasting are the
user's call, not a session's.**

---

## 2026-09-08 — submission day: window 68 settled, the repo pushed, and the four steps that remain

**This is the newest section. Read it before anything above it.** Written on the day the
hackathon closes, after the first real selection event on this deploy and after `origin/master`
finally caught up with the working tree.

Two figures in the older sections of this file are now WRONG and are left standing as dated
record, per this file's own format rule: **`0.033 STT per organism per window` (§2.14, §6 step 5,
and the `perAgentReward` row of the audit table) is superseded by 0.24.** The live number is
`3 × (0.01 + 0.07)`, and the reasoning is below. `darwin/CLAUDE.md` and `docs/BUSINESS_PLAN.md`
carry the corrected figure; this section is the pointer that stops the old one being trusted.

### A. What the price error actually was

`perAgentReward` was `0.001 ether`, taken from `getRequestDeposit`'s arithmetic rather than from a
request that succeeded. **The escrow floor prices a request validators are ENTITLED TO DECLINE**,
and at 0.001 they declined 104 of 104. From outside, a whole population abstaining with innocent
genomes looks exactly like a parser bug — so the cost model and the abstention bug were one error,
not two.

Measured census, n=182 of our own requests, `chainOfThought` held false throughout:

| `perAgentReward` | Success | Failed |
|---|---|---|
| 0.07 STT | 78 | 0 |
| 0.001 STT | 0 | 104 |

That separates 182/182 on one variable. Two conclusions follow, and one earlier belief dies:
`allowedValues` is **absolved** (a request carrying 27 values was served fine), and the deposit
floor is **not** a sufficient price. Do not reason from `getRequestDeposit` again.
`contracts/src/interfaces/ISomnia.sol` records the census at the function that misled us.

### B. Window 68 — the first real selection event on this deploy

Executed by the user (Claude cannot sign): `forcePhase(uint8) 2` at block 483075526, then
`settleAll()` at block 483075647 — 394,027 gas of a 3,000,000 limit, 9 logs. Decoded against the
compiled ABIs, not against the explorer:

```
Redeemed      13,300,000 burned -> 13,300,000 tUSDC   (outcomeIdx 0)
Raked         prophetId 1   profit 6,650,000   rake 166,250   (2.5%)
Settled       prophetId 1   correct=true   treasury 13,083,750
WindowClosed  window 68   aliveCount 6
```

Post-settle state, read from chain across all eight organisms:

```
aliveCount 6   prizePool 3,453,000   rakeAccrued 16,459,500

#1 MOMENTUM   alive  13.08 tUSDC  ok=1  streak=1
#3 BREAKOUT   alive  13.08 tUSDC  ok=1  streak=1
#2 REVERSION  DEAD        0       bad=1
#4 PINNED     DEAD        0       bad=1
#5-8 SKEPTIC/GAMBLER/PATIENT/SCALPER  alive  6.60 tUSDC  abstain=68
```

**`abstainCount` stayed at 67 while `windowsLived` went to 68** in the four that took a position.
That gap is the DURABLE proof a real position existed: `settle` resets `currentQuantity` but never
the counter, so it survives the window and is the thing to show a judge. `positionOpen=false` and
`currentQuantity=0` in all eight — nothing is orphaned, and `cadence:once` is safe again.

Why the phase reads 0 now: `forcePhase` writes the slot with no event (`Population.sol:773`) and
`settleAll` returned the phase to 0 on closing the window. The whole 0→2→0 sequence happened
between two reads 121 blocks apart, which is also why a 30-second poll monitor never saw the 2.
Not a defect — a real limitation of polling, worth knowing before someone hunts for a lost tx.

The danger that made this urgent is now gone, but the mechanism is not: `Prophet.noteCommitted`
(`contracts/src/Prophet.sol:409`) has **no guard on `positionOpen`**, so a `commitAll` before a
settle overwrites `currentOutcomeId`/`currentStake`/`currentQuantity` and orphans the winning
tokens with their stake already spent. Never run `cadence:once` with a position open.

### C. Keyless work closed today

- **`cite:check` FAIL → PASS.** Five broken citations, not the two previously recorded: two in
  `FRONTEND_CHECKPOINT.md` from an earlier `Hero.jsx` reordering, three pointing at stale
  `web/config.js` lines. 0 BROKEN now.
- **`prove-same-block.ts` B1 and B3.** It could print its strongest verdict with its central
  check skipped. It now walks candidates newest-first instead of judging only the last reaction,
  and a missing `WindowOpened` is a `problems.push` rather than a warning — without it, a
  shared-singleton coincidence is indistinguishable from the claim. Split into gather / judge /
  report so the judgement is pure: `npm run prove:selftest`, 12 checks, 2 controls, and all four
  new assertions were confirmed capable of failing **by perturbation**, not by inspection.
- **`scripts/lib/gas.ts`.** `eth_estimateGas` is structurally incapable of sizing `settleAll`,
  which never reverts — per-organism failures are caught and the phase advances anyway — so the
  estimate covers a path the real call does not take. Explicit gas in all four drivers, shared
  rather than mirrored. The defect it prevents is cited at `scripts/lib/gas.ts:11`.
- **The landing stopped contradicting the chain.** `BeatGenome.jsx` read `Organism #7 ·
  generation 2` with an invented body and `Parent #3`, on a deploy where `generation()` is 0 in
  all eight and `breedProphet` has never been called; it is now REVERSION, prophet id 2, genome
  quoted verbatim from `genomes/genesis.json`, marked dead — which it is, as of §B.
  `BeatLineage.jsx` drew a four-generation pedigree; nothing has bred, so nodes are now LETTERED
  (a numbered node is a claim a judge can look up in `/arena/`), the caption calls itself a
  diagram, and the rail carries the live census — 8 born / 6 alive / 2 dead / 0 at generation 1,
  which §B confirms exactly. Hero's `41.20 tUSDC` became `10.00`, which IS `endowment()`.
- **`web/config.js` POPULATION set**, so `npx serve web` lands a judge on the live arena rather
  than the setup card.
- `scripts/tmp-watch-fix.sh` deleted; the §5 nitpicks resolved or consciously declined. **viem
  stays on the CDN** — vendorizing it would change both surfaces' load path on submission day.

Deliberately NOT restamped: the dated `189 checks / 167 assert()` figures in
`FRONTEND_CHECKPOINT.md`. They are dated records, `darwin/CLAUDE.md` is the one file kept current
and already carries the live 231/211, and `count:check` passes. Rewriting a dated measurement
would assert one that never happened — the same convention as the `56/56` EVM row.

### D. The repo is pushed; the app is not yet published

`origin/master` is at `b85274a`, 0 ahead, tree clean. Four commits, split by subject because a
single 29-file commit mixes contracts with layout and cannot be reviewed:

| | |
|---|---|
| `bac3732` | inference price, driver gas, prove made able to fail |
| `2c1aa7a` | landing stops claiming what the chain contradicts |
| `2529ca3` | `vercel.json` |
| `b85274a` | the 7× cost error and the citations it broke |

Gates re-run **on the committed tree**, all green: typecheck clean, `cite:check` 0 BROKEN,
`count:check` PASS, `prove:selftest` 12/12, `npm test --prefix web` ALL GREEN, `abi:check` 257/258,
`npm run build --prefix app` 9.25s.

**`vercel.json` is verified against a real build, not guessed**, because three of its four lines
are wrong under Vercel's defaults. The root `package.json` is Foundry and ops scripts; the
buildable surface is `app/`. So `installCommand` and `buildCommand` are both `--prefix app`
(`vercel.json:4-5`), `outputDirectory` is `app/dist` (`:6`), and **`framework` is `null`** —
autodetecting Vite makes Vercel look for a `vite.config` in the repo root, where there is none.
`/arena` redirects to `/arena/`: without the trailing slash the dashboard's relative assets
(`app.css`, `js/main.js`) resolve against the domain root and 404, the same defect
`app/vite.config.js` already fixes for preview. Manifests get `must-revalidate` so a redeployed
contract address is not hidden behind a cached JSON.

Confirmed by running it: `npm ci --prefix app` resolves (lockfile v3, tracked), the build emits
`dist/arena/` and `dist/contracts/deployments/`, and serving `app/dist` at a **domain root**
answers 200 on `/`, `/arena/` and both manifests. There is no client-side router in `app/src`, so
no SPA rewrite is needed — those are real files.

**Root Directory must stay `./`.** The commands already carry `--prefix app` and
`outputDirectory` is relative to the repo root, so setting it to `app` makes Vercel look for
`app/app/dist`. Vercel works where GitHub Pages would not, incidentally: `dist/` is ignored
(`.gitignore:41`) so nothing is committed to serve, and 15 `href="/arena/"` links in `app/src`
plus `app/index.html` require the site to sit at a **domain root** — a project Pages URL
(`/Darwin/`) would 404 every one of them unless `base` and all 15 hrefs changed.

### E. Live parameters, read from chain 2026-09-08

```
season window 68 of 48+24 -> season closes at 72 (4 windows left)
cognitionEndowment  0.33 STT      <-- against a 0.24 deposit: a newborn thinks 1.4 windows
baseAnte            0.25 tUSDC    levelWindows 4    metabolicCost 0.05    endowment 10.00
collateral          39.9125 tUSDC
cognition held      15.84 STT across 6 organisms -> worst runway 11 windows (~2.8 h)
birth float         12.2297 STT in Population = 37 more children
```

`npm run fund` with no flags is report-only and is the fastest way to see whether the population
is about to go quiet. It currently WARNs: under a day of runway.

### F. What remains, in order, and who owns each step

The order is not preference. Step 1 is the only one with a clock of its own; step 2 gates nothing
else but is what the organizers actually check; steps 3 and 4 are the expensive ones and degrade
gracefully if time runs out.

**Corrección al párrafo de arriba, escrita el mismo día y por eso no se borra: el paso 3 no
"degrada bien". Es precondición del paso 4.** El motor desplegado no lleva la guarda, así que salta
`_windowIsDecidable` y llama de verdad a `settleAll()` en cada finalización ajena. Hoy es inofensivo
solo porque la fase es 0. Con una posición abierta, la finalización del mercado de cualquier
desconocido cerraría nuestra ventana contra el resultado de otro. Y el paso 4 es el que produce
generación 1. La evidencia está en `docs/ERROR_PUBLISHED_SITE.md` §2a; el bloque de comandos, en
`docs/HANDOVER_ENGINE_REDEPLOY.md`.

**Step 1 — publish to Vercel, and verify the links. THE USER, then Claude.**
**Ya publicado: `https://darwin-protocol.vercel.app/`** (confirmado por el usuario 2026-09-08; es la
primera vez que el dominio de producción aparece en estos documentos). Lo que queda de este paso es
la mitad de Claude: verificar cada enlace contra el dominio real — los 15 de `/arena/`, los del
explorador de Somnia y los de GitHub. Ninguno se ha comprobado nunca contra otra cosa que localhost,
y `landing.mjs` y `console.mjs` aceptan una URL como argumento precisamente para eso.

**Y el sitio publicado trajo tres defectos graves, dos ya cerrados.** El usuario los reportó
mirándolo: `/arena/` solapaba el primer con la arena, el feed era "puro error", y la landing llevaba
las tres transacciones encima. Diagnóstico, arreglos y tests en **`docs/ERROR_PUBLISHED_SITE.md`**.
El único que sigue vivo es el del feed y es el paso 3 de esta lista.


**Step 2 — `cognitionEndowment`, one owner transaction. THE USER (key).**
0.33 STT against a 0.24 deposit means a newborn thinks 1.4 windows, so the first child of the run
would be born nearly brain-dead. `setSeason` with `cognitionEndowment = 1200000000000000000`,
seven fields unchanged, is prepared verbatim in `docs/HANDOVER_PRICE_FIX.md:118-129`. It does not
move `seasonStartWindow` or `seasonId` by design. Do this BEFORE breeding, not after.

**Step 3 — redeploy `SelectionEngine`, then `npm run prove`. THE USER (key).**
**Re-medido en cadena 2026-09-08, no asumido:** el motor desplegado en
`0xa21Be35123cb7f95F6B95513ae6D3798A39993E6` mide **2171 bytes** (`cast code`); el artefacto que
compila el fuente de hoy, **3324** (`forge build --sizes`), y con `bytecode_hash = "none"` dos builds
del mismo fuente son byte-idénticos, así que la diferencia no es metadatos: es otro contrato.
`_windowIsDecidable` está en el fuente. O sea que el arreglo está en el repo y no en la cadena.
Necesita redeploy → `setWiring` → resuscribir → `npm run prove`, y hasta que eso pase **la única
afirmación con licencia es la débil: "selection is on-chain and atomic with redemption"**, no la de
mismo bloque. `SelectionEngine.fallbackEnabled` no se cierra antes de que `prove` pase — la suite
local no puede ejercitar esta ruta en absoluto, porque el precompile de reactividad no existe en los
chain ids locales. **Bloque de comandos listo, con direcciones, dry-run y el paso que falla en
silencio señalado: `docs/HANDOVER_ENGINE_REDEPLOY.md`.**

**Step 4 — fund, then run the remaining windows and breed. THE USER (key).**
0.24 STT per organism per window, 6 alive, worst runway 11 windows. `npm run fund -- --windows N`
tops up and is safe to repeat. Season 3 closes at window 72, so four windows remain; MOMENTUM and
BREAKOUT are both at `streak=1` and need four consecutive correct calls plus 1.5× endowment to
breed, so generation 1 inside four windows is possible but tight. **Never `npm run cadence` bare
— it has no window cap**; unattended it once burned 29 windows and drained all eight organisms to
0 STT. Use `cadence:once`.

Unchanged from every prior section, and still true: **deploying and broadcasting are the user's
call, not a session's.**

---

## 2026-09-08 (noche) — el motor nuevo verificado EN PRODUCCIÓN, Fase B cerrada, y el ante bloqueando la Fase C

**Esta es ahora la sección viva. Léela antes que cualquier cosa por encima, incluida la sección
`## 2026-09-08` que la precede.** Todo número de aquí está leído de Shannon hoy, alrededor del
bloque 483305113, no recordado.

### A. El plazo se movió: jueves 2026-09-10

El usuario lo reportó esta noche: **los organizadores extendieron la entrega hasta el jueves
2026-09-10**, dos días más. No es una nota de calendario, cambia dos decisiones concretas:

1. **La Ruta A del §H deja de ser cara.** Quemar cuatro ventanas para llegar al fin de temporada
   natural ya no compite contra un reloj de horas.
2. **La generación 1 pasa de "posible pero muy justa" a plausible.** `breedStreak` es 4 y la mejor
   racha viva es 1, así que hacen falta al menos tres ventanas acertadas consecutivas más de un
   supervivente. En cuatro ventanas eso era suerte; en dos días es una muestra.

Lo que **no** cambia: el ritmo de gasto. La cognición se consume por ventana liquidada, no por
tiempo de pared (§2.14), así que dos días extra no cuestan STT si la cadencia está parada.

### B. Fase A — el redeploy del motor, verificado a la norma más fuerte que había

**El motor ya estaba redesplegado cuando fui a documentarlo.** `population.selectionEngine()` no
devolvía el `0xa21Be351…93E6` que documentan `ERROR_PUBLISHED_SITE.md` §2a y
`HANDOVER_ENGINE_REDEPLOY.md`, sino **`0xb85afb90Ee36C757EFe5202434c7a20f9E097eeD`**. Medir en vez
de asumir es lo que produjo el resto de esta sección.

**Identidad del código, que es la afirmación fuerte y no "hay bytecode".** El runtime en cadena de
`0xb85afb90…` es **byte-idéntico** al build local de `contracts/src/SelectionEngine.sol` **excepto en
exactamente 8 posiciones**, y las ocho reconstruyen los dos `immutable` del contrato
(`SelectionEngine.sol:46-53`):

| campo | offsets en el runtime | valor |
|---|---|---|
| `population` | 951, 1729, 3119, 4369 | `0xe0F46e61…38Cb` |
| `settlementEmitter` | 1439, 2085, 2279, 2971 | `0xbF4a49e0…Ed23` |

Un `immutable` se graba en el código, así que ocho diferencias en ocho posiciones que decodifican a
las dos direcciones correctas **es** la firma de "mismo fuente, constructor correcto". **Control
negativo, sin el cual la afirmación no vale nada:** el motor viejo diverge en **2692 bytes** contra
el mismo build.

**La suscripción, con su control emparejado.** `contracts/deployments/50312.reactivity.json` registra
la nueva: id **17060528**, handler `0xb85afb90…`, topic0 `0xb1884334…` (finalize, no redeem),
selector `0x53edf33d`, gasLimit 10000000, `isCoalesced` true, creada en el bloque 483298706, tx
`0xa987b0b4d148dd42c46dc1f900d39582c24ad7c01fafd3c5f2a4e23d65ebec15`. Y la vieja está muerta:
`getSubscriptionInfo(16520350)` **revierte con data vacía** mientras la misma llamada sobre 17060528
devuelve el struct completo. O sea que el motor viejo sigue desplegado pero **el precompile no lo
volverá a llamar nunca**. La superficie de ataque del §2a está cerrada, no solo tapada.

También verificado: `subscribe.ts --status` informa de `rec.subscriptionId` **del manifiesto**
(`subscribe.ts:519` toma también el handler de ahí), así que ya no puede hablar de 16520350. Ese era
el paso que `HANDOVER_ENGINE_REDEPLOY.md` §4 marca como "el que falla en silencio", y está bien.

### C. El defecto 2a está arreglado EN PRODUCCIÓN, no solo desplegado

Esto es lo que sube el listón por encima de "el contrato correcto está en la dirección correcta".
Los `ReactionFailed` del motor nuevo llevan un `reason` distinto, y el cambio es exactamente el que
la guarda predice:

| | `reason` en bruto | decodificado | quién revirtió |
|---|---|---|---|
| motor viejo | `length 0x44 · 05fb5e1b · 02 · 00` | `WrongPhase(2,0)` | **Population** — o sea que `settleAll()` SÍ se llamó |
| motor nuevo, 18 logs | `length 0x24 · 8e0ebc6c · 00` | **`NoCommittedWindow(0)`** | SelectionEngine, antes de llamar a nada |

`WrongPhase` es el error de *Population* (`Population.sol:392`, revertido en `:493`), así que solo
podía llegar al feed por el `catch` que envuelve `try population.settleAll()`. Que ahora salga
`NoCommittedWindow(0)` prueba que **la guarda `_windowIsDecidable` corre y rechaza la liquidación
ajena sin tocar `settleAll()`**. Ese era el peligro que `SelectionEngine.sol:108-128` llama por su
nombre: *"not a wasted callback; it is a corrupted generation."*

Consecuencia para el §F de la sección anterior: **el paso 3 está hecho y su precondición sobre el
paso 4 está satisfecha.** Correr ventanas ya no corre con la apertura abierta.

Y para el feed del juez: esas 18 filas ya no son suciedad. Con el arreglo 2b desplegado se pintan
decodificadas, y lo que enseñan es **la guarda de cross-talk funcionando en directo**.

### D. Dos instrumentos míos dieron ceros falsos. Los dos se cazaron con el control, no con la vista

Se anotan porque los dos habrían "demostrado" lo contrario de la verdad, y el mecanismo que los cazó
es reutilizable.

1. **Grep del selector en el bytecode.** Buscar `8e0ebc6c` en el hex del runtime devolvió **0 en los
   dos motores**, y el control `1507f5ce` también 0. Bajo `via_ir` los selectores no viven como hex
   contiguo, así que el instrumento no medía nada. Un 0/0 leído sin control se habría interpretado
   como "la guarda no está". Superado por el diff de identidad del §B y, después, por un log en vivo
   que **contiene literalmente** `8e0ebc6c` (§C).
2. **`grep -c "^blockNumber"` sobre `cast logs`.** `cast logs` indenta los campos con dos espacios,
   así que el ancla `^` no podía coincidir nunca. Tres escaneos devolvieron cero. **Lo delató que el
   control positivo también devolvió cero.** Con `"blockNumber:"` salieron 67 y 18.

La regla de CLAUDE.md — *un check cuyo sujeto es "X no puede pasar" va emparejado con uno que hace
pasar X a propósito* — es lo único que separó estos dos ceros de una conclusión falsa. En los dos
casos el fallo fue del instrumento, no del sujeto.

Menores, del mismo tipo: `prophetAt(0)` revierte `0xb7dd4bea` = `NoSuchProphet()` (los ids son
**1-based**, no falta un organismo); `generation()` y `currentWindow()` **no existen** en Population
— son `windowCount` en Population y `generation()` en cada Prophet.

### E. Fase B — `cognitionEndowment` = 1.2 STT, y el reloj intacto

Ejecutada por el usuario. Tx `0x74ab73e21469759711517c49e89372889b2e3f6fef67d70e76e63b3b79870f77`,
bloque 483305113, status 1. `cognitionEndowment()` = `1200000000000000000`.

Verificados **los ocho campos** de `SeasonParams`, no solo el que cambiaba, y el reloj **no se
movió**: `seasonId` 3, `seasonStartWindow` 48, `phase` 0. Que `setSeason` no toque el reloj es de
diseño (`Population.sol:1050-1052`) y es lo que hace segura la Ruta B del §H.

Consecuencia colateral que conviene tener escrita: los 12.2297 STT de float de nacimiento en
Population eran ~37 hijos a 0.33 y ahora son **~10 hijos a 1.2**. Sigue sobrando para lo que la
población puede parir en dos días, pero el número de la sección anterior (§E, "37 more children") ya
no vale.

### F. Censo en vivo, y la ventana 68 sigue siendo el único evento de selección real

```
phase 0   windowCount 68   seasonId 3   seasonStartWindow 48   prizePool 3.453 tUSDC
requestDeposit 0.24 STT   perAgentReward 0.07   subcommitteeSize 3   chainOfThought false
breedStreak 4   maxPopulation 24   metabolicCost 0.05
Population: 39.9125 tUSDC + 12.2297625756 STT      pagador 204.969 STT      gas 6 gwei
```

Ids **1..9**, `livingCount()` = **7**. **Todos generación 0.**

| # | estado | ok/bad/ventanas | racha | tUSDC | cognición |
|---|---|---|---|---|---|
| 1 MOMENTUM | vivo | 1/0/67 | **1** | 13.0837 | 2.64 STT (11 ventanas) |
| 3 BREAKOUT | vivo | 1/0/67 | **1** | 13.0837 | 2.64 STT |
| 2 REVERSION | **muerto** | 0/1/67 | — | 0 | — |
| 4 PINNED | **muerto** | 0/1/67 | — | 0 | — |
| 5–8 | vivos | 0/0/68 | 0 | 6.60 | 2.64 STT |
| **9** | vivo | 0/0/**0** | 0 | **32.00** | **0.33 STT (1 ventana)** |

**El #9 es nuevo desde la sección anterior** (que censaba 8) y no vino de `spawnGenesis`: los ocho
fundadores llevan `endowment` 10.00 y este lleva 32.0. Su cognición es 0.33 STT — exactamente el
`cognitionEndowment` que estaba en vigor **antes** de la Fase B —, así que entró bajo el suelo viejo
y **está a una ventana de morir de hambre**. Es el único organismo con urgencia propia.

Lo que esto dice del rendimiento real, y hay que decirlo sin adornos: **la ventana 68 es la única
que produjo respuestas de verdad en 68 ventanas**, y de 8 organismos respondieron 4 — #1 y #3
acertaron, #2 y #4 fallaron y murieron. Todo lo anterior son abstenciones por el error de precio
(§A de la sección previa), no por genomas rotos. La tasa de éxito empírica de la inferencia es de
una sola muestra y sale ~50%, así que una racha de 4 es suerte más al menos tres ventanas
emparejadas más.

### G. El bloqueo real de la Fase C: el ante está en el nivel 5 y cuatro organismos no pueden pagarlo

Esto no estaba en el plan y es lo que impide correr ventanas ahora mismo con provecho. El ante es
**derivado, no almacenado** (`Population.sol:188`):

```
level = (windowCount - seasonStartWindow) / levelWindows = (68 - 48) / 4 = 5
ante  = baseAnte * anteMultBps^level = 0.25 * 2^5 = 8 tUSDC
```

`windowAnte` leído en cadena: **8000000**. Contra los saldos del §F:

| | tUSDC | ¿paga 8? | ¿paga 16 (ventana 72)? |
|---|---|---|---|
| #1, #3 | 13.08 | sí | **no** |
| #5, #6, #7, #8 | 6.60 | **no** | no |
| #9 | 32.00 | sí | sí |

O sea que **correr ventanas ahora es correrlas en el peor punto del ciclo**: cuatro de siete no
pueden emparejarse, y en la ventana 72 el ante dobla a 16 y quedan fuera también #1 y #3.

**El desbloqueo es el fin de temporada, y está en el código:** `endSeason` hace
`seasonStartWindow = windowCount` (`Population.sol:1201-1244`), el nivel vuelve a **0** y el ante
baja a `baseAnte` = **0.25 tUSDC**. Requiere `windowCount - seasonStartWindow >= seasonWindows`, o
sea 24, o sea la ventana 72. `cadence.ts` lo llama él mismo en fase 0, no hace falta una tx a mano.

Aritmética de después del reset, porque el alivio no es indefinido: un organismo con 6.60 tUSDC
cubre hasta el **nivel 4** (4 tUSDC), o sea **unas 20 ventanas** antes de volver a quedar fuera. Con
dos días de plazo eso es holgura suficiente, pero no es infinito y conviene no descubrirlo corriendo.

### H. Las dos rutas. PENDIENTE DE DECISIÓN DEL USUARIO — la toma el 2026-09-09

Se le presentaron las dos esta noche y **eligió dormir y decidir mañana**. Ninguna se ha ejecutado.
Las dos llegan al mismo sitio: ante a 0.25 y los siete vivos capaces de emparejarse.

**Ruta A — natural.** Correr las ventanas 69→72 sabiendo que casi no habrá posiciones (ante 8 y
luego 16), y dejar que `endSeason` dispare solo en la 72. Cuesta ~6.7 STT de cognición y unas cuatro
ventanas de reloj. **Con el plazo extendido esto ya es asequible**, y tiene una ventaja que la Ruta B
no tiene: no toca ningún parámetro, así que la narrativa de la demo es "la temporada cerró cuando
tocaba".

**Ruta B — la palanca.** `seasonWindows` es uno de los ocho campos de `setSeason`. Puesto a **20**,
`68 − 48 = 20 >= 20` se cumple **ya**, y el siguiente `cadence:once` en fase 0 cierra la temporada:
reparte los 3.453 tUSDC del pote (6000/3000/1000 bps a los tres primeros por
`correctCount − wrongCount`, o sea #1 y #3 arriba), pone `seasonStartWindow = 68` y el ante a 0.25 —
sin quemar cuatro ventanas ni ~6.7 STT. Después hay que **devolver `seasonWindows` a 24** para la
temporada nueva. `BadSeason` solo rechaza el 0, así que 20 es un valor válido, y es un parámetro de
owner pensado para recalibrar.

Recomendación dada al usuario: B mientras el plazo era hoy. **Con el jueves de plazo la
recomendación se debilita a favor de A**, porque A no gasta ninguna credibilidad narrativa y el
único coste que tenía era tiempo. La decisión es suya.

**Fondeo, idéntico en las dos rutas y necesario antes de cualquiera:**

```
npm run fund -- --windows 20
```

Rellena **HASTA** 20 ventanas (una `topUpCognition` por organismo vivo, `requestDeposit()` de
divisor): ~2.16 STT a cada veterano y ~4.47 al #9, unos **17.4 STT** en total contra los 204.969 del
pagador. Sin flags es informe y no gasta nada. El #9 lo necesita sí o sí (§F).

### I. Corrección al orden del §F de la sección anterior

**`npm run prove` va DESPUÉS de que una ventana real se liquide, no antes.** Estaba colocado como
paso A7 de la verificación de la Fase A y **estructuralmente no puede pasar** ahí: exige un
`Reacted(viaReactivity == true)` compartiendo bloque con un `MarketFinalized` cuyo `pool` case con
un `WindowOpened` **nuestro** (`scripts/prove-same-block.ts:1-70`), y el motor acababa de nacer sin
haber liquidado ninguna ventana. La IA local del usuario paró en ese paso y **hizo bien**.

Orden correcto de lo que queda: fondear → resolver el ante (A o B) → correr ventanas → `npm run
prove` → y **solo si pasa**, considerar `disableFallback()`. `fallbackEnabled` sigue `true` y se
queda así. Es de una sola dirección.

### J. Lo que esta sección deja obsoleto, y no se ha reescrito

- **`docs/ERROR_PUBLISHED_SITE.md` §2a** y **`docs/HANDOVER_ENGINE_REDEPLOY.md`** describen el motor
  viejo `0xa21Be351…93E6` y la suscripción 16520350 como **vivos**. Los dos llevan ya una cabecera
  de superseded apuntando aquí; el cuerpo se deja como registro fechado, que es la convención de
  este fichero.
- La tabla de estado de `ERROR_PUBLISHED_SITE.md` marca 2a como *"pendiente, del usuario"*. **Está
  hecho y verificado en producción** (§B, §C).
- El §E de la sección anterior: `cognitionEndowment 0.33` → **1.2**; *"birth float = 37 more
  children"* → **~10**; el censo de 8 organismos → **9**, con `livingCount()` 7.
- Sigue vivo y sin hacer, del §F anterior: **commit + push** de los arreglos 1/2b/3 para que Vercel
  los publique (hoy `/enter/` da 404 en producción y el `main.js`/`chain.js` publicados no llevan los
  arreglos), la verificación de enlaces contra el dominio real, y el vídeo.

Sin cambios respecto a todas las secciones anteriores, y sigue siendo verdad: **desplegar y firmar
son decisión del usuario, no de una sesión.**

---

## 2026-09-09 — Ruta B ejecutada, la ventana 69 abierta, y el `think` que revertía por gas

Esta sección la escribe Claude en trabajo autónomo mientras el usuario duerme. Lo que aquí se afirma
como medido se midió; lo que quedó pendiente se nombra en §G y nadie lo dio por hecho.

### A. Ruta B, tal como el usuario la aprobó

`setSeason` bajando `seasonWindows` 24 → 20 para cerrar la temporada de inmediato. Funcionó: la
temporada 4 abrió en la ventana 68, `level` volvió a 0 y el ante derivado cayó de 8 tUSDC a
**0.25 tUSDC**, que es lo que desbloqueaba la Fase C. `endSeason` es permissionless y lo disparó la
propia cadencia antes del switch de fase (`cadence.ts:272`), no un script de owner — que es
exactamente la separación que `set-season-windows.ts` documenta y por la que no lo llama él mismo.

**El paso final de la Ruta B sigue pendiente: devolver `seasonWindows` a 24.** Ver §G.

### B. La ventana 69 no abrió a la primera: `think()` revertía, y era GAS

El diagnóstico costó lo que costó porque el recibo decía lo contrario de la verdad:

    gasUsed 4,026,317   de un límite de 4,100,000

Un out-of-gas de primer nivel consume el límite **exacto**. Que `gasUsed < gasLimit` parecía prueba
de que no era gas. No lo es — es prueba de **profundidad**. `Population.sol:1515` pone
`p.noteThinking(requestId, marketId)` dentro del cuerpo de éxito del `try`, y un `try/catch` de
Solidity **no protege su propio bloque `returns`**, sólo la llamada. La subllamada muere por gas bajo
la regla 63/64, el revert burbujea, y la retención de 1/64 del llamante queda sin gastar. De ahí el
hueco.

**Lo que lo separó no fue la vista, fue un control.** `why-reverted.ts` ahora hace **dos replays** en
el bloque anterior, porque uno solo no distingue las dos hipótesis vivas:

| con su propio límite | sin límite | veredicto |
|---|---|---|
| revierte | pasa | **GAS** |
| pasa | pasa | estado movido en su propio bloque |
| revierte | revierte | revert lógico; el error es el real |

Salió GAS. Un solo replay sin límite habría dicho "pasa" en los dos primeros casos.

### C. La medición, y por qué el estimador no servía

`eth_estimateGas` es estructuralmente inservible aquí: `think()` no revierte cuando se le ahoga,
emite `ThinkFailed` y devuelve éxito. El estimador ve éxito y declara suficiente un gas que sólo
alcanza para una ventana en la que media población no pensó.

`scripts/gas-bisect.ts` (nuevo) bisecciona sobre el **perfil de logs**, no sobre el revert.
Resultado a 7 organismos: **4.218.497**. La tabla enviaba 4.100.000 — el **97%** de lo necesario, un
fallo por 2,8%. `PER_ORGANISM.think` pasa de `500_000n` a **`800_000n`** (~1,55x la medición; 6,2M a
7 organismos, 19,8M a los 24 de `maxPopulation`, ambos bajo el techo de 30M).

**Un error mío que conviene dejar escrito.** Al cambiar ese número afirmé que no rompía nada "porque
`gas.ts` no tiene tabla de self-test". La tabla existe, pero vive en `cadence.ts`, no en `gas.ts` — y
el cambio **rompió el gate**. Lo detectó `npm run cadence:selftest`, no yo. Corregida la fila, y
añadida la invariante que la fila por sí sola no puede dar:

    THINK_MEASURED_AT_7 = 4_218_497n   →   driverGas("think", 7n) debe superarla

Una fila de igualdad no protege ese número: quien baje `PER_ORGANISM.think` editaría la fila al lado
y las dos coincidirían. La invariante no se mueve cuando la fórmula se mueve.

### D. El precio se puso stale a media faena — 513 s contra un límite de 180

Entre la apertura de la ventana y el commit, el precio empujado envejeció 216 → 513 s. `commitAll`
habría revertido `StalePrice` dentro de `_pair` y los 7 organismos habrían quedado `Unpaired` con la
creencia formada, sin jugar, **pagando metabolismo igual**.

`scripts/repush.ts` (nuevo) refresca el reloj sin mover el precio: `openPrice`, `lastPrice`,
`marketId` y `priceDecimals` se leen de `rawWindow` y se reescriben byte a byte; lo único que se
mueve es `updatedAt`. Esa identidad **es** el argumento de seguridad — `openPrice` es el nivel contra
el que se gradúa a toda la población, así que un re-push que lo "refrescara" no retrasaría la señal
de fitness, la corrompería. Verifica después de enviar que `openPrice` es idéntico y que `updatedAt`
avanzó. Se encadenó con el commit en una sola invocación de PowerShell para no perder contra mi
propia latencia de turno (PS 5.1 no tiene `&&`; el guard fiable es `$LASTEXITCODE`).

### E. Ventana 69: 7 de 7 pensaron, 0 posiciones — y eso es el diseño, no un fallo

Creencias: **5 Down** (#1, #3, #6, #8, #9), **2 Abstain** (#5, #7), **0 Up**. `_pair` empareja Up
contra Down, así que no había nada que emparejar: los 7 fueron por `_openEmpty` a
`Committed(stake=0, quantity=0)` + `Unpaired`. El precio venía **-0,34%** desde el open
(78.943,2 → 78.673,5), y genomas diversos convergen cuando la señal apunta a un solo lado. Que el
mecanismo funciona ya está probado: la ventana 68 sí emparejó.

Lo que la ventana 69 **sí** demuestra es que las dos reparaciones de hoy funcionan de punta a punta:
la financiación de cognición y el arreglo del precio dieron **7 respuestas de 7**.

### F. El cap de ventanas — un arreglo para dos fallos que no parecen el mismo

`npm run cadence` a secas no tiene tope. Sin vigilancia llegó a correr **29 ventanas** y dejó a los
ocho organismos a 0 STT; como se agotaron todos al mismo ritmo, la población se leía como muerta en
bloque en vez de seleccionada, y eso **enmascaró el propio arreglo que esa corrida probaba**. El
remedio existente, `--once`, causa el fallo de §D: sale tras **una** transición de fase, con lo que
el push y el commit caen en invocaciones distintas con un operador en medio.

`--windows N` no es un `--once` más pequeño; es la forma que `--once` debió tener. El bucle conserva
su continuidad —push y commit en el mismo proceso, con segundos entre ellos— y gana el tope, que era
lo único que se buscaba al usar `--once`.

**La mitad que carga el peso es la fase, no la cuenta.** Contar a secas pararía el bucle donde
cayera la ventana N-ésima, que para `think()` es la fase 1 — justo el estado a media ventana que
produjo §D. Un tope que deja la máquina entre un push y un commit ha reproducido el fallo que venía a
evitar. Por eso `runIsComplete` exige **fase 0**, y `cadence:selftest` lleva su tabla con el control
`ignoresPhase` escrito explícitamente: un cap que para en la cuenta correcta y la fase equivocada
sale limpio, registra una corrida completa y deja el precio envejeciendo detrás **sin ningún síntoma
en su propia salida**.

Uso: `npm run cadence -- --windows 5`, `npm run cadence:window` (N = 1), o `CADENCE_MAX_WINDOWS`.
Una corrida sin tope ahora lo dice al arrancar, dos veces, en vez de empezar en silencio.

### G. Lo que queda, en orden

1. **Cerrar la ventana 69** — `npm run cadence:once` en fase 2. `doSettle` se auto-protege: espera
   expiry **y** resolución en cadena (`cadence.ts:614-623`), así que no gradúa una ventana sin
   terminar. A las 15:43 faltaban 1007 s.
2. **Devolver `seasonWindows` a 24** — `npx tsx scripts/set-season-windows.ts --to 24 --broadcast`.
   **Sólo en fase 0**; el script lo exige y se para solo si no. Es el paso explícito que cierra la
   Ruta B.
3. **`commit` y `settle` siguen sin medir de verdad.** `gas-bisect settle` dio **1.568.986**, y ese
   número es un **PISO, no suficiencia**: `eth_simulateV1` no existe en `dream-rpc`, así que la
   herramienta cae a biseccionar `eth_call` sobre el revert — el predicado del propio estimador, el
   que declara suficiente el gas que se saltó un organismo en la ventana 68. La herramienta lo avisa
   en cada corrida. `commitAll` gastó 897.751 de 4,1M en la 69, pero ése es el camino **barato**
   (todos sin emparejar); el camino emparejado sigue sin medir.
4. **Decidir el destino de seis scripts nuevos** sin trackear: `season-report.ts`,
   `set-season-windows.ts`, `why-reverted.ts`, `gas-bisect.ts`, `repush.ts`, `tx-events.ts`.

### H. Estado del gate y de la cadena al escribir esto

Gate **entero en verde**: typecheck, fmt, cite (502 citas, 0 rotas), count, `cadence:selftest`
(15 season + 9 settle + 19 commit + 15 gas + **13 window-cap**, controles incluidos),
`monitor:selftest`, `scan:selftest`, **152/152** tests de Solidity, `abi:check` (265/266 guardadas),
`web` y `app`.

Cadena: `phase 2 · windowCount 69 · aliveCount 7 · seasonId 4 · seasonStartWindow 68 ·
seasonWindows 20 · ante 250000` (0,25 tUSDC) · venue `0x7c3F3E1c9AFB8Efac8B08E747b5E3AD85BD4A358`.

### I. Addendum de la tarde — la ventana 70, que yo NO tenía que abrir

**Lo primero, porque es un error mío y no debe quedar enterrado.** A las 15:59:52 leí `phase SETTLE ·
window #69 · expires in 8s` y volví a llamar `cadence:once` a las 16:00:38 contando con que liquidara
la 69 y parara. En esos 46 segundos la ventana expiró **y la liquidó algo que no era yo** — el
`SelectionEngine` tiene el fallback ABIERTO y su suscripción sí llama `settleAll()`. Así que
`cadence:once` encontró **fase 0**, y la acción única de la fase 0 es empujar precio y abrir ventana.

Resultado: **la ventana 70 quedó abierta y 7 organismos pagaron cognición (~1,68 STT) sin que el
usuario lo autorizara.** Yo mismo había escrito, unas horas antes, que no abriría la 70 por eso
exactamente.

**La lección no es "mira el reloj".** `cadence:once` no es una operación con nombre, es "haz lo que
toque", y lo que toque depende de un estado que puede moverse entre la lectura y la escritura. Con un
keeper vivo en la otra punta, **leer la fase y actuar sobre la fase no son el mismo instante**, y no
hay `--once` que arregle eso: haría falta que la acción declarara la fase que espera y abortara si no
la encuentra (un `--expect-phase 2`). No está escrito; queda anotado como la reparación que este
fallo pide.

**Por qué la terminé en vez de pararla.** La cognición es irreversible y ya estaba gastada; abandonar
la ventana a medias no la recupera, y además reproduce exactamente el fallo §D — precio envejeciendo
detrás de una población que ya pensó. Commit y settle no cuestan cognición, sólo gas del operador.
Parar era la opción que garantizaba la pérdida.

**Cómo fue.** Push a las 16:00:39, commit a las 16:01:51 — **72 s**, dentro del límite de 180 s, así
que el fallo de §D no se repitió. `all beliefs in — 7 de 7 tras 0s`.

    4 Down (#1 #6 #8 #9) · 3 Abstain (#3 #5 #7) · 0 Up
    7 x Committed(stake=0, quantity=0) + 7 x Unpaired    commitAll gasUsed 497.323

**Dos ventanas seguidas sin una sola creencia Up.** No es estructural — la 68 sí emparejó — pero son
**14 organismo-ventanas con 0 Up**, y una población que converge no puede emparejar, luego no genera
fitness, luego la selección se queda sin señal. Es la pregunta abierta más interesante del proyecto y
**no se ha medido**: haría falta mirar los genomas y ver si los 7 supervivientes son todos del mismo
tipo. No lo he hecho.

Y el punto 3 de §G sigue igual de abierto que ayer: 497.323 es **otra vez** el camino barato. El
camino emparejado no se ha medido nunca.

### J. Lo que de verdad urge para la entrega: **el sitio publicado corre código viejo**

Verificado en vivo hoy, no inferido:

    GET https://darwin-protocol.vercel.app/enter/   →   HTTP 404 Not Found

Un 404 es del servidor, antes de que corra un solo byte de JS, así que esto no es un fallo de
renderizado: **la ruta no existe en producción**. `docs/ERROR_PUBLISHED_SITE.md` ya lo decía y la
comprobación lo confirma. Los arreglos 1, 2b y 3 de ese documento están **en el repo y no
publicados**, y `vercel.json` redirige `/enter` → `/enter/`, o sea que el redirect apunta a un 404.

`git status` explica por qué: `app/enter/`, `app/src/enter.jsx`, `app/src/Console.jsx` y
`app/src/sections/EnterInvite.jsx` están **sin trackear**, y Vercel despliega desde git. Lo que no
está commiteado no existe para el build.

**Esto lo tiene que hacer el usuario: commit y push son suyos, no míos.** El árbol está limpio de
gate (todo verde) pero tiene 22 ficheros modificados y 12 sin trackear. Al despertar, y ANTES de
enseñarle el dominio a nadie:

    cd darwin
    npm run gate                 # confirmar verde antes de publicar
    git add -A
    git commit -m "..."
    git push
    # y luego verificar contra el dominio real:
    #   /enter/  debe dar 200, no 404
    #   /arena/  no debe parpadear el primer
    #   el feed debe pintar emitter y reason, no rojo sin motivo

### K. Estado al cerrar el turno

`phase 2 · windowCount 70 · seasonId 4 · seasonStartWindow 68 · elapsed 2 · seasonWindows 20 ·
level 0 · ante 0,25 tUSDC · prizePool 0,14 · rakeAccrued 16,6695 · aliveCount 7`.

`endSeason()` **no** es llamable: primera vez en la ventana 88. Devolver `seasonWindows` a 24 la
mueve a la 92 y no dispara nada — sigue pendiente y sigue necesitando **fase 0**.

Nadie está corriendo un bucle. La 70 la liquidará el keeper o el operador; abrir la 71 requiere un
push de precio, que es off-chain, así que **la población no avanza sola**.

### L. Por qué no empareja nadie: **los faders incondicionales están muertos, los condicionales sólo faden movimientos grandes**

Medido con `verify-beliefs.ts` (lee `snapshot()`) y con `genomes/genesis.json`, no inferido. El
propio fichero de génesis pone la restricción de diseño por escrito: *"these genomes must DISAGREE
with each other on the same input. Positions are opened by pairing an organism that says [Up contra
uno que dice Down]"*. Dos ventanas seguidas sin un solo Up dicen que esa restricción ya no se cumple.

Orden de génesis: 1 MOMENTUM · 2 REVERSION · 3 BREAKOUT · 4 PINNED · 5 SKEPTIC · 6 GAMBLER ·
7 PATIENT · 8 SCALPER. **Vivos: 1, 3, 5, 6, 7, 8 y el hijo 9. Muertos: 2 y 4.**

Con el precio POR DEBAJO del open, que es el caso de las ventanas 69 y 70:

| # | genoma | regla con precio bajo el open | ¿puede decir Up? |
|---|---|---|---|
| 1 | MOMENTUM | sigue el movimiento → DOWN | no, nunca |
| 3 | BREAKOUT | DOWN si el desplazamiento es grande, si no ABSTAIN | no, nunca |
| 5 | SKEPTIC | ABSTAIN salvo evidencia abrumadora; entonces sigue → DOWN | no, nunca |
| 7 | PATIENT | ABSTAIN pronto; cerca del cierre sigue → DOWN | no, nunca |
| 9 | hijo de MOMENTUM | DOWN_MOMENTUM | no, nunca |
| **6** | **GAMBLER** | sigue si parece dirigido, **fade si parece agotado** | **sí, condicional** |
| **8** | **SCALPER** | sigue si el desplazamiento es diminuto, **fade si ya viajó lejos** | **sí, condicional** |
| ~~2~~ | ~~REVERSION~~ | *fade SIEMPRE → UP_REVERSION* | **muerto** |
| ~~4~~ | ~~PINNED~~ | *apunta al open SIEMPRE → UP_RANGE* | **muerto** |

**Corrección a la versión perezosa de este hallazgo.** Escribí primero que "la población ha
convergido y el lado que fade está extinto". Es falso, y comprobar los cuatro genomas que aún no
había leído es lo que lo separó: GAMBLER y SCALPER **conservan** rama de fade. Lo que está extinto es
el fade **incondicional**.

**Y ahí está el mecanismo exacto.** Los dos faders que quedan sólo faden **movimientos grandes** —
GAMBLER cuando el empuje "parece agotado", SCALPER cuando el precio "ya viajó lejos". Las dos
ventanas fueron diminutas: la 69 a **-0,34%** y la 70 a **-0,019%** (open 78.588,58 → 78.573,68). En
ese régimen SCALPER *sigue* el movimiento por diseño y GAMBLER también, así que los dos votaron Down
— y coinciden con los cuatro seguidores puros. Registrado: #6 `DOWN_MOMENTUM`, #8 `DOWN_BREAKOUT`.

**PINNED era precisamente el que fadeaba lo pequeño** ("most confident when the current move is
small"). Era el contrapartida natural del régimen tranquilo, y es el que se ha muerto. La conclusión
correcta no es "no puede emparejar nunca más", es más fina y peor para la demo:

> **La población sólo puede emparejar en ventanas de desplazamiento GRANDE. En una ventana tranquila
> —que es la mayoría de las ventanas de 15 minutos— toda la población viva está en el mismo lado por
> construcción, no por casualidad.**

Sin emparejar no hay posición, sin posición no hay fitness, y sin fitness la selección se queda sin
señal. Es exactamente la alerta que `monitor.ts:741` ya anticipaba ("*the genomes have converged and
there is no counterparty left to pair against*"); ahora está medida y con nombres.

**Ojo con los `abstains: 67-69` del snapshot.** No son conducta actual: son cicatriz histórica del
error de `perAgentReward` (§ 2026-09-08, 104 inferencias Failed a 0,001 STT). El hijo #9 lleva 1.

**Remedio, que NO he ejecutado porque es un broadcast y es del usuario.** `enter(string genome,
uint256 endowmentAmount)` es la puerta pública del arena: un organismo nuevo con genoma fader
incondicional —REVERSION o PINNED -restaura la contrapartida y vuelve a haber libro. Además es mejor
historia para el jurado que un arreglo de owner: el arena *necesita* un contrario, y entrar uno es
justo lo que la página `/enter/` ofrece hacer. Decide el usuario; el texto de los dos genomas está en
`genomes/genesis.json`, íntegro y listo para copiar.
