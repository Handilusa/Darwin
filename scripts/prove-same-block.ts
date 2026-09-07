/**
 *  The one claim these contracts cannot prove about themselves.
 *
 *    npm run prove
 *    npm run prove -- --lookback 200000
 *
 *  Somnia's reactivity precompile inserts a synthetic transaction in the SAME BLOCK as a
 *  matching log. This project's central technical claim is that a market settling and an
 *  organism dying are therefore the same event, with no keeper, cron, bot or server in
 *  between. `forge test` cannot check that — the precompile does not exist on chain ids
 *  31337/1337, not "reverts" but is absent — so the assertion has to be made against the
 *  live chain, and this is where it is made.
 *
 *  It is also the honesty gate for the pitch. While the population is being settled by
 *  `SelectionEngine.poke()`, the true claim is the weaker one: "selection is on-chain and
 *  atomic with redemption." Only a `Reacted` event with `viaReactivity == true`, sharing a
 *  block with a real `BinarySettlement` log, licenses "no keeper anywhere in the causal
 *  chain." If this script fails, the narration changes — not the script.
 */
import { manifest, publicClient, log, warn, shannon, type Manifest } from "./lib/darwin.js";
import { scanRange } from "./lib/logscan.js";
import { decodeEventLog, parseAbiItem, toEventSelector, type Address, type Hex } from "viem";

const REACTED = parseAbiItem(
  "event Reacted(address indexed emitter, uint64 indexed window, uint256 blockNumber, bytes32 parentHash, bool viaReactivity)",
);

/*
 *  The settlement event — the FINALIZE one, T_A in `docs/SESSION_CHECKPOINT.md` §2.8.
 *
 *  This used to be unknown, and its absence is why `references()` below fell back to
 *  scanning a log's raw hex for a 32-byte word. With the signature in hand the correlation
 *  can be an exact decode of an indexed field instead of a substring search — which matters,
 *  because the substring version would also match an unrelated event that merely happened
 *  to contain our pool address somewhere in its payload.
 *
 *  Note it is keyed by `marketKey`, not `marketId`. Matching on our marketId can therefore
 *  NEVER succeed against this event; `pool` (topic2) is the field that ties a settlement to
 *  this population.
 *
 *  THE LAST FIELD IS A PAYOUT VECTOR, AND UNTIL 2026-09-06 THIS SAID `uint8 winningOutcome`
 *  — copied from `binarySettlementEventsAbi` in `@somnia-chain/markets-sdk@0.28.1`, which is
 *  stale against the deployed singleton. See the long note in `subscribe.ts`, which carries
 *  the same constant and the two checks (measured topic0 `0xb1884334…`, 256-byte data) that
 *  fix this shape as the live one.
 *
 *  THE CONSEQUENCE HERE WAS A SILENT DOWNGRADE OF THIS SCRIPT'S OWN VERDICT, which is worse
 *  than a failure. A topic0 that never matches means `references()` can never take its
 *  `"decoded"` branch, so every correlation fell through to the raw hex scan and the run
 *  printed "correlated only by RAW HEX" — the weak claim — on a block that in fact satisfied
 *  the strong one.
 */
const MARKET_FINALIZED = parseAbiItem(
  "event MarketFinalized(uint256 indexed marketKey, address indexed pool, uint64 nonce, address collateralToken, uint256 netBacking, bool voided, uint256[] payoutNumerators)",
);
const MARKET_FINALIZED_TOPIC0 = toEventSelector(MARKET_FINALIZED);

/**
 *  Used to close a hole the naive version of this script had.
 *
 *  `BinarySettlement` is a shared singleton — every market on DreamDEX finalizes into it.
 *  So "a settlement log exists in the same block as the reaction" is a weaker statement
 *  than it looks: it could be somebody else's market settling while ours happened to be
 *  resolvable. `WindowOpened` records the marketId and pool this population actually
 *  committed to for a given window, both recoverable from the window number alone, which
 *  makes the correlation checkable without knowing the settlement event's signature.
 */
