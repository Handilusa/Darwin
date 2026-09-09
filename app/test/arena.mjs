/**
 *  Drive the re-themed console at `/arena/?demo=1` over CDP and sample it on the WALL CLOCK.
 *
 *  Companion to `landing.mjs`; both share the driver in `cdp.mjs`. This file exists because the
 *  re-theme of `web/` — a from-scratch `app.css` on `tokens.css`, a re-headed `index.html` and four
 *  corrected token reads in `motion.js` — had been *written* and never *executed*. `smoke.mjs` cannot
 *  close that gap by design: it asserts on class names and exact text under a 60-line fake DOM, and
 *  it never loads the stylesheet or imports `motion.js`. Everything this file checks is invisible to
 *  it.
 *
 *  ── WHY `?demo=1` IS THE RIGHT TARGET ───────────────────────────────────────
 *  `fixture.season()` scripts the next window as four snapshots fed through the same `advance()` path
 *  a live poll uses, so the `died` / `born` / `treasury` / `phase` timelines actually fire. Frame
 *  offsets are cumulative and come straight out of the fixture: 4200, +5200, +4600, +4000 ms. If
 *  those numbers change there, they change here, and the two must be edited together.
 *
 *  ── THE BUG THIS IS BUILT TO CATCH ──────────────────────────────────────────
 *  `motion.js` spent the whole re-theme reading `--vital`, `--lethal`, `--helix` and `--helix-wash` —
 *  four names `tokens.css` does not define — so every one resolved to a hardcoded fallback from the
 *  retired palette. A death flashed a pink the stylesheet had never heard of and a birth bloomed
 *  INDIGO on a mint-and-amber page, while the page around them looked perfectly themed. Nothing
 *  short of watching it would have caught it. Three checks cover it from three directions:
 *
 *    - check 2 fails on any `console.warn` from `motion.js`, which is the mechanism itself: a token
 *      name absent from `tokens.css` now says so once instead of quietly returning something
 *      plausible;
 *    - checks 6 and 7 assert the DOMINANT CHANNEL of each bloom, which is the visible symptom;
 *    - check 9 scans every computed colour on the page for the four retired hexes, so a hardcoded
 *      one cannot creep back in.
 *
 *  Hue is asserted by dominant channel rather than by exact triple on purpose. GSAP interpolates a
 *  box-shadow toward `rgba(0,0,0,0)` component by component, so an exact `rgb(95, 227, 192)` match
 *  holds only in the first frame and a single mistimed sample would fail a correct page. Scaling all
 *  three components toward zero preserves the ordering — coral stays red-dominant, mint stays
 *  green-dominant, and indigo would be blue-dominant — so the ordering is what gets asserted, and it
 *  is sampled by polling ACROSS each timeline rather than once inside it.
 *
 *  Never `--virtual-time-budget`. See the header of `cdp.mjs`.
 *
 *  Checks, in order:
 *    1.  no console errors, no exceptions, no failed requests
 *    2.  no console.warn from motion.js — i.e. every token it reads exists in tokens.css
 *    3.  demo mode asks for nothing off-origin (the "works with the network unplugged" claim)
 *    4.  the head is re-themed: dark color-scheme, #060d0c theme-color, the mint-cell favicon
 *    5.  structure, the three vendored families, the blue-green ground, nothing stranded invisible
 *    5b. EVERY CORPSE IS ABOVE THE FOLD ON A COLD LOAD, on one line each, and so is the toll
 *    6.  the death blooms in the ALARM hue, red-dominant
 *    7.  the death settles into ash with NO JUMP — inline filter cleared, CSS saturate(0.15) resting
 *    8.  the birth blooms in the LIFE hue, green-dominant — not indigo
 *    9.  no retired-palette colour anywhere on the page
 *    10. new feed rows wash in with the deep life tint, green-dominant
 *    11. the season lands: 13 cards, 3 corpses, phase 2, window 42, nothing stranded
 *    11a THE SEASON CLOSES AND THE POT IS PAID — `SeasonEnded` and the three `SeasonPrizePaid` rows,
 *        their `sev-good` band, and the header already on season 2 while the feed names season 1
 *    11b THE INTERACTIVE STATES ACTUALLY CHANGE SOMETHING — selection and hover, corpses included
 *    12. with no ?demo=1 and no deployment, the front door renders — the judge's view today — and its
 *        copy stays inside a BUDGET FROM BOTH SIDES, with the operator's form folded away
 *    12b THE PRIMER'S FIVE CLAIMS ARE STILL THE LOUDEST TEXT IN THE PANEL, against an injected label
 *    12c THE FRONT DOOR'S TWO PANELS DO NOT STEP, on a phone as well as on a desktop
 *    13. EVERY CORPSE IS ABOVE THE FOLD AFTER A DEATH LANDS, and the hero states the body count in fold
 *
 *  Check 12b is here because a defect can be a HIERARCHY INVERSION rather than a fault: no error, no
 *  exception, no missing node, nothing stranded invisible, and every other check on this list green.
 *  `.panel h3` (0,1,1) beat `.beat-claim` (0,1,0), so the five lines that ARE the explanation of
 *  DARWIN rendered at 11px uppercase mono in `--text-3` — the exact treatment the words "NOTHING IS
 *  DEPLOYED YET" get, and smaller and dimmer than the elective paragraph under each of them.
 *
 *  It is still asserted RELATIVELY, but the comparison target moved when the front door was cut down.
 *  The per-beat prose the claims used to have to outrank no longer exists, so the panel label they
 *  must not MATCH is now INJECTED: a throwaway `h3` appended to `.panel-primer` out of flow, which
 *  matches the same generic label rule the claims spent their whole life losing to. That probe is a
 *  better control than the label it replaces, because it exists whether or not any real label is left
 *  on the page — and 12b asserts the probe still renders AS a label (uppercase, mono, small) before it
 *  compares anything to it, because a control that has stopped being a label reports the same green as
 *  a page that works. The second half of the old claim survives as a hierarchy sweep: nothing in the
 *  primer outside its own `.panel-head` title may render LARGER than the quietest of the five claims.
 *  A pass here is not "the claim is 17px", it is "the claim is still the loudest sentence in the panel
 *  and still reads as a sentence".
 *
 *  Check 11b generalises what 12b found. `.beat-claim` was not a one-off: a sweep of every type-scoped
 *  rule in `app.css` against what actually renders turned up two more of the same shape, both on state
 *  rules, both invisible to every check above. `.census td` (0,1,1) was swallowing `.muted` (0,1,0), so
 *  the census printed the count of the DEAD at full `--text` — exactly as loud as the count of the
 *  living, in the one column the eye is meant to skip. `.card:hover` (0,2,0) was taking `border-color`
 *  back off `.card-selected` (0,1,0), so moving the pointer onto the selected card replaced its mint
 *  edge with the ordinary hover neutral. And in the lineage tree the dead rule and the hover/selection
 *  rule are BOTH (0,3,0), five lines apart, so source order alone decided and a corpse answered neither
 *  the cursor nor a click — on the nodes a judge meets most, since most of any ancestry is dead.
 *
 *  None of the three was a fault. No error, no exception, no missing node, nothing stranded invisible;
 *  the state class was on the element and the sheet had a rule for it. That is the whole defect class:
 *  a declaration whose only job is to WIN, that loses. The tell in the source is an undo declaration —
 *  `letter-spacing: normal`, `text-transform: none`, an explicit `color` — sitting at a specificity
 *  below the rule it means to undo. 11b is written against controls rather than values for the same
 *  reason 12b is, and it additionally asserts that the CONTROLS still respond: an unselected card must
 *  still answer the cursor, a living lineage node must still answer selection. Without those two, a
 *  page where hover broke everywhere would report the same green as a page that works.
 *
 *  Check 12c is the same class again in the one modality 11b and 12b are blind to: `@media`. A
 *  breakpoint adds no specificity, so a block that re-declares a BASE class does not outrank a
 *  variant — it merely sits later in the file, which is already enough. `.panel-setup` was restated
 *  inside the 720px block and `.panel-primer` was not, so at phone width the primer alone fell back
 *  to the generic panel padding: 16px against the setup panel's 24px, an 8px step between two panels
 *  whose boxes are flush and which `.panel-primer`'s own comment says exist to share one left-hand
 *  edge "instead of stepping". Invisible at every desktop width, and on the page a judge lands on
 *  before Season 0. It is measured at 1400 as well as 700 on purpose: a check that only ever looked
 *  at the broken width could not be told apart from one that always passes. `.panel-setup` is a
 *  `details` since the front door was cut down, so the child whose left edge it measures there is the
 *  `summary` — the collapsed form has no box at all, which is why 12c reads the FIRST child that has
 *  a width rather than the first child.
 *
 *  Checks 5b and 13 are the same reading taken at the two moments that can differ: a cold load, and
 *  the frame after a death animation has run. 5b is the one that matters most, because a page whose
 *  RESTING state hides the corpses is broken for every judge who does not happen to be watching when
 *  an organism starves. Both are written on the symptom rather than on the corpse band that currently
 *  fixes it — they measure against `innerHeight`, so a different correct layout passes them unchanged
 *  and no viewport is assumed. The window is nevertheless pinned to 1600x1000 below, because that is
 *  what `shots.mjs` captures at and what the geometry in `docs/FRONTEND_CHECKPOINT.md` was measured
 *  at — an instrument that does not share a frame with the thing it measures is not evidence.
 *
 *  Usage: node test/arena.mjs [url]      (default http://localhost:3000/arena/?demo=1)
 *
 *  Note `localhost` and not `127.0.0.1`: `vite preview` binds ::1 only on this machine.
 */

import { launch, classify, sleep } from "./cdp.mjs";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3000/arena/?demo=1";
const fail = [];
const note = (s) => console.log(s);

/* Cumulative frame times from `fixture.js`'s SCRIPT — after: 4200, 5200, 4600, 4000. */
const SETTLE = 4200;
const HATCH = SETTLE + 5200; // 9400
const THINK = HATCH + 4600; // 14000
const COMMIT = THINK + 4000; // 18000

/* The palette that came before `tokens.css`. None of these may appear on the page. */
const RETIRED = [
  ["--vital", "0, 230, 138"],
  ["--lethal", "255, 61, 110"],
  ["--helix", "122, 92, 255"],
  ["--helix-wash", "20, 17, 43"],
];

/* A ceiling on `#header`, not a target. It is the only thing between the fold and the population, and
   it is the band that has grown every time something was added to it. 343px is a CDP reading at the
   viewport below, taken after the padding and stat-strip cuts (it was 422px before them); the 17px is
   slack for font metrics, not budget for another row. */
const HEADER_CEILING = 360;

/* 1600x1000 is the window `shots.mjs` captures at, so the harness, the stills and the geometry in
   `docs/FRONTEND_CHECKPOINT.md` all describe one frame. Note that `--headless=new` still spends window
   chrome on it: the real viewport this yields is 1600x848, which is STRICTER than the 1000px fold the
   stills are composed against and closer to what a judge's browser actually shows. Every geometry
   assertion below is written against `innerHeight` for that reason — none of them hardcodes either
   number. Before this the harness ran at the 1440x900 default while every measurement in the docs was
   taken at 1600x1000, so nothing here shared a frame with the thing it was guarding. */
const session = await launch({ watchdogMs: 180_000, note, windowSize: "1600,1000" });
if (!session) process.exit(0);
const { evaluate, send, events, forget, close } = session;

note(`target    ${URL_UNDER_TEST}`);

/** Wall-clock helpers. Every wait is measured from navigation, never from the previous wait. */
let t0 = 0;
const elapsed = () => Date.now() - t0;
const waitUntil = async (ms) => {
  const left = ms - elapsed();
  if (left > 0) await sleep(left);
};

/**
 *  Sample an expression repeatedly across a window of wall-clock time.
 *
 *  A timeline is a moving target, and one `evaluate` inside a 1.5s tween is a coin flip about which
 *  frame it lands on. Polling turns "was the bloom the right hue" into a question about a set of
 *  observations rather than about one lucky instant.
 */
async function poll(expression, forMs, everyMs = 130) {
  const out = [];
  const until = elapsed() + forMs;
  while (elapsed() < until) {
    out.push(await evaluate(expression));
    await sleep(everyMs);
  }
  return out;
}

