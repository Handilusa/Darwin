/**
 *  The sticky header. Brand, three anchors, and the wallet.
 *
 *  RainbowKit's `ConnectButton` is used rather than a hand-rolled one: the account/chain
 *  switching, the wrong-network state and the pending-connection state are exactly the
 *  places a bespoke button quietly breaks, and its modal is themed to match in
 *  `lib/theme.js`. `showBalance={false}` because the balance a judge needs is not their
 *  wallet's — it is the two the entry form quotes against the contract's live minimums.
 */

import { ConnectButton } from "@rainbow-me/rainbowkit";

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-in">
        <a className="brand" href="#top">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="15" cy="17" r="9.5" fill="none" stroke="var(--life)" strokeWidth="1.7" />
            <circle cx="15" cy="17" r="2.6" fill="var(--life)" />
            <circle cx="25.5" cy="6.5" r="2.2" fill="var(--ash)" />
          </svg>
          Darwin
        </a>

        <nav className="nav-links" aria-label="Sections">
          <a className="nav-link" href="#window">
            The window
          </a>
          <a className="nav-link" href="#death">
            Death
          </a>
          <a className="nav-link" href="/arena/">
            Arena
          </a>
          <a className="nav-link" href="#enter">
            Enter
          </a>
        </nav>

        <ConnectButton
          showBalance={false}
          accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
          chainStatus={{ smallScreen: "icon", largeScreen: "icon" }}
        />
      </div>
    </header>
  );
}
