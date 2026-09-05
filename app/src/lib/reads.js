/**
 *  What a batch of `allowFailure: true` reads actually proved.
 *
 *  ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *  `useReadContracts({ allowFailure: true })` never rejects for a per-call failure. It
 *  returns one row per contract, each either `{ status: "success", result }` or
 *  `{ status: "failure", error, result: undefined }` — the shape `@wagmi/core` builds at
 *  `actions/readContracts.js:38-42`. Read only `.result` and a failed call becomes
 *  indistinguishable from a call that has not answered yet: both are `undefined`.
 *
 *  The entry form did exactly that. `usePopulation` decides `status: "found"` from
 *  `isAddress()` — a forty-hex-character regex — and the address can come from
 *  `localStorage["darwin.population"]`, which is whatever was last typed into the arena's
 *  setup card. Point it at an EOA and nothing in the app ever asked the chain: all nine
 *  reads returned `0x`, all nine became `undefined`, all nine value cells rendered the
 *  *loading* skeleton, and the footer went on claiming to read the contract every twenty
 *  seconds. A form that cannot work, presented as a form that is still thinking.
 *
 *  The failure channel was already in the response. This turns it into an answer. It is the
 *  same move `web/js/chain.js:183` already makes for the arena — if `symbol()` and
 *  `collateral()` both failed, say "No Population at 0x…" instead of rendering a screen of
 *  dashes — lifted to where the entry form can use it.
 *
 *  ── WHY "absent" AND "unreachable" ARE NOT ONE VERDICT ──────────────────────
 *  Both are "every read failed", and their remedies are opposites: one means the address is
 *  wrong and the person must change it, the other means the RPC did not answer and they
 *  must not touch the address at all. Counting failures cannot tell them apart, and
 *  guessing would send a judge on a testnet hiccup off to edit a perfectly good address.
 *
 *  viem separates them for us. A call to an address with no code returns `0x`, which
 *  surfaces as `AbiDecodingZeroDataError` and is re-thrown as `ContractFunctionZeroDataError`
 *  (`viem/utils/errors/getContractError.js:15-16`) carrying the message *"returned no data
 *  ("0x")"*. A transport failure has no such cause anywhere in its chain. So the distinction
 *  is read off the error viem raised, never inferred from a tally.
 *
 *  ── WHY PARTIAL FAILURE IS STILL "live" ─────────────────────────────────────
 *  One dropped read out of nine is a flaky public RPC, not a wrong address, and locking the
 *  entry form for it would be a worse bug than the one this file fixes. So any single
 *  success means there is a Population here; the rows that failed are named individually at
 *  their own value cells instead.
 */

const PENDING = "pending";
const LIVE = "live";
const ABSENT = "absent";
const UNREACHABLE = "unreachable";

/**
 *  Walk an error's cause chain.
 *
 *  viem's `BaseError` has `.walk()`, but this is deliberately not used: the rows can also
 *  carry a plain `Error` (a transport that threw before viem wrapped it), and a helper that
 *  works on both is worth more than one that assumes the happy shape. Bounded, because a
 *  cause chain that loops would otherwise hang the render.
 */
function causes(err) {
  const out = [];
  for (let e = err, i = 0; e && i < 12; i++, e = e.cause) out.push(e);
  return out;
}

/** Did viem diagnose "there is no code at this address"? */
function saysNoCode(err) {
  return causes(err).some(
    (e) => e?.name === "ContractFunctionZeroDataError" || /returned no data/i.test(e?.message ?? ""),
  );
}

/** The most useful sentence an error carries. viem's `shortMessage` when it has one. */
function sentence(err) {
  return err?.shortMessage || err?.message || "";
}

/**
 *  Why one specific read has no value, or `null` if it has one.
 *
 *  This is what lets a value cell distinguish "still loading" from "asked, and the contract
 *  had no answer" — the two states the skeleton bar used to conflate.
 */
export function readFailure(data, i) {
  const row = Array.isArray(data) ? data[i] : undefined;
  if (row?.status !== "failure") return null;
  return sentence(row.error) || "read failed";
}

/**
 *  The verdict on a whole batch.
 *
 *    pending      nothing has settled yet (or the query is disabled) — say nothing
 *    live         at least one read answered; there is a Population at this address
 *    absent       every read failed, and viem says there is no code here
 *    unreachable  every read failed, but for transport reasons — the address is not accused
 *
 *  Returns the counts too, so the UI can say "6 of 9" rather than implying all nine are
 *  current. Derived fresh on every render rather than latched, so a recovered RPC or a
 *  corrected address flips it back without a reload.
 */
export function readReport(query) {
  const rows = query?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return { verdict: PENDING, ok: 0, total: 0, reason: "" };
  }

  const total = rows.length;
  const failures = rows.filter((r) => r?.status === "failure");
  const ok = total - failures.length;
  const reason = sentence(failures[0]?.error);

  if (ok > 0) return { verdict: LIVE, ok, total, reason };
  return {
    verdict: failures.some((f) => saysNoCode(f.error)) ? ABSENT : UNREACHABLE,
    ok,
    total,
    reason,
  };
}
