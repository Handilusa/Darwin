/**
 *  What the entry form's nine reads actually prove — no browser, no chain, no network.
 *
 *  This is the offline half of the `Enter.jsx` gate. `landing.mjs` drives the rendered page;
 *  this file pins the one decision that page makes, because that decision is pure and
 *  deserves a test that cannot be flaky.
 *
 *  ── WHY THE ERRORS ARE GENERATED RATHER THAN WRITTEN ────────────────────────
 *  The bug being guarded against was a *shape* mistake: reading `.result` off a row whose
 *  `.status` was "failure". A test that hand-builds `{status:"failure", error:{…}}` would
 *  assert my belief about viem, not viem. So every row below comes out of a real
 *  `client.readContract` against a `custom` transport that answers the way a chain answers
 *  — `0x` for an address with no code, a throw for an RPC that is down — and the rows are
 *  assembled exactly as `@wagmi/core/actions/readContracts.js:38-42` assembles them when it
 *  falls back off multicall.
 *
 *  It falls back on every read this app makes: `shannon` in `src/lib/wagmi.js` defines no
 *  `contracts.multicall3`, so `getChainContractAddress` throws `ChainDoesNotSupportContract`
 *  (`viem/utils/chain/getChainContractAddress.js:4-8`), which is not a
 *  `ContractFunctionExecutionError` and therefore lands in that `catch`. The transport's
 *  `batch: true` still collapses the nine into one HTTP round trip, so reading the failure
 *  channel costs no extra request.
 *
 *  Usage: node test/reads.mjs
 */

import { createPublicClient, custom, encodeFunctionResult, toFunctionSelector } from "viem";

import { populationReadAbi } from "../src/lib/abi.js";
import { fmtOutflow, fmtUnits, minSentence } from "../src/lib/quote.js";
import { readFailure, readReport } from "../src/lib/reads.js";

/* The nine, in the order `Enter.jsx` asks for them. */
const FN = [
  "minEndowment", "ante", "cognitionEndowment", "collateral", "metabolicCost",
  "level", "seasonId", "livingCount", "maxPopulation",
];

const ADDR = "0x1111111111111111111111111111111111111111";

/** A plausible return value per output type, so the "live" case decodes for real. */
const VALUE = {
  minEndowment: 10_000_000n,
  ante: 2_500_000n,
  cognitionEndowment: 330_000_000_000_000_000n,
  collateral: "0x2222222222222222222222222222222222222222",
  metabolicCost: 50_000n,
  level: 3,
  seasonId: 0,
  livingCount: 11n,
  maxPopulation: 24,
};

/** Selector -> function name, so the fake transport can tell the nine calls apart. */
const BY_SELECTOR = new Map(
  FN.map((f) => [toFunctionSelector(populationReadAbi.find((a) => a.name === f)), f]),
);

const answer = (fn) =>
  encodeFunctionResult({ abi: populationReadAbi, functionName: fn, result: VALUE[fn] });

/**
 *  Assemble rows the way `readContracts` does with `allowFailure: true`.
 *  `reply` decides what the chain says to each of the nine calls.
 */
async function rows(reply) {
  const client = createPublicClient({
    transport: custom({
      request: async ({ method, params }) => {
        if (method !== "eth_call") return null;
        return reply(BY_SELECTOR.get(params[0].data.slice(0, 10)) ?? null);
      },
    }),
  });
  const settled = await Promise.allSettled(
    FN.map((fn) => client.readContract({ address: ADDR, abi: populationReadAbi, functionName: fn })),
  );
  return settled.map((r) =>
    r.status === "fulfilled"
      ? { result: r.value, status: "success" }
      : { error: r.reason, result: undefined, status: "failure" },
  );
}

/* An address with no code. Every eth_call returns empty. This is the saved-EOA case. */
const eoa = () => rows(() => "0x");

/* The RPC is unreachable. Nothing decodes because nothing answered. */
const down = () =>
  rows(() => {
    throw new Error("fetch failed");
  });

/* A real arena. */
const live = () => rows((fn) => (fn ? answer(fn) : "0x"));

/* A real arena on a flaky RPC: two of the nine come back empty. */
const flaky = () =>
  rows((fn) => (!fn || fn === "seasonId" || fn === "maxPopulation" ? "0x" : answer(fn)));

/*
 *  There IS a contract here — it just is not this one. An arena from a superseded deploy, a proxy
 *  aimed at the wrong implementation, some other project's address. It has code, so nothing returns
 *  `0x`; it executes, finds no matching selector, and reverts. Every row fails and no row says
 *  "returned no data", which is how this case spent its life being reported as `unreachable`:
 *  *"The chain did not answer"*, printed over a chain that answered all nine calls, above the one
 *  piece of advice that cannot help the one visitor whose address is definitely wrong.
 *
 *  Thrown as a real JSON-RPC error object (geth's code 3) through a real client, for the reason
 *  stated at the top of this file: a hand-written `{status:"failure"}` row would assert my belief
 *  about viem's cause chain, and this file exists because that belief is exactly what was wrong.
 */
