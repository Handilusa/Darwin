/**
 *  Paging and retry for `eth_getLogs`, in one place, with a self-test that runs on no chain.
 *
 *  ## Why this exists
 *
 *  `CHUNK = 1_000n` was pasted into three scripts because dream-rpc rejects any `eth_getLogs`
 *  whose `toBlock - fromBlock` exceeds 1000. That constant is now correct — measured live on
 *  2026-09-06 with a ladder probe and a negative control, `999` and `1000` accepted, `4999`,
 *  `8999` and `9999` rejected with `block range exceeds 1000` — and it is still not a fix.
 *  Three things were wrong with it as an answer:
 *
 *    1. IT IS ONE NUMBER FOR ONE RPC. `SOMNIA_RPC_URL` is an env var. Point the scripts at a
 *       provider whose cap is 500 and all three break again, in the same way, on the first
 *       call. A constant cannot adapt; a shrink-on-refusal loop can.
 *    2. NOTHING EVER RAN IT. The correction to 1_000n was verified against the compiler and a
 *       cap measurement, not against a scan, because nothing is deployed — `manifest()` throws
 *       before the first `getLogs` on a fresh clone. So the paging arithmetic itself
 *       (`start + CHUNK - 1n`, the backward `to = from - 1n`, the `from === floor` break) had
 *       no test of any kind. Two of those three expressions had an off-by-one available to
 *       them and no way to be caught.
 *    3. A TRANSIENT FAILURE KILLED THE WHOLE SCAN. One 503 or one socket hang-up 190 pages
 *       into a 200,000-block sweep threw the lot away. `npm run prove` is the honesty gate for
 *       the central claim, and it was one dropped packet away from reporting nothing.
 *
 *  ## The shape, and why the fetch stays at the call site
 *
 *  `scanRange` owns the paging and the retry. It does NOT own the query: the caller passes a
 *  closure that does its own `publicClient.getLogs({ address, event, ... })`. That is
 *  deliberate — viem infers `l.args.pool` and `l.args.window` from the `event` at the call
 *  site, and a wrapper that took the query object as data would erase exactly the typing that
 *  makes those decoded reads safe. The generic here is over the ROW, not over the request.
 *
 *  It also makes the whole thing testable with no chain, no key and no deployment, which is
 *  the difference between this file and the constant it replaces: `--self-test` drives it with
 *  a fake RPC that reproduces dream-rpc's own error string and asserts convergence, coverage
 *  with no gap and no overlap, an early stop, and — the controls — that the shrink has a
 *  floor, that a genuine revert is NOT retried, and that a clean fetch is never shrunk.
 *
 *  ## What it still does not claim
 *
 *  That a real scan against Shannon has happened. It has not: nothing is deployed. What is now
 *  true is that the cap is measured, the retry converges on a fake that refuses like the real
 *  node does, and a different cap no longer needs a code change. The first real page is still
 *  the first real page.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sleep } from "./darwin.js";

/**
 *  Opening span per request, INCLUSIVE — a page is `[from, from + span - 1n]`, so this is the
 *  span, not the stride.
 *
 *  1_000n because dream-rpc's usable inclusive window is 1001 blocks (measured; see the header),
 *  so this fits with one block of margin. It is now an OPENING BID rather than a constraint:
 *  `scanRange` halves it on refusal, so a provider with a smaller cap costs a few wasted
 *  requests instead of a crash. Do not raise it without re-running the ladder against the RPC
 *  you intend to use — a too-large opening bid still works, it is just slower to converge.
 */
export const LOG_SPAN = 1_000n;

/** Requests per page before a transient failure is treated as permanent. */
const RETRIES = 4;

/** First backoff, doubled per attempt and capped. */
const BACKOFF_MS = 250;
const BACKOFF_CAP_MS = 4_000;

/**
 *  Every message in an error's `cause` chain, lowercased and joined.
 *
 *  viem wraps: the string dream-rpc actually sent arrives as `details` on an
 *  `HttpRequestError` nested two or three `cause` levels under whatever `getLogs` threw.
 *  Classifying on `err.message` alone reads the outermost wrapper, which says
 *  "HTTP request failed" and nothing about the range — so the shrink would never fire.
 */
