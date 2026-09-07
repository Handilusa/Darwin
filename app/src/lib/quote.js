/**
 *  The quote panel's number formatting — the pure half of `sections/Enter.jsx`.
 *
 *  ── WHY THESE THREE LIVE HERE AND NOT IN THE COMPONENT ──────────────────────
 *  They were local functions in a `.jsx` file, which means the offline suite could not reach
 *  them: `test/reads.mjs` runs under plain Node with no JSX transform, so importing the
 *  component to test a formatter is not an option. That is the whole reason the defect below
 *  shipped twice — it is arithmetic on maybe-`undefined` reads, exactly the kind of thing a
 *  pure test pins in one line, sitting somewhere no pure test could see it.
 *
 *  ── THE DEFECT THEY EXIST TO CLOSE ──────────────────────────────────────────
 *  Every figure in the panel needs TWO reads before it can be printed: the value itself, and
 *  the collateral's `decimals` for its scale. `decimals` cannot even be requested until the
 *  arena read resolves `collateral`, so there is a two-round-trip window where a value has
 *  landed and its scale has not. `fmtUnits` returns `null` for that window — correct, and the
 *  reason `Val` renders a skeleton. But `null` interpolated into a template literal is the
 *  four characters `null`, so any row that prefixes or suffixes the number renders
 *  `−null` or `minimum null tUSDC` on a cold load. The fix is that a composed sentence must
 *  be composed null-first: no scale, no sentence, and the caller falls back to its pending
 *  copy rather than to a formatter's internals.
 */

import { formatUnits } from "viem";

/**
 *  A bigint at a known scale, or `null` when either half is still in flight.
 *
 *  Returning `null` rather than `"0.00"` is load-bearing: a zero balance and an unread
 *  balance are different facts, and this page withholds an entry form on the difference.
 */
export function fmtUnits(v, decimals, digits = 2) {
  if (typeof v !== "bigint" || typeof decimals !== "number") return null;
  const n = Number(formatUnits(v, decimals));
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 *  The one figure in the quote panel that carries a sign, and therefore the first one that
 *  printed a formatter's `null`. Signed here instead of in a template literal, so the row
 *  hands `Val` nothing at all while pending and gets the same skeleton as its neighbours.
 */
export function fmtOutflow(v, decimals) {
  const s = fmtUnits(v, decimals);
  return s === null ? null : `−${s}`;
}

/**
 *  The endowment minimum as a sentence, or `null` while it is not yet sayable.
 *
 *  `required` resolving is NOT enough to print it — the field hint below the amount input
 *  tested only that, and rendered "minimum null tUSDC" for the two round trips before
 *  `decimals` arrived. A minimum whose scale is unknown is still unread, so this returns
 *  `null` and the hint stays on "reading minimum…".
 */
export function minSentence(required, decimals, symbol) {
  const s = fmtUnits(required, decimals);
  return s === null ? null : `minimum ${s} ${symbol}`;
}
