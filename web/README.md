# `web/` — the population view

A live view of the DARWIN population on Somnia Shannon. It reads one contract, in the browser, and
renders the whole arena: every organism's treasury and record, its genome verbatim, the lineage
tree, the per-generation census, and the event feed that ends in a death.

**There is no build step, no bundler, no `npm install`, no backend, and no wallet connection.** Serve
the directory and open it.

```bash
npx serve web          # or: python -m http.server 8080 -d web
# then http://localhost:3000/?population=0x…
```

You **cannot** open `index.html` from the filesystem. ES modules are fetched, and browsers refuse
`import` over `file://` with a CORS error that names the module, not the protocol — so a `file://`
attempt looks like a broken script rather than a wrong URL. Any static server will do; the page
makes no requests to it beyond the files themselves.

## Try it with no chain and no deploy

```bash
npx serve web          # then http://localhost:3000/?demo=1
```

`?demo=1` swaps the data source for `js/fixture.js` and **nothing else** — the same renderer, the
same BigInt arithmetic, the same countdown. The fixture is a 12-organism population three
generations deep with two deaths (one starved, not merely wrong), a living organism three windows
from starving, one paying entrant that is structurally a root, an open paired position and 21 log
entries spanning births, beliefs, a pairing, a settlement, starvation, reaping, forfeited residue, a
failed inference and one reactive selection. A non-dismissible amber banner says *"Synthetic data"*
in its first two words, because a demo mode that can be mistaken for a live one is worse than no
demo mode.

**And then it moves.** A frozen snapshot cannot fire a diff-driven timeline, so the whole point of
`motion.js` was invisible in the only mode anyone can open before Season 0 exists. `fixture.season()`
scripts the next window as four successive snapshots, handed to the page through the same `advance()`
path a live poll uses: `settleAll` pays out and #8 starves at 4.2s, `hatchAll` buys #1 a child at
9.4s, `think` reopens the window at 14s, `commitAll` re-arms the positions at 18s. Nine treasuries
count at once, a card takes a red ring and dims for good, a newborn arrives on an indigo glow while
its parent's balance counts *down* by the endowment it just paid.

Three things about it are deliberate. It is **not a simulator** — every number is derived from
`config` and `Population.sol` rather than chosen, which is why #8's death is forced (it holds 4.0
against a 3.9 ante and a 0.25 metabolic charge) and why the sole breeder is #1 and not the
deeper-lineage #11, which clears neither bar. It **runs forward and stops**, because looping would
resurrect #8 every twenty seconds and this project's loudest claim is that death is irreversible.
And it changes no rendering code: `main.js` swaps state, the diff does the rest.

This is how to review the frontend before Season 0 exists.

## Verify it without a browser

```bash
npm test --prefix web      # or: node web/test/smoke.mjs
```

`test/smoke.mjs` puts a 60-line fake DOM in front of the **real** renderer and calls its exported
render functions on the fixture — fifty call sites, which drive 313 executed renderer calls,
including the degraded paths (`grid([])`, `detail(null)`, a header with no window, all three RPC
error banners, a grid rendered with the breeding constants undiscovered, all three branches of the
settlement-family field, and one call that is *supposed* to render nothing at all) — then asserts on
the text and CSS classes that come back. One hundred and eighty-nine checks, over one hundred and
sixty-seven `assert()` call sites: that a founder, a child and a paying entrant each read
differently; that both runway severity bands actually appear; that all 21 log rows render and none
falls through to the argument-dump fallback; that no single failed chain read can throw inside a
panel; that `fallbackEnabled: true` yields the *weaker* claim and `false` yields the stronger one;
that both corpses stay on the page; and that a chain that never answered is never reported as an
address with no contract behind it.

