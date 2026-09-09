/**
 *  The sticky header, shared by both documents in this build.
 *
 *  RainbowKit's `ConnectButton` is used rather than a hand-rolled one: the account/chain
 *  switching, the wrong-network state and the pending-connection state are exactly the
 *  places a bespoke button quietly breaks, and its modal is themed to match in
 *  `lib/theme.js`. `showBalance={false}` because the balance a judge needs is not their
 *  wallet's — it is the two the entry form quotes against the contract's live minimums.
 *
 *  ── WHY THE WALLET IS A PROP AND DEFAULTS TO OFF ─────────────────────────────
 *  Since 2026-09-08 the transactional surface is its own page (`/enter/`, `Console.jsx`) and
 *  the landing is information only. A `ConnectButton` in the landing's header would put the
 *  first step of a signing flow in front of someone who came to read — the exact thing the
 *  split was asked for to undo — so the landing gets a link to the console in that slot and
 *  the console gets the wallet. `test/landing.mjs` check 2 asserts the landing renders no
 *  connect button; `test/console.mjs` asserts the console does.
 *
 *  `links` is a prop for a duller reason: `#window` and `#death` are landing anchors, and on
 *  `/enter/` an anchor to a section that is not in the document scrolls nowhere and reports
 *  nothing. Absolute paths on that page, anchors on this one.
 */

import { ConnectButton } from "@rainbow-me/rainbowkit";

/**
 *  The landing's own three. "Enter" is deliberately not among them — it is the primary
 *  action and it is in the slot to the right, and the same word twice in one header reads
 *  as two different destinations.
 */
const LANDING_LINKS = [
  { href: "#window", label: "The window" },
  { href: "#death", label: "Death" },
  { href: "/arena/", label: "Arena" },
];

export function Nav({ home = "#top", links = LANDING_LINKS, wallet = false }) {
  return (
    <header className="nav">
      <div className="wrap nav-in">
        <a className="brand" href={home}>
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="15" cy="17" r="9.5" fill="none" stroke="var(--life)" strokeWidth="1.7" />
            <circle cx="15" cy="17" r="2.6" fill="var(--life)" />
            <circle cx="25.5" cy="6.5" r="2.2" fill="var(--ash)" />
          </svg>
          Darwin
        </a>

        <nav className="nav-links" aria-label="Sections">
          {links.map((l) => (
            <a className="nav-link" href={l.href} key={l.href}>
              {l.label}
            </a>
          ))}
        </nav>

        {wallet ? (
          <ConnectButton
            showBalance={false}
            accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            chainStatus={{ smallScreen: "icon", largeScreen: "icon" }}
          />
        ) : (
          <a className="btn btn-primary nav-cta" href="/enter/">
            Enter
          </a>
        )}
      </div>
    </header>
  );
}