const WINDOW_OPENED = parseAbiItem(
  "event WindowOpened(uint64 indexed window, bytes32 indexed marketId, address pool, uint256 openPrice)",
);

/**
 *  Block paging now lives in `lib/logscan.ts` — see `LOG_SPAN` there for the measurement.
 *
 *  This file used to own a `const CHUNK`, first as `9_000n` (nine times over dream-rpc's real
 *  cap, which is what `scan`'s own comment below was written to prevent and did not) and then
 *  as a corrected `1_000n` copied into three scripts. The shared helper shrinks on refusal,
 *  retries transient failures, and has a self-test that runs with no chain
 *  (`npx tsx scripts/lib/logscan.ts`).
 */

type Reaction = {
  blockNumber: bigint;
  txHash: Hex;
  window: bigint;
  recordedBlock: bigint;
  viaReactivity: boolean;
};

async function main(): Promise<void> {
  const m = manifest();
  const lookback = BigInt(arg("--lookback") ?? "100000");

  const latest = await publicClient.getBlockNumber();
  const floor = BigInt(m.deployedAtBlock);
  const from = latest - lookback > floor ? latest - lookback : floor;

  log(`scanning blocks ${from}..${latest} for SelectionEngine.Reacted (${m.selectionEngine})`);
  const reactions = await scan(m, from, latest);

  if (reactions.length === 0) {
    fail(
      "no Reacted event at all in range.\n" +
        "  The population has never been settled — not by reactivity and not by poke().\n" +
        "  Start the cadence before trying to prove anything about it.",
    );
    return;
  }

  const reactive = reactions.filter((r) => r.viaReactivity);
  const manual = reactions.length - reactive.length;
  log(`found ${reactions.length} reaction(s): ${reactive.length} via reactivity, ${manual} via poke()`);

  const latestReactive = reactive.at(-1);
  if (!latestReactive) {
    fail(
      `every settlement so far came through SelectionEngine.poke().\n` +
        `  That is a working system, but the honest claim is the weaker one:\n` +
        `    "selection is on-chain and atomic with redemption"\n` +
        `  NOT "no keeper anywhere in the causal chain".\n` +
        `  Wire the 0x0100 subscription, set CADENCE_USE_REACTIVITY=true, and run this again.`,
    );
    return;
  }

  await verify(m, latestReactive);
}

/*//////////////////////////////////////////////////////////////
                           THE ASSERTION
//////////////////////////////////////////////////////////////*/

