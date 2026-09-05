/**
 *  Render the whole fixture through the real renderer, in Node, with a hand-written DOM.
 *
 *      node test/smoke.mjs        # or: npm test --prefix web
 *
 *  WHY THIS EXISTS
 *
 *  Every other check on this directory was static: imports read against exports, ABI strings read
 *  against the Solidity, `node --check` for syntax. All of that can be true of code that throws on
 *  the first line it executes. This runs it. It calls every exported render function on
 *  fixture-shaped data and asserts on the text and classes that come back, which catches the class
 *  of bug that would otherwise be found by a judge with the page open: a helper that was renamed,
 *  a BigInt added to a Number, a field read off a shape that does not have it.
 *
 *  It is NOT a substitute for opening the page. It says nothing about CSS, layout, fonts, the
 *  browser's own module loader, or whether the thing looks good. It proves the JavaScript runs and
 *  says what it should say.
 *
 *  It found one real defect on its first run: `detail()` renders a field labelled `entrant` (the
 *  owner address, from `Prophet.entrant()`) and the parent field had just started saying
 *  "none · entrant" for a root that paid in — two meanings of one word on one pane. Hence
 *  "none · paid in". A test that only checked for absence of exceptions would have missed it.
 *
 *  WHY `web/package.json` EXISTS
 *
 *  Node decides CommonJS-vs-ESM from the nearest `package.json`, and this repo's root one has no
 *  `"type"`, so Node would parse `js/render.js` as CommonJS and die on its first `import`. The
 *  nested `web/package.json` says `"type": "module"` — which is not a build step and not a
 *  dependency list, just Node being told what the browser already assumes about these files. There
 *  is still nothing to install.
 *
 *  THE SHIM
 *
 *  `js/dom.js` touches about a dozen DOM methods and no more, because it exists to keep the rest of
 *  the code away from the DOM. So the fake below is short enough to read. `classes` and `count`
 *  are additions for the assertions, not DOM API.
 *
 *  Note what the shim deliberately does NOT implement: `innerHTML`. The no-`innerHTML` rule was
 *  previously enforced by asking reviewers to grep. Now, if anyone assigns to it, the string lands
 *  on a plain property that nothing reads, the node renders empty, and the assertions below fail.
 *  Do not add an `innerHTML` setter to make a future test pass — the failure is the feature.
 */

class Node {
  constructor() {
    this.childNodes = [];
  }
  appendChild(c) {
    this.childNodes.push(c);
    return c;
  }
  replaceChildren(...c) {
    this.childNodes = [];
    for (const x of c) this.appendChild(x);
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
  /** Every class on this node and everything under it, flattened — for asserting on styling. */
  get classes() {
    const out = [];
    if (this.attrs?.class) out.push(...this.attrs.class.split(/\s+/));
    for (const c of this.childNodes) out.push(...(c.classes || []));
    return out;
  }
  get count() {
    return 1 + this.childNodes.reduce((n, c) => n + (c.count || 0), 0);
  }
}

class TextNode extends Node {
  constructor(t) {
    super();
    this.data = String(t);
  }
  get textContent() {
    return this.data;
  }
  get classes() {
    return [];
  }
}

class Elem extends Node {
  constructor(tag, ns) {
    super();
    this.tagName = tag;
    this.ns = ns ?? null;
    this.attrs = {};
    this.listeners = {};
    this.dataset = {};
    this.style = { setProperty() {} };
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k];
  }
  addEventListener(t, f) {
    (this.listeners[t] ??= []).push(f);
  }
  querySelector() {
    return null;
  }
}

globalThis.Node = Node;
globalThis.document = {
  createElement: (t) => new Elem(t),
  createElementNS: (ns, t) => new Elem(t, ns),
  createTextNode: (t) => new TextNode(t),
  createDocumentFragment: () => new Node(),
  querySelector: () => null,
  addEventListener() {},
  hidden: false,
};
globalThis.location = { search: "", pathname: "/", hash: "", href: "http://localhost/" };
globalThis.history = { replaceState() {} };

/*//////////////////////////////////////////////////////////////
                            SUBJECTS
//////////////////////////////////////////////////////////////*/

// Dynamic imports, so the globals above are installed before any module body runs. `render.js`,
// `lineage.js` and `fixture.js` reach neither the network nor viem — that is the whole point of the
// render/fetch split, and this file is the proof of it.
const ui = await import("../js/render.js");
const lineage = await import("../js/lineage.js");
const fx = await import("../js/fixture.js");
// Imported only so the null-key sweep below can prove its own detector: `units` opens with
// `BigInt(value)`, and that is the throw every guard in `render.js` exists to keep out of a paint.
const fmt = await import("../js/format.js");

const state = fx.state;
const cfg = fx.config;
const rows = state.organisms;
const f = fx.feed();

const ctx = {
  labels: new Map([
    [1, "Momentum"],
    [2, "Reversion"],
    [12, "Guest"],
  ]),
  selected: 12,
  onSelect: () => {},
  stamps: fx.stamps(),
  priceDecimals: state.window?.priceDecimals ?? 6,
  sourceLabel: "fixture",
  // The concurrent population, threaded the way `main.js` threads it. `maxPopulation` is the third
  // gate on breeding — `hatchAll` breaks at the cap — so without this the detail pane cannot tell
  // an organism that has earned a child from one that has nowhere to put it.
  living: state.livingCount,
};

const tree = lineage.layout(rows);
const row = (id) => rows.find((o) => Number(o.id) === id);

let fails = 0;
const results = [];

function run(name, fn) {
  try {
    const node = fn();
    if (node == null) {
      results.push(`  null  ${name}`);
      return null;
    }
    results.push(`  ok    ${name}  (${node.count ?? 0} nodes, ${node.textContent.length} chars)`);
    return node;
  } catch (e) {
    fails++;
    results.push(`  THREW ${name}\n        ${e.stack.split("\n").slice(0, 4).join("\n        ")}`);
    return null;
  }
}

const painted = {};
painted.demoBanner = run("demoBanner()", () => ui.demoBanner());
painted.errorBanner = run("errorBanner()", () => ui.errorBanner("simulated RPC failure", () => {}));
// The three branches of the read verdict, rendered so they can be COMPARED below. A banner that
// says "Cannot read the chain" over an address with no contract behind it blames the network for
// the one failure the network had nothing to do with, and the only way to catch that is to render
// both and require the headlines to differ.
painted.errorAbsent = run("errorBanner(absent)", () =>
  ui.errorBanner("There is no Population at 0x…dEaD on chain 50312.", () => {}, "absent"),
);
painted.errorUnreachable = run("errorBanner(unreachable)", () =>
  ui.errorBanner("Chain 50312 did not answer for 0x…dEaD.", () => {}, "unreachable"),
);
painted.readErrors = run("readErrors()", () => ui.readErrors({ currentWindow: "StalePrice(214, 180)" }));
painted.readErrorsEmpty = run("readErrors({})", () => ui.readErrors({}));
painted.header = run("header()", () => ui.header(state, cfg, ctx));
painted.claimPanel = run("claimPanel()", () => ui.claimPanel(state, f.logs));
// The OTHER branch of the honesty gate. Rendered here rather than asserted about in the abstract,
// because the two panels can only be told apart by comparing them — see the assertions below.
painted.claimPanelStrong = run("claimPanel(fallback disabled)", () =>
  ui.claimPanel({ ...state, fallbackEnabled: false }, f.logs),
);
painted.grid = run("grid()", () => ui.grid(rows, cfg, ctx));
painted.gridEmpty = run("grid([])", () => ui.grid([], cfg, ctx));
// RULE 3'S COROLLARY, rendered so it can be asserted below: the corpse band and the death toll are
// properties of the SNAPSHOT, not of the diff. Two organisms are already dead at first paint with
// nothing to stamp, so anything that appears only when `ctx.fx` carries a death is a motion cue
// pretending to be information — and the resting state is what a judge actually lands on.
painted.gridCold = run("grid(no diff)", () => ui.grid(rows, cfg, { ...ctx, fx: null }));
painted.headerCold = run("header(no diff)", () => ui.header(state, cfg, {}));
painted.detail1 = run("detail(#1 founder)", () => ui.detail(row(1), fx.details.get(1n), cfg, ctx));
painted.detail11 = run("detail(#11 child)", () => ui.detail(row(11), fx.details.get(11n), cfg, ctx));
painted.detail12 = run("detail(#12 paid in)", () => ui.detail(row(12), fx.details.get(12n), cfg, ctx));
painted.detail3 = run("detail(#3 dead)", () => ui.detail(row(3), undefined, cfg, ctx));
painted.detailNull = run("detail(null)", () => ui.detail(null, null, cfg, ctx));
painted.tree = run("tree()", () => ui.tree(tree, cfg, ctx));
painted.census = run("censusPanel()", () => ui.censusPanel(lineage.census(tree), lineage.depthReached(tree)));
painted.feed = run("feed()", () => ui.feed(f.logs, cfg, { ...ctx, range: String(f.scanned) }));
painted.feedEmpty = run("feed([])", () => ui.feed([], cfg, ctx));
painted.setup = run("setupCard()", () => ui.setupCard({ population: "", rpc: "", defaultRpc: "x", chainId: 50312 }, {}));
painted.primer = run("primer()", () => ui.primer());
painted.wiring = run("wiringPanel()", () => ui.wiringPanel(cfg));

// The state before the first price push, which is what a judge sees if they open the page early.
painted.headerNoWindow = run("header(no window)", () =>
  ui.header({ ...state, window: null, errors: { currentWindow: "NoWindow()" } }, cfg, ctx),
);