/** The first rgb triple in a computed value, as numbers. Null when there is no colour in it. */
const RGB_HELPER = `
  window.__rgb = (s) => {
    const m = /rgba?\\(\\s*([\\d.]+)[,\\s]+([\\d.]+)[,\\s]+([\\d.]+)/.exec(s || "");
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  window.__cards = () => [...document.querySelectorAll(".card")];
  window.__card = (id) => window.__cards().find(
    (c) => (c.querySelector(".card-id")?.textContent || "").trim() === "#" + id
  ) || null;
  true;`;

/*//////////////////////////////////////////////////////////////
                            NAVIGATE
//////////////////////////////////////////////////////////////*/

t0 = Date.now();
await send("Page.navigate", { url: URL_UNDER_TEST });
await sleep(1700); // first paint + the `first()` entrance stagger, all wall clock
await evaluate(RGB_HELPER);
note(`navigated + first paint settled at ${elapsed()}ms (wall clock)`);

/* ── 4. the re-headed document ───────────────────────────────────────────── */
const head = await evaluate(`(() => {
  const meta = (n) => document.querySelector('meta[name="' + n + '"]')?.content ?? null;
  const icon = document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? "";
  return {
    title: document.title,
    colorScheme: meta("color-scheme"),
    themeColor: meta("theme-color"),
    sheets: [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.getAttribute("href")),
    preloads: [...document.querySelectorAll('link[rel="preload"]')].map(l => ({
      href: l.getAttribute("href"), cors: l.hasAttribute("crossorigin"),
    })),
    iconIsMintCell: icon.includes("5fe3c0") && icon.includes("7a7686"),
    iconIsPurpleHelix: /7a5cff/i.test(icon),
  };
})()`);
if (head.colorScheme !== "dark") fail.push(`color-scheme is ${JSON.stringify(head.colorScheme)}, expected "dark"`);
if (head.themeColor !== "#060d0c") fail.push(`theme-color is ${JSON.stringify(head.themeColor)}, expected "#060d0c"`);
if (head.sheets.length !== 1) fail.push(`expected exactly one stylesheet link, found ${head.sheets.length}: ${head.sheets.join(", ")}`);
if (!head.iconIsMintCell) fail.push("the favicon is not the mint-cell mark — the tab changes identity on the click-through from the landing");
if (head.iconIsPurpleHelix) fail.push("the favicon is still the retired purple helix");
const uncorsed = head.preloads.filter((p) => !p.cors).map((p) => p.href);
if (uncorsed.length) fail.push(`font preload without crossorigin (downloaded twice): ${uncorsed.join(", ")}`);
note(`title     ${JSON.stringify(head.title)}`);
note(`head      color-scheme=${head.colorScheme} theme-color=${head.themeColor} sheets=${head.sheets.length} preloads=${head.preloads.length} mint-favicon=${head.iconIsMintCell}`);

/* ── 5a. structure ───────────────────────────────────────────────────────── */
const struct = await evaluate(`(() => ({
  cards: document.querySelectorAll(".card").length,
  dead: document.querySelectorAll(".card-dead").length,
  feedRows: document.querySelectorAll(".feed-row").length,
  metrics: document.querySelectorAll(".metric-value").length,
  phaseNodes: document.querySelectorAll(".phase-node").length,
  thesis: !!document.querySelector(".hero-thesis"),
  banner: (document.querySelector("#banner")?.textContent || "").includes("Synthetic"),
  edges: document.querySelectorAll(".tree-edge").length,
  innerHTMLFree: !/innerHTML/.test([...document.scripts].map(s => s.textContent).join("")),
}))()`);
if (struct.cards !== 12) fail.push(`expected 12 organisms on the first frame, found ${struct.cards}`);
if (struct.dead !== 2) fail.push(`expected 2 corpses on the first frame, found ${struct.dead}`);
if (!struct.feedRows) fail.push("the event feed rendered no rows");
if (!struct.thesis) fail.push(".hero-thesis did not render");
if (!struct.banner) fail.push("the demo banner does not say Synthetic — a judge could mistake the fixture for live data");
note(`structure cards ${struct.cards} (${struct.dead} dead) · feed ${struct.feedRows} · metrics ${struct.metrics} · phase ${struct.phaseNodes} · edges ${struct.edges}`);

/* ── 5a-bis. the corpses are above the fold ON A COLD LOAD ────────────────
   Check 13 below measures the same band after a death has landed. This one measures it here, at
   first paint, because that is the case that was actually broken: the fixture opens with #3 and #5
   already dead and they used to render at y=1060 — off the bottom of the page — so the page's
   RESTING state had never shown a corpse to anyone, and no fix living in the death timeline could
   have changed that. TOMB_CEILING guards the other half of the design: the band costs 46px per row
   only while `.tomb-line` stays on ONE line, and a wrap would roughly double it. */
const TOMB_CEILING = 56;
const cold = await evaluate(`(() => {
  const tombs = [...document.querySelectorAll(".card-tomb")].map(t => {
    const r = t.getBoundingClientRect();
    return { id: (t.querySelector(".card-id")?.textContent || "?").trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) };
  });
  const toll = document.querySelector(".toll");
  return { tombs, fold: window.innerHeight, scrollY: window.scrollY,
           toll: toll ? { top: Math.round(toll.getBoundingClientRect().top), text: toll.textContent.trim() } : null };
})()`);
if (cold.scrollY !== 0) fail.push(`the page was already scrolled to ${cold.scrollY} — the fold reading below would be measuring the wrong thing`);
if (cold.tombs.length !== 2) fail.push(`expected 2 tombstones in the corpse band on a cold load, found ${cold.tombs.length}`);
for (const t of cold.tombs) {
  if (t.bottom >= cold.fold) fail.push(`corpse ${t.id} is not fully above the fold on a cold load: bottom ${t.bottom} against a ${cold.fold}px viewport`);
  if (t.h > TOMB_CEILING) fail.push(`tombstone ${t.id} is ${t.h}px tall — over the ${TOMB_CEILING}px ceiling, so .tomb-line has wrapped to a second line`);
}
if (!cold.toll) fail.push("the header carries no .toll on a cold load — the death count is the only evidence of death that is in the viewport by construction");
else if (cold.toll.top >= cold.fold) fail.push(`.toll is below the fold on a cold load: top ${cold.toll.top} against ${cold.fold}px`);
note(`cold      corpses ${cold.tombs.map(t => `${t.id}@${t.top}+${t.h}`).join(" ")} · lowest bottom ${Math.max(...cold.tombs.map(t => t.bottom))} against a ${cold.fold}px fold · toll ${JSON.stringify(cold.toll?.text)} at y=${cold.toll?.top}`);

/* ── 5b. the vendored families, and the blue-green ground ────────────────── */
const fonts = await evaluate(`(async () => {
  await document.fonts.ready;
  const want = ["Newsreader", "IBM Plex Sans", "IBM Plex Mono"];
  const loaded = [...document.fonts].map(f => f.family.replace(/"/g, ""));
  return want.map(w => [w, loaded.includes(w) && document.fonts.check("16px " + JSON.stringify(w))]);
})()`);
const badFonts = fonts.filter(([, ok]) => !ok).map(([f]) => f);
if (badFonts.length) fail.push(`fonts did not load: ${badFonts.join(", ")}`);
note(`fonts     ${fonts.map(([f, ok]) => `${f}${ok ? " OK" : " MISSING"}`).join(" · ")}`);

const ground = await evaluate(`(() => {
  const bg = getComputedStyle(document.body).backgroundColor;
  const rgb = window.__rgb(bg);
  return { bg, rgb };
})()`);
if (!ground.rgb) {
  fail.push(`body has no resolved background colour (${ground.bg}) — tokens.css did not load`);
} else {
  const [r, g, b] = ground.rgb;
  // --ink is #060d0c: a blue-green black, deliberately never neutral. If the three channels are
  // equal the stylesheet fell back to a system colour and the whole palette is absent.
  if (r === g && g === b) fail.push(`the ground is neutral (${ground.bg}) — --ink is #060d0c and must not be grey`);
  if (g <= r || b <= r) fail.push(`the ground is not blue-green (${ground.bg}) — expected green and blue above red`);
}
note(`ground    ${ground.bg}`);

/* ── 5c. nothing stranded invisible ──────────────────────────────────────── */
const STRANDED = `(() => {
  const out = [];
  for (const el of document.querySelectorAll(".card, .metric-value, .hero-thesis, .phase-node, .feed-row")) {
    if (parseFloat(getComputedStyle(el).opacity) < 0.5) {
      out.push((el.className || el.tagName) + " :: " + el.textContent.trim().slice(0, 40));
    }
  }
  return out;
})()`;
const strandedFirst = await evaluate(STRANDED);
if (strandedFirst.length) {
  fail.push(`invisible after the entrance settled:\n    ${strandedFirst.join("\n    ")}`);
}
note(`stranded  ${strandedFirst.length} invisible nodes after the entrance`);

/*//////////////////////////////////////////////////////////////
                    FRAME 1 — settleAll: #8 DIES
//////////////////////////////////////////////////////////////*/

await waitUntil(SETTLE - 150);
const deathSamples = await poll(
  `(() => {
    const c = document.querySelector('.card[data-fx="died"]') || window.__card(8);
    if (!c) return null;
    const s = getComputedStyle(c);
    // A CONTROL, so this check cannot pass vacuously. If .card carried the alarm shadow in static
    // CSS, "the death bloomed coral" would be true of a page where no timeline ran at all.
    const quiet = window.__cards().find(x => x !== c && !x.dataset.fx && !x.classList.contains("card-dead"));
    return { shadow: s.boxShadow, rgb: window.__rgb(s.boxShadow), inlineFilter: c.style.filter || "",
             id: (c.querySelector(".card-id")?.textContent || "").trim(),
             control: quiet ? window.__rgb(getComputedStyle(quiet).boxShadow) : null,
             controlShadow: quiet ? getComputedStyle(quiet).boxShadow : null };
  })()`,
  1500,
);
const blooms = deathSamples.filter((s) => s?.rgb && !(s.rgb[0] === 0 && s.rgb[1] === 0 && s.rgb[2] === 0));
if (!blooms.length) {
  fail.push("the death never bloomed — no coloured box-shadow observed across the 1.5s death timeline");
} else {
  const redDominant = blooms.filter((s) => s.rgb[0] > s.rgb[1] && s.rgb[0] > s.rgb[2]);
  const blueDominant = blooms.filter((s) => s.rgb[2] > s.rgb[0] && s.rgb[2] > s.rgb[1]);
  if (redDominant.length !== blooms.length) {
    fail.push(
      `the death bloom is not the alarm hue in ${blooms.length - redDominant.length}/${blooms.length} samples — ` +
        `expected red-dominant (--bad #f2645f), saw ${JSON.stringify(blooms.map((s) => s.rgb))}`,
    );
  }
  if (blueDominant.length) fail.push(`the death bloomed BLUE — the retired --helix indigo is back: ${JSON.stringify(blueDominant[0].rgb)}`);

  const controlBloomed = blooms.filter((s) => s.control && s.control[0] > s.control[1] && s.control[0] > s.control[2]);
  if (controlBloomed.length) {
    fail.push(
      `a LIVING organism carries the alarm shadow too (${blooms[0].controlShadow}) — the bloom is static CSS, ` +
        `not the death timeline, and this check proves nothing`,
    );
  }
  note(`death     ${blooms.length} bloom samples on ${blooms[0].id}, first ${JSON.stringify(blooms[0].rgb)}, last ${JSON.stringify(blooms[blooms.length - 1].rgb)}`);
  note(`  control living card shadow ${JSON.stringify(blooms[0].controlShadow)}`);
}

/* ── 7. the death settles into ash with no jump ──────────────────────────── */
await waitUntil(SETTLE + 3000);
const corpse = await evaluate(`(() => {
  const c = window.__card(8);
  if (!c) return null;
  const s = getComputedStyle(c);
  return { isDead: c.classList.contains("card-dead"), filter: s.filter,
           inlineFilter: c.style.filter || "", inlineShadow: c.style.boxShadow || "",
           opacity: s.opacity, stamped: c.dataset.fx || "" };
})()`);
if (!corpse) {
  fail.push("organism #8 is not on the page after the settlement frame");
} else {
  if (!corpse.isDead) fail.push("#8 did not settle into .card-dead after dying");
  // INVARIANT: `motion.js`'s died() ends on saturate(0.15) and then clearProps drops the inline
  // style, and `.card-dead` supplies exactly the same value in CSS. If the two ever drift the card
  // visibly JUMPS on the last frame of the death. This is the assertion for that.
  if (corpse.inlineFilter) {
    fail.push(`the death left an inline filter behind (${corpse.inlineFilter}) — clearProps did not run`);
  }
  if (!/saturate\(0\.15\)/.test(corpse.filter)) {
    fail.push(
      `the corpse rests at filter ${JSON.stringify(corpse.filter)}, not saturate(0.15) — ` +
        `app.css and motion.js's died() have drifted, and the card jumps at the end of the death`,
    );
  }
  if (parseFloat(corpse.opacity) < 0.5) fail.push(`the corpse is invisible (opacity ${corpse.opacity}) — a death must leave a body`);
  note(`corpse    #8 card-dead=${corpse.isDead} filter=${corpse.filter} inline=${JSON.stringify(corpse.inlineFilter)} opacity=${corpse.opacity}`);
}