const wrongContract = () =>
  rows(() => {
    throw Object.assign(new Error("execution reverted"), { code: 3, data: "0x" });
  });

/*//////////////////////////////////////////////////////////////
                            HARNESS
//////////////////////////////////////////////////////////////*/

let fails = 0;
let checks = 0;
const out = [];

function is(name, got, want) {
  checks++;
  const ok = Object.is(got, want);
  if (!ok) fails++;
  out.push(
    `  ${ok ? "ok  " : "FAIL"}  ${name}` +
      (ok ? ` = ${JSON.stringify(want)}` : `  <- got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`),
  );
}

function truthy(name, got) {
  checks++;
  if (!got) fails++;
  out.push(`  ${got ? "ok  " : "FAIL"}  ${name}${got ? "" : `  <- got ${JSON.stringify(got)}`}`);
}

/*//////////////////////////////////////////////////////////////
                            CHECKS
//////////////////////////////////////////////////////////////*/

/* 1. The bug. A saved EOA must be named as such, not rendered as nine loading bars. */
const eoaRows = await eoa();
is("all nine reads fail against an address with no code", eoaRows.filter((r) => r.status === "failure").length, 9);
const eoaReport = readReport({ data: eoaRows });
is("verdict(EOA)", eoaReport.verdict, "absent");
is("ok(EOA)", eoaReport.ok, 0);
is("total(EOA)", eoaReport.total, 9);
truthy("the reason names the empty return", /returned no data/i.test(eoaReport.reason));

/* 1b. DETECTOR SELF-TEST. "absent" must be read off the error, not off the failure count.
       Same nine failures, a cause that says nothing about code, and the verdict must move. */
const downReport = readReport({ data: await down() });
is("verdict(RPC down)", downReport.verdict, "unreachable");
is("ok(RPC down)", downReport.ok, 0);
truthy(
  "the two all-failed cases really do differ (a count alone would have tied them)",
  downReport.verdict !== eoaReport.verdict && downReport.ok === eoaReport.ok,
);

/* 1c. DETECTOR SELF-TEST. The 0x diagnosis must be viem's own, not this file's regex. */
const causes = [];
for (let e = eoaRows[0].error, i = 0; e && i < 12; i++, e = e.cause) causes.push(e.name);
truthy(
  `viem raised ContractFunctionZeroDataError (chain: ${causes.join(" <- ")})`,
  causes.includes("ContractFunctionZeroDataError"),
);

/* 1d. THE THIRD ALL-FAILED CASE. Code that is not this ABI: reverts, not `0x`, not silence. */
const wrongRows = await wrongContract();
const wrongReport = readReport({ data: wrongRows });
is("all nine reads fail against a contract that is not a Population", wrongRows.filter((r) => r.status === "failure").length, 9);
is("verdict(wrong contract)", wrongReport.verdict, "wrong");
is("ok(wrong contract)", wrongReport.ok, 0);

/* 1e. DETECTOR SELF-TEST, and the one that earns its keep. Three all-failed batches of the SAME
       length must produce three DIFFERENT verdicts. Any classifier reading a tally ties them, and a
       classifier matching an error name that appears on more than one of viem's cause chains ties
       two of them — which is precisely what happened: `CallExecutionError` was in `saysReverted`
       for one commit, and since viem puts it on a transport failure's chain as well as a revert's,
       every RPC outage was reported as a wrong address. This check is what caught it. */
truthy(
  `three all-failed batches give three verdicts (absent/${wrongReport.verdict}/${downReport.verdict})`,
  new Set([eoaReport.verdict, wrongReport.verdict, downReport.verdict]).size === 3,
);
/* 1f. And the overlap is real, so 1e is not passing on disjoint inputs. Both chains carry
       `CallExecutionError`; only the revert carries `ContractFunctionRevertedError`. */
const nameChain = (err) => {
  const out = [];
  for (let e = err, i = 0; e && i < 12; i++, e = e.cause) out.push(e.name);
  return out;
};
const downNames = nameChain((await down())[0].error);
const wrongNames = nameChain(wrongRows[0].error);
truthy(
  `the two chains overlap yet differ (down: ${downNames.join(" <- ")} | wrong: ${wrongNames.join(" <- ")})`,
  downNames.some((n) => wrongNames.includes(n)) && wrongNames.includes("ContractFunctionRevertedError") &&
    !downNames.includes("ContractFunctionRevertedError"),
);

