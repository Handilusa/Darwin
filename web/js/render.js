/**
 *  Every pixel. Pure functions from data to DOM nodes — no chain access, no polling, no state.
 *
 *  Three rules hold throughout, and each one is load-bearing rather than stylistic:
 *
 *  1. NOTHING HERE FETCHES. Every function takes the data it renders. That is what lets the
 *     fixture drive the identical code path as a live chain (see `fixture.js`) instead of a
 *     parallel demo renderer that could drift from the real one and flatter it.
 *
 *  2. NO `innerHTML`, EVER. Genomes and model reasoning arrive from `Population.enter`, which
 *     is permissionless (Population.sol:735). See the header of `dom.js`.
 *
 *  3. A MISSING VALUE RENDERS AS `—`, NOT AS ZERO. `0` and "the read failed" are different
 *     claims about a treasury, and a dashboard that prints them the same way is lying in the
 *     one situation where an operator most needs the truth. `dash()` enforces it.
 */

import { FEED_ROWS, addressUrl, blockUrl, txUrl } from "../config.js";
import { $, el, field, frag, link, mount, svg } from "./dom.js";
import { addr, ago, bps, dur, hash, money, moneyFixed, movePct, plural, stt, units, winRate } from "./format.js";
import {
  BELIEF_GLOSS,
  BELIEF_HUMAN,
  BELIEF_TONE,
  PHASE_GLOSS,
  PHASE_NEXT,
  PHASE_NEXT_HUMAN,
  PHASE_STATE,
  THESIS,
  THESIS_GLOSS,
  ZERO,
} from "./labels.js";
import { rootKind } from "./lineage.js";

const EM = "—";

/** Render `v` through `fn`, or an em dash if the read produced nothing. `0n` is a value. */
function dash(v, fn = String) {
  return v == null ? EM : fn(v);
}

function idx(table, i, fallback = EM) {
  const n = Number(i);
  return Number.isInteger(n) && table[n] != null ? table[n] : fallback;
}

/*//////////////////////////////////////////////////////////////
                          SMALL PIECES
//////////////////////////////////////////////////////////////*/

/** A clickable organism chip. The one place an id becomes navigation. */
export function chip(id, ctx = {}) {
  const n = Number(id);
  const name = ctx.labels?.get(n);
  const node = el(
    "button",
    {
      class: "chip",
      type: "button",
      title: name ? `Organism #${n} — ${name}` : `Organism #${n}`,
      click: ctx.onSelect ? () => ctx.onSelect(n) : null,
    },
    `#${n}`,
    name ? el("span", { class: "chip-name", text: name }) : null,
  );
  return node;
}

function beliefTag(belief, thesis) {
  const b = Number(belief);
  const t = Number(thesis);
  return el(
    "span",
    {
      class: ["tag", `belief-${idx(BELIEF_TONE, b, "none")}`],
      // The gloss rides along so the tag itself can stay two words wide. The visible text is the
      // translated label, not the enum name — `None` is what the contract stores and "no call" is
      // what it means, and after every settlement it is the value on every living organism.
      title: t > 0 ? `${idx(BELIEF_GLOSS, b, "")} · ${idx(THESIS_GLOSS, t, "")}` : idx(BELIEF_GLOSS, b, ""),
    },
    idx(BELIEF_HUMAN, b),
    t > 0 ? el("span", { class: "tag-sub", text: idx(THESIS, thesis) }) : null,
  );
}

function money2(v, cfg, places = 2) {
  return dash(v, (x) => `${money(x, cfg.decimals ?? 6, places)} ${cfg.tokenSymbol ?? ""}`.trim());
}

/**
 *  `money2`, padded to `places` instead of trimmed.
 *
 *  For the metrics strip, where ante, prize pool and rake sit in one row denominated in one token:
 *  `3.9 tUSDC` beside `3.21 tUSDC` and `1.28 tUSDC` reads as three different precisions of the same
 *  unit. `money2` is left alone because the feed says "paid 3.9 tUSDC rake on 12.4 tUSDC" in prose,
 *  and there a padded zero is noise rather than alignment.
 */
function money2Fixed(v, cfg, places = 2) {
  return dash(v, (x) => `${moneyFixed(x, cfg.decimals ?? 6, places)} ${cfg.tokenSymbol ?? ""}`.trim());
}

/*//////////////////////////////////////////////////////////////
                            BANNERS
//////////////////////////////////////////////////////////////*/

/**
 *  The demo banner. Not dismissible, and it says the numbers are invented in the first four
 *  words. A demo that can be screenshotted and mistaken for a live run would undo the whole
 *  reason this project keeps a "Not claimed" section.
 */
export function demoBanner() {
  return el(
    "div",
    { class: "banner banner-demo", role: "note" },
    el("strong", { text: "Synthetic data. " }),
    "Nothing on this screen came from a chain. This is ",
    el("code", { text: "web/js/fixture.js" }),
    ", shown so the interface can be judged before Season 0 is deployed. ",
    el("a", { href: "?", text: "Leave demo mode" }),
    ".",
  );
}

/**
 *  Every money figure on this page is scaled by a guess.
 *
 *  `discover()` reads the collateral's `decimals()` and falls back to 6 — the Shannon tUSDC value —
 *  when it cannot. Blanking the whole arena over one dropped ERC-20 call would be a worse answer
 *  than a marked one, but an UNMARKED fallback is the worst of the three: on an 18dp collateral
 *  every treasury, ante and metabolic cost on the screen is wrong by twelve orders of magnitude and
 *  nothing on the page says so. This is what makes the difference visible.
 *
 *  It is a banner rather than a row in `readErrors` because that panel is a collapsed `<details>`,
 *  and a warning the reader has to open is not a warning. Not dismissible, for the same reason
 *  `demoBanner` is not: a page that can be mistaken for a measured one is worse than a page that
 *  admits it is not.
 */
export function unverifiedBanner() {
  return el(
    "div",
    { class: "banner banner-warn", role: "alert" },
    el("strong", { text: "Amounts unverified. " }),
    "The collateral's ",
    el("code", { text: "decimals()" }),
    " did not answer, so every amount below is scaled by an assumed 6 decimals. Figures may be " +
      "wrong by orders of magnitude — check the token before believing a treasury.",
  );
}

/**
 *  The banner over a page that could not resolve an arena.
 *
 *  `kind` comes from `chain.js`'s read verdict and it changes the SENTENCE, not just the wording,
 *  because the three cases need three different actions from the reader:
 *
 *    absent       forty valid hex, no contract → the address is wrong. Check it.
 *    wrong        code, but not this ABI       → the address is wrong. Retrying cannot help.
 *    unreachable  the node did not answer      → the address is unjudged. Do NOT touch it.
 *    (default)    everything else — a wrong chain id, a dead endpoint, a broken import
 *
 *  It printed *"Cannot read the chain"* for all of them until 2026-09-03, which is the wrong
 *  headline exactly when it matters: over an address with no contract behind it, the chain read
 *  fine and the page blamed the network for it. `wrong` is the same mistake one step along: a
 *  superseded deploy still has code, so its reads REVERT rather than returning empty, and until
 *  2026-09-06 that was filed under `unreachable` and told to retry — advice that can never work.
 *
 *  The Retry button is withheld for both address verdicts. It is not decoration: offering a retry
 *  for a conclusion invites the reader to press it instead of reading the sentence.
 */
export function errorBanner(message, onRetry, kind) {
  const head =
    kind === "absent"
      ? "No arena at that address. "
      : kind === "wrong"
        ? "That address is not a Population. "
        : kind === "unreachable"
          ? "The chain did not answer. "
          : "Cannot read the chain. ";
  const settled = kind === "absent" || kind === "wrong";
  return el(
    "div",
    { class: "banner banner-error", role: "alert" },
    el("strong", { text: head }),
    el("span", { text: String(message) }),
    onRetry && !settled
      ? el("button", { class: "btn btn-inline", type: "button", click: onRetry }, "Retry")
      : null,
  );
}

/**
 *  Failed reads, named. `Promise.allSettled` means one reverting call no longer blanks the
 *  page — but silently swallowing it would be worse than the crash, so anything that failed
 *  is listed here with the reason the node gave.
 */
export function readErrors(errors) {
  const rows = Object.entries(errors || {});
  if (!rows.length) return null;
  return el(
    "details",
    { class: "panel panel-warn" },
    el("summary", {}, `${rows.length} ${plural(rows.length, "read")} failed`),
    el(
      "ul",
      { class: "error-list" },
      rows.map(([k, v]) => el("li", {}, el("code", { text: `${k}()` }), " ", el("span", { text: String(v) }))),
    ),
  );
}

/*//////////////////////////////////////////////////////////////
                              HERO
//////////////////////////////////////////////////////////////*/

/**
 *  The argument: one sentence, and the paragraph that unpacks it.
 *
 *  Shared by `header()` and `masthead()` rather than written twice, because the setup page and the
 *  live console must make the SAME claim. Two copies would drift, and the copy on the setup page is
 *  the one a visitor reads first — today it is the only one they read at all.
 */
function heroArgument(symbol) {
  return el(
    "div",
    { class: "hero-argument" },
    // The thesis. One sentence, and it is the load-bearing one — the whole design exists to make
    // this sentence obviously true of the screen under it.
    el("p", { class: "hero-thesis" }, "Organisms that lose money ", el("em", { text: "die" }), "."),
    el("p", {
      class: "hero-lede",
      text:
        `Each one is a contract carrying a trading thesis written in English. Every window it ` +
        `forecasts ${symbol || "the market"} — paying STT to think and collateral to stay alive — ` +
        `and the market settles the answer. Winners breed. Losers starve.`,
    }),
  );
}

/**
 *  The masthead for the page with nothing behind it yet.
 *
 *  Before Season 0 there is no address in `config.js`, so `paint()` renders the setup panel — and it
 *  used to render it under an EMPTY header, because `header()` needs a snapshot and a resolved config
 *  and has neither here. The result was a front door with no wordmark and no claim: a form, floating
 *  in the dark. That is the page a judge opens today, so it gets the two things a header can honestly
 *  carry with no chain to read — who this is, and what it asserts.
 *
 *  Deliberately NOT a degraded `header()`. Everything else that header shows is a live reading, and a
 *  masthead printing an em dash where the block number goes would look broken rather than early.
 */
export function masthead() {
  return el(
    "header",
    { class: "hero hero-plain" },
    el(
      "div",
      { class: "hero-top" },
      el("h1", {}, "DARWIN", el("span", { class: "sub", text: "arena" })),
      el("div", { class: "hero-meta" }, el("span", { text: "not connected" })),
    ),
    el("div", { class: "hero-grid" }, heroArgument(null)),
  );
}

/**
 *  What DARWIN is, and how the population is doing — in that order.
 *
 *  The previous version of this header rendered seven stats at identical weight: phase, window,
 *  alive, level, ante, prize pool and rake. All seven are true and two of them are the story, so a
 *  reader arriving cold had no way to tell that generation depth and the living count carry the
 *  claim while `rake` is a parameter. This promotes those two to hero scale, demotes the rest to a
 *  rail, and puts one sentence of prose above both — because somebody seeing this for the first
 *  time has to be told what they are looking at before being shown how it is going.
 *
 *  `phase` is drawn as a three-node machine rather than printed as a word, and it shows BOTH the
 *  state and the call that advances it: the two readings of the same integer are off by one step,
 *  and either alone describes a live population incorrectly to somebody reading the other. See
 *  `labels.js`.
 */
export function header(state, cfg, ctx = {}) {
  const phase = state.phase == null ? null : Number(state.phase);
  const w = state.window;
  const depth = depthOf(state, ctx);

  const seasonProgress =
    state.windowCount != null && state.seasonStartWindow != null && cfg.seasonWindows
      ? `${Number(state.windowCount - state.seasonStartWindow)} / ${Number(cfg.seasonWindows)}`
      : EM;

  const alive = state.aliveCount == null ? null : Number(state.aliveCount);
  const roll = deadRoll(state, ctx);

  return el(
    "header",
    { class: "hero" },
    el(
      "div",
      { class: "hero-top" },
      el("h1", {}, "DARWIN", el("span", { class: "sub", text: cfg.symbol ? `${cfg.symbol} arena` : "arena" })),
      el(
        "div",
        { class: "hero-meta" },
        cfg.population
          ? link(addressUrl(cfg.population), addr(cfg.population, 8, 6), { class: "mono", title: cfg.population })
          : EM,
        el("span", { class: "dot" }),
        el("span", { text: ctx.sourceLabel || "" }),
        state.blockNumber != null
          ? frag(
              el("span", { class: "dot" }),
              link(blockUrl(state.blockNumber), `block ${state.blockNumber}`, { class: "mono" }),
            )
          : null,
      ),
    ),

    // Three zones, and the order is an argument: what this is, how the population is doing, what the
    // market is doing. The prose and the numbers are separated by a rule rather than sharing a column
    // because they are different kinds of statement — one is a claim and the other is its evidence.
    el(
      "div",
      { class: "hero-grid" },
      heroArgument(cfg.symbol),

      el(
        "div",
        { class: "hero-vitals" },
        // Generation depth is the headline metric the docs name, so it is the number in brand
        // colour: it is the arena's own result, not any one organism's.
        metric(
          "generation",
          frag(el("span", { class: "metric-unit", text: "G" }), depth == null ? EM : String(depth.living)),
          depth == null ? "" : `deepest living line · G${depth.ever} ever reached`,
          "metric-gen",
        ),
        // THE STANDING BODY COUNT, on a line that already exists.
        //
        // `alive` alone is a head count, and a head count is exactly what a viewer cannot read a
        // death out of: 10 means nothing without the 12, and the 12 means nothing without the two
        // corpses it implies. All three now sit on the metric's own note line, which costs the hero
        // ZERO height — `.metric` is a flex column and this is one more inline child of a span that
        // already renders.
        //
        // Rendered from `state.organisms`, not from the diff: two organisms are dead at first paint
        // with nothing to stamp, so a toll that appeared only when something died would be a motion
        // cue pretending to be information. The stamp is the loud half and it is optional; the
        // sentence is the true half and it is unconditional.
        metric(
          "alive",
          alive == null ? EM : String(alive),
          state.prophetCount == null
            ? null
            : frag(
                `of ${state.prophetCount} ever born`,
                roll.count > 0
                  ? el(
                      "span",
                      { class: "toll", dataset: roll.justDied ? { fx: "toll" } : undefined },
                      el("span", { class: "toll-mark", text: "†" }),
                      `${roll.count} dead`,
                      roll.lastWindow == null ? null : el("span", { class: "toll-when", text: `· last w${roll.lastWindow}` }),
                    )
                  : null,
              ),
          ["metric-alive", alive === 0 && "all-dead"],
        ),
      ),

      el("div", { class: "hero-readout" }, priceBlock(state, w), phaseTrack(phase, ctx)),
    ),

    el(
      "div",
      { class: "stats" },
      stat("window", dash(state.windowCount, String), `season ${dash(state.seasonId, String)} · ${seasonProgress}`),
      stat("level", dash(state.level, String), cfg.levelWindows ? `every ${cfg.levelWindows} windows` : ""),
      stat(
        "ante",
        money2Fixed(state.ante, cfg),
        cfg.baseAnte != null && cfg.anteMultBps
          ? `base ${money(cfg.baseAnte, cfg.decimals ?? 6, 2)} × ${Number(cfg.anteMultBps) / 10_000}`
          : "",
      ),
      stat("prize pool", money2Fixed(state.prizePool, cfg), cfg.prizeShareBps ? `${bps(cfg.prizeShareBps)} of rake` : ""),
      stat("rake", money2Fixed(state.rakeAccrued, cfg), cfg.rakeBps ? `${bps(cfg.rakeBps)} of profit` : ""),
    ),
  );
}

