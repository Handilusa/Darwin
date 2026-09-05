/**
 *  Drive the built landing over CDP and sample it on the WALL CLOCK.
 *
 *  Deliberately not `--virtual-time-budget`: Chrome races the virtual clock while GSAP's
 *  ticker reads `performance.now()`, so a capture labelled 2200ms shows a timeline fifty
 *  real milliseconds in — an entire page at opacity 0, indistinguishable from the bug the
 *  reveal hooks exist to prevent. Same trap `CLAUDE.md` records for `web/`.
 *
 *  The launcher, the DevToolsActivePort dance and the console-event buckets live in `cdp.mjs`,
 *  shared with `arena.mjs` and `shots.mjs`. Everything below is what is true of the LANDING
 *  specifically; see that file for why the debug port is 0 and not 9222.
 *
 *  Checks, in order:
 *    1. no console errors, no unhandled rejections, no failed requests
 *    2. the seven sections, the RainbowKit button and the genome templates are in the DOM
 *    3. the hero field paints (canvas has non-transparent pixels)
 *    4. the three vendored families loaded (no silent fallback to a system serif)
 *    5. nothing is left stranded at opacity 0 while on screen, at six scroll stops
 *    6. scrolling to #death kills one organism, and scrolling away does not revive it
 *    7. the entry surface renders either the form or the undeployed notice
 *    8. an address with no contract behind it withholds the form — and the SAME detector
 *       reports the form's absence differently on the no-query pass, so it can fail
 *    9. the hero's live dot does not pulse while nothing is being read
 *   10. a malformed ?population= is said out loud rather than silently dropped
 *
 *  Checks 8-10 each navigate again with a chosen query string. That is deliberate and it is
 *  the convention this repo arrived at the hard way (`FRONTEND_CHECKPOINT.md:1445-1448`):
 *  an assertion that "X cannot happen" is paired with a control that makes X happen and
 *  requires the same detector to fire. Check 7 alone is exactly the shape that cannot fail —
 *  it accepts "the form OR the undeployed notice", which is both branches that existed
 *  before the absent branch was written, so it stays green on the bug it is above.
 *
 *  Usage: node test/landing.mjs [url]        (default http://localhost:3000/)
 */

import { launch, classify, sleep } from "./cdp.mjs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3000/";
const fail = [];

const session = await launch({ watchdogMs: 210_000, windowSize: "1440,900" });
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

