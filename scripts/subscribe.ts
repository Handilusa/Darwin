/**
 *  The subscription. Without this, reactivity never fires and the central claim is unproven.
 *
 *    npm run subscribe -- --discover            # cross-check the settlement topic0 on chain
 *    npm run subscribe -- --create              # create the subscription
 *    npm run subscribe -- --status
 *    npm run subscribe -- --unsubscribe <id>
 *
 *  RESOLVED 2026-08-29 — this file used to open by saying two facts it needed were in no
 *  document we had. Both were, in fact, in `node_modules`, and both are now read from the
 *  installed SDKs rather than guessed:
 *
 *    1. **The settlement event.** `binarySettlementEventsAbi` in
 *       `@somnia-chain/markets-sdk@0.28.1` declares, and states that it mirrors
 *       `IBinarySettlement` exactly:
 *
 *           MarketFinalized(uint256 indexed marketKey, address indexed pool, uint64 nonce,
 *                           address collateralToken, uint256 netBacking, bool voided,
 *                           uint8 winningOutcome)
 *
 *       So topic0 is derived, not discovered, and `--topic0` is now an override rather than
 *       a requirement. `--discover` is kept as a CROSS-CHECK: if the derived topic0 does not
 *       appear in the singleton's recent logs, something is wrong and it is better to find
 *       out before creating a subscription than after.
 *
 *    2. **The callback selector.** `SomniaEventHandlerABI` in
 *       `@somnia-chain/reactivity@0.2.1` declares `onEvent(address,bytes32[],bytes)`.
 *       `SelectionEngine.onEvent` now matches it, and `Darwin.t.sol` pins the signature so
 *       a rename cannot silently break the callback.
 *
 *  The `subscribe(...)` ABI was ALSO wrong, and wrong in a way no amount of retrying would
 *  have fixed: it is not an 11-parameter function, it is a ONE-ARGUMENT function taking an
 *  11-field struct, so the old selector did not exist on the precompile. There is no
 *  `gasPayer`, no `refundee`, no `includeData` and no `active` — those were invented. The
 *  subscription's OWNER (this wallet) funds every callback from its own balance, and the
 *  SDK refuses to create a subscription while that balance is under 32 SOMI.
 *
 *  `subscribe` is nonpayable, so `--value` was not merely unnecessary, it could not work.
 *  DreamDEX's `SpotStopOrderRegistry` funding-by-msg.value precedent applies to its own
 *  contract, not to the precompile.
 *
 *  A COST YOU SHOULD KNOW ABOUT BEFORE RUNNING THIS. `BinarySettlement` is a shared
 *  singleton: every market on DreamDEX finalizes into it, so this subscription fires on
 *  other people's settlements too, and the owner pays for each one. `_handle` catches the
 *  resulting `settleAll()` revert and emits `ReactionFailed` rather than bubbling, so the
 *  failure is cheap and bounded — but it is not free.
 *
 *  The obvious narrowing is to filter on `pool` (topic2), and it is deliberately NOT the
 *  default. Pools are RECYCLED across windows — that is why nothing in this repo caches
 *  `activePool` — so a subscription pinned to today's pool stops matching the moment the
 *  population is moved onto another one, and stops matching SILENTLY. A subscription that
 *  fires too often costs gas; one that has quietly stopped firing costs the entire claim.
 *  `--pool <addr>` is available for a run where the pool is known to be fixed, and it warns.
 *
 *  What IS on by default is `isCoalesced`, which collapses several matching logs in one
 *  block into a single callback. That is safe here for a specific reason: the handler
 *  ignores the log payload entirely and calls `settleAll()`, which reads window state from
 *  chain. Nothing is lost by being told "at least one settlement happened" instead of being
 *  told once per settlement. Pass `--no-coalesced` to turn it off.
 *
 *  Watch the owner's balance for the first hour, and size `REACTIVITY_GAS_LIMIT` from a real
 *  receipt (below) rather than from optimism.
 */
import {
  explorerTx,
  log,
  manifest,
  num,
  publicClient,
  selectionEngineAbi,
  wallet,
  warn,
  shannon,
  type Manifest,
} from "./lib/darwin.js";
import { scanRange } from "./lib/logscan.js";
import {
  parseAbi,
  parseAbiItem,
  toFunctionSelector,
  toEventSelector,
  formatEther,
  formatGwei,
  padHex,
  type Address,
  type Hex,
} from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REACTIVITY: Address = "0x0000000000000000000000000000000000000100";

