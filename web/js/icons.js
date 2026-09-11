/**
 *  Inline SVG icons replacing raw emoji characters for a cleaner, transparent look.
 *  Each function returns a `<span class="icon icon-{name}">` wrapping an inline SVG.
 *  SVGs use `currentColor` and clean paths so they inherit the surrounding text color automatically.
 *
 *  Usage:  import { iconCrown } from "./icons.js";
 *          el("span", {}, iconCrown(), " Inspect Leader")
 */

import { el } from "./dom.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Build a tiny inline SVG icon wrapped in a span. */
function icon(name, pathD, { viewBox = "0 0 24 24", size = "1em", stroke = false, strokeWidth = 2, extra = [] } = {}) {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", viewBox);
  s.setAttribute("width", size);
  s.setAttribute("height", size);
  if (stroke) {
    s.setAttribute("fill", "none");
    s.setAttribute("stroke", "currentColor");
    s.setAttribute("stroke-width", String(strokeWidth));
    s.setAttribute("stroke-linecap", "round");
    s.setAttribute("stroke-linejoin", "round");
  } else {
    s.setAttribute("fill", "currentColor");
  }
  s.setAttribute("aria-hidden", "true");
  if (s.style && typeof s.style.setProperty === "function") {
    s.style.setProperty("vertical-align", "middle");
    s.style.setProperty("display", "inline-block");
    s.style.setProperty("opacity", "0.85");
  }

  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", pathD);
  s.appendChild(p);

  for (const ep of extra) {
    const e = document.createElementNS(SVG_NS, ep.tag || "path");
    for (const [k, v] of Object.entries(ep)) {
      if (k !== "tag") e.setAttribute(k, v);
    }
    s.appendChild(e);
  }

  return el("span", { class: `icon icon-${name}` }, s);
}

/** 👑 Crown — rank #1 leader */
export function iconCrown() {
  return icon("crown",
    "M2 20h20v2H2zm1-2h18l-2-8-4 4-3-6-3 6-4-4z",
  );
}

/** 🔥 Fire — win streak */
export function iconFire() {
  return icon("fire",
    "M12 23c-4.97 0-8-3.58-8-8 0-3.07 2.1-6.37 4.2-8.54L12 3l3.8 3.46C17.9 8.63 20 11.93 20 15c0 4.42-3.03 8-8 8zm0-17.17l-2.34 2.13C7.9 9.66 6 12.36 6 15c0 3.31 2.69 6 6 6s6-2.69 6-6c0-2.64-1.9-5.34-3.66-7.04L12 5.83z",
  );
}

/** 🌱 Seedling — incubation / birth */
export function iconSeedling() {
  return icon("seedling",
    "M12 22V12M12 12C12 7 7 2 2 2c0 5 5 10 10 10zm0 0c0-5 5-10 10-10 0 5-5 10-10 10z",
    { extra: [{ tag: "path", d: "M12 22V12", fill: "none", stroke: "currentColor", "stroke-width": "2" }] },
  );
}

/** 💀 Skull — dead organism */
export function iconSkull() {
  return icon("skull",
    "M12 2C6.48 2 2 6.48 2 12c0 3.07 1.39 5.81 3.57 7.63L7 22h4v-2h2v2h4l1.43-2.37C20.61 17.81 22 15.07 22 12c0-5.52-4.48-10-10-10zm-3 13a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm6 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z",
  );
}

/** 🏆 Trophy — high edge / undefeated */
export function iconTrophy() {
  return icon("trophy",
    "M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0011 15.9V19H7v2h10v-2h-4v-3.1a5.01 5.01 0 003.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z",
  );
}

/** ⚡ Lightning — coin-flipper / battles */
export function iconLightning() {
  return icon("lightning",
    "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  );
}

/** 🧠 Brain — thinking / genomes */
export function iconBrain() {
  return icon("brain",
    "M12 2C9 2 7 4 7 6.5c0 .5.08 1 .22 1.45A4.5 4.5 0 004 12.5c0 1.6.84 3 2.1 3.8A4 4 0 008 22h3v-9.5L9.5 11 11 9.5V6a1 1 0 012 0v3.5L14.5 11 13 12.5V22h3a4 4 0 001.9-5.7A4.47 4.47 0 0020 12.5a4.5 4.5 0 00-3.22-4.55c.14-.45.22-.95.22-1.45C17 4 15 2 12 2z",
  );
}

/** 🧪 Flask — demo / experiment */
export function iconFlask() {
  return icon("flask",
    "M9 2v7.59L4.7 17.3A2 2 0 006.4 20h11.2a2 2 0 001.7-2.7L15 9.59V2h1V0H8v2h1zm2 0h2v8l4.3 7H6.7L11 10V2z",
    { viewBox: "0 0 24 22" },
  );
}

/** ⚔️ Crossed swords — live arena */
export function iconSwords() {
  return icon("swords",
    "M6.92 5L1 11l5.07 5.07 1.42-1.42L4.83 12h4.59L16 19.59 17.41 18.17 11.83 12l5.58-5.58-1.42-1.42L9.41 11H4.83l2.66-2.66L6.07 6.92 6.92 5zM17.08 5l.85.85-1.42 1.42L19.17 10h-4.59L8 3.41 9.41 2l6.59 6.59L17.08 5z",
    { viewBox: "0 2 22 22" },
  );
}

/** 📡 Antenna — chain feed / system */
export function iconAntenna() {
  return icon("antenna",
    "M12 10a2 2 0 100-4 2 2 0 000 4zm0 2a4 4 0 01-3.46-6h-.01A6 6 0 006 12a6 6 0 006 6 6 6 0 006-6 6 6 0 00-2.53-5.97A4 4 0 0112 12zm0-10a8 8 0 00-8 8c0 3.03 1.7 5.66 4.19 7L11 22h2l2.81-5A8 8 0 0012 2z",
  );
}

/** ⚖️ Scale — neutral diagnosis */
export function iconScale() {
  return icon("scale",
    "m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z",
    {
      stroke: true,
      strokeWidth: 2,
      extra: [
        { tag: "path", d: "m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" },
        { tag: "path", d: "M7 21h10" },
        { tag: "path", d: "M12 3v18" },
        { tag: "path", d: "M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" },
      ],
    },
  );
}

/** ⚠️ Warning — drawdown / mutation candidate */
export function iconWarning() {
  return icon("warning",
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z",
    {
      stroke: true,
      strokeWidth: 2,
      extra: [
        { tag: "path", d: "M12 9v4" },
        { tag: "path", d: "M12 17h.01" },
      ],
    },
  );
}

/**
 *  Convenience: return a DocumentFragment containing an icon and text node.
 */
export function iconLabel(iconFn, text) {
  const f = document.createDocumentFragment();
  f.appendChild(iconFn());
  f.appendChild(document.createTextNode(` ${text}`));
  return f;
}