export function errText(err: unknown): string {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let depth = 0; depth < 8 && cur !== null && cur !== undefined; depth++) {
    if (typeof cur === "string") {
      parts.push(cur);
      break;
    }
    const o = cur as Record<string, unknown>;
    for (const key of ["shortMessage", "details", "message"]) {
      const v = o[key];
      if (typeof v === "string" && v.length > 0) parts.push(v);
    }
    cur = o["cause"];
  }
  return parts.join(" | ").toLowerCase();
}

/**
 *  Does this error mean "your block range is too wide"?
 *
 *  The first pattern is dream-rpc's own, verbatim from the ladder probe. The rest are the
 *  phrasings the common providers use, because the point of this file is that the next RPC
 *  refuses differently.
 *
 *  NARROW ON PURPOSE, and the self-test has a control for it: misclassifying a revert or an
 *  auth failure as a range error turns one bad request into eleven, each half the size, all
 *  failing the same way.
 */
export function isRangeError(err: unknown): boolean {
  const t = errText(err);
  return (
    /block range/.test(t) ||
    /range exceed/.test(t) ||
    /exceeds? the limit/.test(t) ||
    /too many blocks/.test(t) ||
    /query (?:returned )?more than/.test(t) ||
    /more than \d+ results/.test(t) ||
    /log response size exceeded/.test(t) ||
    /query timeout exceeded/.test(t)
  );
}

/**
 *  Is this worth trying again unchanged?
 *
 *  A range error is NOT transient — it will fail identically forever, which is why it gets a
 *  smaller page instead of a longer wait. The self-test asserts the two classifiers disagree
 *  about it.
 */
export function isTransient(err: unknown): boolean {
  if (isRangeError(err)) return false;
  const t = errText(err);
  return (
    /timeout|timed out/.test(t) ||
    /rate limit|too many requests|429/.test(t) ||
    /50[234]|bad gateway|service unavailable/.test(t) ||
    /econnreset|epipe|etimedout|econnrefused|socket hang up/.test(t) ||
    /fetch failed|network (?:error|request failed)/.test(t) ||
    /internal error|server error/.test(t)
  );
}

export type ScanOpts<T> = {
  /** Opening span. Defaults to `LOG_SPAN`. */
  span?: bigint;
  /** `"forward"` pages up from `from`; `"backward"` pages down from `to` (newest first). */
  direction?: "forward" | "backward";
  /**
   *  Called with each page as it lands. Return `true` to stop scanning — used by the callers
   *  that only want the newest hit and should not read the whole history to find it.
   */
  onPage?: (rows: T[], from: bigint, to: bigint) => boolean | void;
  /** Per-page attempts for transient failures. Defaults to 4. */
  retries?: number;
  /** Seam for the self-test, which must not actually wait out a backoff. */
  sleepFn?: (ms: number) => Promise<void>;
  /** Called when the span shrinks, so the scripts can say so out loud. */
  onShrink?: (from: bigint, span: bigint, reason: string) => void;
};

/**
 *  Walk `[from, to]` inclusive in pages, calling `fetch` for each, and return everything.
 *
 *  Two failure responses, and they are opposites: a REFUSAL of the range halves the page and
 *  retries immediately (waiting changes nothing), a TRANSIENT failure keeps the page and waits
 *  (a smaller page changes nothing). Anything else is re-thrown untouched — a wrong address, a
 *  malformed filter and a dead key must not be dressed up as a retry loop.
 *
 *  The span, once shrunk, STAYS shrunk for the rest of the scan. Re-widening after each
 *  success would pay the refusal again on every page.
 */