/*
 *  VERIFIED against `SomniaReactivityPrecompileABI` in `@somnia-chain/reactivity@0.2.1`.
 *
 *  ONE struct argument, not eleven parameters. Field order is load-bearing and the fee
 *  fields are uint64. Getting this wrong does not produce a helpful revert — it produces a
 *  call to a selector the precompile does not implement.
 */
const precompileAbi = parseAbi([
  "struct SubscriptionData { bytes32[4] eventTopics; address origin; address caller; address emitter; address handlerContractAddress; bytes4 handlerFunctionSelector; uint64 priorityFeePerGas; uint64 maxFeePerGas; uint64 gasLimit; bool isGuaranteed; bool isCoalesced; }",
  "function subscribe(SubscriptionData subscriptionData) returns (uint256 subscriptionId)",
  "function unsubscribe(uint256 subscriptionId)",
  "function getSubscriptionInfo(uint256 subscriptionId) view returns (SubscriptionData subscriptionData, address owner)",
]);

/*
 *  The event the subscription filters on — the FINALIZE event, T_A in
 *  `docs/SESSION_CHECKPOINT.md` §2.8, not the redeem event a subscription would trigger on
 *  our own redemption with.
 *
 *  `pool` is indexed, so it is topic2 — which is what lets this subscription narrow from
 *  "every settlement on DreamDEX" to "settlements of our pool", and what lets
 *  `prove-same-block.ts` correlate rather than coincide. Note the key is `marketKey`, NOT
 *  `marketId`: searching this log for a marketId will never match.
 *
 *  THE LAST FIELD IS A PAYOUT VECTOR, AND UNTIL 2026-09-06 THIS SAID `uint8 winningOutcome`.
 *  That is `binarySettlementEventsAbi`'s declaration in `@somnia-chain/markets-sdk@0.28.1`,
 *  and it is STALE against the deployed singleton — the same v2 -> v3 migration the SDK
 *  documents on the market side ("BinaryMarket emits the payout VECTOR + denominator, not a
 *  single indexed winner",
 *  `node_modules/@somnia-chain/markets-sdk/src/eventsAbi.ts:403`) also landed on the
 *  settlement contract, and
 *  the settlement ABI was never updated to follow. Two independent checks that this shape is
 *  the live one rather than a plausible guess:
 *
 *    - It hashes to `0xb1884334…0ada178`, which is the topic0 MEASURED off Shannon and
 *      recorded in §2.8's table. The `uint8` version hashes to `0xaa0d535f…` and has never
 *      appeared on chain. Since `toEventSelector` is the whole derivation below, a stale
 *      signature here does not narrow the filter — it makes it match NOTHING, and a
 *      subscription that can never fire looks exactly like one that simply has not yet.
 *    - ABI-encoding the non-indexed tail `(uint64, address, uint256, bool, uint256[])` with a
 *      two-outcome vector gives 256 bytes, which is §2.8's measured data size. The `uint8`
 *      shape encodes to 160.
 *
 *  `IDreamDEX.sol` carries the same stale v2 declaration; nothing subscribes off that copy.
 */
const MARKET_FINALIZED = parseAbiItem(
  "event MarketFinalized(uint256 indexed marketKey, address indexed pool, uint64 nonce, address collateralToken, uint256 netBacking, bool voided, uint256[] payoutNumerators)",
);
const SETTLEMENT_TOPIC0 = toEventSelector(MARKET_FINALIZED);

const REACTED = parseAbiItem(
  "event Reacted(address indexed emitter, uint64 indexed window, uint256 blockNumber, bytes32 parentHash, bool viaReactivity)",
);

/**
 *  The selector the precompile invokes on the handler.
 *
 *  VERIFIED against `SomniaEventHandlerABI` in `@somnia-chain/reactivity@0.2.1`.
 *  `REACTIVITY_CALLBACK_SIG` is retained only as an escape hatch against a future SDK
 *  change; it should not normally be set, and setting it wrongly is the one way left to
 *  build a subscription that can never fire.
 */
const CALLBACK_SIG = process.env.REACTIVITY_CALLBACK_SIG ?? "onEvent(address,bytes32[],bytes)";

