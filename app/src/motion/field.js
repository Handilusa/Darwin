/**
 *  The specimen field.
 *
 *  A dozen organisms under dark-field illumination, and the four animations that carry
 *  the argument the page is making. Framework-free on purpose: React mounts it once and
 *  never re-renders it, because a heartbeat that restarts on every state change is not a
 *  heartbeat.
 *
 *  ── THE SPLIT ───────────────────────────────────────────────────────────────
 *  GSAP owns the state; the canvas only paints it. Each organism carries tweened numbers
 *  — `beat`, `glow`, `life`, `nucleus`, `drift` — and one rAF renders whatever they
 *  currently hold. This is the same separation `web/` already uses (main.js decides,
 *  motion.js tweens, render.js paints), which is why the two surfaces move alike.
 *
 *  ── WHY THE THREADS ARE SVG AND THE CELLS ARE CANVAS ────────────────────────
 *  `stroke-dashoffset` is the only way to draw a line rather than reveal one, and it does
 *  not exist on canvas. Twelve glowing radial gradients as SVG filters, on the other
 *  hand, would cost a repaint of the whole subtree every frame. So each half is done in
 *  the technology that can actually do it, in two stacked layers that share one geometry.
 *
 *  ── THE ONE IRREVERSIBLE THING ──────────────────────────────────────────────
 *  `die()` is the only function that touches `life`, and it only ever moves it to 0.
 *  There is no revive, no repeat, no yoyo, and `ScrollTrigger` fires it with `once: true`
 *  so scrolling back up cannot replay it. That is not a stylistic choice: the contract
 *  has no path that clears `dead` (`test_death_isIrreversible`), and an animation that
 *  contradicted it on screen would be the page lying about its own product.
 */

import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const SVGNS = "http://www.w3.org/2000/svg";

/* Mirrors of --life / --heat / --ash. Canvas needs numbers, not custom properties. */
const LIFE = [95, 227, 192];
const HEAT = [240, 160, 85];
const ASH = [122, 118, 134];

/**
 *  Twelve specimens. Positions are fractions of the field, so the composition survives
 *  any viewport; radii are in the field's own scale. Two are already ash at load —
 *  a population that has never lost anyone would misrepresent the mechanism.
 */
const SPEC = [
  { x: 0.6, y: 0.3, r: 30, k: "life", bpm: 52, dead: false },
  { x: 0.73, y: 0.46, r: 22, k: "life", bpm: 61, dead: false },
  { x: 0.86, y: 0.27, r: 17, k: "life", bpm: 74, dead: false },
  { x: 0.68, y: 0.68, r: 25, k: "heat", bpm: 58, dead: false },
  { x: 0.82, y: 0.62, r: 15, k: "life", bpm: 80, dead: false },
  { x: 0.92, y: 0.45, r: 12, k: "life", bpm: 68, dead: true },
  { x: 0.55, y: 0.52, r: 14, k: "life", bpm: 71, dead: false }, // dies on scroll
  { x: 0.9, y: 0.75, r: 19, k: "life", bpm: 55, dead: false },
  { x: 0.47, y: 0.2, r: 11, k: "life", bpm: 88, dead: false },
  { x: 0.78, y: 0.16, r: 13, k: "heat", bpm: 64, dead: false },
  { x: 0.63, y: 0.86, r: 16, k: "life", bpm: 57, dead: false },
  { x: 0.4, y: 0.72, r: 10, k: "life", bpm: 76, dead: true },
];

/** Parent → child. Order matters: threads draw outward from ancestors. */
const EDGES = [
  [0, 1],
  [0, 6],
  [0, 9],
  [1, 2],
  [1, 7],
  [3, 4],
  [3, 10],
  [2, 5],
  [6, 11],
];

/** Which specimen the death beat kills. Index into SPEC. */
export const DOOMED = 6;

/**
 *  A five-organism close-up for the death beat.
 *
 *  The wide hero field is `overflow: hidden` inside the hero, so by the time a reader
 *  reaches the death beat it has scrolled away — and an extinguish nobody is looking at is
 *  not an animation, it is a tween. So the beat gets its own stage at a scale where 1.5
 *  seconds of a light going out actually reads.
 *
 *  The hero's organism dies at the same moment (see `App.jsx`). Scroll back up and it is
 *  still ash: the consequence outlives the scroll position, which is the entire point.
 */
export const CLOSEUP = [
  { x: 0.24, y: 0.5, r: 34, k: "life", bpm: 56, dead: false },
  { x: 0.55, y: 0.28, r: 26, k: "life", bpm: 67, dead: false },
  { x: 0.53, y: 0.74, r: 24, k: "life", bpm: 61, dead: false }, // this one goes out
  { x: 0.82, y: 0.6, r: 18, k: "life", bpm: 79, dead: false },
  { x: 0.83, y: 0.2, r: 13, k: "heat", bpm: 71, dead: false },
];