/* 2. A real arena reads live and is never gated. */
const liveReport = readReport({ data: await live() });
is("verdict(live arena)", liveReport.verdict, "live");
is("ok(live arena)", liveReport.ok, 9);

/* 3. A real arena on a flaky RPC stays usable — partial failure must not lock anyone out. */
const flakyRows = await flaky();
const flakyReport = readReport({ data: flakyRows });
is("verdict(7 of 9)", flakyReport.verdict, "live");
is("ok(7 of 9)", flakyReport.ok, 7);

/* 3b. DETECTOR SELF-TEST. Prove the flaky fixture is actually degraded and not "live" by
       another name — if the transport had quietly answered everything, ok would be 9. */
truthy("the flaky fixture really did drop two reads", flakyReport.ok < liveReport.ok);

/* 4. Nothing conclusive before the query settles. Silence, not an accusation. */
is("verdict(no data yet)", readReport({ data: undefined }).verdict, "pending");
is("verdict(query disabled -> empty array)", readReport({ data: [] }).verdict, "pending");
is("verdict(undefined query)", readReport(undefined).verdict, "pending");

/* 5. Per-row failure, for the value cells. */
truthy("readFailure names a failed row", /returned no data/i.test(readFailure(eoaRows, 0) ?? ""));
is("readFailure is null for a row that succeeded", readFailure(flakyRows, 0), null);
truthy("readFailure names the flaky arena's dropped read", readFailure(flakyRows, 6) !== null);
is("readFailure on absent data", readFailure(undefined, 0), null);

/*//////////////////////////////////////////////////////////////
              A MISSING SCALE IS NOT A ZERO  (audit #6)
//////////////////////////////////////////////////////////////*/

/*
 *  `Enter.jsx` asks for nine values in one batch and `decimals()` comes from a SECOND round trip,
 *  against the collateral address the first batch discovered. So there is a real window — two
 *  renders wide, every page load — in which `required` is a bigint and `decimals` is `undefined`.
 *  Interpolate through that window and `formatUnits(v, undefined)` yields the string "null", which
 *  is how a page shipped reading *"minimum null tUSDC"* and *"−null"*.
 *
 *  These formatters live in `src/lib/quote.js` and not in the `.jsx` that uses them for exactly one
 *  reason: plain Node cannot import JSX, so while they were inline no test could reach them at all.
 *  That is the structural reason this defect class shipped twice. Returning `null` rather than a
 *  string is the contract — a caller must be forced to choose its own wording for "not yet".
 */
is("fmtUnits without a scale is null, not a number", fmtUnits(10_000_000n, undefined), null);
is("fmtOutflow without a scale is null, not '−null'", fmtOutflow(10_000_000n, undefined), null);
is("minSentence without a scale is null, not 'minimum null tUSDC'", minSentence(10_000_000n, undefined, "tUSDC"), null);
/* The other half of the window: the figure has not landed either. */
is("minSentence without a figure is null", minSentence(undefined, 6, "tUSDC"), null);
/* CONTROLS. Once both have landed the sentence must actually be produced — otherwise the four
   checks above are satisfied by a function that returns `null` unconditionally.

   Matched with a pattern, not a literal: `toLocaleString(undefined, …)` follows the HOST locale, so
   a comma-decimal machine produces "10,00" and pinning "10.00" would fail on the developer's box
   while passing in CI, or the reverse. The claim here is two decimal places and the right magnitude,
   which is what the visitor needs; the separator is the browser's business and deliberately so. */
truthy(
  `minSentence with both reads is a sentence (${minSentence(10_000_000n, 6, "tUSDC")})`,
  /^minimum 10[.,]00 tUSDC$/.test(minSentence(10_000_000n, 6, "tUSDC") ?? ""),
);
truthy(
  `fmtOutflow with both reads carries the minus (${fmtOutflow(10_000_000n, 6)})`,
  /^−10[.,]00$/.test(fmtOutflow(10_000_000n, 6) ?? ""),
);
/* And no output may ever contain the literal "null" — the exact substring the visitor saw. */
truthy(
  "no resolved formatter output contains the string 'null'",
  ![minSentence(10_000_000n, 6, "tUSDC"), fmtOutflow(10_000_000n, 6), fmtUnits(10_000_000n, 6)].some((s) =>
    String(s).includes("null"),
  ),
);

/*//////////////////////////////////////////////////////////////
                            REPORT
//////////////////////////////////////////////////////////////*/

console.log(out.join("\n"));
console.log("-".repeat(72));
if (fails) {
  console.log(`FAIL — ${fails} of ${checks} checks`);
  process.exit(1);
}
console.log(`PASS — ${checks} checks, no browser, no network`);
process.exit(0);