/**
 *  Deepest living generation, and the deepest ever reached.
 *
 *  `main.js` computes this off the laid-out tree and threads it in as `ctx.depth`, which is the
 *  reading to prefer: it is the same object `censusPanel` prints, so the hero and the table cannot
 *  disagree. The fallback derives it straight from the snapshot for callers that hold no tree, and
 *  exists because a hero metric reading `—` while the data to compute it sits in the argument list
 *  would be a worse outcome than one `max()` written in two places.
 */
function depthOf(state, ctx) {
  if (ctx.depth) return ctx.depth;
  const rows = state.organisms || [];
  if (!rows.length) return null;
  let living = 0;
  let ever = 0;
  for (const o of rows) {
    const g = Number(o.generation);
    if (g > ever) ever = g;
    if (!o.dead && g > living) living = g;
  }
  return { living, ever };
}

/**
 *  The standing body count, when the most recent one fell, and whether one fell on THIS paint.
 *
 *  Derived from the same snapshot rows `grid()` partitions, so the hero and the corpse band cannot
 *  disagree. The `prophetCount - aliveCount` fallback covers a snapshot carrying the counters but not
 *  the roster; if neither reading is present the count is zero and the toll is simply absent, because
 *  a number invented for a page with no data is the same error class as a mock.
 *
 *  `justDied` is the ONLY thing here that consults the diff, and it consults the stamp vocabulary
 *  that already exists — `main.js`'s `fx.organisms` map, values "died" / "born". Nothing new is
 *  computed in `advance()` for this.
 */
function deadRoll(state, ctx) {
  const rows = state.organisms || [];
  const dead = rows.filter((o) => o.dead);

  let lastWindow = null;
  for (const o of dead) {
    const w = o.deathWindow == null ? null : Number(o.deathWindow);
    if (w != null && (lastWindow == null || w > lastWindow)) lastWindow = w;
  }

  const count = dead.length
    ? dead.length
    : state.prophetCount != null && state.aliveCount != null
      ? Math.max(0, Number(state.prophetCount) - Number(state.aliveCount))
      : 0;

  let justDied = false;
  for (const kind of ctx.fx?.organisms?.values() || []) if (kind === "died") justDied = true;

  return { count, lastWindow, justDied };
}

function metric(label, value, note = "", extra) {
  return el(
    "div",
    { class: ["metric", ...(Array.isArray(extra) ? extra : [extra])] },
    el("span", { class: "metric-value" }, value),
    el("span", { class: "metric-label", text: label }),
    // The note takes a NODE as readily as a string, because the death toll has to be a node: part of
    // it gets stamped and part of it gets a hue. Both forms land in the SAME one-line span, which is
    // the point — a caller cannot cost the hero a row of height here. This is the shape `value`
    // already has: the generation metric passes a `frag()` into `.metric-value`.
    note ? el("span", { class: "metric-note" }, note) : null,
  );
}

/**
 *  The cadence, as the state machine it is: three nodes on a track, the live one lit, the call that
 *  advances it named at the end. Position carries the state and the label carries the next action,
 *  which is the only arrangement in which the off-by-one between them cannot be misread.
 */
function phaseTrack(phase, ctx) {
  const parts = [];
  for (let i = 0; i < PHASE_STATE.length; i += 1) {
    const live = phase === i;
    const past = phase != null && i < phase;
    parts.push(
      el(
        "span",
        { class: ["phase-node", live && "is-live", past && "is-past"], "aria-current": live ? "step" : null,
          title: PHASE_GLOSS[i] },
        // A real element rather than a `::before`, so the advance animation has something to
        // scale that is not also the label. See `motion.js`.
        el("i", { class: "phase-dot", dataset: live && ctx.fx?.phase ? { fx: "phase" } : undefined }),
        el("span", { text: PHASE_STATE[i] }),
      ),
    );
    if (i < PHASE_STATE.length - 1) parts.push(el("span", { class: ["phase-rail", past && "is-past"] }));
  }
  return el(
    "div",
    { class: "phase-track", role: "group", "aria-label": "cadence phase" },
    parts,
    el(
      "span",
      { class: "phase-next" },
      "next ",
      el("b", { text: phase == null ? EM : idx(PHASE_NEXT_HUMAN, phase, "?") }),
      // The selector stays, quietly. It is exactly what a reader who intends to check the cadence
      // against the contract needs, and exactly the wrong thing to lead with for a reader who is
      // still working out what this page is — so the sentence goes first and the call follows it.
      phase == null ? null : el("code", { class: "phase-call", text: idx(PHASE_NEXT, phase, "?") }),
    ),
  );
}

function priceBlock(state, w) {
  const move = w ? movePct(w.openPrice, w.lastPrice) : null;
  return el(
    "div",
    { class: "price" },
    w
      ? frag(
          el(
            "div",
            { class: "price-main" },
            el("span", { class: "price-open", text: money(w.openPrice, w.priceDecimals, 2) }),
            el("span", { class: "price-arrow", text: "→" }),
            el("span", { class: "price-last", text: money(w.lastPrice, w.priceDecimals, 2) }),
            el("span", {
              class: ["price-move", move.sign > 0 ? "up" : move.sign < 0 ? "down" : "flat"],
              text: move.text,
            }),
          ),
          el(
            "div",
            { class: "price-meta" },
            // `data-clock` is the handle `retime()` writes through once a second, so the ticker
            // no longer has to rebuild this whole subtree to change four characters.
            el("span", { dataset: { clock: "1" }, text: `${dur(w.secondsRemaining)} left` }),
            el("span", { class: "dot" }),
            el("span", {
              class: w.tradeable ? "ok" : "bad",
              text: w.tradeable ? "tradeable" : "not tradeable",
            }),
            w.marketId
              ? frag(el("span", { class: "dot" }), el("span", { class: "mono", text: hash(w.marketId, 8, 4) }))
              : null,
          ),
        )
      : el(
          "div",
          { class: "price-none" },
          el("strong", { text: "no price window" }),
          // NoWindow and StalePrice are both ORDINARY states between cadence ticks, not
          // faults, and saying which one it is turns a blank panel into a diagnosis.
          el("span", { class: "price-why", text: windowExcuse(state.windowError) }),
        ),
  );
}

/**
 *  Rewrite the countdown in place.
 *
 *  `main.js` used to re-render the entire header once a second to move this number, which threw
 *  away the browser's layout work for a four-character change and destroyed any animation still in
 *  flight. This patches the single node whose value actually changes per tick. It is the only
 *  mutation in this file, and it writes through `textContent` — never markup, for the same reason
 *  nothing else here does.
 */
export function retime(seconds) {
  const node = $("[data-clock]");
  if (!node) return false;
  node.textContent = seconds == null ? EM : `${dur(seconds)} left`;
  return true;
}

function stat(label, value, note = "") {
  return el(
    "div",
    { class: "stat" },
    el("span", { class: "stat-label", text: label }),
    el("span", { class: "stat-value", text: value }),
    note ? el("span", { class: "stat-note", text: note }) : null,
  );
}

function windowExcuse(err) {
  if (!err) return "the price source has not been read yet";
  const s = String(err);
  if (/NoWindow/.test(s)) return "NoWindow — no price has been pushed for this symbol yet";
  if (/StalePrice/.test(s)) return "StalePrice — the last push is older than maxStaleness (180s)";
  return s;
}

/*//////////////////////////////////////////////////////////////
                        THE HONESTY PANEL
//////////////////////////////////////////////////////////////*/

/**
 *  The claim this deployment is actually licensed to make, and the evidence for it.
 *
 *  README.md:100-106 fixes two wordings and makes which one applies a function of
 *  `SelectionEngine.fallbackEnabled`. This panel QUOTES them rather than paraphrasing, shows
 *  the switch's live value, and — since `readFeed` now scans the engine — shows the most recent
 *  `Reacted` log so the claim rests on a block number instead of on prose.
 */
export function claimPanel(state, logs = []) {
  const fb = state.fallbackEnabled;
  const reactions = logs.filter((l) => l.eventName === "Reacted");
  const last = reactions[0] || null;
  const proven = reactions.find((l) => l.args?.viaReactivity === true) || null;

  const strong = fb === false;

  return el(
    "section",
    { class: ["panel", "panel-claim", strong ? "claim-strong" : "claim-weak"] },
    el(
      "div",
      { class: "panel-head" },
      el("h2", { text: "What this run claims" }),
      el("span", {
        class: ["pill", strong ? "pill-ok" : "pill-warn"],
        text: fb == null ? "fallback unknown" : fb ? "fallback enabled" : "fallback disabled",
      }),
    ),

    el(
      "p",
      { class: "claim-line" },
      strong
        ? frag("Licensed: ", el("q", { text: "no keeper anywhere in the causal chain" }), ".")
        : frag("Licensed: ", el("q", { text: "selection is on-chain and atomic with redemption" }), "."),
    ),
    el(
      "p",
      { class: "claim-line claim-not" },
      strong
        ? frag(
            "Earned by ",
            el("code", { text: "disableFallback()" }),
            " after ",
            el("code", { text: "npm run prove" }),
            " passed.",
          )
        : frag(
            "NOT claimed: ",
            el("q", { text: "no keeper anywhere in the causal chain" }),
            ". While ",
            el("code", { text: "fallbackEnabled" }),
            " is true a keeper may still poke selection, so the stronger sentence is not ours to say.",
          ),
    ),

    el(
      "div",
      { class: "claim-evidence" },
      last
        ? frag(
            field(
              "last reaction",
              frag(
                link(blockUrl(last.blockNumber), `block ${last.blockNumber}`, { class: "mono" }),
                " ",
                el("span", {
                  class: last.args?.viaReactivity ? "ok" : "warn",
                  text: last.args?.viaReactivity ? "via reactivity precompile" : "via fallback (keeper)",
                }),
              ),
            ),
            proven
              ? field(
                  "precompile proven",
                  link(blockUrl(proven.blockNumber), `block ${proven.blockNumber}`, { class: "mono" }),
                )
              : field("precompile proven", "not in the scanned range"),
          )
        : field("last reaction", "none in the scanned range"),
    ),
  );
}

/*//////////////////////////////////////////////////////////////
                          POPULATION GRID
//////////////////////////////////////////////////////////////*/

/**
 *  Two populations, not one list with the dead sorted to the back.
 *
 *  `dead ? 1 : -1` was the whole of how a death was expressed on this page, and a sort key cannot
 *  bound where its output lands: the grid starts 564px down, the pitch is 165px, so the tail of a
 *  three-column flow is at y=1060 on FIRST PAINT — 60px below a 1000px fold, before any animation
 *  runs, with #3 and #5 already in it. The resting state had therefore never shown a corpse to
 *  anyone. Measured over CDP at 1600x1000, not inferred.
 *
 *  Living: treasury order rather than win rate on purpose — treasury is what actually decides
 *  survival and breeding, and a 100% win rate over two windows would otherwise sit above an organism
 *  that has survived forty.
 *
 *  Dead: most recent death first, off `deathWindow`, a snapshot field — so the band's order is the
 *  same on a cold load as on the paint where a death lands. Nothing here reads `ctx.fx` for
 *  PLACEMENT; the diff still stamps `data-fx="died"` but no longer decides where anything sits,
 *  which is the only way the fix survives GSAP being absent.
 */
