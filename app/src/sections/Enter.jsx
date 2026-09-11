/**
 *  Beat 6 — enter an organism.
 *
 *  ── WHY THIS FORM READS EVERYTHING LIVE ─────────────────────────────────────
 *  `enter` enforces four preconditions (Population.sol:736-748) and two of them move on
 *  their own. `ante()` is `baseAnte * anteMultBps^level`, and the shipped season doubles it
 *  every 72 windows across 576 — eight doublings, so the collateral floor is 256x its base
 *  by the end. A form that hardcoded a minimum measured today would revert
 *  `EndowmentBelowAnte` on Friday and look broken while behaving exactly as specified. So
 *  every number in the quote panel is an `eth_call` at the current block, and nothing here
 *  is a constant.
 *
 *  ── WHY ENTRY IS THREE TRANSACTIONS, SHOWN UP FRONT ─────────────────────────
 *  `enter` moves collateral with `transferFrom`, so an ERC20 approval is a hard
 *  prerequisite, and testnet tUSDC has to come from somewhere. Rather than surprise a judge
 *  with a second and third wallet popup, all three are listed from the start with the
 *  current one lit. The approval is for the exact amount, never unlimited: this is a
 *  demo on a testnet and it should still model the habit it wants people to have.
 *
 *  ── WHAT HAPPENS BEFORE A SIGNATURE ─────────────────────────────────────────
 *  `useSimulateContract` runs `enter` against live state before the wallet is ever opened,
 *  so a revert is shown as a sentence with the contract's own arguments in it instead of
 *  costing gas to discover. That is the same reason `populationErrorsAbi` exists.
 *
 *  ── WHY AN ADDRESS IS NOT A POPULATION ──────────────────────────────────────
 *  `usePopulation` resolves *which* address; it cannot tell you there is a contract at it.
 *  `isAddress` is forty hex characters, and the address can arrive from
 *  `localStorage["darwin.population"]` — whatever was last typed into the arena's setup
 *  card, which is a public text box. Point it at an EOA and every read below returns `0x`.
 *  With `allowFailure: true` that is nine `undefined`s, not nine errors, so the panel used
 *  to render nine loading skeletons over a footer promising live reads. `readReport` reads
 *  the failure channel those rows already carry and the form is withheld instead. See
 *  `../lib/reads.js` for why "no contract here" and "the RPC did not answer" stay separate
 *  verdicts.
 */

import { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, parseUnits, BaseError, ContractFunctionRevertedError } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  useReadContracts,
  useSimulateContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";

import { KEYS, addressUrl, remember } from "../../../web/config.js";
import { collateralAbi, populationAbi, populationReadAbi } from "../lib/abi.js";
import { usePopulation } from "../lib/population.js";
import { fmtOutflow, fmtUnits, minSentence } from "../lib/quote.js";
import { readFailure, readReport } from "../lib/reads.js";
import { shannon } from "../lib/wagmi.js";
import { useReveal } from "../motion/hooks.js";

/*//////////////////////////////////////////////////////////////
                          GENOME TEMPLATES
//////////////////////////////////////////////////////////////*/

/**
 *  Four starting points, one per thesis in `Genome.sol`'s cross product. They are
 *  templates, not presets — the textarea is the real input and every one of these is meant
 *  to be rewritten. What matters is that a first-time entrant sees the *shape* of a genome:
 *  a stated condition and a stated consequence, in a sentence a person can argue with.
 */
const TEMPLATES = [
  {
    key: "momentum",
    label: "Momentum",
    text: "You are a momentum forecaster. When the last window closed hard in one direction, you believe the next one continues it. A window that barely moved is not a signal — wait for one that did.",
  },
  {
    key: "reversion",
    label: "Reversion",
    text: "You fade the first move after a quiet stretch. When the last window barely moved and this one gaps away from it, you treat the gap as noise and expect it to come back.",
  },
  {
    key: "breakout",
    label: "Breakout",
    text: "You watch for the end of a range. When price leaves a run of small windows by more than that whole run travelled, you believe the break is real and take its side.",
  },
  {
    key: "range",
    label: "Range",
    text: "You assume the level holds. Unless the market has moved further than a window usually travels, you expect the next close near the last one and take the side that pays for stillness.",
  },
];

/*//////////////////////////////////////////////////////////////
                            FORMATTING
//////////////////////////////////////////////////////////////*/

const pick = (data, i) => data?.[i]?.result;

/*
 *  `fmtUnits`, `fmtOutflow` and `minSentence` moved to `../lib/quote.js`. They are pure
 *  functions over maybe-`undefined` reads, and while they lived in this `.jsx` file the
 *  offline suite could not import them to prove they never print a formatter's `null` — which
 *  is how a `−null` and a "minimum null tUSDC" both reached the page. See that file's header.
 */

