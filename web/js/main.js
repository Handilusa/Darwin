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
import * as motion from "./motion.js";
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
  errorKind: null,
  // The collateral's `decimals()` never answered, so every money figure is scaled by an assumed 6.
  // Separate from `app.error` because that field is cleared on every successful poll and this fact
  // is not transient — it lasts as long as the config it came from.
  unverified: false,
  sourceLabel: "",
  // An address is in hand and the two discovery round trips have not landed yet. NOT derivable from
  // `!cfg && population`: `boot()` leaves the previous `cfg` in place across a retry on purpose, so
  // the only state that can distinguish "still reading" from "nothing configured" is a flag set at
  // the one moment it becomes true. See `paint()`'s first branch.
  connecting: false,
  lastFeedAt: 0,
  lastWindow: null,
  poll: 10_000,
  timer: null,
  ticker: null,
  season: null, // `?demo=1` only: the handle for the scripted window, so it can be stopped

  // THE FRAME ON SCREEN. Kept only so the next frame can be compared against it, because motion on
  // this page is a property of the diff and never of rendering — see the header of `motion.js`.
  // `paint()` reads these, then overwrites them with what it is about to draw, which makes the
  // invariant checkable in one place: `app.seen` is always what the viewer is looking at.
  seen: new Map(), // id -> { dead, treasury }
  seenPhase: null,
  seenHead: null, // key of the newest feed row already shown
  painted: false,

  entrants: new Map(),
  genomes: new Map(),
  userWallet: (typeof localStorage !== "undefined" && localStorage.getItem("darwin_user_wallet")) || null,
  filterOnlyMine: false,

  // Derived per paint and handed to the renderer through `ctx()`.
  depth: null,
  fx: null,
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
    // Threaded so the hero metric and the census table read generation depth off the SAME laid-out
    // tree instead of each deriving it from the snapshot separately. Two independent maxima that
    // agree today are two that can disagree after a change to either.
    depth: app.depth,
    // The concurrent population, threaded for the same reason `depth` is. `maxPopulation` is the
    // third gate on breeding — `hatchAll` breaks at the cap — so the detail pane needs the live
    // count to know whether an organism that has cleared both bars actually has room for a child.
    living: app.state?.livingCount ?? null,
    // What changed since the last paint. `render.js` turns this into `data-fx` attributes and
    // `motion.js` plays them after mount; nothing else in the codebase reads it.
    fx: app.fx,
    userWallet: app.userWallet,
    entrants: app.entrants,
    genomes: app.genomes,
    filterOnlyMine: app.filterOnlyMine,
    onToggleFilter: () => {
      app.filterOnlyMine = !app.filterOnlyMine;
      paint();
    },
    onSetWallet: (addr) => {
      if (addr) {
        app.userWallet = String(addr).trim().toLowerCase();
        try { localStorage.setItem("darwin_user_wallet", app.userWallet); } catch {}
      } else {
        app.userWallet = null;
        app.filterOnlyMine = false;
        try { localStorage.removeItem("darwin_user_wallet"); } catch {}
      }
      paint();
    },
  };
}

/*//////////////////////////////////////////////////////////////
                             DIFF
//////////////////////////////////////////////////////////////*/

const logKey = (l) => (l ? `${l.blockNumber}:${l.logIndex ?? 0}` : null);

/**
 *  How many rows at the head of the feed were not on screen a moment ago.
 *
 *  A length delta would be wrong. `readFeed` scans a SLIDING range (`head - FEED_LOOKBACK`), so old
 *  rows fall off the tail as the chain advances and the list can gain three events at the front
 *  while getting shorter overall. Anchoring on the newest row already shown counts the actual
 *  additions instead of inferring them from a total.
 *
 *  If that anchor has fallen out of the scanned range the honest answer is zero: the page would
 *  rather highlight nothing than highlight rows it cannot prove are new.
 */
function newRowsSince(logs, anchor) {
  if (!anchor) return 0;
  for (let i = 0; i < logs.length; i += 1) if (logKey(logs[i]) === anchor) return i;
  return 0;
}

