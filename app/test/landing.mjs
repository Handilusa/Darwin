/**
 *  Drive the built landing over CDP and sample it on the WALL CLOCK.
 *
 *  Deliberately not `--virtual-time-budget`: Chrome races the virtual clock while GSAP's
 *  ticker reads `performance.now()`, so a capture labelled 2200ms shows a timeline fifty
 *  real milliseconds in — an entire page at opacity 0, indistinguishable from the bug the
 *  reveal hooks exist to prevent. Same trap `CLAUDE.md` records for `web/`.
 *
 *  The launcher, the DevToolsActivePort dance and the console-event buckets live in `cdp.mjs`,
 *  shared with `arena.mjs`, `console.mjs` and `shots.mjs`. Everything below is what is true of
 *  the LANDING specifically; see that file for why the debug port is 0 and not 9222.
 *
 *  ── WHAT THIS SUITE IS FOR, AS OF 2026-09-08 ────────────────────────────────
 *  It used to assert that the entry form rendered here. It now asserts the opposite. The three
 *  transactions moved to `/enter/` (`src/Console.jsx`) because the landing is *information and
 *  instructions* and a page that explains what an organism is should not also be asking for a
 *  signature halfway down. So the strongest checks below are absences: no wallet prompt, no
 *  `.enter-grid`, and — since every `<button>`, `<input>` and `<textarea>` in `app/src` lives in
 *  `Enter.jsx`, which this page no longer mounts — **no native form control anywhere in the
 *  document**. That last one is exact rather than approximate, and it catches a returning
 *  `ConnectButton` without depending on RainbowKit's `data-testid`.
 *
 *  The form's own behaviour (the branches, the templates, the absent/unreachable classifier) is
 *  `test/console.mjs`. It moved rather than being deleted: the checks that used to prove a
 *  non-Population address withholds the form are still run, against the page that now has one.
 *
 *  Checks, in order:
 *    1. no console errors, no unhandled rejections, no failed requests
 *    2. the seven sections are in the DOM, and NO write affordance is
 *    3. the hero field paints (canvas has non-transparent pixels)
 *    4. the three vendored families loaded (no silent fallback to a system serif)
 *    5. nothing is left stranded at opacity 0 while on screen, at six scroll stops
 *    6. scrolling to #death kills one organism, and scrolling away does not revive it
 *    7. beat 6 is a static invitation: three named calls, no controls, a link to the console
 *    8. the hero's live dot does not pulse while nothing is being read
 *    9. a malformed ?population= is said out loud rather than silently dropped
 *   10. THE CONTROL: `/enter/` DOES render the wallet and DOES carry controls
 *
 *  Checks 8-10 each navigate again. That is deliberate and it is the convention this repo
 *  arrived at the hard way (`FRONTEND_CHECKPOINT.md:1445-1448`): an assertion that "X cannot
 *  happen" is paired with one that makes X happen on purpose and requires the same detector to
 *  fire. Checks 2 and 7 are pure absences, which is the shape that passes on a page that failed
 *  to render at all — so check 10 loads the one page where the wallet and the controls are
 *  *supposed* to exist and requires the same two detectors to report them.
 *
 *  Usage: node test/landing.mjs [url]        (default http://localhost:3000/)
 */

import { launch, classify, sleep } from "./cdp.mjs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3000/";
const fail = [];

const session = await launch({ watchdogMs: 240_000, windowSize: "1440,900" });
if (!session) process.exit(0);
const { send, evaluate, events, note, forget, close } = session;

note(`target    ${URL_UNDER_TEST}`);

const t0 = Date.now();
await send("Page.navigate", { url: URL_UNDER_TEST });
await sleep(3500); // wall clock: reveals + the hero's typing delay + the threads drawing
note(`navigated + settled at ${Date.now() - t0}ms (wall clock)`);

/* ── 1. errors ───────────────────────────────────────────────────────────── */
const { logErrors, apiErrors, warnings, exceptions, failedReqs } = classify(events);