function fmtStt(v, digits = 3) {
  if (typeof v !== "bigint") return null;
  return Number(formatEther(v)).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 *  A value still in flight is a bar the width of the number, not a spinner.
 *
 *  `failed` is the other half of that sentence. A read that came back empty is NOT a read
 *  still in flight, and the skeleton says "in flight" — conflating them is what let a form
 *  pointed at an EOA look merely slow. Naming the failure in the cell, with viem's own
 *  sentence on the title, is the difference.
 */
function Val({ children, tone = "", failed = null }) {
  if (failed) {
    return (
      <span className="quote-v is-bad" title={failed}>
        unreadable
      </span>
    );
  }
  if (children === null || children === undefined) return <span className="skel" />;
  return <span className={`quote-v ${tone}`}>{children}</span>;
}

/**
 *  Turn a viem error into a sentence.
 *
 *  The two errors an entrant can actually hit by being slightly wrong carry their
 *  arguments, and those arguments are exactly what the person needs in order to fix it — so
 *  they are spelled out rather than named. Everything else falls back to viem's own
 *  `shortMessage`, and the raw string is still printed underneath in `.revert`.
 */
function explain(err, fmt) {
  if (!err) return null;

  if (err instanceof BaseError) {
    const rejected = err.walk((e) => e?.name === "UserRejectedRequestError");
    if (rejected) return "You dismissed the request in your wallet. Nothing was sent and nothing was spent.";

    const rev = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (rev instanceof ContractFunctionRevertedError) {
      const name = rev.data?.errorName ?? rev.reason ?? "";
      const args = rev.data?.args ?? [];
      switch (name) {
        case "EndowmentBelowAnte":
          return `Four antes is ${fmt(args[1])} at this block and you offered ${fmt(args[0])}. The ante escalates every level, so requote before signing.`;
        case "EndowmentTooSmall":
          return "Below the minimum endowment. Use the minimum the quote panel shows.";
        case "CognitionTooSmall":
          return "The attached STT is below one cognition endowment. That value buys the organism its inference budget and cannot be zero.";
        case "TransferFailed":
          return "The collateral transfer failed — the approval is short, or the balance moved between the approval and this call.";
        case "PopulationFull":
          return "The population is at maxPopulation. Wait for an organism to die or retire; nothing is queued.";
        case "ERC20InsufficientAllowance":
          return `The collateral token's allowance is short — the contract needs ${fmt(args[2])} but only ${fmt(args[1])} is approved. Re-approve and try again.`;
        default:
          return name ? `Reverted with ${name}.` : (err.shortMessage ?? err.message);
      }
    }
    return err.shortMessage ?? err.message;
  }

  return err.shortMessage ?? err.message ?? String(err);
}

/*//////////////////////////////////////////////////////////////
                             SECTION
//////////////////////////////////////////////////////////////*/

export function Enter() {
  const ref = useReveal();
  const pop = usePopulation();
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();

  const population = pop.status === "found" ? pop.address : undefined;
  const wrongChain = isConnected && chainId !== shannon.id;

  const [genome, setGenome] = useState(TEMPLATES[0].text);
  const [tmpl, setTmpl] = useState(TEMPLATES[0].key);
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);

  /* ── what the contract will accept at this block ──────────────────────────── */
  const arena = useReadContracts({
    allowFailure: true,
    contracts: population
      ? [
          { address: population, abi: populationReadAbi, functionName: "minEndowment" },
          { address: population, abi: populationReadAbi, functionName: "ante" },
          { address: population, abi: populationReadAbi, functionName: "cognitionEndowment" },
          { address: population, abi: populationReadAbi, functionName: "collateral" },
          { address: population, abi: populationReadAbi, functionName: "metabolicCost" },
          { address: population, abi: populationReadAbi, functionName: "level" },
          { address: population, abi: populationReadAbi, functionName: "seasonId" },
          { address: population, abi: populationReadAbi, functionName: "livingCount" },
          { address: population, abi: populationReadAbi, functionName: "maxPopulation" },
        ]
      : [],
    query: { enabled: Boolean(population), refetchInterval: 20_000 },
  });

  const minEndowment = pick(arena.data, 0);
  const ante = pick(arena.data, 1);
  const cognition = pick(arena.data, 2);
  const collateral = pick(arena.data, 3);
  const metabolic = pick(arena.data, 4);
  const level = pick(arena.data, 5);
  const seasonId = pick(arena.data, 6);
  const living = pick(arena.data, 7);
  const maxPop = pick(arena.data, 8);

  /**
   *  The other half of those nine rows.
   *
   *  `pick` reads `.result` and throws `.status`/`.error` away, which is correct for a
   *  value and useless for a verdict — an address with no contract behind it produces nine
   *  successful-looking `undefined`s. `readReport` reads what `pick` discards, and it is the
   *  only thing on this page that can tell a Population from forty hex characters.
   */
  const report = readReport(arena);
  const minFailed = readFailure(arena.data, 0) ?? readFailure(arena.data, 1);

  /** `enter` enforces BOTH floors, so the real minimum is whichever is larger. */
  const required = useMemo(() => {
    if (typeof minEndowment !== "bigint" || typeof ante !== "bigint") return undefined;
    const fourAntes = 4n * ante;
    return fourAntes > minEndowment ? fourAntes : minEndowment;
  }, [minEndowment, ante]);

  /* ── the token, and this account's standing with it ───────────────────────── */
  const token = useReadContracts({
    allowFailure: true,
    contracts: collateral
      ? [
          { address: collateral, abi: collateralAbi, functionName: "decimals" },
          { address: collateral, abi: collateralAbi, functionName: "symbol" },
        ]
      : [],
    query: { enabled: Boolean(collateral) },
  });

  const decimals = pick(token.data, 0);
  const symbol = pick(token.data, 1) ?? "tUSDC";

  /* `null` until BOTH the figure and its scale have landed — see `../lib/quote.js`. */
  const minText = useMemo(() => minSentence(required, decimals, symbol), [required, decimals, symbol]);

  const acct = useReadContracts({
    allowFailure: true,
    contracts:
      collateral && address && population
        ? [
            { address: collateral, abi: collateralAbi, functionName: "balanceOf", args: [address] },
            { address: collateral, abi: collateralAbi, functionName: "allowance", args: [address, population] },
          ]
        : [],
    query: { enabled: Boolean(collateral && address && population) },
  });

  const balance = pick(acct.data, 0);
  const allowance = pick(acct.data, 1);

  const native = useBalance({ address, chainId: shannon.id, query: { enabled: Boolean(address) } });
  const nativeValue = native.data?.value;

  /*
   *  Which cells were asked and came back empty, so `Val` can stop pretending to load.
   *  `collateral` is checked first for both token rows: when that read fails the balance and
   *  allowance queries never run at all, so their own rows are empty for a reason that is
   *  one level up and would otherwise go unnamed.
   */
  const tokenFailed = readFailure(arena.data, 3);
  const balanceFailed = tokenFailed ?? readFailure(acct.data, 0);
  const allowanceFailed = tokenFailed ?? readFailure(acct.data, 1);
  const nativeFailed = native.isError
    ? (native.error?.shortMessage ?? native.error?.message ?? "the balance read failed")
    : null;

  /* Quote the minimum into the field once, and never fight the user for it after. */
  useEffect(() => {
    if (touched || typeof required !== "bigint" || typeof decimals !== "number") return;
    setAmount(formatUnits(required, decimals));
  }, [required, decimals, touched]);

  const parsed = useMemo(() => {
    if (typeof decimals !== "number") return undefined;
    const raw = amount.trim();
    if (!/^\d+(\.\d+)?$/.test(raw)) return undefined;
    try {
      return parseUnits(raw, decimals);
    } catch {
      return undefined;
    }
  }, [amount, decimals]);

  /* ── the three transactions ───────────────────────────────────────────────── */
  const faucetTx = useWriteContract();
  const approveTx = useWriteContract();
  const enterTx = useWriteContract();

  const faucetRcpt = useWaitForTransactionReceipt({ hash: faucetTx.data });
  const approveRcpt = useWaitForTransactionReceipt({ hash: approveTx.data });
  const enterRcpt = useWaitForTransactionReceipt({ hash: enterTx.data });

  // A confirmed transaction changed the two numbers the gate is computed from.
  useEffect(() => {
    if (faucetRcpt.isSuccess || approveRcpt.isSuccess || enterRcpt.isSuccess) {
      acct.refetch();
      native.refetch();
      arena.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faucetRcpt.isSuccess, approveRcpt.isSuccess, enterRcpt.isSuccess]);

  const need = parsed ?? required;
  const shortOfTokens = typeof balance === "bigint" && typeof need === "bigint" && balance < need;
  const shortOfAllowance = typeof allowance === "bigint" && typeof need === "bigint" && allowance < need;
  const shortOfNative =
    typeof nativeValue === "bigint" && typeof cognition === "bigint" && nativeValue < cognition;

  /*
   *  WHICH STEP THE VISITOR IS ON — or 0, meaning "not knowable yet".
   *
   *  Both `shortOf*` above are false when their read is not a bigint, and without a wallet
   *  neither ever is: `acct` is gated on `address`, so it runs zero contracts. A bare
   *  ternary chain therefore collapsed to 3 for every DISCONNECTED visitor and painted
   *  `funded` and `approved` — two transactions nobody had sent — as the first thing on the
   *  page. The `!isConnected` guard further down never covered it, because at step 3 the
   *  buttons it disables are not rendered at all; the pills are.
   *
   *  So the checklist needs a fourth state, and 0 is it. A step is only ever claimed
   *  complete against numbers actually in hand — which also covers a connected wallet whose
   *  `balanceOf`/`allowance` reads failed, where "approved" would be just as much a lie.
   */
  const quoted =
    typeof balance === "bigint" && typeof allowance === "bigint" && typeof need === "bigint";
  const step = !quoted ? 0 : shortOfTokens ? 1 : shortOfAllowance ? 2 : 3;

  /* ── preflight: find out before the wallet opens ──────────────────────────── */
  const sim = useSimulateContract({
    address: population,
    abi: populationAbi,
    functionName: "enter",
    args: genome.trim() && typeof need === "bigint" ? [genome.trim(), need] : undefined,
    value: typeof cognition === "bigint" ? cognition : undefined,
    query: {
      enabled: Boolean(
        population &&
          address &&
          !wrongChain &&
          genome.trim().length > 0 &&
          typeof need === "bigint" &&
          typeof cognition === "bigint" &&
          !shortOfTokens &&
          !shortOfAllowance,
      ),
      retry: false,
    },
  });

  const fmtNeed = (v) => `${fmtUnits(v, decimals) ?? "?"} ${symbol}`;
  const txError =
    explain(enterTx.error, fmtNeed) ??
    explain(approveTx.error, fmtNeed) ??
    explain(faucetTx.error, fmtNeed) ??
    (sim.error && !sim.isLoading ? explain(sim.error, fmtNeed) : null);
  const rawError = enterTx.error ?? approveTx.error ?? faucetTx.error ?? sim.error;

  const busy =
    faucetTx.isPending ||
    approveTx.isPending ||
    enterTx.isPending ||
    faucetRcpt.isLoading ||
    approveRcpt.isLoading ||
    enterRcpt.isLoading;

  const bytes = useMemo(() => new TextEncoder().encode(genome).length, [genome]);

  function chooseTemplate(t) {
    setTmpl(t.key);
    setGenome(t.text);
  }

  /* ── actions ──────────────────────────────────────────────────────────────── */

  /**
   *  Drop a saved address that turned out not to be a Population.
   *
   *  A stale `localStorage["darwin.population"]` is the likeliest way anyone reaches the
   *  "absent" notice, and it is not something a visitor can be expected to guess at or
   *  clear by hand. `remember` is the arena's own writer, so both surfaces forget the same
   *  key and cannot end up disagreeing about which arena they are showing. The reload is
   *  not laziness: every read on the page is keyed to the old address, and `usePopulation`
   *  resolves once and deliberately never returns to "loading".
   */
  function forgetSaved() {
    remember(KEYS.population, "");
    globalThis.location?.reload();
  }

  function doFaucet() {
    if (!collateral || typeof need !== "bigint" || typeof balance !== "bigint") return;
    faucetTx.writeContract({
      address: collateral,
      abi: collateralAbi,
      functionName: "faucet",
      args: [need - balance],
    });
  }

  function doApprove() {
    if (!collateral || !population || typeof need !== "bigint") return;
    // The exact amount. An unlimited approval on a permissionless contract is a habit
    // worth not teaching, even on a testnet.
    approveTx.writeContract({
      address: collateral,
      abi: collateralAbi,
      functionName: "approve",
      args: [population, need],
    });
  }

  function doEnter() {
    if (sim.data?.request) enterTx.writeContract(sim.data.request);
  }

  /*//////////////////////////////////////////////////////////////
                              RENDER
  //////////////////////////////////////////////////////////////*/

  const born = enterRcpt.isSuccess;

  return (
    <section className="enter" id="enter" ref={ref}>
      <div className="wrap">
        <div className="enter-head" data-rise>
          <div className="beat-eyebrow">
            <span className="beat-num">06</span>
            <span className="beat-rule" />
            <span className="label">Enter</span>
          </div>
          <h2 className="beat-title">
            Write a sentence. Watch it <em>compete</em>.
          </h2>
          <p className="prose" style={{ marginTop: "var(--s-4)" }}>
            <code>Population.enter</code> is permissionless — no allowlist, no owner
            approval. You supply a genome and an endowment, attach one cognition endowment in
            STT, and your organism joins the next window as generation 0 with your address as
            its entrant. If it survives four windows with a surplus, it breeds and you have a
            lineage.
          </p>
        </div>

        {/*
         *  An override that was thrown away has to be said out loud.
         *
         *  `settings()` records a `?population=` that failed `isAddress` as `badQuery`
         *  (`web/config.js:141`) and then resolves as if it were absent — so a typo'd
         *  address silently loses to localStorage or to the manifest, and the page shows a
         *  *different* arena than the URL asked for with no indication anything was ignored.
         *  The arena forces its setup disclosure open for exactly this case
         *  (`web/js/render.js:1837-1844`); this is the landing's version of that. It sits
         *  above the branches below because it is true regardless of which one renders.
         */}
        {pop.badQuery ? (
          <div className="notice notice-warn" data-rise style={{ marginBottom: "var(--s-5)" }}>
            <span className="notice-mark">!</span>
            <div>
              <b>That address in the URL was ignored.</b> <code>?population=</code> carried{" "}
              <code>{pop.badQuery}</code>, which is not a 20-byte address, so it was rejected
              before any read was attempted and this page fell through to whatever it would
              have used without it. Everything below refers to{" "}
              {pop.status === "found" ? <code>{pop.address}</code> : "no arena at all"}, not to
              what you typed.
            </div>
          </div>
        ) : null}

        {pop.status === "loading" ? (
          <div className="notice" data-rise>
            <span className="notice-mark">·</span>
            <div>Looking for a deployed arena…</div>
          </div>
        ) : pop.status === "undeployed" ? (
          <div className="notice notice-warn" data-rise>
            <span className="notice-mark">!</span>
            <div>
              <b>No arena is deployed yet.</b> Season 0 has not been seeded, so there is no
              contract to enter and this form would only be able to take a signature and hand
              back a revert. The whole mechanism is reviewable right now without one:{" "}
              <a href="/arena/?demo=1">the offline demo</a> runs the real renderer over a
              scripted season, and every figure in it is computed from that demo&rsquo;s own
              configuration through the real breeding and settlement rules, on a season
              compressed on purpose so a whole cycle fits in a short sitting. Point this page
              at a live deployment with{" "}
              <code>?population=0x…</code>.
            </div>
          </div>
        ) : report.verdict === "absent" ? (
          /*
           *  Forty hex characters that answer nothing. Withholding the form is the whole
           *  point: every gate below this one is computed from reads that returned
           *  `undefined`, so the panel would render nine skeletons, the button would sit
           *  disabled with no reason given, and the footer would claim to be reading a
           *  contract. Saying which address, where it came from, and how to drop it is the
           *  only useful thing this branch can do.
           */
          <div className="notice notice-bad" data-rise>
            <span className="notice-mark">✕</span>
            <div>
              <b>There is no Population at this address.</b> All {report.total} reads came
              back empty from <code>{population}</code> on chain {shannon.id}, which is what
              a call to an address with no contract behind it returns.{" "}
              {pop.source === "saved" ? (
                <>
                  This address is one <em>this browser saved</em> from a previous visit — the
                  arena stores whatever was last typed into its setup card — not one a deploy
                  produced.
                </>
              ) : pop.source === "url" ? (
                <>
                  It came from the <code>?population=</code> override in the address bar, which
                  is checked for shape and never for existence.
                </>
              ) : (
                <>It came from {pop.source}.</>
              )}{" "}
              Rather than take a signature against nothing, the form is withheld.
              <pre className="revert">{report.reason}</pre>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)", marginTop: "var(--s-3)" }}>
                {pop.source === "saved" ? (
                  <button className="btn" type="button" onClick={forgetSaved}>
                    Forget this address
                  </button>
                ) : null}
                <a className="btn" href="/arena/?demo=1">
                  See the offline demo
                </a>
                <a className="btn" href={addressUrl(population)} target="_blank" rel="noreferrer">
                  Open it in the explorer
                </a>
              </div>
            </div>
          </div>
        ) : report.verdict === "wrong" ? (
          /*
           *  There IS a contract here and it is not this one. The likeliest way anyone reaches
           *  this branch is the same as `absent`'s — a saved address from a previous deploy —
           *  except that the previous deploy left code behind, so nothing returns `0x` and the
           *  reads revert instead. It was filed under `unreachable` until 2026-09-06 and
           *  therefore told to leave the address alone and retry, which is the one instruction
           *  that cannot possibly help here.
           *
           *  Same affordance as `absent`, opposite sentence: `forgetSaved` is reused rather
           *  than rewritten so both branches drop the identical key.
           */
          <div className="notice notice-bad" data-rise>
            <span className="notice-mark">✕</span>
            <div>
              <b>There is a contract at this address, but it is not a Population.</b> All{" "}
              {report.total} reads against <code>{population}</code> <em>reverted</em> rather than
              returning empty, so something is deployed here and it does not answer this ABI — an
              arena from an earlier deploy, or an unrelated contract.{" "}
              {pop.source === "saved" ? (
                <>
                  The address is one <em>this browser saved</em> from a previous visit, which is
                  exactly how a superseded deploy outlives its season.
                </>
              ) : pop.source === "url" ? (
                <>
                  It came from the <code>?population=</code> override in the address bar, which is
                  checked for shape and never for what answers there.
                </>
              ) : (
                <>It came from {pop.source}.</>
              )}{" "}
              Retrying will not change this answer. The form is withheld.
              <pre className="revert">{report.reason}</pre>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)", marginTop: "var(--s-3)" }}>
                {pop.source === "saved" ? (
                  <button className="btn" type="button" onClick={forgetSaved}>
                    Forget this address
                  </button>
                ) : null}
                <a className="btn" href="/arena/?demo=1">
                  See the offline demo
                </a>
                <a className="btn" href={addressUrl(population)} target="_blank" rel="noreferrer">
                  Open it in the explorer
                </a>
              </div>
            </div>
          </div>
        ) : report.verdict === "unreachable" ? (
          /*
           *  Also nine failures, and deliberately NOT the same sentence. Nothing here says
           *  the address is wrong, because nothing here knows that — the chain never
           *  answered. Accusing a correct address during a testnet hiccup would send someone
           *  off to edit the one thing that was right.
           */
          <div className="notice notice-warn" data-rise>
            <span className="notice-mark">!</span>
            <div>
              <b>The chain did not answer.</b> All {report.total} reads against{" "}
              <code>{population}</code> failed without reaching it, so this is the network and
              not the address — the arena may be perfectly fine. The form is withheld only
              until one read succeeds, and it retries every twenty seconds.
              <pre className="revert">{report.reason}</pre>
            </div>
          </div>
        ) : (
          <div className="enter-grid">
            {/* ── left: the form ─────────────────────────────────────────── */}
            <div data-rise>
              <div className="steps">
                <div className={`step${step === 1 ? " is-now" : ""}${step > 1 ? " is-done" : ""}`}>
                  <span className="step-n">1</span>
                  <div className="step-what">
                    <b>faucet({symbol})</b>
                    Mint exactly what you are short. Testnet collateral, no value.
                  </div>
                  {step === 1 ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={doFaucet}
                      disabled={!isConnected || wrongChain || busy || typeof need !== "bigint"}
                    >
                      {faucetTx.isPending ? "Confirm in wallet…" : faucetRcpt.isLoading ? "Mining…" : "Mint"}
                    </button>
                  ) : (
                    // `step > 1`, never `step !== 1` — step 0 means the balance is unknown,
                    // and "funded" is a claim about a transaction, not a default.
                    <span className={`pill ${step > 1 ? "pill-ok" : ""}`}>
                      {step > 1 ? "funded" : "connect to quote"}
                    </span>
                  )}
                </div>

                <div className={`step${step === 2 ? " is-now" : ""}${step > 2 ? " is-done" : ""}`}>
                  <span className="step-n">2</span>
                  <div className="step-what">
                    <b>approve(Population, exact)</b>
                    <code>enter</code> pulls the endowment with <code>transferFrom</code>, so
                    it needs an allowance first.
                  </div>
                  {step === 2 ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={doApprove}
                      disabled={!isConnected || wrongChain || busy || typeof need !== "bigint"}
                    >
                      {approveTx.isPending
                        ? "Confirm in wallet…"
                        : approveRcpt.isLoading
                          ? "Mining…"
                          : "Approve"}
                    </button>
                  ) : (
                    <span className={`pill ${step > 2 ? "pill-ok" : ""}`}>
                      {step > 2 ? "approved" : "waiting"}
                    </span>
                  )}
                </div>

                <div className={`step${step === 3 ? " is-now" : ""}${born ? " is-done" : ""}`}>
                  <span className="step-n">3</span>
                  <div className="step-what">
                    <b>enter(genome, endowment)</b>
                    Payable. The attached STT becomes the organism&rsquo;s own inference
                    budget, and <code>retire</code> returns whatever it never spends.
                  </div>
                  <span className={`pill ${born ? "pill-ok" : ""}`}>
                    {born ? "alive" : "one signature"}
                  </span>
                </div>
              </div>

              <div className="field-row" style={{ marginTop: "var(--s-6)" }}>
                <label htmlFor="genome-text">Genome — the sentence your organism is</label>
                <div className="templates">
                  {TEMPLATES.map((t) => (
                    <button
                      className="tmpl"
                      type="button"
                      key={t.key}
                      aria-pressed={tmpl === t.key}
                      onClick={() => chooseTemplate(t)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <textarea
                  className="genome-input"
                  /* NOT `genome` — the genome BEAT owns that id, and `#genome` in the nav has
                     to land on the section, not on this textarea. */
                  id="genome-text"
                  value={genome}
                  spellCheck="true"
                  onChange={(e) => {
                    setGenome(e.target.value);
                    setTmpl("");
                  }}
                  placeholder="Describe, in one or two sentences, what makes you believe BTC goes up or down over the next fifteen minutes."
                />
                <div className="field-hint">
                  <span>
                    Rewrite it. Every template is a starting point, and a genome nobody else
                    wrote is the only kind worth entering.
                  </span>
                  <span className={bytes > 700 ? "over" : ""}>{bytes} bytes on chain</span>
                </div>
              </div>

              <div className="field-row">
                <label htmlFor="endow">Endowment — the collateral it gets to risk</label>
                <div className="amount">
                  <input
                    id="endow"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      setTouched(true);
                      setAmount(e.target.value);
                    }}
                    placeholder="10.00"
                  />
                  <span className="amount-unit">{symbol}</span>
                </div>
                <div className="field-hint">
                  <button
                    className="amount-min"
                    type="button"
                    onClick={() => {
                      setTouched(true);
                      if (typeof required === "bigint" && typeof decimals === "number") {
                        setAmount(formatUnits(required, decimals));
                      }
                    }}
                  >
                    Use the minimum
                  </button>
                  <span className={parsed !== undefined && typeof required === "bigint" && parsed < required ? "over" : ""}>
                    {/*
                      `required` resolving is NOT enough to print it. `fmtUnits` also needs
                      `decimals`, which cannot be requested until the arena read resolves
                      `collateral` — the same two-round-trip window that made the metabolic row
                      render `−null` before `fmtOutflow` existed. A minimum whose scale is
                      unknown is still unread, so this stays on the pending sentence until both
                      halves have landed rather than printing "minimum null tUSDC".
                    */}
                    {minText !== null
                      ? minText
                      : minFailed
                        ? "the contract did not return a minimum"
                        : "reading minimum…"}
                  </span>
                </div>
              </div>

              {/* ── gates, in the order a person hits them ───────────────── */}
              {!isConnected ? (
                <div className="notice" style={{ marginTop: "var(--s-5)" }}>
                  <span className="notice-mark">→</span>
                  <div style={{ display: "grid", gap: "var(--s-3)", justifyItems: "start" }}>
                    <span>Connect a wallet to quote your balances against the live minimums.</span>
                    <ConnectButton showBalance={false} />
                  </div>
                </div>
              ) : wrongChain ? (
                <div className="notice notice-warn" style={{ marginTop: "var(--s-5)" }}>
                  <span className="notice-mark">!</span>
                  <div style={{ display: "grid", gap: "var(--s-3)", justifyItems: "start" }}>
                    <span>
                      Your wallet is on chain {chainId}. This arena lives on Somnia Shannon,{" "}
                      {shannon.id}.
                    </span>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => switchChain({ chainId: shannon.id })}
                      disabled={switching}
                    >
                      {switching ? "Switching…" : "Switch to Shannon"}
                    </button>
                  </div>
                </div>
              ) : shortOfNative ? (
                <div className="notice notice-warn" style={{ marginTop: "var(--s-5)" }}>
                  <span className="notice-mark">!</span>
                  <div>
                    <b>Not enough STT to fund cognition.</b> One cognition endowment is{" "}
                    {fmtStt(cognition)} STT and you hold {fmtStt(nativeValue)}. That value is
                    not a fee — it becomes the organism&rsquo;s own balance, it pays{" "}
                    <code>0.033</code> STT per inference out of it, and <code>retire</code>{" "}
                    returns whatever is left.
                  </div>
                </div>
              ) : null}

              {born ? (
                <div className="notice notice-ok" style={{ marginTop: "var(--s-5)" }}>
                  <span className="notice-mark">✓</span>
                  <div>
                    <b>It is alive.</b> Your organism joins the next <code>think()</code> and
                    will be asked what BTC does. Watch it in{" "}
                    <a href="/arena/">the arena</a> — it appears as generation 0 with your
                    address as its entrant.
                  </div>
                </div>
              ) : txError ? (
                <div className="notice notice-bad" style={{ marginTop: "var(--s-5)" }}>
                  <span className="notice-mark">✕</span>
                  <div>
                    {txError}
                    {rawError ? <pre className="revert">{rawError.message ?? String(rawError)}</pre> : null}
                  </div>
                </div>
              ) : null}

              <div className="actions">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={doEnter}
                  disabled={!sim.data?.request || busy || step !== 3 || born}
                >
                  {enterTx.isPending
                    ? "Confirm in wallet…"
                    : enterRcpt.isLoading
                      ? "Being born…"
                      : sim.isLoading
                        ? "Checking…"
                        : "Enter the population"}
                </button>
                <a className="btn" href="/arena/">
                  Watch the arena
                </a>
              </div>
            </div>

            {/* ── right: what the contract says right now ─────────────────── */}
            <aside className="quote-panel" data-rise>
              <div className="quote-head">
                <span className="label">Quoted at this block</span>
                {/* The pulse is a claim that numbers are arriving. It stops when they are not. */}
                <span className={`pill${report.verdict === "live" && report.ok < report.total ? " pill-warn" : ""}`}>
                  <span className={`dot${report.verdict === "live" ? " dot-live" : ""}`} />
                  {report.verdict !== "live" ? "connecting" : report.ok < report.total ? `${report.ok}/${report.total}` : "live"}
                </span>
              </div>

              <div className="quote-rows">
                <div className="quote-row">
                  <span className="quote-k">Minimum endowment</span>
                  <Val tone="is-life" failed={minFailed}>{fmtUnits(required, decimals)}</Val>
                </div>
                <div className="quote-row">
                  <span className="quote-k">
                    Four antes{typeof level === "number" || typeof level === "bigint" ? ` · level ${level}` : ""}
                  </span>
                  <Val failed={readFailure(arena.data, 1)}>
                    {fmtUnits(typeof ante === "bigint" ? 4n * ante : undefined, decimals)}
                  </Val>
                </div>
                <div className="quote-row">
                  <span className="quote-k">Cognition, attached in STT</span>
                  <Val tone="is-heat" failed={readFailure(arena.data, 2)}>{fmtStt(cognition)}</Val>
                </div>
                <div className="quote-row">
                  <span className="quote-k">Metabolism per window</span>
                  <Val tone="is-heat" failed={readFailure(arena.data, 4)}>
                    {fmtOutflow(metabolic, decimals)}
                  </Val>
                </div>
                <div className="quote-row">
                  <span className="quote-k">Your {symbol}</span>
                  <Val tone={shortOfTokens ? "is-bad" : ""} failed={isConnected ? balanceFailed : null}>
                    {isConnected ? fmtUnits(balance, decimals) : "—"}
                  </Val>
                </div>
                <div className="quote-row">
                  <span className="quote-k">Approved to Population</span>
                  <Val tone={shortOfAllowance ? "is-bad" : ""} failed={isConnected ? allowanceFailed : null}>
                    {isConnected ? fmtUnits(allowance, decimals) : "—"}
                  </Val>
                </div>
                <div className="quote-row">
                  <span className="quote-k">Your STT</span>
                  <Val tone={shortOfNative ? "is-bad" : ""} failed={isConnected ? nativeFailed : null}>
                    {isConnected ? fmtStt(nativeValue) : "—"}
                  </Val>
                </div>
                <div className="quote-row">
                  <span className="quote-k">Population</span>
                  <Val failed={readFailure(arena.data, 7) ?? readFailure(arena.data, 8)}>
                    {living !== undefined && maxPop !== undefined
                      ? `${living} / ${maxPop}`
                      : null}
                  </Val>
                </div>
                <div className="quote-row">
                  <span className="quote-k">Season</span>
                  <Val failed={readFailure(arena.data, 6)}>
                    {seasonId !== undefined ? String(seasonId) : null}
                  </Val>
                </div>
              </div>

              <div className="quote-foot">
                <p className="fig-cap" style={{ marginTop: 0 }}>
                  {/* This sentence is a claim about live state, so it may only be made while
                      state is actually arriving. All nine failing never reaches here — that
                      is the "absent" branch above — but a degraded read still must not be
                      narrated as a healthy one. */}
                  {report.verdict !== "live" ? (
                    <>
                      Waiting for the first answer from <code>{population}</code>.{" "}
                    </>
                  ) : report.ok < report.total ? (
                    <>
                      <b>
                        {report.ok} of {report.total} reads answered
                      </b>{" "}
                      from <code>{population}</code>. The rest are marked unreadable above and
                      retried every twenty seconds — the numbers that did arrive are current.{" "}
                    </>
                  ) : (
                    <>
                      Read from <code>{population}</code> every twenty seconds, and requoted
                      after each confirmed transaction.{" "}
                    </>
                  )}
                  The ante doubles every level, so the minimum you see is the one this block
                  will accept — not the one the page was built with.
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </section>
  );
}