// THE SCRIPTED WINDOW, rendered rather than trusted. Twenty-five of the feed rows below are
// hand-written `args` objects for events the base fixture never emits, and one mistyped `eventName`
// falls through to `generic()` in silence — on the single screen a judge actually watches.
const frames = fx.season();
const last = frames[frames.length - 1];
const newborn = last.state.organisms.find((o) => Number(o.id) === 13);

painted.seasonHeader = run("header(final frame)", () => ui.header(last.state, cfg, ctx));
painted.seasonGrid = run("grid(final frame)", () => ui.grid(last.state.organisms, cfg, ctx));
painted.seasonFeed = run("feed(final frame)", () =>
  ui.feed(last.logs, cfg, { ...ctx, stamps: fx.stampsFor(last.logs, last.state.blockNumber) }),
);
painted.seasonDetail13 = run("detail(#13 newborn)", () => ui.detail(newborn, fx.details.get(13n), cfg, ctx));

// THE BREEDING BARS, at the one frame where an organism actually clears them. `detail(#1)` above is
// the pre-settlement state and is short on BOTH counts, which is the ordinary case; this is the
// other one, and it is the only place the "clears both bars" wording is reachable at all.
const bred = frames[0].state.organisms.find((o) => Number(o.id) === 1);
painted.detailBred = run("detail(#1 clears both breeding bars)", () =>
  ui.detail(bred, fx.details.get(1n), cfg, { ...ctx, living: frames[0].state.livingCount }),
);
// THE CONTROL FOR THE THIRD GATE. Same organism, same frame, one number changed: a population
// already at `maxPopulation`. `hatchAll` BREAKS at the cap (Population.sol:1602), so a page that
// promised a mutation here would be promising a child the contract will not bear. If this renders
// the same sentence as the line above, `maxPopulation` is not being read and the assertion pair
// below is measuring nothing — the same failure the honesty-gate check had before it was rewritten.
painted.detailBredFull = run("detail(#1 ready, arena full)", () =>
  ui.detail(bred, fx.details.get(1n), cfg, { ...ctx, living: cfg.maxPopulation }),
);
// THE CONTROL FOR THE DENOMINATOR. The same grid with the two breeding constants removed from the
// config, which is what a failed discovery call actually leaves behind. The badge must fall back to
// the bare count rather than inventing a bar — and a `4/4` that survives this render is a `4/4`
// that was never coming from the chain in the first place.
painted.gridNoBars = run("grid(breeding constants undiscovered)", () =>
  ui.grid(rows, { ...cfg, breedStreak: null, breedSurplusBps: null }, ctx),
);

// THE SETTLEMENT FAMILY, all three branches. `positionToken() == address(0)` is how an organism knows
// to skip the ERC-6909 push, so `wiringPanel` (`render.js:1886`) uses it to name which venue is
// wired — and `fixture.js:51` pins it to zero. That means the branch a judge sees before Season 0 is
// the duel one, while `Deploy.s.sol` wires a single `DreamDEXVenue` whose positions ARE transferable
// ERC-6909 complete sets; the duel arena is a second deploy that does not ship. So the branch the
// live system will actually render had never been executed by anything, here or in a browser.
const ERC6909 = "0x9F2b18c4A0e73D5f6B1a90C82d4E7f35A6c018bE";
painted.wiringErc6909 = run("wiringPanel(ERC-6909 venue)", () => ui.wiringPanel({ ...cfg, positionToken: ERC6909 }));
painted.wiringNoVenue = run("wiringPanel(settlement undiscovered)", () => ui.wiringPanel({ ...cfg, positionToken: null }));

// The settlement rows ALONE, and the isolation is the whole point of this render.
//
// The check further down pins the two `Settled` branches apart by severity class, and asserting that
// against the full feed's class bag proved NOTHING: the fixture's `Reacted` row carries
// `viaReactivity: false` deliberately (`fixture.js:334-340`, so the demo does not make this project's
// strongest claim on its behalf), and that branch renders a bare `warn` (`render.js:1526`). So `warn`
// was in the bag whichever branch a settlement took — reverting the grading fix left the check green
// while the two assertions beside it went red, which is the exact failure the check exists to rule out.
const SETTLED_ROWS = f.logs.filter((l) => l.eventName === "Settled");
painted.feedSettled = run("feed(settlement rows only)", () => ui.feed(SETTLED_ROWS, cfg, ctx));

console.log(results.join("\n"));

/*//////////////////////////////////////////////////////////////
                          ASSERTIONS
//////////////////////////////////////////////////////////////*/

const checks = [];
function assert(label, cond, detail = "") {
  checks.push(`  ${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : `  <- ${detail}`}`);
  if (!cond) fails++;
}

const t = (k) => painted[k]?.textContent ?? "";
const cls = (k) => painted[k]?.classes ?? [];

// `parentId 0` is not one thing: three roots must read three different ways.
assert("detail(#1) says founder", t("detail1").includes("none · founder"), t("detail1").slice(0, 120));
assert("detail(#12) says paid in", t("detail12").includes("none · paid in"), t("detail12").slice(0, 120));
assert("detail(#11) shows parent chip #9", t("detail11").includes("#9"), t("detail11").slice(0, 120));
assert("detail(#1) is not marked paid-in", !t("detail1").includes("paid in"));

// The word collision this test caught. `detail()` has an `entrant` field holding the owner ADDRESS,
// so the parent field must not also say "entrant" — on #12 both would otherwise appear at once.
assert("detail(#12) still shows the entrant address field", t("detail12").includes("entrant"));
assert("detail(#12) parent field avoids the word entrant", !t("detail12").includes("· entrant"), t("detail12").slice(0, 200));
assert("grid badge reads 'paid in'", t("grid").includes("paid in"));
assert("grid badge is not the word entrant", !t("grid").includes("entrant"));
assert("grid has exactly 1 paid-in badge", cls("grid").filter((c) => c === "card-entrant").length === 1);

// Selection pressure must be visible: the fixture is tuned so both severity bands render.
assert("grid shows >=1 bad runway", cls("grid").filter((c) => c === "bad").length >= 1);
assert("grid shows >=1 warn runway", cls("grid").filter((c) => c === "warn").length >= 1);

// `field()`'s tone affordance has callers on both ends, card and detail, from one threshold source.
assert("detail(#3 dead) uses tone-bad", cls("detail3").includes("tone-bad"), cls("detail3").join(" "));
assert("detail(#1 alive) uses tone-ok", cls("detail1").includes("tone-ok"));

// Every log renders and none falls through to `generic()`.
const feedRows = cls("feed").filter((c) => c === "feed-row").length;
assert("feed row count == 21", feedRows === 21, `found ${feedRows}`);

/*
 *  DID ANY EVENT FALL THROUGH TO `generic()`?
 *
 *  This used to be `!t("feed").includes("unknown event")` — and no code path anywhere can emit that
 *  string. `generic()` prints `k=v · k=v` built from the args, or "no arguments" when there are none
 *  (`render.js:1532-1537`). So the assertion was green on a feed composed ENTIRELY of fallback rows,
 *  which is exactly the state it was written to catch. Same for its twin on the scripted season.
 *
 *  Rewritten rather than deleted, because the thing it meant to check is worth checking: `feed()`
 *  looks up `SUMMARY[l.eventName]` (`render.js:1588`) and a new event added to `abi.js` without a
 *  summariser degrades to a debug dump in the middle of the judged feed. So compute what the
 *  fallback would print for each row's OWN args and look for that instead — and calibrate the
 *  detector on a made-up event below, since a checker for a string nothing emits is how this got here.
 */
const fallbackText = (args) =>
  Object.entries(args || {})
    .filter(([k]) => Number.isNaN(Number(k)))
    .map(([k, v]) => `${k}=${typeof v === "bigint" ? v.toString() : String(v)}`)
    .join(" · ") || "no arguments";

/** The event names in `logs` whose rendered row contains their own fallback dump. */
const fellThrough = (logs) =>
  logs.filter((l) => ui.feed([l], cfg, ctx).textContent.includes(fallbackText(l.args))).map((l) => l.eventName);

const UNSUMMARISED = { ...f.logs[0], eventName: "EventNobodyWroteASummariserFor", args: { alpha: 7n, beta: true } };
assert(
  "the fallback detector works: an event with no summariser does dump its args",
  fellThrough([UNSUMMARISED]).length === 1,
  `generic() did not render "${fallbackText(UNSUMMARISED.args)}", so neither check below could ever fail`,
);
assert(
  "no event in the feed falls through to generic()",
  fellThrough(f.logs).length === 0,
  `unsummarised: ${fellThrough(f.logs).join(", ")}`,
);