export function grid(rows, cfg, ctx = {}) {
  const population = [...(rows || [])];

  const byTreasury = (a, b) => {
    const t = BigInt(b.treasury ?? 0n) - BigInt(a.treasury ?? 0n);
    return t > 0n ? 1 : t < 0n ? -1 : Number(a.id) - Number(b.id);
  };

  const isMyOrg = (o) => {
    if (!ctx.userWallet || !ctx.entrants) return false;
    const entrant = ctx.entrants.get(Number(o.id));
    return Boolean(entrant && entrant.toLowerCase() === ctx.userWallet.toLowerCase());
  };

  const allLiving = population.filter((o) => !o.dead).sort(byTreasury);
  const allDead = population
    .filter((o) => o.dead)
    .sort((a, b) => Number(b.deathWindow ?? 0) - Number(a.deathWindow ?? 0) || Number(a.id) - Number(b.id));

  const myLiving = allLiving.filter(isMyOrg);
  const myDead = allDead.filter(isMyOrg);
  const myCount = myLiving.length + myDead.length;

  const living = ctx.filterOnlyMine ? myLiving : allLiving;
  const dead = ctx.filterOnlyMine ? myDead : allDead;

  if (!population.length) {
    return el(
      "section",
      { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", { text: "Population" })),
      el("p", { class: "empty", text: "No organisms. Generation 0 has not been seeded yet." }),
    );
  }

  return el(
    "section",
    { class: "panel" },
    el(
      "div",
      { class: "panel-head" },
      // The unit is stated ONCE, here, instead of after each of twelve identical balances. An arena
      // settles in exactly one collateral token, so `TUSDC` repeated down the grid is the same
      // string twelve times — it distinguishes nothing between organisms while costing each card
      // about 40px, which is precisely the room the belief tag needs to sit beside the number.
      el(
        "div",
        { class: "panel-title-wrap" },
        el("h2", {}, "Population", cfg.tokenSymbol ? el("span", { class: "sub", text: `balances in ${cfg.tokenSymbol}` }) : null),
        ctx.userWallet && myCount > 0
          ? el(
              "div",
              { class: "grid-filter-bar" },
              el(
                "button",
                {
                  class: ["filter-tab", !ctx.filterOnlyMine && "is-active"],
                  type: "button",
                  click: () => { if (ctx.filterOnlyMine && ctx.onToggleFilter) ctx.onToggleFilter(); },
                },
                `All (${population.length})`,
              ),
              el(
                "button",
                {
                  class: ["filter-tab", "filter-tab-yours", ctx.filterOnlyMine && "is-active"],
                  type: "button",
                  click: () => { if (!ctx.filterOnlyMine && ctx.onToggleFilter) ctx.onToggleFilter(); },
                },
                `★ Yours (${myCount})`,
              ),
            )
          : null,
      ),
      el("span", {
        class: "muted",
        text: ctx.filterOnlyMine
          ? `${myLiving.length} alive · ${myCount} yours`
          : `${allLiving.length} alive · ${population.length} ever`,
      }),
    ),
    dead.length ? band(dead, cfg, ctx) : null,
    ctx.filterOnlyMine && living.length === 0 && dead.length === 0
      ? el("p", { class: "empty", text: "You have no organisms in this arena view." })
      : el(
          "div",
          { class: "grid" },
          living.map((o) => card(o, cfg, ctx)),
        ),
  );
}

/**
 *  THE CORPSE BAND.
 *
 *  A corpse is a different KIND of row, not a dimmer instance of a living one. `vitals()` forces its
 *  bar to 0, its belief tag is the literal string "dead", and it has no next window. 153px was being
 *  spent to say "this one stopped". Forty-five buys everything still true: who it was, its
 *  generation, whether it paid in, what it held when it stopped, and the window it died in — the same
 *  fact `card-foot` used to print where nobody could read it.
 *
 *  Three fit on ONE line at the top of the panel, where the fold cannot reach them.
 */
function band(dead, cfg, ctx) {
  return el(
    "div",
    { class: "tomb-band" },
    el(
      "div",
      { class: "tomb-head" },
      el("span", { text: `${dead.length} ${plural(dead.length, "death")}` }),
      el("span", { class: "tomb-note", text: "newest first · irreversible" }),
    ),
    el(
      "div",
      { class: "tomb-rows" },
      dead.map((o) => tomb(o, cfg, ctx)),
    ),
  );
}

/**
 *  One corpse, one line.
 *
 *  `.card` and `.card-dead` are kept verbatim rather than replaced by a band-specific class, because
 *  `saturate(0.15)` in `app.css` and in `motion.js`'s `died()` is the one duplicated value in this
 *  codebase and it must keep exactly ONE pair of sites to agree on. A third dead-state rule is how
 *  that drift starts, and the drift is visible as a jump.
 *
 *  The identity row is composed exactly as `card()`'s is — id, name, generation, paid-in badge — so
 *  the population's per-class counts in `smoke.mjs` do not depend on which organisms happen to be
 *  dead.
 */
function tomb(o, cfg, ctx) {
  const id = Number(o.id);
  const name = ctx.labels?.get(id);
  const selected = ctx.selected != null && Number(ctx.selected) === id;
  const dec = cfg.decimals ?? 6;
  const entrant = ctx.entrants?.get(id);
  const isMine = Boolean(ctx.userWallet && entrant && entrant.toLowerCase() === ctx.userWallet.toLowerCase());

  // The stamp, and ONLY the stamp, comes from the diff. Placement above reads `o.dead` and
  // `o.deathWindow` only, so a cold load with `ctx.fx == null` renders this same band, static and
  // complete. That is rule 3's corollary, satisfied by construction rather than by care.
  const fx = ctx.fx?.organisms?.get(id) || null;
  const prev = ctx.fx?.prev?.get(id);
  const now = o.treasury == null ? null : BigInt(o.treasury);
  // `moved` gates a LIVING card's count-up, so it requires the number to have changed. A death does
  // not: `vitals()` forces a corpse's fill to 0 whatever its treasury says, so the bar drains from
  // wherever it stood even when the balance is untouched — a starved organism can die holding the
  // same figure it held last poll. Requiring `moved` here would have made the drain depend on an
  // unrelated fact about the treasury.
  const moved = prev != null && now != null && BigInt(prev) !== now;
  const drains = fx === "died" && prev != null;

  return el(
    "article",
    {
      class: ["card", "card-dead", "card-tomb", selected && "card-selected", isMine && "card-is-mine"],
      dataset: fx ? { fx } : undefined,
      tabindex: "0",
      role: "button",
      click: ctx.onSelect ? () => ctx.onSelect(id) : null,
      keydown: ctx.onSelect
        ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              ctx.onSelect(id);
            }
          }
        : null,
    },
    el(
      "div",
      { class: "tomb-line" },
      el("span", { class: "card-id", text: `#${o.id}` }),
      name ? el("span", { class: "card-name", text: name }) : null,
      el("span", { class: "card-gen", title: "generation", text: `G${o.generation}` }),
      isMine
        ? el("span", {
            class: "card-gen card-yours",
            title: `Your organism (#${o.id}) · Died at window ${o.deathWindow}`,
            text: "★ YOURS",
          })
        : rootKind(o) === "entrant"
        ? el("span", {
            class: "card-gen card-entrant",
            title: `born at window ${o.birthWindow} with no parent — paid in through enter()`,
            text: "paid in",
          })
        : null,
      el("span", { class: "amount", text: moneyFixed(o.treasury ?? 0n, dec, 2) }),
      el("span", {
        class: "tomb-when",
        title: `died at window ${o.deathWindow} — no path anywhere clears this`,
        text: `w${o.deathWindow}`,
      }),
    ),

    // The drained bar, from the SAME call a living card makes. `died()`'s third beat tweens
    // `.vitals-fill` from `data-was` to 0% and that is the beat that reads as a death rather than as
    // an error; moving the corpse must not cost the drain its target. `vitals()` already knows a dead
    // organism's fill is 0 and stamps `data-was`, not `data-fx`, when fx === "died".
    vitals(o, cfg, drains || moved ? prev : null, fx),
  );
}

function card(o, cfg, ctx) {
  const wr = winRate(o.correctCount, o.wrongCount);
  const id = Number(o.id);
  const name = ctx.labels?.get(id);
  const selected = ctx.selected != null && Number(ctx.selected) === id;
  const entrant = ctx.entrants?.get(id);
  const isMine = Boolean(ctx.userWallet && entrant && entrant.toLowerCase() === ctx.userWallet.toLowerCase());

  // What changed about THIS organism since the last paint, if anything.
  //
  // `main.js` owns the diff — it holds the only mutable state — and this function only stamps it
  // onto the node it builds; `motion.js` reads the stamps after mount. An organism that did not
  // change carries no stamp and therefore does not animate, which is what stops a ten-second poll
  // from replaying birth and death on a page where nothing happened. Rendering stays pure: these
  // are attributes describing data, not calls into an animation library.
  const fx = ctx.fx?.organisms?.get(id) || null;
  const prev = fx === "born" ? null : ctx.fx?.prev?.get(id);
  const now = o.treasury == null ? null : BigInt(o.treasury);
  const moved = prev != null && now != null && BigInt(prev) !== now;
  // See `tomb()`: a death drains the bar from wherever it stood, and does not require the treasury
  // to have changed in the same frame.
  const drains = fx === "died" && prev != null;
  const dec = cfg.decimals ?? 6;
  const breed = breeding(o, cfg, ctx);

  return el(
    "article",
    {
      class: ["card", o.dead && "card-dead", selected && "card-selected", isMine && "card-is-mine"],
      dataset: fx ? { fx } : undefined,
      tabindex: "0",
      role: "button",
      click: ctx.onSelect ? () => ctx.onSelect(id) : null,
      keydown: ctx.onSelect
        ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              ctx.onSelect(id);
            }
          }
        : null,
    },
    el(
      "div",
      { class: "card-top" },
      el("span", { class: "card-id", text: `#${o.id}` }),
      name ? el("span", { class: "card-name", text: name }) : null,
      el("span", { class: "card-gen", title: "generation", text: `G${o.generation}` }),
      // Only entrants get a badge. Founders are the common G0 case and labelling them would be
      // noise, but a stranger who paid the ante is the whole point of a permissionless arena and
      // is otherwise invisible in a grid where every root looks alike.
      //
      // The badge reads "paid in", not "entrant", even though that is what `rootKind` calls it:
      // `detail()` already has a field labelled `entrant` holding the OWNER ADDRESS, because that
      // is the name `Prophet.entrant()` gives it. Two different meanings of one word on the same
      // screen would read as a cross-reference between them. The chain's word wins for the field
      // it names, and this badge says what actually happened instead.
      isMine
        ? el("span", {
            class: "card-gen card-yours",
            title: `Your organism (#${o.id}) · Entrant: ${entrant}`,
            text: "★ YOURS",
          })
        : rootKind(o) === "entrant"
        ? el("span", {
            class: "card-gen card-entrant",
            title: `born at window ${o.birthWindow} with no parent — paid in through enter()`,
            text: "paid in",
          })
        : null,
    ),

    // THE TAG SITS WITH THE BALANCE, not in the header above it.
    //
    // It used to close the identity row, where `.tag`'s `margin-left: auto` pushed it to the right
    // edge — and on any card whose label was long enough it wrapped to a second line instead. That
    // made the header one row tall on some cards and two on others, so the treasuries fell out of
    // alignment across the grid and the one number a viewer scans down a column of could not be
    // scanned down a column. Beside the balance it also reads better: this is what the organism
    // has, and this is what it is saying to do with it.
    el(
      "div",
      { class: "card-treasury" },
      el("span", {
        class: "amount",
        text: moneyFixed(o.treasury ?? 0n, dec, 2),
        // Both endpoints are the exact BigInt-derived strings. `motion.js` counts between them on
        // a display-only float and writes `data-fx-to` back on the final frame, so the resting
        // value on screen is never a rounded float. See the note above `grouped()` there.
        dataset:
          moved && !o.dead
            ? { fx: "treasury", fxFrom: moneyFixed(prev, dec, 2), fxTo: moneyFixed(now, dec, 2) }
            : undefined,
      }),
      o.dead ? el("span", { class: "tag tag-dead", text: "dead" }) : beliefTag(o.belief, o.thesis),
    ),

    el(
      "div",
      { class: "card-stats" },
      el("span", { title: "correct / wrong / abstain" }, `${o.correctCount}·${o.wrongCount}·${o.abstainCount}`),
      el("span", { class: "dot" }),
      el("span", { title: `${wr.decided} decided ${plural(wr.decided, "window")}`, text: wr.text }),
      el("span", { class: "dot" }),
      el("span", { title: "windows lived", text: `${o.windowsLived}w` }),
      // A STREAK IS ONLY A NUMBER IF YOU KNOW WHAT IT IS COUNTING TOWARDS. `breedStreak` is read
      // from the chain, so when it is known this reads `3/4🔥` and the card says how close the
      // organism is to a child; when discovery could not get it, it falls back to the bare count
      // rather than inventing a denominator. It stays hidden at streak 0 either way — a grid of
      // `0/4` on every card would make the bar look like the population's main event.
      Number(o.streak) > 0
        ? frag(
            el("span", { class: "dot" }),
            el("span", {
              class: ["streak", breed?.streakOk && "streak-ready"],
              title: breed
                ? `${o.streak} of ${breed.needStreak} consecutive correct calls — the streak bar for breeding`
                : "consecutive correct calls",
              text: breed ? `${o.streak}/${breed.needStreak}🔥` : `${o.streak}🔥`,
            }),
          )
        : null,
    ),

    // Metabolism is charged per settled window, so "windows of runway left" is the honest
    // way to say how close an organism is to death — more useful than the balance itself.
    o.dead
      ? el("div", { class: "card-foot", text: `died at window ${o.deathWindow}` })
      : el("div", { class: "card-foot" }, runway(o.treasury, cfg)),

    // `drains || moved` for the same reason `tomb()` uses it: a death drains the bar whatever the
    // treasury did, and `moved` alone made `data-was` depend on the balance having changed.
    vitals(o, cfg, drains || moved ? prev : null, fx),
  );
}

/**
 *  The vitals bar — how much life is left, against how much it was given.
 *
 *  `runway()` already prints the honest number: treasury ÷ metabolicCost, in windows. This draws
 *  the same quotient as a bar whose full scale is `endowment ÷ metabolicCost`, so a full bar means
 *  "this organism still has as much runway as it was born with" and a sliver means it has spent
 *  almost all of it. The denominator is read off chain config rather than chosen, which is the
 *  difference between a measurement and a decorative gauge with an invented maximum.
 *
 *  It is here because the grid is the one place a judge looks first, and twelve numbers cannot be
 *  compared at a glance while twelve bars can — this is what makes the population read as a
 *  population under pressure rather than a table of balances. Colour comes off `runway()`'s own
 *  5/20 thresholds rather than restating them, so the bar and the line above it can never disagree
 *  about whether an organism is starving.
 */