/* ── 13. THE FIX: at rest, every corpse is inside the viewport ───────────── */
//
// The check the corpse band exists to pass, and the one this whole page was failing silently. The old
// layout sorted the dead to the back of a three-column flow that starts 564px down at a 165px pitch,
// so the first corpse sat at y=1060 — 60px below a 1000px fold — with #3 and #5 ALREADY in it at
// FIRST PAINT, before a single frame of animation ran. So no fix that lives in the death timeline
// could have worked: the state that failed was the resting one.
//
// Measured against `innerHeight` and reported as a number rather than a boolean, so it fails with the
// reading that diagnoses it, and so it cannot start silently testing a viewport nobody runs.
const corpses = await evaluate(`(() => {
  const t = [...document.querySelectorAll(".card-tomb")];
  if (!t.length) return "no corpse band rendered";
  const worst = Math.max(...t.map((n) => n.getBoundingClientRect().bottom));
  return worst < innerHeight
    ? { n: t.length, worst: Math.round(worst), fold: innerHeight }
    : "lowest corpse bottom at " + Math.round(worst) + " against a " + innerHeight + "px fold";
})()`);
if (typeof corpses === "string") {
  fail.push(`a death is not visible at rest: ${corpses}`);
} else {
  note(`corpses   ${corpses.n} in the band, lowest bottom ${corpses.worst} against a ${corpses.fold}px fold`);
}

/* ── the hero states the BODY count, in fold, off the snapshot ───────────── */
const toll = await evaluate(`(() => {
  const n = document.querySelector(".toll");
  if (!n) return "no toll rendered";
  const r = n.getBoundingClientRect();
  return { top: Math.round(r.top), text: n.textContent.trim(), fold: innerHeight };
})()`);
if (typeof toll === "string") {
  fail.push(`the hero does not state the body count: ${toll} — 'alive' alone is a head count`);
} else if (toll.top >= toll.fold) {
  fail.push(`the death toll is below the fold at y=${toll.top} against ${toll.fold} — an aggregate nobody can read`);
} else {
  note(`toll      ${JSON.stringify(toll.text)} at y=${toll.top}`);
}

const headerH = await evaluate(`Math.round(document.querySelector("#header").getBoundingClientRect().height)`);
if (headerH > HEADER_CEILING) {
  fail.push(
    `#header is ${headerH}px, over its ${HEADER_CEILING}px ceiling — whatever was added to the hero is ` +
      `pushing the population back down the page, which is how the corpse went under the fold the first time`,
  );
}
note(`header    ${headerH}px against a ${HEADER_CEILING}px ceiling`);

/*//////////////////////////////////////////////////////////////
                   FRAME 2 — hatchAll: #13 IS BORN
//////////////////////////////////////////////////////////////*/

await waitUntil(HATCH - 150);
const birthSamples = await poll(
  `(() => {
    const c = document.querySelector('.card[data-fx="born"]') || window.__card(13);
    if (!c) return null;
    const s = getComputedStyle(c);
    const quiet = window.__cards().find(x => x !== c && !x.dataset.fx && !x.classList.contains("card-dead"));
    return { rgb: window.__rgb(s.boxShadow), opacity: s.opacity,
             id: (c.querySelector(".card-id")?.textContent || "").trim(),
             control: quiet ? window.__rgb(getComputedStyle(quiet).boxShadow) : null,
             controlShadow: quiet ? getComputedStyle(quiet).boxShadow : null };
  })()`,
  1500,
);
const bBlooms = birthSamples.filter((s) => s?.rgb && !(s.rgb[0] === 0 && s.rgb[1] === 0 && s.rgb[2] === 0));
if (!bBlooms.length) {
  fail.push("the birth never bloomed — no coloured box-shadow observed across the 1.4s born timeline");
} else {
  const greenDominant = bBlooms.filter((s) => s.rgb[1] > s.rgb[0] && s.rgb[1] > s.rgb[2]);
  const blueDominant = bBlooms.filter((s) => s.rgb[2] > s.rgb[0] && s.rgb[2] > s.rgb[1]);
  if (blueDominant.length) {
    fail.push(
      `THE BIRTH BLOOMED INDIGO — this is the exact re-theme bug: ${JSON.stringify(blueDominant[0].rgb)}. ` +
        `motion.js is reading a token name tokens.css does not define.`,
    );
  }
  if (greenDominant.length !== bBlooms.length) {
    fail.push(
      `the birth bloom is not the life hue in ${bBlooms.length - greenDominant.length}/${bBlooms.length} samples — ` +
        `expected green-dominant (--life #5fe3c0), saw ${JSON.stringify(bBlooms.map((s) => s.rgb))}`,
    );
  }
  const controlBloomed = bBlooms.filter((s) => s.control && s.control[1] > s.control[0] && s.control[1] > s.control[2]);
  if (controlBloomed.length) {
    fail.push(
      `a quiet organism carries the life shadow too (${bBlooms[0].controlShadow}) — the bloom is static CSS, ` +
        `not the birth timeline, and this check proves nothing`,
    );
  }
  note(`birth     ${bBlooms.length} bloom samples on ${bBlooms[0].id}, first ${JSON.stringify(bBlooms[0].rgb)}, last ${JSON.stringify(bBlooms[bBlooms.length - 1].rgb)}`);
}

await waitUntil(HATCH + 2200);
const newborn = await evaluate(`(() => {
  const c = window.__card(13);
  if (!c) return null;
  const s = getComputedStyle(c);
  return { opacity: s.opacity, transform: s.transform, inlineOpacity: c.style.opacity || "",
           dead: c.classList.contains("card-dead") };
})()`);
if (!newborn) fail.push("the child #13 never appeared");
else {
  if (parseFloat(newborn.opacity) < 0.9) fail.push(`the newborn is stranded at opacity ${newborn.opacity} — born() starts from 0 and must finish`);
  if (newborn.inlineOpacity) fail.push(`born() left an inline opacity behind (${newborn.inlineOpacity}) — clearProps did not run`);
  if (newborn.dead) fail.push("the newborn rendered as a corpse");
  note(`newborn   #13 opacity=${newborn.opacity} inline=${JSON.stringify(newborn.inlineOpacity)}`);
}

/* ── 9. no retired-palette colour anywhere ───────────────────────────────── */
const retired = await evaluate(`(() => {
  const want = ${JSON.stringify(RETIRED)};
  const hits = [];
  for (const el of document.querySelectorAll("*")) {
    const s = getComputedStyle(el);
    const blob = s.color + " | " + s.backgroundColor + " | " + s.boxShadow + " | " + s.borderColor;
    for (const [name, rgb] of want) {
      if (blob.includes("rgb(" + rgb + ")") || blob.includes("rgba(" + rgb)) {
        hits.push(name + " on " + (el.className || el.tagName));
      }
    }
  }
  return [...new Set(hits)];
})()`);
if (retired.length) fail.push(`retired-palette colours are still on the page:\n    ${retired.join("\n    ")}`);
note(`palette   ${retired.length} retired-colour hits`);

/*//////////////////////////////////////////////////////////////
                  FRAME 3 — think: THE FEED WASHES IN
//////////////////////////////////////////////////////////////*/

await waitUntil(THINK - 150);
const washSamples = await poll(
  `(() => {
    const rows = [...document.querySelectorAll('.feed-row[data-fx="new"]')];
    if (!rows.length) return null;
    const lit = rows.map(r => ({ rgb: window.__rgb(getComputedStyle(r).backgroundColor),
                                 opacity: getComputedStyle(r).opacity }))
                    .filter(x => x.rgb);
    // Control: an older row the diff did NOT stamp. If it is tinted too, the wash is static CSS.
    const old = [...document.querySelectorAll(".feed-row")].find(r => r.dataset.fx !== "new");
    return { rows: rows.length, lit,
             control: old ? window.__rgb(getComputedStyle(old).backgroundColor) : null,
             controlBg: old ? getComputedStyle(old).backgroundColor : null };
  })()`,
  1600,
);
const washes = washSamples.filter((s) => s?.lit?.length).flatMap((s) => s.lit);
const tinted = washes.filter((w) => !(w.rgb[0] === 0 && w.rgb[1] === 0 && w.rgb[2] === 0));
if (!washSamples.some((s) => s?.rows)) {
  fail.push('no feed row was stamped data-fx="new" on the think frame — the diff did not see the new logs');
} else if (!tinted.length) {
  fail.push("new feed rows never washed — no tinted background observed across the 1.6s wash");
} else {
  const greenDominant = tinted.filter((w) => w.rgb[1] > w.rgb[0] && w.rgb[1] >= w.rgb[2]);
  if (greenDominant.length !== tinted.length) {
    fail.push(
      `the feed wash is not the deep life tint in ${tinted.length - greenDominant.length}/${tinted.length} samples — ` +
        `expected green-dominant (--life-deep #113029), saw ${JSON.stringify(tinted.slice(0, 6).map((w) => w.rgb))}`,
    );
  }
  const withControl = washSamples.find((s) => s?.control);
  const controlTinted = washSamples.filter(
    (s) => s?.control && s.control[1] > s.control[0] && s.control[1] > s.control[2] && s.control[1] > 20,
  );
  if (controlTinted.length) {
    fail.push(
      `an UNSTAMPED feed row is tinted too (${controlTinted[0].controlBg}) — the wash is static CSS, ` +
        `not the diff, and this check proves nothing`,
    );
  }
  note(`feed wash ${tinted.length} tinted samples, first ${JSON.stringify(tinted[0].rgb)}`);
  note(`  control unstamped row bg ${JSON.stringify(withControl?.controlBg ?? null)}`);
}

/*//////////////////////////////////////////////////////////////
        FRAME 4 — commitAll: THE SEASON LANDS, AND THEN ENDS
//////////////////////////////////////////////////////////////*/

await waitUntil(COMMIT + 2400);
const final = await evaluate(`(() => {
  const rows = [...document.querySelectorAll(".feed-row")];
  const flat = (n) => (n?.textContent || "").replace(/\\s+/g, " ").trim();
  return {
  cards: document.querySelectorAll(".card").length,
  dead: document.querySelectorAll(".card-dead").length,
  phaseOn: document.querySelectorAll(".phase-node.is-on, .phase-node.is-now, .phase-node.on").length,
  header: (document.querySelector("#header")?.textContent || ""),
  body: (document.querySelector("#body")?.textContent || "").length,
  feedRows: rows.length,
  // The top four rows are the season close: SeasonEnded, then the three payouts climbing back up
  // through the placings. Read as text and as classes, because the two say different things.
  top: rows.slice(0, 4).map(flat),
  topGood: rows.slice(0, 4).filter((r) => r.className.includes("sev-good")).length,
  won: rows.filter((r) => flat(r).includes(" won ")).map(flat),
  };
})()`);
if (final.cards !== 13) fail.push(`the season should end with 13 organisms, found ${final.cards}`);
if (final.dead !== 3) fail.push(`the season should end with 3 corpses, found ${final.dead}`);
if (!/42/.test(final.header)) fail.push(`the header never reached window 42: ${JSON.stringify(final.header.slice(0, 120))}`);

/*
 *  THE SEASON ACTUALLY CLOSING, IN A REAL BROWSER.
 *
 *  `SeasonEnded` and `SeasonPrizePaid` (`render.js:1463-1464`) had no caller anywhere until the script
 *  was given a close, and the prize pool paying out 60/30/10 is the beat the business model rests on.
 *  `web/test/smoke.mjs` recomputes every figure against `Population.sol`; this is the other half of
 *  that, and the only half that proves the rows survive the real DOM, the real stylesheet and the
 *  motion pass — a `sev-good` that loses the cascade is invisible to the fake DOM by construction.
 *
 *  Read on TEXT, not on a hardcoded number: the amounts are derived from the pot in the fixture, so a
 *  literal here would go stale the first time the demo's records are retuned. What is asserted is the
 *  SHAPE — a close row naming its season with a pot and a payout, three winners each with a number
 *  rather than the em dash `money2` prints for a missing arg, and the header already on the next
 *  season while the feed still names the one that ended.
 */