// THE HONESTY GATE, asserted on the words that actually differ.
//
// This check used to be `!t("claimPanel").includes("No keeper")` and it was worthless. The sentence
// "no keeper anywhere in the causal chain" appears in BOTH panels — the strong one licenses it, the
// weak one exists precisely to disclaim it — so no substring of that sentence can tell them apart.
// It passed only because of the capital N, which `render.js` never emits, so it would have gone on
// passing against the strong panel: the single thing it was written to catch.
//
// The discriminator is the prefix. `Licensed:` is what the run claims; `NOT claimed:` is what it
// refuses to. Rendering both branches and asserting they say opposite things is the version that
// can fail — flip `strong` in `claimPanel()` and four of these six break.
assert("fixture is the hedged case", state.fallbackEnabled === true, `fallbackEnabled: ${state.fallbackEnabled}`);
assert(
  "hedged panel licenses only the weaker sentence",
  t("claimPanel").includes("Licensed: selection is on-chain and atomic with redemption"),
  t("claimPanel").slice(0, 200),
);
assert(
  "hedged panel does not license the keeper claim",
  !t("claimPanel").includes("Licensed: no keeper"),
  t("claimPanel").slice(0, 200),
);
assert(
  "hedged panel disclaims the keeper claim in so many words",
  t("claimPanel").includes("NOT claimed: no keeper anywhere in the causal chain"),
  t("claimPanel").slice(0, 200),
);
assert(
  "fallback disabled licenses the keeper claim",
  t("claimPanelStrong").includes("Licensed: no keeper anywhere in the causal chain"),
  t("claimPanelStrong").slice(0, 200),
);
assert(
  "fallback disabled disclaims nothing",
  !t("claimPanelStrong").includes("NOT claimed"),
  t("claimPanelStrong").slice(0, 200),
);
assert(
  "claim styling follows the flag both ways",
  cls("claimPanel").includes("claim-weak") &&
    !cls("claimPanel").includes("claim-strong") &&
    cls("claimPanelStrong").includes("claim-strong"),
  `${cls("claimPanel").join(" ")} || ${cls("claimPanelStrong").join(" ")}`,
);
assert("demo banner says Synthetic", t("demoBanner").includes("Synthetic"));

// Death is shown, not suppressed.
assert("both dead organisms render, dimmed", cls("grid").filter((c) => c === "card-dead").length === 2);

// WHERE it is shown, as counts only. `cls` is `painted[k]?.classes ?? []` — a flat class bag whose
// ORDER is a property of the fake DOM's collector, not of the document, so an index-comparison
// assertion here would be vacuous. Counts are not.
assert("every corpse renders as a tombstone, not a card", cls("grid").filter((c) => c === "card-tomb").length === 2);
// A corpse must not quietly grow back into a 153px card. `card-foot` is emitted by `card()` only, for
// the living and the dead alike, so this pins it to the living count.
assert(
  "a corpse carries no runway row",
  cls("grid").filter((c) => c === "card-foot").length === rows.filter((o) => !o.dead).length,
  `${cls("grid").filter((c) => c === "card-foot").length} feet vs ${rows.filter((o) => !o.dead).length} living`,
);

// The band is a property of the snapshot, not of the diff. This is the specific mistake a future
// author is most likely to make — gating the band on `ctx.fx`.
assert("corpses render in the band with no diff at all", cls("gridCold").filter((c) => c === "card-tomb").length === 2);
// And the hero states a BODY count, not just a head count, from the snapshot with an empty ctx.
assert("the hero states the body count at rest", cls("headerCold").filter((c) => c === "toll").length === 1);
assert("the resting toll names the window of the last death", t("headerCold").includes("2 dead"), t("headerCold").slice(0, 240));

// Degraded states are states, not crashes.
assert("empty grid says something", t("gridEmpty").length > 10);
assert("readErrors({}) renders nothing", painted.readErrorsEmpty === null);
assert("no-window header explains itself", t("headerNoWindow").length > 40);

// Lineage math, straight off the fixture. `layout()` returns nodes as a sorted ARRAY
// (`lineage.js:97`); `byId` (`:102`) is the Map.
const depth = lineage.depthReached(tree);
assert("max generation ever == 2", depth.ever === 2, JSON.stringify(depth));
assert("living depth == 2", depth.living === 2, JSON.stringify(depth));
assert("census has 3 generations", lineage.census(tree).length === 3);
assert("12 nodes laid out", tree.nodes.length === 12, `${tree.nodes.length}`);
assert("byId map has 12 entries", tree.byId.size === 12, `${tree.byId?.size}`);
assert("9 roots (8 founders + 1 paid-in)", tree.roots.length === 9, `${tree.roots.length}`);
assert("rootKind(#1)==founder", lineage.rootKind(row(1)) === "founder");
assert("rootKind(#12)==entrant", lineage.rootKind(row(12)) === "entrant");
assert("rootKind(#11)==child", lineage.rootKind(row(11)) === "child");

/*//////////////////////////////////////////////////////////////
                    THE SCRIPTED WINDOW
//////////////////////////////////////////////////////////////*/

// `season()` is the only part of this fixture whose numbers have to AGREE with something. The per-
// window deltas come from `config`, and who may breed comes from `Population.sol` — not from what
// would make the better demo. Hand-written arithmetic that nothing checks is arithmetic that drifts,
// and this arithmetic is on screen in the only mode reviewed before Season 0 exists. So the rules
// get asserted rather than trusted, and the assertions are written to fail if someone later tunes a
// number to make the picture nicer.

const ids = (fr) => new Map(fr.state.organisms.map((o) => [Number(o.id), o]));
const timeline = [{ state, logs: f.logs }, ...frames];

assert("season plays 4 frames", frames.length === 4, `got ${frames.length}`);
assert("every frame carries a delay", frames.every((fr) => fr.after > 0), JSON.stringify(frames.map((x) => x.after)));

// IT RUNS FORWARD AND STOPS. Death is irreversible in `Prophet.sol` — nothing anywhere clears
// `dead` — so a demo that looped would resurrect #8 every twenty seconds and contradict the
// hardest invariant the project has. These three are the machine-checked version of that promise.
let backwards = "";
let resurrected = "";
let vanished = "";
for (let i = 1; i < timeline.length; i += 1) {
  const [a, b] = [timeline[i - 1], timeline[i]];
  if (b.state.windowCount < a.state.windowCount) backwards = `frame ${i}`;
  for (const [id, o] of ids(a)) {
    if (!ids(b).has(id)) vanished = `#${id} at frame ${i}`;
    else if (o.dead && !ids(b).get(id).dead) resurrected = `#${id} at frame ${i}`;
  }
}
assert("the window number never goes backwards", !backwards, backwards);
assert("nothing is ever resurrected", !resurrected, resurrected);
assert("no organism ever leaves the population", !vanished, vanished);

// WHO BREEDS IS NOT A CHOICE. `Population.sol:1488` gates reproduction on `streak() >= breedStreak`
// AND `treasury() >= _breedThreshold()`, and `_breedThreshold()` (`Population.sol:1520`) is `endowment` plus
// `breedSurplusBps`, which at the shipped default of 5000 is 40 + 50% = 60 tUSDC. Frame 0 is exactly
// the post-settlement state the contract would test, so the eligible set is computable — and the
// assertion is that the script breeds precisely that set and nobody else.
//
// #11 is the deepest line on the page and breeding it would have advanced the headline generation
// count on camera. It clears neither bar. #9 is the near miss and the more interesting one: it has
// the streak of 4 and is nine tUSDC short of affording a child, which is what the threshold is for.
const THRESHOLD = cfg.endowment + (cfg.endowment * 5_000n) / 10_000n;
const eligible = frames[0].state.organisms
  .filter((o) => !o.dead && o.streak >= 4 && o.treasury >= THRESHOLD)
  .map((o) => Number(o.id));
assert("breed threshold is endowment + 50%", THRESHOLD === 60_000_000n, String(THRESHOLD));
assert("exactly one organism qualifies to breed", eligible.length === 1, `eligible: [${eligible}]`);
assert("the one that qualifies is #1", eligible[0] === 1, `got #${eligible[0]}`);
assert(
  "#11 clears neither bar",
  ids(frames[0]).get(11).streak < 4 && ids(frames[0]).get(11).treasury < THRESHOLD,
  `streak ${ids(frames[0]).get(11).streak}, treasury ${ids(frames[0]).get(11).treasury}`,
);
assert(
  "#9 has the streak and cannot afford the child",
  ids(frames[0]).get(9).streak >= 4 && ids(frames[0]).get(9).treasury < THRESHOLD,
  `streak ${ids(frames[0]).get(9).streak}, treasury ${ids(frames[0]).get(9).treasury}`,
);

// THE PAGE NOW READS THOSE BARS INSTEAD OF IMPLYING THEM.
//
// Until this existed, `breedStreak` and `breedSurplusBps` were never read by the frontend at all:
// `streak` rendered as a bare number with no scale, on a page whose headline metric is generation.
// An organism one correct call from a child looked exactly like one that had just started counting.
// The three constants are pinned here against the LITERALS above rather than against each other,
// so a fixture tuned to make the demo look better moves the fixture and not the check.
assert("config's breed streak is Population.sol's default", cfg.breedStreak === 4, String(cfg.breedStreak));
assert("config's breed surplus is Population.sol's default", cfg.breedSurplusBps === 5_000n, String(cfg.breedSurplusBps));
assert("config's population cap is Population.sol's default", cfg.maxPopulation === 24, String(cfg.maxPopulation));

// It says what is MISSING, not a percentage: the two bars are different units and no single figure
// could honestly combine them. #1 before settlement is short on both; #9 has the streak and not the
// money, and its card carries the fraction that says so.
assert("detail(#1) names both shortfalls", t("detail1").includes("needs 1 more correct in a row and 1.58 tUSDC more"), t("detail1"));
assert("the grid prints a streak against its bar", t("grid").includes("4/4"), "no 4/4 badge for #9");
assert(
  "an undiscovered bar leaves the bare count",
  !t("gridNoBars").includes("4/4") && t("gridNoBars").includes("4🔥"),
  "the fraction survived the constants being removed, so it is not read from them",
);
assert("a corpse is not shown progress toward breeding", !t("detail3").includes("breeding"), t("detail3"));
assert("the wiring panel states the rule once, for both bars", t("wiring").includes("4 in a row · 60 tUSDC"), t("wiring"));

