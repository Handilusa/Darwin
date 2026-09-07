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
 *  ── WHY A REVERT IS A THIRD THING ───────────────────────────────────────────
 *  There is a case neither of those two describes, and it used to be filed under the wrong one.
 *  An address holding a REAL contract that is not this contract — an old Population from a
 *  previous deploy, a proxy pointing at the wrong implementation, some other project's
 *  address — has code, so it does not return `0x`. It executes, finds no matching selector,
 *  and REVERTS. Every row fails, no row says "returned no data", and the old two-way ternary
 *  therefore called it `unreachable`: *"The chain did not answer"*, over a chain that answered
 *  every single call. The remedy printed was "leave the address alone and retry", which is
 *  advice that can never work, given to the one visitor whose address is definitely wrong.
 *
 *  `wrong` is that case. It has code and it is not this ABI, so it takes `absent`'s affordance
 *  — offer to forget the saved address — with its own sentence, because "there is nothing at
 *  this address" and "there is something else at this address" are different diagnoses and
 *  only one of them survives a person insisting the address is right.
 *
 *  It is read off the error the same way, never off a count: viem raises
 *  `ContractFunctionRevertedError` / `ExecutionRevertedError` for an execution that reverted, and
 *  raises neither for a request that never arrived. See `saysReverted` for the measured chains.
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
const WRONG = "wrong";
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

/**
 *  Did the call EXECUTE and revert?
 *
 *  A revert is proof of code: something at that address ran and rejected the selector. Checked
 *  against viem's own error names rather than a message regex where possible, and the message is
 *  the fallback for a node that reports the revert without a decodable payload.
 *
 *  `saysNoCode` is tested FIRST by the caller, because a `0x` return also arrives inside a
 *  `ContractFunctionExecutionError` — the two are not mutually exclusive at the top of the chain,
 *  and "no code" is the more specific diagnosis.
 *
 *  DO NOT ADD `CallExecutionError` HERE. It was in this list for one commit and it inverted the
 *  distinction this whole file exists to draw. Measured against viem 2.x on 2026-09-06, a plain
 *  transport failure produces:
 *
 *      ContractFunctionExecutionError <- CallExecutionError <- UnknownRpcError <- Error: fetch failed
 *
 *  and a genuine revert produces:
 *
 *      ContractFunctionExecutionError <- ContractFunctionRevertedError <- CallExecutionError
 *          <- ExecutionRevertedError <- UnknownRpcError <- RpcRequestError: execution reverted
 *
 *  `CallExecutionError` is in BOTH — it means "an eth_call failed", not "an eth_call reverted" — so
 *  matching it reported every RPC outage as a wrong contract and told the visitor to change a
 *  perfectly good address. `ExecutionRevertedError` (EIP-1474 code -32015 / geth code 3) and
 *  `ContractFunctionRevertedError` appear only on the revert chain. `app/test/reads.mjs` caught this
 *  because its "RPC down" fixture is a real viem client rather than a hand-written row.
 */
function saysReverted(err) {
  return causes(err).some(
    (e) =>
      e?.name === "ContractFunctionRevertedError" ||
      e?.name === "ExecutionRevertedError" ||
      e?.name === "RawContractError" ||
      /execution reverted/i.test(e?.message ?? ""),
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
 *    wrong        every read REVERTED — there is code here, and it is not this contract
 *    unreachable  every read failed, but for transport reasons — the address is not accused
 *
 *  Returns the counts too, so the UI can say "6 of 9" rather than implying all nine are
 *  current. Derived fresh on every render rather than latched, so a recovered RPC or a
 *  corrected address flips it back without a reload.
 *
 *  ORDER IS THE WHOLE LOGIC. `absent` before `wrong` before `unreachable`, most specific
 *  diagnosis first, and `unreachable` LAST because it is the only one of the three that is an
 *  absence of evidence rather than evidence. A revert reaching the final branch is how a
 *  contract that answered every call got reported as a network outage.
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

  const verdict = failures.some((f) => saysNoCode(f.error))
    ? ABSENT
    : failures.some((f) => saysReverted(f.error))
      ? WRONG
      : UNREACHABLE;

  return { verdict, ok, total, reason };
}
