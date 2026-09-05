/**
 *  Every chain read the page makes. Nothing here touches the DOM.
 *
 *  Two decisions worth knowing before you edit this file.
 *
 *  NO MULTICALL. `Multicall3` may or may not be deployed on Shannon and this page cannot
 *  afford to find out the hard way, so batching is done at the JSON-RPC layer instead
 *  (`http(url, { batch: true })` folds concurrent `eth_call`s into one HTTP request). If the
 *  node refuses batches, `makeClient` is rebuilt unbatched and everything still works, just
 *  with more requests. That fallback is why `connect` exists rather than a bare client.
 *
 *  PARTIAL RESULTS ARE THE NORMAL CASE. `PushedPriceSource.currentWindow` REVERTS — with
 *  `NoWindow` before the first push and `StalePrice` once a push ages past `maxStaleness` —
 *  and both are ordinary states of a healthy deployment between cadence ticks. A reader that
 *  let one reverting call reject a `Promise.all` would blank the entire dashboard every time
 *  the price went stale, which is precisely when an operator most needs to look at it. So
 *  every group settles independently and reports its own failure.
 */

import {
  CHAIN_ID,
  DEFAULT_RPC,
  EXPLORER,
  FEED_LOOKBACK,
  LABELS_PATH,
  LOG_CHUNK,
  MANIFEST_PATH,
} from "../config.js";

let _viem = null;

/** viem is imported lazily so `?demo=1` never reaches the network. */
async function lib() {
  if (!_viem) _viem = await import("./viem.js");
  return _viem;
}

let _abi = null;

async function abis() {
  if (!_abi) _abi = await import("./abi.js");
  return _abi;
}

/*//////////////////////////////////////////////////////////////
                             CLIENT
//////////////////////////////////////////////////////////////*/