/**
 *  Gas ceiling for each reactive callback.
 *
 *  10,000,000 is `defaultSubscriptionOptions.gasLimit` in `@somnia-chain/reactivity`, and
 *  the precompile's hard ceiling is 200,000,000 — so at eight organisms this population is
 *  nowhere near gas-bound and there is no reason to economise. Which matters, because a
 *  callback that runs out of gas emits NOTHING, not even the `ReactionFailed` that the catch
 *  block would otherwise log, and that is indistinguishable from a subscription which never
 *  fired at all. `--discover` prints the measured basis from a real receipt.
 */
const GAS_LIMIT = BigInt(num("REACTIVITY_GAS_LIMIT", 10_000_000));
const GAS_LIMIT_CEILING = 200_000_000n;

/** A non-zero maxFeePerGas must sit at least this far above priorityFeePerGas. */
const FEE_SEPARATION = 6_000_000_000n; // 6 gwei

/**
 *  The SDK refuses to create a subscription while the owner holds less than this, because
 *  the owner funds every callback. Checked here too: failing before broadcasting is much
 *  cheaper than failing after.
 */
const MIN_OWNER_BALANCE = 32_000_000_000_000_000_000n; // 32 SOMI

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

/**
 *  Block paging now lives in `lib/logscan.ts` — see `LOG_SPAN` there for the measurement.
 *
 *  This file used to own a `const CHUNK`, first as `9_000n` (nine times over dream-rpc's real
 *  cap) and then as a corrected `1_000n` copied into three scripts. The correction was right
 *  and still insufficient: one hardcoded number is one RPC's cap, nothing had ever executed
 *  the paging arithmetic, and a single dropped packet threw away a 200,000-block sweep. The
 *  shared helper shrinks on refusal, retries transient failures, and has a self-test that runs
 *  with no chain (`npx tsx scripts/lib/logscan.ts`).
 */

type Record_ = {
  chainId: number;
  subscriptionId: string;
  topic0: Hex;
  poolFilter: Hex;
  emitter: Address;
  handler: Address;
  callbackSig: string;
  callbackSelector: Hex;
  /** The subscription owner, which is also the account that funds every callback. */
  owner: Address;
  gasLimit: string;
  isGuaranteed: boolean;
  isCoalesced: boolean;
  createdAtBlock: string;
  createdAt: string;
  txHash: Hex;
};

async function main(): Promise<void> {
  const m = manifest();

  if (process.argv.includes("--discover")) return await discover(m);
  if (process.argv.includes("--status")) return await status(m);

  const unsub = arg("--unsubscribe");
  if (unsub !== undefined) return await unsubscribe(BigInt(unsub));

  if (process.argv.includes("--create")) return await create(m);

  log("nothing to do. Start with:  npm run subscribe -- --discover");
}

/*//////////////////////////////////////////////////////////////
                        MEASURE, THEN ACT
//////////////////////////////////////////////////////////////*/

/**
 *  Read the two numbers the subscription needs off the live chain.
 *
 *  Deliberately makes no transaction: it is safe to run against a production population
 *  and safe to run repeatedly while working out what the settlement event is called.
 */