const closeRow = final.top[0] ?? "";
if (!/season \d+ ended/.test(closeRow)) {
  fail.push(`the season never closed on screen — top feed row is ${JSON.stringify(closeRow.slice(0, 140))}`);
} else if (!/pot [\d,.]+ \S+ · paid [\d,.]+ \S+/.test(closeRow)) {
  fail.push(`the close row does not print a pot and a payout: ${JSON.stringify(closeRow.slice(0, 140))}`);
}
if (final.won.length !== 3) {
  fail.push(`the close should pay three places, found ${final.won.length}: ${JSON.stringify(final.won.slice(0, 3))}`);
}
const dashed = final.won.filter((r) => !/won [\d,.]+ \S+ in season \d+/.test(r));
if (dashed.length) {
  fail.push(`a payout rendered without an amount (money2 prints an em dash for a missing arg):\n    ${dashed.join("\n    ")}`);
}
// The band, and the control that it belongs to the payouts rather than to the close. `SEVERITY` has
// `SeasonPrizePaid: "good"` and no entry for `SeasonEnded` — three of the top four, never four.
if (final.topGood !== 3) {
  fail.push(`expected exactly 3 sev-good rows in the close block, found ${final.topGood} — either the payouts lost their band or the close row gained one`);
}
// `seasonStartWindow = windowCount` resets `level()` and `ante()`, and the header prints "season N ·
// 0 / seasonWindows" while the feed below still names the season that ended. Both must be true at once.
if (!/season 2 · 0 \/ 42/.test(final.header.replace(/\s+/g, " "))) {
  fail.push(`the header did not roll over to the next season: ${JSON.stringify(final.header.replace(/\s+/g, " ").slice(0, 200))}`);
}
if (!/season 1 ended/.test(closeRow)) {
  fail.push(`the close row names the wrong season — it must name the one that ENDED, not the one that started: ${JSON.stringify(closeRow.slice(0, 140))}`);
}
const strandedFinal = await evaluate(STRANDED);
if (strandedFinal.length) fail.push(`invisible on the final frame:\n    ${strandedFinal.join("\n    ")}`);
note(`final     cards ${final.cards} (${final.dead} dead) · ${final.body} chars of body · stranded ${strandedFinal.length}`);
note(`close     ${JSON.stringify(closeRow.slice(0, 90))} · ${final.won.length} payouts · ${final.topGood} sev-good · ${final.feedRows} feed rows`);

/*//////////////////////////////////////////////////////////////
              1, 2, 3 — WHAT THE BROWSER COMPLAINED ABOUT
//////////////////////////////////////////////////////////////*/

const c = classify(events);
if (c.logErrors.length) fail.push(`browser errors:\n    ${c.logErrors.join("\n    ")}`);
if (c.apiErrors.length) fail.push(`console.error from page:\n    ${c.apiErrors.join("\n    ")}`);
if (c.exceptions.length) fail.push(`exceptions:\n    ${c.exceptions.join("\n    ")}`);
if (c.failedReqs.length) fail.push(`failed requests:\n    ${c.failedReqs.join("\n    ")}`);

// THE TOKEN-DRIFT GUARD. `motion.js` warns once per name that is absent from `tokens.css`. That
// warning firing means a timeline is painting a fallback hex from a palette that no longer exists,
// which is invisible on screen precisely because the fallback looks plausible.
const motionWarnings = c.warnings.filter((w) => w.includes("motion.js"));
if (motionWarnings.length) {
  fail.push(`motion.js is reading tokens that tokens.css does not define:\n    ${motionWarnings.join("\n    ")}`);
}
if (c.warnings.length) note(`  (console warnings: ${c.warnings.length} — ${c.warnings.slice(0, 3).join(" | ")})`);

// The network-unplugged claim, asserted rather than believed. In demo mode `main.js` imports
// `fixture.js` and never reaches `chain.js`, so viem's CDN is never fetched and no RPC is called.
const offOrigin = c.requested.filter((u) => !u.startsWith("http://localhost:3000/") && !u.startsWith("data:") && !u.startsWith("blob:"));
if (offOrigin.length) {
  fail.push(`?demo=1 reached off-origin, so it does NOT work with the network unplugged:\n    ${[...new Set(offOrigin)].join("\n    ")}`);
}
note(`network   ${c.requested.length} requests, ${offOrigin.length} off-origin · errors ${c.logErrors.length}/${c.apiErrors.length} · exceptions ${c.exceptions.length}`);

/*//////////////////////////////////////////////////////////////
      11b — THE INTERACTIVE STATES ACTUALLY CHANGE SOMETHING
//////////////////////////////////////////////////////////////*/

/* Selection and hover are the only two affordances this console has, and a swallowed state rule makes
   one of them silently inert: the state class IS on the node, the sheet DOES have a rule for it, and
   the rule loses the cascade. Three of those shipped at once — see the header note. Read on the landed
   season, and deliberately after `classify` above, so the DOM/CSS domains this check enables cannot
   put traffic anywhere near the console classification.

   `:hover` is forced through CDP rather than simulated with a class, because adding a class would
   change the very cascade being measured. `border-color` IS transitioned (`--d-fast`), so it is
   sampled on the wall clock past that; `fill` is not, so it is read immediately. Every assertion is
   against a CONTROL taken off the same page — the unselected card's own hover, the living node's own
   selection — so nothing here pins a hex and a palette change moves both sides together. Two of the
   assertions exist purely to fail if the CONTROL stops responding, because a check whose instrument is
   dead reports the same green as a page that works. */
await send("DOM.enable", {});
await send("CSS.enable", {});
const { root: stateRoot } = await send("DOM.getDocument", { depth: -1 });
const TX = 260; // > --d-fast (0.16s): border-color transitions, so read after it has landed
const rgbOf = (s) => {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(s || "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const lum = (c) => (c ? c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722 : null);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Computed `prop` on `sel` while :hover is forced on `hoverSel`. Released before returning. */
async function withHover(sel, hoverSel, prop, settleMs) {
  const { nodeId } = await send("DOM.querySelector", { nodeId: stateRoot.nodeId, selector: hoverSel });
  if (!nodeId) return null;
  await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] });
  await sleep(settleMs);
  const v = await evaluate(
    `(() => { const e = document.querySelector(${JSON.stringify(sel)});
      return e && e.isConnected ? getComputedStyle(e)[${JSON.stringify(prop)}] : null; })()`,
  );
  await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  await sleep(settleMs);
  return v;
}

/* ── A. the census dead tally is quieter than the counts beside it ────────── */
const censusRow = await evaluate(`(() => {
  const row = document.querySelector(".census tbody tr");
  if (!row) return null;
  return [...row.children].map(td => ({
    muted: (td.className || "").split(" ").indexOf("muted") >= 0,
    text: td.textContent.trim().slice(0, 24),
    rgb: window.__rgb(getComputedStyle(td).color),
  }));
})()`);
if (!censusRow) {
  fail.push("the census rendered no rows, so nothing here can read the dead tally");
} else {
  const mutedCells = censusRow.filter((x) => x.muted && x.rgb);
  const plainCells = censusRow.filter((x) => !x.muted && x.rgb);
  if (!mutedCells.length) {
    fail.push("no census cell carries `muted` — render.js marks the dead tally with it, so the markup or this check has moved");
  }
  if (!plainCells.length) {
    fail.push("every census cell is `muted`, so there is nothing to be quieter THAN — the control is gone");
  }
  for (const m of mutedCells) {
    const notQuieter = plainCells.find((p) => lum(p.rgb) <= lum(m.rgb));
    if (notQuieter) {
      fail.push(
        `the census dead tally ${JSON.stringify(m.text)} renders at ${JSON.stringify(m.rgb)}, no quieter than ` +
          `the plain cell ${JSON.stringify(notQuieter.text)} at ${JSON.stringify(notQuieter.rgb)} — ` +
          "`.census td` (0,1,1) has swallowed `.muted` (0,1,0) again, and the count of the dead shouts as loud as the living",
      );
    }
  }
  note(
    `states    census dead tally ${JSON.stringify(mutedCells[0]?.text)} at ${JSON.stringify(mutedCells[0]?.rgb)} ` +
      `under plain cells ${plainCells.map((p) => JSON.stringify(p.rgb)).join(" ")}`,
  );
}

/* ── B. selecting a card is visible, and the cursor does not erase it ─────── */
const cardBefore = await evaluate(`(() => {
  const living = window.__cards().filter(
    x => !x.classList.contains("card-dead") && !x.classList.contains("card-tomb") && !x.classList.contains("card-selected"));
  if (living.length < 2) return null;
  living[0].id = "chk-selected";
  living[1].id = "chk-plain";
  const resting = window.__rgb(getComputedStyle(living[0]).borderTopColor);
  living[0].classList.add("card-selected");
  return { resting };
})()`);
if (!cardBefore) {
  fail.push("check 11b found fewer than two unselected living cards — the season should land 13 organisms with 3 dead");
} else {
  await sleep(TX);
  const cardAfter = await evaluate(`(() => {
    const c = document.getElementById("chk-selected"), p = document.getElementById("chk-plain");
    if (!c || !p) return null;
    return { cls: c.className, selected: window.__rgb(getComputedStyle(c).borderTopColor),
             plain: window.__rgb(getComputedStyle(p).borderTopColor) };
  })()`);
  if (!cardAfter || !cardAfter.cls.split(" ").includes("card-selected")) {
    fail.push("the card under test lost `card-selected` before it could be read — a re-render raced this check");
  } else {
    if (same(cardBefore.resting, cardAfter.selected)) {
      fail.push(`selecting a card changes nothing at rest (border stayed ${JSON.stringify(cardAfter.selected)}) — \`.card-selected\` is being swallowed`);
    }
    const sh = rgbOf(await withHover("#chk-selected", "#chk-selected", "borderTopColor", TX));
    const ph = rgbOf(await withHover("#chk-plain", "#chk-plain", "borderTopColor", TX));
    if (ph && same(ph, cardAfter.plain)) {
      fail.push(`hover does nothing to an UNSELECTED card either (${JSON.stringify(ph)}) — the control is inert, so the reading below proves nothing`);
    }
    if (sh && ph && same(sh, ph)) {
      fail.push(
        `hovering the SELECTED card renders the same border as hovering an unselected one (${JSON.stringify(sh)}) — ` +
          "`.card:hover` (0,2,0) has taken `border-color` back off `.card-selected` (0,1,0), so the pointer erases the selection of the card it is pointing at",
      );
    }
    if (sh && !(sh[1] > sh[0] && sh[1] > sh[2])) {
      fail.push(`the selected card's border under the cursor is ${JSON.stringify(sh)}, not green-dominant — selection must brighten inside the life ramp, not fall back to a neutral`);
    }
    note(`states    card selection ${JSON.stringify(cardBefore.resting)} -> ${JSON.stringify(cardAfter.selected)}, hovered ${JSON.stringify(sh)} against an unselected ${JSON.stringify(ph)}`);
  }
}

