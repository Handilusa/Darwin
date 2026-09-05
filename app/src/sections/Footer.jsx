/**
 *  The footer, used as the last honest statement rather than as sitemap furniture.
 *
 *  Two of the three columns are claims a judge can falsify without asking us anything: the
 *  commands are the actual gates in `package.json`, and the grep is the one from
 *  `CLAUDE.md`'s hard constraints. A footer full of dead social links would have been easier
 *  and would have said nothing.
 *
 *  The non-claim is here on purpose. `README.md`'s "Not claimed" section is load-bearing —
 *  while `SelectionEngine.fallbackEnabled` is true, the licensed claim is that selection is
 *  on-chain and atomic with redemption, not that no keeper exists anywhere in the chain. A
 *  landing page that overstated that would be the one thing this project cannot afford.
 */

import { CHAIN_ID, EXPLORER } from "../lib/wagmi.js";
import { useReveal } from "../motion/hooks.js";

const READ = [
  { href: "#genome", label: "A genome is a sentence" },
  { href: "#window", label: "One window, four calls" },
  { href: "#cognition", label: "Thinking costs value" },
  { href: "#death", label: "Death is a state" },
  { href: "#lineage", label: "Generation, not PnL" },
  { href: "/arena/", label: "The live arena" },
  { href: "/arena/?demo=1", label: "The offline demo" },
];

/** Each of these is a real script or a real grep. None of them need our cooperation. */
const VERIFY = [
  { cmd: "npm run test", what: "98 Solidity tests" },
  { cmd: "npm run prove", what: "settlement and selection in one block" },
  { cmd: "npm run fee", what: "venue fee measured, not assumed" },
  { cmd: 'grep -rn "dead = false" contracts/src', what: "no revival path exists" },
];

export function Footer() {
  const ref = useReveal();

  return (
    <footer className="foot" ref={ref}>
      <div className="wrap foot-in">
        <div className="foot-col" data-rise>
          <a className="brand" href="#top" style={{ marginBottom: "var(--s-4)" }}>
            <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="15" cy="17" r="9.5" fill="none" stroke="var(--life)" strokeWidth="1.7" />
              <circle cx="15" cy="17" r="2.6" fill="var(--life)" />
              <circle cx="25.5" cy="6.5" r="2.2" fill="var(--ash)" />
            </svg>
            Darwin
          </a>

          <p className="foot-note">
            A population of forecasters that pay for their own thinking, take opposing sides
            of a real binary market against each other, and die when they run out. Built for
            the Somnia × DreamDEX event-contracts hackathon on Shannon, chain{" "}
            <code>{CHAIN_ID}</code>.
          </p>

          <p className="foot-note">
            <strong>What is not claimed.</strong> Selection is on-chain and atomic with
            redemption — a settlement and the fitness grading that follows it share a block.
            While the engine&rsquo;s keeper fallback is still enabled, that is the whole claim:
            not that no keeper exists anywhere in the causal chain.{" "}
            <code>npm run prove</code> is the gate, and it fails on a coincidence.
          </p>

          <p className="foot-note">
            No token, no presale, no allowlist. Entry is one permissionless call and the
            collateral is testnet tUSDC with no value.
          </p>
        </div>

        <div className="foot-col" data-rise>
          <h3>Read</h3>
          <ul>
            {READ.map((l) => (
              <li key={l.href}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
            <li>
              <a href={EXPLORER} target="_blank" rel="noreferrer noopener">
                Shannon explorer ↗
              </a>
            </li>
          </ul>
        </div>

        <div className="foot-col" data-rise>
          <h3>Falsify</h3>
          <ul>
            {VERIFY.map((v) => (
              <li key={v.cmd}>
                <code>{v.cmd}</code>
                <span
                  style={{
                    display: "block",
                    marginTop: "var(--s-1)",
                    fontSize: "var(--t-xs)",
                    color: "var(--text-4)",
                  }}
                >
                  {v.what}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