if (logErrors.length) fail.push(`browser errors:\n    ${logErrors.join("\n    ")}`);
if (apiErrors.length) fail.push(`console.error from page:\n    ${apiErrors.join("\n    ")}`);
if (exceptions.length) fail.push(`exceptions:\n    ${exceptions.join("\n    ")}`);
if (failedReqs.length) note(`  (network failures, expected before Season 0: ${failedReqs.join(", ")})`);
// `assertTokens` reports theme drift as console.warn, and this surface shares `tokens.css` with
// `/arena/` — a warning here means the design system moved under one of the two.
if (warnings.length) fail.push(`console.warn from page:\n    ${warnings.join("\n    ")}`);
note(`browser errors ${logErrors.length} · console.error ${apiErrors.length} · warn ${warnings.length} · exceptions ${exceptions.length}`);

/* ── 2. structure — and the absence of everything transactional ──────────── */
const struct = await evaluate(`(() => {
  const ids = ["top","genome","window","cognition","death","lineage","enter"];
  return {
    found: ids.filter(i => document.getElementById(i)).length,
    missing: ids.filter(i => !document.getElementById(i)),
    rises: document.querySelectorAll("[data-rise]").length,
    canvases: document.querySelectorAll("canvas").length,
    connect: !!document.querySelector('[data-testid="rk-connect-button"]'),
    /* Every one of these in app/src is inside Enter.jsx, which this page does not mount. */
    controls: document.querySelectorAll("button, input, textarea, select").length,
    grids: document.querySelectorAll(".enter-grid").length,
    templates: document.querySelectorAll(".tmpl").length,
    navCta: !!document.querySelector('.nav-cta[href="/enter/"]'),
    inviteCta: !!document.querySelector('#enter a[href="/enter/"]'),
    consoleLinks: document.querySelectorAll('a[href="/enter/"]').length,
    title: document.title,
  };
})()`);
if (struct.missing.length) fail.push(`missing sections: ${struct.missing.join(", ")}`);

if (struct.connect) {
  fail.push(
    "the landing rendered a RainbowKit ConnectButton. A wallet prompt is the first step of the signing flow, " +
      "not information — it belongs on /enter/. The nav's right-hand slot is a link to that page now (Nav.jsx).",
  );
}
if (struct.controls > 0) {
  fail.push(
    `${struct.controls} native form control(s) on the landing. Every <button>, <input> and <textarea> in app/src ` +
      `lives in Enter.jsx, so a non-zero count here means either the form came back or a wallet button did.`,
  );
}
if (struct.grids > 0) fail.push(".enter-grid rendered on the landing — the entry form is mounted here again");
if (struct.templates > 0) {
  fail.push(`${struct.templates} genome template button(s) on the landing — those belong to the form on /enter/`);
}
if (!struct.navCta) fail.push('the nav has no .nav-cta[href="/enter/"] — the console is unreachable from the top of the page');
if (!struct.inviteCta) fail.push('beat 6 does not link to /enter/ — the page explains the three calls and then dead-ends');

note(`title     ${JSON.stringify(struct.title)}`);
note(
  `sections ${struct.found}/7 · [data-rise] ${struct.rises} · canvas ${struct.canvases} · ` +
    `connect ${struct.connect} · controls ${struct.controls} · links to /enter/ ${struct.consoleLinks}`,
);

/* ── 3. the hero field actually paints ───────────────────────────────────── */
const painted = await evaluate(`(() => {
  const cv = document.querySelector(".field canvas");
  if (!cv) return { ok: false, why: "no hero canvas" };
  const g = cv.getContext("2d");
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let lit = 0;
  for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 6) lit++;
  return { ok: lit > 50, lit, w: cv.width, h: cv.height };
})()`);
if (!painted.ok) fail.push(`hero field is blank: ${JSON.stringify(painted)}`);
note(`hero field lit samples: ${painted.lit} (canvas ${painted.w}x${painted.h})`);

