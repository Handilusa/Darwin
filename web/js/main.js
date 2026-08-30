/**
 *  The controller: resolve where to point, read, paint, repeat.
 *
 *  This is the only module that holds mutable state, the only one that talks to the clock, and
 *  the only one that decides when to fetch. `render.js` cannot fetch and `chain.js` cannot
 *  paint, which is what keeps the fixture honest: `?demo=1` swaps out this file's DATA SOURCE
 *  and nothing else, so the demo exercises the same renderer the live page does.
 *
 *  Deliberate absences:
 *    - NO WALLET. Every value here is public state and every mutation belongs to the operator's
 *      scripts, so the page never asks to connect anything. A judge can open it cold.
 *    - NO WRITES, so no chance of this dashboard spending an organism's STT by accident.
 *    - NO FRAMEWORK and no build. Open `index.html` through any static server and it runs.
 */

import { DEFAULT_RPC, CHAIN_ID, FEED_ROWS, KEYS, isAddress, remember, settings } from "../config.js";
import * as chain from "./chain.js";
import { $, el, mount } from "./dom.js";
import * as lineage from "./lineage.js";
import * as ui from "./render.js";

const POLL_FEED_EVERY_MS = 60_000;

const app = {
  demo: false,
  client: null,
  cfg: null,
  state: null,
  logs: [],
  feedRange: null,
  stamps: new Map(),
  labels: new Map(),
  details: new Map(),
  selected: null,
  error: null,
  sourceLabel: "",
  lastFeedAt: 0,
  lastWindow: null,
  poll: 10_000,
  timer: null,
  ticker: null,
};

/*//////////////////////////////////////////////////////////////
                             PAINT
//////////////////////////////////////////////////////////////*/

function ctx() {
  return {
    labels: app.labels,
    selected: app.selected,
    onSelect: select,
    stamps: app.stamps,
    priceDecimals: app.state?.window?.priceDecimals ?? 6,
    sourceLabel: app.sourceLabel,
  };
}

/**
 *  `secondsRemaining` is a chain read taken at `state.at`, so between polls the honest value is
 *  the read minus the wall-clock time since. Counting down locally rather than showing a stale
 *  number is the difference between a live-looking dashboard and a lying one; it is clamped at
 *  zero because a negative countdown would imply knowledge the page does not have.
 */
function withCountdown(state) {
  if (!state?.window) return state;
  const elapsed = Math.max(0, Math.floor(Date.now() / 1000) - Number(state.at || 0));
  const left = Number(state.window.secondsRemaining) - elapsed;
  return { ...state, window: { ...state.window, secondsRemaining: left > 0 ? left : 0 } };
}

function paint() {
  const c = ctx();

  mount($("#banner"), app.demo ? ui.demoBanner() : null, app.error ? ui.errorBanner(app.error, boot) : null);

  if (!app.cfg) {
    const s = settings();
    mount($("#header"));
    mount(
      $("#body"),
      ui.setupCard(
        { population: s.population, rpc: s.rpc, defaultRpc: DEFAULT_RPC, chainId: CHAIN_ID, badQuery: s.badQuery },
        { onConnect },
      ),
    );
    return;
  }

  const state = withCountdown(app.state) || {};
  const rows = state.organisms || [];
  const tree = lineage.layout(rows);
  const selectedRow = rows.find((o) => Number(o.id) === Number(app.selected)) || null;
  const info = app.selected == null ? null : app.details.get(Number(app.selected)) ?? null;

  mount($("#header"), ui.header(state, app.cfg, c));

  const split = el("div", { class: "split" },
    ui.grid(rows, app.cfg, c),
    ui.detail(selectedRow, info, app.cfg, { ...c, onClose: () => select(null) }),
  );

  mount(
    $("#body"),
    ui.claimPanel(state, app.logs),
    ui.readErrors({ ...(app.cfg.failures || {}), ...(state.errors || {}) }),
    split,
    ui.tree(tree, app.cfg, c),
    ui.censusPanel(lineage.census(tree), lineage.depthReached(tree)),
    ui.feed(app.logs, app.cfg, { ...c, range: app.feedRange ? String(app.feedRange.scanned) : null }),
    ui.wiringPanel(app.cfg),
  );
}

/*//////////////////////////////////////////////////////////////
                           SELECTION
//////////////////////////////////////////////////////////////*/

/**
 *  Selection lives in the URL fragment so one organism is a shareable link — which matters for
 *  a submission where the interesting artefact is usually a specific genome, not the grid.
 */
function select(id) {
  app.selected = id == null ? null : Number(id);
  const base = globalThis.location.pathname + globalThis.location.search;
  const want = app.selected == null ? base : `#organism/${app.selected}`;
  history.replaceState(null, "", want);
  paint();
  if (app.selected != null) loadDetail(app.selected);
}

function selectionFromHash() {
  const m = /^#organism\/(\d+)$/.exec(globalThis.location.hash || "");
  return m ? Number(m[1]) : null;
}

async function loadDetail(id) {
  if (app.details.has(id)) return;

  if (app.demo) {
    const { details } = await import("./fixture.js");
    app.details.set(id, details.get(BigInt(id)) || { errors: {}, systemPrompt: "", lastReasoning: "" });
    paint();
    return;
  }

  const row = (app.state?.organisms || []).find((o) => Number(o.id) === id);
  if (!row || !app.client) return;
  try {
    app.details.set(id, await chain.readOrganism(app.client, row.addr));
  } catch (e) {
    app.details.set(id, { errors: { systemPrompt: String(e?.shortMessage || e?.message || e) } });
  }
  paint();
}