// The ready case and its control. Both sentences begin "clears both bars", so that phrase cannot
// tell them apart — the discriminator has to be what each one goes on to promise, which is the
// lesson the honesty-gate assertions above were rewritten to learn.
assert("a qualifying organism is told it qualifies", t("detailBred").includes("a mutation is requested at the next settlement"), t("detailBred"));
assert("a full arena is not promised a child", t("detailBredFull").includes("clears both bars, but the arena is full"), t("detailBredFull"));
assert(
  "the population cap actually changes the sentence",
  !t("detailBredFull").includes("a mutation is requested"),
  "the full-arena render still promises a mutation — maxPopulation is not being read, so both assertions above are measuring one branch",
);

// `_hatch` (`:1352`) takes the child's endowment out of the PARENT: "a survivor that breeds is
// deliberately more fragile immediately afterwards." The count-down on #1's card is that sentence.
const paidBefore = ids(frames[0]).get(1).treasury;
const paidAfter = ids(frames[1]).get(1).treasury;
assert("the parent pays a full endowment for its child", paidBefore - paidAfter === cfg.endowment, `${paidBefore} -> ${paidAfter}`);
assert("the child starts with exactly that endowment", ids(frames[1]).get(13).treasury === cfg.endowment);
assert("the child is generation 1, not a flattering 3", ids(frames[1]).get(13).generation === 1, String(ids(frames[1]).get(13).generation));

// #8 IS KILLED BY THE ANTE, NOT BY BEING WRONG. It held 4.00 tUSDC against a level-3 ante of
// 3.90625, so one loss left 0.09375 against a metabolic charge of 0.25 — arithmetically forced. #7
// is the organism the runway warning is about and it survives, which is the point of the warning.
const held8 = row(8).treasury;
assert("#8 could not have survived a loss", held8 - state.ante < cfg.metabolicCost, `${held8 - state.ante} < ${cfg.metabolicCost}`);
assert("#8 would have survived a win", held8 + state.ante > cfg.metabolicCost);
assert("#8 is dead by the last frame", ids(last).get(8).dead === true);
assert("#8 died in window 41", String(ids(last).get(8).deathWindow) === "41", String(ids(last).get(8).deathWindow));
assert("#7 is still alive, and one window closer", ids(last).get(7).dead === false && ids(last).get(7).treasury === 650_000n, String(ids(last).get(7).treasury));
assert("exactly one organism dies on screen", [...ids(last).values()].filter((o) => o.dead).length === 3);

// The scalars the header reads have to move with the population, or the hero contradicts the grid.
//
// AND THE RAKE IS NOT THREE WINNERS' SKIM. `settleAll` hands every settled organism's `charged + raked`
// to `_book` (`Population.sol:1264`), which splits each one at `prizeShareBps` and keeps integer
// division's remainder in the rake (`:759`). So nine organisms' metabolic rent is income too, and half
// of all of it belongs to the PRIZE POOL. This check expected `3 x rake-on-win` until 2026-09-04 —
// which is why `prizePool` sat still through the one frame that forfeits a corpse's residue into it,
// and why the season close below had no pot to pay out. Who won is read off the records rather than
// listed here: a winner is an organism whose lifetime `correctCount` went up in the settlement.
const RAKE_ON_WIN = (state.ante * cfg.rakeBps) / 10_000n;
const bookPool = (income) => (income * cfg.prizeShareBps) / 10_000n;
const sumOf = (xs) => xs.reduce((a, b) => a + b, 0n);
const wasAlive = new Map(state.organisms.map((o) => [Number(o.id), o]));
const INCOME_41 = frames[0].state.organisms
  .filter((o) => !wasAlive.get(Number(o.id))?.dead)
  .map((o) => {
    const was = wasAlive.get(Number(o.id));
    // The one that starved paid nothing: this fixture has it lose the whole remainder to the forfeit
    // rather than to the charge, and the forfeit is not `_book` income — it goes to the pool whole.
    if (o.dead && !was.dead) return 0n;
    return o.correctCount > was.correctCount ? cfg.metabolicCost + RAKE_ON_WIN : cfg.metabolicCost;
  });
const rakeDelta = frames[0].state.rakeAccrued - state.rakeAccrued;
assert(
  "the rake grows by _book's half of every settled organism's income",
  rakeDelta === sumOf(INCOME_41.map((i) => i - bookPool(i))),
  `${rakeDelta} != ${sumOf(INCOME_41.map((i) => i - bookPool(i)))}`,
);
assert("alive count falls to 9 then recovers to 10", `${frames[0].state.aliveCount}/${last.state.aliveCount}` === "9/10", `${frames[0].state.aliveCount}/${last.state.aliveCount}`);
assert("prophet count only grows", last.state.prophetCount === state.prophetCount + 1n, String(last.state.prophetCount));
assert("phase walks 2 → 0 → 1 → 2", `${state.phase}${frames[0].state.phase}${frames[2].state.phase}${frames[3].state.phase}` === "2012");
assert("the window turns over exactly once", String(last.state.windowCount) === "42", String(last.state.windowCount));

// Rendered, not just computed. `stampsFor` is new plumbing and the log rows are new arg shapes.
const seasonRows = cls("seasonFeed").filter((c) => c === "feed-row").length;
assert("all 50 feed rows render", seasonRows === 50, `found ${seasonRows}`);
assert(
  "no scripted event falls through to generic()",
  fellThrough(last.logs).length === 0,
  `unsummarised: ${fellThrough(last.logs).join(", ")}`,
);
assert("the starvation is spelled out in the feed", t("seasonFeed").includes("starved · needed"), t("seasonFeed").slice(0, 240));
assert("the birth is in the feed", t("seasonFeed").includes("#13"), t("seasonFeed").slice(0, 240));
assert("the final grid has one more card", cls("seasonGrid").filter((c) => c === "card-id").length === cls("grid").filter((c) => c === "card-id").length + 1);
assert("three corpses are dimmed, not dropped", cls("seasonGrid").filter((c) => c === "card-dead").length === 3);
assert("#13's pane shows its parent", t("seasonDetail13").includes("#1"), t("seasonDetail13").slice(0, 200));
assert("#13's genome is not empty", t("seasonDetail13").includes("momentum forecaster"), t("seasonDetail13").slice(0, 200));
assert("the header follows the script to window 42", t("seasonHeader").includes("42"), t("seasonHeader").slice(0, 200));

/*//////////////////////////////////////////////////////////////
              END OF THE 44-ASSERTION SUB-COUNT

  ^ CLAUDE.md documents "forty-four of the assertions recompute the scripted demo season's
    arithmetic" as the `assert()` call sites between `season plays 4 frames` and
    `the header follows the script to window 42`, INCLUSIVE of both. Everything from here down is
    outside that range. ADD NEW ASSERTIONS BELOW THIS BANNER, not above it.
//////////////////////////////////////////////////////////////*/

/*//////////////////////////////////////////////////////////////
                    THE SEASON ACTUALLY CLOSING
//////////////////////////////////////////////////////////////*/

/*
 *  `SeasonEnded` and `SeasonPrizePaid` (`render.js:1463-1464`) had never once executed — not in this
 *  suite, not in the browser, not in `?demo=1`. They were the only two summarisers in the table with
 *  no caller, on the one screen reviewed before Season 0 exists, and they carry the beat the whole
 *  business model rests on: the prize pool paying out 60/30/10 to the three best living forecasters.
 *
 *  So the arithmetic is recomputed here a SECOND time, from `Population.sol`'s constants rather than
 *  from `closeSeason`'s, and compared against what the renderer actually put on screen. Every figure
 *  is derived: the pot is the pool the settlement frame left, the cuts are `splitBps` applied to it,
 *  and the winners come from the cascade below rather than from a list anybody chose. Nothing in this
 *  section may be a literal that `web/js/fixture.js` could disagree with.
 */

// `splitBps` (`Population.sol:391`), written out because the frontend never reads it — it is not in
// `config` and there is no view for it, so the only honest way to check the shares is to state the
// contract's constant here and let the comparison fail if the fixture ever invents its own.
const SPLIT = [6_000n, 3_000n, 1_000n];

// `_topThree` (`:852`) as a CASCADE, independently of the fixture's copy. The comparison is STRICT
// `>` and that is the whole content of it: the contract walks the lineage in id order and replaces a
// slot only on an improvement, so a tie is kept by whoever reached the slot first — the lower id.
//
// AND A SORT IS NOT THE HAZARD HERE, which perturbation proved rather than argument: replacing this
// cascade with `sort((a, b) => Number(netOf(b) - netOf(a)))` changed nothing at all, because
// `Array.prototype.sort` has been stable since ES2019 and a stable descending sort by score IS this
// cascade for a top-three. The mis-implementation that actually diverges is `>=`, which promotes a
// tie and hands the higher place to the LATER id — so that is what the control below calibrates on.
const netOf = (o) => BigInt(o.correctCount) - BigInt(o.wrongCount);
const rank = (cmp) => (rs) => {
  let best = [];
  for (const o of rs) {
    if (o.dead) continue;
    if (best[0] == null || cmp(netOf(o), netOf(best[0]))) best = [o, best[0], best[1]];
    else if (best[1] == null || cmp(netOf(o), netOf(best[1]))) best = [best[0], o, best[1]];
    else if (best[2] == null || cmp(netOf(o), netOf(best[2]))) best = [best[0], best[1], o];
  }
  return best.slice(0, 3).filter(Boolean);
};
const cascade = rank((a, b) => a > b);
const loose = rank((a, b) => a >= b); // the wrong contract, kept only as a calibration target

const closing = frames[2]; // the last frame before the close — the pot's own provenance
const closed = last;
const pot = closing.state.prizePool;
const cuts = SPLIT.map((bps) => (pot * bps) / 10_000n);
const owed = sumOf(cuts);
const winners = cascade(closing.state.organisms).map((o) => Number(o.id));