/* ── 4. fonts ────────────────────────────────────────────────────────────── */
const fonts = await evaluate(`(async () => {
  await document.fonts.ready;
  const want = ["Newsreader", "IBM Plex Sans", "IBM Plex Mono"];
  const loaded = [...document.fonts].map(f => f.family.replace(/"/g, ""));
  return want.map(w => [w, loaded.includes(w) && document.fonts.check("16px " + JSON.stringify(w))]);
})()`);
const badFonts = fonts.filter(([, ok]) => !ok).map(([f]) => f);
if (badFonts.length) fail.push(`fonts did not load: ${badFonts.join(", ")}`);
note(`fonts: ${fonts.map(([f, ok]) => `${f}${ok ? "OK" : "MISSING"}`).join(" · ")}`);

/* ── 5. nothing stranded invisible ───────────────────────────────────────── */
async function invisibleInView() {
  return evaluate(`(() => {
    const out = [];
    for (const el of document.querySelectorAll("[data-rise]")) {
      const r = el.getBoundingClientRect();
      const onScreen = r.top < innerHeight * 0.8 && r.bottom > 0;
      if (!onScreen) continue;
      if (parseFloat(getComputedStyle(el).opacity) < 0.5) {
        out.push((el.className || el.tagName) + " :: " + el.textContent.trim().slice(0, 48));
      }
    }
    return out;
  })()`);
}

/* Walk the page the way a reader does, sampling on the wall clock. */
for (const sel of ["#genome", "#window", "#cognition", "#death", "#lineage", "#enter"]) {
  await evaluate(`document.querySelector("${sel}").scrollIntoView({behavior:"instant",block:"start"})`);
  await sleep(1400);
  const stuck = await invisibleInView();
  if (stuck.length) fail.push(`invisible after reveal at ${sel}:\n    ${stuck.join("\n    ")}`);
  note(`  ${sel.padEnd(11)} settled, ${stuck.length} stranded`);
}

/* ── 6. the death is real, and it is permanent ───────────────────────────── */
await evaluate(`document.querySelector("#death").scrollIntoView({behavior:"instant",block:"center"})`);
await sleep(3800); // arm + extinguish + margin, all wall clock

const dead = await evaluate(`(() => {
  const cap = document.querySelector("#death .stage-cap");
  const closeup = document.querySelector("#death .stage canvas");
  if (!closeup) return { caption: cap ? cap.textContent : null, closeupLit: -1 };
  const g = closeup.getContext("2d");
  const d = g.getImageData(0, 0, closeup.width, closeup.height).data;
  let lit = 0;
  for (let i = 3; i < d.length; i += 4 * 53) if (d[i] > 6) lit++;
  return { caption: cap ? cap.textContent : null, closeupLit: lit };
})()`);
if (!/ash/.test(dead.caption ?? "")) fail.push(`death caption never flipped: ${JSON.stringify(dead.caption)}`);
if (dead.closeupLit === 0) fail.push("the close-up stage stopped painting entirely after the death");
note(`death caption: ${JSON.stringify(dead.caption)} · close-up painting (${dead.closeupLit} samples)`);

/* Back to the top: the hero organism must still be gone.
   Calibrated against a LIVING cell in the same frame rather than an absolute threshold —
   a fixed number would silently pass if the whole field dimmed, and would have to be
   re-tuned every time the palette moves. SPEC[1] is alive and mint; SPEC[6] is the one that
   went out. If `die` were ever a yoyo, the two samples would match. */
