/**
 *  The subscription. Without this, reactivity never fires and the central claim is unproven.
 *
 *    npm run subscribe -- --discover            # measure the settlement event's topic0
 *    npm run subscribe -- --topic0 0x… --create # create the subscription
 *    npm run subscribe -- --status
 *    npm run subscribe -- --unsubscribe <id>
 *
 *  Everything else in this repo is written; this is the one step that has to be *measured*
 *  first. Two facts the subscription needs are not in any document we have:
 *
 *    1. **The settlement event's topic0.** No event signature is declared in the
 *       `IBinarySettlement` interface, and guessing one produces a subscription that
 *       silently never fires — the single worst failure mode here, because it is
 *       indistinguishable from reactivity not working at all. So `--discover` reads the
 *       live `BinarySettlement` singleton's own logs and reports which topic0 values it
 *       actually emits, with counts. The chain knows the answer.
 *
 *    2. **The callback selector.** `ISomniaEventHandler.onSomniaEvent` is a placeholder
 *       name, not a transcribed signature (see the note in `interfaces/ISomnia.sol`).
 *       `REACTIVITY_CALLBACK_SIG` exists so that when `@somnia-chain/reactivity` is
 *       installed and its real ABI read, the fix is one environment variable rather than
 *       a redeploy.
 *
 *  UNVERIFIED: the 11-parameter `subscribe(...)` signature itself was transcribed from
 *  docs and has not been executed. If it reverts with no reason data, the ABI is wrong —
 *  read it from `@somnia-chain/reactivity` before trying anything else, and do not
 *  interpret the failure as "reactivity does not work".
 *
 *  A COST YOU SHOULD KNOW ABOUT BEFORE RUNNING THIS. `BinarySettlement` is a shared
 *  singleton: every market on DreamDEX finalizes into it, so this subscription fires on
 *  other people's settlements too, and the gas payer pays for each one. `_handle` catches
 *  the resulting `settleAll()` revert and emits `ReactionFailed` rather than bubbling, so
 *  the failure is cheap and bounded — but it is not free. Watch the gas payer's balance
 *  for the first hour, and size `REACTIVITY_GAS_LIMIT` from a real receipt (below) rather
 *  than from optimism.
 */
import {
  explorerTx,
  log,
  manifest,
  num,
  flag,
  publicClient,
  selectionEngineAbi,
  wallet,
  warn,
  shannon,
  type Manifest,
} from "./lib/darwin.js";
import { parseAbi, parseAbiItem, toFunctionSelector, formatGwei, type Address, type Hex } from "viem";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REACTIVITY: Address = "0x0000000000000000000000000000000000000100";

const precompileAbi = parseAbi([
  "function subscribe(bytes32[4] topics, address emitter, address handler, address gasPayer, address refundee, bytes4 callbackSelector, uint64 gasLimit, uint64 maxFeePerGas, uint64 priorityFeePerGas, bool includeData, bool active) returns (uint256)",
  "function unsubscribe(uint256 subscriptionId)",
]);

const REACTED = parseAbiItem(
  "event Reacted(address indexed emitter, uint64 indexed window, uint256 blockNumber, bytes32 parentHash, bool viaReactivity)",
);

/** Placeholder until `@somnia-chain/reactivity` is installed and its ABI read. */
const CALLBACK_SIG = process.env.REACTIVITY_CALLBACK_SIG ?? "onSomniaEvent(address,bytes32[],bytes)";

/**
 *  Gas ceiling for each reactive callback.
 *
 *  10,000,000 is `DEFAULT_SUBSCRIPTION_OPTIONS.gasLimit` in `@somnia-chain/reactivity`, and
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
 *  The handler ignores the log payload entirely — it calls `settleAll()`, which reads the
 *  window's state from chain. Excluding the data makes every callback cheaper, and there
 *  are a lot of callbacks.
 */
const INCLUDE_DATA = flag("REACTIVITY_INCLUDE_DATA", false);

const ZERO32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
const CHUNK = 9_000n;