const ENDED = closed.logs.filter((l) => l.eventName === "SeasonEnded");
const PAID = closed.logs.filter((l) => l.eventName === "SeasonPrizePaid");
// Newest-first, so the feed reads down in placing order; the placings are the reverse of that.
const byPlacing = [...PAID].reverse();
const CLOSE_ROWS = [...ENDED, ...PAID];
// A STAND-IN SO A MISSING CLOSE FAILS RED INSTEAD OF THROWING. Deleting the close from the fixture
// used to make this whole block die on `ENDED[0].args`, and a TypeError in the harness is a worse
// signal than twelve failing assertions: it says the test broke, not that the demo did.
const ended = ENDED[0] ?? { args: {}, transactionHash: null, blockNumber: null };
// And `[].every(...)` is VACUOUSLY TRUE, so every per-payout check below is conjoined with the count.
// Without that, deleting the payouts would leave those checks green on a feed with no payouts in it —
// the same shape of always-passing assertion this suite was rewritten to stop shipping.
const THREE = PAID.length === 3;
// `money2` goes through `dash()` (`render.js:38`), so a renamed or missing `amount` renders as an EM
// DASH and the row still looks like a row — "#1 won — in season 1". Nothing throws and nothing is
// obviously wrong on screen, which is why the arg shapes are asserted below rather than assumed. This
// formatter exists so the checks that read those args report RED on a bad shape instead of throwing
// `BigInt(undefined)` out of the harness, where it would read as the test being broken.
const money2 = (v) => (typeof v === "bigint" ? `${fmt.money(v, cfg.decimals, 2)} ${cfg.tokenSymbol}`.trim() : "<not a uint256>");

// Rendered in ISOLATION, so a class or a phrase found below came from these four rows and not from
// the forty-six underneath them. `fellThrough` already sets the precedent for rendering inside the
// assertion block: no `run()` call, so CLAUDE.md's "thirty-six render calls" stays true.
const closeFeed = ui.feed(CLOSE_ROWS, cfg, ctx);
const endedOnly = ui.feed(ENDED, cfg, ctx);
const preFeed = ui.feed(closing.logs, cfg, ctx).textContent;
const preHeader = ui.header(closing.state, cfg, ctx).textContent;

// IT HAPPENS, ONCE, AND IT IS LEGAL. `endSeason` is permissionless but gated on
// `windowCount - seasonStartWindow >= seasonWindows` (`:800`), and the control is the opening
// snapshot, which is one window short of it — if that gate were satisfied at first paint then the
// demo would be showing a season anyone could have closed before the script got to it.
assert("the script ends the season exactly once", ENDED.length === 1, `${ENDED.length} SeasonEnded rows`);
assert("the close pays exactly three places", PAID.length === 3, `${PAID.length} SeasonPrizePaid rows`);
assert(
  "endSeason's gate is satisfied at the frame that closes",
  closing.state.windowCount - closing.state.seasonStartWindow >= cfg.seasonWindows,
  `${closing.state.windowCount - closing.state.seasonStartWindow} vs ${cfg.seasonWindows}`,
);
assert(
  "and NOT satisfied by the snapshot the page opens on",
  state.windowCount - state.seasonStartWindow < cfg.seasonWindows,
  `the opening frame is already closable at ${state.windowCount - state.seasonStartWindow}/${cfg.seasonWindows}, so the check above proves nothing`,
);

// THE POT IS THE POOL THE SETTLEMENT LEFT, and it is not zero. The second half is the control that
// makes the split assertions below capable of failing at all: 60/30/10 of nothing is 0/0/0, and every
// share check would pass on an empty pot while the feed said "paid 0 tUSDC" on camera.
//
// AND THE POOL'S OWN PROVENANCE, because the pot is only honest if the frame that filled it was.
// `_book` (`Population.sol:759`) sends `prizeShareBps` of every settled organism's income to the pool,
// and a corpse's residue is forfeited into it WHOLE (`:1277-1280`) rather than split. Without this,
// freezing `prizePool` through the settlement — the bug that shipped until 2026-09-04 — left every
// payout assertion green, because they all read the pot off the frame rather than deriving it.
const RESIDUE = frames[0].logs
  .filter((l) => l.eventName === "ResidueForfeited" && l.blockNumber === frames[0].state.blockNumber)
  .reduce((a, l) => a + l.args.amount, 0n);
const poolDelta = frames[0].state.prizePool - state.prizePool;
assert("the pot is the prize pool the frame before it held", ended.args.pot === pot, `${ended.args.pot} != ${pot}`);
assert("the pot is not zero, so the shares below are real divisions", pot > 0n, String(pot));
assert("every place pays something", cuts.every((c) => c > 0n), cuts.join(" / "));
assert(
  "the pool grew by _book's share of the settlement plus the forfeited residue",
  poolDelta === sumOf(INCOME_41.map(bookPool)) + RESIDUE,
  `${poolDelta} != ${sumOf(INCOME_41.map(bookPool))} + ${RESIDUE}`,
);
assert("a corpse's residue is forfeited whole, not split", RESIDUE > 0n && RESIDUE > bookPool(RESIDUE), String(RESIDUE));

// 60/30/10 OF ONE POT READ ONCE (`:806`). The three shares must divide the SAME number — computing
// each from the remaining balance would pay the second place 30% of 40%, which is the bug this shape
// of check exists to catch.
assert(
  "the three payouts are 60/30/10 of one pot",
  THREE && byPlacing.every((l, k) => l.args.amount === cuts[k]),
  `${byPlacing.map((l) => l.args.amount).join(" / ")} != ${cuts.join(" / ")}`,
);
assert("paid is the sum of what was actually transferred", ended.args.paid === owed, `${ended.args.paid} != ${owed}`);
// `Darwin.t.sol`: unawarded value must ROLL OVER, not vanish. Three integer divisions can lose at
// most one wei each, so anything larger than that is value going missing on screen.
assert("the roll-over is exactly what the pot lost to rounding", closed.state.prizePool === pot - owed, `${closed.state.prizePool} != ${pot - owed}`);
assert("nothing beyond three floors is left behind", closed.state.prizePool < 3n, String(closed.state.prizePool));

// WHO WON IS THE CONTRACT'S CASCADE, recomputed here over the frame's own records. The control is the
// `>=` twin: it must DISAGREE with the strict one on a tie, or the tie pair below is not discriminating
// between the two contracts and the strictness claim is untested.
const TIE = [
  { id: 4n, correctCount: 5n, wrongCount: 1n, dead: false },
  { id: 9n, correctCount: 5n, wrongCount: 1n, dead: false },
];
assert("the winners are the three best living net records", THREE && byPlacing.map((l) => Number(l.args.prophetId)).join(",") === winners.join(","), `feed says ${byPlacing.map((l) => Number(l.args.prophetId))}, cascade says ${winners}`);
assert(
  "strict > keeps a tie for the lower id where >= would not",
  cascade(TIE).map((o) => Number(o.id)).join(",") === "4,9" && loose(TIE).map((o) => Number(o.id)).join(",") === "9,4",
  `strict ${cascade(TIE).map((o) => Number(o.id))} vs loose ${loose(TIE).map((o) => Number(o.id))} — if these agree, the tie pair does not tell the two comparisons apart`,
);
assert(
  "no corpse is paid",
  THREE && byPlacing.every((l) => ids(closing).get(Number(l.args.prophetId))?.dead === false),
  byPlacing.map((l) => `#${l.args.prophetId}`).join(" "),
);
// `:820-821` skips a winner whose `entrant()` is zero. It is unreachable — `spawnGenesis` passes
// `msg.sender` (`:499`) and `_hatch` inherits (`:1443`) — and this is what makes that claim visible:
// if a place were ever silently skipped, `paid` above would still balance and only this would fail.
assert("every place is paid to a real address", THREE && byPlacing.every((l) => /^0x[0-9a-fA-F]{40}$/.test(l.args.to) && !/^0x0+$/.test(l.args.to)), byPlacing.map((l) => l.args.to).join(" "));

// AND NOW THE TWO RENDERERS, which is the whole reason for this section.
assert(
  "the season-close row renders its sentence",
  ENDED.length === 1 && t("seasonFeed").includes(`season ${ended.args.season} ended`),
  t("seasonFeed").slice(0, 200),
);
assert(
  "the close row prints the pot and what was paid out of it",
  t("seasonFeed").includes(`pot ${money2(pot)}`) && t("seasonFeed").includes(`paid ${money2(owed)}`),
  closeFeed.textContent.slice(0, 200),
);
// The id and the sentence are asserted as separate substrings ON PURPOSE, because they are not
// adjacent in the rendered row: `chip()` appends a `chip-name` span when `ctx.labels` knows the
// organism, so first place renders as "#1Momentum won 2.72 tUSDC". Splicing the label into an
// expected string here would make this check pass only while the demo's label map is what it is now.
assert(
  "each payout row names its winner, its share and the season it was won in",
  THREE && byPlacing.every((l) => {
    const rowText = ui.feed([l], cfg, ctx).textContent;
    return rowText.includes(`#${l.args.prophetId}`) && rowText.includes(` won ${money2(l.args.amount)} in season ${l.args.season}`);
  }),
  closeFeed.textContent.slice(0, 320),
);
// THE CONTROLS FOR ALL THREE. Same renderer, same fixture, ONE FRAME EARLIER: if the close sentences
// turn up in the pre-close feed then they are coming from somewhere other than the close, and the
// three checks above are measuring the wrong rows.
assert(
  "the frame before the close says none of it",
  !preFeed.includes("ended") && !preFeed.includes(" won "),
  preFeed.slice(0, 200),
);
assert(
  "and neither does the base fixture's feed",
  !t("feed").includes("ended") && !t("feed").includes(" won "),
  t("feed").slice(0, 200),
);

