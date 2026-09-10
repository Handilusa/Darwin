/**
 *  Beat 6 on the landing, with the transactions taken out of it.
 *
 *  ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *  Until 2026-09-08 the landing mounted `<Enter />` inline: five explanatory beats and then
 *  a live three-transaction console in the same scroll, wallet prompt included. The
 *  instruction that produced this file was explicit — the landing is *información e
 *  instrucciones*, and `faucet` / `approve` / `enter` belong on a separate console. So the
 *  form moved to `/enter/` (`src/Console.jsx`) and this is what stayed behind: the same
 *  argument, the same three steps, as text.
 *
 *  ── WHAT IT MAY AND MAY NOT DO ──────────────────────────────────────────────
 *  No wagmi, no writes, no `ConnectButton`, and deliberately **no `.enter-grid`** — that
 *  class is how both browser suites detect "the form rendered", so emitting it here would
 *  make the assertion that the landing carries no form unable to fail. `test/landing.mjs`
 *  check 7 asserts the absence of every write affordance on this page; keep it that way.
 *
 *  `usePopulation` is the one hook it does use, and it reads no chain: it resolves *which*
 *  address the page is about from the URL, localStorage, `web/config.js` and the manifest.
 *  Two things on this page depend on that answer and both are information rather than
 *  functionality:
 *
 *    · a `?population=` that failed `isAddress` was thrown away, and a page that quietly
 *      shows a different arena than the URL asked for is lying by omission. The arena
 *      forces its setup card open for the same case (`web/js/render.js`); this is the
 *      landing's version, and it is the only place on this surface that can say it now
 *      that `Enter.jsx` is on another page.
 *    · with nothing deployed, "go and enter an organism" is an invitation to a revert.
 */

import { addressUrl } from "../../../web/config.js";
import { CHAIN_ID } from "../lib/wagmi.js";
import { usePopulation } from "../lib/population.js";
import { useReveal } from "../motion/hooks.js";

/**
 *  The three calls, in the order a wallet has to sign them. Copy is the console's own
 *  (`sections/Enter.jsx:624-687`) so a visitor who clicks through reads the same sentences
 *  next to the live buttons — a second wording would read as a second mechanism.
 */
const STEPS = [
  {
    n: "1",
    call: "faucet(tUSDC)",
    what: "Mint exactly what you are short. Testnet collateral, no value.",
  },
  {
    n: "2",
    call: "approve(Population, exact)",
    what: (
      <>
        <code>enter</code> pulls the endowment with <code>transferFrom</code>, so it needs an
        allowance first. The console approves the exact amount, never an unlimited one.
      </>
    ),
  },
  {
    n: "3",
    call: "enter(genome, endowment)",
    what: (
      <>
        Payable. The attached STT becomes the organism&rsquo;s own inference budget, and{" "}
        <code>retire</code> returns whatever it never spends.
      </>
    ),
  },
];

export function EnterInvite() {
  const ref = useReveal();
  const pop = usePopulation();

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

        {pop.badQuery ? (
          <div className="notice notice-warn" data-rise style={{ marginBottom: "var(--s-5)" }}>
            <span className="notice-mark">!</span>
            <div>
              <b>That address in the URL was ignored.</b> <code>?population=</code> carried{" "}
              <code>{pop.badQuery}</code>, which is not a 20-byte address, so it was rejected
              before any read was attempted and this page fell through to whatever it would
              have used without it. Everything here refers to{" "}
              {pop.status === "found" ? <code>{pop.address}</code> : "no arena at all"}, not to
              what you typed.
            </div>
          </div>
        ) : null}

        {pop.status === "undeployed" ? (
          <div className="notice notice-warn" data-rise style={{ marginBottom: "var(--s-5)" }}>
            <span className="notice-mark">!</span>
            <div>
              <b>No arena is deployed yet.</b> Season 0 has not been seeded, so there is no
              contract to enter. The whole mechanism is reviewable right now without one:{" "}
              <a href="/arena/?demo=1">the offline demo</a> runs the real renderer over a
              scripted season, and every figure in it is computed from that demo&rsquo;s own
              configuration through the real breeding and settlement rules.
            </div>
          </div>
        ) : null}

        <div className="enter-invite" data-rise>
          <div className="steps">
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <span className="step-n">{s.n}</span>
                <div className="step-what">
                  <b>{s.call}</b>
                  {s.what}
                </div>
              </div>
            ))}
          </div>

          <p className="prose" style={{ marginTop: "var(--s-6)" }}>
            Those three signatures live on their own page, so this one can be read end to end
            without a wallet ever being asked for.{" "}
            {pop.status === "found" ? (
              <>
                The console quotes every minimum off{" "}
                <a href={addressUrl(pop.address)} target="_blank" rel="noreferrer noopener">
                  the live contract
                </a>{" "}
                on chain <code>{CHAIN_ID}</code> and simulates <code>enter</code> before it
                offers you anything to sign.
              </>
            ) : (
              <>
                It quotes every minimum off the contract itself and simulates{" "}
                <code>enter</code> before it offers you anything to sign.
              </>
            )}
          </p>

          <div className="hero-cta" style={{ marginTop: "var(--s-5)" }}>
            <a className="btn btn-primary" href="/enter/">
              Launch App
            </a>
            <a className="btn" href="/arena/">
              Watch the arena
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
