/**
 *  Window discovery — the honest unverified boundary of this system.
 *
 *  Everything structural is read from chain: `markets(marketId)` gives the pool, the
 *  outcome ids, `tradingStart` and `expiry`, and that ABI is verified against the SDK.
 *  The only values that cannot yet be read from a verified on-chain source are the
 *  window's OPENING price and the LAST price, and those are what this module supplies.
 *
 *  So the accurate description of the trust model is: "prices are pushed; pool
 *  resolution, outcome ids, tradeability and timing are read on-chain." Not "the oracle
 *  is off-chain", and not "everything is on-chain". Both of those are wrong.
 *
 *  ────────────────────────────────────────────────────────────────────────────────
 *  UNVERIFIED: the DreamDEX REST response shape below has NOT been confirmed against
 *  a live response. WebSearch was unavailable during research and the REST schema was
 *  never transcribed from primary docs. `PRICE_MODE=manual` exists so the go-live and
 *  the demo cannot be blocked on it, and `fromRest` fails loudly with the actual
 *  payload rather than guessing — if it throws, the fix is one field name.
 *  ────────────────────────────────────────────────────────────────────────────────
 */
import {
  binaryMarketAbi,
  marketsModuleAbi,
  publicClient,
  type Manifest,
} from "./darwin.js";
import type { Address, Hex } from "viem";

export type Window = {
  marketId: Hex;
  market: Address;
  pool: Address;
  upId: bigint;
  downId: bigint;
  tradingStart: number;
  expiry: number;
  openPrice: bigint;
  lastPrice: bigint;
  priceDecimals: number;
  source: "rest" | "manual";
};

export type PriceQuote = {
  marketId: Hex;
  openPrice: bigint;
  lastPrice: bigint;
  priceDecimals: number;
};

const REST = () => (process.env.DREAMDEX_REST ?? "https://stg.api.dreamdex.io/v0").replace(/\/+$/, "");

/*//////////////////////////////////////////////////////////////
                          PUBLIC ENTRYPOINT
//////////////////////////////////////////////////////////////*/

/**
 *  Resolve the window the population should be trading right now.
 *
 *  The price quote decides WHICH market; the chain decides everything ABOUT it. A REST
 *  response claiming a pool address is ignored — pools are recycled across windows, so
 *  a stale or wrong pool address is a live wire that would mint against someone else's
 *  book.
 */
export async function discover(symbol: string, m: Manifest): Promise<Window> {
  const mode = (process.env.PRICE_MODE ?? "rest").toLowerCase();
  const quote = mode === "manual" ? fromEnv() : await fromRest(symbol);

  const [, , , , , , , , market, pool, upId, downId, tradingStart, expiry] =
    await publicClient.readContract({
      address: m.marketsModule,
      abi: marketsModuleAbi,
      functionName: "markets",
      args: [quote.marketId],
    });

  if (pool === "0x0000000000000000000000000000000000000000") {
    throw new Error(`markets(${quote.marketId}) has no pool — the market id is wrong or not yet created.`);
  }

  return {
    marketId: quote.marketId,
    market,
    pool,
    upId,
    downId,
    tradingStart: Number(tradingStart),
    expiry: Number(expiry),
    openPrice: quote.openPrice,
    lastPrice: quote.lastPrice,
    priceDecimals: quote.priceDecimals,
    source: mode === "manual" ? "manual" : "rest",
  };
}

/** Has the market actually settled on chain? `finalizeAndRedeem` reverts before it has. */
export async function resolution(market: Address): Promise<{ resolved: boolean; voided: boolean }> {
  const [resolved, voided] = await Promise.all([
    publicClient.readContract({ address: market, abi: binaryMarketAbi, functionName: "isResolved" }),
    publicClient.readContract({ address: market, abi: binaryMarketAbi, functionName: "isVoided" }),
  ]);
  return { resolved, voided };
}

/** Fresh last price for the same market, for a mid-window re-push. */
export async function repriceQuote(symbol: string, marketId: Hex): Promise<PriceQuote> {
  const mode = (process.env.PRICE_MODE ?? "rest").toLowerCase();
  const q = mode === "manual" ? fromEnv() : await fromRest(symbol);
  if (q.marketId.toLowerCase() !== marketId.toLowerCase()) {
    throw new Error(`window rolled mid-cycle: expected ${marketId}, upstream now says ${q.marketId}`);
  }
  return q;
}

/*//////////////////////////////////////////////////////////////
                              MANUAL
//////////////////////////////////////////////////////////////*/

/**
 *  Pinned window, for the go-live and for driving a demo by hand.
 *
 *  Prices are given as integers already scaled by PRICE_DECIMALS, so that no float ever
 *  touches a value the organisms are graded against.
 */