function vitals(o, cfg, prev, fx) {
  const cost = cfg.metabolicCost == null ? null : BigInt(cfg.metabolicCost);
  if (!cost || cost === 0n || cfg.endowment == null) return null;
  const born = BigInt(cfg.endowment) / cost;
  if (born === 0n) return null;

  const pct = (t) => {
    const windows = BigInt(t) / cost;
    return windows >= born ? 100 : Number((windows * 100n) / born);
  };

  const left = o.dead ? 0n : BigInt(o.treasury ?? 0n) / cost;
  const was = prev == null ? null : `${pct(prev)}%`;

  return el(
    "div",
    {
      class: "vitals",
      title: o.dead
        ? "no runway — this organism is dead"
        : `${left} of ${born} ${plural(born, "window")} of metabolism left`,
    },
    el("div", {
      class: ["vitals-fill", left < 5n ? "bad" : left < 20n ? "warn" : null],
      style: { width: `${o.dead ? 0 : pct(o.treasury ?? 0n)}%` },
      // Three cases, and only one of them animates on its own. A death drains the bar as part of
      // the death timeline (`data-was` is read there, and is deliberately not a `data-fx` so the
      // generic handler does not also claim it); a live balance change slides the bar; a birth
      // animates as a whole card and needs no separate stamp.
      dataset:
        was == null
          ? undefined
          : fx === "died"
            ? { was }
            : fx == null
              ? { fx: "vitals", fxFrom: was }
              : undefined,
    }),
  );
}

function runway(treasury, cfg) {
  const cost = cfg.metabolicCost == null ? null : BigInt(cfg.metabolicCost);
  if (!cost || cost === 0n || treasury == null) return el("span", { class: "muted", text: EM });
  const windows = BigInt(treasury) / cost;
  return el("span", {
    class: windows < 5n ? "bad" : windows < 20n ? "warn" : "muted",
    title: `treasury ÷ metabolicCost (${units(cost, cfg.decimals ?? 6, 4)})`,
    text: `${windows} ${plural(windows, "window")} of metabolism`,
  });
}

/**
 *  The severity of a treasury, on the same thresholds `runway` draws with — derived from it rather
 *  than duplicated, so the card and the detail pane can never disagree about whether an organism is
 *  starving. Returns undefined when there is nothing to say, which `field()` treats as no tone.
 */
function runwayTone(treasury, cfg) {
  const cost = cfg.metabolicCost == null ? null : BigInt(cfg.metabolicCost);
  if (!cost || cost === 0n || treasury == null) return undefined;
  const windows = BigInt(treasury) / cost;
  return windows < 5n ? "bad" : windows < 20n ? "warn" : undefined;
}

/**
 *  `_breedThreshold()` (`Population.sol:1875`): `endowment + endowment * breedSurplusBps / 10_000`.
 *
 *  One function so the detail pane and the wiring panel cannot print two different thresholds — the
 *  same reason `runwayTone` is derived from `runway`'s bands instead of repeating them. Returns null
 *  when either constant is missing; every caller renders a dash rather than a default.
 */
function breedThreshold(cfg) {
  if (cfg.endowment == null || cfg.breedSurplusBps == null) return null;
  const endowment = BigInt(cfg.endowment);
  return endowment + (endowment * BigInt(cfg.breedSurplusBps)) / 10_000n;
}

/**
 *  How close an organism is to reproducing — the other end of the same story `runway()` tells.
 *
 *  `Population.sol:1843` gates reproduction on TWO bars at once, `streak() >= breedStreak` AND
 *  `treasury() >= _breedThreshold()`, and `_breedThreshold()` (`:1520`) is
 *  `endowment + endowment * breedSurplusBps / 10_000`. Both constants are `setEconomics` values that
 *  `discover()` reads once, and until this existed the page rendered `streak` as a bare number: a 3
 *  with no scale, on a page whose headline metric is generation. An organism one correct call from
 *  a child looked exactly like one that had just started counting.
 *
 *  IT RETURNS null RATHER THAN A GUESS. If either constant is missing — a failed discovery call, an
 *  older deployment — the caller omits the row entirely. A default substituted here would render as
 *  a reading, and a reader has no way to tell the two apart; a missing row is at least honest about
 *  being missing. Dead organisms return null for the same reason: `alive` gates every transition, so
 *  a corpse's streak is a fossil, not progress.
 */
function breeding(row, cfg, ctx = {}) {
  if (!row || row.dead) return null;

  const needStreak = cfg.breedStreak == null ? null : Number(cfg.breedStreak);
  const need = breedThreshold(cfg);
  if (needStreak == null || !Number.isFinite(needStreak) || need == null) return null;

  const streak = Number(row.streak ?? 0);
  const treasury = row.treasury == null ? 0n : BigInt(row.treasury);

  // The third gate, and the reason the summary hedges instead of promising a child: `hatchAll`
  // BREAKS at the cap (`:1347`), so a population at `maxPopulation` leaves an organism that has
  // cleared both bars with nowhere to put the child it earned. `living` is threaded through `ctx`
  // for the same reason `depth` is — it belongs to the live state, not to the discovered config,
  // and deriving it separately in two renderers is how two numbers that agree today disagree later.
  const cap = cfg.maxPopulation == null ? null : Number(cfg.maxPopulation);
  const living = ctx.living == null ? null : Number(ctx.living);
  const full = cap != null && living != null && living >= cap;

  return {
    needStreak,
    need,
    streak,
    short: need > treasury ? need - treasury : 0n,
    streakOk: streak >= needStreak,
    treasuryOk: treasury >= need,
    ready: streak >= needStreak && treasury >= need,
    full,
  };
}

/**
 *  The same reading as a sentence. Deliberately says what is MISSING rather than a percentage:
 *  "needs 2 more in a row" is actionable and a 67% is not, and the two bars are different units
 *  that no single bar could honestly combine.
 */
function breedingSummary(b, cfg) {
  if (b.ready) {
    return b.full
      ? "clears both bars, but the arena is full"
      : "clears both bars — a mutation is requested at the next settlement";
  }
  const wants = [];
  if (!b.streakOk) {
    const n = b.needStreak - b.streak;
    wants.push(`${n} more correct in a row`);
  }
  if (!b.treasuryOk) wants.push(`${money2(b.short, cfg)} more`);
  return `needs ${wants.join(" and ")}`;
}

/*//////////////////////////////////////////////////////////////
                          ORGANISM DETAIL
//////////////////////////////////////////////////////////////*/
/**
 *  Where an organism came from.
 *
 *  `parentId 0` is NOT one thing. Both `spawnGenesis` (Population.sol:585) and the permissionless
 *  `enter` (Population.sol:759) spawn with `parentId 0, generation 0`, so a stranger who paid the ante is
 *  structurally a root, indistinguishable from a founder except by `birthWindow`. Printing
 *  "none (root)" for both would erase the single most interesting fact this page can show about a
 *  permissionless arena: that somebody outside the operator bought in and is being selected over.
 *
 *  The founder/entrant split is a heuristic — `lineage.rootKind` says so, and so does the tooltip
 *  here, because a founder minted after the first window would read as an entrant. The claim is
 *  hedged in the UI rather than in a comment nobody sees.
 *
 *  It renders as "paid in" rather than "entrant" on purpose: `detail()` also shows an `entrant`
 *  field, which is the owner ADDRESS off `Prophet.entrant()`. Both words on one pane would look
 *  like one pointing at the other. See the matching note on the card badge.
 */
function parentField(row, ctx) {
  const kind = rootKind(row);
  if (kind === "child") return chip(row.parentId, ctx);
  if (kind === "founder") {
    return el("span", { title: "parentId 0 and birthWindow 0 — minted by spawnGenesis before the first window." }, "none · founder");
  }
  return el(
    "span",
    { title: `parentId 0 but born at window ${row.birthWindow} — inferred to have paid in through enter().` },
    "none · paid in",
  );
}

/**
 *  One organism, in full: the genome verbatim, the last reasoning verbatim, and the position.
 *
 *  Both strings are rendered as-typed, with no truncation and no markdown. The genome IS the
 *  organism — paraphrasing it, or cutting it at 200 characters, would hide the only thing that
 *  distinguishes one row of this population from another.
 */
export function detail(row, info, cfg, ctx = {}) {
  if (!row) {
    // THE PANE BEFORE ANYTHING IS SELECTED.
    //
    // On first load this panel sits beside the population, which makes it the second thing on the
    // page a stranger looks at — and it used to hold one italic sentence in a box, which read as a
    // gap in the layout rather than as an invitation. It now spends that space on the one concept
    // the grid cannot show. A card can show a balance, a record and a bar; it cannot show that the
    // organism IS a sentence, which is the whole idea and the reason `generation` is the headline
    // metric instead of PnL. Nothing here is a feature — it is the copy this pane needed.
    return el(
      "aside",
      { class: "panel panel-detail detail-invite" },
      el("div", { class: "panel-head" }, el("h2", { text: "Genome" })),
      el("p", {
        text:
          "Every organism is one English sentence — a trading thesis, stored on chain as a string. " +
          "That sentence is the entire strategy. Nothing else tells one organism from another.",
      }),
      el("p", {
        text:
          "Thinking costs it real value every window, and a child inherits the sentence mutated. " +
          "What survives a season is a sentence that kept paying for its own thinking.",
      }),
      el("p", { class: "empty", text: "Pick an organism to read its genome, its last reasoning and its open position." }),
    );
  }

  const name = ctx.labels?.get(Number(row.id));
  const wr = winRate(row.correctCount, row.wrongCount);
  const breed = breeding(row, cfg, ctx);
  const pending = info && (BigInt(info.pendingBeliefRequestId ?? 0n) > 0n || BigInt(info.pendingMutationRequestId ?? 0n) > 0n);

  const entrant = info?.entrant || ctx.entrants?.get(Number(row.id));
  const isMine = Boolean(ctx.userWallet && entrant && entrant.toLowerCase() === ctx.userWallet.toLowerCase());

  return el(
    "aside",
    { class: "panel panel-detail" },
    el(
      "div",
      { class: "panel-head" },
      el("h2", {}, `Organism #${row.id}`, name ? el("span", { class: "sub", text: name }) : null),
      ctx.onClose ? el("button", { class: "btn btn-ghost", type: "button", click: ctx.onClose }, "close") : null,
    ),
    isMine
      ? el(
          "div",
          { class: "detail-yours-banner" },
          el("span", { class: "yours-star", text: "★" }),
          el("span", { class: "yours-text", text: " YOUR ORGANISM " }),
          el("span", { class: "muted sub", text: "— Funded by your tracked wallet" }),
        )
      : null,

    el(
      "div",
      { class: "detail-fields" },
      field("generation", `G${row.generation}`),
      field("parent", parentField(row, ctx)),
      field("treasury", money2(row.treasury, cfg), { tone: row.dead ? undefined : runwayTone(row.treasury, cfg) }),
      field("state", row.dead ? `dead at window ${row.deathWindow}` : `alive since window ${row.birthWindow}`, {
        tone: row.dead ? "bad" : "ok",
      }),
      field("belief", beliefTag(row.belief, row.thesis)),
      field("record", `${row.correctCount}W / ${row.wrongCount}L / ${row.abstainCount}A · ${wr.text}`),
      field("streak", breed ? `${row.streak} / ${breed.needStreak}` : String(row.streak), {
        tone: breed?.streakOk ? "ok" : undefined,
        title: breed ? "consecutive correct calls, against the streak bar for breeding" : undefined,
      }),
      // THE OTHER END OF THE STORY `runway` TELLS. Metabolism says how many windows an organism has
      // left; this says what it still owes to earn a child. Both bars come off the chain
      // (`breedStreak`, `breedSurplusBps`), so the row is omitted entirely — never guessed — when
      // discovery could not read them, and never shown for a corpse.
      breed
        ? field("breeding", breedingSummary(breed, cfg), {
            tone: breed.ready && !breed.full ? "ok" : undefined,
            title: `streak >= ${breed.needStreak} and treasury >= ${money2(breed.need, cfg)} (Population.sol:1843)`,
          })
        : null,
      field("windows lived", String(row.windowsLived)),
      field("address", link(addressUrl(row.addr), addr(row.addr, 10, 8), { class: "mono", title: row.addr })),
      field("genome hash", el("span", { class: "mono", title: row.genomeHash, text: hash(row.genomeHash, 10, 8) })),
      info?.entrant
        ? field(
            "entrant",
            info.entrant === ZERO
              ? "none"
              : link(addressUrl(info.entrant), addr(info.entrant), { class: "mono", title: info.entrant }),
          )
        : null,
    ),

    info?.positionOpen
      ? el(
          "div",
          { class: "position" },
          el("h3", { text: "Open position" }),
          el(
            "div",
            { class: "detail-fields" },
            // Two different numbers, and conflating them is a real bug the contracts warn
            // about: a paired position is funded by both sides, so each HOLDS `quantity`
            // tokens while having RISKED `stake`.
            field("staked", money2(info.currentStake, cfg), { title: "collateral at risk" }),
            field("holding", money2(info.currentQuantity, cfg), { title: "outcome tokens held" }),
            field("market", el("span", { class: "mono", text: hash(info.currentMarketId, 10, 6) })),
          ),
        )
      : null,

    pending
      ? el(
          "p",
          { class: "note" },
          "Inference in flight — ",
          el("code", { text: `belief #${info.pendingBeliefRequestId} / mutation #${info.pendingMutationRequestId}` }),
        )
      : null,

    el(
      "div",
      { class: "prose" },
      el("h3", { text: "Genome" }),
      info == null
        ? el("p", { class: "muted", text: "loading…" })
        : info.systemPrompt
          ? el("blockquote", { class: "genome", text: info.systemPrompt })
          : el("p", { class: "muted", text: info.errors?.systemPrompt || "empty" }),
    ),

    el(
      "div",
      { class: "prose" },
      el("h3", {}, "Last reasoning", el("span", { class: "sub", text: "verbatim, on-chain" })),
      info == null
        ? el("p", { class: "muted", text: "loading…" })
        : info.lastReasoning
          ? el("blockquote", { class: "reasoning", text: info.lastReasoning })
          : el("p", { class: "muted", text: info.errors?.lastReasoning || "has not spoken yet" }),
    ),
  );
}

/*//////////////////////////////////////////////////////////////
                           LINEAGE TREE
//////////////////////////////////////////////////////////////*/

const COL = 190;
const ROW = 32;
const PAD_X = 32;
const PAD_TOP = 42;
const PAD_BOTTOM = 24;
const R = 7;

/**
 *  The dendrogram. Generation is the x axis, so descent reads left to right and a long lineage
 *  is visibly a long branch — which is the point, since generation and not PnL is the headline
 *  metric.
 */
