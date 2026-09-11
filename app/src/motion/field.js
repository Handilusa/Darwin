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
/**
 *  Twelve specimens. Positions are fractions of the field, so the composition survives
 *  any viewport; radii are in the field's own scale. Two are already ash at load —
 *  a population that has never lost anyone would misrepresent the mechanism.
 */
export const SPEC = [
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
export const EDGES = [
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
    // Interactive and organic physics states
    mDx: 0,
    mDy: 0,
    mouseExcitement: 0,
    ripple: 0,
    phase: i * 1.37 + Math.random(),
  }));

  const paths = edges.map(([a, b], i) => {
    const el = document.createElementNS(SVGNS, "path");
    el.setAttribute("stroke", "rgba(95,227,192,0.16)");
    el.setAttribute("stroke-width", "1");
    el.setAttribute("fill", "none");
    svg.appendChild(el);
    return { el, a, b, i, len: 0, drawn: animate ? 0 : 1 };
  });

  // Synaptic action-potential data pulses along the lineage curves
  const pulses = animate
    ? edges.flatMap(([a, b], edgeIdx) => [
        {
          a,
          b,
          edgeIdx,
          t: (edgeIdx * 0.23) % 1,
          speed: 0.003 + ((edgeIdx * 7) % 5) * 0.0008,
          size: 2.2,
        },
        {
          a,
          b,
          edgeIdx,
          t: (edgeIdx * 0.23 + 0.5) % 1,
          speed: 0.0026 + ((edgeIdx * 3) % 4) * 0.0007,
          size: 1.6,
        },
      ])
    : [];

  // Ambient bioluminescent spores drifting through the nutrient fluid medium
  const SPORE_COUNT = animate ? 34 : 0;
  const spores = Array.from({ length: SPORE_COUNT }, (_, idx) => ({
    x: Math.random(),
    y: Math.random(),
    r: 0.8 + Math.random() * 1.6,
    baseAlpha: 0.12 + Math.random() * 0.24,
    speedX: (Math.random() - 0.5) * 0.0003,
    speedY: -0.00025 - Math.random() * 0.00045,
    k: idx % 4 === 0 ? "heat" : "life",
    phase: Math.random() * Math.PI * 2,
    depth: 0.35 + Math.random() * 0.65,
  }));

  // Burst embers when an organism expires
  const deathParticles = [];

  /* ── 1. heartbeat + vital-signal jitter ─────────────────────────────────── */
  function vitals(c) {
    if (c.dead) return;
    const period = 60 / c.bpm;

    // Biological double-thump pulse with diastole
    gsap
      .timeline({ repeat: -1, delay: Math.random() * period })
      .to(c, { beat: 1.18, duration: 0.11, ease: "power3.out" })
      .to(c, { beat: 1.0, duration: 0.17, ease: "power1.in" })
      .to(c, { beat: 1.08, duration: 0.09, ease: "power2.out" })
      .to(c, { beat: 1.0, duration: 0.22, ease: "power1.inOut" })
      .to(c, { beat: 1.0, duration: Math.max(0.05, period - 0.59) });

    // Wanderings of cellular signal activity
    gsap.to(c, {
      glow: () => 0.36 + Math.random() * 0.64,
      duration: () => 0.22 + Math.random() * 0.5,
      repeat: -1,
      repeatRefresh: true,
      ease: "sine.inOut",
    });

    gsap.to(c, {
      drift: () => (Math.random() - 0.5) * 12,
      duration: () => 5 + Math.random() * 4,
      repeat: -1,
      repeatRefresh: true,
      ease: "sine.inOut",
    });
  }

  /* ── 2. death: one slow extinguish, never recycled ──────────────────────── */
  function die(index) {
    const c = cells[index];
    if (!c || c.dead) return;
    c.dead = true; // stops vitals() from ever re-arming
    gsap.killTweensOf(c);

    // Spawn a burst of ash embers at the moment of extinction
    const col = c.k === "heat" ? HEAT : LIFE;
    for (let k = 0; k < 24; k++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.8 + Math.random() * 3.2) * scale;
      deathParticles.push({
        x: c.px,
        y: c.py + c.drift,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        alpha: 0.85,
        r: 1 + Math.random() * 2,
        decay: 0.012 + Math.random() * 0.016,
        color: Math.random() > 0.4 ? col : ASH,
      });
    }

    gsap.to(c, {
      life: 0,
      glow: 0,
      nucleus: 0,
      beat: 0.72,
      duration: 1.2,
      ease: "power2.out",
    });

    // The threads it hung on go ash with it, at the same slow rate. Lineage stays.
    for (const p of paths) {
      if (p.a === c.i || p.b === c.i) {
        gsap.to(p.el, {
          stroke: "rgba(122,118,134,0.08)",
          duration: 1.4,
          ease: "power1.inOut",
        });
      }
    }
  }

  /* ── 3. lineage threads, drawn outward ──────────────────────────────────── */
  function routeThreads() {
    for (const p of paths) {
      const A = cells[p.a];
      const B = cells[p.b];
      const ax = A.px + A.mDx;
      const ay = A.py + A.drift + A.mDy;
      const bx = B.px + B.mDx;
      const by = B.py + B.drift + B.mDy;
      const ctrlY = (ay + by) / 2 - 26 * scale;
      const d = `M ${ax} ${ay} Q ${(ax + bx) / 2} ${ctrlY} ${bx} ${by}`;
      p.el.setAttribute("d", d);
      const len = p.el.getTotalLength();
      if (p.len !== len) {
        p.len = len;
        p.el.style.strokeDasharray = len;
        p.el.style.strokeDashoffset = len * (1 - p.drawn);
      }
    }
  }

  function drawThreads() {
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

  /* ── 4. interactive mouse tracking (magnetic bio-response) ──────────────── */
  const mouse = { x: -9999, y: -9999, active: false };
  const onPointerMove = (e) => {
    const rect = cv.getBoundingClientRect();
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    } else {
      mouse.active = false;
    }
  };
  const onPointerLeave = () => {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
  };
  if (animate) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave, { passive: true });
  }

  /* ── 5. paint ───────────────────────────────────────────────────────────── */
  let W = 0;
  let H = 0;
  let dpr = 1;
  let scale = 1;
  let startTime = performance.now();

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
    const now = performance.now();
    const time = (now - startTime) * 0.001;
    ctx.clearRect(0, 0, W, H);

    // ── Layer 1: Ambient bioluminescent fluid spores (Depth atmosphere) ─────
    if (animate) {
      for (const s of spores) {
        s.x += s.speedX + Math.sin(time * 0.6 + s.phase) * 0.0002 * s.depth;
        s.y += s.speedY;
        if (s.y < -0.04) s.y = 1.04;
        if (s.x < -0.04) s.x = 1.04;
        if (s.x > 1.04) s.x = -0.04;

        if (cells[DOOMED]?.dead && Math.hypot(s.x - 0.55, s.y - 0.52) < 0.04) continue;
        const sx = s.x * W;
        const sy = s.y * H;
        const pulse = 0.65 + 0.35 * Math.sin(time * 1.4 + s.phase);
        const col = s.k === "heat" ? HEAT : LIFE;
        const a = s.baseAlpha * pulse * s.depth;

        const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, s.r * 2.6 * scale);
        sg.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
        sg.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(sx, sy, s.r * 2.6 * scale, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Layer 2: Extinction / death ember burst ─────────────────────────────
    for (let k = deathParticles.length - 1; k >= 0; k--) {
      const p = deathParticles[k];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.alpha -= p.decay;
      if (p.alpha <= 0.01) {
        deathParticles.splice(k, 1);
        continue;
      }
      ctx.fillStyle = `rgba(${p.color[0]},${p.color[1]},${p.color[2]},${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Layer 3: Living Organisms (Cells) ───────────────────────────────────
    for (const c of cells) {
      // Interactive mouse physics: gentle magnetic drift & luminous excitation
      if (animate) {
        let targetMx = 0;
        let targetMy = 0;
        let targetEx = 0;
        if (mouse.active) {
          const dX = c.px - mouse.x;
          const dY = c.py + c.drift - mouse.y;
          const dist = Math.hypot(dX, dY);
          const influence = 160 * scale;
          if (dist < influence && dist > 0) {
            const force = 1 - dist / influence;
            targetEx = force;
            targetMx = (dX / dist) * force * 15 * scale;
            targetMy = (dY / dist) * force * 15 * scale;
          }
        }
        c.mDx += (targetMx - c.mDx) * 0.08;
        c.mDy += (targetMy - c.mDy) * 0.08;
        c.mouseExcitement += (targetEx - c.mouseExcitement) * 0.1;
      }

      const col = mix(c.k === "heat" ? HEAT : LIFE, ASH, 1 - c.life);
      const cx = c.px + c.mDx;
      const cy = c.py + c.drift + c.mDy;
      const pr = c.r * scale * (0.9 + 0.12 * c.beat) * (0.74 + 0.26 * c.life);
      const effectiveGlow = Math.min(1.2, c.glow + c.mouseExcitement * 0.35);
      const a = (0.14 + effectiveGlow * 0.16) * (0.42 + 0.58 * c.life);

      // 3.1 Deep Bioluminescent Atmospheric Halo
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr * 4.6);
      g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${a})`);
      g.addColorStop(0.38, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.28})`);
      g.addColorStop(0.72, `rgba(${col[0]},${col[1]},${col[2]},${a * 0.06})`);
      g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, pr * 4.6, 0, Math.PI * 2);
      ctx.fill();

      // 3.2 Cytoplasm & Harmonic Undulating Cellular Membrane
      const segments = 36;
      const step = (Math.PI * 2) / segments;
      ctx.beginPath();
      for (let j = 0; j <= segments; j++) {
        const angle = j * step;
        const wave = animate
          ? (Math.sin(angle * 3 + time * 2.2 + c.phase) * 0.036 +
              Math.cos(angle * 5 - time * 1.7 + c.phase * 0.5) * 0.02 +
              Math.sin(angle * 7 + time * 3.1) * 0.012) *
            c.life
          : 0;
        const curR = pr * (1 + wave);
        const vx = cx + Math.cos(angle) * curR;
        const vy = cy + Math.sin(angle) * curR;
        if (j === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();

      // Inner cytoplasm fluid wash
      const cytoGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr);
      cytoGrad.addColorStop(
        0,
        `rgba(${col[0]},${col[1]},${col[2]},${(0.12 + effectiveGlow * 0.16) * c.life})`,
      );
      cytoGrad.addColorStop(
        0.8,
        `rgba(${col[0]},${col[1]},${col[2]},${(0.04 + effectiveGlow * 0.06) * c.life})`,
      );
      cytoGrad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
      ctx.fillStyle = cytoGrad;
      ctx.fill();

      // Primary undulating membrane boundary
      ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${
        (0.38 + effectiveGlow * 0.42) * (0.5 + 0.5 * c.life)
      })`;
      ctx.lineWidth = (1 + 0.45 * c.life) * (1 + c.mouseExcitement * 0.25);
      ctx.stroke();

      // 3.3 Concentric inner refraction ring (biological cell-wall depth)
      if (c.life > 0.1 && pr > 12) {
        ctx.beginPath();
        for (let j = 0; j <= segments; j++) {
          const angle = j * step;
          const innerWave = animate
            ? (Math.sin(angle * 4 - time * 1.8 + c.phase) * 0.025 +
                Math.cos(angle * 2 + time * 2.5) * 0.015) *
              c.life
            : 0;
          const innerR = pr * 0.86 * (1 + innerWave);
          const vx = cx + Math.cos(angle) * innerR;
          const vy = cy + Math.sin(angle) * innerR;
          if (j === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${
          (0.14 + effectiveGlow * 0.18) * c.life
        })`;
        ctx.lineWidth = 0.85;
        ctx.stroke();
      }

      // 3.4 Orbiting cytoplasmic organelles / micro-sparks (Active internal life)
      if (animate && c.life > 0.2 && c.r >= 14) {
        const organelleCount = c.r >= 22 ? 3 : 2;
        for (let k = 0; k < organelleCount; k++) {
          const rotDir = k % 2 === 0 ? 1 : -1;
          const orbSpeed = (0.7 + k * 0.35) * rotDir;
          const orbAngle = time * orbSpeed + (k * Math.PI * 2) / organelleCount + c.phase;
          const orbDist = pr * (0.42 + 0.14 * Math.sin(time * 1.5 + k));
          const ox = cx + Math.cos(orbAngle) * orbDist;
          const oy = cy + Math.sin(orbAngle) * orbDist;
          const orbAlpha = (0.35 + effectiveGlow * 0.45) * c.nucleus * c.life;
          if (orbAlpha > 0.02) {
            ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${orbAlpha})`;
            ctx.beginPath();
            ctx.arc(ox, oy, Math.max(1, pr * 0.06), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // 3.5 High-energy Nucleus Core (Genome / Computational Soul)
      if (c.nucleus > 0.01) {
        const nR = Math.max(1.5, pr * 0.16);
        // Soft aura around nucleus
        const nG = ctx.createRadialGradient(cx, cy, 0, cx, cy, nR * 2.8);
        nG.addColorStop(
          0,
          `rgba(${col[0]},${col[1]},${col[2]},${(0.85 + effectiveGlow * 0.15) * c.nucleus})`,
        );
        nG.addColorStop(
          0.6,
          `rgba(${col[0]},${col[1]},${col[2]},${(0.35 + effectiveGlow * 0.2) * c.nucleus})`,
        );
        nG.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
        ctx.fillStyle = nG;
        ctx.beginPath();
        ctx.arc(cx, cy, nR * 2.8, 0, Math.PI * 2);
        ctx.fill();

        // High-contrast bright inner core
        const coreWhite = mix(col, [255, 255, 255], 0.65);
        ctx.fillStyle = `rgba(${coreWhite[0]},${coreWhite[1]},${coreWhite[2]},${
          (0.9 + effectiveGlow * 0.1) * c.nucleus
        })`;
        ctx.beginPath();
        ctx.arc(cx, cy, nR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Layer 4: Synaptic Energy Pulses (Action potentials on lineage edges) ─
    if (animate) {
      for (const pulse of pulses) {
        const A = cells[pulse.a];
        const B = cells[pulse.b];
        // Only fire if both nodes are alive
        if (A.dead || B.dead) continue;
        const transmissionLife = Math.min(A.life, B.life);
        if (transmissionLife < 0.15) continue;

        pulse.t += pulse.speed;
        if (pulse.t > 1) pulse.t -= 1;

        const p0x = A.px + A.mDx;
        const p0y = A.py + A.drift + A.mDy;
        const p2x = B.px + B.mDx;
        const p2y = B.py + B.drift + B.mDy;
        const p1x = (p0x + p2x) / 2;
        const p1y = (p0y + p2y) / 2 - 26 * scale;

        // Quadratic Bezier interpolation: B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2
        const t = pulse.t;
        const it = 1 - t;
        const px = it * it * p0x + 2 * it * t * p1x + t * t * p2x;
        const py = it * it * p0y + 2 * it * t * p1y + t * t * p2y;

        const col = A.k === "heat" ? HEAT : LIFE;
        const pulseAlpha = Math.sin(t * Math.PI) * 0.85 * transmissionLife;
        if (pulseAlpha > 0.02) {
          // Glowing head
          const pulseGrad = ctx.createRadialGradient(px, py, 0, px, py, pulse.size * 2.8 * scale);
          pulseGrad.addColorStop(0, `rgba(255,255,255,${pulseAlpha})`);
          pulseGrad.addColorStop(
            0.4,
            `rgba(${col[0]},${col[1]},${col[2]},${pulseAlpha * 0.8})`,
          );
          pulseGrad.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
          ctx.fillStyle = pulseGrad;
          ctx.beginPath();
          ctx.arc(px, py, pulse.size * 2.8 * scale, 0, Math.PI * 2);
          ctx.fill();

          // Trailing comet segment
          const trailT = Math.max(0, t - 0.045);
          const itT = 1 - trailT;
          const tx = itT * itT * p0x + 2 * itT * trailT * p1x + trailT * trailT * p2x;
          const ty = itT * itT * p0y + 2 * itT * trailT * p1y + trailT * trailT * p2y;
          ctx.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${pulseAlpha * 0.35})`;
          ctx.lineWidth = 1.6 * scale;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(px, py);
          ctx.stroke();
        }
      }
    }

    // Threads follow their cells' drift and magnetic response
    for (const p of paths) {
      const A = cells[p.a];
      const B = cells[p.b];
      const ax = A.px + A.mDx;
      const ay = A.py + A.drift + A.mDy;
      const bx = B.px + B.mDx;
      const by = B.py + B.drift + B.mDy;
      const ctrlY = (ay + by) / 2 - 26 * scale;
      p.el.setAttribute("d", `M ${ax} ${ay} Q ${(ax + bx) / 2} ${ctrlY} ${bx} ${by}`);
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

    // Stop painting when the field leaves the viewport to preserve CPU/battery
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
      if (animate) {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerleave", onPointerLeave);
      }
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