export async function scanRange<T>(
  from: bigint,
  to: bigint,
  fetch: (pageFrom: bigint, pageTo: bigint) => Promise<T[]>,
  opts: ScanOpts<T> = {},
): Promise<T[]> {
  const backward = opts.direction === "backward";
  const retries = opts.retries ?? RETRIES;
  const nap = opts.sleepFn ?? sleep;
  let span = opts.span ?? LOG_SPAN;
  if (span < 1n) span = 1n;

  const out: T[] = [];
  if (to < from) return out;

  // Cursor is the edge the scan is advancing FROM: the low edge going forward, the high edge
  // going backward. The other edge of each page is derived, never accumulated, so a shrink
  // mid-scan cannot leave a gap behind it.
  let cursor = backward ? to : from;

  for (;;) {
    let pageFrom: bigint;
    let pageTo: bigint;
    if (backward) {
      pageTo = cursor;
      pageFrom = pageTo - span + 1n;
      if (pageFrom < from) pageFrom = from;
    } else {
      pageFrom = cursor;
      pageTo = pageFrom + span - 1n;
      if (pageTo > to) pageTo = to;
    }

    let rows: T[] | undefined;
    for (let attempt = 0; rows === undefined; attempt++) {
      try {
        rows = await fetch(pageFrom, pageTo);
      } catch (err) {
        if (isRangeError(err)) {
          // A span of 1 is a single block. If THAT is refused for being too wide, the
          // classification is wrong or the node is broken, and halving forever would spin
          // silently — so this is where the loop gives up rather than where it hides.
          if (span === 1n) throw err;
          span = span / 2n;
          if (span < 1n) span = 1n;
          opts.onShrink?.(pageFrom, span, errText(err).slice(0, 120));
          // Recompute the page against the smaller span; the cursor has not moved.
          if (backward) {
            pageFrom = pageTo - span + 1n;
            if (pageFrom < from) pageFrom = from;
          } else {
            pageTo = pageFrom + span - 1n;
            if (pageTo > to) pageTo = to;
          }
          attempt = -1; // a shrink is not a wasted attempt against the transient budget
          continue;
        }
        if (isTransient(err) && attempt < retries) {
          const wait = Math.min(BACKOFF_MS * 2 ** attempt, BACKOFF_CAP_MS);
          await nap(wait);
          continue;
        }
        throw err;
      }
    }

    out.push(...rows);
    if (opts.onPage?.(rows, pageFrom, pageTo) === true) return out;

    if (backward) {
      if (pageFrom <= from) return out;
      cursor = pageFrom - 1n;
    } else {
      if (pageTo >= to) return out;
      cursor = pageTo + 1n;
    }
  }
}

/*//////////////////////////////////////////////////////////////
                            SELF-TEST
//////////////////////////////////////////////////////////////*/

/**
 *  dream-rpc's refusal, verbatim from the 2026-09-06 ladder probe, wrapped as viem wraps it.
 *
 *  The outer message is deliberately viem's GENERIC wrapper — an unrecognized JSON-RPC error
 *  code becomes `UnknownRpcError: An unknown RPC error occurred.`, and the node's own sentence
 *  survives only as `details` two levels down. An earlier version of this fixture said "The
 *  provided block range is invalid." on the outside, which made check 12 fail: the classifier
 *  was matching the wrapper, so the fixture proved nothing about the nesting the real error
 *  depends on. Keep the words "block range" OUT of the outer message.
 */
function rangeRefusal(limit: number): Error {
  const inner = new Error("HTTP request failed.");
  (inner as Error & { details: string }).details = `block range exceeds ${limit}`;
  const outer = new Error("An unknown RPC error occurred.");
  (outer as Error & { cause: unknown }).cause = inner;
  return outer;
}

type Fake = {
  fetch: (from: bigint, to: bigint) => Promise<bigint[]>;
  pages: Array<{ from: bigint; to: bigint }>;
  calls: number;
};

/** A node that refuses any span above `cap` and otherwise returns one row per page. */
function fakeRpc(cap: number, opts: { failFirst?: number; failWith?: () => Error } = {}): Fake {
  const f: Fake = {
    pages: [],
    calls: 0,
    fetch: async (from, to) => {
      f.calls++;
      if (opts.failFirst !== undefined && f.calls <= opts.failFirst) {
        throw (opts.failWith ?? (() => new Error("socket hang up")))();
      }
      if (to - from > BigInt(cap)) throw rangeRefusal(cap);
      f.pages.push({ from, to });
      return [from];
    },
  };
  return f;
}