export function tree(t, cfg, ctx = {}) {
  if (!t || !t.nodes.length) {
    return el(
      "section",
      { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", { text: "Lineage" })),
      el("p", { class: "empty", text: "No lineage yet — nothing has bred." }),
    );
  }

  // Display at least 4 generations (G0 to G3) so the generational grid is clearly readable as a timeline
  // even when all current organisms are at generation 0 before breeding begins.
  const displayGens = Math.max(t.generations, 3);
  const width = Math.max(PAD_X * 2 + (displayGens + 1) * COL, 820);
  const height = PAD_TOP + Math.max(t.rows - 1, 0) * ROW + PAD_BOTTOM;
  const x = (n) => PAD_X + n.generation * COL;
  const y = (n) => PAD_TOP + n.row * ROW;

  const canvas = svg("svg", {
    class: "tree",
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": "lineage tree",
  });

  // Top header rule separating generation labels from tree nodes
  canvas.appendChild(
    svg("line", {
      class: "tree-header-line",
      x1: PAD_X - 16,
      y1: 26,
      x2: width - PAD_X + 16,
      y2: 26,
    }),
  );

  // Generation column headers and column divider guides
  for (let g = 0; g <= displayGens; g += 1) {
    const gx = PAD_X + g * COL;

    // Column header label at top
    canvas.appendChild(
      svg(
        "text",
        {
          class: "tree-gen",
          x: gx - R,
          y: 18,
          "text-anchor": "start",
        },
        g === 0 ? "G0 · FOUNDERS" : `G${g}`,
      ),
    );

    // Subtle vertical column divider between generations (does not cut through nodes)
    if (g < displayGens) {
      const divX = gx + COL - 24;
      canvas.appendChild(
        svg("line", {
          class: "tree-divider",
          x1: divX,
          y1: 8,
          x2: divX,
          y2: height - 8,
        }),
      );
    }
  }

  // Draw parent -> child lineage edges with smooth curves that depart after the parent's label
  // so the connecting branch line never cuts across the organism's name.
  for (const e of t.edges) {
    const a = t.byId.get(e.from);
    const b = t.byId.get(e.to);
    if (!a || !b) continue;

    const aName = ctx.labels?.get(a.id);
    const aLabel = `#${a.id}${aName ? ` ${aName}` : ""}`;
    const aTextW = Math.round(aLabel.length * 6.5);
    const startX = x(a) + R + 7 + aTextW + 8;
    const endX = x(b) - R - 1;
    const startY = y(a);
    const endY = y(b);

    const span = Math.max(endX - startX, 20);
    const cp1x = startX + span * 0.5;
    const cp2x = endX - span * 0.5;

    canvas.appendChild(
      svg("path", {
        class: ["tree-edge", e.dead && "is-dead"].filter(Boolean).join(" "),
        d: `M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${endY}, ${endX} ${endY}`,
        // An edge into an organism born since the last paint draws itself, parent to child. Set as
        // a raw attribute because `svg()` takes no `dataset` — SVG elements still expose `.dataset`
        // to `motion.js` on the reading side.
        "data-fx": ctx.fx?.organisms?.get(e.to) === "born" ? "edge" : null,
      }),
    );
  }

  // Draw organism nodes
  for (const n of t.nodes) {
    const name = ctx.labels?.get(n.id);
    const selected = ctx.selected != null && Number(ctx.selected) === n.id;
    const g = svg("g", {
      class: ["tree-node", n.dead && "is-dead", selected && "is-selected"].filter(Boolean).join(" "),
      tabindex: "0",
      role: "button",
      "aria-label": `organism ${n.id}`,
      click: ctx.onSelect ? () => ctx.onSelect(n.id) : null,
      keydown: ctx.onSelect
        ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              ctx.onSelect(n.id);
            }
          }
        : null,
    });
    g.appendChild(
      svg("circle", {
        class: `belief-${idx(BELIEF_TONE, n.belief, "none")}`,
        cx: x(n),
        cy: y(n),
        r: n.dead ? R - 2 : R,
      }),
    );
    g.appendChild(svg("title", {}, `#${n.id}${name ? ` ${name}` : ""} · G${n.generation} · ${idx(THESIS, n.thesis)}`));
    g.appendChild(
      svg("text", { class: "tree-label", x: x(n) + R + 7, y: y(n) + 4 }, `#${n.id}${name ? ` ${name}` : ""}`),
    );
    canvas.appendChild(g);
  }

  const hasEdges = t.edges.length > 0;
  const genCount = t.generations + 1;
  const genText = `${genCount} ${genCount === 1 ? "generation" : "generations"}`;

  return el(
    "section",
    { class: "panel" },
    el(
      "div",
      { class: "panel-head" },
      el("h2", { text: "Lineage" }),
      el("span", {
        class: "muted",
        text: !hasEdges && t.generations === 0
          ? `${t.nodes.length} organisms · Generation 0 (awaiting breeding)`
          : `${t.nodes.length} organisms · ${genText}`,
      }),
    ),
    el("div", { class: "tree-scroll" }, canvas),
    el(
      "p",
      { class: "legend" },
      el("span", { class: "swatch belief-up" }),
      " up ",
      el("span", { class: "swatch belief-down" }),
      " down ",
      el("span", { class: "swatch belief-abstain" }),
      " abstain ",
      el("span", { class: "swatch belief-none" }),
      " silent · small ring = dead",
      !hasEdges
        ? el("span", {
            class: "tree-note",
            text: "· Branches form as organisms breed (4 consecutive correct calls + 15 tUSDC)",
          })
        : null,
    ),
  );
}

/**
 *  Per-generation census. The drift this shows — generation 2 all Momentum where generation 0
 *  was evenly split — is the "selection over ideas" claim made visible without an indexer.
 */
export function censusPanel(rows, depth) {
  if (!rows?.length) return null;
  return el(
    "section",
    { class: "panel" },
    el(
      "div",
      { class: "panel-head" },
      el("h2", { text: "Generations" }),
      el("span", { class: "muted", text: `deepest living line: G${depth?.living ?? 0} of G${depth?.ever ?? 0} ever` }),
    ),
    el(
      "table",
      { class: "census" },
      el(
        "thead",
        {},
        el("tr", {}, el("th", { text: "gen" }), el("th", { text: "alive" }), el("th", { text: "dead" }), el("th", { text: "living theses" })),
      ),
      el(
        "tbody",
        {},
        rows.map((r) =>
          el(
            "tr",
            {},
            el("td", { text: `G${r.generation}` }),
            el("td", { text: String(r.alive) }),
            el("td", { class: "muted", text: String(r.dead) }),
            el(
              "td",
              {},
              [...r.theses.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([th, n]) => el("span", { class: "thesis-pill" }, `${idx(THESIS, th)} ${n}`)),
            ),
          ),
        ),
      ),
    ),
  );
}

/*//////////////////////////////////////////////////////////////
                              FEED
//////////////////////////////////////////////////////////////*/

/**
 *  One summariser per event. The table is keyed by the exact `eventName` viem decodes, and
 *  anything not listed falls through to `generic`, which prints the args by name — so an event
 *  added to a contract later shows up as a readable row instead of vanishing from the feed.
 */
/**
 *  `ReactionFailed.reason` → something a reader can act on.
 *
 *  The row used to be `[span.bad "reaction failed"]` and nothing else: both arguments the event
 *  carries were thrown away, and the most diagnostic log this system emits rendered as the least
 *  informative line on the page. On a SHARED settlement singleton it fires once per stranger's
 *  market — so the published feed was seven identical red rows deep and a user read the whole
 *  dashboard as "puro error".
 *
 *  Two verdicts, and they are opposites:
 *
 *   · A DECLINE (`NoCommittedWindow`, `MarketUnreadable`, `MarketNotDecided`) is the cross-talk
 *     guard working. The trigger is unauthenticated — anyone's finalization pulls that lever — so
 *     the engine deciding for itself that the pull meant nothing is the correct outcome, not a
 *     failure. It gets the muted tone the fact deserves.
 *
 *   · Anything else came back from `try population.settleAll()` and therefore proves the engine
 *     did NOT decline: it called in and was refused. That is a real finding and stays amber.
 *
 *  An unrecognised selector still renders — its four bytes, verbatim. A row that says
 *  `0x1234abcd` sends a reader to `cast 4byte`; a row that says "reaction failed" sends them
 *  nowhere, which is how a missing guard sat unnoticed on chain for a whole deploy.
 *
 *  THE DECODE IS NOT HERE, and that is load-bearing rather than tidy. Reading revert data needs
 *  viem plus an error ABI, and importing either into this file makes esm.sh a dependency of
 *  loading the page — it broke `?demo=1` offline and stopped `npm test --prefix web` from
 *  loading at all. `chain.js:annotateReactions` decodes at ingest and hands down
 *  `args.decoded`; this function only formats it, so the whole renderer stays reachable with no
 *  network. A row with no `decoded` is not an error: it takes the undecodable branch, which is
 *  the honest reading of "nobody decoded this".
 */
function reactionCall(d) {
  // Tolerates a bare string per argument as well as `{type, value}` — the fixture writes
  // display values directly and has no ABI to carry types with.
  const args = (d.args ?? []).map((a) => {
    if (a && typeof a === "object") {
      if (a.type === "address") return addr(a.value);
      if (typeof a.type === "string" && a.type.startsWith("bytes")) return hash(a.value);
      return String(a.value);
    }
    return String(a);
  });
  return args.length ? `${d.name}(${args.join(", ")})` : d.name;
}

/** The first four bytes of revert data, or `0x` when there are not four bytes to show. */
function selectorOf(reason) {
  return typeof reason === "string" && reason.length >= 10 ? reason.slice(0, 10) : "0x";
}

const SUMMARY = {
  // `openPrice` here is scaled by the PRICE source's decimals, not the collateral's, and the
  // discovered config only knows the latter. `ctx.priceDecimals` is threaded in from the live
  // window for exactly this reason — reusing `cfg.decimals` would render BTC off by a factor
  // of a hundred and look entirely plausible doing it.
  WindowOpened: (a, cfg, ctx) => [
    `window ${a.window} opened at `,
    el("span", { class: "mono", text: money(a.openPrice, ctx.priceDecimals ?? 6, 2) }),
  ],
  WindowClosed: (a) => [`window ${a.window} closed · ${a.aliveCount} alive`],
  Spawned: (a, cfg, ctx) => [
    Number(a.parentId) === 0 ? "root " : "child ",
    chip(a.prophetId, ctx),
    Number(a.parentId) === 0 ? ` born at G${a.generation}` : [" born from ", chip(a.parentId, ctx), ` at G${a.generation}`],
  ],
  Paired: (a, cfg, ctx) => [
    chip(a.upId, ctx),
    " up vs ",
    chip(a.downId, ctx),
    " down for ",
    money2(a.amount, cfg),
  ],
  Reaped: (a, cfg, ctx) => [chip(a.prophetId, ctx), ` reaped at window ${a.window} · ${a.aliveRemaining} left`],
  Retired: (a, cfg, ctx) => [
    chip(a.prophetId, ctx),
    " retired · ",
    money2(a.collateralReturned, cfg),
    " and ",
    `${stt(a.cognitionReturned)} STT returned`,
  ],
  ResidueForfeited: (a, cfg, ctx) => [chip(a.prophetId, ctx), " forfeited ", money2(a.amount, cfg)],
  SeasonEnded: (a, cfg) => [`season ${a.season} ended · pot ${money2(a.pot, cfg)} · paid ${money2(a.paid, cfg)}`],
  SeasonPrizePaid: (a, cfg, ctx) => [chip(a.prophetId, ctx), " won ", money2(a.amount, cfg), ` in season ${a.season}`],
  CognitionFunded: (a, cfg, ctx) => [chip(a.prophetId, ctx), ` funded with ${stt(a.amount)} STT`],
  CognitionUnspent: (a, cfg, ctx) => [chip(a.prophetId, ctx), ` left ${stt(a.amount)} STT unspent`],
  BreedingRequested: (a, cfg, ctx) => [chip(a.parentId, ctx), " requested a mutation"],
  BreedingUnaffordable: (a, cfg, ctx) => [chip(a.prophetId, ctx), " could not afford to breed"],
  ThinkFailed: (a, cfg, ctx) => [chip(a.prophetId, ctx), " failed to think"],
  CommitFailed: (a, cfg, ctx) => [chip(a.prophetId, ctx), " failed to commit"],
  SettleFailed: (a, cfg, ctx) => [chip(a.prophetId, ctx), " failed to settle"],

  Born: (a, cfg, ctx) => [chip(a.prophetId, ctx), ` born at G${a.generation}`],
  Thinking: (a, cfg, ctx) => [chip(a.prophetId, ctx), ` is thinking (request ${a.requestId})`],
  // The one event that carries the attestation set. The validator count is the whole claim
  // that a language model ran on chain with consensus, so it is shown, not hidden.
  Believed: (a, cfg, ctx) => [
    chip(a.prophetId, ctx),
    " believes ",
    beliefTag(a.belief, a.thesis),
    a.validators?.length
      ? el("span", {
          class: "muted",
          title: (a.validators || []).join("\n"),
          text: ` ${a.validators.length} ${plural(a.validators.length, "validator")}`,
        })
      : null,
    a.reasoning ? el("blockquote", { class: "feed-reasoning", text: a.reasoning }) : null,
  ],
  Committed: (a, cfg, ctx) => [
    chip(a.prophetId, ctx),
    " committed ",
    money2(a.stake, cfg),
    " for ",
    money2(a.quantity, cfg),
    " of outcome ",
    el("span", { class: "mono", text: String(a.outcomeId).slice(0, 12) + "…" }),
  ],
  // `Settled.correct` IS NOT THE FORECAST GRADE, despite its name. `Prophet.sol:444` assigns it
  // `won = collateralOut > staked` and emits that at `:520` — a statement about money. The grade is
  // three-valued and lives elsewhere in the same function (`:474-495`): `quantity == 0` or a belief
  // of `Abstain`/`None` increments `abstainCount`, a real loss increments `wrongCount`, and a voided
  // duel that refunds both antes (`collateralOut == staked`) increments NOTHING at all. All three
  // arrive here as `correct: false`, and the event carries neither `quantity` nor `belief`, so this
  // row cannot tell them apart and must not pretend to.
  //
  // It used to print red "wrong" for all three. That contradicted the organism's own W/L/A record on
  // the card beside it — and abstaining is ordinary by design, not an edge case: an organism that
  // cannot afford its inference deposit abstains, and a non-`Success` inference collapses to
  // `Abstain` rather than reverting. So the false branch says only what the flag licenses, in amber
  // rather than the red that would assert a wrong call, and names the record as the authority.
  Settled: (a, cfg, ctx) => [
    chip(a.prophetId, ctx),
    a.correct
      ? el("span", { class: "ok", text: " correct" })
      : el("span", {
          class: "warn",
          text: " no win",
          title:
            "Settled.correct is collateralOut > staked (Prophet.sol:444), not the forecast grade. " +
            "A loss, an abstain and a voided duel are indistinguishable in this event — the " +
            "organism's correct/wrong/abstain record is the authority.",
        }),
    " · out ",
    money2(a.collateralOut, cfg),
    " · treasury ",
    money2(a.treasury, cfg),
  ],
  Starved: (a, cfg, ctx) => [
    chip(a.prophetId, ctx),
    " starved · needed ",
    money2(a.metabolicCost, cfg),
    " had ",
    money2(a.treasury, cfg),
  ],
  Raked: (a, cfg, ctx) => [chip(a.prophetId, ctx), " paid ", money2(a.amount, cfg), " rake on ", money2(a.profit, cfg)],
  Died: (a, cfg, ctx) => [
    chip(a.prophetId, ctx),
    ` died at window ${a.window} after ${a.windowsLived} ${plural(a.windowsLived, "window")} · ${a.correct}W/${a.wrong}L`,
  ],

  Reacted: (a) => [
    "selection reacted ",
    a.viaReactivity
      ? el("span", { class: "ok", text: "via the reactivity precompile" })
      : el("span", { class: "warn", text: "via the fallback keeper" }),
    ` at window ${a.window}`,
  ],
  ReactionFailed: (a) => {
    const why = a?.decoded ?? null;
    const call = why?.name ? reactionCall(why) : null;

    if (why?.declined) {
      return [
        el("span", { class: "muted", text: "selection declined" }),
        " — not this population's window · ",
        el("span", { class: "mono", text: call }),
      ];
    }
    if (why?.name) {
      return [
        el("span", { class: "warn", text: "selection was refused" }),
        " by Population · ",
        el("span", { class: "mono", text: call }),
      ];
    }
    return [
      el("span", { class: "warn", text: "reaction failed" }),
      " · undecodable reason ",
      // `why.selector` when the decoder looked and failed; the raw `reason`'s own first four bytes
      // when nothing decoded it at all. Those two cases print the same thing because the reader
      // wants the same thing from both — the selector to paste into `cast 4byte`. Falling back to
      // a bare "0x" here threw away bytes the event had actually carried.
      el("span", { class: "mono", text: why?.selector ?? selectorOf(a?.reason) }),
    ];
  },
};

