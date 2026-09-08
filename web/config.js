/**
 *  Where the page points, and how it decided.
 *
 *  ONE address is configured: the Population proxy. Everything else the UI talks to —
 *  collateral, price source, venue, selection engine, and even the symbol it trades — is read
 *  off the population itself (see `populationAbi`'s wiring section). That is not a shortcut;
 *  it means a stale config file cannot point this page at a venue the population no longer
 *  uses, which is a real hazard now that `venue` is repointable.
 *
 *  Resolution order is deliberate, and the UI always shows which source won, because a
 *  dashboard silently reading a stale address is worse than one that says it has none.
 *
 *    1. `?population=0x...`  an explicit URL wins over everything, and is how you point the
 *                            same page at two arenas side by side
 *    2. localStorage         what a human typed into the setup card last time
 *    3. `POPULATION` below   what the repo ships
 *    4. the deploy manifest  fetched from `../contracts/deployments/50312.json`, which works
 *                            when the page is served from the repo root
 *
 *  If all four come up empty the page does not fail — it shows the setup card, and offers the
 *  fixture so the UI can be judged before anything is deployed.
 */

export const CHAIN_ID = 50312;

/**
 *  The Season 0 Population proxy, deployed to Shannon at block 481441054 and identical to
 *  `population` in `contracts/deployments/50312.json`.
 *
 *  It was `""` until 2026-09-08, and the reason it could not stay empty is the resolution
 *  order above: step 4 fetches the manifest at `../contracts/deployments/50312.json`, which
 *  is OUTSIDE the served root under `npx serve web` — the path documented in `web/README.md`.
 *  So with this constant empty, every source failed and the one no-install route into the
 *  arena landed on the setup card asking a judge to paste an address. Only `app/`'s vite
 *  middleware, which serves `/contracts/deployments/` off disk, rescued the manifest.
 *
 *  It is still not a source of truth for anything else. Only the Population is named here;
 *  `collateral`, `priceSource`, `venue`, `selectionEngine`, `marketsModule` and `symbol` are
 *  read off it on chain, because `venue` is repointable and a stale copy here would aim the
 *  page at an abandoned arena while still rendering plausible numbers. And it is step 3, not
 *  step 1: `?population=0x…` and `localStorage` both still win, so a second arena is a URL.
 */
export const POPULATION = "0xe0F46e61Cb3c87c01c4f79b6E9727772388838Cb";

export const DEFAULT_RPC = "https://dream-rpc.somnia.network";
export const EXPLORER = "https://shannon-explorer.somnia.network";

/** Manifest path, relative to `web/`, for when the page is served from the repo root. */
export const MANIFEST_PATH = `../contracts/deployments/${CHAIN_ID}.json`;

/** Organism nicknames, written by `Seed.s.sol`. Cosmetic — absence is never fatal. */
export const LABELS_PATH = `../contracts/deployments/${CHAIN_ID}.organisms.json`;

/**
 *  Somnia's blocks are sub-second, so polling is about RPC courtesy rather than freshness.
 *  A 15-minute window means nothing on this page changes faster than the eye anyway, apart
 *  from `secondsRemaining`, which is counted down locally between polls.
 */
export const DEFAULT_POLL_MS = 10_000;

/**
 *  `eth_getLogs` span per request, in blocks, INCLUSIVE — `readFeed` asks for
 *  `[to - LOG_CHUNK + 1n, to]`, so this is the span and not the stride.
 *
 *  1_000n, and this is the SECOND number here. It was 9_000n, justified by pointing at
 *  `prove-same-block.ts` — a citation that was true (that script really did say 9,000) and
 *  still wrong, because the script was wrong too. Measured against dream-rpc on 2026-09-06
 *  with a ladder and a negative control: `to - from` of 999 and 1000 are accepted, 1001 and
 *  9000 are both rejected with `block range exceeds 1000` (JSON-RPC -1). So every feed
 *  request this page has ever made against the real RPC was refused.
 *
 *  It was refused SILENTLY, which is why the number survived. `readFeed` wraps its three
 *  scans in `Promise.allSettled` and reads them through `got(pop, [])`, so a rejection
 *  becomes an empty array and the feed renders "no activity yet" — indistinguishable from a
 *  quiet chain. `readFeed` now surfaces the reason instead of swallowing it; a range error
 *  that reaches the UI gets this constant fixed in an afternoon, one that does not costs a
 *  demo.
 *
 *  The scripts solved the same problem in `scripts/lib/logscan.ts`, which shrinks its span
 *  when a node refuses. That helper is Node-side and this file is browser-side, so the value
 *  is duplicated rather than imported. Keep them in step: if one moves, measure, then move
 *  both.
 */
export const LOG_CHUNK = 1_000n;

/** How far back the feed scans on first load, in blocks. Bounded so a cold open is cheap. */
export const FEED_LOOKBACK = 45_000n;

/**
 *  How many feed rows are rendered — and, not coincidentally, how many block timestamps get
 *  fetched for them.
 *
 *  This lives here rather than in either consumer because it is ONE number wearing two hats:
 *  `main.js` uses it to bound `stampBlocks` (one `eth_getBlockByNumber` per distinct block, so it
 *  is the cost knob) and `render.js` uses it to bound the list. When those two drifted apart the
 *  rows past the stamp limit silently degraded from "4m ago" to a raw block number, which looks
 *  like a bug in the clock rather than a budget. Importing the same constant twice makes the
 *  drift impossible instead of merely unlikely.
 */
export const FEED_ROWS = 60;

const STORE_KEY = "darwin.population";
const RPC_KEY = "darwin.rpc";

function params() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "");
  } catch {
    return new URLSearchParams();
  }
}

/** localStorage throws in some embedded contexts rather than returning null. */
function stored(key) {
  try {
    return globalThis.localStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

export function remember(key, value) {
  try {
    if (value) globalThis.localStorage?.setItem(key, value);
    else globalThis.localStorage?.removeItem(key);
  } catch {
    /* private mode, or storage disabled. The page works without persistence. */
  }
}

export const KEYS = { population: STORE_KEY, rpc: RPC_KEY };

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function isAddress(a) {
  return typeof a === "string" && ADDR_RE.test(a);
}

/**
 *  Resolve everything the page needs to start, EXCEPT the manifest, which is async and
 *  therefore the caller's job. Returns the winning source by name so the UI can print it.
 */
export function settings() {
  const q = params();

  const fromQuery = q.get("population") || "";
  const fromStore = stored(STORE_KEY);

  let population = "";
  let source = "none";
  if (isAddress(fromQuery)) {
    population = fromQuery;
    source = "url";
  } else if (isAddress(fromStore)) {
    population = fromStore;
    source = "saved";
  } else if (isAddress(POPULATION)) {
    population = POPULATION;
    source = "config.js";
  }

  const pollRaw = Number(q.get("poll"));
  const poll = Number.isFinite(pollRaw) && pollRaw >= 2000 ? pollRaw : DEFAULT_POLL_MS;

  return {
    population,
    source,
    rpc: q.get("rpc") || stored(RPC_KEY) || DEFAULT_RPC,
    demo: q.get("demo") === "1" || q.get("demo") === "true",
    poll,
    // A bad address in the URL is worth saying out loud rather than silently ignoring.
    badQuery: fromQuery && !isAddress(fromQuery) ? fromQuery : "",
  };
}

export function txUrl(hash) {
  return `${EXPLORER}/tx/${hash}`;
}

export function addressUrl(address) {
  return `${EXPLORER}/address/${address}`;
}

export function blockUrl(number) {
  return `${EXPLORER}/block/${number}`;
}
