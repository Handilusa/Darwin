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
import { decodeEventLog, encodeAbiParameters, parseAbiItem, toEventSelector, type Address, type Hex } from "viem";

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

  if (reactive.length === 0) {
    fail(
      `every settlement so far came through SelectionEngine.poke().\n` +
        `  That is a working system, but the honest claim is the weaker one:\n` +
        `    "selection is on-chain and atomic with redemption"\n` +
        `  NOT "no keeper anywhere in the causal chain".\n` +
        `  Wire the 0x0100 subscription, set CADENCE_USE_REACTIVITY=true, and run this again.`,
    );
    return;
  }

  /*
   *  EVERY reactive reaction is a candidate, newest first — not just the last one.
   *
   *  This used to be `reactive.at(-1)`, and that single line was enough to make the script
   *  unable to pass on a working system. The correlation depends on `WindowOpened` for the
   *  reacted window still being *findable*, and `windowIdentity` searches backwards from the
   *  reaction over a bounded range; on a 15-minute cadence over Somnia's sub-second blocks
   *  the newest reaction is frequently the one whose window is hardest to pin down, and a
   *  `--lookback` that comfortably covers ten older reactions can miss the newest one's
   *  `WindowOpened` by a few thousand blocks. Judging only the newest therefore reported
   *  "the correlation is unchecked" while nine provable blocks sat in range, unexamined.
   *
   *  So: iterate, keep the strongest verdict, and stop early on an exact decode because
   *  nothing older can beat it. Bounded by `--max-candidates` since each candidate costs a
   *  `getLogs`, a `getBlock` and a paged backward scan.
   */
  const budget = Number(arg("--max-candidates") ?? "25");
  const newestFirst = [...reactive].reverse();
  const considered = newestFirst.slice(0, budget);
  if (considered.length < newestFirst.length) {
    log(`judging the newest ${considered.length} of ${newestFirst.length} reactive reaction(s) (--max-candidates)`);
  }

  let best: { evidence: Evidence; verdict: Verdict } | undefined;
  for (const r of considered) {
    const evidence = await gather(m, r);
    const verdict = judge(evidence);
    if (!best || verdict.rank > best.verdict.rank) best = { evidence, verdict };
    if (verdict.rank === RANK.decoded) break;
    log(`window #${r.window} in block ${r.blockNumber}: ${verdict.headline} — looking further back`);
  }

  // `considered` is non-empty (reactive.length > 0 and budget >= 1), so `best` is set. The
  // guard is here because a `--max-candidates 0` would otherwise report a pass on nothing.
  if (!best) {
    fail(`--max-candidates ${budget} judged no reaction at all. Pass a positive number.`);
    return;
  }

  report(best.evidence, best.verdict);
}

/*//////////////////////////////////////////////////////////////
                           THE ASSERTION
//////////////////////////////////////////////////////////////*/

/*
 *  Reading, judging and printing are three functions rather than one, and the split is what
 *  makes iterating over candidates possible at all.
 *
 *  The single `verify()` this replaced printed the "=== SAME-BLOCK PROOF ===" banner and
 *  called `fail()` itself, so calling it in a loop would have printed one failed proof per
 *  candidate and set a non-zero exit code on the first weak one — the opposite of picking the
 *  best. `judge` is now pure over `Evidence`: no RPC, no printing, no `process.exitCode`,
 *  which is also what lets `--self-test` exercise every verdict with no chain.
 */
type Evidence = {
  reaction: Reaction;
  settlementLogs: readonly { topics: readonly Hex[]; data: Hex; transactionHash: Hex | null }[];
  timestamp: bigint;
  opened: WindowIdentity | undefined;
};

/** Ordered weakest to strongest; `main` keeps the highest and stops early on `decoded`. */
const RANK = { broken: 0, unchecked: 1, raw: 2, decoded: 3 } as const;

type Verdict = {
  rank: number;
  headline: string;
  /** Non-empty means FAIL. Each entry is already indented for `join("\n  ")`. */
  problems: string[];
  /** Printed as `log()`/`warn()` lines above the verdict. */
  notes: { level: "log" | "warn"; text: string }[];
};