function generic(args) {
  const parts = Object.entries(args || {})
    .filter(([k]) => Number.isNaN(Number(k)))
    .map(([k, v]) => `${k}=${typeof v === "bigint" ? v.toString() : String(v)}`);
  return [el("span", { class: "muted", text: parts.join(" · ") || "no arguments" })];
}

const SEVERITY = {
  Died: "bad",
  Starved: "warn",
  Reaped: "bad",
  ThinkFailed: "warn",
  CommitFailed: "warn",
  SettleFailed: "warn",
  /*
   *  A FUNCTION, because this one event means two opposite things and a constant had to pick the
   *  wrong one. It was `"bad"`, which painted the cross-talk guard declining a stranger's market —
   *  the mechanism working exactly as designed, once a minute, forever — in the same red as an
   *  organism dying. `null` is not "unknown": it is the deliberate absence of a severity class, so
   *  a decline gets the feed's ordinary row and nothing louder.
   */
  ReactionFailed: (a) => (a?.decoded?.declined ? null : "warn"),
  BreedingUnaffordable: "warn",
  Spawned: "good",
  Born: "good",
  SeasonPrizePaid: "good",
};

/** `SEVERITY` holds constants and predicates; callers must not care which. */
function severityOf(eventName, args) {
  const s = SEVERITY[eventName];
  return typeof s === "function" ? s(args) : s;
}

/**
 *  Consecutive identical reactions become one row with a count.
 *
 *  Only `ReactionFailed`, and only runs that are byte-identical in both `emitter` and `reason`.
 *  Nothing else in this feed may ever be collapsed: two `Settled` rows that look alike are two
 *  organisms being graded, and folding them would hide the population. But a shared settlement
 *  singleton produces the SAME decline over and over — 61 of them across 12,000 blocks on the
 *  published site, seven deep on first paint — and sixty-one copies of one fact is not sixty-one
 *  facts. It is one fact and a frequency.
 *
 *  `firstIndex` is the group's position in the ORIGINAL array, and it is what gets handed to
 *  `feedRow`, so `ctx.fx.newRows` keeps meaning exactly what it meant before grouping existed:
 *  the first N rows of a newest-first append-only list. Grouping must not be able to move the
 *  entrance animation onto a row that was already on screen.
 */
function reactionKey(l) {
  if (l.eventName !== "ReactionFailed") return null;
  const a = l.args || {};
  return `${String(a.emitter).toLowerCase()}|${String(a.reason)}`;
}

function collapse(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const key = reactionKey(rows[i]);
    const last = out[out.length - 1];
    if (key && last && last.key === key) {
      last.count += 1;
      last.oldest = rows[i];
      continue;
    }
    out.push({ log: rows[i], key, count: 1, firstIndex: i, oldest: rows[i] });
  }
  return out;
}

export function feed(logs, cfg, ctx = {}) {
  const rows = logs || [];
  if (!rows.length) {
    return el(
      "section",
      { class: "panel" },
      el("div", { class: "panel-head" }, el("h2", { text: "Feed" })),
      el("p", { class: "empty", text: "No events in the scanned range." }),
    );
  }

  // Bounded by the same constant that bounds timestamp fetching in main.js, so every row shown
  // is a row whose block time was actually read. See FEED_ROWS in config.js.
  //
  // The bound is applied to the ORIGINAL index, not to the group count: collapsing must not pull a
  // row in from beyond the stamped window and print `#483224186` where every neighbour says "2s
  // ago". The set of logs on screen is the same [0, bound) it always was — grouped, not extended.
  const bound = ctx.limit ?? FEED_ROWS;
  const groups = collapse(rows).filter((g) => g.firstIndex < bound);
  const covered = groups.reduce((n, g) => n + g.count, 0);

  return el(
    "section",
    { class: "panel panel-feed" },
    el(
      "div",
      { class: "panel-head" },
      el("h2", { text: "Feed" }),
      el("span", {
        class: "muted",
        text: ctx.range ? `${rows.length} events over ${ctx.range} blocks` : `${rows.length} events`,
      }),
    ),
    el("ol", { class: "feed" }, groups.map((g) => feedRow(g.log, cfg, ctx, g.firstIndex, g.count))),
    rows.length > covered
      ? el("p", { class: "muted", text: `${rows.length - covered} older events not shown` })
      : null,
  );
}

function feedRow(l, cfg, ctx, i = -1, repeat = 1) {
  const make = SUMMARY[l.eventName];
  const body = make ? make(l.args || {}, cfg, ctx) : generic(l.args);
  const ts = ctx.stamps?.get(String(l.blockNumber));
  const sev = severityOf(l.eventName, l.args || {});

  return el(
    "li",
    {
      class: ["feed-row", sev && `sev-${sev}`],
      // The feed is newest-first and append-only, so "the rows added since the last paint" is
      // exactly its first N — which means `main.js` can report a count and never has to key logs.
      dataset: i >= 0 && i < (ctx.fx?.newRows ?? 0) ? { fx: "new" } : undefined,
    },
    el(
      "div",
      { class: "feed-when" },
      ts ? el("span", { title: `block ${l.blockNumber}`, text: ago(ts) }) : el("span", { class: "mono", text: `#${l.blockNumber}` }),
    ),
    el(
      "div",
      { class: "feed-what" },
      el("span", { class: ["feed-name", `origin-${l.origin || "population"}`], text: l.eventName }),
      el("span", { class: "feed-body" }, body),
      // The frequency, only when there is one. `title` names the oldest block in the run so the
      // count stays checkable against the chain rather than being a number the page asserts.
      repeat > 1
        ? el("span", {
            class: "muted",
            text: ` ×${repeat}`,
            title: `${repeat} consecutive identical events in the scanned range, newest at block ${l.blockNumber}`,
          })
        : null,
    ),
    el(
      "div",
      { class: "feed-where" },
      l.transactionHash ? link(txUrl(l.transactionHash), "tx", { class: "muted" }) : null,
    ),
  );
}

/*//////////////////////////////////////////////////////////////
                           THE PRIMER
//////////////////////////////////////////////////////////////*/

/** One numbered beat of the mechanism. The number is an element, not a list marker, so it can be
 *  aligned against the claim rather than against the prose. */
function beat(n, claim, ...body) {
  return el(
    "li",
    { class: "beat" },
    el("span", { class: "beat-n", text: String(n) }),
    el(
      "div",
      { class: "beat-body" },
      el("h3", { class: "beat-claim", text: claim }),
      ...body.filter(Boolean),
    ),
  );
}

/**
 *  THE THREE FOUNDER GENOMES, OF WHICH THE FRONT DOOR NOW QUOTES ONE.
 *
 *  Every string here is a **verbatim** substring of the matching organism's `genome` in
 *  `genomes/genesis.json` — the file `script/Seed.s.sol` loads — so a reader who goes looking finds
 *  the same words on chain. That is the entire reason to quote instead of describing, and it is why
 *  `specimen()` captions each one with the filename.
 *
 *  The rules, and they are strict because the caption makes a claim on the reader's behalf:
 *
 *    - An `…` marks material removed. Every run of text BETWEEN ellipses must appear in the genome
 *      character for character, punctuation included.
 *    - A fragment must end where the genome ends a sentence. Closing an elision with a full stop
 *      where the source has a comma is the specific defect this constant was extracted to prevent:
 *      it presents a mid-sentence clause as a sentence the organism never ends there, and REVERSION
 *      and SKEPTIC both did exactly that until 2026-09-01.
 *    - Nothing is reworded, reordered, or tightened for the layout. If a quote is too long, cut a
 *      whole sentence and mark it with an `…`.
 *
 *  ALL THREE STAY, though `primer()` now renders only MOMENTUM. The rules above are asserted against
 *  `genesis.json` by `test/smoke.mjs` over this constant, not over the page, so a mis-transcribed
 *  REVERSION or SKEPTIC still fails the build while it sits unrendered. Trimming this to what the
 *  page happens to show would silently retire two thirds of that check, and the two quotes are what a
 *  second specimen would have to be built from if one is ever wanted back.
 *
 *  Exported for that reason. Note what is and is not recoverable from the DOM, because `smoke.mjs`
 *  depends on the distinction: a `blockquote.genome` holds exactly one text node, so ONE quote reads
 *  back out of it character for character. The surrounding PANEL does not — inline elements
 *  concatenate without whitespace, and `UP_MOMENTUM` contains the string `MOMENTUM`, so a
 *  whole-panel `textContent.includes(quote)` is both fragile and satisfiable by accident.
 *
 *  MOMENTUM and REVERSION are unbroken runs — no `…` at all — because each was eliding exactly one
 *  sentence, and that sentence ("Your rule is simple and you apply it without flinching." / "So you
 *  fade.") is the stance the thesis takes. That is why MOMENTUM is the one the primer shows: its
 *  elided sentence is the mechanism the five beats describe.
 */
export const FOUNDER_QUOTES = {
  MOMENTUM:
    "You believe short-horizon price moves persist. Order flow is autocorrelated over " +
    "minutes: whoever is pushing price is usually still pushing at the close of a " +
    "15-minute window. Your rule is simple and you apply it without flinching. If price " +
    "is above the window's opening level, answer UP_MOMENTUM. If below, answer DOWN_MOMENTUM.",
  REVERSION:
    "You believe short-horizon moves overshoot. Within a 15-minute window most displacement " +
    "from the opening level is liquidity being consumed, not information arriving, and thin " +
    "books overshoot before settling back. So you fade. If price is above the window's open, " +
    "answer DOWN_REVERSION, expecting the move to exhaust. If below, answer UP_REVERSION.",
  SKEPTIC:
    "Unless price has moved dramatically from the opening level and there is very little " +
    "time left for it to reverse, answer ABSTAIN. … You would rather say nothing than be " +
    "wrong, and you regard the willingness to abstain as your central discipline rather " +
    "than a weakness.",
};

/**
 *  A real founder genome, quoted. `.genome` is the same italic-serif, left-ruled treatment the
 *  detail pane gives a living organism's genome, because it is the same kind of object.
 *
 *  Pass the text from `FOUNDER_QUOTES` above, never a literal written at the call site — the
 *  constant is what `test/smoke.mjs` checks against `genomes/genesis.json`, so a quote written
 *  inline here would be a quote nothing verifies.
 */
function specimen(name, text) {
  return el(
    "figure",
    { class: "specimen" },
    el("blockquote", { class: "genome", text }),
    el(
      "figcaption",
      {},
      el("b", { class: "specimen-name", text: name }),
      " · founder genome, quoted from ",
      el("code", { text: "genomes/genesis.json" }),
    ),
  );
}

/**
 *  The frame between "we have an address" and "we have read it".
 *
 *  `boot()` resolves a population address synchronously and then awaits two round trips —
 *  `chain.connect` and `chain.discoverWithRetry` — before `app.cfg` exists. It paints once in
 *  between so the page is never blank, and until 2026-09-08 that paint fell through to
 *  `primer()` + `setupCard()`, which was wrong in two different ways at once:
 *
 *   1. It offered an address form to a visitor whose address was already correct, and then took
 *      it away mid-sentence when the reads landed. The user reported it as the arena "jumping".
 *   2. `primer()` states "Season 0 is not deployed yet" as a flat fact. With a live deploy
 *      configured that sentence is FALSE, and it was the first thing the published site said —
 *      a page denying its own 68 windows while it loaded them.
 *
 *  So a configured-but-unread page gets its own frame, and it says only what is true at that
 *  instant: which address, where the address came from, and that it is being read right now.
 *
 *  The setup card still rides underneath, collapsed. An RPC that never answers must not leave a
 *  visitor with no way to change the endpoint — but a *closed* disclosure is an affordance, not
 *  an invitation, and it does not move when discovery resolves.
 */