async function makeClient(rpc, batch) {
  const { createPublicClient, defineChain, http } = await lib();

  const shannon = defineChain({
    id: CHAIN_ID,
    name: "Somnia Shannon",
    nativeCurrency: { name: "Somnia", symbol: "STT", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
    blockExplorers: { default: { name: "Shannon Explorer", url: EXPLORER } },
  });

  return createPublicClient({
    chain: shannon,
    transport: batch
      ? http(rpc, { batch: { wait: 16 }, retryCount: 2, timeout: 20_000 })
      : http(rpc, { retryCount: 2, timeout: 20_000 }),
  });
}

/**
 *  Build a client and prove it works before the UI commits to it.
 *
 *  The probe is `getChainId` rather than `getBlockNumber` because a wrong-chain RPC is the
 *  failure most likely to look like success: every read would return plausible zeros against
 *  a contract that does not exist there.
 */
export async function connect(rpc = DEFAULT_RPC) {
  let batched = true;
  let client = await makeClient(rpc, true);

  let chainId;
  try {
    chainId = await client.getChainId();
  } catch (first) {
    // Could be a node that rejects JSON-RPC batches. Worth exactly one retry unbatched
    // before we call the endpoint dead.
    try {
      client = await makeClient(rpc, false);
      chainId = await client.getChainId();
      batched = false;
    } catch {
      throw new Error(`RPC ${rpc} did not answer eth_chainId: ${first?.shortMessage || first?.message || first}`);
    }
  }

  if (Number(chainId) !== CHAIN_ID) {
    throw new Error(`RPC ${rpc} is chain ${chainId}, expected ${CHAIN_ID} (Somnia Shannon).`);
  }

  return { client, batched, rpc };
}

/*//////////////////////////////////////////////////////////////
                      OPTIONAL LOCAL FILES
//////////////////////////////////////////////////////////////*/

/**
 *  The deploy manifest, if this page happens to be served from the repo root. Absent is the
 *  expected case, and it arrives in TWO shapes — which is why both guards below are
 *  load-bearing rather than one being belt-and-braces:
 *
 *    hosted standalone     a real 404, caught by `!res.ok`.
 *    under app's dev server  200 plus `index.html`. The deployments middleware hands a missing
 *                          file to `next()` and Vite's SPA html-fallback answers it
 *                          (`app/vite.config.js:121-141`), so `res.ok` is TRUE and the first
 *                          guard is bypassed. What catches this one is `res.json()` throwing
 *                          on `<!doctype html>`.
 *
 *  Either way it resolves to null rather than throwing. Delete either guard and one of the two
 *  environments starts reporting a deployed arena that isn't there.
 */
export async function manifestPopulation() {
  try {
    const res = await fetch(MANIFEST_PATH, { cache: "no-store" });
    if (!res.ok) return null;
    const m = await res.json();
    return typeof m?.population === "string" ? m.population : null;
  } catch {
    return null;
  }
}

/** id -> nickname, written by `Seed.s.sol`. Cosmetic; absence is never fatal. */
export async function organismLabels() {
  try {
    const res = await fetch(LABELS_PATH, { cache: "no-store" });
    if (!res.ok) return new Map();
    const parsed = await res.json();
    const rows = Array.isArray(parsed?.organisms) ? parsed.organisms : [];
    return new Map(rows.map((o) => [Number(o.id), String(o.name ?? "")]));
  } catch {
    return new Map();
  }
}

/*//////////////////////////////////////////////////////////////
                             READS
//////////////////////////////////////////////////////////////*/

/** Resolve a settled result, or a default plus the reason it failed. */
function got(settled, dflt) {
  return settled.status === "fulfilled" ? settled.value : dflt;
}

function why(settled) {
  if (settled.status === "fulfilled") return null;
  const e = settled.reason;
  return e?.shortMessage || e?.details || e?.message || String(e);
}

/**
 *  Walk an error's cause chain, bounded.
 *
 *  viem's `BaseError` has `.walk()` and this deliberately does not use it: a rejected
 *  `readContract` can also carry a plain `Error` from a transport that threw before viem wrapped
 *  anything, and a helper that works on both is worth more than one that assumes the happy shape.
 *  Bounded because a cause chain that loops would otherwise hang a paint.
 *
 *  Kept byte-for-byte in step with `app/src/lib/reads.js` on purpose — the two surfaces must not
 *  disagree about whether the same address holds a contract, and they only did because this file
 *  had no equivalent at all.
 */
function causes(err) {
  const out = [];
  for (let e = err, i = 0; e && i < 12; i++, e = e.cause) out.push(e);
  return out;
}

/**
 *  Did viem diagnose "there is no code at this address"?
 *
 *  A call to an address with no code returns `0x`, which surfaces as `AbiDecodingZeroDataError`
 *  and is re-thrown as `ContractFunctionZeroDataError` carrying *"returned no data (\"0x\")"*
 *  (`viem/utils/errors/getContractError.js:15-16`). A transport failure has no such cause anywhere
 *  in its chain. So the distinction is READ OFF THE ERROR, never inferred from a tally.
 */
function saysNoCode(err) {
  return causes(err).some(
    (e) => e?.name === "ContractFunctionZeroDataError" || /returned no data/i.test(e?.message ?? ""),
  );
}

/**
 *  What a batch of independently-settled reads actually proved.
 *
 *  Returns `"live"` if ANY read answered, else `"absent"` or `"unreachable"` — and those last two
 *  are not one verdict, because their remedies are opposites: one means the address is wrong and
 *  the visitor must change it, the other means the node did not answer and they must not touch the
 *  address at all. Guessing would send someone on a testnet hiccup off to edit a perfectly good
 *  address.
 *
 *  ANY read, not two named ones — see `discover`.
 *
 *  Exported for `test/smoke.mjs` only. It takes `Promise.allSettled` rows rather than a client, so
 *  the classifier can be tested with no network at all — which is the only way this file's verdict
 *  logic is reachable from Node, `discover` needing viem and therefore the CDN.
 */
export function readVerdict(settled) {
  const rows = Array.isArray(settled) ? settled : [];
  if (rows.length === 0) return "unreachable";
  const failures = rows.filter((s) => s?.status === "rejected");
  if (failures.length < rows.length) return "live";
  return failures.some((f) => saysNoCode(f.reason)) ? "absent" : "unreachable";
}

/**
 *  A thrown read verdict, tagged so the banner can say the right sentence.
 *
 *  `.kind` is what `errorBanner` branches on. Without it the page prints *"Cannot read the chain"*
 *  over an address that simply has no contract behind it — blaming the network for the one failure
 *  the network had nothing to do with.
 */
function readVerdictError(kind, message) {
  const e = new Error(message);
  e.kind = kind;
  return e;
}

/**
 *  Wiring and the constants that only change on an owner transaction. Read once per
 *  connection, not per poll.
 *
 *  `symbol` comes from the population rather than from config for the same reason the venue
 *  does: it is the string the price source is actually keyed by, and guessing "BTC" would
 *  make the price panel silently describe a different market than the organisms trade.
 */
export async function discover(client, population) {
  const { populationAbi, erc20Abi, venueAbi } = await abis();
  const base = { address: population, abi: populationAbi };

  const read = (functionName, args) => client.readContract({ ...base, functionName, args });

  // `breedStreak`, `breedSurplusBps` and `maxPopulation` belong HERE and not in `readState`: all
  // three move only under `setEconomics`, and polling them every ten seconds would spend three
  // calls a poll to re-learn a constant. They are what turn a per-organism `streak` from a number
  // into a fraction — without them the page can show 3 and never say 3 of what.
  const keys = [
    "symbol", "collateral", "priceSource", "venue", "selectionEngine",
    "marketsModule", "owner", "endowment", "metabolicCost", "minStake",
    "minEndowment", "cognitionEndowment", "requestDeposit", "baseAnte",
    "anteMultBps", "levelWindows", "seasonWindows", "rakeBps", "prizeShareBps",
    "breedStreak", "breedSurplusBps", "maxPopulation",
  ];

  const settled = await Promise.allSettled(keys.map((k) => read(k)));
  const out = {};
  const failures = {};
  keys.forEach((k, i) => {
    out[k] = got(settled[i], null);
    const reason = why(settled[i]);
    if (reason) failures[k] = reason;
  });

  /*
   *  A population that cannot answer a single one of these calls is not a population here — and
   *  saying so beats rendering a screen of dashes.
   *
   *  TWO THINGS ABOUT THIS TEST WERE WRONG UNTIL 2026-09-03, and both mattered.
   *
   *  It read `if (!out.collateral && !out.symbol)`, which is a TWO-READ threshold over
   *  twenty-two settled calls. Every other key was allowed to come back null on the reasoning
   *  that `readErrors` names it while the rest of the page stays live — but `symbol` and
   *  `collateral` were singled out to mean "no population", so a node that dropped exactly
   *  those two while answering the other twenty declared a live arena dead. The landing uses
   *  any-of-nine (`app/src/lib/reads.js`) and the two surfaces could therefore disagree about
   *  whether the same arena exists under partial RPC failure. Any-of-twenty-two here is the same
   *  rule: one answer is proof of a contract, and the rows that failed are named individually.
   *
   *  And it conflated ABSENT with UNREACHABLE. Every path out of it printed *"No Population at
   *  0x…"*, so an RPC outage accused the address and sent the visitor off to edit a correct one —
   *  the precise failure `reads.js` was written to avoid on the other surface. The verdict is now
   *  read off viem's error rather than off the failure count, and the two cases say opposite
   *  things because they need opposite actions.
   */
  const verdict = readVerdict(settled);
  if (verdict === "absent") {
    throw readVerdictError(
      "absent",
      `There is no Population at ${population} on chain ${CHAIN_ID}. All ${keys.length} reads came ` +
        `back empty, which is what an address with no contract behind it returns — check the address ` +
        `rather than the network. (${failures[keys[0]] || "returned no data"})`,
    );
  }
  if (verdict === "unreachable") {
    throw readVerdictError(
      "unreachable",
      `Chain ${CHAIN_ID} did not answer for ${population}. All ${keys.length} reads failed for ` +
        `transport reasons, so nothing has been learned about this address — leave it alone and ` +
        `retry. (${failures[keys[0]] || "no response"})`,
    );
  }

  // Collateral decimals decide every money number on the page. 6 is the Shannon tUSDC
  // value and the fallback, but it is read rather than assumed.
  let decimals = 6;
  let tokenSymbol = "tUSDC";
  if (out.collateral) {
    const t = await Promise.allSettled([
      client.readContract({ address: out.collateral, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: out.collateral, abi: erc20Abi, functionName: "symbol" }),
    ]);
    if (t[0].status === "fulfilled") decimals = Number(t[0].value);
    if (t[1].status === "fulfilled") tokenSymbol = t[1].value;
  }

  // `positionToken() == address(0)` is how an organism knows to skip the ERC-6909 push and
  // redeem directly, so it is also the honest way to name which settlement family is wired.
  let positionToken = null;
  if (out.venue) {
    const v = await Promise.allSettled([
      client.readContract({ address: out.venue, abi: venueAbi, functionName: "positionToken" }),
    ]);
    positionToken = got(v[0], null);
  }

  return { population, ...out, decimals, tokenSymbol, positionToken, failures };
}

/**
 *  Everything that moves. One call per poll for the population, one for the price window,
 *  one for the honesty switch — all settled independently.
 */
export async function readState(client, cfg) {
  const { populationAbi, priceSourceAbi, selectionEngineAbi } = await abis();
  const base = { address: cfg.population, abi: populationAbi };
  const read = (functionName, args) => client.readContract({ ...base, functionName, args });

  const keys = [
    "phase", "windowCount", "aliveCount", "prophetCount", "livingCount",
    "ante", "level", "seasonId", "seasonStartWindow",
    "rakeAccrued", "prizePool", "activeMarketId", "activePool",
  ];

  const [scalars, snap, window, fallback, block] = await Promise.all([
    Promise.allSettled(keys.map((k) => read(k))),
    Promise.allSettled([read("snapshot")]),
    cfg.priceSource && cfg.symbol
      ? Promise.allSettled([
          client.readContract({
            address: cfg.priceSource,
            abi: priceSourceAbi,
            functionName: "currentWindow",
            args: [cfg.symbol],
          }),
          client.readContract({
            address: cfg.priceSource,
            abi: priceSourceAbi,
            functionName: "rawWindow",
            args: [cfg.symbol],
          }),
        ])
      : Promise.resolve([]),
    cfg.selectionEngine
      ? Promise.allSettled([
          client.readContract({
            address: cfg.selectionEngine,
            abi: selectionEngineAbi,
            functionName: "fallbackEnabled",
          }),
        ])
      : Promise.resolve([]),
    Promise.allSettled([client.getBlock({ blockTag: "latest" })]),
  ]);

  const out = { at: Math.floor(Date.now() / 1000), errors: {} };
  keys.forEach((k, i) => {
    out[k] = got(scalars[i], null);
    const reason = why(scalars[i]);
    if (reason) out.errors[k] = reason;
  });

  out.organisms = got(snap[0], null);
  if (why(snap[0])) out.errors.snapshot = why(snap[0]);

  // The window is allowed to be missing. `NoWindow` before the first push and `StalePrice`
  // after `maxStaleness` are both ordinary, and the UI says which one it is.
  out.window = null;
  out.windowError = null;
  out.rawWindow = null;
  if (window.length) {
    if (window[0].status === "fulfilled") {
      const w = window[0].value;
      out.window = {
        marketId: w[0], pool: w[1], outcomeIdUp: w[2], outcomeIdDown: w[3],
        openPrice: w[4], lastPrice: w[5], priceDecimals: Number(w[6]),
        secondsRemaining: w[7], tradeable: w[8],
      };
    } else {
      out.windowError = why(window[0]);
    }
    out.rawWindow = got(window[1], null);
  }

  out.fallbackEnabled = fallback.length ? got(fallback[0], null) : null;

  const b = got(block[0], null);
  out.blockNumber = b?.number ?? null;
  out.blockTimestamp = b?.timestamp ?? null;

  return out;
}

/**
 *  The two strings the snapshot cannot carry, plus the live position.
 *
 *  Deliberately per-organism and on demand: sixteen genomes and sixteen paragraphs of model
 *  output would be tens of kilobytes on every poll, for text that only matters when somebody
 *  is actually reading one organism.
 */
export async function readOrganism(client, address) {
  const { prophetAbi } = await abis();
  const base = { address, abi: prophetAbi };
  const keys = [
    "systemPrompt", "lastReasoning", "entrant", "positionOpen",
    "currentStake", "currentQuantity", "currentMarketId", "currentOutcomeId",
    "pendingBeliefRequestId", "pendingMutationRequestId",
  ];
  const settled = await Promise.allSettled(
    keys.map((functionName) => client.readContract({ ...base, functionName })),
  );
  const out = { address, errors: {} };
  keys.forEach((k, i) => {
    out[k] = got(settled[i], null);
    const reason = why(settled[i]);
    if (reason) out.errors[k] = reason;
  });
  return out;
}

/*//////////////////////////////////////////////////////////////
                              LOGS
//////////////////////////////////////////////////////////////*/

function eventsOf(abi) {
  return abi.filter((item) => item.type === "event");
}

/**
 *  Scan backwards in chunks for the population's log stream and the organisms' own.
 *
 *  Backwards because the feed shows newest first and a bounded scan should spend its budget
 *  on the recent past. Chunked at `LOG_CHUNK` because public RPCs cap `eth_getLogs` ranges —
 *  the same reason and the same number as `prove-same-block.ts:60`.
 *
 *  Organism logs are fetched with an ADDRESS ARRAY rather than one request each: sixteen
 *  organisms would otherwise be sixteen scans per chunk.
 *
 *  The `SelectionEngine` is scanned too, and not for completeness: `Reacted(..., bool
 *  viaReactivity)` is the ONLY on-chain evidence for this project's central claim. Without it
 *  the honesty panel could only repeat an assertion; with it the page can show the block a
 *  reaction actually landed in and whether it came from the precompile or a keeper. A claim the
 *  UI can substantiate from the log stream is worth more than one it merely prints.
 */
export async function readFeed(client, cfg, { organisms = [], lookback = FEED_LOOKBACK, latest } = {}) {
  const { populationAbi, prophetAbi, selectionEngineAbi } = await abis();

  const head = latest ?? (await client.getBlockNumber());
  const floor = head > lookback ? head - lookback : 0n;

  const popEvents = eventsOf(populationAbi);
  const prophetEvents = eventsOf(prophetAbi);
  const selEvents = eventsOf(selectionEngineAbi);
  const addresses = organisms.filter(Boolean);

  const found = [];
  let to = head;
  let scanned = 0n;

  while (to >= floor) {
    const from = to - LOG_CHUNK + 1n > floor ? to - LOG_CHUNK + 1n : floor;

    const [pop, org, sel] = await Promise.allSettled([
      client.getLogs({ address: cfg.population, events: popEvents, fromBlock: from, toBlock: to }),
      addresses.length
        ? client.getLogs({ address: addresses, events: prophetEvents, fromBlock: from, toBlock: to })
        : Promise.resolve([]),
      cfg.selectionEngine
        ? client.getLogs({ address: cfg.selectionEngine, events: selEvents, fromBlock: from, toBlock: to })
        : Promise.resolve([]),
    ]);

    for (const l of got(pop, [])) found.push({ ...l, origin: "population" });
    for (const l of got(org, [])) found.push({ ...l, origin: "organism" });
    for (const l of got(sel, [])) found.push({ ...l, origin: "selection" });

    scanned += to - from + 1n;
    if (from === 0n || from === floor) break;
    to = from - 1n;
  }

  found.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber > b.blockNumber ? -1 : 1;
    return Number(b.logIndex ?? 0) - Number(a.logIndex ?? 0);
  });

  return { logs: found, from: floor, to: head, scanned };
}

const blockTimes = new Map();

/**
 *  Timestamps for the blocks the feed actually shows, cached forever.
 *
 *  Forever is safe: a mined block's timestamp cannot change, and a reorg deep enough to
 *  matter would invalidate the log list too, not just its clock.
 */
export async function stampBlocks(client, numbers) {
  const wanted = [...new Set(numbers.map(String))].filter((n) => !blockTimes.has(n));
  if (!wanted.length) return blockTimes;

  const settled = await Promise.allSettled(
    wanted.map((n) => client.getBlock({ blockNumber: BigInt(n) })),
  );
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") blockTimes.set(wanted[i], s.value.timestamp);
  });
  return blockTimes;
}

export function blockTime(number) {
  return blockTimes.get(String(number)) ?? null;
}