async function gather(m: Manifest, r: Reaction): Promise<Evidence> {
  // Every log the settlement contract emitted in the very same block.
  const settlementLogs = await publicClient.getLogs({
    address: m.settlement,
    fromBlock: r.blockNumber,
    toBlock: r.blockNumber,
  });

  const block = await publicClient.getBlock({ blockNumber: r.blockNumber });
  const opened = await windowIdentity(m, r);

  return {
    reaction: r,
    settlementLogs: settlementLogs.map((l) => ({
      topics: l.topics,
      data: l.data,
      transactionHash: l.transactionHash,
    })),
    timestamp: block.timestamp,
    opened,
  };
}

function report(e: Evidence, v: Verdict): void {
  const { reaction: r, settlementLogs, opened } = e;

  console.log("");
  console.log("=== SAME-BLOCK PROOF ========================================");
  console.log(`block            ${r.blockNumber}  (${new Date(Number(e.timestamp) * 1000).toISOString()})`);
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

  for (const n of v.notes) (n.level === "warn" ? warn : log)(n.text);

  if (v.problems.length > 0) {
    fail(v.problems.join("\n  "));
    return;
  }

  console.log("");
  console.log("PASS — a market settled and an organism was judged in the same block,");
  console.log("       with no keeper in between. The strong claim is licensed.");
}

/**
 *  The verdict. Pure: no RPC, no printing, no exit code — see the note above `Evidence`.
 */