// THE ARG NAMES ARE PART OF THE CONTRACT, and nothing else here would notice them changing. Both
// summarisers read `args` by name, through `dash()` — so a payout whose amount arrived under any other
// key renders "#1 won — in season 1": a plausible row, a real chip, and no number. The control below
// makes that concrete rather than asserting it in a comment.
assert(
  "every payout carries the four args its summariser reads, with the ABI's types",
  THREE && byPlacing.every((l) => typeof l.args.amount === "bigint" && typeof l.args.prophetId === "bigint" && typeof l.args.to === "string" && l.args.season != null),
  byPlacing.map((l) => Object.keys(l.args).join("+")).join(" "),
);
assert(
  "a payout missing its amount renders an em dash, not an error",
  ui.feed([{ eventName: "SeasonPrizePaid", args: { season: 1, prophetId: 1n, to: cfg.owner, amount: undefined } }], cfg, ctx).textContent.includes("won —"),
  "a missing amount does something other than quietly print an em dash, so the shape check above is not the thing protecting the feed",
);

// SEVERITY. `SEVERITY` bands `SeasonPrizePaid` as `good` and deliberately leaves `SeasonEnded`
// unbanded — the close is neutral, only the payouts are cause for celebration. The second assertion
// is the control that proves the three `sev-good` classes came from the payouts.
assert("the three payouts carry the good severity band", THREE && closeFeed.classes.filter((c) => c === "sev-good").length === 3, closeFeed.classes.filter((c) => c.startsWith("sev-")).join(" "));
assert("the close row itself is unbanded", ENDED.length === 1 && endedOnly.classes.filter((c) => c.startsWith("sev-")).length === 0, endedOnly.classes.join(" "));

// NEITHER OF THEM FALLS THROUGH. The paired control is a misspelling of the event name against these
// exact args: `generic()` must dump them, or this pair is the dead-check pattern all over again.
assert("neither close event falls through to generic()", fellThrough(CLOSE_ROWS).length === 0, `unsummarised: ${fellThrough(CLOSE_ROWS).join(", ")}`);
assert(
  "the detector fires on a misspelt SeasonEnded",
  fellThrough([{ ...ended, eventName: "SeasonEndedd" }]).length === 1,
  "a mistyped close event renders as prose, so the check above cannot fail",
);

// THE BOUNDARY IS A BOUNDARY. The events carry the season that ENDED (`:825`, `:835`) and `seasonId`
// increments after (`:836`), so the feed and the header disagree about the season number on purpose —
// and the pre-close header is the control that proves the header moved rather than always said 2.
assert("the events name the season that ended", THREE && ended.args.season === closing.state.seasonId && byPlacing.every((l) => l.args.season === closing.state.seasonId), `${ended.args.season} vs ${closing.state.seasonId}`);
// The expected number is `closing.state.seasonId + 1` and NOT `closed.state.seasonId`. The header is
// rendered from `closed.state`, so asserting it contains that state's own `seasonId` is a tautology
// that survives forgetting to increment at all: it would read "season 1" and agree with itself. The
// only version that can fail is the one that derives the number from the season that ended.
assert("the header has already moved on to the next season", t("seasonHeader").includes(`season ${closing.state.seasonId + 1}`), t("seasonHeader").slice(0, 240));
assert("the season number on the header actually moved", preHeader.includes(`season ${closing.state.seasonId}`) && closed.state.seasonId === closing.state.seasonId + 1, `${closing.state.seasonId} -> ${closed.state.seasonId}`);

// THE ESCALATING ANTE STARTS OVER, which is the point of having seasons. `seasonStartWindow =
// windowCount` (`:831`) makes `level()` zero and `ante()` `baseAnte` by construction, and the header
// prints the reset progress rather than carrying the old season's 42 windows forward.
assert("the new season starts at the window that ended the old one", closed.state.seasonStartWindow === closed.state.windowCount, `${closed.state.seasonStartWindow} vs ${closed.state.windowCount}`);
assert("level resets to 0 and the ante to baseAnte", closed.state.level === 0 && closed.state.ante === cfg.baseAnte, `level ${closed.state.level}, ante ${closed.state.ante}`);
assert("the ante genuinely came down", closing.state.ante > closed.state.ante, `${closing.state.ante} -> ${closed.state.ante}`);
assert("the header prints the reset progress", t("seasonHeader").includes(`0 / ${cfg.seasonWindows}`), t("seasonHeader").slice(0, 240));

// ONE TRANSACTION, NOT FOLDED INTO THE COMMITS. `endSeason` is its own permissionless call — in
// `Darwin.t.sol` it is sent from an address with no organisms — so the four rows share a hash and a
// block, and that hash is not the one the commits landed under.
assert("the close is one transaction", CLOSE_ROWS.length === 4 && new Set(CLOSE_ROWS.map((l) => l.transactionHash)).size === 1, CLOSE_ROWS.map((l) => l.transactionHash).join(" "));
assert("in one block", CLOSE_ROWS.length === 4 && new Set(CLOSE_ROWS.map((l) => String(l.blockNumber))).size === 1, CLOSE_ROWS.map((l) => String(l.blockNumber)).join(" "));
assert(
  "and it is not the transaction that opened the positions",
  ended.transactionHash != null && !closing.logs.some((l) => l.transactionHash === ended.transactionHash),
  "the close shares a hash with the commit frame, so the feed claims one transaction did both",
);
// THE FEED'S ORDER IS THE CHAIN'S, REVERSED, and that is not the order a demo would have chosen.
// `endSeason` emits the three payouts first (logIndex 0,1,2) and `SeasonEnded` last (`:835`), so a
// newest-first feed shows the close on top and the placings climbing UP from tenth to sixtieth
// underneath it. Asserting the flattering order — first place at the top — would be asserting a feed
// no chain read can produce.
assert(
  "the close row sits on top of its own payouts",
  closed.logs.slice(0, 4).map((l) => l.eventName).join(" ") === "SeasonEnded SeasonPrizePaid SeasonPrizePaid SeasonPrizePaid",
  closed.logs.slice(0, 4).map((l) => l.eventName).join(" "),
);
assert(
  "the payouts read up the feed in placing order, as their logIndex requires",
  THREE && PAID.map((l) => String(l.args.amount)).join(",") === [...cuts].reverse().map(String).join(","),
  `${PAID.map((l) => String(l.args.amount))} vs ${[...cuts].reverse().map(String)}`,
);

// THE SETTLEMENT FAMILY IS READ, NOT ASSUMED — and the branch that matters is the one nothing had
// rendered. The fixture pins `positionToken` to zero, so "direct duel" was the only sentence this
// panel had ever produced; the ERC-6909 branch is what `Deploy.s.sol`'s `DreamDEXVenue` will produce
// on the live page, and it is asserted here against a render made for the purpose. The discriminator
// is not the word "duel" — a single branch owns it — so the third check is that the two families do
// not collapse to the same sentence, which is what would happen if `positionToken` stopped being read.
const ERC6909_SHORT = `${ERC6909.slice(0, 6)}…${ERC6909.slice(-4)}`;
assert("a zero position token names the duel venue", t("wiring").includes("direct duel (no transferable position)"), t("wiring"));
assert(
  "a real position token names ERC-6909 and prints the address a judge would check",
  t("wiringErc6909").includes("ERC-6909") && t("wiringErc6909").includes(ERC6909_SHORT),
  t("wiringErc6909"),
);
assert(
  "the two venue families do not render the same sentence",
  !t("wiringErc6909").includes("direct duel"),
  "the ERC-6909 render still says duel, so positionToken is not being read and the check above proves nothing",
);
assert(
  "an undiscovered position token claims neither family",
  !t("wiringNoVenue").includes("direct duel") && !t("wiringNoVenue").includes("ERC-6909"),
  t("wiringNoVenue"),
);

// ONE FLAKY READ OUT OF TWENTY-TWO MUST NOT BLANK THE ARENA.
//
// `discover()` settles its keys independently (`chain.js:174`) and writes `null` for any that
// reverted — deliberately, because `readErrors` exists to name the failed key while the rest of the
// page stays live. That makes every one of these keys nullable on the LIVE path, not just in a
// contrived render. And the panels are built from a single argument list (`main.js:232-241`), so a
// throw inside any one of them discards the grid, the tree, the feed and the error panel itself,
// leaving a masthead over a blank page — the exact opposite of "a failed read is a state, not a
// crash". This found it: `stt(cfg.cognitionEndowment)` was not behind `dash`, and `units` opens with
// `BigInt(value)`.
//
// Swept rather than spot-checked, because the next unguarded formatter will be in a different field
// and a spot check only ever covers the one already fixed.
const NULLABLE = [
  "symbol", "collateral", "priceSource", "venue", "selectionEngine",
  "marketsModule", "owner", "endowment", "metabolicCost", "minStake",
  "minEndowment", "cognitionEndowment", "requestDeposit", "baseAnte",
  "anteMultBps", "levelWindows", "seasonWindows", "rakeBps", "prizeShareBps",
  "breedStreak", "breedSurplusBps", "maxPopulation", "positionToken",
];
const PANELS = [
  ["wiringPanel", (c) => ui.wiringPanel(c)],
  ["header", (c) => ui.header(state, c, ctx)],
  ["grid", (c) => ui.grid(rows, c, ctx)],
  ["detail", (c) => ui.detail(row(1), fx.details.get(1n), c, ctx)],
  ["feed", (c) => ui.feed(f.logs, c, ctx)],
];
const threw = [];
for (const key of NULLABLE) {
  for (const [name, render] of PANELS) {
    try {
      render({ ...cfg, [key]: null });
    } catch (e) {
      threw.push(`${name}(${key}: null) -> ${e.message}`);
    }
  }
}
assert(
  "no panel throws when any one discovered key comes back null",
  threw.length === 0,
  threw.join("; "),
);
// The control. If nulling a key cannot break a panel at all, the sweep above is asserting nothing —
// so one deliberately unguarded formatter must be caught by the same loop that found the real one.
let controlCaught = false;
try {
  `${fmt.stt(null)} STT`;
} catch {
  controlCaught = true;
}
assert(
  "the sweep's detector works: an unguarded formatter does throw on null",
  controlCaught,
  "stt(null) returned instead of throwing, so nothing in the sweep above could ever have failed",
);
assert(
  "the sweep covers every key discover() can null",
  NULLABLE.length === 23,
  `${NULLABLE.length} keys — chain.js:166-172 lists 22 plus positionToken`,
);

