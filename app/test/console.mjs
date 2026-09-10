/**
 *  Drive `/enter/` — the entry console — over CDP, on the WALL CLOCK.
 *
 *  ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *  Until 2026-09-08 the three transactions lived on the landing and `test/landing.mjs`
 *  asserted their behaviour there. They moved to a page of their own, so these checks moved
 *  with them rather than being deleted — in particular the one that matters most, that an
 *  address with no contract behind it WITHHOLDS the form instead of taking a signature
 *  against nothing. `landing.mjs` now asserts the complement: that none of this appears on
 *  the page that is supposed to be information only.
 *
 *  Two failure modes are specific to this page being a second Rollup input, and both are
 *  invisible under `npm run dev`:
 *
 *    - `vite.config.js` not naming `enter/index.html` as an input. `npm run build` succeeds,
 *      `dist/enter/` never exists, and every link to it 404s in production only.
 *    - Vite's SPA html-fallback answering `/enter` (no trailing slash) with the LANDING's
 *      document — a wrong page with a 200, which looks like nothing is broken.
 *
 *  Check 2 is written to catch both: it requires the console's own furniture AND the absence
 *  of the landing's.
 *
 *  Checks, in order:
 *    1. no console errors, no unhandled rejections
 *    2. this is the console and not the landing served under its URL
 *    3. the footer's in-page anchors point at `/#…`, not at sections of this document
 *    4. the three vendored families loaded (a second HTML entry resolves them again)
 *    5. nothing is stranded at opacity 0 — `useReveal` hides before it shows
 *    6. the entry surface renders either the whole form or a named notice
 *    7. an address with no contract behind it withholds the form — with its control
 *    8. a malformed ?population= is said out loud
 *
 *  Usage: node test/console.mjs [url]        (default http://localhost:3000/enter/)
 */

import { launch, classify, sleep } from "./cdp.mjs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3000/enter/";
const fail = [];

const session = await launch({ watchdogMs: 180_000, windowSize: "1440,900" });
if (!session) process.exit(process.env.REQUIRE_BROWSER === "1" ? 1 : 0);
const { send, evaluate, events, note, forget, close } = session;

note(`target    ${URL_UNDER_TEST}`);

const t0 = Date.now();
await send("Page.navigate", { url: URL_UNDER_TEST });
// Longer than the landing's settle: the form's nine-read batch has to land before the page
// stops being a skeleton, and `retry: 1` means each read is attempted twice before failing.
await sleep(6000);
note(`navigated + settled at ${Date.now() - t0}ms (wall clock)`);

/* ── 1. errors ───────────────────────────────────────────────────────────── */
const { logErrors, apiErrors, warnings, exceptions, failedReqs } = classify(events);

if (logErrors.length) fail.push(`browser errors:\n    ${logErrors.join("\n    ")}`);
if (apiErrors.length) fail.push(`console.error from page:\n    ${apiErrors.join("\n    ")}`);
if (exceptions.length) fail.push(`exceptions:\n    ${exceptions.join("\n    ")}`);
if (failedReqs.length) note(`  (network failures: ${failedReqs.join(", ")})`);
// `assertTokens` runs in `enter.jsx` exactly as it does in `main.jsx`, and this page loads
// `tokens.css` through a second HTML entry — a warning here means the second entry resolved a
// different stylesheet than the landing did.
if (warnings.length) fail.push(`console.warn from page:\n    ${warnings.join("\n    ")}`);
note(`browser errors ${logErrors.length} · console.error ${apiErrors.length} · warn ${warnings.length} · exceptions ${exceptions.length}`);

/* ── 2. this is the console, not the landing ─────────────────────────────── */
const struct = await evaluate(`(() => ({
  enter: !!document.getElementById("enter"),
  crumb: !!document.querySelector(".console-crumb"),
  connect: !!document.querySelector('[data-testid="rk-connect-button"]'),
  navCta: !!document.querySelector(".nav-cta"),
  home: !!document.querySelector('.brand[href="/"]'),
  backToLanding: !!document.querySelector('.console-crumb a[href="/"]'),
  arenaLink: !!document.querySelector('a[href="/arena/"]'),
  /* The landing's furniture. None of it may be here. */
  heroField: !!document.querySelector(".field canvas"),
  genomeBeat: !!document.getElementById("genome"),
  invite: !!document.querySelector(".enter-invite"),
  title: document.title,
}))()`);
note(`title     ${JSON.stringify(struct.title)}`);
note(
  `console: #enter=${struct.enter} crumb=${struct.crumb} connect=${struct.connect} ` +
    `back=${struct.backToLanding} · landing leakage: hero=${struct.heroField} #genome=${struct.genomeBeat} invite=${struct.invite}`,
);

