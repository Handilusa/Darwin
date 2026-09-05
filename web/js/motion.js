/**
 *  GSAP, driven by a diff of chain state.
 *
 *  WHY THIS FILE IS SHAPED LIKE THIS
 *
 *  `main.js` repaints by full teardown: `mount()` is `replaceChildren`, so every node on the page is
 *  destroyed and rebuilt on each ten-second poll and on every selection. The obvious way to animate
 *  that — an entrance tween on each card — would therefore replay the entire page every ten seconds
 *  whether or not anything changed, which is exactly the "animation interfering with usability"
 *  failure a dashboard cannot afford. Worse, it would make a poll in which nothing happened look
 *  identical to a poll in which an organism died.
 *
 *  So motion here is not a property of rendering. It is a property of the DIFF:
 *
 *      main.js     compares the previous snapshot to the next one and hands over an fx map —
 *                  it already owns all mutable state, so the comparison belongs to it
 *      render.js   stays pure and only stamps `data-fx="died"` on the node it built
 *      motion.js   after mount, finds `[data-fx]` and plays the timeline for each kind
 *
 *  Nothing stamped means nothing animates. An organism dies once and is mourned once.
 *
 *  FIVE MOMENTS, ALL EARNED
 *
 *  Every timeline below corresponds to a real state transition on chain. There is nothing here that
 *  fires for any other reason, and nothing that fires on a timer:
 *
 *      born        `Spawned` — an id in the snapshot that was not there before
 *      died        `Died` / `Reaped` — `dead` flipped true
 *      treasury    a settlement moved the balance
 *      phase       `Population.phase` advanced
 *      new         a log line that was not in the previous feed
 *
 *  DEGRADING
 *
 *  If `window.gsap` is missing — the vendored file failed to load, or the page is open somewhere
 *  stricter — every function here becomes a no-op and the page renders complete and static. Same
 *  for `prefers-reduced-motion`. That mirrors the rule the rest of this codebase keeps: a failed
 *  read is a state, not a crash. The page is never worse than un-animated.
 *
 *  That last sentence is a promise about an entrance that HIDES things before revealing them, so it
 *  needs more than a library check. Two defences keep it, in this order: `onClockAlive()` refuses to
 *  hide anything until a frame callback has proved the clock is running, and `guarantee()` puts a
 *  deadline on the timeline in case the clock starts and then stops.
 *
 *  VERIFYING IT — NOT WITH `--virtual-time-budget`
 *
 *  Chrome races its virtual clock ahead while GSAP's ticker advances on `performance.now()` deltas,
 *  so a headless capture labelled 2200ms catches a timeline that has advanced fifty REAL
 *  milliseconds. That looks precisely like the bug this file exists to prevent — twelve cards in the
 *  DOM, laid out, all at `opacity: 0` — and it is not it. Two hours went into chasing that phantom;
 *  a `--dump-dom` at the same budget is what ended it, by showing every tween sitting exactly on its
 *  from-state while `.hero-thesis` read `0.1757`.
 *
 *  Sample on the wall clock instead: drive the page over CDP and read computed opacity at real
 *  intervals. Measured that way, the population is fully visible **1.0s** after navigation and the
 *  last lineage edge lands at **1.6s**.
 *
 *  GSAP IS VENDORED, NOT FETCHED. `web/vendor/gsap.min.js` is a file in the repo, loaded by a plain
 *  script tag. `?demo=1` is documented three times as working with the network unplugged, and a CDN
 *  import would have broken exactly that, in a venue, at the worst possible moment.
 */

const REDUCED = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 *  The library, or null.
 *
 *  Read on each call rather than captured at module scope: the vendor script is a sibling of the
 *  module tag, and resolving `window.gsap` while this module's body evaluates would race the loader
 *  on a cold cache.
 */
function G() {
  const g = globalThis.gsap;
  if (!g || typeof g.timeline !== "function") return null;
  if (REDUCED()) return null;
  return g;
}

/** True when motion will actually happen, so callers can skip building fx data at all. */
export function enabled() {
  return G() != null;
}

const all = (root, sel) => (root?.querySelectorAll ? [...root.querySelectorAll(sel)] : []);