function fromEnv(): PriceQuote {
  const marketId = need("MARKET_ID");
  if (!/^0x[0-9a-fA-F]{64}$/.test(marketId)) throw new Error(`MARKET_ID must be a 32-byte hex string, got ${marketId}`);
  return {
    marketId: marketId as Hex,
    openPrice: BigInt(need("OPEN_PRICE")),
    lastPrice: BigInt(need("LAST_PRICE")),
    priceDecimals: Number(process.env.PRICE_DECIMALS ?? "6"),
  };
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`PRICE_MODE=manual requires ${name}. See .env.example.`);
  return v;
}

/*//////////////////////////////////////////////////////////////
                               REST
//////////////////////////////////////////////////////////////*/

/**
 *  Ask DreamDEX which window is live and what it opened at.
 *
 *  Written tolerantly on purpose. The schema is unverified, so instead of assuming one
 *  field name this looks for the plausible spellings and, on failure, throws with the
 *  payload it actually received. A script that dies saying "expected `openPrice`, got
 *  {...}" is fixed in a minute; one that silently reads `undefined` as 0 pushes a zero
 *  opening price and every organism is graded against nothing.
 */
async function fromRest(symbol: string): Promise<PriceQuote> {
  const url = `${REST()}/markets?symbol=${encodeURIComponent(symbol)}&status=open`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);

  const body: unknown = await res.json();
  const rows = asRows(body);
  if (rows.length === 0) throw new Error(`no open ${symbol} market in ${url}`);

  // Nearest expiry that has not passed: the window currently trading.
  const now = Math.floor(Date.now() / 1000);
  const live = rows
    .map((r) => ({ r, expiry: pickNumber(r, ["expiry", "expiryTime", "expiresAt", "endTime"]) }))
    .filter((x) => x.expiry === undefined || x.expiry > now)
    .sort((a, b) => (a.expiry ?? Infinity) - (b.expiry ?? Infinity));

  const row = live[0]?.r ?? rows[0];
  if (!row) throw new Error(`no usable ${symbol} market row in ${url}`);

  const marketId = pickString(row, ["marketId", "market_id", "id"]);
  const decimals = pickNumber(row, ["priceDecimals", "price_decimals", "decimals"]) ?? 6;
  const open = pickScaled(row, ["openPrice", "open_price", "openingPrice", "open"], decimals);
  const last = pickScaled(row, ["lastPrice", "last_price", "price", "markPrice"], decimals);

  if (!marketId || open === undefined || last === undefined) {
    throw new Error(
      `DreamDEX REST shape not as expected — see the UNVERIFIED note in scripts/lib/market.ts.\n` +
        `  url:      ${url}\n` +
        `  marketId: ${marketId ?? "MISSING"}\n` +
        `  open:     ${open ?? "MISSING"}\n` +
        `  last:     ${last ?? "MISSING"}\n` +
        `  payload:  ${JSON.stringify(row).slice(0, 600)}`,
    );
  }

  return { marketId: marketId as Hex, openPrice: open, lastPrice: last, priceDecimals: decimals };
}

/*//////////////////////////////////////////////////////////////
                        TOLERANT EXTRACTION
//////////////////////////////////////////////////////////////*/

type Row = Record<string, unknown>;

function asRows(body: unknown): Row[] {
  if (Array.isArray(body)) return body.filter(isRow);
  if (isRow(body)) {
    for (const key of ["markets", "data", "items", "results"]) {
      const v = body[key];
      if (Array.isArray(v)) return v.filter(isRow);
      if (isRow(v)) return [v];
    }
    return [body];
  }
  return [];
}

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);

function pickString(row: Row, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function pickNumber(row: Row, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

/**
 *  Read a price and return it as an integer scaled by `decimals`.
 *
 *  Deliberately string-based. `110432.5` parsed as a float and multiplied by 1e6 is not
 *  reliably `110432500000`, and this number is the exact level every organism in the
 *  population is graded against — a one-unit rounding error in the opening price
 *  silently flips the outcome of a window that closes at the open.
 */
function pickScaled(row: Row, keys: string[], decimals: number): bigint | undefined {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return scale(v.toString(), decimals);
    if (typeof v === "string" && v.trim() !== "") {
      // An integer already at scale (some APIs return raw units) vs a decimal string.
      const s = v.trim();
      if (/^\d+$/.test(s) && s.length > decimals) return BigInt(s);
      if (/^-?\d*\.?\d+$/.test(s)) return scale(s, decimals);
    }
  }
  return undefined;
}

function scale(decimalString: string, decimals: number): bigint {
  const neg = decimalString.startsWith("-");
  const s = neg ? decimalString.slice(1) : decimalString;
  const [whole = "0", frac = ""] = s.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const out = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded === "" ? "0" : padded);
  return neg ? -out : out;
}