if (!struct.enter) fail.push("no #enter section — the console has no entry surface at all");
if (!struct.crumb) fail.push(".console-crumb is missing: nothing on this page says where it sits relative to the landing and the arena");
if (!struct.connect) {
  fail.push(
    "no RainbowKit ConnectButton. This page's whole job is the three signatures, and the nav is where the wallet " +
      "lives (`Console.jsx` passes `wallet` to `Nav`) — without it the form's own connect gate is the only way in.",
  );
}
if (struct.navCta) {
  fail.push(
    "the nav still renders the .nav-cta link to /enter/ — that is the LANDING's right-hand slot; on this page the " +
      "slot is the wallet, and a button linking to the page you are already on is a dead end.",
  );
}
if (!struct.home) fail.push('the brand does not link to "/" — the console is a leaf page and must offer the way back');
if (!struct.backToLanding) fail.push("the crumb does not link back to the landing");
if (!struct.arenaLink) fail.push("nothing on the console links to /arena/");
if (struct.heroField || struct.genomeBeat || struct.invite) {
  fail.push(
    `the LANDING is being served at ${URL_UNDER_TEST} (hero=${struct.heroField} #genome=${struct.genomeBeat} ` +
      `invite=${struct.invite}). Either \`rollupOptions.input\` does not name enter/index.html, or a request for ` +
      `/enter fell through to Vite's html fallback — see the header of this file.`,
  );
}

/* ── 3. the footer's anchors leave this document ─────────────────────────── */
//
// `Footer` takes a `base` prop for exactly this: `#genome` is a section of the LANDING, and a
// bare `#genome` in this document scrolls nowhere at all — a silently dead reading list. The
// inverse mistake is just as easy: prefixing `/arena/` would produce `//arena/`, which is a
// protocol-relative URL and leaves the site entirely.
const footLinks = await evaluate(`(() => {
  const a = [...document.querySelectorAll(".foot a")].map(x => x.getAttribute("href"));
  return {
    bare: a.filter(h => h && h.startsWith("#")),
    rewritten: a.filter(h => h && h.startsWith("/#")),
    protocolRelative: a.filter(h => h && h.startsWith("//")),
    total: a.length,
  };
})()`);
note(`footer: ${footLinks.total} links · rewritten ${footLinks.rewritten.length} · bare ${JSON.stringify(footLinks.bare)}`);
if (footLinks.bare.length) {
  fail.push(
    `the footer carries in-page anchors on a page that has no such sections: ${footLinks.bare.join(", ")}. ` +
      `\`Footer\` needs base="/" here (Console.jsx) or every reading-list link scrolls nowhere.`,
  );
}
if (!footLinks.rewritten.length) {
  fail.push("no /#… links in the footer at all, so check 3 is measuring nothing — the reading list should have five");
}
if (footLinks.protocolRelative.length) {
  fail.push(
    `the footer produced protocol-relative URLs: ${footLinks.protocolRelative.join(", ")} — \`base\` was applied to ` +
      `an already-absolute path and those links now leave the site.`,
  );
}

/* ── 4. fonts ────────────────────────────────────────────────────────────── */
const fonts = await evaluate(`(async () => {
  await document.fonts.ready;
  const want = ["Newsreader", "IBM Plex Sans", "IBM Plex Mono"];
  const loaded = [...document.fonts].map(f => f.family.replace(/"/g, ""));
  return want.map(w => [w, loaded.includes(w) && document.fonts.check("16px " + JSON.stringify(w))]);
})()`);
const badFonts = fonts.filter(([, ok]) => !ok).map(([f]) => f);
if (badFonts.length) fail.push(`fonts did not load on the second HTML entry: ${badFonts.join(", ")}`);
note(`fonts: ${fonts.map(([f, ok]) => `${f}${ok ? "OK" : "MISSING"}`).join(" · ")}`);

