/**
 *  The entry console — `/enter/`, the second page of this build.
 *
 *  ── WHY IT IS A PAGE AND NOT A ROUTE ────────────────────────────────────────
 *  There is no router here and there deliberately still isn't one. `app/enter/index.html` is
 *  a second Rollup input, so Vite emits `dist/enter/index.html` and the host serves it as a
 *  real document at `/enter/`. Two static entry points, no history API, no client-side
 *  routing table to keep in step with `vercel.json` — and the landing keeps loading exactly
 *  what it loaded before, minus the transactional half.
 *
 *  ── WHAT MOVED AND WHAT DID NOT ─────────────────────────────────────────────
 *  `sections/Enter.jsx` is mounted here **byte for byte unchanged**. It is 955 lines of live
 *  reads, four withholding branches and a pre-signature simulation, and the day of a
 *  submission is not the day to rewrite it; the whole change is *where* it is mounted. The
 *  landing kept beat 6 as `sections/EnterInvite.jsx`, which is the same argument as text with
 *  no wallet in it.
 *
 *  ── THE HEADER IS NOT THE LANDING'S ─────────────────────────────────────────
 *  `Nav`'s default links are landing anchors (`#window`, `#death`), and an anchor to a
 *  section that does not exist on this document scrolls nowhere and says nothing. So this
 *  page passes its own set: back to the argument, across to the arena. The `ConnectButton`
 *  lives here and only here — it is the entrance to the three signatures, and putting it in
 *  front of someone who came to read would be the same mistake this split exists to undo.
 */

import { useState, useEffect } from "react";
import { Nav } from "./sections/Nav.jsx";
import { WalletDashboard } from "./sections/WalletDashboard.jsx";
import { Enter } from "./sections/Enter.jsx";
import { AdvancedArena } from "./sections/AdvancedArena.jsx";
import { IconChart, IconRocket, IconGear } from "./icons.jsx";
import { Footer } from "./sections/Footer.jsx";

/** Two ways out, both absolute: this document is not the one the anchors belong to. */
const LINKS = [
  { href: "/", label: "The argument" },
  { href: "/enter/", label: "App" },
  { href: "/arena/", label: "Arena" },
];

const TAB_KEY = "darwin.console.tab";

export default function Console() {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const h = globalThis.location?.hash;
      if (h === "#enter" || h === "#launch") return "launch";
      if (h === "#advanced") return "advanced";
      if (h === "#dashboard") return "dashboard";
      return localStorage.getItem(TAB_KEY) || "dashboard";
    } catch {
      return "dashboard";
    }
  });

  useEffect(() => {
    function onHash() {
      const h = globalThis.location?.hash;
      if (h === "#enter" || h === "#launch") setActiveTab("launch");
      else if (h === "#advanced") setActiveTab("advanced");
      else if (h === "#dashboard") setActiveTab("dashboard");
    }
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function handleGoTo(tabId) {
    setActiveTab(tabId);
    try {
      localStorage.setItem(TAB_KEY, tabId);
    } catch {}
    const targetId = tabId === "launch" ? "enter" : tabId;
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  return (
    <>
      <a className="vh" href="#enter">
        Skip to the entry form
      </a>

      <Nav home="/" links={LINKS} wallet />

      <main>
        {/*
          A one-line crumb above the form. Someone can arrive here from the arena, from a
          shared link or from the nav, and the console's own head starts at "06 · Enter" —
          which is continuity with the landing for a visitor who scrolled there, and a
          number with no series for one who did not.
        */}
        <div className="console-crumb-bar">
          <div className="wrap console-crumb">
            <span className="label">Darwin App</span>
            <span className="console-crumb-sep">·</span>
            <span className="console-crumb-text">
              Unified console: inspect your wallet, mint collateral, launch organisms and explore
              arena climate rules. Narrative explanation on <a href="/">the landing</a>; live colosseum
              in <a href="/arena/">the arena</a>.
            </span>
          </div>
        </div>

        {/* ── Sticky Subnavigation Tab Bar ── */}
        <nav className="console-tabs-bar" aria-label="Console views">
          <div className="wrap console-tabs-in">
            <button
              className={`console-tab ${activeTab === "dashboard" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleGoTo("dashboard")}
            >
              <span className="tab-icon"><IconChart size={15} /></span>
              <span>Wallet Dashboard</span>
            </button>
            <button
              className={`console-tab ${activeTab === "launch" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleGoTo("launch")}
            >
              <span className="tab-icon"><IconRocket size={15} /></span>
              <span>Launch Organism</span>
            </button>
            <button
              className={`console-tab ${activeTab === "advanced" ? "is-active" : ""}`}
              type="button"
              onClick={() => handleGoTo("advanced")}
            >
              <span className="tab-icon"><IconGear size={15} /></span>
              <span>Rules &amp; Advanced</span>
            </button>
          </div>
        </nav>

        <div id="dashboard">
          <WalletDashboard onGoToLaunch={() => handleGoTo("launch")} />
        </div>

        <Enter />

        <div id="advanced">
          <AdvancedArena />
        </div>
      </main>

      {/* `base="/"` because the footer's reading list is landing anchors, and from this
          document `#genome` is nowhere. See the prop's comment in Footer.jsx. */}
      <Footer base="/" />
    </>
  );
}