function judge(e: Evidence): Verdict {
  const { reaction: r, settlementLogs, opened } = e;
  const problems: string[] = [];
  const notes: Verdict["notes"] = [];
  let rank: number = RANK.broken;

  if (settlementLogs.length === 0) {
    problems.push(
      `BinarySettlement emitted nothing in block ${r.blockNumber}.\n` +
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
      rank = RANK.decoded;
      notes.push({
        level: "log",
        text:
          `correlated EXACTLY: ${decoded} of ${settlementLogs.length} log(s) are MarketFinalized with ` +
          `pool == ${opened.pool}`,
      });
    } else {
      // Every match came from the hex scan. Worth saying out loud: it is a real
      // correlation, but a weaker one, and the reason is that no log in this block carried
      // the MarketFinalized topic0 this script knows about.
      rank = RANK.raw;
      notes.push({
        level: "warn",
        text:
          `correlated only by RAW HEX: ${raw} of ${settlementLogs.length} log(s) contain our pool or\n` +
          `  marketId somewhere in their topics/data, but none of them is the MarketFinalized\n` +
          `  signature this script expects (${MARKET_FINALIZED_TOPIC0}).\n` +
          `  Either BinarySettlement's ABI has changed since 2026-08-29, or the matching log is a\n` +
          `  different settlement event. The block-sharing is real; treat the correlation as\n` +
          `  suggestive and re-derive the event before leaning on it in the pitch.`,
      });
    }
  } else if (!opened && settlementLogs.length > 0) {
    /*
     *  B3, and it used to be a `warn` that let the run print PASS.
     *
     *  Without `WindowOpened` there is no way to tell this population's own market settling
     *  from the shared singleton finalizing somebody else's in the same block — which is
     *  precisely the coincidence `windowIdentity` exists to rule out. A `warn` here meant the
     *  script's strongest output was reachable with its central check skipped, so the honesty
     *  gate could be satisfied by an unprovable block. It is a problem now: the run FAILS and
     *  says what to widen.
     */
    rank = RANK.unchecked;
    problems.push(
      `could not locate WindowOpened for window #${r.window}, so the settlement in block\n` +
        `    ${r.blockNumber} cannot be tied to this population's own market. The block-sharing is\n` +
        `    real, but BinarySettlement is a shared singleton: without the marketId and pool this\n` +
        `    population committed to, a coincidence is indistinguishable from the claim.\n` +
        `    Widen --lookback, raise --max-candidates, or use an archive RPC.`,
    );
  }

  // The contract records `block.number` at execution time; the log carries the block it
  // was mined in. They can only differ if something is very wrong with the reader.
  if (r.recordedBlock !== r.blockNumber) {
    problems.push(`Reacted recorded block ${r.recordedBlock} but was mined in ${r.blockNumber}`);
  }

  if (settlementLogs.length > 0) {
    const sameTx = settlementLogs.some((l) => l.transactionHash === r.txHash);
    notes.push({
      level: "log",
      text: sameTx
        ? "reaction shares the settlement TRANSACTION (stronger than required)"
        : "reaction is a separate transaction in the same BLOCK — exactly the documented behaviour",
    });
  }

  const headline =
    problems.length === 0
      ? rank === RANK.decoded
        ? "correlated exactly"
        : "correlated by raw hex only"
      : rank === RANK.unchecked
        ? "WindowOpened not found, correlation unchecked"
        : settlementLogs.length === 0
          ? "no settlement in the block"
          : "settlement in the block belongs to another market";

  return { rank, headline, problems, notes };
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

/*//////////////////////////////////////////////////////////////
                            SELF-TEST
//////////////////////////////////////////////////////////////*/

/**
 *  `npm run prove:selftest` — exercises `judge` with no RPC, no key and no deploy.
 *
 *  It exists because both bugs this file was carrying were bugs in the VERDICT, not in the
 *  reading: `reactive.at(-1)` judged one candidate out of many, and the missing-`WindowOpened`
 *  branch was a `warn` that still printed PASS. Neither is visible in a passing run, and
 *  neither could have been caught by any check that needed a live reaction to exist.
 *
 *  Two of the twelve are CONTROLS — cases where a weaker `judge` passes and the real one must
 *  not. Delete them and the suite goes back to being unable to fail. All four perturbations
 *  below were RUN, not reasoned about, and each hit exactly one row:
 *
 *    | perturbation                                     | row that failed                    |
 *    |--------------------------------------------------|------------------------------------|
 *    | B3 branch back to a `warn` (notes, not problems)  | "a missing WindowOpened FAILS"      |
 *    | `RANK.raw` -> `RANK.decoded`                      | "raw ranks below decoded"          |
 *    | drop the `recordedBlock` check                    | "a lying recordedBlock FAILS"      |
 *    | `RANK.unchecked` -> `RANK.broken`                 | "...and still ranks above a broken" |
 *
 *  The last two are the controls earning their place: perturbation 3 leaves the correlation
 *  exact and only a `problems`-blind `main` would ship it, and perturbation 4 is invisible to
 *  every row except the one that compares the two weak ranks against each other.
 */
function selfTest(): void {
  let pass = 0;
  const failures: string[] = [];

  const check = (name: string, ok: boolean): void => {
    if (ok) pass++;
    else failures.push(name);
  };

  const POOL = "0x1111111111111111111111111111111111111111" as Address;
  const MARKET = `0x${"22".repeat(32)}` as Hex;
  const OTHER_POOL = "0x3333333333333333333333333333333333333333" as Address;
  const TXH = `0x${"44".repeat(32)}` as Hex;

  const reaction = (over: Partial<Reaction> = {}): Reaction => ({
    blockNumber: 1000n,
    txHash: TXH,
    window: 68n,
    recordedBlock: 1000n,
    viaReactivity: true,
    ...over,
  });

  const word = (a: string): string => a.slice(2).toLowerCase().padStart(64, "0");

  /*
   *  A real `MarketFinalized`: topic0, indexed marketKey, indexed pool, and the FIVE
   *  non-indexed fields ABI-encoded in `data`.
   *
   *  The data has to be encoded properly, and the first draft of this helper is the reason
   *  the note above says every case was confirmed by perturbation. It passed 32 zero bytes,
   *  `decodeEventLog` threw on the short payload, `references` fell through to the raw hex
   *  tier exactly as it is designed to — and tests 1 and 2 both silently measured the RAW
   *  path while claiming to compare it against the decoded one. A self-test whose fixture is
   *  malformed reports on a branch it never reached.
   */
  const finalized = (pool: Address) => ({
    topics: [MARKET_FINALIZED_TOPIC0, `0x${word("0x09")}`, `0x${word(pool)}`] as readonly Hex[],
    data: encodeAbiParameters(
      [
        { type: "uint64" },
        { type: "address" },
        { type: "uint256" },
        { type: "bool" },
        { type: "uint256[]" },
      ],
      [7n, "0x6666666666666666666666666666666666666666", 1_000_000n, false, [1n, 0n]],
    ),
    transactionHash: `0x${"55".repeat(32)}` as Hex,
  });

  /** Some other event that merely happens to carry our pool in its data. The raw tier. */
  const mentionsPool = (pool: Address) => ({
    topics: [`0x${"99".repeat(32)}`] as readonly Hex[],
    data: `0x${word(pool)}` as Hex,
    transactionHash: `0x${"55".repeat(32)}` as Hex,
  });

  const ev = (over: Partial<Evidence> = {}): Evidence => ({
    reaction: reaction(),
    settlementLogs: [finalized(POOL)],
    timestamp: 1_780_000_000n,
    opened: { marketId: MARKET, pool: POOL },
    ...over,
  });

  // 1. The happy path: an exact decode is a pass and the top rank.
  const exact = judge(ev());
  check("an exact MarketFinalized decode PASSES", exact.problems.length === 0);
  check("an exact decode ranks `decoded`", exact.rank === RANK.decoded);

  // 2. Raw-hex correlation passes but must rank BELOW an exact decode, or `main`'s early
  //    exit would stop on it and never look for the provable block behind it.
  const rawOnly = judge(ev({ settlementLogs: [mentionsPool(POOL)] }));
  check("a raw-hex correlation still PASSES", rawOnly.problems.length === 0);
  check("raw ranks below decoded", rawOnly.rank < exact.rank);

  // 3. B3. The bug: this was a `warn`, so it printed PASS with the correlation skipped.
  const unchecked = judge(ev({ opened: undefined }));
  check("a missing WindowOpened FAILS", unchecked.problems.length > 0);

  // 3b. CONTROL for B3. A `warn`-shaped judge passes both 3 and this; only the pair
  //     separates them, because this case must go on ranking above an outright break.
  check("...and still ranks above a broken block", unchecked.rank > judge(ev({ settlementLogs: [] })).rank);

  // 4. Somebody else's market finalizing in our block is the coincidence, not the claim.
  check("another market's settlement FAILS", judge(ev({ settlementLogs: [finalized(OTHER_POOL)] })).problems.length > 0);

  // 5. No settlement at all in the block.
  check("an empty block FAILS", judge(ev({ settlementLogs: [] })).problems.length > 0);

  // 6. A lying `recordedBlock` fails even though the correlation is exact — which is the
  //    point: it is a reader/contract disagreement, not a weak correlation.
  const lying = judge(ev({ reaction: reaction({ recordedBlock: 999n }) }));
  check("a lying recordedBlock FAILS", lying.problems.length > 0);

  // 6b. CONTROL for 6. Its rank is still `decoded`, so a `main` that ranked without reading
  //     `problems` would pick this over a genuinely provable block and exit 0 on it.
  check("...while still ranking `decoded`", lying.rank === RANK.decoded);

  // 7. Same transaction is stronger than same block, and both pass.
  const sameTx = judge(
    ev({ settlementLogs: [{ ...finalized(POOL), transactionHash: TXH }] }),
  );
  check("a same-TRANSACTION settlement PASSES", sameTx.problems.length === 0);
  check(
    "...and says so",
    sameTx.notes.some((n) => n.text.includes("TRANSACTION")),
  );

  console.log("");
  if (failures.length === 0) {
    console.log(`prove self-test: ${pass}/${pass} PASS (no chain, no key)`);
    return;
  }
  console.error(`prove self-test: ${failures.length} FAILED of ${pass + failures.length}`);
  for (const f of failures) console.error(`  FAIL  ${f}`);
  process.exitCode = 1;
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main().catch((err) => {
    console.error("FATAL", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