/* ── 5. nothing stranded at opacity 0 ────────────────────────────────────── */
//
// `useReveal` hides `[data-rise]` and then animates it back — so a hook that never fires
// leaves the whole page invisible while the DOM looks perfect. It adds `.rise` INSIDE the
// effect and `reducedMotion()` returns before hiding anything (`motion/hooks.js:47`), which is
// what makes this safe on a standalone page; this check is what proves it, because reading the
// hook is not the same as running it under a fresh document.
await evaluate(`document.querySelector("#enter").scrollIntoView({behavior:"instant",block:"start"})`);
await sleep(1600);
const stranded = await evaluate(`(() => {
  const out = [];
  for (const el of document.querySelectorAll("[data-rise]")) {
    const r = el.getBoundingClientRect();
    if (!(r.top < innerHeight * 0.9 && r.bottom > 0)) continue;
    if (parseFloat(getComputedStyle(el).opacity) < 0.5) {
      out.push((el.className || el.tagName) + " :: " + el.textContent.trim().slice(0, 48));
    }
  }
  return { stuck: out, rises: document.querySelectorAll("[data-rise]").length };
})()`);
note(`[data-rise] ${stranded.rises} · stranded ${stranded.stuck.length}`);
if (stranded.stuck.length) fail.push(`invisible after reveal:\n    ${stranded.stuck.join("\n    ")}`);
if (stranded.rises === 0) {
  fail.push("no [data-rise] elements on the console, so check 5 cannot fail — the reveal hook is not wired here at all");
}

/*//////////////////////////////////////////////////////////////
                      THE FORM, AND ITS ABSENCE
//////////////////////////////////////////////////////////////*/

/**
 *  ONE probe, run against three navigations — the same shape `landing.mjs` uses and for the
 *  same reason. What distinguishes a working `absent` branch from a broken one is a DIFFERENCE
 *  between two pages, so the assertions compare readings rather than inspecting one.
 */
const PROBE = `(() => {
  const s = document.querySelector("#enter");
  const txt = s ? s.textContent : "";
  return {
    hasGrid: !!(s && s.querySelector(".enter-grid")),
    templates: document.querySelectorAll(".tmpl").length,
    genomeBox: !!document.getElementById("genome-text"),
    endowBox: !!document.getElementById("endow"),
    submit: !!(s && [...s.querySelectorAll(".actions .btn-primary")].length),
    undeployed: txt.includes("No arena is deployed yet"),
    absent: txt.includes("There is no Population at this address"),
    wrong: txt.includes("it is not a Population"),
    unreachable: txt.includes("The chain did not answer"),
    ignored: txt.includes("That address in the URL was ignored"),
    loading: txt.includes("Looking for a deployed arena"),
    skeletons: s ? s.querySelectorAll(".skel").length : -1,
    /* The quote panel's footer sentence. It may only be printed while reads are arriving. */
    claimsLiveReads: txt.includes("every twenty seconds, and requoted"),
  };
})()`;

/* ── 6. the form, or a notice that says why not ──────────────────────────── */
const asShipped = await evaluate(PROBE);
note(
  `as shipped: grid=${asShipped.hasGrid} tmpl=${asShipped.templates} genome=${asShipped.genomeBox} ` +
    `endow=${asShipped.endowBox} · undeployed=${asShipped.undeployed} absent=${asShipped.absent} ` +
    `wrong=${asShipped.wrong} unreachable=${asShipped.unreachable} skel=${asShipped.skeletons}`,
);

const named =
  asShipped.undeployed || asShipped.absent || asShipped.wrong || asShipped.unreachable || asShipped.loading;
if (!asShipped.hasGrid && !named) {
  fail.push(
    "the console rendered neither the form nor any of the five notices that explain its absence — a blank page " +
      "under a heading that promises three transactions",
  );
}
if (asShipped.loading) {
  fail.push(
    "still on 'Looking for a deployed arena…' six seconds in. `usePopulation` resolves from the URL, localStorage, " +
      "`web/config.js` and finally the manifest — a persistent loading state means the manifest fetch never settled.",
  );
}
if (asShipped.hasGrid) {
  // If the form rendered, it has to be the WHOLE form. A grid with no textarea is worse than
  // no grid: the page looks ready and the one field that carries the genome is missing.
  if (asShipped.templates !== 4) fail.push(`the form rendered with ${asShipped.templates} of 4 genome templates`);
  if (!asShipped.genomeBox) fail.push("the form rendered without #genome-text — there is nowhere to write the genome");
  if (!asShipped.endowBox) fail.push("the form rendered without #endow — there is nowhere to set the endowment");
  if (!asShipped.submit) fail.push("the form rendered with no primary action — nothing can be entered");
} else {
  note("  (form withheld — this is the branch a judge sees today; the notice above says which one)");
}

/* ── 7. an address with no contract behind it withholds the form ─────────── */

/**
 *  An address that is certainly not a contract on Shannon.
 *
 *  Not a random string: `0x…dead` shapes are cute but could in principle be deployed to.
 *  This is the well-known burn address — it holds no code on any EVM chain by construction,
 *  which is exactly the `ContractFunctionZeroDataError` path `lib/reads.js:62-67` reads.
 */