async function discover(m: Manifest): Promise<void> {
  const lookback = BigInt(arg("--lookback") ?? "200000");
  const latest = await publicClient.getBlockNumber();
  const floor = 0n;
  const from = latest - lookback > floor ? latest - lookback : floor;

  log(`scanning ${from}..${latest} for logs emitted by BinarySettlement (${m.settlement})`);

  const seen = new Map<Hex, { count: number; sample: Hex; topics: number; bytes: number; block: bigint }>();
  // Deliberately UNFILTERED — no `event`, because this is a topic0 census and the whole point
  // is to see the values we did not predict. Paging and retry belong to `scanRange`; the tally
  // is folded in through `onPage` (never returning true — this one reads the whole range), so
  // the accumulated return value is redundant here and ignored.
  await scanRange(
    from,
    latest,
    (pageFrom, pageTo) =>
      publicClient.getLogs({ address: m.settlement, fromBlock: pageFrom, toBlock: pageTo }),
    {
      onShrink: (at, span, reason) =>
        warn(`RPC refused the block range at ${at}; retrying with ${span}-block pages (${reason})`),
      onPage: (logs) => {
        for (const l of logs) {
          const t0 = (l.topics[0] ?? ZERO32) as Hex;
          const prev = seen.get(t0);
          if (prev === undefined) {
            seen.set(t0, {
              count: 1,
              sample: l.transactionHash!,
              topics: l.topics.length,
              bytes: (l.data.length - 2) / 2,
              block: l.blockNumber!,
            });
          } else {
            prev.count++;
            // Keep the newest sample: recent windows are the ones worth inspecting.
            if (l.blockNumber! >= prev.block) {
              prev.sample = l.transactionHash!;
              prev.block = l.blockNumber!;
            }
          }
        }
      },
    },
  );

  console.log("");
  if (seen.size === 0) {
    warn(
      `BinarySettlement emitted nothing in ${lookback} blocks.\n` +
        `  Either the address in the manifest is wrong, or no market has finalized recently.\n` +
        `  Widen the range: npm run subscribe -- --discover --lookback 1000000`,
    );
  } else {
    console.log("=== TOPIC0 VALUES ACTUALLY EMITTED ==========================");
    const ranked = [...seen].sort((a, b) => b[1].count - a[1].count);
    for (const [t0, info] of ranked) {
      console.log(`${t0}${t0 === SETTLEMENT_TOPIC0 ? "   <-- MarketFinalized (the one we subscribe to)" : ""}`);
      console.log(
        `    ${String(info.count).padStart(5)} occurrences · ${info.topics} topic(s) · ` +
          `${info.bytes} data bytes · newest block ${info.block}`,
      );
      console.log(`    ${explorerTx(info.sample)}`);
    }
    console.log("=============================================================");

    /*
     *  The cross-check that gives this command its remaining purpose. topic0 is DERIVED from
     *  the signature above, so the question is no longer "which one is it" but "is the
     *  derived one real". If MarketFinalized is absent from a healthy lookback window, then
     *  either the singleton was upgraded, the manifest points at the wrong address, or the
     *  signature has drifted again — and every one of those produces a subscription that is
     *  created successfully and never fires.
     *
     *  THIS CHECK CAUGHT NOTHING FOR A WEEK, AND IT SHOULD HAVE. The derived topic0 was
     *  `binarySettlementEventsAbi`'s stale v2 hash, which appears in zero blocks of this
     *  emitter's logs, so this branch would have printed FAILED on the first run — the
     *  reason it never did is that nobody could run it: `CHUNK` was 9_000n, nine times over
     *  dream-rpc's 1,000-block `eth_getLogs` cap, so every invocation died on its first
     *  request. An instrument behind a broken instrument is not an instrument.
     */
    if (seen.has(SETTLEMENT_TOPIC0)) {
      const info = seen.get(SETTLEMENT_TOPIC0)!;
      log(`cross-check PASSED: MarketFinalized ${SETTLEMENT_TOPIC0} seen ${info.count}x, newest block ${info.block}`);
      // topic0 + the two indexed parameters (marketKey, pool) = 3.
      const expectedTopics = MARKET_FINALIZED.inputs.filter((i) => "indexed" in i && i.indexed).length + 1;
      console.log(`    expect ${expectedTopics} topics; this sample has ${info.topics}`);
      log(`ready:  npm run subscribe -- --create`);
    } else {
      warn(
        `cross-check FAILED: the derived MarketFinalized topic0\n` +
          `    ${SETTLEMENT_TOPIC0}\n` +
          `  does NOT appear in ${lookback} blocks of this emitter's logs. Do not subscribe yet.\n` +
          `  Either no market finalized in the range (widen --lookback), or the ABI has drifted.\n` +
          `  If a value above is provably the resolution event, override it: --topic0 0x… --create`,
      );
    }
  }

  await gasBasis(m);
  await fees();
}

/**
 *  Size `REACTIVITY_GAS_LIMIT` from something that really happened.
 *
 *  Every successful `poke()` already executed the exact code path a callback will
 *  execute, so its `gasUsed` is the honest basis. Nothing else here is a guess this
 *  cheap to eliminate.
 */