export function connectingCard(ctx) {
  return el(
    "section",
    { class: "panel" },
    el("div", { class: "panel-head" }, el("h2", { text: "Reading the chain" })),
    el(
      "p",
      { class: "empty" },
      "Connecting to chain ",
      el("code", { text: String(ctx.chainId) }),
      " and discovering the modules this population is wired to. Two round trips, no wallet.",
    ),
    el(
      "p",
      { class: "sub" },
      el("span", { class: "mono", text: addr(ctx.population) }),
      ctx.sourceLabel ? el("span", { class: "dot" }) : null,
      ctx.sourceLabel ? el("span", { text: ` ${ctx.sourceLabel}` }) : null,
    ),
  );
}

/**
 *  What this page is, in the fewest words that still say something true.
 *
 *  This was five prose paragraphs — roughly 750 words — and every one of them restated a beat the
 *  landing page at `/` already makes, animated, as its entire job. So the front door of the
 *  telescope was a second and worse explanation of the same system, on the surface whose job is to
 *  SHOW it. What survives is the five CLAIMS, one line each. They are assertions rather than
 *  teasers, so a reader who stops here still leaves knowing what the thing does, and the long
 *  version is one click away behind the primary action.
 *
 *  Beat 4 earns its line twice over: "only disagreement can open a position" is the one thing
 *  `/`'s own five animated beats never say.
 *
 *  ONE genome, not three. A strategy you can read is the most concrete object this project has, and
 *  beat 1 is the claim it proves, so exactly one stays. `FOUNDER_QUOTES` keeps all three, because
 *  the constant — not the page — is what `test/smoke.mjs` checks against `genomes/genesis.json`,
 *  and a mis-transcribed quote must still fail that check while it sits unrendered.
 *
 *  It cites NO magnitudes. `config.js` deliberately carries no economics — no ante, no metabolic
 *  cost, no endowment — so any number here would have to be invented, and a page that prints an
 *  invented ante is the same class of error as a mock. What it can state is MECHANISM, which is
 *  fixed by deployed contract logic rather than by a tunable parameter, and it can quote a real
 *  genome. Both survive the deploy without becoming false.
 *
 *  Static by construction: no chain read, no `data-fx` stamp, nothing starting at `opacity: 0`.
 *  A visitor with no wallet, no JavaScript-driven data and no deployed population still gets the
 *  whole argument.
 */
export function primer(isLive = false) {
  return el(
    "section",
    { class: "panel panel-primer" },
    el("div", { class: "panel-head" }, el("h2", { text: "What this page is" })),

    el(
      "p",
      { class: "primer-status" },
      "A living population of AI forecasters, watched from outside. This page reads the chain " +
        "directly — no wallet, no account, nothing to sign.",
    ),
    isLive
      ? el(
          "p",
          { class: "primer-status" },
          "Season 0 is live on Somnia Shannon testnet (chain 50312). Every fifteen minutes, the population trades BTC/USD with on-chain AI inference.",
        )
      : el(
          "p",
          { class: "primer-status" },
          "Season 0 is not deployed yet, so there is nothing running to watch.",
        ),

    el(
      "ol",
      { class: "beats beats-terse" },
      beat(1, "An organism is a strategy written in English.", specimen("MOMENTUM", FOUNDER_QUOTES.MOMENTUM)),
      beat(2, "Every fifteen minutes, the market asks one question."),
      beat(3, "Each one answers by thinking, and thinking is metered."),
      beat(4, "Only disagreement can open a position."),
      beat(5, "The close pays, charges, and kills."),
    ),

    el(
      "div",
      { class: "primer-actions" },
      isLive
        ? el("a", { class: "btn btn-primary", href: "/enter/" }, "Launch App")
        : el("a", { class: "btn btn-primary", href: "/" }, "How it works, and how to enter"),
      el("a", { class: "btn btn-ghost", href: "?demo=1" }, "See it with sample data"),
    ),
  );
}

/*//////////////////////////////////////////////////////////////
                         SETUP / PRE-DEPLOY
//////////////////////////////////////////////////////////////*/

/**
 *  The operator's tool, folded away — which before the Season 0 deploy is the honest place for it.
 *
 *  It used to be the second half of the front door, under a heading reading "If you already have a
 *  population address". That heading taught the WRONG MODEL of the system, and did it reliably: a
 *  reader took it to mean an organism has an address of its own and that acquiring one is step one.
 *  It is not. There is ONE `Population` proxy per season, every organism is a row inside it
 *  identified by a number, the proxy's address is written into
 *  `contracts/deployments/<chainid>.json` by the deploy, and both surfaces resolve it from there in
 *  the same order — so nobody, the operator included, types it in the normal case. This field is for
 *  the abnormal ones: a second deploy, a local fork, a stale manifest.
 *
 *  Its button said "Connect", in `btn-primary`, and was therefore the loudest thing on the page.
 *  That word means "connect a wallet" to anybody who has ever used one, and THIS PAGE HAS NO WALLET:
 *  `chain.js` builds an `http()` transport and nothing else — no `createWalletClient`, no
 *  `writeContract`, no `window.ethereum` anywhere under `web/`. So the loudest affordance on the
 *  page was a promise the surface cannot keep, which is the same hierarchy inversion `.beat-claim`
 *  had, expressed in copy instead of in CSS. The primary action now belongs to `primer()` and points
 *  at `/`, which is where a wallet actually is.
 *
 *  The RPC is likewise no longer a question asked of a visitor. `DEFAULT_RPC` is used unless
 *  something overrides it, `?rpc=` and `localStorage` still do, and the field is here for the person
 *  who needs it rather than in front of the person who does not.
 *
 *  Collapsed, not removed: same form, same two inputs, same `onConnect`, same discovery guarantee.
 *  A `badQuery` forces it OPEN, because an address that was silently ignored has to be explained at
 *  the moment it is ignored, and an explanation folded inside a closed disclosure is not one.
 */
export function setupCard(ctx, handlers) {
  const input = el("input", {
    id: "pop-input",
    class: "input mono",
    type: "text",
    placeholder: "0x…",
    value: ctx.population || "",
    spellcheck: "false",
    autocomplete: "off",
  });
  const rpc = el("input", {
    id: "rpc-input",
    class: "input mono",
    type: "text",
    placeholder: ctx.defaultRpc,
    value: ctx.rpc === ctx.defaultRpc ? "" : ctx.rpc || "",
    spellcheck: "false",
    autocomplete: "off",
  });

  const submit = () => handlers?.onConnect?.(input.value.trim(), rpc.value.trim());

  return el(
    "details",
    { class: "panel panel-setup", open: !!(ctx.badQuery || ctx.noContract) },
    el("summary", {}, "Advanced Options & Custom Contract Wiring"),

    ctx.badQuery
      ? el(
          "p",
          { class: "bad" },
          el("code", { text: ctx.badQuery }),
          " is not a valid address, so it was ignored.",
        )
      : null,

    ctx.noContract
      ? el(
          "p",
          { class: "bad" },
          el("code", { text: ctx.noContract }),
          " is a valid address but holds no contract on chain ",
          el("code", { text: String(ctx.chainId) }),
          ", so every read came back empty. Edit it below. Nothing is wrong with the network — an " +
            "unreachable node leaves this field closed instead.",
        )
      : null,

    el(
      "form",
      {
        class: "setup-form",
        submit: (e) => {
          e.preventDefault();
          submit();
        },
      },
      el("label", { for: "pop-input", text: "Population proxy" }),
      input,
      el("label", { for: "rpc-input", text: "RPC endpoint" }),
      rpc,
      el(
        "div",
        { class: "setup-actions" },
        el("button", { class: "btn btn-ghost", type: "submit" }, "Load it"),
      ),
    ),

    el(
      "p",
      { class: "setup-note" },
      "Leave the RPC blank for ",
      el("code", { text: ctx.defaultRpc }),
      " on chain ",
      el("code", { text: String(ctx.chainId) }),
      ". Everything else — collateral, price source, venue, selection engine, traded symbol — is read " +
        "off the ",
      el("code", { text: "Population" }),
      " proxy itself, so this page cannot be aimed at a venue the population no longer uses.",
    ),
  );
}

/** Wiring, once discovered. Folded away because it is reference, not a live reading. */
export function wiringPanel(cfg) {
  const rows = [
    ["collateral", cfg.collateral],
    ["price source", cfg.priceSource],
    ["venue", cfg.venue],
    ["selection engine", cfg.selectionEngine],
    ["markets module", cfg.marketsModule],
    ["owner", cfg.owner],
  ].filter(([, v]) => v);

  return el(
    "details",
    { class: "panel panel-wiring" },
    el("summary", {}, "Wiring, read from the population"),
    el(
      "div",
      { class: "detail-fields" },
      rows.map(([k, v]) => field(k, link(addressUrl(v), addr(v, 8, 6), { class: "mono", title: v }))),
      field(
        "settlement",
        // `positionToken() == address(0)` is how an organism knows to skip the ERC-6909 push,
        // so it is also the honest way to name which venue family is wired.
        cfg.positionToken == null
          ? EM
          : cfg.positionToken === ZERO
            ? "direct duel (no transferable position)"
            : frag("ERC-6909 at ", link(addressUrl(cfg.positionToken), addr(cfg.positionToken), { class: "mono" })),
      ),
      field("endowment", money2(cfg.endowment, cfg)),
      field("metabolic cost", money2(cfg.metabolicCost, cfg, 4)),
      field("min stake", money2(cfg.minStake, cfg)),
      field("min endowment", money2(cfg.minEndowment, cfg)),
      // `dash`, not a template literal, and the reason is `discover()`'s shape. It settles all
      // twenty-two keys independently (`chain.js:174`) and writes `null` for any one that reverted,
      // because a partial discovery is meant to degrade — `readErrors` exists to name exactly which
      // key failed. But `stt` is `units`, and `units` starts with `BigInt(value)`, which THROWS on
      // null. Every money field here was already guarded by `money2`; these two were not, so one
      // flaky response out of twenty-two threw inside this panel, and `paint()` builds `#body` from
      // a single argument list (`main.js:232-241`) — so the throw discarded the grid, the tree, the
      // feed and the error panel that would have reported it, and left a masthead over a blank page.
      //
      // The guard belongs here and NOT in `units`: it is the character-for-character port of `fmt`
      // in `scripts/lib/darwin.ts`, kept identical so the page and `monitor.ts` never disagree about
      // a treasury. Teaching it to swallow null would hide the next unguarded call site instead.
      field("cognition endowment", dash(cfg.cognitionEndowment, (x) => `${stt(x)} STT`)),
      field("request deposit", dash(cfg.requestDeposit, (x) => `${stt(x)} STT`)),
      // The reproduction gates, printed as the rule rather than as three loose numbers, because
      // separately they say nothing: the threshold is derived from `endowment` and the surplus, and
      // the cap is a gas bound rather than a design limit (Population.sol:74).
      cfg.breedStreak == null
        ? null
        : field("breeds at", `${Number(cfg.breedStreak)} in a row · ${money2(breedThreshold(cfg), cfg)}`, {
            title: "streak bar and treasury bar, both from setEconomics — Population.sol:1843",
          }),
      cfg.maxPopulation == null ? null : field("max population", `${Number(cfg.maxPopulation)} alive at once`),
    ),
  );
}

/*//////////////////////////////////////////////////////////////
                           STANDINGS
//////////////////////////////////////////////////////////////*/

/**
 *  Current season standings / podium.
 *
 *  Derived from `Population.sol:_topThree()` and `endSeason()`:
 *  - Only living organisms are eligible (corpses cannot claim the prize pool)
 *  - Score = int256(correctCount) - int256(wrongCount)
 *  - Tie-break: lower id first (id < bestId)
 *  - Season prize pool pays 60% / 30% / 10% to the top 3 survivors
 */