/*//////////////////////////////////////////////////////////////
                             DEMO
//////////////////////////////////////////////////////////////*/

async function bootDemo() {
  const fx = await import("./fixture.js");
  app.demo = true;
  app.cfg = fx.config;
  app.state = fx.state;
  const f = fx.feed();
  app.logs = f.logs;
  app.feedRange = f;
  app.stamps = fx.stamps();
  app.labels = new Map([
    [1, "Momentum"],
    [2, "Reversion"],
    [6, "Breakout"],
    [9, "Momentum II"],
    [11, "Momentum III"],
    [12, "Guest"],
  ]);
  app.sourceLabel = "fixture";
  app.selected = selectionFromHash();
  paint();
  if (app.selected != null) loadDetail(app.selected);

  // The countdown still ticks in demo mode, because a frozen clock is the first thing that
  // makes a screenshot look like a mock-up.
  clearInterval(app.ticker);
  app.ticker = setInterval(() => {
    if (!document.hidden) mount($("#header"), ui.header(withCountdown(app.state), app.cfg, ctx()));
  }, 1000);
}

/*//////////////////////////////////////////////////////////////
                             LIVE
//////////////////////////////////////////////////////////////*/

function onConnect(population, rpc) {
  if (!isAddress(population)) {
    app.error = `${population || "(empty)"} is not a 20-byte address.`;
    paint();
    return;
  }
  remember(KEYS.population, population);
  remember(KEYS.rpc, rpc || "");

  const url = new URL(globalThis.location.href);
  url.searchParams.set("population", population);
  if (rpc) url.searchParams.set("rpc", rpc);
  history.replaceState(null, "", url);

  app.error = null;
  boot();
}

async function boot() {
  clearTimeout(app.timer);
  clearInterval(app.ticker);

  const s = settings();
  app.poll = s.poll;
  app.selected = selectionFromHash();

  if (s.demo) return bootDemo();

  let population = s.population;
  let sourceLabel = s.source;

  // Last resort: the committed deploy manifest, which resolves when the page is served from
  // the repo root. A 404 is the expected answer otherwise and must not be an error.
  if (!population) {
    const fromManifest = await chain.manifestPopulation();
    if (isAddress(fromManifest)) {
      population = fromManifest;
      sourceLabel = "manifest";
    }
  }

  if (!population) {
    app.cfg = null;
    app.sourceLabel = "";
    paint();
    return;
  }

  app.sourceLabel = `via ${sourceLabel}`;
  paint(); // show the setup card / previous frame while connecting rather than a blank page

  try {
    const { client } = await chain.connect(s.rpc);
    app.client = client;
    app.cfg = await chain.discover(client, population);
    app.error = null;
  } catch (e) {
    app.cfg = null;
    app.error = e?.shortMessage || e?.message || String(e);
    paint();
    return;
  }

  chain.organismLabels().then((m) => {
    if (m.size) {
      app.labels = m;
      paint();
    }
  });

  await refresh(true);

  app.ticker = setInterval(() => {
    if (!document.hidden && app.cfg && app.state) {
      mount($("#header"), ui.header(withCountdown(app.state), app.cfg, ctx()));
    }
  }, 1000);
}

async function refresh(force = false) {
  clearTimeout(app.timer);
  if (!app.client || !app.cfg) return;

  try {
    app.state = await chain.readState(app.client, app.cfg);
    app.error = null;
  } catch (e) {
    // readState settles internally, so reaching here means something structural — keep the
    // last good frame on screen and say so, rather than replacing data with an empty page.
    app.error = e?.shortMessage || e?.message || String(e);
  }

  const windowChanged = app.state?.windowCount != null && app.state.windowCount !== app.lastWindow;
  const feedStale = Date.now() - app.lastFeedAt > POLL_FEED_EVERY_MS;

  if (app.state && (force || windowChanged || feedStale)) {
    app.lastWindow = app.state.windowCount;
    app.lastFeedAt = Date.now();
    try {
      const f = await chain.readFeed(app.client, app.cfg, {
        organisms: (app.state.organisms || []).map((o) => o.addr),
        latest: app.state.blockNumber ?? undefined,
      });
      app.logs = f.logs;
      app.feedRange = f;
      await chain.stampBlocks(app.client, f.logs.slice(0, FEED_ROWS).map((l) => l.blockNumber));
      app.stamps = stampMap(f.logs);
    } catch (e) {
      // A failed log scan must not take the population view with it: the grid, the tree and the
      // header are all still valid without a feed.
      app.logs = app.logs.length ? app.logs : [];
      app.error = app.error || `log scan failed: ${e?.shortMessage || e?.message || e}`;
    }
  }

  // Detail for the open organism goes stale every window too.
  if (app.selected != null && windowChanged) app.details.delete(Number(app.selected));

  paint();
  if (app.selected != null) loadDetail(app.selected);

  app.timer = setTimeout(() => refresh(false), app.poll);
}

function stampMap(logs) {
  const m = new Map();
  for (const l of logs) {
    const t = chain.blockTime(l.blockNumber);
    if (t != null) m.set(String(l.blockNumber), t);
  }
  return m;
}

/*//////////////////////////////////////////////////////////////
                             START
//////////////////////////////////////////////////////////////*/

globalThis.addEventListener("hashchange", () => {
  const id = selectionFromHash();
  if (id !== app.selected) {
    app.selected = id;
    paint();
    if (id != null) loadDetail(id);
  }
});

// Polling while nobody is looking is just RPC noise. Resuming refreshes immediately so a
// returning tab never shows a stale frame.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearTimeout(app.timer);
  else if (app.cfg && !app.demo) refresh(false);
});

boot();