async function gasBasis(m: Manifest): Promise<void> {
  const latest = await publicClient.getBlockNumber();
  const from = latest - 200_000n > 0n ? latest - 200_000n : 0n;

  let newest: { hash: Hex; block: bigint } | undefined;
  // Forward walk over the whole range — the newest `Reacted` is what we want, and a forward
  // scan with no early exit is the simplest thing that finds it.
  const reacted = await scanRange(
    from,
    latest,
    (pageFrom, pageTo) =>
      publicClient.getLogs({
        address: m.selectionEngine,
        event: REACTED,
        fromBlock: pageFrom,
        toBlock: pageTo,
      }),
    {
      onShrink: (at, span, reason) =>
        warn(`RPC refused the block range at ${at}; retrying with ${span}-block pages (${reason})`),
    },
  );
  for (const l of reacted) {
    if (newest === undefined || l.blockNumber! >= newest.block) {
      newest = { hash: l.transactionHash!, block: l.blockNumber! };
    }
  }

  console.log("");
  if (newest === undefined) {
    log(`no Reacted event yet, so no measured gas basis. Using REACTIVITY_GAS_LIMIT=${GAS_LIMIT}.`);
    log(`  Run the cadence through one settlement first, then re-run --discover to measure it.`);
    return;
  }

  const receipt = await publicClient.getTransactionReceipt({ hash: newest.hash });
  const used = receipt.gasUsed;
  const floor = (used * 25n) / 10n;
  log(`measured: the last settlement used ${used} gas (${explorerTx(newest.hash)})`);
  log(`  minimum safe REACTIVITY_GAS_LIMIT=${floor}  (2.5x — the population grows as it breeds)`);
  log(`  current ${GAS_LIMIT}. The precompile's ceiling is 200,000,000, so headroom is free.`);
  if (GAS_LIMIT < floor) {
    warn(`current REACTIVITY_GAS_LIMIT=${GAS_LIMIT} is BELOW the measured floor. Raise it before subscribing.`);
  }
}

async function fees(): Promise<void> {
  const price = await publicClient.getGasPrice();
  const scaled = price * 4n;
  const cap = scaled > 20_000_000_000n ? scaled : 20_000_000_000n;
  log(`current gas price ${formatGwei(price)} gwei · subscription cap ${formatGwei(cap)} gwei, priority 0`);

  /*
   *  `subscribe` is NONPAYABLE — verified from the precompile ABI — so callbacks cannot be
   *  pre-funded with an escrow and the `--value` flag this script used to carry could never
   *  have worked. DreamDEX's `SpotStopOrderRegistry` does take `msg.value ==
   *  somiPaymentPerOrder()`, but that is its own contract's accounting, not the precompile's.
   *  Funding here means one thing only: keep the OWNER's balance up.
   */
  const { account } = wallet();
  const balance = await publicClient.getBalance({ address: account.address });
  log(`subscription owner ${account.address} holds ${formatEther(balance)} SOMI`);
  if (balance < MIN_OWNER_BALANCE) {
    warn(
      `below the ${formatEther(MIN_OWNER_BALANCE)} SOMI required to create a subscription. ` +
        `The owner funds every callback directly; there is no gas payer and no escrow.`,
    );
  }
}

/*//////////////////////////////////////////////////////////////
                             CREATE
//////////////////////////////////////////////////////////////*/