/** The doomed organism has a living child. Lineage is not erased by death. */
export const CLOSEUP_EDGES = [
  [0, 1],
  [0, 2],
  [1, 4],
  [2, 3],
];

export const CLOSEUP_DOOMED = 2;

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

/**
 *  Mount the field into `host`, which must contain a <canvas> and an <svg>.
 *  Returns `{ die, destroy }` — the caller wires `die` to whatever should kill an
 *  organism, and must call `destroy` on unmount or the ticker keeps painting a
 *  detached canvas forever.
 *
 *  `spec` / `edges` / `base` are overridable so the death beat can mount the same
 *  mechanism as a close-up (see `CLOSEUP`). `base` is the width the specimen radii were
 *  drawn for; below it everything scales down together, so one composition holds from a
 *  phone to a 4K panel without a second set of numbers.
 */
export function mountField(
  host,
  { reduced = false, spec = SPEC, edges = EDGES, base = 1180, maxScale = 1.35 } = {},
) {
  const cv = host.querySelector("canvas");
  const svg = host.querySelector("svg");
  if (!cv || !svg) return { die() {}, destroy() {} };

  const ctx = cv.getContext("2d");
  const animate = !reduced;

  const cells = spec.map((o, i) => ({
    ...o,
    i,
    beat: 1,
    glow: 0.5,
    life: o.dead ? 0 : 1,
    nucleus: o.dead ? 0 : 1,
    drift: 0,
    px: 0,
    py: 0,
  }));

  const paths = edges.map(([a, b], i) => {
    const el = document.createElementNS(SVGNS, "path");
    el.setAttribute("stroke", "rgba(95,227,192,0.14)");
    el.setAttribute("stroke-width", "1");
    el.setAttribute("fill", "none");
    svg.appendChild(el);
    return { el, a, b, i, len: 0, drawn: animate ? 0 : 1 };
  });

  /* ── 1. heartbeat + vital-signal jitter ─────────────────────────────────── */
  function vitals(c) {
    if (c.dead) return;
    const period = 60 / c.bpm;

    // A real pulse is a double thump, not a sine wave: sharp systole, a smaller
    // second beat, then a long diastolic rest. The per-organism bpm (52-88) is what
    // stops twelve cells reading as one looping animation played twelve times.
    gsap
      .timeline({ repeat: -1, delay: Math.random() * period })
      .to(c, { beat: 1.16, duration: 0.11, ease: "power3.out" })
      .to(c, { beat: 1.0, duration: 0.17, ease: "power1.in" })
      .to(c, { beat: 1.07, duration: 0.09, ease: "power2.out" })
      .to(c, { beat: 1.0, duration: 0.22, ease: "power1.inOut" })
      .to(c, { beat: 1.0, duration: Math.max(0.05, period - 0.59) });

    // repeatRefresh re-rolls the random target each cycle, so the glow wanders like a
    // signal being read rather than oscillating like an animation.
    gsap.to(c, {
      glow: () => 0.34 + Math.random() * 0.66,
      duration: () => 0.22 + Math.random() * 0.5,
      repeat: -1,
      repeatRefresh: true,
      ease: "sine.inOut",
    });

    gsap.to(c, {
      drift: () => (Math.random() - 0.5) * 11,
      duration: () => 5 + Math.random() * 4,
      repeat: -1,
      repeatRefresh: true,
      ease: "sine.inOut",
    });
  }

  /* ── 3. death: one slow extinguish, never recycled ──────────────────────── */
  function die(index) {
    const c = cells[index];
    if (!c || c.dead) return;
    c.dead = true; // stops vitals() from ever re-arming
    gsap.killTweensOf(c); // the heartbeat stops mid-beat, as it would

    gsap
      .timeline()
      .to(c, { beat: 1.34, glow: 1, duration: 0.5, ease: "power2.out" }) // a last flare
      .to(c, { glow: 0.06, nucleus: 0, duration: 1.15, ease: "power2.in" })
      .to(c, { life: 0, beat: 0.74, duration: 1.5, ease: "power1.inOut" }, "<0.1");

    // The threads it hung on go ash with it, at the same slow rate. Lineage is not
    // erased by death — the edge stays, drained. That is what the tree shows too.
    for (const p of paths) {
      if (p.a === c.i || p.b === c.i) {
        gsap.to(p.el, {
          stroke: "rgba(122,118,134,0.07)",
          duration: 1.6,
          ease: "power1.inOut",
        });
      }
    }
  }

  /* ── 4. lineage threads, drawn rather than revealed ─────────────────────── */
  function routeThreads() {
    for (const p of paths) {
      const A = cells[p.a];
      const B = cells[p.b];
      // Quadratic arc: a straight line reads like a network diagram.
      const d = `M ${A.px} ${A.py} Q ${(A.px + B.px) / 2} ${
        (A.py + B.py) / 2 - 26 * scale
      } ${B.px} ${B.py}`;
      p.el.setAttribute("d", d);
      const len = p.el.getTotalLength();
      if (p.len !== len) {
        p.len = len;
        p.el.style.strokeDasharray = len;
        // Preserve however much is currently drawn across a resize.
        p.el.style.strokeDashoffset = len * (1 - p.drawn);
      }
    }
  }

  function drawThreads() {
    // Staggered parent → child: lineage grows outward from ancestors, so the order
    // the threads appear in is itself the claim.
    paths.forEach((p, i) => {
      p.drawn = 0;
      gsap.to(p, {
        drawn: 1,
        duration: 1.15,
        delay: 1.1 + i * 0.16,
        ease: "power2.inOut",
        onUpdate: () => {
          p.el.style.strokeDashoffset = p.len * (1 - p.drawn);
        },
      });
    });
  }

  /* ── paint ──────────────────────────────────────────────────────────────── */
  let W = 0;
  let H = 0;
  let dpr = 1;
  let scale = 1;

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    W = Math.max(1, r.width);
    H = Math.max(1, r.height);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    scale = Math.min(W / base, maxScale);
    for (const c of cells) {
      c.px = c.x * W;
      c.py = c.y * H;
    }
    routeThreads();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (const c of cells) {
      const col = mix(c.k === "heat" ? HEAT : LIFE, ASH, 1 - c.life);
      const py = c.py + c.drift;
      const pr = c.r * scale * (0.9 + 0.12 * c.beat) * (0.74 + 0.26 * c.life);
      const a = (0.13 + c.glow * 0.15) * (0.42 + 0.58 * c.life);

      const g = ctx.createRadialGradient(c.px, py, 0, c.px, py, pr * 4.4);
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
      g.addColorStop(0.42, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.22})`);
      g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.px, py, pr * 4.4, 0, Math.PI * 2);
      ctx.fill();

      // Membrane — a ring, so a cell reads as a cell and not a blur.
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${
        (0.34 + c.glow * 0.4) * (0.5 + 0.5 * c.life)
      })`;
      ctx.lineWidth = 1 + 0.35 * c.life;
      ctx.beginPath();
      ctx.arc(c.px, py, pr, 0, Math.PI * 2);
      ctx.stroke();

      if (c.nucleus > 0.01) {
        ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${
          (0.45 + c.glow * 0.45) * c.nucleus
        })`;
        ctx.beginPath();
        ctx.arc(c.px, py, Math.max(1.2, pr * 0.15), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Threads follow their cells' drift.
    for (const p of paths) {
      const A = cells[p.a];
      const B = cells[p.b];
      p.el.setAttribute(
        "d",
        `M ${A.px} ${A.py + A.drift} Q ${(A.px + B.px) / 2} ${
          (A.py + A.drift + B.py + B.drift) / 2 - 26 * scale
        } ${B.px} ${B.py + B.drift}`,
      );
    }
  }

  size();
  draw();

  // gsap.ticker.add does not dedupe, so a double-add would paint twice per frame.
  let painting = false;
  const startPaint = () => {
    if (!painting) {
      gsap.ticker.add(draw);
      painting = true;
    }
  };
  const stopPaint = () => {
    if (painting) {
      gsap.ticker.remove(draw);
      painting = false;
    }
  };

  const triggers = [];

  if (animate) {
    cells.forEach(vitals);
    drawThreads();
    startPaint();

    // Stop painting when the field leaves the viewport. Twelve radial gradients a
    // frame is cheap; twelve radial gradients a frame for a canvas nobody can see is
    // a laptop fan spinning up while a judge reads the rest of the page.
    triggers.push(
      ScrollTrigger.create({
        trigger: cv,
        start: "top bottom",
        end: "bottom top",
        onToggle: (self) => (self.isActive ? startPaint() : stopPaint()),
      }),
    );
  } else {
    for (const p of paths) {
      p.drawn = 1;
      p.el.style.strokeDashoffset = 0;
    }
  }

  let rt;
  const onResize = () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      size();
      draw();
      ScrollTrigger.refresh();
    }, 120);
  };
  window.addEventListener("resize", onResize, { passive: true });

  return {
    die,
    destroy() {
      clearTimeout(rt);
      window.removeEventListener("resize", onResize);
      stopPaint();
      for (const t of triggers) t.kill();
      for (const c of cells) gsap.killTweensOf(c);
      for (const p of paths) {
        gsap.killTweensOf(p);
        gsap.killTweensOf(p.el);
        p.el.remove();
      }
    },
  };
}
