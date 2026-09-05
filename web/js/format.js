/**
 *  Formatting. No imports, no chain, no DOM.
 *
 *  `units` is the exact port of `fmt` from `scripts/lib/darwin.ts:320-327`, character for
 *  character in behaviour. That is not tidiness — the page and `monitor.ts` are two readings
 *  of the same treasury, and if they round differently then a judge comparing a terminal to
 *  a screen sees a discrepancy that does not exist on chain. Keep them identical.
 */

/**
 *  Fixed-point integer -> decimal string, truncating rather than rounding.
 *
 *  Truncation is the right choice for money we did not earn: showing 1.9999 as 2 overstates
 *  a treasury. `places` caps the fraction; trailing zeros are dropped so a whole number reads
 *  as `40` and not `40.0000`.
 */
export function units(value, decimals, places = 4) {
  const v = BigInt(value);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base)
    .toString()
    .padStart(decimals, "0")
    .slice(0, places)
    .replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Thousands separators on the integer part only, applied after `units`. */
export function money(value, decimals, places = 2) {
  const s = units(value, decimals, places);
  const [w, f] = s.split(".");
  return `${group(w)}${f ? `.${f}` : ""}`;
}

/**
 *  `money`, but the fraction is padded to exactly `places` instead of trimmed.
 *
 *  For a COLUMN of money rather than a number in a sentence. `units` drops trailing zeros on
 *  purpose, which is right in prose — "paid 3.9 tUSDC rake" — and wrong stacked: a column reading
 *  58.42 / 51.07 / 22.5 / 4 has its decimal point in three different places, and the one number a
 *  viewer scans down the grid is the one they cannot scan. Same digits, same truncation, same
 *  `units` underneath, so this never disagrees with `monitor.ts` about what an organism holds; the
 *  zeros are presentation and nothing else reads them.
 */
export function moneyFixed(value, decimals, places = 2) {
  const s = units(value, decimals, places);
  const [w, f = ""] = s.split(".");
  const frac = places > 0 ? f.padEnd(places, "0") : "";
  return `${group(w)}${frac ? `.${frac}` : ""}`;
}

/** Group the integer part, sign preserved. */
function group(w) {
  const sign = w.startsWith("-") ? "-" : "";
  const digits = sign ? w.slice(1) : w;
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Native STT, which is 18dp and only ever interesting to about four places. */
export function stt(wei, places = 4) {
  return units(wei, 18, places);
}

export function addr(a, lead = 6, tail = 4) {
  if (!a) return "-";
  return a.length <= lead + tail + 2 ? a : `${a.slice(0, lead)}…${a.slice(-tail)}`;
}

export function hash(h, lead = 10, tail = 6) {
  return addr(h, lead, tail);
}

/**
 *  Signed percentage move between two same-scale fixed-point prices.
 *
 *  Returns a string AND a sign so the caller does not re-derive direction from the text. The
 *  ratio is computed in BigInt at four extra digits before touching a float, because
 *  `Number(bigint)` on 18dp values loses precision well before the decimal point matters.
 */
export function movePct(open, last) {
  const o = BigInt(open);
  const l = BigInt(last);
  if (o === 0n) return { text: "-", sign: 0, bps: 0n };
  const bps = ((l - o) * 1_000_000n) / o; // millionths, signed
  const sign = bps === 0n ? 0 : bps > 0n ? 1 : -1;
  const pct = Number(bps) / 10_000;
  const text = `${sign > 0 ? "+" : ""}${pct.toFixed(3)}%`;
  return { text, sign, bps };
}

/** Seconds -> `4m 12s`. Caps at hours; a 15-minute window never needs days. */
export function dur(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return "-";
  if (s === 0) return "0s";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** Unix seconds -> `2m ago`, for log lines and staleness. */
export function ago(unixSeconds, now = Math.floor(Date.now() / 1000)) {
  const d = now - Number(unixSeconds);
  if (!Number.isFinite(d)) return "-";
  if (d < 0) return "just now";
  return `${dur(d)} ago`;
}

export function clock(unixSeconds) {
  const d = new Date(Number(unixSeconds) * 1000);
  return Number.isNaN(d.getTime()) ? "-" : d.toISOString().replace("T", " ").slice(0, 19);
}

/** Win rate over decided windows only. Abstentions are not losses and must not dilute it. */
export function winRate(correct, wrong) {
  const c = Number(correct);
  const w = Number(wrong);
  const decided = c + w;
  if (decided === 0) return { text: "-", value: null, decided: 0 };
  const value = c / decided;
  return { text: `${(value * 100).toFixed(0)}%`, value, decided };
}

export function plural(n, one, many = `${one}s`) {
  return Number(n) === 1 ? one : many;
}

/** Basis points as a percentage, for rake and prize share. */
export function bps(v) {
  return `${(Number(v) / 100).toFixed(2).replace(/\.00$/, "")}%`;
}