/* ── C. a corpse in the lineage tree answers the cursor and selection ─────── */
const tree = await evaluate(`(() => {
  const dead = document.querySelector(".tree-node.is-dead");
  const live = document.querySelector(".tree-node:not(.is-dead)");
  if (!dead || !live) return null;
  dead.id = "chk-dead-node";
  live.id = "chk-live-node";
  const read = (n) => { const l = n.querySelector(".tree-label"); return l ? window.__rgb(getComputedStyle(l).fill) : null; };
  // The RING, separately from the label: they are styled by two different rules with two different
  // collisions, so one reading cannot stand in for the other.
  const ring = (n) => { const c = n.querySelector("circle"); return c ? window.__rgb(getComputedStyle(c).stroke) : null; };
  const deadResting = read(dead), liveResting = read(live);
  const deadRingResting = ring(dead), liveRingResting = ring(live);
  dead.classList.add("is-selected");
  const deadSelected = read(dead), deadRingSelected = ring(dead);
  dead.classList.remove("is-selected");
  live.classList.add("is-selected");
  const liveSelected = read(live), liveRingSelected = ring(live);
  live.classList.remove("is-selected");
  return {
    deadResting, deadSelected, liveResting, liveSelected,
    deadRingResting, deadRingSelected, liveRingResting, liveRingSelected,
  };
})()`);
if (!tree) {
  fail.push("the lineage tree did not render both a dead and a living node, so nothing here can compare them");
} else {
  // the instrument first: if the LIVING node stops answering, everything below is a false green
  if (same(tree.liveResting, tree.liveSelected)) {
    fail.push(`selection does nothing to a LIVING lineage node either (${JSON.stringify(tree.liveResting)}) — the control is inert, so the corpse readings prove nothing`);
  }
  const lh = rgbOf(await withHover("#chk-live-node .tree-label", "#chk-live-node", "fill", 60));
  if (lh && same(lh, tree.liveResting)) {
    fail.push(`hover does nothing to a LIVING lineage node either (${JSON.stringify(lh)}) — the control is inert`);
  }
  // then the corpse, which is the common case: most of any ancestry is dead
  if (same(tree.deadResting, tree.deadSelected)) {
    fail.push(
      `selecting a DEAD lineage node changes nothing (label stays ${JSON.stringify(tree.deadResting)}) — ` +
        "`.tree-node.is-dead .tree-label` and the hover/selection rule are both (0,3,0) and the dead one is later, so clicking a corpse in the ancestry says nothing back",
    );
  }
  const dh = rgbOf(await withHover("#chk-dead-node .tree-label", "#chk-dead-node", "fill", 60));
  if (dh && same(dh, tree.deadResting)) {
    fail.push(`hovering a DEAD lineage node changes nothing (label stays ${JSON.stringify(tree.deadResting)}) — the same swallow as selection, on the nodes a judge meets most`);
  }
  if (same(tree.deadSelected, tree.liveSelected)) {
    fail.push(`a selected corpse renders the same fill as a selected living node (${JSON.stringify(tree.deadSelected)}) — selection has un-killed it; a corpse must answer inside the ash ramp`);
  }
  /*  THE RING, WHICH THE LABEL READINGS ABOVE CANNOT SPEAK FOR.
   *
   *  The label collision was fixed 2026-09-01 by `.tree-node.is-dead.is-selected .tree-label`
   *  (`app.css:1423-1426`), and every check above passed from that day on — while the `circle` beside
   *  the label kept the identical unfixed collision one rule higher: `.tree-node.is-dead circle` and
   *  `.tree-node.is-selected circle` are both (0,2,1) and the selected rule is the later one, so
   *  selecting a corpse repainted its ring `--life`. Mint is this palette's word for alive (§2), on
   *  the one page whose loudest claim is that death is irreversible.
   *
   *  So this reads the stroke, and the control comes first for the same reason as above: if selection
   *  does nothing to a LIVING ring, the corpse reading below is a false green rather than a pass.
   */
  if (same(tree.liveRingResting, tree.liveRingSelected)) {
    fail.push(
      `selection does nothing to a LIVING lineage node's ring either (stays ${JSON.stringify(tree.liveRingResting)}) — ` +
        "the ring control is inert, so the corpse ring reading proves nothing",
    );
  }
  if (same(tree.deadRingSelected, tree.liveRingSelected)) {
    fail.push(
      `a selected corpse's RING is ${JSON.stringify(tree.deadRingSelected)}, identical to a selected living node's — ` +
        "`.tree-node.is-dead circle` and `.tree-node.is-selected circle` are both (0,2,1) and the selected rule is later, " +
        "so clicking a corpse paints it `--life`: mint means alive in this palette, and selection must not un-kill a node",
    );
  }
  note(`states    dead node ${JSON.stringify(tree.deadResting)} -> selected ${JSON.stringify(tree.deadSelected)} / hovered ${JSON.stringify(dh)} · living selected ${JSON.stringify(tree.liveSelected)}`);
  note(`states    dead ring ${JSON.stringify(tree.deadRingResting)} -> selected ${JSON.stringify(tree.deadRingSelected)} against a selected living ring ${JSON.stringify(tree.liveRingSelected)}`);
}

// Leave the DOM as it was found: the undeployed view below navigates away, but a stray state class
// would quietly change what any check added after this one is looking at.
await evaluate(`(() => {
  for (const id of ["chk-selected", "chk-plain", "chk-dead-node", "chk-live-node"]) {
    const n = document.getElementById(id);
    if (n) { n.classList.remove("card-selected", "is-selected"); n.removeAttribute("id"); }
  }
  return true;
})()`);


/*//////////////////////////////////////////////////////////////
        12 — THE FRONT DOOR: THE PRIMER AND THE OPERATOR'S FORM
//////////////////////////////////////////////////////////////*/

/*  THIS SECTION USED TO NAVIGATE TO A BARE `/arena/`, AND THAT STOPPED REACHING ITS SUBJECT.
 *
 *  It was written as "the page a judge sees today: no deployment", when `web/config.js` shipped
 *  `POPULATION = ""` and every resolution source came up empty, so a bare `/arena/` was the primer
 *  and the address form. `POPULATION` got Season 0's real proxy on 2026-09-08, and a bare `/arena/`
 *  is now the live arena — correctly, and by the same change that fixed the primer/arena flicker a
 *  visitor reported. Twelve assertions here then failed together on a page that was behaving exactly
 *  as designed: no `.panel-primer`, no `.panel-setup`, 2308 characters against a 1400 ceiling, zero
 *  beat claims, and 12b unable to inject its probe.
 *
 *  Twelve red lines that mean "the premise moved" are worse than no check at all: they are noise a
 *  real regression hides inside, on the day the suite matters most. But the primer is NOT dead code
 *  either — `main.js`'s `!app.cfg && !app.connecting` branch still paints it, and it is reached
 *  whenever the configured address does not resolve. So the subject is created on purpose now
 *  instead of assumed, and WHICH failure creates it is a deliberate choice:
 *
 *    · `?population=<no contract>` gives `absent`, whose documented remedy is "edit the address" —
 *      so it FORCES THE FOLD OPEN, and every fold and geometry assertion below loses its subject.
 *    · `?rpc=<dead port>` gives `unreachable`, where the address is unjudged and inviting an edit
 *      would be advice to break a working setting — so the fold stays CLOSED, which is the state
 *      this section was written against and the one 12c's comment describes.
 *
 *  The dead RPC is therefore not a shortcut to a green run, it is the one route that reaches the
 *  page as designed; and choosing it makes CLAUDE.md's `absent` ≠ `unreachable` rule executable at
 *  the DOM, where it had only ever been asserted against a classifier under a fake DOM. Port 9 is
 *  discard: the connection is refused rather than hanging, so the error state paints in one round
 *  trip. The failure is CAUGHT by `boot()`, so nothing here relaxes the exceptions check below.
 *
 *  And the primer is WAITED FOR rather than slept toward. Reaching it takes a refused connection
 *  plus viem's own retries, which is not a number this file can predict — a fixed sleep would make
 *  every assertion below a race against the RPC layer, which is exactly the defect the entrance
 *  measurement in 12d exists to document.
 */
forget();
const DEAD_RPC = "http://127.0.0.1:9/";
const bareUrl = URL_UNDER_TEST.replace(/\?.*$/, "");
const liveUrl = `${bareUrl}?rpc=${encodeURIComponent(DEAD_RPC)}`;
const VISIBLE = 0.5;
t0 = Date.now();
await send("Page.navigate", { url: liveUrl });
await sleep(1200);
await evaluate(RGB_HELPER);

const PRIMER_DEADLINE = 14_000;
let primerAt = null;
while (elapsed() < PRIMER_DEADLINE) {
  if (await evaluate(`!!document.querySelector(".panel-primer")`)) {
    primerAt = elapsed();
    break;
  }
  await sleep(150);
}
// Reported, not asserted here: every check below names the specific thing it could not find, which
// is more use than one line saying the page never got there. The note carries the latency so a
// reader can see whether the front door arrived in one round trip or in five.
note(`frontdoor primer at ${primerAt ?? "never"}ms via ${liveUrl}`);
await sleep(400); // the panels mount together; let the paint that carries the form finish

/* THE COPY BUDGET, ASSERTED FROM BOTH SIDES.
   This page is the whole product until Season 0 deploys, and it had grown to ~4530 characters of
   `#body`: five claims, five explanatory paragraphs under them, two asides, three quoted founder
   genomes, a footer, and a two-column address form with a lede of its own — in front of a judge who
   has thirty seconds and no address to type. The cut-down front door is ~900. The CEILING is the
   assertion; the FLOOR is its control, because "the copy is short" is passed maximally by a page that
   rendered nothing at all, which is the exact failure the old `chars < 40` guard was written for.
   Five claims plus one quoted genome plus two status lines cannot fit under the floor, so the two
   together say "there is a front door here and it is still terse". */
const COPY_CEILING = 1400;
const COPY_FLOOR = 600;