/** Pages must tile `[from, to]` exactly: ascending order, no gap, no overlap, both ends hit. */
function tiles(pages: Array<{ from: bigint; to: bigint }>, from: bigint, to: bigint): string | undefined {
  if (pages.length === 0) return "no pages at all";
  const sorted = [...pages].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (first.from !== from) return `first page starts at ${first.from}, not ${from}`;
  if (last.to !== to) return `last page ends at ${last.to}, not ${to}`;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.from !== prev.to + 1n) {
      return cur.from > prev.to + 1n
        ? `gap between ${prev.to} and ${cur.from}`
        : `overlap between ${prev.to} and ${cur.from}`;
    }
  }
  return undefined;
}

const NOP = async () => {};

export async function selfTest(): Promise<void> {
  let failed = 0;
  let total = 0;

  const check = (name: string, ok: boolean, detail = "") => {
    total++;
    if (ok) {
      console.log(`  ok    ${name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${name}${detail ? `  — ${detail}` : ""}`);
    }
  };

  // 1. The cap the scripts are actually pointed at: no shrink needed, exact tiling.
  {
    const f = fakeRpc(1000);
    const rows = await scanRange(0n, 2_500n, f.fetch, { sleepFn: NOP });
    check("1000-cap node: tiles the range", tiles(f.pages, 0n, 2_500n) === undefined, tiles(f.pages, 0n, 2_500n));
    check("1000-cap node: 3 pages for 2501 blocks", f.pages.length === 3, `got ${f.pages.length}`);
    check("1000-cap node: every page returned", rows.length === 3, `got ${rows.length}`);
  }

  // 2. THE POINT OF THE FILE. A cap the constant does not know about still completes.
  {
    const f = fakeRpc(100);
    const rows = await scanRange(1_000n, 1_999n, f.fetch, { sleepFn: NOP });
    check("100-cap node: converges", rows.length > 0, "returned nothing");
    check("100-cap node: tiles the range", tiles(f.pages, 1_000n, 1_999n) === undefined, tiles(f.pages, 1_000n, 1_999n));
    const widest = f.pages.reduce((w, p) => (p.to - p.from > w ? p.to - p.from : w), 0n);
    check("100-cap node: no page wider than the cap", widest <= 100n, `widest span ${widest + 1n}`);
  }

  // 3. Single block. `from === to` must be one request, not zero and not two.
  {
    const f = fakeRpc(1000);
    await scanRange(7n, 7n, f.fetch, { sleepFn: NOP });
    check(
      "single block: exactly one page, [7,7]",
      f.pages.length === 1 && f.pages[0]!.from === 7n && f.pages[0]!.to === 7n,
      JSON.stringify(f.pages.map((p) => `${p.from}..${p.to}`)),
    );
  }

  // 4. Backward paging tiles the same range — the direction the three scripts use to find the
  //    NEWEST hit, and the one whose `to = from - 1n` arithmetic was never executed.
  {
    const f = fakeRpc(1000);
    await scanRange(500n, 3_400n, f.fetch, { direction: "backward", sleepFn: NOP });
    check("backward: tiles the range", tiles(f.pages, 500n, 3_400n) === undefined, tiles(f.pages, 500n, 3_400n));
    check(
      "backward: newest page first",
      f.pages[0]!.to === 3_400n,
      `first page ended at ${f.pages[0]?.to}`,
    );
  }

  // 5. Backward AND shrinking at once: the combination where a mis-recomputed page would
  //    leave a hole in the middle of the history and report a clean scan.
  {
    const f = fakeRpc(250);
    await scanRange(0n, 1_500n, f.fetch, { direction: "backward", sleepFn: NOP });
    check("backward + shrink: tiles the range", tiles(f.pages, 0n, 1_500n) === undefined, tiles(f.pages, 0n, 1_500n));
  }

  // 6. Early stop: `onPage` returning true must end the scan immediately.
  {
    const f = fakeRpc(1000);
    await scanRange(0n, 100_000n, f.fetch, { sleepFn: NOP, onPage: () => true });
    check("onPage true stops after one page", f.calls === 1, `made ${f.calls} calls`);
  }

  // 7. Transient failures are waited out rather than fatal.
  {
    const f = fakeRpc(1000, { failFirst: 2 });
    const rows = await scanRange(0n, 10n, f.fetch, { sleepFn: NOP });
    check("two transient failures then success", rows.length === 1, `got ${rows.length} rows`);
    check("transient retries reuse the same page", f.calls === 3, `made ${f.calls} calls`);
  }

  // 8. CONTROL — the transient budget is finite. An RPC that is simply down must throw, not
  //    spin. Without this, a hung provider looks exactly like an empty chain.
  {
    const f = fakeRpc(1000, { failFirst: 99 });
    let threw = false;
    try {
      await scanRange(0n, 10n, f.fetch, { sleepFn: NOP, retries: 3 });
    } catch {
      threw = true;
    }
    check("CONTROL: a permanently-down RPC throws", threw, "scanRange swallowed it");
    check("CONTROL: it gave up after retries+1 attempts", f.calls === 4, `made ${f.calls} calls`);
  }

  // 9. CONTROL — the shrink has a floor. A node that refuses even one block must throw
  //    instead of halving 1n forever, which is the failure mode that would hang a demo.
  {
    let calls = 0;
    let threw = false;
    try {
      await scanRange(0n, 10n, async () => {
        calls++;
        throw rangeRefusal(0);
      }, { sleepFn: NOP });
    } catch {
      threw = true;
    }
    check("CONTROL: refusing a single block throws", threw, "it kept halving");
    check("CONTROL: and it stopped in bounded attempts", calls <= 12, `made ${calls} calls`);
  }

  // 10. CONTROL — a real error is not a retry. A revert must surface on the first attempt,
  //     with no backoff and no shrink, or every genuine bug becomes a slow one.
  {
    let calls = 0;
    let threw = false;
    try {
      await scanRange(0n, 10n, async () => {
        calls++;
        throw new Error("execution reverted: Ownable: caller is not the owner");
      }, { sleepFn: NOP });
    } catch {
      threw = true;
    }
    check("CONTROL: a revert is not retried", threw && calls === 1, `threw=${threw} calls=${calls}`);
  }

  // 11. The two classifiers must disagree about a range refusal, or a too-wide page would be
  //     waited out unchanged four times and then thrown anyway.
  {
    const refusal = rangeRefusal(1000);
    check("range refusal classifies as range", isRangeError(refusal));
    check("range refusal is NOT transient", !isTransient(refusal));
    check("socket hang up is transient", isTransient(new Error("socket hang up")));
    check("a revert is neither", !isRangeError(new Error("execution reverted")) && !isTransient(new Error("execution reverted")));
  }

  // 12. The refusal string is read out of a NESTED cause, which is where viem puts it.
  //     Classifying on the outermost message alone would silently disable the whole shrink.
  {
    check("nested cause is searched", isRangeError(rangeRefusal(1000)));
    check(
      "outermost message alone would not have matched",
      !/block range/i.test(String((rangeRefusal(1000) as Error).message)),
      "the fixture no longer exercises the nesting",
    );
  }

  // 13. An empty range is empty, not an infinite loop.
  {
    const f = fakeRpc(1000);
    const rows = await scanRange(10n, 9n, f.fetch, { sleepFn: NOP });
    check("to < from returns nothing and calls nothing", rows.length === 0 && f.calls === 0, `calls=${f.calls}`);
  }

  console.log("");
  if (failed > 0) {
    console.log(`FAIL — ${failed} of ${total} log-scan checks failed.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASS — ${total} log-scan checks, 6 of them controls: paging tiles its range in both ` +
      `directions, a smaller RPC cap converges, and the retry has a floor (no chain, no key, no deployment).`,
  );
}

// Guarded exactly as `cadence.ts` is, and for the reason recorded there: an unguarded
// side-effecting module scope means `import { scanRange } from "./logscan.js"` runs the
// self-test inside the importer. Compared on realpath because Windows can disagree with
// itself about drive-letter casing.
const invokedDirectly = (() => {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv1);
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  selfTest().catch((err) => {
    console.error("FATAL", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
