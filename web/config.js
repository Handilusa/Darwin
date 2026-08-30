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
 *  Filled in at the Season 0 deploy. Empty on purpose: an address invented here would be a
 *  lie the UI would then render with total confidence.
 */
export const POPULATION = "";

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
 *  `eth_getLogs` chunk, in blocks. 9,000 is not a guess: it is the value
 *  `scripts/prove-same-block.ts:60` already uses against this RPC, chosen there because
 *  "public RPCs cap `eth_getLogs` ranges, and Somnia's blocks are fast".
 */
export const LOG_CHUNK = 9_000n;

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