// A SETTLEMENT ROW MUST NOT OUT-CLAIM ITS OWN EVENT.
//
// `Settled.correct` is `collateralOut > staked` (`Prophet.sol:444`, emitted at `:522`), not the
// forecast grade. The grade is three-valued (`:474-495`) and the event carries neither `quantity` nor
// `belief`, so a loss, an abstain and a voided duel all reach the feed as `correct: false`. The row
// printed red "wrong" for all three, contradicting the W/L/A record on the card beside it — and
// abstaining is ordinary here, not an edge case. The fixture's feed carries both branches (#9 true,
// #10 false), so both are asserted against one render.
assert("a winning settlement is still called correct", t("feed").includes("correct"), t("feed").slice(0, 200));
assert(
  "a non-winning settlement no longer claims a wrong forecast",
  !t("feed").includes("wrong"),
  "the feed still grades `correct: false` as wrong, which an abstain and a voided duel are not",
);
assert("a non-winning settlement says what the flag licenses", t("feed").includes("no win"), t("feed").slice(0, 200));
const SETTLED_CLS = painted.feedSettled?.classes ?? [];
assert(
  "the two settlement branches do not render the same severity",
  SETTLED_CLS.includes("ok") && SETTLED_CLS.includes("warn"),
  `${SETTLED_ROWS.length} settlement rows -> [${SETTLED_CLS.join(" ")}] — both rows took the same branch, so the pair above proves nothing`,
);

// `chain.js` touches viem and abi.js only through lazy `import()`, which is what lets `?demo=1`
// stay off the network entirely — so its module body loads here with no RPC and no CDN. Importing
// it verifies its static imports resolve and its export surface is intact.
//
// Two modules are out of reach from Node and that is by design, not an oversight: `abi.js` imports
// `viem.js` and therefore the CDN, and Node has no HTTPS imports; `main.js` calls `boot()` on load
// and registers listeners on `globalThis`, because being the entry point is its whole job.
const chain = await import("../js/chain.js");
for (const fn of [
  "connect",
  "manifestPopulation",
  "organismLabels",
  "discover",
  "readState",
  "readOrganism",
  "readFeed",
  "stampBlocks",
  "blockTime",
]) {
  assert(`chain.${fn} is exported`, typeof chain[fn] === "function", typeof chain[fn]);
}

/*//////////////////////////////////////////////////////////////
                          THE FRONT DOOR
//////////////////////////////////////////////////////////////*/

// THE PRIMER QUOTES REAL GENOMES, AND IT CLAIMS THEY ARE VERBATIM.
//
// `specimen()` captions every quote on the page as "founder genome, quoted from
// genomes/genesis.json". That is a claim about a file, and it is the kind of claim that rots — a
// genome gets reworded in `genesis.json`, or a quote gets tightened here for the layout, and the
// page starts misquoting the chain while still captioned as a quotation. Two quotes WERE wrong when
// this check was first written: both closed an elision with a full stop where the genome has a
// comma, presenting a mid-sentence clause as a sentence the organism never ends there.
//
// WHAT THIS GUARD IS FOR is "nothing paraphrased ever reaches the screen" — not "there are exactly
// three quotes". So it is driven by the render and holds no list of its own: it collects whatever
// `figure.specimen` blocks `primer()` actually produced, requires at least one, and checks each
// against `genesis.json`. Dropping a specimen (the primer went from three quotes to one on
// 2026-09-01) changes WHAT is checked and cannot switch the check off; adding one back enrols it
// with no edit here. `FOUNDER_QUOTES` is then checked in full, rendered or not, because the
// constant is the thing that gets mis-transcribed and a string parked there unused today is one
// edit away from being on the page tomorrow.
//
// Recovering the quotes from the DOM is legal only because the read is scoped to the blockquote. A
// whole-panel `textContent` cannot be split back into quotes — inline elements concatenate without
// whitespace, and `UP_MOMENTUM` contains the string `MOMENTUM` — but `blockquote.genome` holds
// exactly one text node and that node IS the quote, character for character.
//
// The file is resolved from `import.meta.url`, not the cwd, because `npm test --prefix web` and
// `node test/smoke.mjs` run this from different directories.
const { readFileSync } = await import("node:fs");
const genesis = JSON.parse(
  readFileSync(new URL("../../genomes/genesis.json", import.meta.url), "utf8").replace(/^﻿/, ""),
);
const genomeOf = new Map(genesis.organisms.map((o) => [o.name, o.genome]));

/**
 *  Every ELEMENT under `node`, depth-first. The fake DOM has `childNodes` and no `querySelectorAll`,
 *  and it deliberately has no `innerHTML` — see the header. Walking is the whole toolkit, and it is
 *  enough: `classes` above proves styling, this proves structure and reads text back out of it.
 */
function walk(node) {
  const out = [];
  for (const c of node?.childNodes ?? []) {
    if (c.tagName) out.push(c);
    out.push(...walk(c));
  }
  return out;
}
const hasClass = (n, c) => (n.attrs?.class ?? "").split(/\s+/).includes(c);
const tag = (n) => String(n.tagName ?? "").toLowerCase();
const textIn = (list, c) => list.find((n) => hasClass(n, c))?.textContent ?? "";

const primerEls = walk(painted.primer);

/**
 *  One quotation's worth of assertions, against `genesis.json` and nothing else.
 *
 *  `where` names what is being checked — the rendered page, or the exported constant — because both
 *  get the identical test and a failure has to say which of the two diverged.
 */
function quotesVerbatim(where, name, quote) {
  const source = genomeOf.get(name) ?? "";
  assert(`${where}: genesis.json still has a ${name} genome`, source.length > 0, `has: ${[...genomeOf.keys()]}`);
  // Every run of text between ellipses must appear in the genome EXACTLY. Splitting on the ellipsis
  // is what makes an elision legal and a paraphrase illegal. A blank quote yields no fragments at
  // all and fails here, which is what stops the vacuous `source.includes("")` from passing below.
  const frags = quote.split("…").map((s) => s.trim()).filter(Boolean);
  assert(`${where}: ${name} is quoted in ${frags.length} fragment(s)`, frags.length >= 1, JSON.stringify(quote));
  for (const [i, part] of frags.entries()) {
    assert(
      `${where}: ${name} fragment ${i + 1}/${frags.length} is verbatim in genesis.json`,
      source.includes(part),
      `diverges at char ${[...part].findIndex((_, n) => !source.includes(part.slice(0, n + 1)))}: ${JSON.stringify(part.slice(0, 70))}`,
    );
    // A `.`-for-`,` substitution is already caught above — the substituted period is simply not in
    // the source at that offset, so `includes` fails. What that misses is a fragment cut verbatim
    // but mid-sentence with no terminal mark at all, which reads as complete and is not.
    assert(
      `${where}: ${name} fragment ${i + 1}/${frags.length} ends on a sentence, not mid-clause`,
      /[.!?]$/.test(part),
      JSON.stringify(part.slice(-40)),
    );
  }
}

// WHAT IS ACTUALLY ON THE PAGE. The list of specimens comes from the render, so this is the half of
// the guard that survives someone rewriting `primer()` without touching this file.
const specimens = primerEls
  .filter((n) => hasClass(n, "specimen"))
  .map((fig) => {
    const inner = walk(fig);
    return { name: textIn(inner, "specimen-name"), quote: textIn(inner, "genome") };
  });

assert("primer() quotes at least one founder genome", specimens.length >= 1, `${specimens.length} specimens`);
// A quote rendered OUTSIDE a captioned `figure.specimen` is a quote with nothing to check it
// against: the caption is what names the organism whose genome the page claims this is.
const genomeNodes = primerEls.filter((n) => hasClass(n, "genome")).length;
assert(
  "every genome quoted in the primer is inside a captioned specimen",
  genomeNodes === specimens.length,
  `${genomeNodes} quotes vs ${specimens.length} captions`,
);
for (const { name, quote } of specimens) {
  // The page must quote THROUGH the exported constant. A literal written at the `specimen()` call
  // site would render identically and be verified by nothing.
  assert(
    `primer()'s ${name} quote is the exported FOUNDER_QUOTES.${name} string`,
    quote === ui.FOUNDER_QUOTES?.[name],
    JSON.stringify(quote.slice(0, 70)),
  );
  quotesVerbatim("primer()", name, quote);
}

// AND WHAT IS IN THE CONSTANT — every entry, whether the primer still renders it or not. An unused
// entry is not a dead one; it is the next quote somebody puts back on the page.
const quoted = Object.entries(ui.FOUNDER_QUOTES ?? {});
assert("render.js exports FOUNDER_QUOTES", quoted.length >= 1, `${quoted.length} entries`);
for (const [name, quote] of quoted) quotesVerbatim("FOUNDER_QUOTES", name, quote);