const setup = await evaluate(`(() => {
  const body = document.querySelector("#body")?.textContent || "";
  const head = document.querySelector("#header");
  const thesis = document.querySelector(".hero-thesis");
  const panel = document.querySelector(".panel-setup");
  const primer = document.querySelector(".panel-primer");
  const read = (el) => {
    const cs = getComputedStyle(el);
    return {
      family: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(),
      px: Math.round(parseFloat(cs.fontSize)),
      weight: cs.fontWeight,
      transform: cs.textTransform,
      tracking: cs.letterSpacing,
      color: cs.color,
      lh: parseFloat(cs.lineHeight),
    };
  };

  /* THE NEGATIVE CONTROL FOR 12b, INJECTED, because the thing it used to be read off is gone.
     The five beat claims are the primer's skim path: a judge who reads ONLY those five lines is
     supposed to leave with the whole mechanism. They are h3 elements, and ".panel h3" is a label
     rule one type-selector more specific than ".beat-claim", so until the fix landed they
     rendered as 11px uppercase mono in --text-3 — the treatment a minor label gets, and dimmer and
     smaller than the elective prose under them. Nothing else here can see that: it is a hierarchy
     inversion, not an error, an exception or a missing node. What wins today is
     ".beat-body > .beat-claim", one type-selector heavier, and the claims are still h3 inside
     .beat-body, so that contest is still live on every paint and this control still has a subject.
     What is gone is the PROSE the claims used to be compared against, so the comparison target is
     now a throwaway h3 appended
     to .panel-primer and positioned OUT OF FLOW so it cannot move anything it is the control for. It
     matches the same generic panel-label rule, off this page and this token set, so a rescale moves
     both sides together — and it exists whether or not any real label is left in the markup, which
     the label this replaces did not. 12b asserts the probe still renders AS a label before it
     compares anything to it. (No backticks in this comment: it lives inside a template literal.) */
  let label = null;
  if (primer) {
    const probe = document.createElement("h3");
    probe.textContent = "PROBE";
    probe.style.cssText = "position:fixed;left:-9999px;top:0";
    primer.appendChild(probe);
    label = read(probe);
    probe.remove();
  }

  /* THE INSTRUMENT CONTROL FOR "the fold is real".
     This check used to read getBoundingClientRect() and demand a 0x0 box. It could only ever fail.
     Chromium 147 folds a details by putting content-visibility:hidden on ::details-content, which
     skips PAINTING, not BOX GENERATION: a freshly injected, never-opened, default-UA-styled details
     reports a full 1567x24 box for its body, identical closed and open. A rect cannot distinguish
     the two states here, so a rect was never evidence about the fold — the same defect class as the
     transition read mid-flight and the hover forced on the wrong element: a confident number that
     was not a measurement of anything.
     checkVisibility() does distinguish them, and rather than trust that, this injects a closed
     details and opens it in the same frame. The pair pins the instrument in BOTH directions, so a
     browser that starts answering "hidden" to everything fails HERE, loudly, instead of silently
     passing the fold check forever after. Positioned out of flow so it moves nothing.
     THE offsetHeight READS ARE LOAD-BEARING. Setting .open = true does not update the
     content-visibility skipped state that contentVisibilityAuto reads: that bit lands on the next
     lifecycle pass, so a checkVisibility() taken straight after the assignment reports the OLD
     state and the control reads closed=false/open=false — hidden in both directions, which is
     precisely the dead instrument this control exists to catch. It caught itself. Forcing layout
     between the write and the read is what makes the second cell a measurement.
     (No backticks in this comment: it lives inside a template literal.) */
  const SEEN = { contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true };
  const foldProbe = (() => {
    const d = document.createElement("details");
    const s = document.createElement("summary");
    s.textContent = "PROBE";
    const b = document.createElement("div");
    b.textContent = "PROBE";
    d.append(s, b);
    d.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(d);
    void d.offsetHeight;
    const closed = b.checkVisibility(SEEN);
    d.open = true;
    void d.offsetHeight;
    const open = b.checkVisibility(SEEN);
    d.remove();
    return { closed, open };
  })();

  const form = document.querySelector(".setup-form");
  if (form) void form.offsetHeight;

  return {
    hasPrimer: !!primer,
    hasSetup: !!document.querySelector(".panel-setup, .setup-card, .setup"),
    chars: body.trim().length,
    // The front door used to render the form under an EMPTY header: no wordmark, no claim. It is the
    // only page that exists before Season 0, so the identity is asserted, not assumed.
    wordmark: (head?.querySelector("h1")?.textContent || "").trim(),
    thesisText: (thesis?.textContent || "").trim(),
    thesisOpacity: thesis ? getComputedStyle(thesis).opacity : null,
    // Read off the masthead, not the panel: a one-child three-column grid strands the sentence at
    // 42% of the viewport, which looks exactly like a layout that lost two columns. Reported rather
    // than asserted — the correct ratio is a design decision and nothing here can name it.
    thesisWidthRatio: thesis
      ? +(thesis.getBoundingClientRect().width / document.documentElement.clientWidth).toFixed(3)
      : null,
    /* IS THE SENTENCE STRANDED? — the intent the retired panelCols !== 2 was standing in for.
       That assertion pinned an exact column count, so a correct layout with three columns failed it
       and a WRONG layout with two passed. The defect it was written for is not a number of columns:
       it is one short sentence sitting in a narrow measure with NOTHING BESIDE IT, which reads as a
       layout that lost the rest of its row. So narrowness alone is not the fault — narrowness with
       empty space to the right is. A masthead that deliberately sets the thesis against a paragraph
       is narrow too, and correct, and this passes it BECAUSE it finds the paragraph.
       Read relatively: the thesis width against its own container, never against a literal px, so a
       rescale moves both sides together. A candidate counts only if it carries its own text (a
       wrapper cannot vouch for space it does not fill) and actually shares the thesis's horizontal
       band. THE CONTROL is the same verdict function run over an EMPTY candidate list: that must
       come back stranded, or the detector cannot report the defect it exists for. It tests the
       decision, not the DOM query — so the neighbour that vouched is named in the note, where a
       human can see which element the live verdict rested on.
       (No backticks in this comment: it lives inside a template literal.) */
    thesisStranded: (() => {
      if (!thesis || !head) return null;
      const t = thesis.getBoundingClientRect();
      const avail = head.getBoundingClientRect().width;
      if (!avail || !t.width) return null;
      const ratio = +(t.width / avail).toFixed(3);
      const neighbours = [...head.querySelectorAll("*")]
        .filter((el) => el !== thesis && !thesis.contains(el) && !el.contains(thesis))
        .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
        .map((el) => ({ name: el.className || el.tagName, r: el.getBoundingClientRect() }))
        .filter((c) => c.r.width > 0 && c.r.height > 0)
        .filter((c) => c.r.bottom > t.top + 4 && c.r.top < t.bottom - 4)
        .filter((c) => c.r.left >= t.right - 4);
      const verdict = (list) => ({
        ratio,
        narrow: ratio < 0.55,
        beside: list.length ? list[0].name : null,
        stranded: ratio < 0.55 && list.length === 0,
      });
      return { live: verdict(neighbours), control: verdict([]) };
    })(),
    // Read for shape, not for a phrase. See the assertion for why the substance is a note and not a
    // check: the primer's lede is quoted alongside so a duplicate of it is visible in the run.
    thesisWords: (thesis?.textContent || "").trim().split(/\s+/).filter(Boolean).length,
    primerLede: (primer?.querySelector(".primer-status")?.textContent || "").trim(),
    // The operator's form is a disclosure now. Its TAG is part of the contract: a section puts the
    // address field back on the front door, which is the thing the cut-down page exists to undo.
    setupTag: panel ? panel.tagName.toLowerCase() : null,
    setupOpen: panel ? panel.hasAttribute("open") : null,
    summary: (panel?.querySelector("summary")?.textContent || "").trim(),
    // Nothing on this page may read geometry off the folded subtree, so whether it is ACTUALLY
    // hidden from a visitor is measured once, here, and asserted below — against the instrument
    // control above, never against a rect. See the comment on foldProbe for why a rect lies.
    formHidden: form ? !form.checkVisibility(SEEN) : null,
    foldProbe,
    inputs: ["pop-input", "rpc-input"].filter((id) => document.getElementById(id)).length,
    submitText: (document.querySelector(".setup-form button[type=submit]")?.textContent || "").trim(),
    /* Scoped to things a visitor can CLICK, not to the prose. The defect is a control labelled
       Connect, and prose is allowed to use the word (a status line may well say the page needs no
       wallet connection) without asking anybody for one. */
    connectLabels: [...document.querySelectorAll("#body button, #body a, #body summary")]
      .map((e) => (e.textContent || "").trim())
      .filter((t) => /connect/i.test(t)),
    // The two ways out of a page that has no data yet. Read as hrefs, because the labels are copy
    // and the destinations are the function.
    actions: [...document.querySelectorAll(".primer-actions a, .primer-actions button")].map((a) => ({
      cls: a.className || "",
      href: a.getAttribute("href") || "",
      text: (a.textContent || "").trim(),
    })),
    // The one piece of evidence on the page that an organism really is English prose. Quoting is the
    // whole reason it is here rather than a description, so at least one has to survive the cut.
    specimens: primer ? primer.querySelectorAll(".specimen").length : 0,
    stranded: [...document.querySelectorAll(".panel, .panel-primer, .panel-setup, .setup-card")]
      .filter(el => parseFloat(getComputedStyle(el).opacity) < 0.5).length,
    bg: getComputedStyle(document.body).backgroundColor,
    claims: [...(primer ? primer.querySelectorAll(".beat-claim") : [])].map((h) => {
      const m = read(h);
      const r = h.getBoundingClientRect();
      return { ...m, lines: Number.isFinite(m.lh) && m.lh > 0 ? Math.round(r.height / m.lh) : null };
    }),
    /* The loudest text in the primer that is NOT one of the claims and NOT the panel title. The
       title is allowed to be larger — it is the panel head — so it is excluded by name rather than
       by size, and everything else in the panel is fair game: the status lines, the beat numbers,
       the quoted genome, the two buttons. Only elements carrying their own text node count, so a
       wrapper does not report its child's size as its own. */
    loudest: (() => {
      if (!primer) return null;
      let worst = null;
      for (const el of primer.querySelectorAll("*")) {
        if (el.classList.contains("beat-claim") || el.closest(".panel-head")) continue;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
        const px = Math.round(parseFloat(getComputedStyle(el).fontSize));
        if (!worst || px > worst.px) {
          worst = { px, what: (el.className || el.tagName) + " :: " + el.textContent.trim().slice(0, 34) };
        }
      }
      return worst;
    })(),
    /* The panel's surviving body copy, and the heir to the prose the claims used to outrank. */
    status: (() => {
      const p = primer?.querySelector(".primer-status");
      return p ? read(p) : null;
    })(),
    label,
  };
})()`);
const cLive = classify(events);
if (!setup.hasPrimer) {
  fail.push("the undeployed front door renders no .panel-primer — the primer IS the page before Season 0, not a garnish on the form");
}
if (!setup.hasSetup) {
  fail.push("the undeployed front door renders no setup panel — the operator's only route to point this page at a population is gone");
}
if (setup.chars > COPY_CEILING) {
  fail.push(
    `the pre-deploy front door is ${setup.chars} characters of body copy, over its ${COPY_CEILING} ceiling — ` +
      `the primer has grown its prose back, and this page is what a judge reads in the thirty seconds before they leave`,
  );
}
if (setup.chars < COPY_FLOOR) {
  fail.push(
    `the pre-deploy front door is only ${setup.chars} characters (floor ${COPY_FLOOR}) — five claims, a quoted genome and ` +
      `two status lines cannot fit in that, so the page a judge sees today rendered close to nothing`,
  );
}
if (!/DARWIN/i.test(setup.wordmark)) {
  fail.push(`the undeployed front door has no wordmark (header h1 is ${JSON.stringify(setup.wordmark)}) — a form floating in the dark`);
}
/* ── the masthead sentence: shape asserted, substance reported ────────────── */
//
// This used to be `!/lose money/i.test(setup.thesisText)`. §8.5 asked for the INTENT — that the hero
// makes a falsifiable claim, not that it contains one phrase — and a literal phrase is the worst
// possible proxy for that: an honest rewrite of the same claim fails it, while "The future of
// on-chain intelligence." passes anything a phrase test could be widened to.
//
// So be straight about the split. Whether a sentence is FALSIFIABLE is a judgment about meaning, and
// nothing in this harness can make it; a check that pretended to would be the §8.8-item-5 defect —
// a control that passes only while the bug is present. What IS checkable is the shape a claim has
// and a slogan usually does not, asserted against two other strings read off the same page:
//   · it is a sentence — at least four words, ending in terminal punctuation;
//   · it is not the product name wearing a full stop;
//   · it is not a copy of the primer's own lede, which would mean the masthead says nothing new.
// The sentence itself is printed verbatim in the `undeployed` note beside the primer's lede, which
// is where the judgment that cannot be automated actually gets made — by whoever reads the run.
if (setup.thesisWords < 4 || !/[.!?]$/.test(setup.thesisText)) {
  fail.push(
    `the masthead thesis is not a sentence (${setup.thesisWords} words, ${JSON.stringify(setup.thesisText)}) — the one ` +
      `line on the page before Season 0 has to claim something, and a fragment claims nothing`,
  );
}
if (setup.thesisText && setup.wordmark && setup.thesisText.replace(/[.!?]+$/, "").trim().toLowerCase() === setup.wordmark.trim().toLowerCase()) {
  fail.push(`the masthead thesis is just the wordmark with punctuation (${JSON.stringify(setup.thesisText)})`);
}
if (setup.thesisText && setup.primerLede && setup.thesisText.trim().toLowerCase() === setup.primerLede.trim().toLowerCase()) {
  fail.push(`the masthead thesis repeats the primer's lede verbatim (${JSON.stringify(setup.thesisText)}) — one of the two is spending space on nothing`);
}
// No entrance tween runs on this page — `first()` fires on the paint that carries a live snapshot,
// and this page never gets one — so the sentence is statically visible here and a plain read is a
// real measurement rather than a sample taken inside a fade. The animated case, which is where the
// single mistimed read used to live, is 12d.
if (setup.thesisOpacity != null && parseFloat(setup.thesisOpacity) < VISIBLE) {
  fail.push(
    `the masthead thesis is stranded invisible on the front door (opacity ${setup.thesisOpacity}) — nothing ` +
      `animates it on this page, so every rect read in this snapshot is off a hidden element`,
  );
}
// ── and the sentence is not stranded in dead space. The control first, as always: a detector that
// cannot report the defect is not evidence that the defect is absent.
if (setup.thesisStranded) {
  if (setup.thesisStranded.control.stranded !== true) {
    fail.push(
      `the stranded-sentence detector cannot report a stranded sentence (control verdict ` +
        `${JSON.stringify(setup.thesisStranded.control)}) — the live verdict under it is decoration`,
    );
  } else if (setup.thesisStranded.live.stranded) {
    fail.push(
      `the masthead thesis holds ${Math.round(setup.thesisStranded.live.ratio * 100)}% of the header's width with nothing ` +
        `beside it — the sentence is stranded in a measure that reads as a row which lost its other columns`,
    );
  }
}