async function verify(m: Manifest, r: Reaction): Promise<void> {
  // Every log the settlement contract emitted in the very same block.
  const settlementLogs = await publicClient.getLogs({
    address: m.settlement,
    fromBlock: r.blockNumber,
    toBlock: r.blockNumber,
  });

  const block = await publicClient.getBlock({ blockNumber: r.blockNumber });
  const opened = await windowIdentity(m, r);

  console.log("");
  console.log("=== SAME-BLOCK PROOF ========================================");
  console.log(`block            ${r.blockNumber}  (${new Date(Number(block.timestamp) * 1000).toISOString()})`);
  console.log(`window           #${r.window}`);
  if (opened) {
    console.log(`market           ${opened.marketId}`);
    console.log(`pool             ${opened.pool}`);
  }
  console.log(`reaction tx      ${r.txHash}`);
  console.log(`                 ${tx(r.txHash)}`);
  for (const l of settlementLogs) {
    console.log(`settlement tx    ${l.transactionHash}`);
    console.log(`                 ${tx(l.transactionHash!)}`);
  }
  console.log("=============================================================");

  const problems: string[] = [];

  if (settlementLogs.length === 0) {
    problems.push(
      `BinarySettlement (${m.settlement}) emitted nothing in block ${r.blockNumber}.\n` +
        `    The reaction fired, but not alongside a settlement — so this block does not\n` +
        `    demonstrate the claim. Either the subscription is filtered on the wrong\n` +
        `    emitter, or this reaction was triggered by an unrelated log.`,
    );
  }

  // THE CORRELATION. Without this the assertion is satisfiable by coincidence.
  if (opened && settlementLogs.length > 0) {
    const matches = settlementLogs.map((l) => references(l, opened)).filter((k): k is MatchKind => k !== undefined);
    const decoded = matches.filter((k) => k === "decoded").length;
    const raw = matches.length - decoded;

    if (matches.length === 0) {
      problems.push(
        `a settlement landed in block ${r.blockNumber}, but none of the ${settlementLogs.length} log(s)\n` +
          `    reference this population's pool (${opened.pool}).\n` +
          `    BinarySettlement is a shared singleton, so this is somebody else's market settling\n` +
          `    while ours happened to be resolvable — a coincidence, not the claim. Selection still\n` +
          `    ran on-chain, but it did not run in the block our window resolved in.`,
      );
    } else if (decoded > 0) {
      log(
        `correlated EXACTLY: ${decoded} of ${settlementLogs.length} log(s) are MarketFinalized with ` +
          `pool == ${opened.pool}`,
      );
    } else {
      // Every match came from the hex scan. Worth saying out loud: it is a real
      // correlation, but a weaker one, and the reason is that no log in this block carried
      // the MarketFinalized topic0 this script knows about.
      warn(
        `correlated only by RAW HEX: ${raw} of ${settlementLogs.length} log(s) contain our pool or\n` +
          `  marketId somewhere in their topics/data, but none of them is the MarketFinalized\n` +
          `  signature this script expects (${MARKET_FINALIZED_TOPIC0}).\n` +
          `  Either BinarySettlement's ABI has changed since 2026-08-29, or the matching log is a\n` +
          `  different settlement event. The block-sharing is real; treat the correlation as\n` +
          `  suggestive and re-derive the event before leaning on it in the pitch.`,
      );
    }
  } else if (!opened && settlementLogs.length > 0) {
    warn(
      `could not locate WindowOpened for window #${r.window}, so the settlement in this block\n` +
        `  could not be tied to this population's own market. The block-sharing below is real;\n` +
        `  the correlation is unchecked. Widen --lookback, or use an archive RPC.`,
    );
  }

  // The contract records `block.number` at execution time; the log carries the block it
  // was mined in. They can only differ if something is very wrong with the reader.
  if (r.recordedBlock !== r.blockNumber) {
    problems.push(`Reacted recorded block ${r.recordedBlock} but was mined in ${r.blockNumber}`);
  }

  const sameTx = settlementLogs.some((l) => l.transactionHash === r.txHash);
  if (settlementLogs.length > 0) {
    log(
      sameTx
        ? "reaction shares the settlement TRANSACTION (stronger than required)"
        : "reaction is a separate transaction in the same BLOCK — exactly the documented behaviour",
    );
  }

  if (problems.length > 0) {
    fail(problems.join("\n  "));
    return;
  }

  console.log("");
  console.log("PASS — a market settled and an organism was judged in the same block,");
  console.log("       with no keeper in between. The strong claim is licensed.");
}

type WindowIdentity = { marketId: Hex; pool: Address };

/**
 *  What market this population was actually committed to in the reacted window.
 *
 *  Searched backwards from the reaction, in chunks, because `WindowOpened` was emitted at
 *  the start of the same window and is therefore close by — and because a full-range
 *  filtered query is the kind of request public RPCs refuse.
 */