const NOT_A_POPULATION = "0x000000000000000000000000000000000000dEaD";
const base = URL_UNDER_TEST.replace(/\?.*$/, "").replace(/\/$/, "");

forget();
await send("Page.navigate", { url: `${base}/?population=${NOT_A_POPULATION}` });
await sleep(7000);
const eoa = await evaluate(PROBE);
note(
  `EOA pointed: grid=${eoa.hasGrid} absent=${eoa.absent} unreachable=${eoa.unreachable} ` +
    `skel=${eoa.skeletons} claimsLiveReads=${eoa.claimsLiveReads}`,
);

// `unreachable` is an ACCEPTABLE outcome here and deliberately not a failure: if the RPC is
// down or rate-limiting, viem never learns there is no code at the address, and the correct
// page in that case is the one that does not accuse the address. What is asserted is the
// disjunction — one of the two withholding branches rendered — plus what must be true of either.
if (!eoa.absent && !eoa.unreachable) {
  fail.push(
    `pointed at ${NOT_A_POPULATION} — an address with no code — the console rendered neither the "no Population" ` +
      `notice nor the "chain did not answer" notice. This is the bug lib/reads.js exists to fix: nine reads ` +
      `return 0x, allowFailure turns them into nine undefineds, and the form cannot tell that from "still loading".`,
  );
}
if (eoa.hasGrid) {
  fail.push(
    `the entry form rendered against ${NOT_A_POPULATION}. Every gate in it is computed from reads that came ` +
      `back empty, so the button sits disabled with no reason given and a signature would be taken against nothing.`,
  );
}
if (eoa.claimsLiveReads) {
  fail.push(
    "the quote panel's footer still claims to read the contract every twenty seconds while every read failed — " +
      "that sentence may only be printed while state is actually arriving",
  );
}
if (eoa.skeletons > 0) {
  fail.push(
    `${eoa.skeletons} loading skeletons are still animating against an address with no contract behind it — ` +
      `a read that came back empty is not a read still in flight (see Val's \`failed\` branch)`,
  );
}

// THE CONTROL. The detector above must report something DIFFERENT on the page as shipped, or it
// is not reading the page at all. With a Population deployed that is the form; before Season 0
// it is the undeployed notice. Either is fine — what is forbidden is the two navigations
// looking identical, which is the shape that stays green on the bug it sits above.
if (asShipped.absent) {
  fail.push(
    "the no-query console ALSO renders the absent notice, so check 7 cannot distinguish a working absent branch " +
      "from a page that always shows it — the probe is measuring nothing",
  );
}
if (!asShipped.hasGrid && !asShipped.undeployed) {
  fail.push(
    "the no-query control rendered neither the form nor the undeployed notice, so there is no baseline to compare " +
      "the EOA navigation against",
  );
}

/* ── 8. a malformed override is said out loud ────────────────────────────── */
forget();
await send("Page.navigate", { url: `${base}/?population=0xnope` });
await sleep(3000);
const bad = await evaluate(PROBE);
note(`bad query:   ignored=${bad.ignored} grid=${bad.hasGrid}`);
if (!bad.ignored) {
  fail.push(
    "?population=0xnope was dropped in silence on the console — the one page where a pasted address actually leads " +
      "to a signature. `settings()` records it as `badQuery` (web/config.js:141) and then resolves as if it were " +
      "absent, so the form would take an entry against a DIFFERENT arena than the URL asked for.",
  );
}
// The control for check 8: the same probe must NOT report `ignored` on a well-formed URL, or
// the notice is unconditional and the check above passes on a page that always shows it.
if (asShipped.ignored || eoa.ignored) {
  fail.push(
    "the 'address in the URL was ignored' notice renders on a URL with no bad query in it — it is unconditional, " +
      "and check 8 is therefore measuring nothing",
  );
}

/* One page's console errors must not be attributed to another. */
const late = classify(events);
if (late.exceptions.length) fail.push(`exceptions after re-navigation:\n    ${late.exceptions.join("\n    ")}`);
if (late.apiErrors.length) fail.push(`console.error after re-navigation:\n    ${late.apiErrors.join("\n    ")}`);

/* ── report ──────────────────────────────────────────────────────────────── */
close();

console.log("\n" + "-".repeat(72));
if (fail.length) {
  console.log(`FAIL — ${fail.length} problem(s)`);
  for (const f of fail) console.log("  * " + f);
  process.exit(1);
}
console.log("PASS — /enter/ is its own document, reveals complete, and a non-Population address withholds the form");
process.exit(0);