type Record_ = {
  chainId: number;
  subscriptionId: string;
  topic0: Hex;
  emitter: Address;
  handler: Address;
  callbackSig: string;
  callbackSelector: Hex;
  gasPayer: Address;
  gasLimit: string;
  includeData: boolean;
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
  for (let start = from; start <= latest; start += CHUNK) {
    const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
    const logs = await publicClient.getLogs({ address: m.settlement, fromBlock: start, toBlock: end });
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
  }

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
      console.log(`${t0}`);
      console.log(
        `    ${String(info.count).padStart(5)} occurrences · ${info.topics} topic(s) · ` +
          `${info.bytes} data bytes · newest block ${info.block}`,
      );
      console.log(`    ${explorerTx(info.sample)}`);
    }
    console.log("=============================================================");
    const top = ranked[0];
    if (top) {
      console.log("");
      log(`most frequent — open the sample above, confirm it is the resolution event, then:`);
      console.log(`    npm run subscribe -- --topic0 ${top[0]} --create`);
      warn("do NOT skip opening the sample. The most frequent event is not necessarily resolution.");
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
  for (let start = from; start <= latest; start += CHUNK) {
    const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
    const logs = await publicClient.getLogs({
      address: m.selectionEngine,
      event: REACTED,
      fromBlock: start,
      toBlock: end,
    });
    for (const l of logs) {
      if (newest === undefined || l.blockNumber! >= newest.block) {
        newest = { hash: l.transactionHash!, block: l.blockNumber! };
      }
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
  log(
    `if subscribe() reverts on funding, try --value: DreamDEX's own SpotStopOrderRegistry pays ` +
      `reactivity gas as msg.value == somiPaymentPerOrder(), which is the shipped precedent.`,
  );
}

/*//////////////////////////////////////////////////////////////
                             CREATE
//////////////////////////////////////////////////////////////*/

async function create(m: Manifest): Promise<void> {
  const topic0 = arg("--topic0");
  if (topic0 === undefined) {
    throw new Error("--create needs --topic0. Get it from: npm run subscribe -- --discover");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(topic0)) throw new Error(`--topic0 must be 32 bytes of hex, got ${topic0}`);

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

  const value = arg("--value");
  const escrow = value === undefined ? 0n : BigInt(Math.round(Number(value) * 1e18));

  console.log("");
  console.log("=== SUBSCRIPTION ============================================");
  console.log(`emitter          ${m.settlement}   (BinarySettlement — shared singleton)`);
  console.log(`handler          ${m.selectionEngine}`);
  console.log(`topic0           ${topic0}`);
  console.log(`topics 1-3       (zero — see the note below)`);
  console.log(`callback         ${CALLBACK_SIG}`);
  console.log(`selector         ${selector}   ${process.env.REACTIVITY_CALLBACK_SIG ? "(from env)" : "(UNVERIFIED default)"}`);
  console.log(`gas payer        ${account.address}`);
  console.log(`gas limit        ${GAS_LIMIT}`);
  console.log(`fee cap          ${formatGwei(maxFee)} gwei · priority ${formatGwei(priority)} gwei`);
  console.log(`include data     ${INCLUDE_DATA}`);
  if (escrow > 0n) console.log(`escrow           ${value} SOMI sent with the call`);
  console.log("=============================================================");

  // Topics 1-3 are left zero because the settlement singleton's indexed parameters are
  // unknown and a wrong filter is worse than a broad one: a broad subscription fires too
  // often and wastes gas, a wrong one never fires and looks like a broken feature.
  // Whether zero means "wildcard" or "must equal zero" is itself unverified — if the
  // subscription is created but never fires while --discover shows settlements landing,
  // that ambiguity is the first thing to suspect.
  warn("if this subscription never fires, suspect (1) the callback selector, (2) zero-topic wildcarding.");

  const gasPayer = (process.env.REACTIVITY_GAS_PAYER as Address | undefined) ?? account.address;
  const refundee = (process.env.REACTIVITY_REFUNDEE as Address | undefined) ?? account.address;

  const hash = await client.writeContract({
    address: REACTIVITY,
    abi: precompileAbi,
    functionName: "subscribe",
    args: [
      [topic0 as Hex, ZERO32, ZERO32, ZERO32],
      m.settlement,
      m.selectionEngine,
      gasPayer,
      refundee,
      selector,
      GAS_LIMIT,
      maxFee,
      priority,
      INCLUDE_DATA,
      true,
    ],
    value: escrow,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(
      `subscribe() reverted: ${explorerTx(hash)}\n` +
        `  The 11-parameter ABI in this script is transcribed from docs, not executed.\n` +
        `  Read the real one from @somnia-chain/reactivity before concluding anything else.`,
    );
  }

  // The returned subscriptionId is not readable from a receipt, so persist what is
  // knowable and let --status resolve the rest from the precompile's own logs.
  const record: Record_ = {
    chainId: m.chainId,
    subscriptionId: subscriptionIdFrom(receipt.logs) ?? "unknown",
    topic0: topic0 as Hex,
    emitter: m.settlement,
    handler: m.selectionEngine,
    callbackSig: CALLBACK_SIG,
    callbackSelector: selector,
    gasPayer,
    gasLimit: GAS_LIMIT.toString(),
    includeData: INCLUDE_DATA,
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
 *  Best-effort extraction of the subscription id from the creation receipt.
 *
 *  The precompile has no bytecode and no documented event, so it may well emit nothing.
 *  A missing id is recorded as "unknown" rather than guessed — `--unsubscribe` takes the
 *  id as an argument precisely so a failure here is not load-bearing.
 */
function subscriptionIdFrom(logs: readonly { address: string; data: string }[]): string | undefined {
  for (const l of logs) {
    if (l.address.toLowerCase() !== REACTIVITY.toLowerCase()) continue;
    if (l.data.length >= 66) return BigInt(`0x${l.data.slice(2, 66)}`).toString();
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
    console.log(`topic0           ${rec.topic0}`);
    console.log(`callback         ${rec.callbackSig} -> ${rec.callbackSelector}`);
    console.log(`created          block ${rec.createdAtBlock}, ${rec.createdAt}`);
    console.log(`                 ${explorerTx(rec.txHash)}`);
    const bal = await publicClient.getBalance({ address: rec.gasPayer as Address });
    console.log(`gas payer        ${rec.gasPayer} — ${Number(bal) / 1e18} SOMI`);
    if (bal === 0n) warn("the gas payer is empty. Callbacks are not being funded and reactivity is silently off.");
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