await evaluate(`window.scrollTo({top:0,behavior:"instant"})`);
await sleep(1800);
const cells = await evaluate(`(() => {
  const cv = document.querySelector(".field canvas");
  const g = cv.getContext("2d");
  const disc = (fx, fy) => {
    const cx = Math.round(fx * cv.width), cy = Math.round(fy * cv.height);
    const r = Math.round(0.02 * cv.width);
    const d = g.getImageData(cx - r, cy - r, r * 2, r * 2).data;
    let maxG = 0, maxA = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i+1] > maxG) maxG = d[i+1]; if (d[i+3] > maxA) maxA = d[i+3]; }
    return { maxGreen: maxG, maxAlpha: maxA };
  };
  return { doomed: disc(0.55, 0.52), alive: disc(0.73, 0.46) };
})()`);
note(
  `hero after scrolling back — doomed(0.55,0.52) g${cells.doomed.maxGreen}/a${cells.doomed.maxAlpha} · alive(0.73,0.46) g${cells.alive.maxGreen}/a${cells.alive.maxAlpha}`,
);
if (cells.alive.maxAlpha < 100) {
  fail.push(`the control cell is not painting either (alpha ${cells.alive.maxAlpha}) — the whole field went dark`);
} else if (cells.doomed.maxAlpha >= cells.alive.maxAlpha * 0.7) {
  fail.push(
    `the doomed organism came back: alpha ${cells.doomed.maxAlpha} vs a living ${cells.alive.maxAlpha}. Death must not be reversible on screen.`,
  );
}

/* ── 7. beat 6 is an invitation, not a transaction ───────────────────────── */
//
// The three calls still have to be NAMED here — that is the instructional half of the user's
// ask, and a page that dropped them would pass a check that only looked for the absence of a
// form. So this asserts both halves: the words are present, and nothing here can be clicked
// into a wallet.
await evaluate(`document.querySelector("#enter").scrollIntoView({behavior:"instant",block:"start"})`);
await sleep(1200);
const invite = await evaluate(`(() => {
  const s = document.querySelector("#enter");
  const steps = [...s.querySelectorAll(".step")];
  return {
    steps: steps.length,
    calls: steps.map(x => { const b = x.querySelector("b"); return b ? b.textContent.trim() : ""; }),
    controls: s.querySelectorAll("button, input, textarea, select").length,
    hasGrid: !!s.querySelector(".enter-grid"),
    link: !!s.querySelector('a[href="/enter/"]'),
    undeployed: s.textContent.includes("No arena is deployed yet"),
    chars: s.textContent.trim().length,
  };
})()`);
note(`enter beat: ${invite.steps} steps ${JSON.stringify(invite.calls)} · controls ${invite.controls} · ${invite.chars} chars`);

if (invite.steps !== 3) fail.push(`beat 6 lists ${invite.steps} steps, not the three calls entry actually takes`);
for (const want of ["faucet", "approve", "enter("]) {
  if (!invite.calls.some((c) => c.includes(want))) {
    fail.push(`beat 6 never names \`${want}\` — the instructions are incomplete: ${JSON.stringify(invite.calls)}`);
  }
}
if (invite.controls > 0) fail.push(`beat 6 carries ${invite.controls} control(s) — it is meant to be readable, not clickable`);
if (invite.hasGrid) fail.push("beat 6 rendered .enter-grid — the form is back on the landing");
if (!invite.link) fail.push("beat 6 names the three calls and offers no way to reach the console that makes them");
if (invite.undeployed) note("  (also printing the undeployed notice: POPULATION resolved to nothing — this is the pre-Season-0 view)");

/*//////////////////////////////////////////////////////////////
      8, 9 — POINT IT AT SOMETHING THAT IS NOT A POPULATION
//////////////////////////////////////////////////////////////*/

/**
 *  ONE probe, run against three navigations.
 *
 *  `?population=` is the right lever rather than seeding localStorage: it is a documented
 *  entry point (`web/config.js:14-15`), `settings()` gives it precedence over everything, and
 *  it leaves no state behind for the next navigation to inherit.
 *
 *  `hasGrid` and `connect` are carried through every reading on purpose. Checks 2 and 7 only
 *  look at the first navigation, and "no form on the landing" has to hold for the query strings
 *  a judge might actually paste, not just for the bare URL.
 */
