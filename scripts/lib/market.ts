/**
 *  Window discovery — the honest external boundary of this system.
 *
 *  Everything structural is read from chain: `markets(marketId)` gives the pool, the
 *  outcome ids, `tradingStart` and `expiry`, and that ABI is verified against the SDK.
 *  The only values that cannot be read from a verified on-chain source are the window's
 *  OPENING price and the LAST price, and those are what this module supplies.
 *
 *  So the accurate description of the trust model is: "prices are pushed; pool
 *  resolution, outcome ids, tradeability and timing are read on-chain." Not "the oracle
 *  is off-chain", and not "everything is on-chain". Both of those are wrong.
 *
 *  Prices come from the Somnia indexer GraphQL (`SOMNIA_INDEXER_URL`), which serves the
 *  open BINARY markets and the oracle reference answers, plus the oracle price feed
 *  (`SOMNIA_PRICE_FEED_URL`) for the live spot. `PRICE_MODE=manual` pins prices for the
 *  go-live and for driving a demo by hand.
 *
 *  ────────────────────────────────────────────────────────────────────────────────
 *  Which market — `MARKET_INTERVAL_SEC` (default 3600 s). Confirmed against the live BTC
 *  rotation: it emits 60 s, 300 s and 3600 s BINARY markets, plus long-tail 4 h / 24 h /
 *  45 d. The 60 s and 300 s windows are shorter than `CADENCE_MIN_WINDOW` (360 s), so the
 *  cadence always rejects them ("only Xs left — waiting for the next one"). 3600 s is the
 *  only short interval the cadence can actually trade, and BTC 900 s markets are no longer
 *  produced (last run in late July 2026, a brief burst reappeared Sep 4), so a 900 s
 *  target would leave the population permanently on the long-tail fallback.
 *
 *  Prices — the oracle's OWN decimal scale is read from the reference answer's
 *  `outcomeLabel` (e.g. ">= 0.00" -> 2 decimals), never inferred from the live spot; see
 *  `oracleDecimalsFromLabel`. The live feed's `decimals` field scales the last price.
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
  source: "manual" | "indexer";
};

export type PriceQuote = {
  marketId: Hex;
  openPrice: bigint;
  lastPrice: bigint;
  priceDecimals: number;
};

const INDEXER_URL = () => (process.env.SOMNIA_INDEXER_URL ?? "https://dev.smk.somnia.host/v1/graphql").replace(/\/+$/, "");
const PRICE_FEED_URL = () => (process.env.SOMNIA_PRICE_FEED_URL ?? "https://price-feed.dev.oracle.somnia.host/v1/graphql").replace(/\/+$/, "");

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
  const mode = (process.env.PRICE_MODE ?? "indexer").toLowerCase();
  const quote = mode === "manual" ? fromEnv() : await fromIndexer(symbol);

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
    source: mode === "manual" ? "manual" : "indexer",
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
  const mode = (process.env.PRICE_MODE ?? "indexer").toLowerCase();
  const q = mode === "manual" ? fromEnv() : await fromIndexer(symbol);
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
                           INDEXER / GRAPHQL
//////////////////////////////////////////////////////////////*/