/**
 *  Read a palette token at runtime.
 *
 *  GSAP interpolates colours numerically and cannot parse `var(--bad)`, so a tween needs a literal.
 *  Pasting hexes in here would fork the palette: `app.css` would say one thing and the death flash
 *  another, and nobody would notice until the two drifted. Reading the custom property off `:root`
 *  keeps `tokens.css` the single source of truth for every colour on the page, including the ones
 *  that only exist for 900ms.
 *
 *  ── THE FALLBACK IS NOT A SAFETY NET, IT IS A HIDING PLACE ──────────────────
 *  That is not hypothetical. This file spent the re-theme reading `--vital`, `--lethal`, `--helix`
 *  and `--helix-wash` — four names from the palette that came before `tokens.css`. Every one of them
 *  resolved to its fallback, so a death flashed a pink the stylesheet had never heard of and a birth
 *  bloomed indigo on a mint-and-amber page, while the page around them looked perfectly themed. The
 *  `warn` below is the whole reason that cannot happen twice: a name that is not in `tokens.css` now
 *  says so, once, instead of quietly returning something plausible. If you see it, the fix is the
 *  token name at the call site — never a nicer hex here.
 */
const missing = new Set();

function token(name, fallback) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (v) return v;
    if (!missing.has(name)) {
      missing.add(name);
      console.warn(`motion.js: ${name} is not defined in tokens.css — falling back to ${fallback}`);
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/*//////////////////////////////////////////////////////////////
                          NUMBER TWEENS
//////////////////////////////////////////////////////////////*/

/**
 *  Group an integer part with commas, matching `format.moneyFixed`.
 *
 *  This exists only for the ~800ms a treasury spends counting. `money()` is BigInt all the way down
 *  and truncates rather than rounds, specifically so this page and `monitor.ts` cannot disagree
 *  about a balance — and a float tween cannot honour that. So the tween drives a DISPLAY-ONLY float
 *  and the final frame writes back the exact string the renderer already computed, carried on the
 *  node as `data-fx-to`. The animated frames are decoration; the resting value is the truth, and
 *  the float never flows back into anything that does arithmetic.
 *
 *  The fraction is padded and NOT trimmed, which is the one place this deliberately differs from
 *  `format.units`. Trimming made the string change LENGTH between frames — 58.4, then 58.42, then
 *  58.5 — so a counting treasury shimmered wider and narrower forty times a second and dragged the
 *  belief tag beside it along. Pair this with `moneyFixed` at the render site: if one pads and the
 *  other trims, the number snaps to a different width on the last frame instead of settling.
 */
function grouped(n, places = 2) {
  const neg = n < 0;
  const abs = Math.abs(n);
  const whole = Math.trunc(abs);
  const frac = Math.trunc((abs - whole) * 10 ** places);
  const w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const f = places > 0 ? String(frac).padStart(places, "0") : "";
  return `${neg ? "-" : ""}${w}${f ? `.${f}` : ""}`;
}

/** A grouped money string back to a float. Null on anything unexpected. */
function parseMoney(s) {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 *  Count a `.amount` from the value it last showed to the value it shows now.
 *
 *  If either endpoint is missing or unparseable the node is left exactly as rendered. A number that
 *  refuses to animate is strictly better than a number that animates to the wrong value.
 */
function countUp(g, node, tl, at = 0) {
  const from = parseMoney(node.dataset.fxFrom);
  const to = parseMoney(node.dataset.fxTo ?? node.textContent);
  if (from == null || to == null || from === to) return;

  const box = { v: from };
  const exact = node.dataset.fxTo ?? node.textContent;
  const rest = getComputedStyle(node).color;

  tl.to(
    box,
    {
      v: to,
      duration: 0.8,
      ease: "power2.out",
      onUpdate: () => {
        node.textContent = grouped(box.v);
      },
      onComplete: () => {
        node.textContent = exact; // Back to the BigInt-derived string. Never rest on a float.
      },
    },
    at,
  );

  // Profit and loss are one event to the animation system and opposite events to the organism, so
  // the tint follows the sign rather than the fact of change.
  tl.fromTo(
    node,
    { color: to > from ? token("--life", "#5fe3c0") : token("--bad", "#f2645f") },
    { color: rest, duration: 1.1, ease: "power1.out", clearProps: "color" },
    at,
  );
}

/*//////////////////////////////////////////////////////////////
                           TIMELINES
//////////////////////////////////////////////////////////////*/

/**
 *  Death. The strongest moment on the page, because it is the strongest claim the project makes: an
 *  organism that lost money is gone, and no operator chose it.
 *
 *  Three beats — a bloom in the alarm hue, the vitals bar draining, then the card settling into the
 *  desaturated dead state it will keep for the rest of the season. The drain is the beat that reads
 *  as a death rather than as an error, because it is the same bar that has been counting down all
 *  along.
 *
 *  The bloom is `--bad` and NOT `--ash`: the moment of dying is an alarm, the state afterwards is
 *  drained, and `.card-dead` is what supplies the ash. Two different claims, two different hues.
 *
 *  `data-was` is the width the bar held on the previous paint, stamped by `render.js`. Without it
 *  there is no honest starting point, so the drain is simply skipped.
 */
function died(g, cardNode) {
  const lethal = token("--bad", "#f2645f");
  const tl = g.timeline();
  const fill = cardNode.querySelector(".vitals-fill");
  const was = fill?.dataset?.was;

  tl.fromTo(cardNode, { x: -4 }, { x: 0, duration: 0.5, ease: "elastic.out(1, 0.35)" }, 0)
    .fromTo(
      cardNode,
      { boxShadow: `0 0 0 1px ${lethal}, 0 0 34px -4px ${lethal}` },
      { boxShadow: "0 0 0 0 rgba(0,0,0,0)", duration: 1.5, ease: "power2.out", clearProps: "boxShadow" },
      0,
    )
    // Ends on the value `.card-dead` sets in CSS, so the inline style the tween leaves behind agrees
    // with the class rather than fighting it.
    .fromTo(
      cardNode,
      { filter: "saturate(1.5) brightness(1.2)" },
      { filter: "saturate(0.15)", duration: 1.6, ease: "power2.inOut", clearProps: "filter" },
      0,
    );

  if (fill && was) tl.fromTo(fill, { width: was }, { width: "0%", duration: 0.9, ease: "power3.in" }, 0.12);
  return tl;
}

/**
 *  Birth. A child is the population passing a thesis on, and the only thing true of it yet is that
 *  it is alive — so it blooms in `--life` and in nothing else. There is deliberately no separate
 *  brand hue in this palette for the arena to wear: the three colours mean alive, costly and dead,
 *  and a newborn is the first of those.
 */
function born(g, cardNode) {
  const helix = token("--life", "#5fe3c0");
  const tl = g.timeline();
  tl.fromTo(
    cardNode,
    { scale: 0.9, opacity: 0, y: 10 },
    { scale: 1, opacity: 1, y: 0, duration: 0.55, ease: "back.out(1.6)", clearProps: "scale,opacity,y" },
    0,
  ).fromTo(
    cardNode,
    { boxShadow: `0 0 0 1px ${helix}, 0 0 40px -6px ${helix}` },
    { boxShadow: "0 0 0 0 rgba(0,0,0,0)", duration: 1.4, ease: "power2.out", clearProps: "boxShadow" },
    0.1,
  );
  return tl;
}

/** A new edge in the lineage tree draws itself, parent to child, in the direction of descent. */
function drawEdge(g, path) {
  if (typeof path.getTotalLength !== "function") return null;
  let len = 0;
  try {
    len = path.getTotalLength();
  } catch {
    return null; // Detached, or zero-length geometry. Nothing to draw.
  }
  if (!len) return null;
  return g.fromTo(
    path,
    { strokeDasharray: len, strokeDashoffset: len },
    { strokeDashoffset: 0, duration: 0.8, ease: "power2.inOut", clearProps: "strokeDasharray,strokeDashoffset" },
  );
}

/*//////////////////////////////////////////////////////////////
                      KEEPING THE PROMISE
//////////////////////////////////////////////////////////////*/

/**
 *  Hide nothing until the frame clock has proved it can un-hide it.
 *
 *  This is the first of two defences, and it is the one that makes the promise structural instead of
 *  a race. Every entrance below starts from `opacity: 0`, and `fromTo`'s `immediateRender` applies
 *  that from-state SYNCHRONOUSLY at creation — correct while the timeline is running, catastrophic if
 *  it never runs. GSAP's clock is `requestAnimationFrame`, so a page that executes script without
 *  ever being composited would end up with its population present in the DOM, laid out, sized, and
 *  completely invisible.
 *
 *  So the timelines are not built on the paint. They are built inside the first frame callback, which
 *  is the cheapest available proof that a second one will arrive to finish what the first one starts.
 *  If that callback never comes, nothing was ever hidden and the page is exactly what a
 *  reduced-motion visitor sees: complete, static, readable. Un-animated is a fine outcome and this
 *  file promises it in its header. Blank is not, and blank is what a deadline alone can leave on
 *  screen while it waits to fire.
 *
 *  Costs one frame, about 16ms, in the case where everything is working.
 */
function onClockAlive(fn) {
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => fn());
}

/**
 *  And a deadline, for a clock that starts and then stops.
 *
 *  The gate above cannot cover that case: one frame arrived, the from-states were applied, and the
 *  next frame never came — a tab moved to the background mid-entrance, a ticker that loses its
 *  callback. `setTimeout` is driven by the event loop rather than by frames, which is precisely the
 *  failure mode rAF has and it does not: if the timeline has not finished on its own inside the
 *  budget, it is jumped to its end, which runs every `clearProps` and leaves the same DOM a
 *  reduced-motion visitor would have seen. The budget is read off the timeline instead of being a
 *  constant, because the card stagger grows with the population — a hundred organisms take three
 *  seconds to arrive and must not be cut off at two.
 *
 *  Neither of these fires on a healthy page, and neither is what fixed the blank grid in the
 *  screenshots — there was no blank grid to fix. See the header on why that capture lied.
 */
function guarantee(tl, slack = 1200) {
  if (!tl.getChildren().length) {
    tl.kill();
    return tl;
  }
  const t = setTimeout(() => {
    if (tl.progress() < 1) tl.progress(1);
    tl.kill();
  }, tl.duration() * 1000 + slack);
  tl.eventCallback("onComplete", () => clearTimeout(t));
  return tl;
}

/*//////////////////////////////////////////////////////////////
                          ENTRY POINTS
//////////////////////////////////////////////////////////////*/

/**
 *  The whole page, once, on the first paint of a session.
 *
 *  This is the only place a broad stagger is allowed. On the first paint every organism genuinely IS
 *  new to the viewer, so animating all of them is honest; on the second paint the same stagger would
 *  be a lie about what changed. `main.js` calls this exactly once.
 */
export function first(root) {
  onClockAlive(() => {
    const g = G();
    if (!g) return;

    const tl = g.timeline();
    const thesis = root.querySelector(".hero-thesis");
    const metrics = all(root, ".metric-value");
    const dots = all(root, ".phase-node");
    const cards = all(root, ".card");
    const fills = all(root, ".vitals-fill");

    if (thesis) tl.fromTo(thesis, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, 0);
    if (metrics.length)
      tl.fromTo(metrics, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.08, ease: "power2.out" }, 0.15);
    if (dots.length) tl.fromTo(dots, { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.07, ease: "none" }, 0.3);

    // The population arrives as a population — one wave, 22ms apart, so a hundred organisms still
    // finish inside a second. The grid filling in is the page saying "these are many, and they are
    // alive" without spending a word of copy on it.
    if (cards.length)
      tl.fromTo(
        cards,
        { opacity: 0, y: 12, scale: 0.985 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.45,
          ease: "power2.out",
          stagger: { each: 0.022, from: "start" },
          clearProps: "opacity,y,scale",
        },
        0.34,
      );

    // Vitals fill from empty, so the first thing the grid does is show how much life each one has
    // left. Widths are read back off the inline style the renderer set, never invented here.
    for (const f of fills) {
      const w = f.style.width || "0%";
      tl.fromTo(f, { width: "0%" }, { width: w, duration: 0.7, ease: "power2.out" }, 0.5);
    }

    // The tree edges join the same timeline rather than running as loose tweens with their own
    // delays. They start from `strokeDashoffset: len`, which is another way of saying invisible, so
    // they need the deadline below as much as the cards do — and one timeline is the only thing that
    // can carry it.
    const edges = all(root, ".tree-edge");
    for (const [i, e] of edges.entries()) {
      const t = drawEdge(g, e);
      if (t) tl.add(t, 0.6 + i * 0.03);
    }

    guarantee(tl);
  });
}