const PROBE = `(() => {
  const s = document.querySelector("#enter");
  const hero = document.querySelector(".hero-top");
  const dot = hero ? hero.querySelector(".dot") : null;
  const txt = s ? s.textContent : "";
  return {
    hasGrid: !!(s && s.querySelector(".enter-grid")),
    connect: !!document.querySelector('[data-testid="rk-connect-button"]'),
    undeployed: txt.includes("No arena is deployed yet"),
    ignored: txt.includes("That address in the URL was ignored"),
    heroPulses: !!(dot && dot.classList.contains("dot-live")),
    heroText: hero ? hero.textContent.replace(/\\s+/g, " ").trim() : null,
    heroSeason: /Season \\d+ · \\d+ windows/.test(hero ? hero.textContent : ""),
  };
})()`;

/**
 *  An address that is certainly not a contract on Shannon.
 *
 *  Not a random string: `0x…dead` shapes are cute but could in principle be deployed to.
 *  This is the well-known burn address — it holds no code on any EVM chain by construction,
 *  which is exactly the `ContractFunctionZeroDataError` path `lib/reads.js:62-67` reads.
 */
const NOT_A_POPULATION = "0x000000000000000000000000000000000000dEaD";
const base = URL_UNDER_TEST.replace(/\?.*$/, "").replace(/\/$/, "");

/** The no-query reading, taken with the same probe. This is the baseline. */
const asShipped = await evaluate(PROBE);
note(
  `control (no query): grid=${asShipped.hasGrid} connect=${asShipped.connect} undeployed=${asShipped.undeployed} ` +
    `pulse=${asShipped.heroPulses} season=${asShipped.heroSeason}`,
);

forget();
await send("Page.navigate", { url: `${base}/?population=${NOT_A_POPULATION}` });
// Long enough for the batch to settle and be classified: viem has to attempt all nine reads,
// and `retry: 1` (main.jsx:38) means each one is attempted twice before it is a failure.
await sleep(6000);
const eoa = await evaluate(PROBE);
note(
  `EOA pointed:        grid=${eoa.hasGrid} connect=${eoa.connect} ` +
    `pulse=${eoa.heroPulses} season=${eoa.heroSeason}`,
);
note(`  hero says: ${JSON.stringify(eoa.heroText)}`);

if (eoa.hasGrid || eoa.connect) {
  fail.push(
    `?population=${NOT_A_POPULATION} produced a write affordance on the landing ` +
      `(grid=${eoa.hasGrid} connect=${eoa.connect}). The absence asserted in checks 2 and 7 must not be ` +
      `something a query string can undo.`,
  );
}

/* ── 8. the hero does not claim liveness over reads that failed ───────────── */
if (eoa.heroPulses) {
  fail.push(
    "the hero's .dot-live is still pulsing while every read against the resolved address failed. That dot is the " +
      "only mark on the page that asserts a reading is current without a number beside it, and beat 6 below it is " +
      "simultaneously refusing to name an arena — the top of the page must not be more confident than the bottom.",
  );
}
if (eoa.heroSeason) {
  fail.push(
    `the hero still prints a season (${JSON.stringify(eoa.heroText)}) while seasonId/seasonWindows could not be ` +
      `read. Population.sol:411-413 initialises them to 1 and 576, so a hardcoded pill looks correct until a ` +
      `setSeason call moves them and it goes on looking correct while being wrong.`,
  );
}
// The detector for check 8 is `dot.classList.contains("dot-live")`, and the only page that can
// prove it fires is one where the reads succeed — which needs a deployed Population AND a
// reachable RPC. Neither is this suite's to guarantee, so a quiet baseline is reported rather
// than failed. Read the line: if it says `pulse=false` on both navigations, check 8 passed
// without being exercised, and it is the RPC that owes you an explanation, not the page.
if (!asShipped.heroPulses) {
  note("  NOTE check 8 unexercised: the baseline page did not pulse either, so `dot-live` was never seen to fire");
}