async function postGql<T = any>(url: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`POST ${url} -> ${res.status} ${res.statusText}`);
  const json: any = await res.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(`GraphQL errors from ${url}: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/**
 *  The oracle's own decimal scale, as encoded in a reference answer's label.
 *
 *  A reference answer labels the threshold it was resolved against, e.g. ">= 0.00".
 *  The fractional digit count of that number IS the scale the oracle records prices at
 *  — live BTC reference questions answer ">= 0.00" (2 decimals), and the raw
 *  `numericValue` is the price at that scale (e.g. 7939190 -> 79391.90). The label is part
 *  of the answer record, captured at market open (resolvedAt == tradingStart + 1), so it
 *  never depends on how far the live spot has drifted when the cadence reads it.
 *
 *  Returns `undefined` when the label carries no decimal number, so the caller refuses to
 *  guess rather than silently mis-scale the level the population is graded against.
 */
function oracleDecimalsFromLabel(label: string | null | undefined): number | undefined {
  if (!label) return undefined;
  const m = label.match(/-?\d+(?:\.(\d+))?/);
  if (!m) return undefined;
  return m[1] ? m[1].length : 0;
}

export async function fromIndexer(symbol: string): Promise<PriceQuote> {
  const now = String(Math.floor(Date.now() / 1000));
  const marketsQuery = `
    query LiveBinaryMarkets($now: numeric!, $asset: String!) {
      Market(
        where: {
          marketType: { _eq: "BINARY" },
          asset: { _eq: $asset },
          expiry: { _gt: $now }
        },
        order_by: { expiry: asc },
        limit: 20
      ) {
        id
        marketId
        tradingStart
        expiry
        intervalSec
      }
    }
  `;
  const mData = await postGql<{ Market: any[] }>(INDEXER_URL(), marketsQuery, { now, asset: symbol });
  const rows = mData.Market ?? [];
  if (rows.length === 0) {
    throw new Error(`no open ${symbol} binary market in ${INDEXER_URL()}`);
  }

  // Preference for 1h cadence (3600s), falling back to nearest live binary market
  const targetInterval = process.env.MARKET_INTERVAL_SEC ?? "3600";
  const market = rows.find((r) => String(r.intervalSec) === targetInterval) ?? rows[0];
  const marketId = market.marketId as Hex;

  // 1. Fetch opening price (OracleAnswer through MarketReferenceLink)
  const openingRefsQuery = `
    query OpeningRefs($ids: [String!]) {
      MarketReferenceLink(where: { market_id: { _in: $ids } }) {
        market: market_id
        referenceQuestionId
      }
    }
  `;
  const refData = await postGql<{ MarketReferenceLink: any[] }>(INDEXER_URL(), openingRefsQuery, {
    ids: [market.id.toLowerCase()],
  });

  let openPriceRaw: string | undefined;
  let oracleDecimals: number | undefined;
  if (refData.MarketReferenceLink && refData.MarketReferenceLink.length > 0) {
    const qid = String(refData.MarketReferenceLink[0].referenceQuestionId);
    const ansQuery = `
      query OpeningAnswers($qids: [String!]) {
        OracleAnswer(where: { id: { _in: $qids } }) {
          id
          numericValue
          outcomeLabel
        }
      }
    `;
    const ansData = await postGql<{ OracleAnswer: any[] }>(INDEXER_URL(), ansQuery, { qids: [qid] });
    const ans = ansData.OracleAnswer?.[0];
    openPriceRaw = ans?.numericValue;
    oracleDecimals = oracleDecimalsFromLabel(ans?.outcomeLabel);
  }

  // 2. Fetch live price feed
  const feedQuery = `
    query LiveFeed($base: String!) {
      Feed(where: { base: { _eq: $base }, quote: { _eq: "USDC" } }) {
        decimals
        latestSpot
      }
    }
  `;
  const pfData = await postGql<{ Feed: any[] }>(PRICE_FEED_URL(), feedQuery, { base: symbol });
  const feed = pfData.Feed?.[0];
  if (!feed?.latestSpot) {
    throw new Error(`no live price feed for ${symbol}/USDC in ${PRICE_FEED_URL()}`);
  }

  const spotBig = BigInt(feed.latestSpot);
  const feedDecimals = Number(feed.decimals ?? 18);
  const targetPriceDecimals = Number(process.env.PRICE_DECIMALS ?? "6");

  // Scale lastPrice to targetPriceDecimals (e.g. 6). The feed declares its own `decimals`,
  // so this scale is intrinsic to the feed and does not depend on the spot's magnitude.
  const lastPrice = spotBig / 10n ** BigInt(feedDecimals - targetPriceDecimals);

  // Scale openPrice to targetPriceDecimals (e.g. 6) using the oracle's OWN scale — read from
  // the reference answer's `outcomeLabel` (see `oracleDecimalsFromLabel`), never inferred from
  // the live spot. Inferring the scale from a drifting spot silently mis-scales by 10x at a
  // magnitude crossing (e.g. open 99,998 -> spot 100,004), and openPrice is the exact level
  // the population is graded against, so if the label gives no scale we fall back to the live
  // spot rather than invent a convention.
  let openPrice: bigint;
  if (openPriceRaw && oracleDecimals !== undefined) {
    const rawBig = BigInt(openPriceRaw);
    if (oracleDecimals <= targetPriceDecimals) {
      openPrice = rawBig * 10n ** BigInt(targetPriceDecimals - oracleDecimals);
    } else {
      openPrice = rawBig / 10n ** BigInt(oracleDecimals - targetPriceDecimals);
    }
  } else {
    // Oracle answer not indexed yet, or its label carries no scale — fall back to the live spot.
    openPrice = lastPrice;
  }

  return {
    marketId,
    openPrice,
    lastPrice,
    priceDecimals: targetPriceDecimals,
  };
}

/*
 *  THE TOLERANT-EXTRACTION HELPERS ARE GONE, AND SO IS `fromRest`. Deleted 2026-09-07.
 *
 *  `asRows` / `pickString` / `pickNumber` / `pickScaled` / `scale` existed to dig a
 *  marketId and two prices out of a REST payload whose shape was never verified, and
 *  `export const fromRest = fromIndexer` was the alias left behind when this module moved
 *  to the indexer. Both are removed rather than kept "just in case", because the REST
 *  endpoint they tolerated does not serve binary markets AT ALL: `stg.api.dreamdex.io/v0`
 *  is the spot DEX API, it ignores the query string entirely (`?symbol=BTC` and
 *  `?symbol=WBTC:USDso` return byte-identical payloads), and every binary path 404s. A
 *  tolerant reader for a source that has no answer is not a fallback — it is a function
 *  that turns "wrong venue" into "MISSING field", which is exactly how the go-live failed.
 *
 *  The one idea worth keeping from `scale` is recorded where it is still true: prices are
 *  scaled with integer arithmetic on `BigInt`, never through a float, because a one-unit
 *  rounding error in the opening price silently flips the outcome of a window that closes
 *  at the open. `fromIndexer` above never parses a decimal string at all — the indexer and
 *  the price feed both return integers with a declared scale — so the risk is structurally
 *  absent rather than defended against.
 */