/* ── 2. structure ────────────────────────────────────────────────────────── */
const struct = await evaluate(`(() => {
  const ids = ["top","genome","window","cognition","death","lineage","enter"];
  return {
    found: ids.filter(i => document.getElementById(i)).length,
    missing: ids.filter(i => !document.getElementById(i)),
    rises: document.querySelectorAll("[data-rise]").length,
    canvases: document.querySelectorAll("canvas").length,
    connect: !!document.querySelector('[data-testid="rk-connect-button"]'),
    templates: document.querySelectorAll(".tmpl").length,
    title: document.title,
  };
})()`);
if (struct.missing.length) fail.push(`missing sections: ${struct.missing.join(", ")}`);
if (!struct.connect) fail.push("RainbowKit ConnectButton did not render");
// The template buttons live inside the form, and the form only exists once an arena is
// deployed — so `.tmpl` is asserted in check 7, against whichever branch actually rendered.
note(`title     ${JSON.stringify(struct.title)}`);
note(
  `sections ${struct.found}/7 · [data-rise] ${struct.rises} · canvas ${struct.canvases} · connect ${struct.connect} · .tmpl ${struct.templates}`,
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

/* ── 7. the enter surface with no deployment ─────────────────────────────── */
await evaluate(`document.querySelector("#enter").scrollIntoView({behavior:"instant",block:"start"})`);
await sleep(1200);
const enter = await evaluate(`(() => {
  const s = document.querySelector("#enter");
  return {
    hasGrid: !!s.querySelector(".enter-grid"),
    undeployed: s.textContent.includes("No arena is deployed yet"),
    chars: s.textContent.trim().length,
  };
})()`);
note(`enter: grid=${enter.hasGrid} undeployedCopy=${enter.undeployed} (${enter.chars} chars of copy)`);
if (!enter.undeployed && !enter.hasGrid) fail.push("enter section rendered neither the form nor the undeployed notice");
// Exactly one of the two branches, and if it is the form it must carry all four templates.
if (enter.hasGrid && struct.templates < 4) {
  fail.push(`the entry form rendered but only ${struct.templates} of 4 genome templates`);
}
if (!enter.hasGrid) note("  (form withheld: POPULATION is empty until the Season 0 deploy — this is the judge's view today)");

/*//////////////////////////////////////////////////////////////
      8, 9, 10 — POINT IT AT SOMETHING THAT IS NOT A POPULATION
//////////////////////////////////////////////////////////////*/

/**
 *  ONE probe, run against three navigations.
 *
 *  This is the whole reason the checks below can fail. Check 7 asks "did the page render one
 *  of the two branches it has always had", which is answered yes by the bug it sits above.
 *  What distinguishes a working absent branch from a broken one is a DIFFERENCE between two
 *  pages, so the same function reads both and the assertions compare them.
 *
 *  `?population=` is the right lever rather than seeding localStorage: it is a documented
 *  entry point (`web/config.js:14-15`), `settings()` gives it precedence over everything, and
 *  it leaves no state behind for the next navigation to inherit.
 */
const PROBE = `(() => {
  const s = document.querySelector("#enter");
  const hero = document.querySelector(".hero-top");
  const dot = hero ? hero.querySelector(".dot") : null;
  const txt = s ? s.textContent : "";
  return {
    hasGrid: !!(s && s.querySelector(".enter-grid")),
    undeployed: txt.includes("No arena is deployed yet"),
    absent: txt.includes("There is no Population at this address"),
    unreachable: txt.includes("The chain did not answer"),
    ignored: txt.includes("That address in the URL was ignored"),
    skeletons: s ? s.querySelectorAll(".skel").length : -1,
    /* The footer sentence that must not be printed over reads that never happened. */
    claimsLiveReads: txt.includes("every twenty seconds, and requoted"),
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

/** The no-query reading, taken with the same probe. This is the control. */
const asShipped = await evaluate(PROBE);
note(
  `control (no query): grid=${asShipped.hasGrid} undeployed=${asShipped.undeployed} absent=${asShipped.absent} ` +
    `pulse=${asShipped.heroPulses} skel=${asShipped.skeletons}`,
);

forget();
await send("Page.navigate", { url: `${base}/?population=${NOT_A_POPULATION}` });
// Long enough for the batch to settle and be classified: viem has to attempt all nine reads,
// and `retry: 1` (main.jsx:38) means each one is attempted twice before it is a failure.
await sleep(6000);
const eoa = await evaluate(PROBE);
note(
  `EOA pointed:        grid=${eoa.hasGrid} absent=${eoa.absent} unreachable=${eoa.unreachable} ` +
    `pulse=${eoa.heroPulses} season=${eoa.heroSeason} skel=${eoa.skeletons}`,
);
note(`  hero says: ${JSON.stringify(eoa.heroText)}`);

/* ── 8. the form is withheld, and the reason is named ─────────────────────── */
//
// `unreachable` is an ACCEPTABLE outcome here and deliberately not a failure: if the RPC is
// down or rate-limiting, viem never learns there is no code at the address, and the correct
// page in that case is the one that does not accuse the address. What is asserted is the
// disjunction — one of the two withholding branches rendered — plus the two things that must
// be true of either.
if (!eoa.absent && !eoa.unreachable) {
  fail.push(
    `pointed at ${NOT_A_POPULATION} — an address with no code — the page rendered neither the "no Population" ` +
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
// THE CONTROL. The detector above must report something DIFFERENT on the shipped page, or it
// is not reading the page at all. Today that page is `undeployed`; after Season 0 it is the
// form. Either is fine — what is forbidden is the two navigations looking identical.
if (asShipped.absent) {
  fail.push(
    "the no-query page ALSO renders the absent notice, so check 8 cannot distinguish a working " +
      "absent branch from a page that always shows it — the probe is measuring nothing",
  );
}
if (!asShipped.hasGrid && !asShipped.undeployed) {
  fail.push(
    "the no-query control rendered neither the form nor the undeployed notice, so there is no baseline " +
      "to compare the EOA navigation against",
  );
}

/* ── 9. the hero does not claim liveness over reads that failed ───────────── */
if (eoa.heroPulses) {
  fail.push(
    "the hero's .dot-live is still pulsing while every read against the resolved address failed. That dot is the " +
      "only mark on the page that asserts a reading is current without a number beside it, and the entry form " +
      "below it is simultaneously refusing to render — the top of the page must not be more confident than the bottom.",
  );
}
if (eoa.heroSeason) {
  fail.push(
    `the hero still prints a season (${JSON.stringify(eoa.heroText)}) while seasonId/seasonWindows could not be ` +
      `read. Population.sol:411-413 initialises them to 1 and 576, so a hardcoded pill looks correct until a ` +
      `setSeason call moves them and it goes on looking correct while being wrong.`,
  );
}

/* ── 10. a malformed override is said out loud ────────────────────────────── */
forget();
await send("Page.navigate", { url: `${base}/?population=0xnope` });
await sleep(2600);
const bad = await evaluate(PROBE);
note(`bad query:          ignored=${bad.ignored} grid=${bad.hasGrid} pulse=${bad.heroPulses}`);
if (!bad.ignored) {
  fail.push(
    "?population=0xnope was dropped in silence. `settings()` records it as `badQuery` (web/config.js:141) and then " +
      "resolves as if it were absent, so the page shows a DIFFERENT arena than the URL asked for with no indication " +
      "anything was ignored — the arena forces its setup card open for exactly this case (render.js:1837-1844).",
  );
}
// The control for check 10: the same probe must NOT report `ignored` on a well-formed URL,
// or the notice is unconditional and the check above passes on a page that always shows it.
if (asShipped.ignored || eoa.ignored) {
  fail.push(
    "the 'address in the URL was ignored' notice renders on a URL with no bad query in it — it is unconditional, " +
      "and check 10 is therefore measuring nothing",
  );
}

/* One page's console errors must not be attributed to another. This bucket covers the last
   navigation only, which is why `forget()` precedes each one. */
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
console.log("PASS — landing renders, reveals complete, death fires and stays fired, and a non-Population address withholds the form");
process.exit(0);
