/**
 *  Capture the console at the moments that matter, so it can be LOOKED AT.
 *
 *  This file asserts nothing, and that is the point. `arena.mjs` can prove a death blooms in a
 *  red-dominant hue and settles at `saturate(0.15)` without knowing whether the result is beautiful
 *  or whether the header is embarrassingly empty. `FRONTEND_CHECKPOINT.md` §5.2 lists four things no
 *  assertion covers — a card dying, a birth, the feed washing in, and the setup panel a judge sees
 *  before Season 0 — and the only way to close them is with eyes on a real render.
 *
 *  Shots land in `web/.shots/` (git-ignored) at 2x DPR. The timings come from `fixture.js`'s SCRIPT
 *  and are the same wall-clock offsets `arena.mjs` samples at, so a still and an assertion always
 *  describe the same instant.
 *
 *  Usage: node test/shots.mjs [url]
 */

import { launch, sleep } from "./cdp.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL_UNDER_TEST = process.argv[2] ?? "http://localhost:3000/arena/?demo=1";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", ".shots");
mkdirSync(OUT, { recursive: true });

const SETTLE = 4200;
const HATCH = SETTLE + 5200;
const THINK = HATCH + 4600;
const COMMIT = THINK + 4000;

const session = await launch({ watchdogMs: 180_000, windowSize: "1600,1000" });
if (!session) process.exit(0);
const { send, evaluate, close } = session;

/* 2x so type and hairlines are judgeable rather than merely present. */
await send("Emulation.setDeviceMetricsOverride", {
  width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false,
});

let t0 = 0;
const elapsed = () => Date.now() - t0;

async function shot(name, atMs, { full = false } = {}) {
  const left = atMs - elapsed();
  if (left > 0) await sleep(left);
  const late = Math.max(0, -left);
  const clip = full ? await fullClip() : undefined;
  // Read the clock HERE. Encoding a 2x PNG costs 0.5-1.3s and happens after the frame is grabbed,
  // so logging the time the call *returned* overstates every shot by more than a whole timeline.
  const at = elapsed();
  const r = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: full,
    ...(clip ? { clip } : {}),
  });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
  // Say it out loud when a still missed its instant. A mid-flight shot captured 2s late still looks
  // like a perfectly good screenshot of the wrong moment, and nothing else here would notice.
  console.log(`  ${String(at).padStart(6)}ms  ${name}.png${late > 150 ? `   LATE by ${late}ms — wanted ${atMs}ms` : ""}`);
}

async function fullClip() {
  const m = await evaluate(`(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }))()`);
  return { x: 0, y: 0, width: m.width, height: m.height, scale: 1 };
}

console.log(`\ncapturing ${URL_UNDER_TEST} -> ${OUT}`);

/*  PASS 1 — the season, viewport-only.
 *
 *  Every shot here is on the wall clock and the timeline does not pause for the camera, so a
 *  capture that takes 2.6s does not just produce one late still, it pushes every later one by the
 *  same amount. A full-page capture costs an extra `evaluate` plus a much larger encode, which is
 *  what made the first version photograph a death 2.3s after it happened and label it "midflight".
 *  So the expensive ones live in pass 2, where nothing is moving and being late costs nothing.
 */
t0 = Date.now();
await send("Page.navigate", { url: URL_UNDER_TEST });
await shot("01-first-paint", 2000);
await shot("03-death-midflight", SETTLE + 320);
await shot("04-death-at-rest", SETTLE + 2600);
await shot("05-birth-midflight", HATCH + 300);
await shot("06-birth-at-rest", HATCH + 2200);
await shot("07-feed-wash", THINK + 300);
await shot("08-season-landed", COMMIT + 2400);

/* PASS 2 — the same page again, left alone, photographed whole. */
t0 = Date.now();
await send("Page.navigate", { url: URL_UNDER_TEST });
await shot("02-full-page-settled", COMMIT + 3000, { full: true });

/* The undeployed console: POPULATION is "" until Season 0, so this is today's front door. */
const liveUrl = URL_UNDER_TEST.replace(/\?.*$/, "");
t0 = Date.now();
await send("Page.navigate", { url: liveUrl });
await shot("09-setup-no-deployment", 2600, { full: true });

close();
console.log("\ndone\n");
process.exit(0);