// The control. A paraphrase of a real genome must NOT be accepted as a quotation of it, or the
// assertions above are only testing that `String.includes` exists.
assert(
  "a paraphrased genome is rejected",
  !genomeOf.get("REVERSION").includes("You believe short-horizon moves overshoot badly."),
);
// And the mid-sentence cut that was actually shipped must be rejected too — the control for the
// boundary rule specifically, since `includes` alone passes it.
assert(
  "the mid-sentence cut that shipped is rejected",
  !genomeOf.get("SKEPTIC").includes("You would rather say nothing than be wrong."),
);

// THE BEATS ARE THE ARGUMENT, and losing one is exactly how a simplification fails. `primer()` was
// cut from long prose to a terse list on 2026-09-01; five beats are what the cut was for, and
// nothing else in this harness would notice a fourth-and-a-half.
const beats = primerEls.filter((n) => hasClass(n, "beat")).length;
assert("primer states five beats", beats === 5, `found ${beats}`);

// The two ways out of the front door, read off the `href` attribute rather than the link text —
// the text is prose and may be reworded, the destination is the promise. `/` is the population
// form; `?demo=1` is the fixture, and a judge who lands here with nothing deployed needs it.
const primerHrefs = primerEls.filter((n) => tag(n) === "a").map((n) => n.getAttribute("href"));
assert("the primer offers the live population", primerHrefs.includes("/"), `${primerHrefs}`);
assert("the primer offers the fixture", primerHrefs.includes("?demo=1"), `${primerHrefs}`);

/*//////////////////////////////////////////////////////////////
     ABSENT IS NOT UNREACHABLE — the read verdict, both halves
//////////////////////////////////////////////////////////////*/

// `chain.js` used to decide "no population here" with `if (!out.collateral && !out.symbol)` over
// twenty-two independently-settled reads, and every path out of it printed "No Population at 0x…".
// Two defects in one line, fixed 2026-09-03 (FRONTEND_CHECKPOINT §8.16):
//
//   1. A TWO-READ THRESHOLD over twenty-two. Every other key was allowed to come back null on the
//      reasoning that `readErrors` names it while the page stays live — but a node that dropped
//      exactly `symbol` and `collateral` while answering the other twenty declared a live arena
//      dead. The landing uses any-of-nine (`app/src/lib/reads.js`), so the two surfaces could
//      disagree about whether the same arena exists under partial RPC failure.
//   2. ABSENT CONFLATED WITH UNREACHABLE. An RPC outage accused the address and sent the visitor
//      off to edit a correct one. The remedies are opposites, so they cannot be one message.
//
// `readVerdict` takes `Promise.allSettled` rows rather than a client, which is the only reason any
// of this is reachable from Node — `discover` needs viem and therefore the CDN.
const ok = (value) => ({ status: "fulfilled", value });
const zeroData = () => ({
  status: "rejected",
  // The shape viem actually builds: the diagnosis lives on a CAUSE, not on the thrown error, which
  // is why `saysNoCode` walks the chain instead of testing `err.name`.
  reason: Object.assign(new Error('The contract function "symbol" returned no data ("0x").'), {
    name: "ContractFunctionExecutionError",
    cause: Object.assign(new Error('returned no data ("0x")'), { name: "ContractFunctionZeroDataError" }),
  }),
});
const transport = () => ({
  status: "rejected",
  reason: Object.assign(new Error("HTTP request failed."), { name: "HttpRequestError" }),
});

assert(
  "every read failing with 0x reads as absent",
  chain.readVerdict([zeroData(), zeroData(), zeroData()]) === "absent",
  chain.readVerdict([zeroData(), zeroData(), zeroData()]),
);
assert(
  "every read failing on transport reads as unreachable, NOT absent",
  chain.readVerdict([transport(), transport(), transport()]) === "unreachable",
  chain.readVerdict([transport(), transport(), transport()]),
);
// THE FIX FOR DEFECT 1, stated as the case that used to fail. `symbol` and `collateral` are the
// first two keys in `chain.js`'s list, so this is exactly the batch the old two-read test called
// dead: the two it looked at failed, twenty answered.
assert(
  "twenty answered reads outweigh the two the old test looked at",
  chain.readVerdict([zeroData(), zeroData(), ...Array.from({ length: 20 }, () => ok(1n))]) === "live",
  chain.readVerdict([zeroData(), zeroData(), ...Array.from({ length: 20 }, () => ok(1n))]),
);
// And a single answer anywhere is proof of a contract — the landing's rule, now shared.
assert(
  "one answer out of twenty-two is live",
  chain.readVerdict([...Array.from({ length: 21 }, () => zeroData()), ok("tUSDC")]) === "live",
);
// THE CONTROL for the pair above. If a mixed batch could never read as anything but `live`, the
// two `absent`/`unreachable` assertions would be measuring the classifier's floor rather than its
// logic — so the same rows, with the successes removed, must flip the verdict.
assert(
  "the detector is reading the rows: removing the successes flips the verdict",
  chain.readVerdict([zeroData(), zeroData()]) === "absent" &&
    chain.readVerdict([zeroData(), zeroData(), ok(1n)]) === "live",
  "a batch of pure failures and a batch with one success classify the same, so nothing above is being measured",
);
// A mixed failure batch: one read got 0x, the rest timed out, nothing answered. `absent` is right —
// the 0x is positive evidence about the address, and a timeout is evidence about nothing.
assert(
  "one 0x among transport failures still names the address",
  chain.readVerdict([transport(), zeroData(), transport()]) === "absent",
  chain.readVerdict([transport(), zeroData(), transport()]),
);
// An empty batch is not a live population. This is the shape a future edit is most likely to
// produce by accident — `keys` emptied, or the `settled` array threaded wrong.
assert("an empty batch is never live", chain.readVerdict([]) === "unreachable");

// THE BANNER SAYS WHICH ONE. The verdict is worthless if all three render the same headline, and
// the old banner did exactly that: "Cannot read the chain" over an address the chain answered
// about perfectly well.
assert(
  "the absent banner blames the address",
  t("errorAbsent").includes("No arena at that address"),
  t("errorAbsent").slice(0, 120),
);
assert(
  "the unreachable banner blames the network",
  t("errorUnreachable").includes("did not answer"),
  t("errorUnreachable").slice(0, 120),
);
assert(
  "the three banners do not share a headline",
  !t("errorAbsent").includes("Cannot read the chain") &&
    !t("errorUnreachable").includes("No arena at that address") &&
    t("errorBanner").includes("Cannot read the chain"),
  `absent=${t("errorAbsent").slice(0, 60)} || unreachable=${t("errorUnreachable").slice(0, 60)} || default=${t("errorBanner").slice(0, 60)}`,
);
// An absent address must not be reported as a network fault in either direction — the sentence
// that sends a judge to restart their VPN over a typo.
assert(
  "the absent banner does not mention the network failing",
  !/did not answer/.test(t("errorAbsent")),
  t("errorAbsent"),
);

// AND THE FORM OPENS FOR THE ONE CASE AN EDIT FIXES. Same reasoning as `badQuery`: the remedy for
// `absent` is to change the address, so the field that changes it must not be folded away. The
// remedy for `unreachable` is to wait, and inviting an edit there is advice to break a working
// setting — so it stays closed. Both branches rendered, because the claim is the DIFFERENCE.
const setupBase = { population: "0x000000000000000000000000000000000000dEaD", rpc: "", defaultRpc: "x", chainId: 50312 };
painted.setupAbsent = run("setupCard(no contract)", () =>
  ui.setupCard({ ...setupBase, noContract: setupBase.population }, {}),
);
painted.setupUnreachable = run("setupCard(unreachable)", () => ui.setupCard({ ...setupBase }, {}));
// `open` is a boolean attribute, so `el()` writes it as the EMPTY STRING (`dom.js:42-43`) and a
// falsy prop is skipped entirely (`:28`). Present-vs-absent is therefore the test, not a value —
// `=== "true"` would fail against a form that is correctly open.
assert(
  "an absent address forces the address form open",
  painted.setupAbsent?.getAttribute("open") != null,
  `open=${JSON.stringify(painted.setupAbsent?.getAttribute("open"))}`,
);
assert(
  "an absent address is named in the form, not just in the banner",
  t("setupAbsent").includes("holds no contract"),
  t("setupAbsent").slice(0, 200),
);
assert(
  "an unreachable chain leaves the form closed",
  painted.setupUnreachable?.getAttribute("open") == null,
  `open=${painted.setupUnreachable?.getAttribute("open")} — the form opened for a network failure, so it opens unconditionally and the check above proves nothing`,
);

// `setupCard()` is the operator's tool and the only writable surface on the page. `main.js` reaches
// both fields by id, so a rename there is invisible in the layout and fatal to the form; and a form
// with no submit control cannot be sent by anything but the Enter key.
const setupEls = walk(painted.setup);
const setupIds = setupEls.map((n) => n.getAttribute?.("id")).filter(Boolean);
assert(
  "setupCard keeps both fields main.js reads by id",
  setupIds.includes("pop-input") && setupIds.includes("rpc-input"),
  `${setupIds}`,
);
assert(
  "setupCard still has a submit control",
  setupEls.some((n) => tag(n) === "button" && n.getAttribute("type") === "submit"),
  `${setupEls.filter((n) => tag(n) === "button").length} button(s)`,
);

console.log("\n" + checks.join("\n"));
console.log(`\n${fails === 0 ? "ALL GREEN" : fails + " FAILURE(S)"}`);
process.exit(fails === 0 ? 0 : 1);