/**
 *  Compare the frame on screen with the frame about to replace it, then become the new baseline.
 *
 *  Every animation on this page traces back to one of the transitions computed here, which is what
 *  makes the motion informative rather than decorative: a poll where nothing happened looks
 *  different from a poll where an organism died, because in the first case there is nothing to
 *  stamp. State the renderer can already see (`dead`, `treasury`) is not enough on its own — `dead`
 *  is true for ten thousand paints after the one where it BECAME true, and only this comparison
 *  knows which paint that was.
 *
 *  Returns null for the first frame. On a cold page every organism is new to the viewer but none of
 *  them just died, so `motion.first()` is the honest treatment and per-organism stamps would claim
 *  twelve births that never happened.
 */
function advance(state, logs) {
  const rows = state.organisms || [];
  const cold = !app.painted;
  const before = app.seen;
  const beforePhase = app.seenPhase;
  const beforeHead = app.seenHead;

  const seen = new Map();
  const organisms = new Map();
  const prev = new Map();

  for (const o of rows) {
    const id = Number(o.id);
    const treasury = o.treasury == null ? null : BigInt(o.treasury);
    seen.set(id, { dead: o.dead === true, treasury });
    if (cold) continue;

    const was = before.get(id);
    if (!was) organisms.set(id, "born");
    else if (o.dead === true && !was.dead) {
      organisms.set(id, "died");
      // AND its last treasury, which is not a count-up — it is the drain.
      //
      // `motion.js`'s `died()` tweens `.vitals-fill` from `data-was` to 0%, and that beat is the
      // one that reads as a death rather than as an error, because it is the same bar that has
      // been counting down all along. `render.js`'s `vitals()` stamps `data-was` only when it is
      // handed a previous value — and this branch used to `return` without recording one, so the
      // stamp was UNREACHABLE and the drain silently never played. The `else if` below cannot
      // cover it: an organism cannot be both dying and merely moving in the same frame.
      //
      // Feeding the same map is safe because `card()` gates its count-up on `moved && !o.dead`,
      // so a corpse's entry here can never become a treasury tween. What it can become is the
      // one beat the death timeline was written for.
      if (was.treasury != null) prev.set(id, was.treasury);
    }
    // A card gets a count-up only if it is neither born nor dying this frame, so the three
    // treatments can never fire on the same node and fight over its treasury text.
    else if (was.treasury != null) prev.set(id, was.treasury);
  }

  const phase = state.phase == null ? null : Number(state.phase);

  app.seen = seen;
  app.seenPhase = phase;
  app.seenHead = logKey(logs?.[0]);
  app.painted = true;

  if (cold) return null;

  return {
    organisms,
    prev,
    // Only a genuine advance, not the arrival of a first reading.
    phase: phase != null && beforePhase != null && phase !== beforePhase,
    newRows: newRowsSince(logs || [], beforeHead),
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
  mount(
    $("#banner"),
    app.demo ? ui.demoBanner() : null,
    // Non-dismissible and above the error banner, for the same reason the demo banner is: a page
    // whose numbers are scaled by a guess must say so before it says anything else. It survives
    // successful polls because `app.unverified` is a property of the config, not of the last read.
    app.unverified ? ui.unverifiedBanner() : null,
    app.error ? ui.errorBanner(app.error, boot, app.errorKind) : null,
  );

  if (!app.cfg) {
    const s = settings();
    mount($("#header"), ui.masthead());

    /*
     *  CONFIGURED BUT UNREAD IS NOT UNCONFIGURED. These two states used to share this branch, and
     *  the day `web/config.js` got a real POPULATION that stopped being harmless: a visitor with a
     *  perfectly good address was shown the primer and the address form for the length of two round
     *  trips and then had them replaced by the arena. Worse than the flicker, `primer()` asserts
     *  "Season 0 is not deployed yet" — so the published site opened by denying its own deploy.
     *
     *  `connecting` is only ever true with an address in hand, so the form is not withheld from
     *  anyone who needs it: it stays mounted underneath, closed. Both error paths in `boot()` clear
     *  the flag before they paint, which is what keeps a failed discovery from getting this frame
     *  instead of its banner and its open field.
     */
    if (app.connecting) {
      mount(
        $("#body"),
        ui.connectingCard({
          population: s.population,
          chainId: CHAIN_ID,
          sourceLabel: app.sourceLabel,
        }),
        ui.setupCard(
          { population: s.population, rpc: s.rpc, defaultRpc: DEFAULT_RPC, chainId: CHAIN_ID, badQuery: s.badQuery, noContract: null },
          { onConnect },
        ),
      );
      return;
    }

    // MECHANISM FIRST, FORM SECOND. This branch used to mount the setup panel alone, so the whole
    // page before Season 0 was an address field — asking for something that does not exist yet, from
    // a visitor who has no way to know that. The primer is the page's actual content; the form is the
    // operator's tool and keeps every bit of its function underneath.
    mount(
      $("#body"),
      ui.primer(),
      ui.setupCard(
        {
          population: s.population,
          rpc: s.rpc,
          defaultRpc: DEFAULT_RPC,
          chainId: CHAIN_ID,
          badQuery: s.badQuery,
          // An address with no contract behind it is remedied by editing the address, so the field
          // that edits it is opened. `wrong` — code that is not this ABI — has the same remedy and
          // opens it too. `unreachable` deliberately does NOT: the address is unjudged there and
          // inviting an edit would be advice to break a working setting.
          noContract:
            app.errorKind === "absent" || app.errorKind === "wrong" ? s.population : null,
        },
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

  // Diff BEFORE rendering, because the renderer stamps the result onto the nodes it builds. Guarded
  // on `app.state` so the "connecting…" frame — cfg resolved, no snapshot yet — never becomes the
  // baseline; if it did, the first real read would animate as the entire population being born.
  const cold = !app.painted;
  app.depth = lineage.depthReached(tree);
  app.fx = app.state ? advance(state, app.logs) : null;

  const c = ctx();

  mount($("#header"), ui.header(state, app.cfg, c));

  const split = el("div", { class: "split" },
    ui.grid(rows, app.cfg, c),
    ui.detail(selectedRow, info, app.cfg, { ...c, onClose: () => select(null) }),
  );

  // ORDER IS AN ARGUMENT, so it runs in the order the argument does: here is the population, here
  // is how it descended, here is what we do and do not claim about the machinery, here is the raw
  // log that either backs the claim or does not, here is the wiring.
  //
  // `claimPanel` used to sit directly under the hero, which cost it more than it was worth: a
  // full-width honesty panel between the thesis and the grid pushed every organism below the fold,
  // so the screen led with a caveat about selection instead of with the thing being selected. It
  // reads better beside the feed anyway — the `Reacted` rows immediately under it are the evidence
  // it is hedging about. Read errors stay at the top, because a stale frame has to say so first.
  mount(
    $("#body"),
    ui.readErrors({ ...(app.cfg.failures || {}), ...(state.errors || {}) }),
    split,
    ui.operationsPanel(rows, app.cfg, c),
    ui.standingsPanel(rows, state.prizePool, app.cfg, c),
    ui.tree(tree, app.cfg, c),
    ui.censusPanel(lineage.census(tree), app.depth),
    ui.claimPanel(state, app.logs),
    ui.feed(app.logs, app.cfg, { ...c, range: app.feedRange ? String(app.feedRange.scanned) : null }),
    ui.wiringPanel(app.cfg),
  );

  // Animation runs after mount, because the nodes it moves do not exist until then. The first frame
  // with data gets the entrance choreography once; every frame after it moves only what the diff
  // stamped, which for a repaint caused by a click is nothing at all.
  if (app.state && cold) motion.first(document);
  else if (app.fx) motion.apply(document);
}

/**
 *  Once a second, rewrite four characters.
 *
 *  This used to re-render the entire header, which threw away the browser's layout work for a
 *  countdown tick and — now that there is one — truncated any animation still running in the hero,
 *  once per second, forever. `ui.retime()` writes through the single node whose value changes and
 *  returns false when no header is mounted, which is the only case where there is nothing to do.
 */
function tick() {
  if (document.hidden || !app.cfg || !app.state) return;
  const w = withCountdown(app.state)?.window;
  ui.retime(w ? Number(w.secondsRemaining) : null);
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
    [13, "Momentum IV"], // born on screen, about nine seconds in
  ]);
  app.sourceLabel = "fixture";
  if (fx.details) {
    for (const [id, d] of fx.details.entries()) {
      if (d?.entrant) app.entrants.set(Number(id), d.entrant.toLowerCase());
      if (d?.systemPrompt) app.genomes.set(Number(id), d.systemPrompt);
    }
  }
  app.selected = selectionFromHash();
  paint();
  if (app.selected != null) loadDetail(app.selected);

  // The countdown still ticks in demo mode, because a frozen clock is the first thing that
  // makes a screenshot look like a mock-up.
  clearInterval(app.ticker);
  app.ticker = setInterval(tick, 1000);

  playSeason(fx, f.from);
}

/**
 *  Play `fixture.season()` — one window of the machine, in four frames, then stop.
 *
 *  This exists because of a gap between what the page can do and what `?demo=1` could show. Motion
 *  here is a property of the diff, so against one frozen snapshot the timelines that matter — an
 *  organism dying, a child appearing, a treasury moving, the phase advancing — can never fire. The
 *  demo was a still life of an arena whose entire subject is what happens under pressure.
 *
 *  It is a data swap, not an animation. Each frame is a whole snapshot shaped like a chain read, and
 *  it goes in through the same three lines `refresh()` uses, so `advance()` diffs it, `render.js`
 *  stamps it and `motion.js` plays it without any of them knowing where it came from. There is no
 *  demo-only path through the renderer, which is the only reason this is worth having: what a judge
 *  watches is the real pipeline, on synthetic data.
 *
 *  IT DOES NOT LOOP. The last frame is the last frame. Looping would resurrect #8 every twenty
 *  seconds, and death is irreversible in `Prophet.sol` with no path anywhere that clears `dead` —
 *  a demo that quietly contradicts the project's hardest invariant is worse than a shorter one.
 *  The countdown keeps ticking afterwards, so the page rests without looking frozen.
 */
function playSeason(fx, from) {
  const frames = fx.season();
  let i = 0;

  const play = () => {
    const f = frames[i];
    i += 1;

    // Wall-clock, stamped now rather than at module load: `withCountdown()` measures from `state.at`,
    // and a frame built twenty seconds ago would open its window already expired.
    const now = Math.floor(Date.now() / 1000);
    const turned = String(f.state.windowCount) !== String(app.state?.windowCount);

    app.state = { ...f.state, at: now, blockTimestamp: BigInt(now) };
    app.logs = f.logs;
    app.feedRange = { from, to: f.state.blockNumber, scanned: f.state.blockNumber - from };
    app.stamps = fx.stampsFor(f.logs, f.state.blockNumber);

    // Same rule `refresh()` follows: a cached detail describes a position in a window that has now
    // ended, so the pane would keep showing an open stake against a settled market.
    if (app.selected != null && turned) app.details.delete(Number(app.selected));

    paint();
    if (app.selected != null) loadDetail(app.selected);

    const next = frames[i];
    if (next) app.season = setTimeout(play, next.after);
  };

  clearTimeout(app.season);
  app.season = setTimeout(play, frames[0].after);
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
  clearTimeout(app.season); // a live boot must never leave the scripted demo window running

  // A boot may be a retry, or it may be a jump to a DIFFERENT population — `onConnect` calls this
  // too. Either way the frame on screen is no longer a baseline anything can be diffed against:
  // organism #3 over there is not organism #3 over here. Forgetting it makes the next paint a cold
  // one, which staggers in as a fresh page rather than reporting eleven imaginary deaths.
  app.seen = new Map();
  app.seenPhase = null;
  app.seenHead = null;
  app.painted = false;
  // Reset with the rest of the per-boot state so `?demo=1` and the no-address path can never
  // inherit a stale `true` from a boot that came before them.
  app.connecting = false;

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
    app.connecting = false;
    app.sourceLabel = "";
    paint();
    return;
  }

  app.sourceLabel = `via ${sourceLabel}`;
  // Not a blank page and not a form either: `paint()` renders the arena's previous frame if this
  // boot is a retry (`app.cfg` survives one on purpose), and otherwise the connecting frame.
  app.connecting = true;
  paint();

  try {
    const { client } = await chain.connect(s.rpc);
    app.client = client;
    // Retried, not called once. Discovery happens exactly once per connection and its result is
    // held for the life of the page, so a single lost request used to leave the page permanently
    // unwired behind a Retry button. `absent` is not retried — see `discoverWithRetry`.
    app.cfg = await chain.discoverWithRetry(client, population);
    app.error = null;
    app.connecting = false;
    /*
     *  A collateral whose `decimals()` never answered is not a missing field — it is the SCALE of
     *  every money figure the page is about to print. `chain.js` falls back to 6 rather than
     *  blanking the arena, so this is the sentence that stops that fallback from reading as a
     *  measurement. It is set here rather than in `readErrors` because the flag is a property of
     *  the numbers themselves, and a warning folded into a `<details>` is not a warning.
     */
    // Its OWN field, not `app.error`: `refresh()` clears `app.error` on every successful poll, so
    // the one sentence saying the figures are unscaled would survive for ten seconds and then
    // vanish while the wrong figures stayed. This is a property of the config, so it lives as long
    // as the config does.
    app.unverified = app.cfg.decimalsUnverified === true;
  } catch (e) {
    app.cfg = null;
    // Cleared BEFORE the paint, or a discovery that failed would render the connecting frame — a
    // page reporting that it is reading a chain that has already refused it — and would swallow the
    // open address field that `absent` and `wrong` exist to offer.
    app.connecting = false;
    app.error = e?.shortMessage || e?.message || String(e);
    // `absent` and `unreachable` come from `discover`'s read verdict (`chain.js`); anything else
    // is a client-level failure and carries no kind. The banner needs it to pick its headline, and
    // `absent` additionally forces the address form open — same reasoning as `badQuery`: the one
    // remedy is to change the address, so the field that changes it must not be folded away.
    app.errorKind = e?.kind ?? null;
    paint();
    return;
  }
  app.errorKind = null;

  if (!app.userWallet && typeof window !== "undefined" && window.ethereum?.selectedAddress) {
    app.userWallet = window.ethereum.selectedAddress.toLowerCase();
  }

  chain.organismLabels().then((m) => {
    if (m.size) {
      app.labels = m;
      paint();
    }
  });

  await refresh(true);

  app.ticker = setInterval(tick, 1000);
}

async function refresh(force = false) {
  clearTimeout(app.timer);
  if (!app.client || !app.cfg) return;

  try {
    app.state = await chain.readState(app.client, app.cfg);
    app.error = null;

    if (app.state?.organisms?.length) {
      const missingEntrants = app.state.organisms.filter((o) => !app.entrants.has(Number(o.id)));
      if (missingEntrants.length) {
        chain.readEntrants(app.client, missingEntrants).then((m) => {
          if (m?.size) {
            for (const [id, addr] of m.entries()) app.entrants.set(id, addr);
            paint();
          }
        }).catch(() => {});
      }

      const missingGenomes = app.state.organisms.filter((o) => !app.genomes.has(Number(o.id)));
      if (missingGenomes.length) {
        chain.readGenomes(app.client, missingGenomes).then((m) => {
          if (m?.size) {
            for (const [id, prompt] of m.entries()) app.genomes.set(id, prompt);
            paint();
          }
        }).catch(() => {});
      }
    }
  } catch (e) {
    // NOT DEAD, despite how it looks: every chain read inside `readState` is wrapped in
    // `Promise.allSettled` and returns `null` on failure (`chain.js:233-262`), so no RPC error
    // arrives here. What can still reject is the un-settled work either side of those reads —
    // `await abis()` at `chain.js:223`, a dynamic `import("./abi.js")` that fails if a file is
    // missing from the deploy, and the mapping code that builds `out` afterwards. Both mean the
    // page's own code or its files are broken, not that the chain is unreachable.
    //
    // So keep whatever frame is already on screen and name the failure beside it, rather than
    // replacing a good population view with an empty one. On the very first refresh there is no
    // previous frame, and then the banner is correctly all there is to show.
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
      // `readFeed` resolves even when every request inside it was refused — see its docblock.
      // Until 2026-09-06 that silence was the bug: an oversized LOG_CHUNK made dream-rpc reject
      // all three scans on every round, and the page rendered "no activity yet". Naming the
      // reason costs one banner line and is the difference between a fixable afternoon and a
      // demo that looks dead.
      if (f.errors?.length && !f.logs.length) {
        app.error = app.error || `log scan refused: ${f.errors[0]}`;
      }
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