/* ── the operator's form is FOLDED, and folded means folded ───────────────── */
//
// The point of the cut is that the address field is no longer the front door: it is one line of
// disclosure an operator opens. Three things are asserted about that, and each fails on a different
// edit. The tag, because a `section` puts the whole form back in front of everybody. The absence of
// `open` with no bad query in the URL, because a `<details open>` is a section with extra steps —
// and `badQuery` is the ONE case where render.js is supposed to force it open, which is why this
// navigation deliberately carries no query string at all. And the collapse itself, measured:
// everything below is forbidden from reading geometry off that subtree, and a check that measures a
// display:none element and passes is worse than one that fails, so whether it is really collapsed is
// established here once rather than assumed at each site.
if (setup.setupTag !== "details") {
  fail.push(
    `.panel-setup renders as <${setup.setupTag}>, not <details> — the operator's address field is back on the front ` +
      `door as a section, and the fold every geometry reading below relies on does not exist`,
  );
}
if (setup.setupOpen) {
  fail.push("the setup disclosure is OPEN with no bad address in the URL — only a rejected ?population= is supposed to force it open");
}
// The instrument before the reading. `foldProbe` is a closed <details> injected and then opened in
// the page's own frame: closed must read hidden and open must read visible, or `checkVisibility()`
// is not answering the question and the fold assertion under it is decoration.
if (setup.foldProbe.closed !== false || setup.foldProbe.open !== true) {
  fail.push(
    `checkVisibility() cannot tell a folded <details> from an open one in this browser ` +
      `(injected control read closed=${setup.foldProbe.closed}, open=${setup.foldProbe.open}) — the fold check below ` +
      `is measuring nothing and needs a new instrument, exactly as getBoundingClientRect() did before it`,
  );
} else if (setup.setupTag === "details" && setup.setupOpen === false && setup.formHidden === false) {
  fail.push("the setup form is still visible while its <details> is closed — the fold is cosmetic, and any geometry read off it would be measuring a subtree nobody can see");
}
if (setup.inputs !== 2) {
  fail.push(`the setup form kept ${setup.inputs} of its 2 fields (#pop-input, #rpc-input) — folding the operator's tool away must not remove it`);
}
if (setup.setupTag === "details" && !/advanced|operator/i.test(setup.summary)) {
  fail.push(
    `the setup disclosure's summary is ${JSON.stringify(setup.summary)} — it has to name itself as the advanced/operator ` +
      `path, or the one visible line of the panel reads as the thing the page is asking a visitor to do`,
  );
}
// "Connect" is the one word on this page that would be a lie: the primer's own status line says the
// page reads the chain directly with no wallet, and a control labelled Connect asks a visitor for one.
if (setup.connectLabels.length) {
  fail.push(
    `a clickable control on the pre-deploy front door is labelled ${JSON.stringify(setup.connectLabels.join(" / "))} — ` +
      `on a page whose own status line promises no wallet, "Connect" is the one word that sends a judge looking for MetaMask`,
  );
}

/* ── the two ways out of a page that has no data yet ─────────────────────── */
//
// A visitor who wants in has to be able to leave for the landing, and a reviewer who wants to see the
// console has to be able to reach the fixture without knowing that `?demo=1` exists. Asserted on the
// hrefs rather than the labels, because the copy is allowed to change and the destinations are not.
const toLanding = setup.actions.find((a) => /^(\/|\.\.?\/)(index\.html)?$/.test(a.href));
const toDemo = setup.actions.find((a) => /demo=1/.test(a.href));
if (!toLanding) {
  fail.push(`the primer offers no way to the landing (actions: ${JSON.stringify(setup.actions.map((a) => a.href))}) — the page states a mechanism and then strands the reader who wants to enter`);
}
if (!toDemo) {
  fail.push(`the primer offers no link to ?demo=1 (actions: ${JSON.stringify(setup.actions.map((a) => a.href))}) — the console is then reachable only by a judge who guesses the query string`);
}
// Which of the two is EMPHASISED is a claim about what the page wants, and the classes are the only
// place it is expressed: entering is the primary action and the fixture is the fallback, not the
// reverse. Swapping `btn-primary` onto the demo link fails here.
if (toLanding && toDemo && !(/btn-primary/.test(toLanding.cls) && /btn-ghost/.test(toDemo.cls))) {
  fail.push(
    `the primer's two actions are weighted wrong: the landing link is ${JSON.stringify(toLanding.cls)} and the fixture ` +
      `link is ${JSON.stringify(toDemo.cls)} — the primary action before Season 0 is how to enter, and the sample data is the fallback`,
  );
}
if (!setup.specimens) {
  fail.push("the primer quotes no founder genome — the one thing on this page that shows an organism IS English prose is a quote, and describing it instead is the cheaper claim");
}
if (setup.stranded) fail.push(`a front-door panel is invisible (${setup.stranded} panels under 0.5 opacity)`);
if (setup.bg !== ground.bg) fail.push(`the undeployed view has a different ground (${setup.bg}) than the demo (${ground.bg})`);

/*//////////////////////////////////////////////////////////////
   12b — THE FIVE CLAIMS ARE STILL THE LOUDEST TEXT IN THE PANEL
//////////////////////////////////////////////////////////////*/

/* See the header note. The defect class is a declaration whose only job is to WIN, that loses, and
   the claims are where it landed: `.panel h3` (0,1,1) over `.beat-claim` (0,1,0). The claims are
   still `h3` and still inside `.beat-body`, so that contest is live on every paint and what fixes it
   is still `.beat-body > .beat-claim`. What changed is the comparison target: the prose the claims
   used to have to outrank is gone, so it is the INJECTED label probe above — read off this page,
   this token set, this panel — plus a sweep of
   everything else in the primer. Nothing here pins a hex or a pixel that a token change would move.

   The probe is checked FIRST and on its own terms. If it has stopped rendering as a label, every
   comparison under it is a false green, and that is a louder failure than any of them. */
if (setup.claims.length !== 5) {
  fail.push(`the primer renders ${setup.claims.length} beat claims, not 5 — the five steps ARE the explanation`);
}
if (!setup.label) {
  fail.push("12b could not inject its label probe — .panel-primer is absent, so the claims below are compared against nothing");
} else if (!/Mono/i.test(setup.label.family) || setup.label.transform !== "uppercase" || setup.label.px > 13) {
  fail.push(
    `12b's negative control is dead: an h3 inside .panel-primer renders ${setup.label.px}px ${setup.label.family} ` +
      `text-transform:${setup.label.transform}, which is not the 11px uppercase mono panel-label treatment it is ` +
      `supposed to be. Every claim reading below is being compared against ordinary text and cannot fail.`,
  );
}
for (const [i, c] of setup.claims.entries()) {
  const n = i + 1;
  if (!/Newsreader/i.test(c.family)) {
    fail.push(`beat ${n}'s claim is set in ${c.family}, not the display face — its own rule has lost, most likely to the generic .panel h3 label rule it has to outrank`);
  }
  if (c.transform !== "none") {
    fail.push(`beat ${n}'s claim is text-transform:${c.transform} — the claims are sentences, not labels`);
  }
  if (c.tracking !== "normal") {
    fail.push(`beat ${n}'s claim carries letter-spacing ${c.tracking} (the panel label's is ${setup.label?.tracking}) — label tracking on a sentence is what pushed beats 2 and 3 onto a second line`);
  }
  if (c.weight !== "400") {
    fail.push(`beat ${n}'s claim is font-weight ${c.weight}; fonts.css vendors Newsreader upright at 400 only, so this synthesizes a fake bold`);
  }
  if (setup.label && c.px <= setup.label.px) {
    fail.push(`beat ${n}'s claim is ${c.px}px against the ${setup.label.px}px panel-label treatment — the skim path has collapsed into chrome`);
  }
  if (setup.label && c.color === setup.label.color) {
    fail.push(`beat ${n}'s claim is ${c.color} — the same colour a panel label gets, so it reads as a caption on its own beat`);
  }
  // The heir to "outranks its own prose". Size OR face has to separate the claim from the panel's
  // surviving body copy; matching on both is the inversion, whatever the numbers happen to be.
  if (setup.status && c.px <= setup.status.px && c.family === setup.status.family) {
    fail.push(
      `beat ${n}'s claim renders at ${c.px}px ${c.family}, the same size and face as the primer's own status copy ` +
        `(${setup.status.px}px ${setup.status.family}) — nothing marks it as the claim`,
    );
  }
  if (c.lines === null) {
    fail.push(`beat ${n}'s claim has an unresolved line-height, so the wrap reading is meaningless — 12b cannot tell a one-line claim from a three-line one`);
  } else if (c.lines > 1) {
    fail.push(`beat ${n}'s claim wraps to ${c.lines} lines — at the display face all five fit one line, so this is tracking or a shrunken measure`);
  }
}
// The other half of the old assertion, generalised: the claims must not merely beat a label, they
// must be the loudest text in the panel apart from its own title.
const quietestClaim = setup.claims.length ? Math.min(...setup.claims.map((c) => c.px)) : null;
if (quietestClaim != null && setup.loudest && setup.loudest.px > quietestClaim) {
  fail.push(
    `something other than the five claims is the loudest text in the primer: ${setup.loudest.what} at ` +
      `${setup.loudest.px}px against the quietest claim's ${quietestClaim}px — the skim path is supposed to be the ` +
      `largest thing under the panel title`,
  );
}
const liveMotionWarnings = cLive.warnings.filter((w) => w.includes("motion.js"));
if (liveMotionWarnings.length) fail.push(`motion.js token drift on the undeployed view:\n    ${liveMotionWarnings.join("\n    ")}`);
if (cLive.exceptions.length) fail.push(`exceptions on the undeployed view:\n    ${cLive.exceptions.join("\n    ")}`);
note(
  `undeployed primer=${setup.hasPrimer} setup=<${setup.setupTag}${setup.setupOpen ? " open" : ""}> ${setup.chars} chars ` +
    `(floor ${COPY_FLOOR}, ceiling ${COPY_CEILING}) · wordmark ${JSON.stringify(setup.wordmark)} · thesis ` +
    `${setup.thesisWidthRatio == null ? "n/a" : Math.round(setup.thesisWidthRatio * 100) + "%"} of viewport · exceptions ${cLive.exceptions.length}`,
);
/* The claim itself, whole, beside the lede it must not duplicate — this is the line to READ. No
   assertion here can tell a falsifiable claim from a slogan; a human scanning this can. */
note(`thesis    ${JSON.stringify(setup.thesisText)} (${setup.thesisWords} words)`);
note(`  lede    ${JSON.stringify(setup.primerLede.slice(0, 78))}`);
if (setup.thesisStranded) {
  note(
    `  space   ${Math.round(setup.thesisStranded.live.ratio * 100)}% of the header, ` +
      `${setup.thesisStranded.live.narrow ? "narrow" : "wide"}, beside=${JSON.stringify(setup.thesisStranded.live.beside)} · ` +
      `stranded=${setup.thesisStranded.live.stranded} (control ${setup.thesisStranded.control.stranded})`,
  );
}
note(
  `operator  form ${setup.inputs} fields, hidden=${setup.formHidden} (probe closed=${setup.foldProbe.closed}/open=${setup.foldProbe.open}), submit ${JSON.stringify(setup.submitText)} · ` +
    `summary ${JSON.stringify(setup.summary.slice(0, 40))} · actions ${JSON.stringify(setup.actions.map((a) => a.href))} · ` +
    `${setup.specimens} specimen(s)`,
);
note(
  `primer    ${setup.claims.length} claims in ${setup.claims[0]?.family} at ${setup.claims[0]?.px}px · label probe ` +
    `${setup.label?.px}px ${setup.label?.family} ${setup.label?.transform} · status ${setup.status?.px}px ` +
    `${setup.status?.family} · loudest other ${setup.loudest?.px}px (${setup.loudest?.what}) · lines ${setup.claims.map((c) => c.lines).join("")}`,
);

/*//////////////////////////////////////////////////////////////
      12c — THE FRONT DOOR'S TWO PANELS DO NOT STEP ON A PHONE
//////////////////////////////////////////////////////////////*/

/* The same defect class as 11b and 12b, in the one modality neither could reach: `@media`. A
   breakpoint adds NO specificity, so a block that re-declares a BASE class outranks nothing — it
   merely sits later in the file, and that alone is enough to take a variant's own padding back.
   `.panel` is re-declared at 720px; `.panel-setup` was restated inside that block and `.panel-primer`
   was not, so the primer alone fell back to the generic padding. Both panels are stacked on the page
   a visitor lands on before Season 0, and `app.css`'s comment at `.panel-primer` says in as many
   words that they share one left-hand edge "instead of stepping".

   Two widths on purpose. 1400 is a width where this bug never existed, so it is the control that
   proves the measurement reads a real cascade instead of always agreeing — a check that only ever
   looked at 700px would be indistinguishable from one that always passes. And the generic padding is
   sampled from a throwaway bare `.panel` injected OUT OF FLOW, so the one regression that would
   otherwise slip through — both panels collapsing to the generic value together, still flush — fails
   here too. Content edges, not padding, because stepping is what a reader sees.

   `.panel-setup` is a `details` now, and the FIRST child with a width is what makes that a non-event:
   inside a closed disclosure the form and the note have no boxes at all, so the child measured there
   is the `summary`, whose left edge is exactly the content edge a reader lines up against the
   primer's heading. It is reported by class name in the note below rather than assumed, because if a
   future markup change ever makes the measured child a zero-width wrapper, "the two panels agree" and
   "nothing was measured" have to look different in the output. */