/**
 *  Every paint after the first. Animates only what carries a `data-fx` stamp — which is only what
 *  the diff in `main.js` said actually changed.
 *
 *  Everything goes into ONE timeline, at position 0, so it can carry a single deadline. Three of the
 *  treatments here start from an invisible state — `born` from `opacity: 0`, `new` from `opacity: 0`,
 *  `edge` from a full dash offset — and a stalled clock would strand a newborn organism or a fresh
 *  log line as an empty row. Playing them in parallel is also the truth about the frame: these
 *  things did not happen in sequence, they were all found in the same snapshot.
 *
 *  The `[data-fx]` query runs INSIDE the frame callback, not before it. A repaint in the same frame
 *  would have destroyed the nodes an earlier query returned — `mount()` is `replaceChildren` — so
 *  reading the document once the clock is alive is the only version that animates what is actually
 *  on screen.
 */
export function apply(root) {
  onClockAlive(() => {
    const g = G();
    if (!g) return;

    const tl = g.timeline();

    for (const node of all(root, "[data-fx]")) {
      switch (node.dataset.fx) {
        case "died":
          tl.add(died(g, node), 0);
          break;

        case "born":
          tl.add(born(g, node), 0);
          break;

        case "treasury":
          countUp(g, node, tl, 0);
          break;

        // A death, announced where the eye already is. `died()` above now plays on a tombstone in the
        // corpse band rather than on a card at y=1060, and this is the same event's voice at the hero.
        //
        // IT DOES NOT TOUCH OPACITY, on purpose and against the grain of every other entrance in
        // this file. The toll is in-viewport evidence that something died, so it is the last place on
        // the page that may risk starting invisible — `guarantee()` would cover it, but a cue that
        // cannot fail is better than one that is rescued. It flashes and settles back to the colour
        // the stylesheet already gives it, via `clearProps`.
        case "toll":
          tl.fromTo(node, { x: -5 }, { x: 0, duration: 0.5, ease: "elastic.out(1, 0.4)", clearProps: "x" }, 0);
          tl.fromTo(
            node,
            { color: token("--bad", "#f2645f") },
            { color: token("--ash", "#7a7686"), duration: 1.4, ease: "power2.out", clearProps: "color" },
            0,
          );
          break;

        case "phase":
          tl.fromTo(node, { scale: 0.6 }, { scale: 1, duration: 0.5, ease: "back.out(2.6)", clearProps: "scale" }, 0);
          break;

        case "new":
          tl.fromTo(node, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.4, ease: "power2.out", clearProps: "opacity,x" }, 0);
          // A new event washes in with the deepest life tint and fades to nothing. Deep rather than
          // saturated because a dozen rows arriving at once must not turn the feed into a light show
          // — the wash says "this is new", the row's own severity rail says what it is.
          tl.fromTo(
            node,
            { backgroundColor: token("--life-deep", "#113029") },
            { backgroundColor: "rgba(0,0,0,0)", duration: 1.6, ease: "power1.out", clearProps: "backgroundColor" },
            0.2,
          );
          break;

        case "edge": {
          const t = drawEdge(g, node);
          if (t) tl.add(t, 0);
          break;
        }

        case "vitals": {
          // The bar was rendered at its new width; animating from the old one is what makes the
          // change legible as a movement instead of as a different screenshot.
          const from = node.dataset.fxFrom;
          if (from) tl.fromTo(node, { width: from }, { width: node.style.width || "0%", duration: 0.7, ease: "power2.out" }, 0);
          break;
        }

        default:
          break;
      }
    }

    guarantee(tl);
  });
}