async function create(m: Manifest): Promise<void> {
  // Derived, not discovered — see the note on MARKET_FINALIZED. `--topic0` remains as an
  // override for the case where the singleton is upgraded and the SDK has not caught up.
  const override = arg("--topic0");
  if (override !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(override)) {
    throw new Error(`--topic0 must be 32 bytes of hex, got ${override}`);
  }
  const topic0 = (override ?? SETTLEMENT_TOPIC0) as Hex;

  const { account, client } = wallet();
  const selector = toFunctionSelector(CALLBACK_SIG);

  if (GAS_LIMIT <= 0n || GAS_LIMIT > GAS_LIMIT_CEILING) {
    throw new Error(`REACTIVITY_GAS_LIMIT must be in (0, ${GAS_LIMIT_CEILING}], got ${GAS_LIMIT}`);
  }

  /*
   *  Fees, per the two documented rules rather than per intuition.
   *
   *  `@somnia-chain/reactivity` defaults to `priorityFeePerGas: 0n, maxFeePerGas: 20 gwei`,
   *  and a NON-ZERO maxFeePerGas must sit at least 6 gwei above priorityFeePerGas. The
   *  obvious "4x the current gas price, priority = gas price" pairing quietly breaks that
   *  second rule whenever the chain is cheap — at a 1 gwei base it leaves only 3 gwei of
   *  separation and the subscription is rejected. So: priority 0, and a floor of 20 gwei on
   *  the cap. A fee cap that is too high costs nothing unless it is used; a cap that is too
   *  low means callbacks are never included, which reads as "reactivity doesn't work".
   */
  const price = await publicClient.getGasPrice();
  const priority = 0n;
  const floor = 20_000_000_000n;
  const scaled = price * 4n;
  const maxFee = scaled > floor ? scaled : floor;
  if (maxFee < priority + FEE_SEPARATION) {
    throw new Error(`maxFeePerGas ${maxFee} must be >= priorityFeePerGas + 6 gwei`);
  }

  /*
   *  The owner funds every callback out of its own balance, and the SDK rejects a
   *  subscription created below 32 SOMI. Check before broadcasting: an owner that passes
   *  now and drains later switches reactivity off SILENTLY, which is why `--status` reports
   *  this balance every time rather than only on creation.
   */
  const balance = await publicClient.getBalance({ address: account.address });
  if (balance < MIN_OWNER_BALANCE) {
    throw new Error(
      `subscription owner ${account.address} holds ${formatEther(balance)} STT; ` +
        `at least ${formatEther(MIN_OWNER_BALANCE)} is required.\n` +
        `  The owner pays for every callback — there is no separate gas payer.\n` +
        `  No script can top this up: npm run fund moves value INTO the population, and this\n` +
        `  is the signer's own native. It comes from the faucet or the Somnia team.`,
    );
  }

  // Opt-in, and hazardous — pools are recycled across windows, so this can go stale and
  // stop matching without any error surfacing. See the file header.
  const poolArg = arg("--pool");
  if (poolArg !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(poolArg)) {
    throw new Error(`--pool must be a 20-byte address, got ${poolArg}`);
  }
  const poolFilter = poolArg === undefined ? ZERO32 : padHex(poolArg as Hex, { size: 32 });
  if (poolArg !== undefined) {
    warn(
      `filtering on pool ${poolArg} (topic2). Pools are RECYCLED across windows — if the ` +
        `population moves pool, this subscription stops firing and says nothing. Re-check with --status.`,
    );
  }

  const isCoalesced = !process.argv.includes("--no-coalesced");
  const isGuaranteed = process.argv.includes("--guaranteed");

  console.log("");
  console.log("=== SUBSCRIPTION ============================================");
  console.log(`emitter          ${m.settlement}   (BinarySettlement — shared singleton)`);
  console.log(`handler          ${m.selectionEngine}`);
  console.log(`topic0           ${topic0}   ${override ? "(override)" : "(derived from the measured signature)"}`);
  console.log(
    `  MarketFinalized(uint256 indexed marketKey, address indexed pool, uint64, address, uint256, bool, uint256[])`,
  );
  console.log(`topic2 (pool)    ${poolFilter === ZERO32 ? "any — see the recycling note" : poolArg}`);
  console.log(`callback         ${CALLBACK_SIG}`);
  console.log(`selector         ${selector}   ${process.env.REACTIVITY_CALLBACK_SIG ? "(from env — OVERRIDE)" : "(verified against reactivity SDK)"}`);
  console.log(`owner / payer    ${account.address} — ${formatEther(balance)} SOMI`);
  console.log(`gas limit        ${GAS_LIMIT}`);
  console.log(`fee cap          ${formatGwei(maxFee)} gwei · priority ${formatGwei(priority)} gwei`);
  console.log(`coalesced        ${isCoalesced}   guaranteed ${isGuaranteed}`);
  console.log("=============================================================");

  const hash = await client.writeContract({
    address: REACTIVITY,
    abi: precompileAbi,
    functionName: "subscribe",
    args: [
      {
        eventTopics: [topic0, ZERO32, poolFilter, ZERO32],
        origin: "0x0000000000000000000000000000000000000000",
        // Reserved by the protocol and not used in event matching. The SDK always sends
        // zero; sending anything else is untested.
        caller: "0x0000000000000000000000000000000000000000",
        emitter: m.settlement,
        handlerContractAddress: m.selectionEngine,
        handlerFunctionSelector: selector,
        priorityFeePerGas: priority,
        maxFeePerGas: maxFee,
        gasLimit: GAS_LIMIT,
        isGuaranteed,
        isCoalesced,
      },
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(
      `subscribe() reverted: ${explorerTx(hash)}\n` +
        `  The struct ABI here is read from @somnia-chain/reactivity@0.2.1, so a revert is\n` +
        `  more likely to be a rejected argument than a wrong signature. Check, in order:\n` +
        `    · owner balance >= 32 SOMI (it was ${formatEther(balance)} a moment ago)\n` +
        `    · gasLimit in (0, 200000000]                    — it is ${GAS_LIMIT}\n` +
        `    · maxFeePerGas == 0 or >= priority + 6 gwei      — it is ${formatGwei(maxFee)} gwei\n` +
        `    · at least one of (topics, origin, emitter) non-zero`,
    );
  }

  // The returned subscriptionId is not readable from a receipt, so persist what is
  // knowable and let --status resolve the rest from the precompile's own logs.
  const record: Record_ = {
    chainId: m.chainId,
    subscriptionId: subscriptionIdFrom(receipt.logs, account.address) ?? "unknown",
    topic0,
    poolFilter,
    emitter: m.settlement,
    handler: m.selectionEngine,
    callbackSig: CALLBACK_SIG,
    callbackSelector: selector,
    owner: account.address,
    gasLimit: GAS_LIMIT.toString(),
    isGuaranteed,
    isCoalesced,
    createdAtBlock: receipt.blockNumber.toString(),
    createdAt: new Date().toISOString(),
    txHash: hash,
  };
  writeFileSync(recordPath(m.chainId), `${JSON.stringify(record, null, 2)}\n`);

  console.log("");
  log(`subscribed · ${explorerTx(hash)}`);
  log(`recorded in ${recordPath(m.chainId)}`);
  console.log("");
  console.log("NEXT — in this order, and do not skip the middle step:");
  console.log("  1. CADENCE_USE_REACTIVITY=true npm run cadence");
  console.log("  2. wait for one settlement, then: npm run prove");
  console.log("  3. only once prove passes: SelectionEngine.disableFallback()");
  console.log("");
  console.log("Until step 2 passes, the honest claim stays the weaker one. See the README.");
}

/**
 *  Extraction of the subscription id from the creation receipt.
 *
 *  MEASURED FROM A REAL RECEIPT, because the first version of this guessed and was wrong
 *  in a way that disabled the cross-check below. The precompile emits exactly one log:
 *
 *      address 0x0000000000000000000000000000000000000100
 *      topic0  0xc338904b2660b1919e916da6c5c8a16f6410eb1930a1e41b3d22649c85041640
 *      topic1  the SUBSCRIPTION ID          <-- here
 *      topic2  the owner
 *      data    448 bytes: the SubscriptionData struct, whose first word is the
 *              subscribed event's topic0
 *
 *  This function used to read `data[0:32]`, so it recorded MarketFinalized's topic0 —
 *  0xb1884334…ada178, a perfectly plausible-looking 78-digit id — as the subscription id.
 *  `getSubscriptionInfo` then reverted on every `--status`, and the warning that fires on
 *  that revert is the same one a genuinely unsubscribed subscription produces. So the check
 *  that exists to catch a replaced or torn-down subscription cried wolf 100% of the time
 *  and could never have caught anything. Verified against tx
 *  0x945feb5e9c5e1adde6d756c9f2ab3c90c1c9cd6740c37ef85eaf97d3c2cbfb72: topic1 is 0xfc149e
 *  = 16520350, and `getSubscriptionInfo(16520350)` returns this deployment's real emitter,
 *  handler and selector.
 *
 *  The owner in topic2 is asserted rather than trusted: a log from this precompile whose
 *  owner is not the signer is not this subscription's creation event, and taking its topic1
 *  would record someone else's id.
 */
function subscriptionIdFrom(
  logs: readonly { address: string; topics?: readonly string[] }[],
  owner: Address,
): string | undefined {
  const ownerWord = padHex(owner.toLowerCase() as Hex, { size: 32 });
  for (const l of logs) {
    if (l.address.toLowerCase() !== REACTIVITY.toLowerCase()) continue;
    const topics = l.topics ?? [];
    if (topics.length < 3) continue;
    if ((topics[2] ?? "").toLowerCase() !== ownerWord) continue;
    return BigInt(topics[1] as Hex).toString();
  }
  return undefined;
}

/*//////////////////////////////////////////////////////////////
                          STATUS / TEARDOWN
//////////////////////////////////////////////////////////////*/

async function status(m: Manifest): Promise<void> {
  const rec = readRecord(m.chainId);
  const fallbackOpen = await publicClient.readContract({
    address: m.selectionEngine,
    abi: selectionEngineAbi,
    functionName: "fallbackEnabled",
  });

  console.log("");
  if (rec === undefined) {
    log("no subscription recorded — reactivity has never been wired on this deployment.");
  } else {
    console.log(`subscription     ${rec.subscriptionId}`);
    console.log(`topic0           ${rec.topic0}${rec.topic0 === SETTLEMENT_TOPIC0 ? "" : "   (NOT MarketFinalized — override in use)"}`);
    console.log(`topic2 (pool)    ${rec.poolFilter === ZERO32 ? "any" : rec.poolFilter}`);
    console.log(`callback         ${rec.callbackSig} -> ${rec.callbackSelector}`);
    console.log(`coalesced        ${rec.isCoalesced}   guaranteed ${rec.isGuaranteed}`);
    console.log(`created          block ${rec.createdAtBlock}, ${rec.createdAt}`);
    console.log(`                 ${explorerTx(rec.txHash)}`);

    /*
     *  The owner funds every callback — there is no separate gas payer — so this balance
     *  IS the reactivity kill switch. An owner that drains switches reactivity off with no
     *  error, no event and no log anywhere, which is why it is checked on every --status
     *  rather than only at creation.
     */
    const bal = await publicClient.getBalance({ address: rec.owner as Address });
    console.log(`owner / payer    ${rec.owner} — ${formatEther(bal)} SOMI`);
    if (bal === 0n) {
      warn("the owner is empty. Callbacks are not being funded and reactivity is silently off.");
    } else if (bal < MIN_OWNER_BALANCE) {
      warn(
        `owner holds ${formatEther(bal)} SOMI, below the ${formatEther(MIN_OWNER_BALANCE)} the SDK ` +
          `requires to CREATE a subscription. Whether an existing one keeps firing below that ` +
          `threshold is not something this repo has measured — top it up rather than find out.`,
      );
    }

    // Cross-check the on-chain subscription against what was recorded. A subscription that
    // was replaced or unsubscribed leaves the local file looking healthy.
    if (rec.subscriptionId !== "unknown") {
      try {
        const [onChain, owner] = await publicClient.readContract({
          address: REACTIVITY,
          abi: precompileAbi,
          functionName: "getSubscriptionInfo",
          args: [BigInt(rec.subscriptionId)],
        });
        console.log(`on-chain owner   ${owner}`);
        if (onChain.handlerFunctionSelector !== rec.callbackSelector) {
          warn(
            `on-chain selector ${onChain.handlerFunctionSelector} does not match the recorded ` +
              `${rec.callbackSelector}. The subscription will call the wrong function or none.`,
          );
        }
        if (onChain.handlerContractAddress.toLowerCase() !== rec.handler.toLowerCase()) {
          warn(`on-chain handler ${onChain.handlerContractAddress} does not match ${rec.handler}.`);
        }
      } catch {
        warn(
          `subscription ${rec.subscriptionId} could not be read back from the precompile. ` +
            `It may have been unsubscribed, or the id was not recoverable from the receipt.`,
        );
      }
    }
  }

  console.log(`fallback poke()  ${fallbackOpen ? "OPEN — weaker claim applies" : "CLOSED — keeperless"}`);
  console.log(`explorer         ${shannon.blockExplorers.default.url}/address/${m.selectionEngine}`);
  console.log("");
  log("run `npm run prove` for the assertion that actually licenses the strong claim.");
}

async function unsubscribe(id: bigint): Promise<void> {
  const { client } = wallet();
  log(`unsubscribing ${id}`);
  const hash = await client.writeContract({
    address: REACTIVITY,
    abi: precompileAbi,
    functionName: "unsubscribe",
    args: [id],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted: ${explorerTx(hash)}`);
  log(`unsubscribed · ${explorerTx(hash)}`);
  warn(`SelectionEngine.poke() is now the only settlement path. Make sure the cadence has it enabled.`);
}

/*//////////////////////////////////////////////////////////////
                             PLUMBING
//////////////////////////////////////////////////////////////*/

const recordPath = (chainId: number) =>
  resolve(process.cwd(), "contracts", "deployments", `${chainId}.reactivity.json`);

function readRecord(chainId: number): Record_ | undefined {
  try {
    return JSON.parse(readFileSync(recordPath(chainId), "utf8")) as Record_;
  } catch {
    return undefined;
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
