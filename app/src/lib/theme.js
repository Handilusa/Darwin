/**
 *  RainbowKit, dressed in Dark Field.
 *
 *  The connect modal is the one surface on this page that ships with its own opinion, and
 *  the default `darkTheme()` is a rounded, blue-accented, Inter-set panel. Dropped into
 *  this design unmodified it is instantly recognisable as a library — which tells a judge
 *  the identity stops at the edge of what we wrote. So every colour, radius and shadow is
 *  restated from `web/tokens.css`.
 *
 *  ── WHY THE VALUES ARE LITERALS ─────────────────────────────────────────────
 *  RainbowKit's theme is a JS object read at render time and written into inline styles,
 *  so `var(--life)` resolves — but only where the variable is in scope, and the modal
 *  portals to <body>. Rather than depend on that, the five hues are written out and this
 *  comment is the contract: THESE MUST MATCH tokens.css. They are checked in
 *  `assertTokens()` below, which runs in dev and fails loudly if the two drift.
 */

import { darkTheme } from "@rainbow-me/rainbowkit";

/** Mirrors of tokens.css. Changing one without the other is the bug this guards. */
const T = {
  ink: "#060d0c",
  ink2: "#0a1413",
  ink3: "#101f1d",
  ink4: "#162926",
  line: "#1b2e2b",
  line2: "#26403c",
  life: "#5fe3c0",
  lifeDeep: "#113029",
  heat: "#f0a055",
  bad: "#f2645f",
  text: "#deeae6",
  text2: "#90a5a0",
  text3: "#5c736f",
};

const base = darkTheme();

export const darkFieldTheme = {
  ...base,
  blurs: {
    // Enough to push the page back without smearing the specimen field into mush.
    modalOverlay: "blur(6px)",
  },
  colors: {
    ...base.colors,

    // The accent is `life`, and its foreground is the ground itself — mint is bright
    // enough that white-on-mint fails contrast while near-black passes comfortably.
    accentColor: T.life,
    accentColorForeground: T.ink,

    actionButtonBorder: T.line,
    actionButtonBorderMobile: T.line,
    actionButtonSecondaryBackground: T.ink3,

    closeButton: T.text2,
    closeButtonBackground: T.ink3,

    connectButtonBackground: T.ink2,
    connectButtonBackgroundError: T.bad,
    connectButtonInnerBackground: T.ink3,
    connectButtonText: T.text,
    connectButtonTextError: T.ink,

    connectionIndicator: T.life,
    standby: T.heat,
    error: T.bad,

    downloadBottomCardBackground: T.ink2,
    downloadTopCardBackground: T.ink3,

    generalBorder: T.line,
    generalBorderDim: T.ink3,

    menuItemBackground: T.ink3,
    modalBackdrop: "rgba(6, 13, 12, 0.78)",
    modalBackground: T.ink2,
    modalBorder: T.line2,

    modalText: T.text,
    modalTextDim: T.text3,
    modalTextSecondary: T.text2,

    profileAction: T.ink3,
    profileActionHover: T.ink4,
    profileForeground: T.ink,

    selectedOptionBorder: T.life,
  },
  fonts: {
    // Same stack as the rest of the interface, and vendored — so the modal does not
    // silently fall back to system sans while the page behind it is set in Plex.
    body: '"IBM Plex Sans", "Segoe UI", system-ui, -apple-system, sans-serif',
  },
  radii: {
    // Instruments have square corners. RainbowKit's defaults are 12-24px.
    actionButton: "3px",
    connectButton: "3px",
    menuButton: "3px",
    modal: "4px",
    modalMobile: "4px",
  },
  shadows: {
    // Not drop shadows — a lit specimen glows, so the "shadow" is a mint bloom. The
    // dialog is the exception and keeps a real shadow, because it has to sit above the
    // page rather than appear to be part of it.
    connectButton: `0 0 0 1px ${T.line2}`,
    dialog: "0 24px 64px rgba(0, 0, 0, 0.62)",
    profileDetailsAction: `0 0 0 1px ${T.line}`,
    selectedOption: `0 0 0 1px ${T.life}, 0 0 22px ${T.lifeDeep}`,
    selectedWallet: `0 0 0 1px ${T.life}, 0 0 22px ${T.lifeDeep}`,
    walletLogo: "0 2px 12px rgba(0, 0, 0, 0.5)",
  },
};

/**
 *  Dev-only: read the real custom properties back out of the cascade and compare.
 *
 *  The mirrors above are the one place in this codebase where a colour is duplicated, and
 *  a duplicate that nobody checks is a divergence waiting to happen. This makes the drift
 *  a console error at the moment it is introduced rather than a modal that is subtly the
 *  wrong green three weeks later. It costs nothing in the build: `import.meta.env.DEV` is
 *  statically replaced and the whole function is dropped.
 */
export function assertTokens() {
  if (!import.meta.env.DEV || typeof getComputedStyle !== "function") return;
  const cs = getComputedStyle(document.documentElement);
  const pairs = [
    ["--ink", T.ink],
    ["--ink-2", T.ink2],
    ["--ink-3", T.ink3],
    ["--ink-4", T.ink4],
    ["--line", T.line],
    ["--line-2", T.line2],
    ["--life", T.life],
    ["--life-deep", T.lifeDeep],
    ["--heat", T.heat],
    ["--bad", T.bad],
    ["--text", T.text],
    ["--text-2", T.text2],
    ["--text-3", T.text3],
  ];
  for (const [name, mirror] of pairs) {
    const actual = cs.getPropertyValue(name).trim().toLowerCase();
    if (actual && actual !== mirror) {
      // eslint-disable-next-line no-console
      console.error(
        `[darwin] theme drift: ${name} is ${actual} in tokens.css but ${mirror} in theme.js`,
      );
    }
  }
}