export function standingsPanel(rows, prizePool, cfg, ctx = {}) {
  const living = (rows || []).filter((o) => !o.dead);
  if (!living.length) {
    return el(
      "section",
      { class: "panel panel-standings" },
      el("div", { class: "panel-head" }, el("h2", { text: "Season Standings" })),
      el("p", { class: "empty", text: "No living organisms eligible for season prize." }),
    );
  }

  const ranked = [...living].sort((a, b) => {
    const scoreA = Number(a.correctCount ?? 0) - Number(a.wrongCount ?? 0);
    const scoreB = Number(b.correctCount ?? 0) - Number(b.wrongCount ?? 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return Number(a.id) - Number(b.id);
  });

  const shares = [0.60, 0.30, 0.10];
  const pot = prizePool != null ? BigInt(prizePool) : 0n;

  return el(
    "section",
    { class: "panel panel-standings" },
    el(
      "div",
      { class: "panel-head" },
      el(
        "h2",
        {},
        "Season Standings",
        el("span", { class: "sub", text: "ranked by net score (correct − wrong) · endSeason pays top 3" }),
      ),
      el("span", { class: "muted", text: `${ranked.length} ranked` }),
    ),
    el(
      "table",
      { class: "table standings-table" },
      el(
        "thead",
        {},
        el(
          "tr",
          {},
          el("th", { text: "Rank" }),
          el("th", { text: "Organism" }),
          el("th", { text: "Net Score" }),
          el("th", { text: "Record" }),
          el("th", { text: "Projected Payout" }),
        ),
      ),
      el(
        "tbody",
        {},
        ranked.slice(0, 10).map((o, index) => {
          const score = Number(o.correctCount ?? 0) - Number(o.wrongCount ?? 0);
          const scoreStr = score > 0 ? `+${score}` : `${score}`;
          const share = index < 3 ? shares[index] : 0;
          let payoutStr = "—";
          if (share > 0 && pot > 0n) {
            const cut = (pot * BigInt(Math.round(share * 10_000))) / 10_000n;
            payoutStr = `${money2(cut, cfg)} (${share * 100}%)`;
          }

          const rankLabel = index === 0 ? "1st" : index === 1 ? "2nd" : index === 2 ? "3rd" : `#${index + 1}`;
          const isPodium = index < 3;

          return el(
            "tr",
            { class: isPodium ? "is-podium" : null },
            el("td", { class: isPodium ? "mono podium-rank" : "mono", text: rankLabel }),
            el("td", {}, chip(o.id, ctx)),
            el("td", { class: "mono", text: scoreStr }),
            el("td", { class: "muted", text: `${o.correctCount ?? 0}W / ${o.wrongCount ?? 0}L · ${o.abstainCount ?? 0}A` }),
            el("td", { class: "mono", text: payoutStr }),
          );
        }),
      ),
    ),
  );
}

/**
 *  MY OPERATIONS & PROMPT STRATEGY LAB
 *
 *  Dedicated analytics panel allowing operators to track their wallet's organisms,
 *  calculate net PnL / treasury, and rank prompt strategies from best to worst.
 */
export function operationsPanel(rows, cfg, ctx = {}) {
  const population = [...(rows || [])];
  const userWallet = ctx.userWallet ? ctx.userWallet.toLowerCase() : null;
  const dec = cfg.decimals ?? 6;

  const isMyOrg = (o) => {
    if (!userWallet || !ctx.entrants) return false;
    const entrant = ctx.entrants.get(Number(o.id));
    return Boolean(entrant && entrant.toLowerCase() === userWallet);
  };

  const myOrganisms = population.filter(isMyOrg);
  const myLiving = myOrganisms.filter((o) => !o.dead);
  const myDead = myOrganisms.filter((o) => o.dead);

  // Aggregate stats
  let totalTreasury = 0n;
  let totalWins = 0;
  let totalLosses = 0;
  let totalAbstains = 0;
  let totalWindowsLived = 0;

  for (const o of myOrganisms) {
    if (!o.dead && o.treasury != null) totalTreasury += BigInt(o.treasury);
    totalWins += Number(o.correctCount ?? 0);
    totalLosses += Number(o.wrongCount ?? 0);
    totalAbstains += Number(o.abstainCount ?? 0);
    totalWindowsLived += Number(o.windowsLived ?? 0);
  }

  const netScore = totalWins - totalLosses;
  const totalDecided = totalWins + totalLosses;
  const overallWinRate = totalDecided > 0 ? Math.round((totalWins / totalDecided) * 100) : 0;

  // Header & Wallet Connection Bar
  const head = el(
    "div",
    { class: "panel-head" },
    el(
      "div",
      {},
      el("h2", { text: "Operations & Prompt Analytics" }),
      el("p", {
        class: "panel-desc",
        text: "Track your active portfolio, analyze trading prompt effectiveness, and inspect best vs worst strategies.",
      }),
    ),
    userWallet
      ? el(
          "div",
          { class: "wallet-tracker-status" },
          el("span", { class: "wallet-indicator-dot" }),
          el("span", { class: "wallet-label", text: "Tracking" }),
          el("code", { class: "wallet-code", title: userWallet }, addr(userWallet)),
          el(
            "button",
            {
              class: "btn btn-ghost btn-xs",
              type: "button",
              title: "Disconnect or switch tracked wallet",
              click: () => { if (ctx.onSetWallet) ctx.onSetWallet(null); },
            },
            "Change",
          ),
        )
      : null,
  );

  // If no wallet is tracked yet:
  if (!userWallet) {
    const input = el("input", {
      class: "input wallet-input",
      type: "text",
      placeholder: "Paste wallet address (0x...)",
      spellcheck: "false",
    });

    const submitTrack = () => {
      const val = input.value.trim();
      if (val && /^0x[a-fA-F0-9]{40}$/.test(val)) {
        if (ctx.onSetWallet) ctx.onSetWallet(val);
      } else if (val) {
        if (typeof alert !== "undefined") alert("Please enter a valid 0x Ethereum address (42 characters)");
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitTrack();
    });

    const tryDetect = async () => {
      if (typeof window !== "undefined" && window.ethereum) {
        try {
          const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
          if (accs && accs[0] && ctx.onSetWallet) ctx.onSetWallet(accs[0]);
        } catch {}
      } else if (typeof alert !== "undefined") {
        alert("No web3 wallet detected. Please paste your address manually.");
      }
    };

    const ownerAddr = cfg.owner ? String(cfg.owner) : "0x1420cF8Bb9D92C3fDb674ECc5A57295c59078fDA";

    return el(
      "section",
      { class: "panel panel-operations" },
      head,
      el(
        "div",
        { class: "wallet-connect-prompt" },
        el(
          "div",
          { class: "wallet-connect-inner" },
          el("p", {
            class: "muted",
            text: "Enter your Somnia address to view your portfolio analytics and rank your trading prompts:",
          }),
          el(
            "div",
            { class: "wallet-input-row" },
            input,
            el("button", { class: "btn btn-primary btn-sm", type: "button", click: submitTrack }, "Track Wallet"),
            typeof window !== "undefined" && window.ethereum
              ? el("button", { class: "btn btn-ghost btn-sm", type: "button", click: tryDetect }, "Connect Wallet")
              : null,
          ),
          el(
            "div",
            { class: "wallet-quick-chips" },
            el("span", { class: "muted sub", text: "Quick select: " }),
            el(
              "button",
              {
                class: "chip chip-action",
                type: "button",
                click: () => { if (ctx.onSetWallet) ctx.onSetWallet(ownerAddr); },
              },
              `Deployer / Owner (${addr(ownerAddr)})`,
            ),
          ),
        ),
      ),
    );
  }

  // If wallet IS tracked, but has no organisms in this arena
  if (myOrganisms.length === 0) {
    return el(
      "section",
      { class: "panel panel-operations" },
      head,
      el(
        "div",
        { class: "op-empty" },
        el("p", {
          text: `No organisms found in this arena belonging to ${addr(userWallet)}.`,
        }),
        el("p", {
          class: "muted",
          text: "When you enter organisms using this wallet, their live portfolio, PnL, and prompt performance will appear here automatically.",
        }),
        el(
          "div",
          { style: { marginTop: "var(--s-3)" } },
          link("/enter/", "Enter a New Organism →", { class: "btn btn-primary btn-sm" }),
        ),
      ),
    );
  }

  // KPI Vitals Grid (4 boxes)
  const kpiGrid = el(
    "div",
    { class: "op-kpi-grid" },
    el(
      "div",
      { class: "op-kpi-card" },
      el("span", { class: "op-kpi-label", text: "Portfolio Treasury" }),
      el("div", { class: "op-kpi-value amount" }, moneyFixed(totalTreasury, dec, 2), el("span", { class: "op-kpi-unit", text: ` ${cfg.tokenSymbol ?? "tUSDC"}` })),
      el("span", { class: "op-kpi-sub muted", text: `${myLiving.length} active organism${myLiving.length === 1 ? "" : "s"}` }),
    ),
    el(
      "div",
      { class: "op-kpi-card" },
      el("span", { class: "op-kpi-label", text: "My Organisms" }),
      el("div", { class: "op-kpi-value" }, `${myLiving.length}`, el("span", { class: "op-kpi-unit muted", text: ` / ${myOrganisms.length} total` })),
      el("span", { class: "op-kpi-sub muted", text: `${myDead.length} died · irreversible` }),
    ),
    el(
      "div",
      { class: "op-kpi-card" },
      el("span", { class: "op-kpi-label", text: "Combat Record" }),
      el("div", { class: "op-kpi-value" }, `${totalWins}W`, el("span", { class: "muted", text: " - " }), `${totalLosses}L`),
      el("span", { class: "op-kpi-sub", text: `${totalAbstains} abstains · ${totalDecided > 0 ? overallWinRate + "% win rate" : "no paired calls"}` }),
    ),
    el(
      "div",
      { class: "op-kpi-card" },
      el("span", { class: "op-kpi-label", text: "Net Score / Edge" }),
      el("div", { class: ["op-kpi-value", netScore > 0 ? "text-life" : netScore < 0 ? "text-bad" : ""] }, `${netScore > 0 ? "+" : ""}${netScore}`),
      el("span", { class: "op-kpi-sub muted", text: `${totalWindowsLived} cumulative windows lived` }),
    ),
  );

  // Prompt & Strategy Leaderboard (Best vs Worst)
  const ranked = [...myOrganisms].sort((a, b) => {
    const netA = Number(a.correctCount ?? 0) - Number(a.wrongCount ?? 0);
    const netB = Number(b.correctCount ?? 0) - Number(b.wrongCount ?? 0);
    if (netB !== netA) return netB - netA;

    const decA = Number(a.correctCount ?? 0) + Number(a.wrongCount ?? 0);
    const decB = Number(b.correctCount ?? 0) + Number(b.wrongCount ?? 0);
    const wrA = decA > 0 ? Number(a.correctCount ?? 0) / decA : 0;
    const wrB = decB > 0 ? Number(b.correctCount ?? 0) / decB : 0;
    if (wrB !== wrA) return wrB - wrA;

    if (a.dead !== b.dead) return a.dead ? 1 : -1;
    const tA = BigInt(a.treasury ?? 0n);
    const tB = BigInt(b.treasury ?? 0n);
    return tB > tA ? 1 : tB < tA ? -1 : Number(a.id) - Number(b.id);
  });

  const promptCards = ranked.map((o, rankIdx) => {
    const id = Number(o.id);
    const prompt = ctx.genomes?.get(id) || "";
    const correct = Number(o.correctCount ?? 0);
    const wrong = Number(o.wrongCount ?? 0);
    const abstains = Number(o.abstainCount ?? 0);
    const net = correct - wrong;
    const isTop = rankIdx === 0 && (correct > 0 || (ranked.length > 1 && !o.dead));
    const isWorst = !isTop && (wrong > correct || o.dead);

    // Strategy Diagnosis
    let diagIcon = "⚖️";
    let diagText = "Neutral / Preserving: Organism has abstained or had no paired counterparty yet.";
    let diagClass = "diag-neutral";

    if (o.dead) {
      diagIcon = "💀";
      diagText = "Insolvent: Collateral was exhausted by metabolic rent or wrong bets. Irreversibly terminal.";
      diagClass = "diag-dead";
    } else if (correct > 0 && wrong === 0) {
      diagIcon = "🏆";
      diagText = "High Edge: Undefeated in live market windows. Capital expanding toward breeding threshold (streak ≥ 4).";
      diagClass = "diag-good";
    } else if (wrong > correct) {
      diagIcon = "⚠️";
      diagText = "Drawdown / Ineffective: Strategy took opposing bets that failed. Candidate for thesis mutation.";
      diagClass = "diag-warn";
    } else if (correct > 0 && correct === wrong) {
      diagIcon = "⚡";
      diagText = "Coin-flipper territory: Strategy accuracy is around 50%. In zero-fee markets, metabolic drag will slowly erode treasury.";
      diagClass = "diag-neutral";
    }

    return el(
      "article",
      { class: ["op-prompt-card", isTop && "op-prompt-top", isWorst && "op-prompt-worst"] },
      el(
        "div",
        { class: "op-card-head" },
        el(
          "div",
          { class: "op-card-id-row" },
          el("span", { class: ["op-rank-badge", isTop ? "rank-gold" : isWorst ? "rank-low" : "rank-mid"], text: `#${rankIdx + 1}` }),
          chip(id, ctx),
          el("span", { class: "card-gen", text: `G${o.generation}` }),
          o.dead
            ? el("span", { class: "tag tag-dead", text: `dead at w${o.deathWindow}` })
            : beliefTag(o.belief, o.thesis),
        ),
        el(
          "div",
          { class: "op-card-metrics" },
          el("span", { class: "amount", text: moneyFixed(o.treasury ?? 0n, dec, 2) }),
          el("span", { class: "sub muted", text: ` ${cfg.tokenSymbol ?? "tUSDC"}` }),
          el("span", { class: "op-metric-sep", text: "·" }),
          el("span", { class: "op-record-tag", text: `${correct}W - ${wrong}L · ${abstains}A` }),
          el("span", { class: ["op-net-tag", net > 0 ? "text-life" : net < 0 ? "text-bad" : "muted"], text: `(${net > 0 ? "+" : ""}${net})` }),
        ),
      ),
      el(
        "div",
        { class: "op-genome-box" },
        el(
          "div",
          { class: "op-genome-label" },
          el("span", { text: "Trading Thesis (Prompt)" }),
          el("span", { class: "muted sub", text: prompt ? `${prompt.length} chars` : "reading..." }),
        ),
        el("blockquote", { class: "op-genome-text" }, prompt || "Loading prompt from chain..."),
      ),
      el(
        "div",
        { class: ["op-diag-bar", diagClass] },
        el("span", { class: "op-diag-icon", text: diagIcon }),
        el("span", { class: "op-diag-text", text: diagText }),
        el(
          "button",
          {
            class: "btn btn-ghost btn-xs op-inspect-btn",
            type: "button",
            click: () => {
              if (ctx.onSelect) ctx.onSelect(id);
              if (typeof document !== "undefined") {
                const elNode = document.querySelector(`[data-id="${id}"]`) || document.getElementById("body");
                if (elNode?.scrollIntoView) elNode.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }
            },
          },
          "Inspect in Arena",
        ),
      ),
    );
  });

  return el(
    "section",
    { class: "panel panel-operations" },
    head,
    kpiGrid,
    el(
      "div",
      { class: "op-leaderboard-head" },
      el("h3", { text: "Strategy Performance & Prompt Ranking" }),
      el("span", { class: "muted", text: "Ranked from best to worst performing. Inspect prompts to isolate successful strategies." }),
    ),
    el("div", { class: "op-prompt-list" }, promptCards),
    el(
      "div",
      { class: "op-panel-foot" },
      el("p", {
        class: "muted",
        text: "Want to deploy a mutated or improved strategy?",
      }),
      link("/enter/", "Enter a New Organism in Console →", { class: "btn btn-primary btn-sm" }),
    ),
  );
}

export { mount, $ };