async function windowIdentity(m: Manifest, r: Reaction): Promise<WindowIdentity | undefined> {
  const floor = BigInt(m.deployedAtBlock);

  // Backward, and it STOPS at the first page that carries a hit — `WindowOpened` for this
  // window was emitted just before the reaction, so reading further back is pure waste.
  // `onPage` returning true is what preserves that; without it this becomes a full sweep of
  // every block since deployment.
  const logs = await scanRange(
    floor,
    r.blockNumber,
    (pageFrom, pageTo) =>
      publicClient.getLogs({
        address: m.population,
        event: WINDOW_OPENED,
        args: { window: r.window },
        fromBlock: pageFrom,
        toBlock: pageTo,
      }),
    {
      direction: "backward",
      // dream-rpc IGNORES the `topics` filter, so `args: { window }` above may have narrowed
      // nothing and a page can be full of OTHER windows' logs. Stopping on `rows.length > 0`
      // would therefore stop on a page with no match in it at all; the predicate has to be the
      // same client-side check the filter below applies.
      onPage: (rows) => rows.some((l) => l.args.window === r.window),
      onShrink: (at, span, reason) =>
        warn(`RPC refused the block range at ${at}; retrying with ${span}-block pages (${reason})`),
    },
  );

  const hit = logs.filter((l) => l.args.window === r.window).at(-1);
  if (hit) return { marketId: hit.args.marketId!, pool: hit.args.pool! };
  return undefined;
}

/**
 *  Does this log mention our pool?
 *
 *  Two tiers, and the difference is reported rather than flattened, because they license
 *  different statements:
 *
 *    "decoded"  — the log IS `MarketFinalized` and its indexed `pool` equals ours. Exact.
 *    "raw"      — the log is something else, and the 32-byte word our pool (or marketId)
 *                 would occupy appears somewhere in its topics or data. Suggestive only:
 *                 an unrelated event carrying our pool address in its payload matches too.
 *
 *  The raw tier is kept rather than deleted because the singleton could be upgraded and
 *  start emitting a signature this script does not know, and silently reporting "no
 *  correlation" in that case would be worse than reporting a weaker one.
 */
type MatchKind = "decoded" | "raw";

function references(l: { topics: readonly Hex[]; data: Hex }, w: WindowIdentity): MatchKind | undefined {
  if (l.topics[0] === MARKET_FINALIZED_TOPIC0) {
    try {
      const decoded = decodeEventLog({
        abi: [MARKET_FINALIZED],
        topics: l.topics as [Hex, ...Hex[]],
        data: l.data,
      });
      return decoded.args.pool.toLowerCase() === w.pool.toLowerCase() ? "decoded" : undefined;
    } catch {
      // A MarketFinalized topic0 that will not decode means the ABI has drifted. Fall
      // through to the raw scan rather than dropping the log.
    }
  }

  const haystack = (l.topics.join("") + l.data).toLowerCase().replaceAll("0x", "");
  const marketId = w.marketId.slice(2).toLowerCase();
  const pool = w.pool.slice(2).toLowerCase();
  return haystack.includes(marketId) || haystack.includes(pool) ? "raw" : undefined;
}

/*//////////////////////////////////////////////////////////////
                             PLUMBING
//////////////////////////////////////////////////////////////*/

/** Paged by `scanRange`, because public RPCs cap `eth_getLogs` ranges and Somnia's blocks are fast. */
async function scan(m: Manifest, from: bigint, to: bigint): Promise<Reaction[]> {
  // The whole range, no early exit: `main` counts reactive against manual and takes the LAST
  // reactive one, so a partial scan would misreport both.
  const logs = await scanRange(
    from,
    to,
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

  const out: Reaction[] = logs.map((l) => ({
    blockNumber: l.blockNumber!,
    txHash: l.transactionHash!,
    window: l.args.window ?? 0n,
    recordedBlock: l.args.blockNumber ?? 0n,
    viaReactivity: l.args.viaReactivity ?? false,
  }));
  out.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
  return out;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const tx = (hash: string) => `${shannon.blockExplorers.default.url}/tx/${hash}`;

function fail(message: string): void {
  console.error("");
  console.error(`FAIL — ${message}`);
  console.error("");
  process.exitCode = 1;
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