/* ── 9. a malformed override is said out loud ────────────────────────────── */
forget();
await send("Page.navigate", { url: `${base}/?population=0xnope` });
await sleep(2600);
const bad = await evaluate(PROBE);
note(`bad query:          ignored=${bad.ignored} grid=${bad.hasGrid} connect=${bad.connect}`);
if (!bad.ignored) {
  fail.push(
    "?population=0xnope was dropped in silence. `settings()` records it as `badQuery` (web/config.js:141) and then " +
      "resolves as if it were absent, so the page shows a DIFFERENT arena than the URL asked for with no indication " +
      "anything was ignored — the arena forces its setup card open for exactly this case (render.js:1837-1844).",
  );
}
// The control for check 9: the same probe must NOT report `ignored` on a well-formed URL,
// or the notice is unconditional and the check above passes on a page that always shows it.
if (asShipped.ignored || eoa.ignored) {
  fail.push(
    "the 'address in the URL was ignored' notice renders on a URL with no bad query in it — it is unconditional, " +
      "and check 9 is therefore measuring nothing",
  );
}

/* ── 10. THE CONTROL FOR CHECKS 2 AND 7 ──────────────────────────────────── */
//
// Everything asserted above about the landing is an absence, and an absence is what a page
// that failed to render at all also reports. So load the one page that is SUPPOSED to have a
// wallet and controls, with the same two detectors, and require both to fire. If this check
// fails, the passes above mean nothing: either RainbowKit's `data-testid` moved, or the
// provider stack is broken everywhere, or `/enter/` is not being served — and that last one is
// the failure a production build without `rollupOptions.input` produces while `npm run dev`
// looks perfect (see `vite.config.js`).
forget();
await send("Page.navigate", { url: `${base}/enter/` });
await sleep(5000);
const consolePage = await evaluate(`(() => ({
  connect: !!document.querySelector('[data-testid="rk-connect-button"]'),
  controls: document.querySelectorAll("button, input, textarea, select").length,
  hasEnter: !!document.getElementById("enter"),
  crumb: !!document.querySelector(".console-crumb"),
  landingOnly: !!document.getElementById("genome") && !!document.querySelector(".field canvas"),
  title: document.title,
}))()`);
note(
  `/enter/ control:    connect=${consolePage.connect} controls=${consolePage.controls} ` +
    `#enter=${consolePage.hasEnter} crumb=${consolePage.crumb} · title ${JSON.stringify(consolePage.title)}`,
);
if (!consolePage.connect) {
  fail.push(
    "/enter/ did not render a ConnectButton either, so 'the landing has no wallet prompt' is not a finding — " +
      "the detector never fires anywhere. Check RainbowKit's data-testid and that /enter/ is actually served.",
  );
}
if (consolePage.controls === 0) {
  fail.push(
    "/enter/ carries no form controls at all, so 'the landing has no form controls' is measuring nothing. " +
      "The console must at minimum render the wallet button in its nav.",
  );
}
if (!consolePage.crumb) {
  fail.push("/enter/ has no .console-crumb — this is the landing being served under the console's URL (Vite's html fallback)");
}
if (consolePage.landingOnly) {
  fail.push("/enter/ rendered the landing's hero field and #genome beat — the second Rollup input is not being served");
}

/* One page's console errors must not be attributed to another. This bucket covers the last
   navigation only, which is why `forget()` precedes each one. */
const late = classify(events);
if (late.exceptions.length) fail.push(`exceptions on /enter/:\n    ${late.exceptions.join("\n    ")}`);
if (late.apiErrors.length) fail.push(`console.error on /enter/:\n    ${late.apiErrors.join("\n    ")}`);

/* ── report ──────────────────────────────────────────────────────────────── */
close();

console.log("\n" + "-".repeat(72));
if (fail.length) {
  console.log(`FAIL — ${fail.length} problem(s)`);
  for (const f of fail) console.log("  * " + f);
  process.exit(1);
}
console.log("PASS — the landing reads, reveals and kills as designed, names the three calls, and takes no signatures");
process.exit(0);