for (const w of [1400, 700]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(260); // reflow only; no padding on this page is transitioned
  const edge = await evaluate(`(() => {
    const read = (sel) => {
      const p = document.querySelector(sel);
      if (!p) return null;
      // The first child WITH A WIDTH is the thing whose left edge a reader actually lines up, and the
      // qualifier is load-bearing on a closed details: its non-summary children are laid out at zero
      // size, so taking children[0] blind would measure the summary here and a boxless form there.
      const kid = [...p.children].find((k) => k.getBoundingClientRect().width > 0);
      return {
        pad: Math.round(parseFloat(getComputedStyle(p).paddingLeft)),
        box: Math.round(p.getBoundingClientRect().left * 10) / 10,
        content: kid ? Math.round(kid.getBoundingClientRect().left * 10) / 10 : null,
        kid: kid ? (kid.className || kid.tagName).toString().trim() : null,
      };
    };
    // a bare .panel, out of flow so it cannot move the two panels it is the control for
    const probe = document.createElement("section");
    probe.className = "panel";
    probe.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(probe);
    const generic = Math.round(parseFloat(getComputedStyle(probe).paddingLeft));
    probe.remove();
    return { primer: read(".panel-primer"), setup: read(".panel-setup"), generic };
  })()`);
  const { primer, setup: setupPanel, generic } = edge;
  if (!primer || !setupPanel) {
    fail.push(
      `at ${w}px the front door is missing ${!primer ? ".panel-primer" : ".panel-setup"} — the primer and the form are the whole page before Season 0`,
    );
    continue;
  }
  const step =
    primer.content != null && setupPanel.content != null
      ? Math.round(Math.abs(primer.content - setupPanel.content) * 10) / 10
      : null;
  if (step === null) {
    fail.push(
      `at ${w}px ${primer.content == null ? ".panel-primer" : ".panel-setup"} has no laid-out child whose edge could be ` +
        `measured (primer kid ${JSON.stringify(primer.kid)}, setup kid ${JSON.stringify(setupPanel.kid)}) — on the setup ` +
        `panel that means even its <summary> has no box, so 12c measured nothing rather than agreeing`,
    );
  } else if (step > 0.5) {
    fail.push(
      `at ${w}px the primer's content starts at x=${primer.content} and the setup panel's at x=${setupPanel.content}, ` +
        `a ${step}px step between two panels whose boxes ARE flush (${primer.box} / ${setupPanel.box}) — a breakpoint ` +
        `re-declaring \`.panel\` padding has taken one of them back (primer ${primer.pad}px, setup ${setupPanel.pad}px, ` +
        `bare panel ${generic}px)`,
    );
  }
  for (const [name, p] of [
    ["primer", primer],
    ["setup", setupPanel],
  ]) {
    if (p.pad === generic) {
      fail.push(
        `at ${w}px .panel-${name} renders the GENERIC panel padding (${generic}px) — its own rule lost to a later \`.panel\` declaration`,
      );
    }
  }
  note(
    `frontdoor ${w}px primer pad ${primer.pad} content@${primer.content} (${primer.kid}) · setup pad ${setupPanel.pad} ` +
      `content@${setupPanel.content} (${setupPanel.kid}) · bare panel ${generic} · step ${step}px`,
  );
}
await send("Emulation.clearDeviceMetricsOverride", {});

/*//////////////////////////////////////////////////////////////
    12d — THE LIVE FRONT DOOR: NO PRIMER FLASH, AND THE SENTENCE ARRIVES
//////////////////////////////////////////////////////////////*/

/*  TWO DEFECTS OFF ONE POLL, BOTH REPORTED FROM THE PUBLISHED SITE, BOTH ON A BARE `/arena/`.
 *
 *  ONE — THE FLICKER. A visitor with a perfectly good address was shown the primer and the address
 *  form for the length of two round trips and then had them replaced by the arena; worse than the
 *  flash, `primer()` asserts "Season 0 is not deployed yet", so the published site opened by denying
 *  its own deploy. The fix was to split `configured but unread` from `unconfigured`
 *  (`main.js:230`, the `app.connecting` branch), and NOTHING guarded it — the two states share a
 *  branch again after any careless edit, and the symptom lasts two round trips, which is precisely
 *  the width no single-sample check can see. So the primer is looked for on EVERY sample from
 *  navigation until the dashboard has landed, and one sighting is a failure.
 *
 *  TWO — THE ENTRANCE. `.hero-thesis` fades in from `opacity: 0` over 0.7s (`motion.js:362`, inside
 *  `first()`), and `first()` runs on the paint that carries the first live snapshot, not on
 *  navigation. Polled every 130ms from a cold navigate that reads: sentence present and fully opaque
 *  at 145ms (the pre-read header), the live snapshot mounting at 2237ms, opacity reset to 0 by the
 *  tween's from-state, then 0.6562 / 0.889 / 0.9779 / 0.9991, and 1 from 2942ms onward for the
 *  remaining eight seconds. §12 used to take ONE read at 2600ms and call `opacity 0.4674` stranded —
 *  a confident number that was not a measurement of anything, the same defect class as the rect
 *  taken off the folded details, and worse than either because where the read landed depended on how
 *  fast Shannon answered. It is waited out here instead. The deadline is what preserves the ability
 *  to fail: a clock that stalls with the from-state applied leaves the sentence at 0, `guarantee()`'s
 *  own rescue fires 1900ms after the timeline starts (0.7s + 1200ms slack), and both are well inside
 *  this budget — so a sentence still invisible at the deadline is genuinely stranded and says so.
 *
 *  THREE CONTROLS, because all three verdicts here are absences, and an absence is what a broken
 *  detector reports too:
 *    · the dashboard must actually arrive (cards > 0). Without it, "the primer never appeared" is
 *      passed maximally by a page that rendered nothing at all — the loudest way to fail this check
 *      would otherwise be to pass it.
 *    · the same expression, re-run against §12's unreachable URL, must FIND a primer. That is the
 *      selector under test, on a page that has one, through the same poller.
 *    · an element pinned at `opacity: 0.2`, injected on every sample and read by the same predicate,
 *      must come back invisible — or "the sentence became visible" is not evidence about anything.
 *      It hangs off `#header` so it has a subject even in a run where the sentence is missing, and it
 *      is re-injected each sample because `mount()` is `replaceChildren` and the paint under test
 *      destroys it.
 */
const LIVE_DEADLINE = 12_000;
/* HOW LONG THE SENTENCE IS WATCHED FOR AFTER THE DASHBOARD LANDS, AND WHY IT IS NOT SHORTER.
   Breaking out on the first sample that reads visible would be its own flake in the opposite
   direction: the pre-read header's sentence is ALREADY at opacity 1, `first()` applies the tween's
   from-state inside a `requestAnimationFrame` callback, and a CDP read can land in the gap between
   the mount and that callback — so "visible" on the mount sample says nothing about whether the
   entrance then stranded it. The verdict is therefore the LAST read of a window that outlasts every
   mechanism that could still raise it: 0.7s of tween, plus `guarantee()`'s 1200ms slack, plus
   margin. A sentence still dark at 2400ms past the mount was raised by neither. */
const WATCH_PAST_MOUNT = 2400;
const SAMPLE = `(() => {
  let probe = document.getElementById("probe-invisible");
  if (!probe) {
    const host = document.querySelector("#header") || document.body;
    probe = document.createElement("p");
    probe.id = "probe-invisible";
    probe.textContent = "PROBE";
    probe.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0.2";
    host.appendChild(probe);
  }
  const t = document.querySelector(".hero-thesis");
  const op = (el) => (el ? Number(getComputedStyle(el).opacity) : null);
  return {
    primer: !!document.querySelector(".panel-primer"),
    cards: document.querySelectorAll(".card").length,
    thesis: op(t),
    control: op(probe),
  };
})()`;

/**
 *  Poll one page to its deadline. Stops once the dashboard has landed and been watched long enough
 *  for the entrance to have run its course — or, for the control run, as soon as a primer is up.
 */
async function watchLive(url, { stopOnPrimer = false } = {}) {
  forget();
  t0 = Date.now();
  await send("Page.navigate", { url });
  const seen = { primerAt: null, cardsAt: null, thesisAt: null, samples: 0, controls: [], last: null };
  while (elapsed() < LIVE_DEADLINE) {
    const s = await evaluate(SAMPLE);
    seen.samples++;
    seen.last = s;
    seen.controls.push(s.control);
    if (s.primer && seen.primerAt == null) seen.primerAt = elapsed();
    if (s.cards > 0 && seen.cardsAt == null) seen.cardsAt = elapsed();
    if (s.thesis != null && s.thesis >= VISIBLE && seen.cardsAt != null && seen.thesisAt == null) {
      seen.thesisAt = elapsed();
    }
    if (stopOnPrimer && seen.primerAt != null) break;
    if (seen.cardsAt != null && elapsed() >= seen.cardsAt + WATCH_PAST_MOUNT) break;
    await sleep(130);
  }
  await evaluate(`document.getElementById("probe-invisible")?.remove(); true`);
  return seen;
}

const live = await watchLive(bareUrl);
// §12's unreachable URL: this one MUST show a primer, or the absence asserted above is a broken
// selector rather than a fixed flicker.
const cFlicker = await watchLive(liveUrl, { stopOnPrimer: true });

if (cFlicker.primerAt == null) {
  fail.push(
    `12d's primer detector never found a primer on the page that HAS one (${cFlicker.samples} samples of ` +
      `${liveUrl}) — so "the live page never flashed the primer" is a statement about a broken selector, ` +
      `not about the live page`,
  );
}
if (live.cardsAt == null) {
  fail.push(
    `the live arena never rendered an organism in ${LIVE_DEADLINE}ms (last sample ${JSON.stringify(live.last)}) — ` +
      `every absence asserted here is then free, and the page a judge lands on showed them nothing`,
  );
} else if (live.primerAt != null) {
  fail.push(
    `the live arena flashed the primer at ${live.primerAt}ms before the dashboard landed at ${live.cardsAt}ms — ` +
      `a visitor with a working address is being told "Season 0 is not deployed yet" and handed an address form, ` +
      `then having both replaced: main.js's connecting branch has collapsed back into the unconfigured one`,
  );
}
if (!live.controls.some((v) => v != null)) {
  fail.push(`12d's opacity poller never read its own control (${live.controls.length} samples, all null) — the sentence verdict under it is decoration`);
} else if (live.controls.some((v) => v != null && v >= VISIBLE)) {
  fail.push(
    `12d's opacity poller calls an element pinned at 0.2 visible (${JSON.stringify(live.controls.slice(0, 4))}) — ` +
      `its threshold cannot report an invisible sentence`,
  );
}
if (live.cardsAt != null && !(live.last?.thesis != null && live.last.thesis >= VISIBLE)) {
  fail.push(
    `the masthead thesis is still invisible ${live.last == null ? "" : "at opacity " + live.last.thesis + " "}` +
      `${WATCH_PAST_MOUNT}ms after the dashboard landed at ${live.cardsAt}ms (${live.samples} samples) — the entrance ` +
      `tween stranded the one claim on the page and guarantee()'s deadline did not rescue it`,
  );
}
note(
  `live      dashboard at ${live.cardsAt ?? "never"}ms · thesis visible at ${live.thesisAt ?? "never"}ms · ` +
    `primer seen ${live.primerAt == null ? "never (correct)" : "at " + live.primerAt + "ms"} · ${live.samples} samples`,
);
note(
  `  control primer found at ${cFlicker.primerAt ?? "never"}ms on the unreachable URL · opacity probe ${JSON.stringify(live.controls[0])}`,
);

/*//////////////////////////////////////////////////////////////
                             REPORT
//////////////////////////////////////////////////////////////*/

close();

console.log("\n" + "-".repeat(72));
if (fail.length) {
  console.log(`FAIL — ${fail.length} problem(s)`);
  for (const f of fail) console.log("  * " + f);
  process.exit(1);
}
console.log("PASS — console is themed, the season plays, death settles into ash above the fold and a birth blooms mint");
process.exit(0);
