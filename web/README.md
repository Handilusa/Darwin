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

This is how to review the frontend before Season 0 exists.

## Verify it without a browser

```bash
npm test --prefix web      # or: node web/test/smoke.mjs
```

`test/smoke.mjs` puts a 60-line fake DOM in front of the **real** renderer and calls every exported
render function on the fixture — twenty of them, including the degraded paths (`grid([])`,
`detail(null)`, a header with no window, an RPC error banner) — then asserts on the text and CSS
classes that come back. Thirty-one assertions: that a founder, a child and a paying entrant each
read differently; that both runway severity bands actually appear; that all 21 log rows render and
none falls through to the unknown-event fallback; that `fallbackEnabled: true` yields the *weaker*
claim; that both corpses stay on the page.

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
(`Population.sol:575`) is permissionless: anybody with testnet tUSDC and a little STT can spawn an
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

## Files

| | |
|---|---|
| `index.html` | almost empty on purpose — every node is built by `render.js` |
| `app.css` | one stylesheet, tokens + light mode + reduced motion |
| `config.js` | chain id, RPC, explorer, scan bounds, settings resolution |
| `js/viem.js` | the single pinned CDN import (`esm.sh/viem@2.56.0`) |
| `js/abi.js` | hand-written ABI fragments — only what this page reads |
| `js/chain.js` | client, `discover`, `readState`, `readOrganism`, `readFeed`, block stamps |
| `js/format.js` | units, durations, percentages — BigInt-first, never a float mid-calculation |
| `js/labels.js` | enum names for `Belief`, `Thesis`, `phase` |
| `js/lineage.js` | snapshot array → drawable tree, census, `rootKind` |
| `js/dom.js` | six functions of DOM plumbing, text-node only |
| `js/render.js` | every pixel; cannot fetch |
| `js/main.js` | the only mutable state and the only clock; cannot paint |
| `js/fixture.js` | the offline population behind `?demo=1` |
| `test/smoke.mjs` | the renderer, run against the fixture under a fake DOM |
| `package.json` | one line telling Node these are ES modules; no dependencies, no install |

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
