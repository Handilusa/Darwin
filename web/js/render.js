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
 *     is permissionless (Population.sol:575). See the header of `dom.js`.
 *
 *  3. A MISSING VALUE RENDERS AS `—`, NOT AS ZERO. `0` and "the read failed" are different
 *     claims about a treasury, and a dashboard that prints them the same way is lying in the
 *     one situation where an operator most needs the truth. `dash()` enforces it.
 */

import { FEED_ROWS, addressUrl, blockUrl, txUrl } from "../config.js";
import { $, el, field, frag, link, mount, svg } from "./dom.js";
import { addr, ago, bps, dur, hash, money, movePct, plural, stt, units, winRate } from "./format.js";
import { BELIEF, BELIEF_TONE, PHASE_NEXT, PHASE_STATE, THESIS, ZERO } from "./labels.js";
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
  return el(
    "span",
    { class: ["tag", `belief-${idx(BELIEF_TONE, b, "none")}`] },
    idx(BELIEF, b),
    Number(thesis) > 0 ? el("span", { class: "tag-sub", text: idx(THESIS, thesis) }) : null,
  );
}

function money2(v, cfg, places = 2) {
  return dash(v, (x) => `${money(x, cfg.decimals ?? 6, places)} ${cfg.tokenSymbol ?? ""}`.trim());
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

export function errorBanner(message, onRetry) {
  return el(
    "div",
    { class: "banner banner-error", role: "alert" },
    el("strong", { text: "Cannot read the chain. " }),
    el("span", { text: String(message) }),
    onRetry ? el("button", { class: "btn btn-inline", type: "button", click: onRetry }, "Retry") : null,
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
                             HEADER
//////////////////////////////////////////////////////////////*/

/**
 *  Cadence position, the season climate, and the price window.
 *
 *  `phase` is shown as BOTH the state and the call that advances it, because the two readings
 *  of the same number are off by one step and picking either alone describes a live population
 *  incorrectly to somebody reading the other. See `labels.js`.
 */
export function header(state, cfg, ctx = {}) {
  const phase = state.phase == null ? null : Number(state.phase);
  const w = state.window;

  const seasonProgress =
    state.windowCount != null && state.seasonStartWindow != null && cfg.seasonWindows
      ? `${Number(state.windowCount - state.seasonStartWindow)} / ${Number(cfg.seasonWindows)}`
      : EM;

  const move = w ? movePct(w.openPrice, w.lastPrice) : null;

  return el(
    "header",
    { class: "topbar" },
    el(
      "div",
      { class: "topbar-title" },
      el("h1", {}, "DARWIN", el("span", { class: "sub", text: cfg.symbol ? `${cfg.symbol} arena` : "arena" })),
      el(
        "div",
        { class: "topbar-meta" },
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

    el(
      "div",
      { class: "stats" },
      el(
        "div",
        { class: ["stat", "stat-phase", phase != null && `phase-${phase}`] },
        el("span", { class: "stat-label", text: "phase" }),
        el("span", { class: "stat-value", text: phase == null ? EM : idx(PHASE_STATE, phase) }),
        el("span", { class: "stat-note", text: phase == null ? "" : `next: ${idx(PHASE_NEXT, phase, "?")}` }),
      ),
      stat("window", dash(state.windowCount, String), `season ${dash(state.seasonId, String)} · ${seasonProgress}`),
      stat(
        "alive",
        state.aliveCount == null ? EM : `${state.aliveCount}`,
        state.prophetCount == null ? "" : `of ${state.prophetCount} ever born`,
      ),
      stat("level", dash(state.level, String), cfg.levelWindows ? `every ${cfg.levelWindows} windows` : ""),
      stat(
        "ante",
        money2(state.ante, cfg),
        cfg.baseAnte != null && cfg.anteMultBps
          ? `base ${money(cfg.baseAnte, cfg.decimals ?? 6, 2)} × ${Number(cfg.anteMultBps) / 10_000}`
          : "",
      ),
      stat("prize pool", money2(state.prizePool, cfg), cfg.prizeShareBps ? `${bps(cfg.prizeShareBps)} of rake` : ""),
      stat("rake", money2(state.rakeAccrued, cfg), cfg.rakeBps ? `${bps(cfg.rakeBps)} of profit` : ""),
    ),

    el(
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
              el("span", { text: `${dur(w.secondsRemaining)} left` }),
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
    ),
  );
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
 *  Living organisms first, then the dead. Within each, richest first.
 *
 *  Treasury order rather than win rate on purpose: treasury is what actually decides survival
 *  and breeding, and a 100% win rate over two windows would otherwise sit above an organism
 *  that has survived forty.
 */
export function grid(rows, cfg, ctx = {}) {
  const list = [...(rows || [])].sort((a, b) => {
    if (a.dead !== b.dead) return a.dead ? 1 : -1;
    const t = BigInt(b.treasury ?? 0n) - BigInt(a.treasury ?? 0n);
    return t > 0n ? 1 : t < 0n ? -1 : Number(a.id) - Number(b.id);
  });

  if (!list.length) {
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
      el("h2", { text: "Population" }),
      el("span", { class: "muted", text: `${list.filter((o) => !o.dead).length} alive · ${list.length} ever` }),
    ),
    el("div", { class: "grid" }, list.map((o) => card(o, cfg, ctx))),
  );
}

function card(o, cfg, ctx) {
  const wr = winRate(o.correctCount, o.wrongCount);
  const name = ctx.labels?.get(Number(o.id));
  const selected = ctx.selected != null && Number(ctx.selected) === Number(o.id);

  return el(
    "article",
    {
      class: ["card", o.dead && "card-dead", selected && "card-selected"],
      tabindex: "0",
      role: "button",
      click: ctx.onSelect ? () => ctx.onSelect(Number(o.id)) : null,
      keydown: ctx.onSelect
        ? (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              ctx.onSelect(Number(o.id));
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
      rootKind(o) === "entrant"
        ? el("span", {
            class: "card-gen card-entrant",
            title: `born at window ${o.birthWindow} with no parent — paid in through enter()`,
            text: "paid in",
          })
        : null,
      o.dead ? el("span", { class: "tag tag-dead", text: "dead" }) : beliefTag(o.belief, o.thesis),
    ),

    el(
      "div",
      { class: "card-treasury" },
      el("span", { class: "amount", text: money(o.treasury ?? 0n, cfg.decimals ?? 6, 2) }),
      el("span", { class: "unit", text: cfg.tokenSymbol ?? "" }),
    ),

    el(
      "div",
      { class: "card-stats" },
      el("span", { title: "correct / wrong / abstain" }, `${o.correctCount}·${o.wrongCount}·${o.abstainCount}`),
      el("span", { class: "dot" }),
      el("span", { title: `${wr.decided} decided ${plural(wr.decided, "window")}`, text: wr.text }),
      el("span", { class: "dot" }),
      el("span", { title: "windows lived", text: `${o.windowsLived}w` }),
      Number(o.streak) > 0
        ? frag(el("span", { class: "dot" }), el("span", { class: "streak", text: `${o.streak}🔥` }))
        : null,
    ),

    // Metabolism is charged per settled window, so "windows of runway left" is the honest
    // way to say how close an organism is to death — more useful than the balance itself.
    o.dead
      ? el("div", { class: "card-foot", text: `died at window ${o.deathWindow}` })
      : el("div", { class: "card-foot" }, runway(o.treasury, cfg)),
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

/*//////////////////////////////////////////////////////////////
                          ORGANISM DETAIL
//////////////////////////////////////////////////////////////*/

/**
 *  Where an organism came from.
 *
 *  `parentId 0` is NOT one thing. Both `spawnGenesis` (Population.sol:489) and the permissionless
 *  `enter` (:594) spawn with `parentId 0, generation 0`, so a stranger who paid the ante is
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
    return el(
      "aside",
      { class: "panel panel-detail" },
      el("p", { class: "empty", text: "Select an organism to read its genome." }),
    );
  }

  const name = ctx.labels?.get(Number(row.id));
  const wr = winRate(row.correctCount, row.wrongCount);
  const pending = info && (BigInt(info.pendingBeliefRequestId ?? 0n) > 0n || BigInt(info.pendingMutationRequestId ?? 0n) > 0n);

  return el(
    "aside",
    { class: "panel panel-detail" },
    el(
      "div",
      { class: "panel-head" },
      el("h2", {}, `Organism #${row.id}`, name ? el("span", { class: "sub", text: name }) : null),
      ctx.onClose ? el("button", { class: "btn btn-ghost", type: "button", click: ctx.onClose }, "close") : null,
    ),

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
      field("streak", String(row.streak)),
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

const COL = 132;
const ROW = 34;
const PAD = 26;
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

  const width = PAD * 2 + t.generations * COL + 150;
  const height = PAD * 2 + Math.max(t.rows - 1, 0) * ROW + 20;
  const x = (n) => PAD + n.generation * COL;
  const y = (n) => PAD + n.row * ROW;

  const canvas = svg("svg", {
    class: "tree",
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    role: "img",
    "aria-label": "lineage tree",
  });

  // Generation gridlines first, so nothing draws over a node.
  for (let g = 0; g <= t.generations; g += 1) {
    const gx = PAD + g * COL;
    canvas.appendChild(svg("line", { class: "tree-grid", x1: gx, y1: 4, x2: gx, y2: height - 4 }));
    canvas.appendChild(svg("text", { class: "tree-gen", x: gx, y: height - 6 }, `G${g}`));
  }

  for (const e of t.edges) {
    const a = t.byId.get(e.from);
    const b = t.byId.get(e.to);
    if (!a || !b) continue;
    const mid = (x(a) + x(b)) / 2;
    canvas.appendChild(
      svg("path", {
        class: ["tree-edge", e.dead && "is-dead"].filter(Boolean).join(" "),
        d: `M ${x(a)} ${y(a)} H ${mid} V ${y(b)} H ${x(b)}`,
      }),
    );
  }

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
      svg("text", { class: "tree-label", x: x(n) + R + 6, y: y(n) + 4 }, `#${n.id}${name ? ` ${name}` : ""}`),
    );
    canvas.appendChild(g);
  }

  return el(
    "section",
    { class: "panel" },
    el(
      "div",
      { class: "panel-head" },
      el("h2", { text: "Lineage" }),
      el("span", { class: "muted", text: `${t.nodes.length} organisms · ${t.generations + 1} generations` }),
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
  Settled: (a, cfg, ctx) => [
    chip(a.prophetId, ctx),
    a.correct ? el("span", { class: "ok", text: " correct" }) : el("span", { class: "bad", text: " wrong" }),
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
  ReactionFailed: () => [el("span", { class: "bad", text: "reaction failed" })],
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
  ReactionFailed: "bad",
  BreedingUnaffordable: "warn",
  Spawned: "good",
  Born: "good",
  SeasonPrizePaid: "good",
};

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
  const shown = rows.slice(0, ctx.limit ?? FEED_ROWS);

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
    el("ol", { class: "feed" }, shown.map((l) => feedRow(l, cfg, ctx))),
    rows.length > shown.length
      ? el("p", { class: "muted", text: `${rows.length - shown.length} older events not shown` })
      : null,
  );
}

function feedRow(l, cfg, ctx) {
  const make = SUMMARY[l.eventName];
  const body = make ? make(l.args || {}, cfg, ctx) : generic(l.args);
  const ts = ctx.stamps?.get(String(l.blockNumber));

  return el(
    "li",
    { class: ["feed-row", SEVERITY[l.eventName] && `sev-${SEVERITY[l.eventName]}`] },
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
    ),
    el(
      "div",
      { class: "feed-where" },
      l.transactionHash ? link(txUrl(l.transactionHash), "tx", { class: "muted" }) : null,
    ),
  );
}

/*//////////////////////////////////////////////////////////////
                         SETUP / PRE-DEPLOY
//////////////////////////////////////////////////////////////*/

/**
 *  What the page shows when it has no address — which, until the Season 0 deploy, is ALWAYS.
 *
 *  It is not an error state and is deliberately not styled as one. Nothing is deployed yet, so
 *  this is the honest resting state of the repo, and it offers the two things a visitor can
 *  actually do: point the page at a population, or look at the fixture.
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
    "section",
    { class: "panel panel-setup" },
    el("h2", { text: "Point this page at a population" }),
    el(
      "p",
      { class: "lede" },
      "One address is all it needs. The collateral, price source, venue, selection engine and " +
        "traded symbol are read off the ",
      el("code", { text: "Population" }),
      " proxy itself, so this page cannot be aimed at a venue the population no longer uses.",
    ),

    ctx.badQuery
      ? el(
          "p",
          { class: "bad" },
          el("code", { text: ctx.badQuery }),
          " is not a valid address, so it was ignored.",
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
      el("label", { for: "rpc-input", text: "RPC (optional)" }),
      rpc,
      el(
        "div",
        { class: "setup-actions" },
        el("button", { class: "btn btn-primary", type: "submit" }, "Connect"),
        el("a", { class: "btn btn-ghost", href: "?demo=1" }, "View the fixture instead"),
      ),
    ),

    el(
      "div",
      { class: "setup-note" },
      el("h3", { text: "Nothing is deployed yet" }),
      el(
        "p",
        {},
        "Season 0 deploys at the storage freeze. Until then there is no address to ship, and " +
          "inventing one here would give you a page that renders confident zeroes for a " +
          "contract that does not exist. ",
        el("a", { href: "?demo=1", text: "The fixture" }),
        " shows every surface with synthetic data instead.",
      ),
      el("p", { class: "muted" }, "Chain ", el("code", { text: String(ctx.chainId) }), " · Somnia Shannon testnet."),
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
      field("cognition endowment", `${stt(cfg.cognitionEndowment)} STT`),
      field("request deposit", `${stt(cfg.requestDeposit)} STT`),
    ),
  );
}

export { mount, $ };