Forty-four of those assertions cover the scripted season in `?demo=1` — the block running from
`test/smoke.mjs:462` to the banner at `:614` that marks its end — and they are the only ones
in the suite that check a number rather than a rendering. The per-window deltas are recomputed from
`config` and the breeding rules from `Population.sol`, so the suite fails if someone later tunes a
figure to make the demo look better: that the window never goes backwards, that nothing is ever
resurrected, that exactly one organism clears both breeding bars, that the parent's treasury falls
by a full endowment, and that the child is generation 1 rather than a flattering 3. All six were
confirmed capable of failing by perturbing the fixture — reviving the corpse and enriching the
near-miss — and watching them break.

The same eleven-assertion block (`test/smoke.mjs:517-543`) now also checks what the page *says*
about those bars, because the
constants that gate breeding are read from the chain rather than implied: that an organism short on
both is told both shortfalls in its own units, that a card prints `4/4` against the bar instead of a
bare `4`, that removing the constants falls back to the bare count rather than a default, that a
corpse is shown no progress at all, and that a full arena is told the truth — "clears both bars, but
the arena is full" — rather than being promised a child `hatchAll` will not bear. That last pair
shares the opening phrase, so the discriminator is what each sentence goes on to promise; both were
confirmed capable of failing by hardcoding the cap check to `false` and by retuning
`breedSurplusBps`, each of which broke exactly the expected assertions and nothing else.

The honesty-gate check renders **both** branches of `claimPanel()` and compares them, which is the
only way to assert on it. "no keeper anywhere in the causal chain" appears in either panel — the
strong one licenses that sentence, the weak one exists to disclaim it — so the discriminator has to
be the prefix, `Licensed:` against `NOT claimed:`. An earlier version of this check tested for the
sentence alone and passed on both panels, which is worth knowing about any assertion here: if you
cannot describe how it fails, it is not yet a test.

It also imports `js/chain.js` and finds its nine exports intact **with no network access at all**,
which is the load-bearing proof that viem and `js/abi.js` are reached only through lazy `import()`.
If either were a static import, that line would fail — so `?demo=1` cannot silently start touching
the network.

It says nothing about CSS, layout, or how it looks — for that, open it. What it does prove is that
the JavaScript runs and says what it should say, which is the part a static read cannot establish.
It earned its keep on the first run by catching a word collision: `detail()` shows a field labelled
`entrant` — the owner address, from `Prophet.entrant()` — and the parent field had started reading
"none · entrant" for a root that bought in, so one pane used one word for two things. It now reads
"none · paid in".

`web/package.json` exists only for this: Node picks CommonJS-vs-ESM from the nearest `package.json`,
and the repo root's has no `"type"`, so Node would read `js/render.js` as CommonJS and choke on its
first `import`. It declares `"type": "module"` — what the browser already assumes — and lists no
dependencies. There is still nothing to install and nothing to build.

## Configuration is one address

```
?population=0x…      the Population proxy (the only thing you need)
?rpc=https://…       override the RPC
?demo=1              offline fixture
?poll=15000          poll interval in ms
#organism/7          deep-link a selected organism
```

Resolution order: query string → `localStorage` → `contracts/deployments/50312.json` (when the page
is served from the repo root) → a setup card that asks.

**Only the `Population` address is ever configured.** `collateral`, `priceSource`, `venue`,
`selectionEngine`, `marketsModule` and `symbol` are all discovered on-chain from it. That is not
convenience — `venue` is *repointable* (`Population.setWiring`), so a config file listing it could
outlive the truth and quietly aim this page at an abandoned arena while still rendering plausible
numbers. Anything the chain can answer, the chain answers.

## Why it needs no indexer

`Population.snapshot()` returns the entire population — 16 static fields per organism — in **one
`eth_call`**. Generation, treasury, belief, thesis, streak, record and death window all arrive
together, so the grid, the tree and the census are three views of a single read. The only log
scanning is for the feed, bounded to the last 45,000 blocks in 9,000-block chunks (the range
`scripts/prove-same-block.ts:60` already proved works against Somnia's public RPC).

RPC calls per poll: **one** batched request covering the snapshot and roughly twenty scalars, plus a
feed scan when the window number changes or 60 seconds have passed. Polling stops entirely while the
tab is hidden.

## Invariants worth not breaking

**No `innerHTML`. Anywhere.** `Population.enter(string genome, uint256 endowment)`
(`Population.sol:654`) is permissionless: anybody with testnet tUSDC and a little STT can spawn an
organism whose `systemPrompt` is a string of their choosing, and displaying genomes is this page's
entire job. So genomes, `lastReasoning`, and every `reasoning` in a `Believed` log are **untrusted
input arriving over a public write path**. `js/dom.js` puts every string child through
`createTextNode` and passes listeners as functions rather than `on*=` attribute strings, so markup
in a genome renders as the characters an entrant typed and can never become nodes. The fix is not
careful escaping; it is making escaping unnecessary. Grep for `innerHTML` as a review check — there
should be no hits. The fake DOM in `test/smoke.mjs` also implements no `innerHTML`, so an
accidental one fails the test suite instead of quietly working.

**No writes, no wallet.** Every value on the page is public state and every mutation belongs to the
operator's scripts. A judge can open the page cold, and the dashboard can never spend an organism's
STT by accident.

**A failed read is a state, not a crash.** `PushedPriceSource.currentWindow` reverts `NoWindow`
before the first push and `StalePrice` past `maxStaleness` (180s) — both ordinary. Every read group
settles independently (`Promise.allSettled`), the header explains the revert in plain English, and a
failed group degrades to `—` while the rest of the page stays live. The last good frame stays on
screen rather than being replaced by a blank one.

**The claim is rendered from chain state, not from prose.** While `SelectionEngine.fallbackEnabled`
is `true`, the claim panel shows the *weaker* licensed wording — "selection is on-chain and atomic
with redemption", **not** "no keeper anywhere in the causal chain" — quoting `README.md:100-106`
verbatim, and it links the newest `Reacted` event with its `viaReactivity` flag as evidence. The
page cannot overstate the honesty gate, because it reads the gate.

**Death is not hidden.** Dead organisms stay in the grid, dimmed; dead edges stay in the tree,
dashed. Death is the primary signal in a population under selection pressure, not an error to
suppress.

**Motion is a property of the diff, never of rendering.** `main.js` repaints by full teardown, so
animating on paint would replay the whole page every ten seconds and make a poll where nothing
happened look identical to a poll where an organism died. Instead `main.js` compares the previous
snapshot to the next one, `render.js` stamps `data-fx` on the nodes that changed, and `js/motion.js`
plays a timeline per stamp after mount. Nothing stamped means nothing animates: an organism dies
once and is mourned once. Five transitions earn a timeline — `born`, `died`, `treasury`, `phase`,
`new` — and each corresponds to a real state change on chain. Nothing here fires on a timer.

**The page is never worse than un-animated.** Without `window.gsap`, or under
`prefers-reduced-motion`, every function in `motion.js` becomes a no-op and the page renders
complete and static. That promise needs more than a library check, because the entrances *hide*
things before revealing them: `fromTo` applies its from-state synchronously, so a frame clock that
stalls after script has run would leave the population laid out, sized, and invisible. Two defences
keep it, in this order. `onClockAlive()` builds every timeline inside the first
`requestAnimationFrame` callback, so a page that never gets composited never hides anything —
un-animated, not blank. `guarantee()` then puts a `setTimeout` deadline on the timeline for a clock
that starts and *then* stops, event-loop driven rather than frame driven, and jumps it to the end if
it has not finished on its own. **A tween that starts from `opacity: 0` must go into a timeline that
carries that deadline.**

**Do not time-verify any of this with `--virtual-time-budget`.** Chrome races the virtual clock ahead
while GSAP's ticker advances on `performance.now()` deltas, so a capture labelled 2200ms shows a
timeline that has advanced fifty real milliseconds — twelve cards at `opacity: 0`, which looks exactly
like the failure above and is not it. A `--dump-dom` at the same budget is what settled it: every
tween sat on its from-state with `.hero-thesis` at `0.1757`. Sample on the wall clock instead — drive
the page over CDP (Node's global `WebSocket` speaks it with no dependencies) and read computed opacity
at real intervals. Measured that way the population is fully visible **1.0s** after navigation, the
last lineage edge lands at **1.6s**, and the scripted season's death and birth frames land on time.

## Files

| | |
|---|---|
| `index.html` | almost empty on purpose — every node is built by `render.js` |
| `app.css` | the only stylesheet link; `@import`s `fonts.css` then `tokens.css`, and holds no colour literal of its own |
| `tokens.css` | the design system — colour, size, radius, duration; the same file `app/src/styles.css` imports, so both surfaces cannot drift |
| `fonts.css` | the five `@font-face` declarations, every `src` pointing into `vendor/fonts/` |
| `config.js` | chain id, RPC, explorer, scan bounds, settings resolution |
| `vendor/gsap.min.js` | GSAP 3.13.0 UMD, **committed to the repo**, not fetched |
| `vendor/fonts/` | Newsreader (upright + italic) and IBM Plex Sans/Mono as `.woff2`, **committed** — no font CDN, so `?demo=1` still holds with the network unplugged |
| `js/viem.js` | the single pinned CDN import (`esm.sh/viem@2.56.0`) |
| `js/abi.js` | hand-written ABI fragments — only what this page reads |
| `js/chain.js` | client, `discover`, `readState`, `readOrganism`, `readFeed`, block stamps |
| `js/format.js` | units, durations, percentages — BigInt-first, never a float mid-calculation |
| `js/labels.js` | enum names for `Belief`, `Thesis`, `phase` |
| `js/lineage.js` | snapshot array → drawable tree, census, `rootKind` |
| `js/dom.js` | six functions of DOM plumbing, text-node only |
| `js/render.js` | every pixel; cannot fetch |
| `js/motion.js` | the timelines; plays only what the diff stamped, and no-ops without GSAP |
| `js/main.js` | the only mutable state and the only clock; cannot paint |
| `js/fixture.js` | the offline population behind `?demo=1` |
| `test/smoke.mjs` | the renderer, run against the fixture under a fake DOM |
| `package.json` | one line telling Node these are ES modules; no dependencies, no install |

**The theme is a single fixed dark.** There is no `prefers-color-scheme` block, which is a decision
rather than an omission: a light fallback is a second design nobody reviewed, and on a projector it
is the one that shows up. One look means the author, the operator and a judge see the same page.

**GSAP is vendored, not imported.** `vendor/gsap.min.js` is a file in this repository, loaded by a
plain script tag. `?demo=1` is documented above as working with the network unplugged, and a CDN
import would have broken exactly that, in a venue, at the worst possible moment. It is also still
not a dependency: nothing installs it, nothing builds it, and deleting it degrades the page to
static rather than breaking it.

`render.js` cannot fetch and `chain.js` cannot paint. That split is what keeps the fixture honest:
`?demo=1` replaces `main.js`'s data source and nothing downstream knows the difference.

## Two details that are easy to get wrong

**`phase` is a state, not a next action.** `Population.sol:92` documents it as `0 idle, 1 thinking,
2 committed`, while `scripts/lib/darwin.ts` labels the same value by the call it implies
(`THINK`/`COMMIT`/`SETTLE`). Those are off by one and both are correct in their own frame, so the
header renders **both**: the state as the value, the next driver call as the note under it.

**`currentStake` and `currentQuantity` are different numbers.** A paired position is funded by both
sides, so each organism *holds* `quantity` tokens while having *risked* `stake`. Deriving one from
the other makes every winner read as break-even and silently zeroes the fitness signal. The detail
pane shows them as two fields, labelled.
