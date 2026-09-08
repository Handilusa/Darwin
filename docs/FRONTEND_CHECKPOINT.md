# FRONTEND CHECKPOINT — 2026-09-01, last appended 2026-09-02

> **PICK UP AT §8.12.** The `/arena` front-door simplification is fully implemented and `web/`'s own
> tests plus the build are green, but `node app/test/arena.mjs` stops on **exactly one** failing check
> (the closed `<details>` still reports a box) whose *cause has not been established* — page or
> assertion, both still candidates — and `landing.mjs` / `shots.mjs` were never run. Nothing is
> deployed. §8.12 carries the probe that settles it and the exact order to finish in.

Where the two frontend surfaces actually are, written to be picked up cold.
Companion to `docs/SESSION_CHECKPOINT.md`, which covers contracts and ops and whose §"Resume
here" item 1 describes `web/` **before** this segment re-themed it.

Submission is **2026-09-08**. Storage freeze for the Season 0 deploy is **2026-09-02**.

**Format rule, same as the other checkpoint:** anything stated as done names how it was
verified. Anything that was only *read* rather than *run* says so, in bold. There is no
longer any such item — every claim below was either run or looked at.

---

## 0. The one-line answer

Both surfaces are **done and verified running in a browser**. The console re-theme, which the
previous version of this file recorded as *written but never executed*, has now been built,
driven over CDP (`arena.mjs` 12/12 at the time, `landing.mjs` 7/7 — **ten checks as of 2026-09-03**,
§8.15) and **looked at by eye** — four
display defects and two layout defects came out of the looking, all six fixed. §5 is the record.
`arena.mjs` has since grown checks **5b**, **11b**, **12b**, **12c** and **13**; both harnesses PASS as
of 2026-09-01, and §8.12's front-door simplification left `arena.mjs` at FAIL — 1 problem for a while.
**That is closed: `arena.mjs` is PASS again as of 2026-09-02**, re-run against a fresh `npm run build`
after §8.8 item 4 landed (13 cards, 3 corpses, 0 stranded, 0 console errors, 0 exceptions, 0
off-origin requests).

**Then a new segment opened: the `/arena` judge-legibility rebrand
(`Arena_rebrand.txt`). It is audited, approved, IMPLEMENTED and — as of 2026-09-02 — fully verified and
CLOSED, §8.14 being the last item.** §8.7's seven files were written by
one session and executed by the next, on 2026-09-01: `npm test --prefix web` green (28 render calls,
112 assertions — that run's figures, kept as the record; the suite is **189 checks over 167 `assert()`
call sites** as of 2026-09-05, having gained the 23-key null sweep, the settlement branches, the
read-verdict block, the season close and twelve detector
self-tests — §8.13, §8.16 and §8.17),
`node app/test/arena.mjs` PASS, `npm run build` clean, stills recaptured. 45
findings, 7 blocking; the blocking one at `render.js:157` that stated something factually false about
what thinking costs is **fixed**, as is the front door (the user's *"¿qué coño tengo que poner
aquí?"*), which now leads with a five-beat `primer()` instead of an address form. §8.3 records two
process failures in the audit run that a future session must read before re-running anything, and
§8.4 records the constraint the user sharpened on 2026-08-31 and the one audit recommendation it
rules out.

**The last blocking gap is CLOSED.** The population grid sorted by treasury descending, so the
organism that starved sank below the fold *as it died* — the most dramatic event on the page
happening off-screen, and worse, happening off-screen **at rest**: the fixture opened with two
corpses already at `y=1060` in a 1000px viewport, so no animation-based fix could have reached it.
The dead now leave the grid entirely and sit as 46px tombstones **above** it. Cold load, measured:
lowest corpse `bottom 552`, `#header` down from 422px to **343px**. §8.9 has the design, the
geometry, the two measurement traps found while verifying it, and what guards it from regressing.

**Then the front door was opened in a browser for the first time (§8.8 item 2) and it paid for
itself twice.** The three founder genomes that `render.js` captions *"quoted from
`genomes/genesis.json`"* were not: two had a comma silently promoted to a full stop at the elision.
And the primer's five beat claims — the skim path, the five lines a judge is meant to be able to read
*instead of* the prose — were rendering as 11px uppercase mono in `--text-3`, byte-identical to the
words "NOTHING IS DEPLOYED YET" in the form below, because `.panel h3` outranks `.beat-claim` by one
type selector. Both are fixed and both are now **guarded**: the quotes against the real file on every
`npm test --prefix web`, the claims by computed style in `arena.mjs` check 12b. §8.10 is the record.

**That second defect turned out to be an instance, not an incident, so the shape was hunted
deliberately — and the sweep found three more, then a fourth.** A rule whose declarations are only
meaningful as an *undo* or as a *win*, outranked by one it was written to beat: no error, no exception,
nothing missing from the DOM, every machine check green. The census printed the count of the **dead** at
full `--text`, as loud as the living beside it; moving the pointer onto the **selected** card erased its
own selection edge; and a **corpse in the lineage tree answered neither the cursor nor a click** — which
is the worst of the three, because most of any ancestry is dead. All three fixed, all three now guarded
by `arena.mjs` check **11b**, which forces `:hover` over CDP and compares every state against a control
read off the same page. Verified able to fail: with the three rules disabled the check reports
**FAIL — 4 problems** while both controls stay green.

**The fourth was found by measuring rather than by reading, which is the lesson.** Walking every
rendered element over CDP and asking which declarations *lost* — then bucketing each loss by whether
specificity or mere **source order** decided it — turned up a defect in the one modality reading the
sheet cannot see: a `@media` block adds no specificity, so the 720px `.panel { padding }` does not
outrank `.panel-primer { padding }`, it just sits later. `.panel-setup` was restated inside that block
and `.panel-primer` was not, so at phone width the primer's content sat **8px inside** the setup
panel's while their two boxes stayed flush — stepping, on the pre-Season-0 front door, in violation of
the invariant `.panel-primer`'s own comment states. Fixed, and guarded by check **12c**, which measures
at 1400px as well as 700px so the check cannot be confused with one that always passes. §8.11 is the
record for all four, including the two bugs in my own instrument that made two of the earlier findings
look refuted, and the modality census that says what is actually left to sweep.

What remains is **not blocking**: the `breedStreak` / `breedSurplusBps` gap and §5.4. §8.8 items 4
and 5.


---

## 1. What was asked for

> *"Ya lo vi, me encanta muchas gracias prosigue hazla landing page mete rainbow kit y deja la
> consola con este mismo tema"*

Three clauses:

| # | Clause | Status |
|---|---|---|
| 1 | the landing page | **DONE**, verified over CDP on the wall clock |
| 2 | RainbowKit | **DONE**, `ConnectButton` asserted present in the built page |
| 3 | the console on the same theme | **WRITTEN, NOT VERIFIED** — §5 |

Standing instructions this work is measured against, both from earlier messages and still in
force: *"que parezca de verdad un producto con inversores… eso no gana hackathons"*, and
*"que no sea plano basicamente ni un solo color que tenga identidad animaciones en gsap"*.
Genome authoring is **editable templates** (chosen by the user, not by me). Reown/WalletConnect
projectId `006c638cc6ec95a3982952a1ee86aa05` — it ships in the client bundle by design and is
not a secret. Gas and faucet provisioning were **deferred by the user to the end**.

---

## 2. The design system — read this before touching a colour

One file, two surfaces, no second copy: **`web/tokens.css`** plus **`web/fonts.css`**.
`app/src/styles.css` and `web/app.css` each `@import` both, in that order. A colour that exists
in only one surface is a bug — the judge crosses from landing to arena in one click.

**Dark only, deliberately.** There is no light palette and adding one would break the central
metaphor (dark-field microscopy; "the light goes out"). Both `tokens.css` and `web/README.md:214`
state this as a commitment rather than an omission. Do not "fix" it.

**Four hues, and each one is a claim about mechanism:**

| Token | Hex | Means |
|---|---|---|
| `--life` | `#5fe3c0` | alive · `Belief.Up` · a claim that settled correct |
| `--heat` | `#f0a055` | cost · `Belief.Down` · what an organism pays to think |
| `--ash` | `#7a7686` | dead — desaturated, so a corpse reads *drained*, not merely dim |
| `--bad` | `#f2645f` | wrong — its own alarm hue, because *expensive* and *wrong* are different claims |

Ground is a blue-green black, never neutral: `--ink #060d0c` → `--ink-4 #162926`.
**Structure takes no hue at all** — panels, rules, labels and the phase track use only
`--line*` and `--text*`. Thesis (Momentum/Reversion/Breakout/Range) is deliberately never a
colour, only a word.

**Type:** `Newsreader` (`--f-display`), `IBM Plex Sans` (`--f-sans`), `IBM Plex Mono`
(`--f-mono`), all vendored under `web/vendor/fonts` and never fetched from Google, because
`?demo=1` is documented three times as working with the network unplugged.

> **Weight trap, hit for real.** Upright `Newsreader` is vendored at **400 only** (italic
> 300–400); Plex Mono at 400 and 500. A `font-weight: 300` on display type silently resolves
> back to 400 — browsers do not synthesise lighter weights. Five rules in `web/app.css` were
> written at 300 and corrected to 400. Read `web/fonts.css` before typing a weight.

---

## 3. Surface A — the landing (`darwin/app/`) — DONE

Vite + npm + React, wagmi + TanStack Query + RainbowKit. Served at `/`. Seven sections:
`#top #genome #window #cognition #death #lineage #enter`.

The four animations the user asked for by name are in: phase-offset vital-sign pulse on the
twelve organisms, animated numeric counters for the settlement clock and the −0.05 metabolism,
a slow one-way death (not recyclable), and lineage threads that draw themselves on scroll via
`stroke-dashoffset`.

**Verified by running it, not by reading it.** `app/test/landing.mjs` drives the built page over
CDP and samples on the wall clock:

```
PASS — landing renders, reveals complete, death fires and stays fired, and a
       non-Population address withholds the form
```

**Ten checks** (checks 8-10 added 2026-09-03, see §8.15): no console errors / unhandled
rejections / `console.warn`; the seven sections plus the RainbowKit button in the DOM; the hero
canvas actually paints; all three vendored families loaded (no silent fallback); nothing stranded
at `opacity: 0` at six scroll stops; scrolling to `#death` kills one organism and scrolling away
does **not** revive it — calibrated against a living cell in the same frame rather than an
absolute threshold, so it survives a palette change; the entry surface renders either the form or
the undeployed notice; **an address with no code behind it withholds the form and names why**;
**the hero's live dot does not pulse over reads that failed**; and **a malformed `?population=`
is said out loud rather than silently dropped**.

The last three each navigate again with a chosen query string, and each is paired with a control
that requires the same detector to report something *different* on the shipped page — the standing
convention of this repo (§8.13, and `web/test/smoke.mjs`). Check 7 alone is exactly the shape that
cannot fail: it accepts "the form OR the undeployed notice", which is both branches that existed
before the absent branch was written.

Keep this harness. It is the only executable check either surface has beyond `smoke.mjs`, and
check 6 is the one that would catch a regression contradicting `test_death_isIrreversible` on
screen.

---

## 4. Surface B — the console (`darwin/web/`) — what changed this segment

Zero-build: ES modules, viem from `https://esm.sh/viem@2.56.0`, GSAP vendored. Served verbatim
at `/arena` by the `arena()` plugin in `vite.config.js`; it never enters the bundler.

### 4.1 `web/app.css` — rewritten from scratch

The old file was built on a palette that no longer exists (`--void #06080d`, `--abyss #0b0e15`,
an indigo `--helix` against `--vital`/`--lethal`/`--amber`, and a header rule reading *"TWO
COLOUR VOCABULARIES, AND THEY NEVER MIX"*). It was replaced wholesale on `tokens.css` rather
than patched. Every class rendered by `render.js`, `main.js` and `index.html` was harvested by
grep before writing, so the inventory is covered.

Three rules the file's own header records, because breaking any of them is invisible in review:

1. `.card-dead { filter: saturate(0.15) }` — **that exact value is duplicated in
   `js/motion.js`'s `died()` timeline**, which ends there before `clearProps` drops the inline
   style. If the two drift, a card visibly jumps at the end of the death animation.
2. No CSS `transition` on `width` for `.vitals-fill`, on `background-color` for `.feed-row`, or
   on `transform`/`opacity` for `.card`, `.metric-value`, `.hero-thesis`, `.phase-node` — those
   properties belong to GSAP and a transition would fight the tween.
3. Everything must still read with GSAP absent. **Nothing starts at `opacity: 0`.**

### 4.2 `web/index.html` — re-headed

`<meta name="color-scheme" content="dark">`, `<meta name="theme-color" content="#060d0c">`, the
single stylesheet `<link>` (one link, not three — the cascade order fonts → tokens → app is
load-bearing and expressing it inside the stylesheet makes it unbreakable by reordering markup),
two font preloads, and the purple-helix favicon replaced by the mint-cell mark copied verbatim
from `app/index.html` so the tab does not change identity on the click-through.

> `crossorigin` on those preloads is **not** optional even though the files are same-origin:
> fonts fetch in CORS mode, and without it the browser discards the preload and downloads the
> file a second time. The two serif faces are deliberately *not* preloaded — 146KB of italic
> Newsreader must not compete with the RPC call the page exists to make.

### 4.3 `web/js/motion.js` — the blocking bug this segment found

**All four token reads pointed at names `tokens.css` does not define**, so each silently
resolved to a hardcoded fallback from the retired palette:

| Was | Now | Why it mattered |
|---|---|---|
| `--vital` / `#00e68a` | `--life` / `#5fe3c0` | count-up colour |
| `--lethal` / `#ff3d6e` | `--bad` / `#f2645f` | the death flash was pink; `--bad` is coral |
| `--helix` / `#7a5cff` | `--life` / `#5fe3c0` | **a birth bloomed indigo on a mint-and-amber page** |
| `--helix-wash` / `#14112b` | `--life-deep` / `#113029` | the new-feed-row wash |

The page around them looked perfectly themed, which is exactly why nobody would have caught it
before a judge did. `token()`'s own header had warned about this class of drift and the warning
did not save it, so a fifth edit made the failure loud: **`token()` now `console.warn`s once per
missing name** instead of quietly returning something plausible. If that warning ever appears,
the fix is the token name at the call site, never a nicer hex in `motion.js`.

Two docblocks were rewritten to say what the timelines now mean: the death bloom is `--bad` and
not `--ash` because *the moment of dying is an alarm and the state afterwards is drained* —
`.card-dead` supplies the ash; and a birth blooms in `--life` and nothing else, because the only
thing true of a newborn yet is that it is alive. There is deliberately no separate brand hue for
the arena to wear.

### 4.4 Invariants preserved — check these survived any edit you make

- **No `innerHTML` anywhere in `web/`.** `Population.enter` is permissionless, so every genome
  on screen is untrusted public input. Grep for it as a review step. `smoke.mjs`'s fake DOM has
  no `innerHTML` setter and that absence is the enforcement — do not "fix" it.
- Motion is a property of the **diff**, never of rendering. `main.js` compares snapshots,
  `render.js` stamps `data-fx`, `motion.js` plays one timeline per stamp.
- Without GSAP or under `prefers-reduced-motion` every timeline is a no-op and the page must
  render complete and static.

---

## 5. DONE — §5.1 to §5.3 closed 2026-08-31, §5.4 closed 2026-09-02 as DO NOT BUILD (§8.14). Nothing open here.

Everything below is kept as the record of what was verified and how, because the *method* is
reusable and the traps are still traps. Re-run order if you touch `web/`: `npm test --prefix web`
→ `npm run build` (from `app/`) → `node test/arena.mjs` → `node test/shots.mjs` and look.

### 5.1 Run the smoke test — CLOSED, ALL GREEN

Ran after every edit of this segment. 78 assertions, 24 render calls, no browser, no network.
*(Those two figures are what this run measured on 2026-08-31 and are kept as the record. The suite has
grown since: **189 checks over 167 `assert()` call sites, measured 2026-09-05**, driven by 50 renderer
call sites and 313 executed renderer calls excluding the `chip` leaf helper — §8.8 item 1 carries the
live count, §8.17 carries the basis, and `darwin/CLAUDE.md` is the one place to keep current. The
figure this parenthetical used to give as "36 render calls" was never a count of render calls at all;
it was the number of probe lines the harness prints. See §8.17.)*

```powershell
cd C:\Users\Handi\Desktop\somnia_predict\darwin
npm test --prefix web
```

### 5.2 Load the console in a browser and look at it — CLOSED

Two harnesses now do this, and the shared CDP driver they both sit on is **`app/test/cdp.mjs`**
(launcher, the `DevToolsActivePort` dance, and `classify()`'s console-event buckets — including a
`warnings` bucket, because `motion.js`'s missing-token guard reports drift as `console.warn`, and a
`requested` bucket so a harness can assert what the page did *not* ask for). `landing.mjs` was
rewritten onto it and still passes, so all three surfaces share one driver.

```powershell
cd C:\Users\Handi\Desktop\somnia_predict\darwin\app
npm run build ; npm run preview      # then, in another shell:
node test/arena.mjs                  # 119 failure conditions — PASS
node test/shots.mjs                  # 9 stills into web/.shots/, asserts nothing (0 by design)
node test/landing.mjs                # 15 failure conditions — PASS
```

**The two figures above are `fail.push` call sites, counted 2026-09-02**, and the counting method is
written down for the same reason the scripted season's 44 is (§8.12): they used to read "12 checks" and
"7 checks", which were true of much smaller files and then drifted silently for weeks while `arena.mjs`
grew to 1,416 lines. A figure nobody can re-derive is worse than no figure. Re-derive with
`grep -c 'fail\.push' app/test/arena.mjs`.

**`arena.mjs`** samples the scripted season on the wall clock at the offsets `fixture.js`'s SCRIPT
implies (4200 / 9400 / 14000 / 18000 ms) and closes every claim §4 used to *argue*:

| Asserted | Reading |
|---|---|
| the corpse does not jump (invariant 4.1.1) | `#8 card-dead=true filter=saturate(0.15) inline="" opacity=1` |
| a birth blooms mint, never indigo | 9 samples on `#13`, all `[95,227,192]` |
| the retired palette is gone | 0 hits for `--vital` / `--lethal` / `--helix` / `--helix-wash` |
| the token-drift guard is silent | 0 `motion.js` warnings on either view |
| the ground is blue-green black, not neutral | `rgb(6, 13, 12)`, green+blue above red |
| nothing is stranded invisible | `stranded 0` after the entrance *and* on the final frame |
| **`?demo=1` runs with the network unplugged** | `20 requests, 0 off-origin` — asserted, not believed |
| the undeployed front door has an identity | wordmark `DARWINarena`, thesis present, panel 2 columns |

Each hue check carries a **control** so it cannot pass vacuously — a living card's `box-shadow` is
`none` and an unstamped feed row's background is `rgba(0, 0, 0, 0)`, which is what proves the samples
come from a running timeline and not from static CSS. Nine identical `[242,100,95]` readings mean
nothing without that.

Three traps, all hit for real on this machine:

- **`vite preview` binds `::1` only.** Use `localhost` or `[::1]`. `127.0.0.1` will refuse.
- **Port 9222 is permanently held by `msedgewebview2.exe` here.** `cdp.mjs` asks for
  `--remote-debugging-port=0` and reads the real port back out of `DevToolsActivePort` for
  exactly this reason. Do not hardcode 9222 — it hangs for minutes and answers from the wrong
  browser.
- **Never time-verify motion with `--virtual-time-budget`** (also in `CLAUDE.md`). Chrome races
  the virtual clock while GSAP's ticker reads `performance.now()`, so a capture labelled 2200ms
  shows a timeline fifty real milliseconds in — an entire population at `opacity: 0`,
  indistinguishable from the bug the reveal defences exist to prevent. Sample on the wall clock.

And one more, found by `shots.mjs` itself: **a screenshot costs wall-clock time the timeline does
not pause for.** Full-page captures cost ~2.6s, so the first version photographed a death 2.3s
after it happened and labelled it "midflight" — a perfectly good still of the wrong moment, which
nothing else would have noticed. Hence two passes (viewport-only during the season, full-page on a
separate navigation) and a `LATE by Nms` warning. The log also reads the clock *before* the capture
call, because the 0.5–1.3s PNG encode happens after the frame is grabbed.

**Four defects the eyes-on pass found that no assertion had covered.** All four are display-site
fixes; `format.units` was left untouched because its doc comment pins it character-for-character to
`scripts/lib/darwin.ts:320-327`, and the page and `monitor.ts` must never round differently.

1. **The undeployed page had no header at all.** `main.js:179` mounted nothing, because `header()`
   needs a snapshot and a resolved config and there is neither before Season 0 — so *the page a
   judge sees today* was a bare form floating in the dark. Fixed with `render.masthead()`, which
   carries only what is honest with no chain to read: wordmark, the thesis, the lede. `arena.mjs`
   now asserts all three, so it cannot be lost again.
2. **The treasury column did not align decimals** (`58.42` / `22.5` / `4`) and `motion.js`'s
   `grouped()` trimmed trailing zeros, so a counting number changed width every frame. New
   `format.moneyFixed` pads the fraction; `grouped()` no longer trims, documented as the one place
   it deliberately differs from `units` and must stay paired with `moneyFixed`.
3. **The metrics strip mixed precisions of one unit** — `3.9 tUSDC` beside `3.21` and `1.28`. New
   `money2Fixed` used for ante / prize pool / rake only; `money2` is unchanged because the feed says
   *"paid 3.9 tUSDC rake on 12.4 tUSDC"* in prose, where a padded zero is noise.
4. **A boxed inline `code` split across a line break.** UAX #14 permits a break after `?`, so the
   footer's `?population=0x…` became an orphaned boxed `?` at the end of one line with the rest
   starting the next, borders drawn on both halves — it read as a rendering fault, not a parameter.
   `code { white-space: nowrap }`, with `.bad code` / `.banner code` / `.error-list code` exempted
   because `badQuery` is whatever a visitor typed into the URL bar and has no length bound.

Plus two layout fixes on the same page, both the same defect: **a grid with columns its content
does not fill reads as a layout that broke.** `.panel-setup` became two columns (form left,
"nothing is deployed yet" right) instead of a single column beside dead space, and
`.hero-plain .hero-argument` sets the masthead as one composition — display line and lede side by
side, bottom-aligned, bounded to the *same* 62rem as the panel below, so the page has one left-hand
measure instead of two. It uses `repeat(auto-fit, minmax(min(22rem, 100%), 1fr))` rather than two
explicit tracks so it needs no breakpoint of its own: two columns appear only once both fit.

Both `.hero-plain` rules are **descendant selectors, not modifier classes**, and that is
load-bearing: the `max-width: 1180px` and `max-width: 720px` queries re-declare `.hero-grid`'s
columns at equal specificity and later in the file, so a `.hero-grid-plain` modifier would have
been quietly won back at exactly those widths.

**One finding NOT acted on, because it is a product call and not a bug.** The population grid sorts
by treasury descending, so `#8` — the organism that starves — sinks *as it dies*. At 1600x1000 the
third row is the last partially-visible one, and the corpse lands below it: the most dramatic event
on the page happens off-screen, and so does the feed that narrates it. A judge learns the death
happened only from the `ALIVE` counter animating 10 → 9. The sort is semantically right (a
leaderboard; a dying treasury *is* near zero), which is exactly why the fix is a decision about
what the viewport should show first rather than a defect to quietly patch. Options, cheapest first:
lift the feed above the population grid; give the grid its own scroll box so the page's later
sections start higher; or exclude the dead from the treasury ranking and give them their own band.

### 5.3 One small doc fix — CLOSED

`web/README.md`'s file table now describes `app.css` as what it is (the only stylesheet link, which
`@import`s `fonts.css` then `tokens.css` and holds no colour literal of its own) and lists the three
files it had been omitting: `tokens.css`, `fonts.css` and `vendor/fonts/`. Everything else in that
README survived the re-theme intact — it never names a hex, and its "single fixed dark" paragraph
and the amber demo banner note are both still exactly true.

### 5.4 CLOSED 2026-09-02 as DO NOT BUILD — see §8.14

An extra `motion.js` timeline for a paired duel resolving. From an earlier plan of mine, never
an explicit user request. Everything above mattered more, and all of it is now done.

**It is not "still open", and it is not deferred: it is closed, and the reason is written down in
§8.14.** Short version — the read surface carries no counterparty field (`snapshot()` at `abi.js:43`
and the per-organism reads at `:132-139`; the pairing lives only in the `Paired` event), and the feed
refreshes on a different clock from the snapshot (`POLL_FEED_EVERY_MS = 60_000` over a sliding range,
`main.js:94-100`, `:494-496`). So the timeline would either invent the pairing or animate a stale one
as if it were live, against a page whose stated invariant is that motion is a property of the diff.


---

## 6. Deferred by the user, not forgotten

**STT funding / faucet provisioning** — *"en cuanto al gas la faucet y todo eso la pedire al
final cuando el proyecto este casi terminado"*. It is the top project risk per
`SESSION_CHECKPOINT.md` §3 row 16 (~253 STT for a continuous run against a documented 1 STT/day
self-serve faucet), and the mitigation is known and cheap: pausing the cadence costs nothing on
chain, so a short-funded run becomes bursts rather than a smaller population.

**Deploying and broadcasting are the user's call, not a session's.** The deploy spends real STT
and starts a run whose lineage graph cannot be rebuilt.

---

## 7. Facts that would be expensive to rediscover

- `web/` is served at `/arena` by the `arena()` plugin in `app/vite.config.js`, verbatim, and
  never passes through the bundler. That is what lets it keep the no-build promise while sharing
  `tokens.css` with a Vite app.
- `.field { display: contents }` in `web/app.css` is not a hack: it makes `field()`'s label and
  value spans become cells of `.detail-fields`'s two-column grid.
- `.hero-thesis em` is `--ash`, not `--bad`, because the emphasised word is *"die"* and ash is
  the palette's own mapping for dead. `--bad` means *wrong*. The landing's equivalent em is
  "pays to think" in `--life` (`app/src/sections/Hero.jsx:281`), so the two surfaces do not
  contradict each other.
- `--ash` measures ~4.3:1 on `--ink-2`, so it is used **only** for dead organisms and for large
  display type where the 3:1 floor applies. Do not reach for it as a body-text grey; that is
  what `--text-2` and `--text-3` are.
- `.sev-good/.sev-warn/.sev-bad` are `box-shadow: inset 2px 0 0` rails, not coloured rows —
  a dozen simultaneous feed events must not turn the page into a light show.
- PowerShell 5.1 has no `&&`, and `forge`'s lints go to **stderr**, so a clean build reports
  exit 1 here. Never chain on `$?` after `forge`. `forge` needs `.foundry/bin` prepended.

---

## 8. The `/arena` judge-legibility rebrand — audited, implemented AND fully verified. CLOSED 2026-09-02.

**Status, and read this before the historical paragraph below it.** All items §8.1–§8.17 are closed.
The full chain runs clean as of 2026-09-05: `npm test --prefix web` **189 PASS / 0 FAIL** over 167
`assert()` call sites, `npm run build --prefix app` clean with `dist/arena/ <- web/` **verified by hash,
0 of 11 files differing**, `node app/test/arena.mjs` **PASS**,
`node app/test/landing.mjs` **PASS** (now ten checks, §8.15). §5.4 is closed as do-not-build (§8.14).
Nothing in §8 is waiting on a session; what remains is the Season 0 deploy, which is the user's call
(§6). The `chain.js` divergence §8.15 reported is closed in §8.16 — both surfaces now classify a
read batch the same way.

~~**Seven files have been edited. NONE of it has been executed — see §8.7 for the exact list and
§8.8 for what is left.** The smoke test was green before the audit; it has **not been run since**,
because every remaining verification step needs Bash and the user cannot approve Bash calls in auto
mode. That is the single largest open risk in this document: the code is written and unrun.~~ —
**resolved; kept because the failure mode is worth remembering. "Written and unrun" was the single
largest risk here for two days, and §8.3's process note explains how it happened.**

The specification is `Arena_rebrand.txt`, which lives in the **parent** directory
(`somnia_predict/`), *outside* the git repo — the repo root is `darwin/`, so the brief is not
version-controlled with the code it specifies. Its thesis: *"The problem is communication, not
complexity. COMPLEX SYSTEM → SIMPLE INTERFACE. Do not hide complexity. Translate it. Do not remove
functionality just to reduce implementation complexity."* Six questions a judge must answer in
10–15 s: what DARWIN is, what an organism is, what the market window is, what the organism is
thinking, what settlement does, why organisms survive/die/reproduce.

### 8.1 What exists: an eight-question audit — 45 findings, 7 blocking

Full text with `file:line`, current copy, proposed copy and an invariant note per finding:

```
.tmp-verify/wf/audit-digest.md          (924 lines, 146 KB — copy kept inside the working dir)
```

Verdicts, worst first:

| Question | Verdict | Findings | Blocking |
|---|---|---|---|
| what happens when the Event Contract settles | **not-answered** | 6 | 1 |
| what the organism is thinking | partially | 11 | 3 |
| the empty/setup state | partially | 8 | 2 |
| what an organism is | partially | 4 | 1 |
| the observatory / participation split | partially | 7 | 0 |
| what is the current market window | partially | 5 | 0 |
| what is DARWIN | partially | 4 | 0 |
| why organisms survive, die, reproduce | partially | **0 — see §8.3** | 0 |

The blocking seven, in order of damage:

1. **`render.js:157` states something false.** *"pays real collateral to think"* — thinking is paid
   in **native STT** drawn from the organism's own balance (`Prophet.drawCognition`); collateral
   (tUSDC) pays metabolism and the ante. It is the only above-fold claim about cognition, and the
   landing already says it correctly (*"answers through on-chain inference"*,
   `app/src/sections/Hero.jsx:171-176`), so the two surfaces contradict each other today.
2. **One no-cfg card serves three different situations.** `main.js:445` paints with `app.cfg` still
   null, so on a **live** deploy the card whose sub-head reads *"Nothing is deployed yet"*
   (`render.js:1352`) is the first frame of a working arena, and it stays up for the whole of
   `chain.connect` + `chain.discover` — a cold cross-origin viem fetch plus ~19 reads. The brief's
   requested copy makes this strictly worse: the same branch would flash *"ARENA NOT INITIALIZED"*
   at a judge looking at a live population. The sibling surface already solved it —
   `app/src/lib/population.js:46-52` names exactly three states (loading / found / undeployed).
3. **Hierarchy inversion on the setup card** (the user's named grievance). *"Nothing is deployed
   yet"* is already written but as an h3 in column two at `--t-sm`, under an h2 in display serif
   giving an instruction the judge cannot obey (`render.js:1309`).
4. **`labels.js:15` leaves `BELIEF` as four bare words** while the same file spends nine lines
   glossing `phase`. `ABSTAIN` (#12) and `NONE` (#7) are indistinguishable on screen, and
   `beliefTag` (`render.js:58`) carries no `title` although every sibling span in `card-stats` does.
5. **The cannot-pay rule is absent three times over.** No copy anywhere in `web/`; no depiction (the
   fixture's #7 emits `ThinkFailed` **and** `CognitionUnspent`, which is the *platform-reverted*
   cause, not the out-of-STT one); and mistranslated — *"left 0.002 STT unspent"* (`render.js:1466`)
   reads as a refund when it records a deposit drawn for a request that never happened.
6. **The prompt/answer round trip is on screen with the prompt missing** and neither half labelled
   as a model transaction (`render.js:886`, `:897`). `Genome.beliefPrompt` is never rendered even
   though all five of its inputs are already in the window strip.
7. **On first paint there is no genome and no model output at all.** `app.selected` is null
   (`main.js:319`, `:469`), so the sticky column renders the invite; the verbatim answer and the
   validator count sit behind a click advertised in one line of muted text (`render.js:813`).

### 8.2 Verified by hand this session — not merely asserted by an agent

Each of these was re-checked against the code before being recorded. They are safe to act on.

- **The fixture depicts a state the chain cannot produce.** `fixture.js:117` and `:603` carry
  `belief: 3, thesis: 4`. With `BELIEF = [None, Up, Down, Abstain]` and
  `THESIS = [Unknown, Momentum, Reversion, Breakout, Range]` (`labels.js:15,18`) that is
  **Abstain + Range**, and `beliefTag` prints the thesis whenever `Number(thesis) > 0`
  (`render.js:64`). `Genome.parseAnswer` pairs Abstain only with `Thesis.Unknown` in its
  fall-through (`Genome.sol:187`), and `lastThesis` has exactly one writer, beside `belief`
  (`Prophet.sol:263`). So the state is unreachable. #12 in the same fixture is `thesis: 0` and
  renders a bare `ABSTAIN` — the correct and the impossible form of one state sit on the same
  screen. **Fix is two characters**, and it makes the fixture obey the rule it states about itself
  at `fixture.js:16-33`.
- **Beliefs never clear at settlement.** `Prophet.sol:528` (and `:215` on a new request) writes
  `Belief.None`; the scripted `settleAll` frame (`fixture.js:511-527`) updates ten treasuries,
  streaks and counters and clears no belief, so window 41's tags ride through settlement, through
  the birth, and into window 42. Combined with the demo names (`main.js:308-316`) six of seven
  named organisms answer their own name and never change — which reads exactly like *"a formula
  emitted a label"*, the failure mode the audit was pointed at.
- **`breedStreak` / `breedSurplusBps` are never read.** Public getters at `Population.sol:71-72`,
  absent from `abi.js` and from `chain.js`'s `keys` list; the only occurrence in `web/` is a
  comment at `fixture.js:412`. The two conditions for reproduction are not obtainable from the
  screen at any depth.
- **`"irreversib*"` never reaches a user.** Only `fixture.js:407` and `main.js:345`, both comments.
- **`"spectator"` appears zero times in `web/`**, and there is **no link to `/` anywhere** in
  `web/js` or `web/index.html`, while the landing sends judges to the arena from four places
  (`Nav.jsx:33`, `Hero.jsx:354`, `Hero.jsx:361`, `Footer.jsx:33`). The arena is a one-way door.
- **`metabolicCost` never appears as a price.** It is read (`chain.js:277`) and drives the vitals
  bar and runway, but as a number it surfaces only in a `title` (`render.js:1030`), a `Starved` feed
  row (`render.js:1580`) and the collapsed wiring `<details>` (`render.js:1994`). The stats rail
  shows five economic numbers, none of which is the cost of staying alive.

### 8.3 Two process failures in the audit run — read this before re-running anything

- **Question 6 came back empty and the loss is recoverable.** The `survive/die/reproduce` agent
  (`agent-ac7be793bdc9150b3.jsonl`, 82 records, no truncation, no API error) made exactly one
  `StructuredOutput` call and submitted `findings: []` — after writing a `whatAJudgeSeesToday` whose
  last paragraph names four real gaps. Those four are the last four bullets of §8.2, verified. The
  audits are **cached** on the workflow's runId, so any resume feeds the synthesis that same empty
  payload: question 6 must be supplied by hand.
- **The Design phase died twice, in the same place.** Three agents, both runs, each ending
  `[Request interrupted by user]` immediately after a `Read` of `web/app.css`, having been handed a
  **166 KB prompt** (the whole audit digest inlined at line 356 of the workflow script, which lived
  under the gitignored `.tmp-verify/` and is not in the tree — do not cite it as a path). Both runs
  coincided with a `claude-opus-5 temporarily unavailable` window, so availability is at least a
  contributing cause and possibly the whole of it. Judges and synthesis then scored an empty string
  and the synthesis said so honestly rather than inventing a plan. **Do not resume that script as
  written**: pass the digest as a *path to read* (`.tmp-verify/wf/audit-digest.md`) instead of
  inlining it, which takes the prompt from 166 KB to ~6 KB, and relaunch when the model is healthy.

### 8.4 The user's constraint, sharpened 2026-08-31 — and the one audit move it kills

> *"no podemos hacer cosas mock tenemos que hacerlo real por mas complicado que sea"*

This is a reaffirmation, not a new rule (`README`/`CLAUDE.md` invariant 7: `?demo=1` is a review
aid and must never be the default a judge lands on). Its consequence here is specific:

- **REJECTED — the audit's proposal to make `?demo=1` the primary action.** One HIGH finding
  proposes swapping the setup card's columns so *"Watch the offline demo"* becomes `btn-primary`
  and `Connect` drops to a plain button. Promoting synthetic data to the page's primary door is
  exactly what the rule forbids, however well-labelled the banner is. The fixture link stays
  (removing it would remove functionality, which the brief also forbids); it does not get the
  primary button.
- **Accepted, and it follows from the same rule:** every fixture change in §8.2 makes the fixture
  *more* faithful to `Population.sol` / `Prophet.sol` — they delete fictions rather than dress up a
  demo. That is the only kind of fixture work this rule permits.
- **The real fix for the empty state is the Season 0 deploy, and it is the user's call.** No copy
  makes an undeployed arena into a live one. Storage freezes 2026-09-02, submission is 2026-09-08.
  Until then the empty state is a safety net, not the product.

### 8.5 Test impact — `app/test/arena.mjs` Check 12 rewritten, not deleted — CLOSED 2026-09-02

**Both assertions have been re-expressed as their intent and the section is closed.** Verified by
reading the current file, not by trusting this note: search `arena.mjs` for `thesisWords` and
`thesisStranded`. What replaced them:

- The phrase test `!/lose money/i.test(setup.thesisText)` is gone. Falsifiability is a judgment about
  meaning that no harness can make, so the check was split honestly: the *shape* is asserted (at
  least four words, terminal punctuation, not the wordmark wearing a full stop, not a verbatim copy
  of the primer's own lede) and the *substance* is printed verbatim in the run's `thesis` line for
  whoever reads it. A check that pretended to judge meaning would have been §8.8 item 5's own defect.
- `setup.panelCols !== 2` is gone. The defect was never a column count — a correct three-column
  layout failed it and a wrong two-column layout passed — it is one short sentence in a narrow
  measure **with nothing beside it**. So `thesisStranded` looks for what sits to the sentence's
  right, and narrowness alone is not the fault. It carries its own control, and the control is
  checked *first*: if the detector cannot report a stranded sentence, the live verdict under it is
  called decoration and the check fails.

Both were green in the 2026-09-02 run: `thesis "Organisms that lose money die." (4 words)` and
`space 27% of the header, narrow, beside="hero-lede" · stranded=false (control true)`. Note that the
phrase the retired assertion pinned did survive the rebrand — which is exactly why pinning it was a
bad test rather than a lucky one.

The original statement of the problem, kept because the reasoning generalises:

> Check 12 ("THE PAGE A JUDGE SEES TODAY: NO DEPLOYMENT") has five assertions over the setup card.
> Two of them break on any honest rebrand and must be re-expressed as their *intent*:
> the hero-copy assertion should test that the hero makes a falsifiable claim, not that it contains
> one phrase; and the `panelCols !== 2` assertion should assert **no stranded sentence / no dead
> space** (*"a one-child three-column grid strands the sentence at 42% width"*), not a column count.
> Do not satisfy the second with a decorative second column.

`arena.mjs` sleeps 2600 ms after navigate, so it samples the settled state. The no-mocks guard — the
demo banner must still say *Synthetic* — stays exactly as it is.

**Note added 2026-09-01:** Check 12 has since grown a sibling, **12b**, asserting the primer's five
beat claims outrank their own prose (§8.10). 12b was written the way this section asked Check 12 to
be rewritten — relatively, against two other elements read off the same page, so no literal value is
pinned and a token rescale cannot break it. It was the model used. Find any assertion named here by
its text, never by line number.

### 8.6 The grid-sort question — RESOLVED 2026-09-01 by option 3. See §8.9.

- **The population grid sort. CLOSED.** The record of the problem, kept because the reasoning is
  reusable: the grid sorts by treasury descending, so the starving organism **sank below the fold as
  it died** — the one moment the whole thesis rests on. Three options were on record: lift the feed
  above the grid; give the grid its own scroll box; or exclude the dead from the treasury ranking and
  give them their own band. **The third shipped.** The audit independently reached the same place
  from a different direction (*"at the moment an organism dies, nothing in the viewport changes"*)
  and one MEDIUM finding proposed the first option — mount `feed(...)` immediately after the split in
  `paint()` (`main.js:221-230`), which also promotes the only place the validator attestation is
  readable (`render.js:1133-1145`) from eighth to third.
  - **Why option 1 was rejected, on evidence rather than taste:** `main.js:221-225` mounts the split
    (population + genome detail) as one node and the feed after it, so moving the feed above the
    split moves it above *both* — it would push the population itself down, trading a hidden corpse
    for a hidden population. It also does not touch the actual defect: the dead would still be
    sorted to the back of a 5.6-screen grid. Worth reconsidering **on its own merits** for the
    attestation promotion, which is a real finding and is independent of death visibility.
  - **Why option 2 was rejected:** a scroll box on `.grid` clips `died()`'s bloom and `first()`'s
    entrance, and puts the corpses behind a scroll gesture instead of in the viewport.
  - The tree's canvas layout is the one section whose height depends on where it sits; the eyes-on
    pass §8.6 asked for was done — `08-season-landed.png` and the `.shots` set are current.
- ~~**§5.4** (the duel-resolution timeline) is still open and still optional.~~ — **closed 2026-09-02
  as DO NOT BUILD. §8.14.**


### 8.7 IMPLEMENTED 2026-08-31, WRITTEN BUT NEVER EXECUTED — seven files

Read this before touching anything: **no test, no browser and no compiler has seen any of it.** The
session ran under auto mode with Bash unapprovable, so every edit was made with the file tools and
verified by reading only. Treat the whole list as "believed correct, unrun".

| File | Change | Risk if wrong |
|---|---|---|
| `web/js/labels.js` | **+5 tables**, nothing removed: `BELIEF_HUMAN`, `BELIEF_GLOSS`, `THESIS_GLOSS`, `PHASE_GLOSS`, `PHASE_NEXT_HUMAN`. `BELIEF`/`PHASE_NEXT` still ship. | none — additive, no imports |
| `web/js/render.js` | import list rewritten; `heroArgument` lede **factual fix**; `beliefTag` + `phaseTrack` wired to the new tables; **new `primer()` + `beat()` + `specimen()`**; `setupCard` h2 + lede reframed | a typo here is a blank page — `main.js` calls `ui.primer()` |
| `web/js/main.js` | `paint()`'s no-cfg branch mounts `ui.primer()` **before** `ui.setupCard(...)` | as above |
| `web/app.css` | `.phase-call`; **new PRIMER block** (`.panel-primer`, `.beats`, `.beat*`, `.specimen*`, `.primer-foot`) | cosmetic only |
| `web/js/fixture.js` | **5 contract-fidelity fixes** (see below) | `smoke.mjs` recomputes fixture arithmetic — this is the most likely thing to have broken |
| `docs/FRONTEND_CHECKPOINT.md` | this section | — |
| `~/.claude/.../darwin-no-mocks-ship-real.md` | the sharpened no-mocks rule | — |

**The factual bug that is now fixed.** `heroArgument`'s lede conflated the two payment rails. It
now reads *"paying STT to think and collateral to stay alive"* — cognition is native STT drawn from
the organism's own balance (`Prophet.drawCognition`), metabolism and the ante are tUSDC collateral.
The old copy was wrong in a way a judge who read `CLAUDE.md` could catch.

**The five fixture fixes, all deletions of fiction, each verified against the contracts:**
- `#3` (line 110) and `#5` (line 124): `belief` → `0`. `dead` is set **only** inside `die()`
  (`Prophet.sol:532`), which clears belief at `:536` — so a dead organism with a live belief is a
  state the chain cannot produce. **This third instance was not in the audit; it was found by
  reading `die()`.**
- `#4` (line 117) and frame 3 (line 603): `thesis` → `0`. `Genome.parseAnswer` cannot emit
  `Abstain + Range`.
- the `settleAll` block: `belief: 0` added to all ten settled rows. `Prophet.settleWindow` writes
  `Belief.None` at `:526`. **`lastThesis` is deliberately NOT cleared** — its single writer is
  `:263` in the thinking path — so a settled organism carries no direction and still remembers why
  it last had one.

**Consequence that made the terminology work non-optional:** clearing those beliefs puts the raw
enum name `"None"` on ten cards at once, which reads as failed-to-load rather than as *holds no
position*. Hence `BELIEF_HUMAN`. Q4 ("what is it thinking") is now answered in words, with the
on-chain enum kept in the `title` attribute so the claim stays checkable.

**The front door — the user's named grievance (*"¿Qué coño tengo que poner aquí?"*) — is closed.**
Note the literal string `"Population address required"` is **not** in the repo; the grievance was
real but worse than quoted: the entire pre-deploy page *was* an address form asking for something
nobody has, since Season 0 is not deployed. `primer()` now answers Q2–Q6 in five numbered beats
above it, quoting **MOMENTUM, REVERSION and SKEPTIC verbatim** from `genomes/genesis.json` (the
file `Seed.s.sol` loads, so the words are checkable), and the form keeps every function it had.

Two constraints governed the copy and must survive any rewrite:
1. **Mechanism, not magnitudes.** `web/config.js` carries **no economic parameters at all** and
   `POPULATION = ""` on purpose, so any number on that page would be invented — the same class of
   error as a mock. The primer states only what deployed contract logic fixes, so nothing in it
   becomes false at deploy.
2. **`?demo=1` did not get promoted.** The audit's HIGH finding proposing it as `btn-primary` stays
   rejected (§8.4). The fixture link keeps exactly the prominence it had.

Also closed: the observatory/participation split now has one honest sentence and the only
`href="/"` in `web/` (`primer()`'s `.primer-foot`) — *"All of it is watchable with no wallet…
Owning an organism is what lets you put one into the population. Nobody, including us, can steer
the organisms already running."* Q6's "irreversible" now reaches a user for the first time, in
beat 5, together with metabolism as the price of being alive.

**Two things checked so they do NOT need rechecking:** `motion.js`'s `first()` selects only
`.hero-thesis`, `.metric-value`, `.phase-node`, `.card`, `.vitals-fill`, `.tree-edge` — the primer
matches none, so it can never be stranded at `opacity: 0` and `arena.mjs:499` is safe. And
`arena.mjs` Check 12 **still passes as written**: `.hero-thesis` still says *"Organisms that lose
money die."* (line 510) and `.panel-setup`'s two-column grid was not touched (line 516). §8.5's
rewrite is therefore no longer urgent — it is a correctness improvement to the probe, not a
blocker.

### 8.8 Items 1, 2, 3, 4 and 5 all CLOSED as of 2026-09-02

**1. The two tests — GREEN.** Re-measured 2026-09-03 after §8.16 landed. **Superseded by §8.17**, which
re-measures both *and* corrects a label: the `36` below is the number of probe lines the harness
prints, never a count of render calls.
```
npm test --prefix web          # 36 render calls (35 `ok` + 1 that correctly renders null), 149 assertions, 0 fails
node app/test/arena.mjs        # PASS; run against a fresh build, not the stale dist/
npm run build                  # clean, 9.11s, dist/arena/ <- web/ copied verbatim
```
`smoke.mjs` recomputes the demo season's arithmetic from `config` and `Population.sol`, so a
fixture edit is exactly what it is built to catch. If it fails, the fixture is wrong, not the test.

**Order matters and it is easy to get wrong.** `npm run dev` streams `web/` live, but `vite preview`
serves `dist/arena/` — a build-time verbatim *copy*. So a `web/` edit followed straight by
`node app/test/arena.mjs` measures the OLD build and reports green on code that is not being tested.
Always `npm test --prefix web` → `npm run build` (from `app/`) → `node app/test/arena.mjs`. Cheap way
to confirm the harness is looking at the right bytes: fetch `http://localhost:3000/arena/js/render.js`
and grep it for a symbol only the new code has.

**2. The front door — CLOSED. See §8.10.** It was looked at over CDP on the wall clock *and by eye*,
and the looking found two defects that no existing check could see. The two paraphrased genome quotes
this checkpoint predicted (REVERSION and SKEPTIC) were real and are fixed — the divergence in both
cases was a comma promoted to a full stop at the elision, located to the character by machine. And a
defect nobody had predicted: the primer's five beat claims were rendering as panel labels. Both are
now guarded, so neither can rot again silently.

**3. Death visibility — CLOSED. See §8.9.** The corpse band ships and is machine-checked at both
moments that can differ. Correct two things this checkpoint said while it was open: the sort was at
**`render.js:557-561`**, not `585-590`, and the single line that carried the whole expression of
death was `if (a.dead !== b.dead) return a.dead ? 1 : -1;`. And the reasoning above was right about
the mechanism but wrong about the remedy — the reorder did not need "a destination a viewer can
see", it needed to **stop being a reorder**. Sorting the dead to the back of a flow grid puts them
at the end of a container that is 5.6 screens tall; no ordering within one grid can be a fix.

**4. The remaining Q6 gaps — CLOSED 2026-09-02.** `breedStreak` and `breedSurplusBps` are now read
by the frontend, and the console shows every living organism's progress toward reproduction. Beat 5
still explains breeding qualitatively; the console now says where each organism actually stands.

Seven files: `web/js/abi.js` (three new getters), `web/js/chain.js` (19 → 22 `discover()` keys),
`web/js/fixture.js` (three new `config` fields at `Population.initialize`'s defaults),
`web/js/main.js` (`living` threaded through `ctx()`), `web/js/render.js`, `web/app.css`
(`.streak-ready`), `web/test/smoke.mjs` (three render calls, eleven assertions).

Four decisions worth not re-litigating:

- **There is a THIRD gate, and the checkpoint's two-bar description was incomplete.** `hatchAll` does
  `if (living.length >= maxPopulation) break;` (`Population.sol:1602`), so an organism can clear both
  bars and still have nowhere to put a child. The page says so: "clears both bars, but the arena is
  full". A UI that promised a child there would be lying on the one screen a judge reads.
- **The wording is "a mutation is requested at the next settlement", never "breeds".**
  `_requestMutation` (`:1290-1333`) draws the STT deposit from the *parent* and emits
  `BreedingUnaffordable` on shortfall rather than reverting, so qualifying is not the same as
  reproducing and the copy must not conflate them.
- **All three constants live in `discover()`, not `readState()`.** They move only under
  `setEconomics`; polling them would spend three calls every ten seconds to re-learn a constant.
- **`livingCount` is a `readState` key, so it is threaded through `ctx`, not read off `cfg`.** The
  first draft read `cfg.livingCount` — permanently `undefined`, which would have made the full-arena
  branch dead code that no assertion could distinguish from a working one. `depth` was already
  threaded through `ctx` for the same reason; follow that precedent, not the shape that looks nearer.

It says what is MISSING rather than a percentage ("needs 1 more correct in a row and 1.58 tUSDC
more"), because the two bars are different units no single figure could honestly combine. A dead
organism is shown no progress at all: `alive` gates every transition, so a corpse's streak is a
fossil.

Both new controls were confirmed capable of failing by perturbation rather than by inspection —
hardcoding the cap check to `false` produced exactly 2 FAILs, and retuning fixture
`breedSurplusBps` 5000 → 2500 produced exactly 3, which is what proves the render path reads the
config instead of restating a literal. The pre-existing season assertions were deliberately left on
their own literals (`5_000n`, `4`, `THRESHOLD === 60_000_000n`): they are the independent cross-check
against `Population.sol`, and the new `config` fields are pinned *to them*.

The design previously drafted here was *refuted* and was not used: it premised that fixture `#8` is
dead, and `fixture.js:182-185` has `dead: false` — `#8` only dies in the season frame at
`fixture.js:673`.

**5. CLOSED 2026-09-02 — the review ran, and it is written up in §8.13.** ~~Rewrite the two checks then
at `arena.mjs` lines 510/516 to their intent~~ — **done, §8.5 is CLOSED.** ~~Relaunch the agent society to review §8.7 rather than
redo it~~ — **done: 28 agents over four dimensions, zero confirmed findings, and two real defects
found alongside it by hand. §8.13.** ~~§5.4~~ — **closed as DO NOT BUILD, §8.14.** ~~What is left:
root `README.md` staleness (`web/README.md` is current).~~ — **also done 2026-09-02: the root
`README.md` described `?demo=1` as a static fixture render and had never caught up with the scripted
season, so it now carries the four frames, the not-a-simulator limit, the runs-forward-and-stops rule
and a pointer to `web/README.md` for the full account. Its render/assertion line was current then and
was re-stamped to `36 / 149` on 2026-09-03 (§8.16), and again to `189 checks / 167 assert sites` on
2026-09-05 (§8.17).** **The script this item used to name,
`.tmp-verify/wf/arena-design-repaired.js`, does not exist on disk** — `.tmp-verify/` holds only
`pick.json` (the death-visibility competition: `ranking`, `winner`, `graft`, `combined`, `reasoning`,
and note it needs a BOM strip to parse). Author a fresh review workflow rather than hunting for it.
The drafted test-intent design was also *refuted*: it referenced `PRIMER_CHAR_CAP` without declaring
it, and its "control" asserted the page still exhibits the defect — an assertion that passes only
while the bug is present.

**Historical note on the session that wrote §8.7 and ran none of it:** the classifier outage blocked
`Workflow` and `Agent` (three attempts, same error), and the user had put that session in auto mode
where Bash cannot be approved — *"lo dejare en auto asi que no puedo aprobarlos dejalo para el
final"*. Per the standing rule, PowerShell fails the same way, so no shell fallback was attempted.
The deploy and any broadcast remain the user's call.

### 8.9 The corpse band — how death became visible, and the geometry that proves it

**The defect, stated exactly.** The fixture opens with `#3` and `#5` already dead. They rendered at
`y=1060` in a `1600x1000` viewport — 60px below the fold, before any animation had run. So the
page's **resting** state had never shown a corpse to anyone. The corollary that decided the design:
*a fix that only works while the death animation plays is not a fix.* Every diff-driven remedy was
therefore disqualified on sight, because `data-fx` is absent on a cold load by construction (§4.3).

**The design: partition, not sort.** The dead leave `.grid` entirely and render as a labelled band
**above** it — three 46px tombstones per row, newest death first, ordered by `deathWindow`. `grid()`
now builds two populations from one array (`living` sorted by treasury, `dead` sorted by
`deathWindow` descending) and mounts the band before the grid. **No `ctx.fx` is read for placement.**

**Measured, at `1600x1000`, all three moments:**

| | before | after |
|---|---|---|
| lowest corpse, cold load | `top 1060` — below the fold by 60px | `top 506, bottom 552` |
| `#header` height | 422px | **343px** |
| grid top | 564px | 580px |
| corpses at rest / season landed | below the fold | `top 506`, all three full |

The 79px the header gave up came from three cuts, and it is worth recording **why those three**: an
agent measuring the hero found `.hero-argument` (~186px) and `.hero-vitals` (~184px) are within 2px
of each other, so shrinking *either alone* reclaims **zero** — the taller one just becomes the other
one. Only the shared axes move the number: `.hero` `gap` `--s-5`→`--s-4` and `padding-block`
`--s-6 --s-5`→`--s-5 --s-4`, `.hero-grid` `padding-top` `--s-5`→`--s-4`, and `.stat` from a
two-line column to a baseline-aligned row. The `1.35fr / 0.85fr / 1fr` hero ratio was left alone.

**Three details that are load-bearing, not stylistic:**

- `.tomb-rows` has **no `max-height` or `overflow`** — clipping would cut `died()`'s bloom, and the
  bloom is how a death announces itself.
- `.tomb-rows` uses `gap: var(--s-2)` (8px), not `.grid`'s 12px. That is why a tombstone measures
  **280px** and a living card 277.39px: `(856 − 2×8) / 3 = 280` exactly. If a future reading
  disagrees with this arithmetic, one of the two gaps has changed.
- `tomb()` reuses `.card` and `.card-dead` **verbatim** rather than defining a third dead-state rule,
  because `.card-dead { filter: saturate(0.15) }` is already duplicated between `app.css` and
  `motion.js`'s `died()`, and drift between those two makes the card visibly jump (Check 7 exists
  for that). `.card-tomb` overrides only `gap` and `padding`.

**What guards it.** `smoke.mjs` renders `grid()` and `grid(no diff)` and asserts they are
**byte-identical** — 340 nodes / 704 chars each — which is the property no diff-dependent fix could
have had. `arena.mjs` Check 5b measures the band on a **cold load** and Check 13 after a death has
landed; both against `innerHeight`, never a literal fold, so a different correct layout passes them
unchanged. `TOMB_CEILING = 56` guards the one-line assumption the 46px budget rests on.

**Two traps found while verifying, both worth remembering.** `cdp.mjs:46` defaults `windowSize` to
`1440,900`, so the harness had never run at the viewport every measurement in this document was
taken at — an instrument that does not share a frame with what it measures is not evidence.
`arena.mjs` now pins `1600,1000` explicitly. And that window yields a **real viewport of 1600x848**
under `--headless=new`, because window chrome is included; a literal `< 1000` assertion would have
passed for the wrong reason. 848 is also the stricter and more realistic fold — a judge's browser
spends chrome too — so the harness reports `lowest bottom 552 against a 848px fold`.

One cosmetic non-issue, recorded so it is not re-investigated: the toll's `textContent` reads
`"†3 dead· last w41"` with no space before the `·`. `.toll` is `inline-flex` with `gap: 0.35em`, so
the separation is real on screen and confirmed in `01-first-paint.png`. It is a `textContent`
artifact, not a rendering defect.

### 8.10 The front door, opened by eye — two defects no check could see

Both defects here share one property worth stating before either: **neither was a fault.** No console
error, no exception, no failed request, no missing node, nothing stranded at `opacity: 0`. Every
machine check on both surfaces was green while both were live. What they were instead was a *false
claim* and an *inverted hierarchy* — and the only instrument that detects those is reading the page.
That is the argument for §8.8 item 2 existing at all, and it is now paid for twice over.

**Defect 1 — the genome quotes were not quotes.** `render.js` captions each founder genome
*"founder genome, quoted from `genomes/genesis.json`"*. Two of the three had diverged, and the
divergence was the same edit both times: **a comma in the source promoted to a full stop at the
elision**, so the fragment read as a finished sentence the founder never wrote. Located to the
character by machine: REVERSION diverged after 163 chars, SKEPTIC after 42.

- The fix was *not* to reword the fragments. It was to **end each fragment where the genome ends a
  sentence** — which for MOMENTUM and REVERSION meant re-including the single elided sentence and
  dropping the ellipsis entirely, so both are now unbroken runs. The quotes grew ~40% (`arena.mjs`
  reports the undeployed body at 4530 chars, up from 4325); the page absorbed it without trouble.
- **What guards it.** The three quotes moved out of the call sites into an **exported**
  `FOUNDER_QUOTES` constant in `render.js`, so they are addressable data rather than literals.
  `smoke.mjs` now reads `genomes/genesis.json` off disk and asserts every fragment is `includes()`-
  verbatim in the real genome and ends on `[.!?]`. Two controls prove the check discriminates: a
  paraphrase is rejected, and *the exact mid-sentence cut that shipped* is rejected. The earlier
  failing run is itself the proof it can fail.
- Two traps, both recorded because both cost time. The genome path must be resolved from
  `import.meta.url`, not cwd — `npm test --prefix web` and `node test/smoke.mjs` run from different
  directories. And `genesis.json` is `{_comment, generation, organisms}`: `Object.values(g).find(Array.isArray)`
  picks `_comment`, which is 17 strings of design commentary, not the genomes.
- **Do not try to recover the quotes by parsing `textContent`.** The first version of this check did,
  and failed for two independent reasons: splitting on the organism name also splits on `UP_MOMENTUM`
  inside the genome body, and inline elements concatenate without whitespace so the caption gets
  swallowed into the fragment. Assert against the exported constant, and keep
  `t("primer").includes(quote)` alongside it to prove the constant actually reaches the page.

**Defect 2 — the primer's skim path was rendering as a panel label.** The five beat claims are the
whole point of the primer: `app.css`'s own comment says the number column exists so *"a reader who
scans ONLY the five claims still leaves with the whole mechanism… the prose underneath is elective
rather than required."* They are `<h3>`, and `.panel h3` — a label rule at the top of the file — is
**one type selector more specific** than `.beat-claim`. It won every property the two share:

| | `.beat-claim` intended | `.panel h3` actual |
|---|---|---|
| face | Newsreader (`--f-display`) | IBM Plex **Mono** |
| size | `--t-md` **17px** | **11px** |
| colour | `--text` `#deeae6` | `--text-3` `#5c736f` |
| weight | 400 | **500** |
| transform | none | **uppercase** + 1.54px tracking |
| display | block | flex |

- Read by CDP, the five claims came back **byte-identical to the words "NOTHING IS DEPLOYED YET"** —
  a minor label inside the form below. Meanwhile the prose under each claim is 15px `--text-2`. So the
  elective paragraph outweighed the claim it is subordinate to, in both size and contrast: the
  hierarchy was exactly inverted, and the tracking pushed beats 2 and 3 onto a second line with a
  one-word orphan (`QUESTION.`, `METERED.`).
- **The author had already caught this exact trap one rule below.** `app.css` carries the comment
  *"Selector is `.beat-body > .beat-aside` rather than `.beat-aside`, because `.beat-body > p` is one
  type-selector more specific and would otherwise win."* Same file, same class of bug, twenty lines
  apart, caught once. The tell in the losing rule is that `letter-spacing: normal` and
  `text-transform: none` are only meaningful as an *undo* — a declaration that has no purpose except
  to defeat another rule is evidence that another rule is in play, and evidence that the author knew
  it. **Treat those declarations as a smell worth checking the specificity of.**
- The fix is `.beat-body > .beat-claim` (0,2,1), following the neighbouring idiom rather than
  inventing a new one. Measured before applying, by injecting the candidate rule over CDP and reading
  the geometry both ways: it costs **11px** of panel height and **10px** of page height, and returns
  all five claims to **one line each** (the measure widens 416→598px, because `max-width: 63ch` scales
  with the font). A strictly free improvement, so there was nothing to design around and no panel was
  convened.
- `font-weight: 400` in that rule is **load-bearing, not a restatement of the default**: the rule it
  beats sets 500, and `fonts.css` vendors Newsreader *upright* at a bare `font-weight: 400` — only the
  italic carries a `300 400` range — so a 500 here synthesizes a fake bold off the 400 file. `display:
  block` is likewise there to undo the `flex` the label rule sets for its label/value pattern.
- **What guards it: `arena.mjs` check 12b, asserted RELATIVELY.** It does not assert "the claim is
  17px" — a token rescale would break that for no reason. It reads the panel label and the beat prose
  off the same page and asserts the claim outranks both, is in the display face, is `transform: none`,
  is weight 400, is not the prose's colour, and fits one line. A pass means *"the claim still outranks
  its own body copy"*, which is the actual invariant. Verified able to fail: it reported all 27
  problems against the unfixed page before the rebuild.
- **One process trap that cost a full test cycle.** `vite preview` serves `dist/`, and `dist/arena/`
  is copied verbatim from `web/` **at build time**. Editing `web/app.css` and re-running `arena.mjs`
  measures the *old* CSS. The re-run order in §5 already says `npm run build` before `arena.mjs`;
  obey it, or a real fix reads as a failure.
- Also note: check 12b's comment lives **inside a template literal** (the CDP `evaluate` string), so
  it cannot contain backticks. It says so in the comment. A backticked `` `.panel h3` `` there is a
  `SyntaxError: missing ) after argument list`, which is a confusing way to learn this.

**The claim that is now true.** The front door leads with five Newsreader sentences at 17px, one line
each, over their own 15px prose — *"An organism is a strategy written in English."*, *"Every fifteen
minutes, the market asks one question."*, *"Each one answers by thinking, and thinking is metered."*,
*"Only disagreement can open a position."*, *"The close pays, charges, and kills."* Confirmed by eye
in `09-setup-no-deployment.png` and by `arena.mjs`: `primer 5 claims in Newsreader at 17px over 15px
prose, label is 11px · lines 11111`.

---

### 8.11 The specificity sweep — `.beat-claim` was not a one-off. Four more, all fixed 2026-09-01

§8.10's second defect was found by eye, which raised the obvious question: **how many more are there?**
So the shape was named and hunted deliberately. The defect class is *a declaration whose only job is
to WIN, that loses* — an author writes a rule whose properties are meaningful only as an **undo**
(`letter-spacing: normal`, `text-transform: none`, `display: block`, an explicit `color`) or as a
**win** (a variant's own padding), gets the specificity wrong, and it silently does nothing. **It
produces no error, no exception, no missing node and nothing stranded invisible.** Every machine check
on `arena.mjs`'s list stayed green through all five instances. The tell in the source is the undo
declaration itself, sitting below the rule it means to undo.

Read this section in two halves. Three defects were found by **reading** the sheet against what
`render.js` emits (below); a fourth was found afterwards by **measuring** the rendered page through CDP,
in a modality reading could not reach — that half starts at *"A fourth defect"*, and it is the better
method of the two.

**How it was swept.** A workflow (`css-specificity-swallow-sweep`, run `wf_1dd4892a-3f3`) fanned agents
over every **type-scoped** rule in `app.css` — 99 of them — against what `render.js` actually emits,
287 rendered class/element pairings in total. Agents were given **no browser on purpose**: they read
source and proposed, and all verification was centralised in one probe I drove myself, so no finding
entered the record on an agent's word. The finders returned **5 unique** findings and self-flagged 2 as
nil. Of the 5: **3 confirmed and fixed**, **2 nil and dismissed on evidence**, and **one agent colour
claim refuted** (it asserted the selected card rests at `--life-dim`; the first measurement said
`rgb(27,46,43)` — see the instrument note below, which is why that reading was wrong too).

**Two instrument failures in my own first verification pass.** Worth more than the findings, because
both produced confident numbers that were simply not measurements of the cascade:

1. **A transition read mid-flight.** `.card` transitions `border-color` over `--d-fast` (0.16s). Reading
   `getComputedStyle` after a class change returns the *interpolated* value, so the "resting" border of
   a freshly-selected card came back as `--line` and its hovered border as `rgb(50,83,78)` — which is
   **~97% of the way** from `--line` to `--line-3`, not any token. The fix is to remove the clock from
   the instrument: inject `*{transition:none!important}` before reading, since a transition changes
   *when* a colour arrives and never *which rule wins*. With that, the same reads returned
   `--life-dim` at rest and `--line-3` hovered, and the finding stood.
2. **`:hover` forced on the wrong element.** The rule is `.tree-node:hover .tree-label`; the probe
   forced hover on `.tree-label`. Nothing changed — on the dead node *or* on the living control — so
   the first pass wrote off the hover half as "not dead-specific". Forcing hover on `.tree-node`, which
   is what the selector names, showed the living control moving `rgb(92,115,111)` → `rgb(222,234,230)`
   and the corpse not moving at all. **The control saved this**: a control that fails to respond is the
   signal that the instrument is broken, not that the page is fine.

Settle a cascade question with **`CSS.getMatchedStylesForNode`**, not by inferring it from a computed
value. It returns the matched rules in ascending precedence, so the last entry is the winner, and it
ended both arguments above in one call. (`cdp.mjs` exports no wrapper for it — go through `send`.)

**The three that were real, and what each cost on screen.**

| loser | winner | property | what a judge saw |
|---|---|---|---|
| `.muted` (0,1,0) | `.census td` (0,1,1) | `color` | the census printed the count of the **dead** at full `--text` — `[222,234,230]`, identical to the living count beside it, in the one column the eye is meant to skip |
| `.card-selected` (0,1,0) | `.card:hover` (0,2,0) | `border-color` | moving the pointer onto the **selected** card replaced its mint edge with the ordinary hover neutral — the cursor erased the selection of the card it was pointing at |
| selection/hover rule (0,3,0) | `.tree-node.is-dead .tree-label` (0,3,0), **5 lines later** | `fill` | a corpse in the lineage tree answered **neither** the cursor nor a click. Equal specificity, so source order alone decided |

The third is the worst of the three and was the least visible: lineage is where a judge clicks through
ancestry, and **most of any ancestry is dead**, so the unresponsive case was the common one.

**How they were fixed — by the file's own precedent, not by inventing a treatment.**

- `.census td.muted { color: var(--text-3) }` — scoped the *winner* rather than raising `.muted`
  itself, because `.muted` is a utility used across the sheet and this table is the one place something
  outranks it. Same shape as §8.10's `.beat-body > .beat-claim`.
- `.card-selected:hover { border-color: var(--life) }` — **brightens inside life's own ramp** rather
  than merely restating `--life-dim`. That is how `.btn-primary:hover` and `.card-dead:hover` already
  answer this question in this file: *a hover moves a thing along its own hue, it does not neutralise
  it.*
- `.tree-node.is-dead:hover .tree-label, .tree-node.is-dead.is-selected .tree-label { fill: var(--ash) }`
  — `--ash-dim` → `--ash`, so the corpse answers **inside the ash ramp** and selection does not un-kill
  it. `.card-dead:hover` resolves the identical tension the identical way. Both states are kept in one
  rule so they cannot drift apart.

**The two nil findings, dismissed on evidence rather than on the agents' word.**

- `.feed-where a` (0,1,1) does beat `.muted` (0,1,0) — and both resolve to `--text-3`. Measured
  `rgb(92,115,111)`, exactly what `.muted` wanted. The class is **inert, not harmful**; left in place.
- `.btn` vs `a:hover`: the only property they share is `text-decoration-color`, and `.btn` sets
  `text-decoration-line: none`, so there is **no line for the colour to land on**. Settled statically,
  no browser needed. (The element is also absent from the `?demo=1` view entirely.)

**What guards all three: `arena.mjs` check 11b**, inserted deliberately *after* the `classify` block so
the DOM/CSS domains it enables cannot put traffic near the console classification. It forces `:hover`
through **CDP `CSS.forcePseudoState`** rather than by adding a class — a class would change the very
cascade being measured — and samples the transitioned `border-color` past `--d-fast` on the wall clock.
Every assertion is against a **control read off the same page**: the unselected card's own hover, the
living lineage node's own selection, the census's own unmuted cells. Nothing pins a hex, so a palette
change moves both sides together. Two assertions exist **only** to fail if a control stops responding,
because a page where hover broke everywhere would otherwise report the same green as a page that works.

**Verified able to fail.** The three new CSS rules were disabled by renaming their selectors, the app
rebuilt, and `arena.mjs` re-run: **FAIL — 4 problems**, one per defect (the corpse counts twice,
selection and hover), each naming the rule that swallowed it — while both controls stayed green, which
is what proves the four were the page and not the instrument. Restored, rebuilt, re-run: PASS.

**The measured numbers, which `arena.mjs` now reprints on every run** (so this table never goes stale —
prefer its output to anything written here):

```
states    census dead tally "3" at [92,115,111] under plain cells [222,234,230] ×3
states    card selection [27,46,43] -> [47,141,120], hovered [95,227,192] against an unselected [51,84,79]
states    dead node [74,72,84] -> selected [122,118,134] / hovered [122,118,134] · living selected [222,234,230]
```

Confirmed by eye as well as by number: the census crop shows ALIVE `6/3/1` near-white over DEAD `3/0/0`
visibly quieter; and because a still has no cursor and nothing selected, the two state fixes were
captured with **both states forced through CDP and an untouched sibling left in the same frame** —
card #9 selected *and* hovered carries a bright mint edge beside #6 which is merely hovered, and
corpses #3 (selected) and #5 (hovered) read clearly brighter than #8 at rest, without leaving the ash
ramp. That throwaway probe was deleted; the note lines above are the durable record.

**~~One design question left open, deliberately, for the user.~~ CLOSED 2026-09-02 — measured, then
fixed exactly as this paragraph recommended.** `.tree-node.is-selected circle` sets
`stroke: var(--life)` and beats `.tree-node.is-dead circle` (both (0,2,1), selected is later), so a
**selected corpse wore a mint ring** — and §2 of this document says mint means alive. It was defensible
as it stood: a corpse is a hollow ring and a living Belief.Up node is a filled disc, so fill-vs-stroke
still separated them (see #3 against #13 in the lineage), and `--life` is already the affordance colour
for `:focus-visible` and links. But it was never *measured*, and measuring it settled it: the harness
now reads the ring's stroke as well as the label's fill, and before the fix a dead ring went
`[74,72,84]` -> `[95,227,192]` under `.is-selected`, **byte-identical to a selected living ring.** Not
"a similar mint" — the same value. Fill-vs-stroke separates a corpse from a *disc*; it does not separate
a selected corpse from a selected living node, which is the comparison a judge clicking through
ancestry actually makes.

So the minimal move this paragraph named was taken verbatim: keep `stroke-width: 2` for selection, drop
the hue for the dead case. `.tree-node.is-dead.is-selected circle { stroke: var(--ash) }` — (0,3,1), so
it no longer depends on source order — mirroring the label rule at `app.css:1423-1426` and
`.card-dead:hover`. Selection is still answered, by weight rather than by resurrection: measured after,
`[74,72,84]` -> `[122,118,134]` against a selected living ring still at `[95,227,192]`.

Two things are worth keeping from how this one went. **The label fix of 2026-09-01 sat one rule below
the identical unfixed collision and nobody looked up** — the sweep checked `.tree-label` and the ring
beside it was styled by a different rule with the same flaw. And **the probe that passed for a day was
reading the wrong element**: `arena.mjs`'s check literally said *"selection has un-killed it; a corpse
must answer inside the ash ramp"* while comparing label fills, so it could not see the one node that
had actually been un-killed. It now reads both, each with its own living control.

#### A fourth defect — the Critic's brief, answered by measurement instead of by reading

The workflow's Critic phase never returned (five attempts, each cut short the instant my own main-loop
turn ended — see the process note at the end of this section), so its brief was executed directly. Not
by re-reading the sheet, which is how the first three were found and is exactly the method that had
already missed a fourth, but **empirically**: walk every rendered element, ask CDP through
`CSS.getMatchedStylesForNode` which declarations LOST, and bucket every loss by *what decided it*.

That bucketing is the reusable part. `matchedCSSRules` comes back in **ascending** precedence, so the
last entry wins and the answer is authoritative rather than inferred. For each losing declaration,
compare specificities:

| bucket | meaning | risk |
|---|---|---|
| **EQUAL** | same specificity — **source order alone decided** | highest: moving a rule changes behaviour |
| **LOSER<** | the loser was simply less specific | legitimate cascade; a defect only if the loser meant to win (the `.muted` shape) |
| **LOSER>** / **IMPORTANT** | more specific and still lost | only `!important` or a later shorthand can do that |

Shorthands are expanded through each declaration's `longhandProperties` (3676 expansions on the demo
page), so `padding` losing to a later `padding` is seen even though neither is a longhand. Properties
GSAP had set inline are skipped, because an inline win is not a cascade defect.

**What it found: `.panel-primer` loses its own padding at phone width.** One row, in the EQUAL bucket:

```
1x padding  @(max-width: 720px)   LOST (0,1,0) .panel-primer {padding}
                                  WON  (0,1,0) .panel {padding}   e.g. <section.panel.panel-primer>
```

A `@media` block adds **no specificity**. So the 720px block's `.panel { padding: var(--s-4) }` does
not outrank `.panel-primer { padding: var(--s-6) }` — it merely sits later in the file, and that alone
is enough. Two rules below it in the same block, `.panel-setup` *was* restated; `.panel-primer` was
not. Measured on the real page at two widths:

| | `.panel-primer` | `.panel-setup` | step between content edges |
|---|---|---|---|
| 1400px | pad 32, panel@89 | pad 32, panel@89 | **0px** — flush |
| 700px, before | **pad 16**, content@45 | pad 24, content@53 | **8px — they step** |
| 700px, after | pad 24, content@53 | pad 24, content@53 | **0px** — flush |

The two panel *boxes* were flush the whole time (both at x=28); only their contents stepped. And the
invariant it broke is not one I invented for the occasion — `.panel-primer`'s own comment in `app.css`
says the shared 62rem measure exists so the two panels "share one left-hand edge and one right-hand
edge **instead of stepping**". On the page a judge lands on before Season 0, on a phone, stacked one
above the other. Every desktop width was correct, which is why nothing upstream could see it.

Fixed by restating **both** panels in one rule inside that block, not just the missing one — same
reason the dead lineage node's hover and selection share a rule: a pair that must not drift cannot be
left in two places. Guarded by **check 12c** in `arena.mjs`, which asserts the content edges are flush
at 700px *and* at 1400px — the desktop width is the instrument's control, since a check that only ever
looked at the broken width is indistinguishable from one that always passes — and additionally reads
the generic padding off a throwaway bare `.panel` injected out of flow, so the one regression that
would otherwise still pass as "flush" (both panels collapsing to the generic value together) fails too.

**Two pairs that are correct only by source order, left alone deliberately.** Both are EQUAL-bucket and
both currently resolve the intended way — death owns the corpse's palette — but a reorganization of the
sheet would silently flip either: `.tree-node circle.belief-none` (0,2,1) loses `fill` to
`.tree-node.is-dead circle` (0,2,1) ×6, and `.vitals-fill.bad` (0,2,0) loses `background` to
`.card-dead .vitals-fill` (0,2,0) ×3. Recorded here rather than "fixed" because the current behaviour
is the wanted one; what is fragile is the *reason* it holds.

**One suspicion raised and refuted by the source, recorded so it is not re-raised.** `.hero-plain
.hero-grid` (0,2,0) outranks the 1180px and 720px `@media` rules for `grid-template-columns` — which
looks like the same defect inverted, a base rule that a breakpoint can no longer reach. It is
deliberate: the comment at `app.css:433` says in as many words that the descendant selector is there so
the later equal-specificity breakpoints "cannot quietly win it back". And `.hero-plain .hero-thesis`
sets `max-width` while the 720px rule sets `font-size`, so those two never collide at all.

**Where to look next for the same class — now measured, not guessed.** The empirical pass answers most
of what the earlier draft of this paragraph listed as unknown. Over 996 elements at 1600×848:

```
rule modalities actually reached: pseudo-element 7 · @media 0 · attribute-selector 2 · sibling-combinator 0
unique class-rule losses by what decided them: {"EQUAL":20,"LOSER<":34}
```

Every one of the 54 is accounted for: intended base→variant overrides, the two order-dependent pairs
above, or the known-inert `.muted` → `.feed-where a` (×92, both resolve to `--text-3`). **Sibling
combinators: zero in the entire file**, confirmed statically as well, so that modality does not exist
here. **Attribute selectors: two**, both on `.panel-wiring[open]`, and both are the only rule for what
they set. `@media` is now covered from both ends — the row above found the one defect in it, and a
second run at 700px on `?demo=1` (11 media rules active) returns the **identical** bucket counts, so
the breakpoints introduce no loss on the console surface. What genuinely remains unswept: the seven
pseudo-element rules, states no resting page can reach (`:focus-visible`, `:disabled`, `::selection`),
and — separately — whether `app/src/*.css` holds a swallower for `app/src/sections/*.jsx`. §8.10
already cleared `/` of the `.beat-claim` trap specifically by reading the import graph (`styles.css`
imports only `web/fonts.css` and `web/tokens.css`, **never** `web/app.css`), but that is one rule, not
a sweep.

**A process failure worth not repeating.** The Critic phase was retried five times and never returned;
all four pending journal entries carry one identical key, so it was **one call retried, not a fan-out**
(I said "fanned out" first and that was wrong). Each attempt began the instant the previous one ended
and each ended `[Request interrupted by user]` — it was tracking my own main-loop turns, so it could
not converge while I kept working. **Do not leave a long tail phase running while continuing to work in
the main loop**: wait on it, or give it its own workflow. The run is resumable via
`resumeFromRunId: "wf_1dd4892a-3f3"`, and both throwaway probes were deleted — this section is the
durable record.

### 8.12 The front-door simplification — IMPLEMENTED 2026-09-01, stopped mid-verification with ONE failing check

**Where this stopped** — *and it did not stay stopped; see the resolution note at the end of this
section.* Every file edit is done. `npm test --prefix web` is **all green**;
`npm run build` is clean (`built in 12.89s`, exit 0, `dist/arena/ <- web/` copied verbatim).
`node app/test/arena.mjs` reports **FAIL — 1 problem**, and that one problem is unresolved. The two
tests after it in the chain (`landing.mjs`, `shots.mjs`) were **never run**. Nothing here is deployed.

**What was asked for** (last live user turn): make `/arena` friendlier before the deploy — fixed RPC
with an "advanced" escape hatch, far less text, obvious what to do; do all the file edits first and
batch the shell commands at the very end, because the session was to be left unattended.

**What changed.** `web/js/render.js`: `primer()` cut to two `p.primer-status` + `ol.beats.beats-terse`
of five bare `beat()` calls + ONE `specimen("MOMENTUM", …)` + `div.primer-actions` with
`a.btn.btn-primary[href="/"]` ("How it works, and how to enter") and `a.btn.btn-ghost[href="?demo=1"]`
("See it with sample data"). `setupCard()` is now a **closed `<details class="panel panel-setup">`**
titled *"Advanced — point this page at another population"*, holding `#pop-input`, a new `#rpc-input`
that is **blank when the RPC equals the default** (so blank means "use the default", and the default is
the placeholder), a `button[type=submit]` labelled **"Load it"**, and one `p.setup-note`. `open` is
forced only by `badQuery` — an explanation folded inside a closed disclosure is not an explanation.
`web/app.css`: added `.primer-status` (+ `:first-of-type` louder), `.beats-terse`, `.primer-actions`
(replacing the deleted `.primer-foot`); replaced the `.panel-setup` grid block with a `display: block`
panel plus six `> summary` rules mirroring `.panel-wiring`; removed `display:flex` from `.setup-note`
(it is one `<p>` with inline `<code>` children now — a flex container would stack each bare text run as
its own anonymous item, five rows); deleted the now-dead `.panel-setup` grid restatement in the 720px
block while **keeping** the `.panel-primer, .panel-setup { padding: var(--s-5) }` pair that check 12c
guards.

**The reduction, measured, not estimated.** Setup card **4530 → 321 chars** (24 nodes); `primer()`
891 chars / 53 nodes; the whole undeployed front door **1243 chars** of body text, inside
`arena.mjs`'s new `COPY_FLOOR 600` / `COPY_CEILING 1400` band. The floor is the ceiling's control: a
blank page passes "the copy is short" maximally, so a bound in only one direction is not a check.

**THE ONE FAILING CHECK, and why it was NOT "fixed".**

```
* the setup form still has a box while its <details> is closed — the fold is cosmetic, and any
  geometry read off it would be measuring a subtree nobody can see
```

The guard is `arena.mjs:998`, over `formCollapsed` at `:896` —
`formBox.width === 0 && formBox.height === 0`, where `formBox` is
`document.querySelector(".setup-form").getBoundingClientRect()` (`:871-872`). `setupOpen` is confirmed
**false** (its own assertion at `:995` did not fire), so the disclosure genuinely carries no `open`
attribute, and yet the form reports a non-zero box.

**Both sides are still candidates and the fork was deliberately left open.** Either (a) the new
`.panel-setup` CSS reveals the folded subtree, in which case the page is wrong; or (b) this Chromium
lays out closed-`<details>` content and the assertion can never be false here, in which case the
**assertion** is wrong and must be re-aimed (open the disclosure before any geometry read, or assert
presence without geometry). The tell that settles it: if closed `<details>` content is laid out in this
browser, `.panel-wiring` — which has been a closed `<details>` on this page all along — would show the
identical non-zero box. **Do not change the page to satisfy a check that may be misreading the
browser** (§8.11's two instrument failures are the precedent: both produced confident numbers that were
not measurements of anything).

**The probe that was being built when this stopped.** A throwaway CDP script under `\tmp`, against
`http://localhost:3000/arena/` (no `?demo=1`), to report in one pass: (a) the `getBoundingClientRect()`
of `.setup-form` and of every non-`summary` child of `.panel-setup`, (b) the same for `.panel-wiring`'s
folded body, and (c) **the decisive negative control** — a freshly injected, default-styled, closed
`<details><div>probe</div></details>` measured in the same frame. Zero box on the control ⇒ the defect
is mine; non-zero ⇒ the assertion is. `cdp.mjs`'s `launch()` returns `{send, evaluate, events, note, …}`
(`cdp.mjs:196`); cascade questions go through `send` + `CSS.getMatchedStylesForNode`, which `cdp.mjs`
does not wrap.

**Then finish the chain, in this order** — `vite preview` must already be running on
**`http://localhost:3000`** (`localhost`, not `127.0.0.1`; `vite preview` binds ::1 only on this
machine), and any further `web/` edit means re-running `npm test --prefix web` → `npm run build` from
`app/` first, because `dist/arena/` is copied from `web/` at **build** time:

```
node app/test/arena.mjs      # must reach green first
node app/test/landing.mjs    # never run this session
node app/test/shots.mjs      # never run this session
```

**Readings that already landed correctly**, so they are not suspects: `setup=<details>`,
`1 specimen(s)`, `submit "Load it"`, `actions ["/","?demo=1"]`, `5 claims in Newsreader at 17px`
against a `label probe 11px IBM Plex Mono uppercase`, `loudest other 17px` (a tie, which passes),
`lines 11111` (all five claims on one line), and **`step 0px` at both 1400px and 700px** — so check
12c stays green through the `<details>` and the two panel content edges are still flush.

**Test surfaces were re-aimed, not deleted.** `arena.mjs` check 12 lost `panelCols`, `prose`,
`labelPx` and the near-unfireable `!hasSetup && chars < 40`, and gained `hasPrimer`, `setupTag`,
`setupOpen`, `summary`, `formCollapsed`, `inputs`, `submitText`, `connectLabels` (scoped to
`#body button, #body a, #body summary`, so prose may still say "connection" while no *control* may say
"Connect"), `actions`, `specimens`, `label`, `loudest`, `status`. 12b now compares against an
**injected** throwaway `<h3>` at `position:fixed;left:-9999px`, with a liveness assertion that fails if
the probe stops rendering as a label. `web/test/smoke.mjs` got a `walk()`/`hasClass()`/`tag()`/
`textIn()` DOM walker (**no `innerHTML` setter was added — its absence is the XSS enforcement**), and
now checks the rendered specimen against `FOUNDER_QUOTES` *and* separately verifies **all three**
genomes against the constant, so trimming the page to one quote did not silently retire two thirds of
the check. Five assertions added (five beats by class, both `primer-actions` hrefs, both ids `main.js`
reads, a surviving `button[type=submit]` — label-agnostic).

**Errors already found and corrected this session, recorded so they are not re-introduced.**

- My published markup spec said `p.beat-claim`; `beat()` really emits **`h3.beat-claim`**. `beat()` was
  left untouched, so `.beat-body > .beat-claim` still wins and the specimen still lands inside
  `.beat-body`. The correction did **not** reach the two agents (both had finished — "No agent named …
  is reachable"), so one of them wrote the wrong premise into `arena.mjs` in **three** places; found by
  grepping the file rather than by trusting the report, and fixed (comment text only, no logic).
- `class: "muted setup-note"` — `.setup-note`'s own `color` is later at equal specificity, so `muted`
  could never take effect. Removed from the markup: that is §8.11's defect class, authored fresh.
- `.beats-terse .beat` must **restate** `.beat`'s padding, not lean on it: both selectors are (0,2,0)
  and only source order decides. The comment in `app.css` says so.

**MEASURED AND WRITTEN, 2026-09-02 — this item is CLOSED.** The count was re-measured from the
harness's own output rather than from any prior note: `npm test --prefix web | grep -c "^  PASS"` →
**112 assertions**, and the render lines are **28**, not 27 — 27 `ok` plus one `null` line
(`readErrors({})`, which is *supposed* to render nothing). The prior "render calls stay 27" was
itself the stale number: it counted the `ok` lines and dropped the deliberate null.

**RE-MEASURED LATER THE SAME DAY, after §8.8 item 4 added three render calls and eleven assertions:
`ok: 30`, `null: 1`, `PASS: 123`, `FAIL: 0` — so 31 render calls and 123 assertions.** Every carrier
was updated to those figures: `darwin/CLAUDE.md` (the `npm test --prefix web` bullet), this document
at §1's header paragraph, §5.1's parenthetical and §8.8 item 1, `darwin/docs/SESSION_CHECKPOINT.md`
item 1 of "what remains", and `web/README.md`'s `test/smoke.mjs` paragraph.

**RE-MEASURED AGAIN 2026-09-02, after the §8.7 review work: `ok: 33`, `null: 1`, `PASS: 135`,
`FAIL: 0` — so 34 render calls and 135 assertions.** The same six carriers were updated. What moved:
three render calls (`wiringPanel` with an ERC-6909 venue, `wiringPanel` with the settlement address
undiscovered, and the settlement rows rendered alone) and twelve assertions — four on the settlement
family, four on the null-key sweep and its control, and four on the `Settled` grading, minus the two
`"unknown event"` checks rewritten one-for-one.

**The scripted-season sub-count is still exactly 44, and that is not luck.** Every assertion added in
this pass was deliberately placed outside `smoke.mjs`'s `season plays 4 frames` … `the header follows
the script to window 42` region, re-measured at `:417`–`:537` after the edits. The one replacement
inside it (`no scripted event falls through to generic()`) was swapped one `assert()` call site for
one. Anything added inside that range silently breaks a figure three documents pin.

**One number in the paragraph above could not be reproduced and was replaced rather than carried.**
It claimed a scripted-season sub-count of **34** "(`assert(` calls between the THE SCRIPTED WINDOW
and THE FRONT DOOR banners)". Counted that way the region holds 41 call sites now and therefore 30
before item 4 — not 34 — and no nearby boundary yields 34 either (86/75 if measured from the prose
mention of the same phrase at `smoke.mjs:214` instead of the banner at `:380`; 38 if the nine-name
`chain.*` export loop is expanded to its runtime assertions). Note the trap: **the string "THE
SCRIPTED WINDOW" appears twice in `smoke.mjs`** — once as prose at `:214` and once as the `/*////`
banner at `:380` — so a `findIndex` on the phrase silently measures the wrong region. The count is
now defined on a boundary that cannot be misread: **44 `assert()` call sites between
`season plays 4 frames` and `the header follows the script to window 42`**, and `darwin/CLAUDE.md`
states that boundary next to the figure so the next reader re-derives the same number instead of a
different one.

**Untouched on purpose, flagged so the next reader does not "tidy" them.** The `.beat-aside` CSS
survives with no JS emitter — `beat()`'s aside slot is still a live capability. `.lede` is now unused in
`render.js` — it is a generic utility. ~~And §8.11's last paragraph is still open: a **selected corpse
wears a mint ring**, which is a judgment about the design system's own invariant and remains the user's
call.~~ — **that one is closed as of 2026-09-02: measured byte-identical to a selected living ring, and
fixed the way §8.11 itself recommended. See §8.11's last paragraph.**

**RESOLVED — the "where this stopped" note above is history, not current state.** As of 2026-09-02 the
whole chain runs clean: `npm test --prefix web` **135 PASS / 0 FAIL** over 34 render calls (33 `ok` + 1
that correctly renders null) — **149 / 36 as of 2026-09-03 (§8.16), and 189 checks over 167 `assert()`
call sites as of 2026-09-05 (§8.17, which also explains why the "36" was never a render-call count)** —, `npm run build --prefix app` clean with `dist/arena/ <- web/`,
`node app/test/arena.mjs` **PASS** (0 exceptions, 0 console errors, 20 requests / 0 off-origin, 0
stranded nodes, 13 cards / 3 corpses), and `node app/test/landing.mjs` **PASS** — the two tests this
section recorded as *never run* have now both been run. `shots.mjs` writes stills and asserts nothing.
Nothing here is deployed, which is still the user's call.



### 8.13 The agent-society review of §8.7 — 28 agents, ZERO confirmed findings, two real bugs found beside it

Run 2026-09-02. Workflow `arena-review-87` (task `wg2dhfu91`, run `wf_c920e415-992`): four review
dimensions fanned out over the `/arena` surface, every finding sent to three adversarial verifiers
prompted to *refute* it and to default to refuted when uncertain. 28 agents, 498 tool uses, ~2.49M
subagent tokens, 27.7 minutes, 0 errored. The journal
(`journal.jsonl` under `subagents/workflows/wf_c920e415-992/`) records each agent's actual return
value — read it before diagnosing any empty result.

**Result: `confirmed: []`.** Every finding was killed by its own verifiers. That is a real outcome and
worth stating plainly rather than dressing up: the four dimensions produced no defect that survived
adversarial review. Findings killed, with the refutation that did it:

- **`arena.mjs` dead locals** — refuted 3x.
- **A total read outage renders as absence, not as an error** — refuted 3x. `app.error` is set and the
  banner shows; the premise was wrong.
- **The metrics strip's "40% of rake" / "2.5% of profit" captions misdescribe `_book`** — refuted. The
  captions are *parameter disclosures* guarded on the config field each one prints, not arithmetic
  claims about the neighbouring value.
- **`generic()`'s tautological assertions** — conceded by all verifiers as a real dead assertion but
  low severity. **Fixed anyway, see below.**
- **The `Settled` row grades every non-win as "wrong"** — refuted 3x, all on *consequence*, and one
  refutation rests on a claim that is false of the chain. **Fixed anyway, see below.**

**What the review's severity argument got wrong, and it matters.** Two verifiers killed the `Settled`
finding partly on "abstainers emit no `Settled` log", citing the fixture. That is true of the
**fixture** and false of the **contract**. `Prophet.settleWindow`'s abstain branch
(`Prophet.sol:476-497`) is straight-line — it increments `abstainCount`, zeroes `streak`, and falls
through to `emit Settled(prophetId, currentMarketId, won, collateralOut, treasury)` at `:520` with
`won == false`. So on the live path an abstain **does** produce a `correct: false` row. The verifiers
were reasoning from the demo fixture, which is the incomplete artefact, and killed a mechanism claim
that the contract itself confirms. Their own second point concedes the payloads are byte-identical but
for `treasury`.

The lesson is narrower than "the society was wrong": a verifier reading only the fixture will refute
any claim about a branch the fixture chose not to exercise. Verification of a live-path claim has to
land on the contract.

**Two live-path defects were found by hand in the same pass and fixed. Neither came from the society.**

**(a) One flaky read out of twenty-two blanked the entire arena.** `wiringPanel` printed
`${stt(cfg.cognitionEndowment)} STT` and the same for `requestDeposit` — the only two unguarded money
rows in the panel. `discover()` settles all 22 constants independently and writes `null` for any one
that reverted (`chain.js:174-181`); `units()` opens with `BigInt(value)` (`format.js:17`) and throws on
null; and `paint()` builds `#body` from a **single `mount(...)` argument list** (`main.js:232-241`). So
one rejected RPC response discarded the grid, the tree, the census, the claim panel, the feed **and the
`readErrors` panel that exists to name exactly which read failed**, leaving a masthead over a blank
page. Fixed with `dash(...)` at both call sites.

The guard belongs at the call site and **not** in `units`: it is the character-for-character port of
`fmt` in `scripts/lib/darwin.ts`, kept identical so the page and `monitor.ts` can never disagree about
a treasury. Teaching it to swallow null would hide the next unguarded call site instead.

Covered by a **23-key x 5-panel sweep** — every key `discover()` can null, including `positionToken`,
against `wiringPanel`, `header`, `grid`, `detail` and `feed`. Reverting one line reproduces the
original crash as `FAIL  no panel throws when any one discovered key comes back null  <-
wiringPanel(cognitionEndowment: null) -> Cannot convert null to a BigInt`.

**(b) `Settled.correct` is not the forecast grade, and the feed asserted that it was.**
`Prophet.sol:444` assigns `won = collateralOut > staked` and `:522` emits it as the parameter *named*
`correct`. The real grade is three-valued at `:474-495`: abstain (checked first) -> `abstainCount`,
`won` -> `correctCount`, `lost` -> `wrongCount`, and a fourth state — a real position with
`collateralOut == staked`, a voided duel refunding both antes — increments **nothing**. The event
carries neither `quantity` nor `belief`, so the row cannot tell them apart. It printed red "wrong" for
all three, contradicting the organism's own W/L/A record on the card beside it, and abstaining is
ordinary by design here: an organism that cannot afford its inference deposit abstains, and a
non-`Success` inference collapses to `Abstain` rather than reverting. Now green "correct" / amber
" no win", with a title naming `Prophet.sol:444` and the record as the authority. `SEVERITY`
(`render.js:1539-1551`) deliberately has no `Settled` key, so that inline chip is the row's only
colour.

**A test that could not fail, twice over, and the lesson generalises.** Two assertions read
`!t("feed").includes("unknown event")` — and **no code path anywhere emits that string**. `generic()`
prints `k=v · k=v` built from the args, or "no arguments" when there are none
(`render.js:1532-1537`). Both were green on a feed composed *entirely* of fallback rows, which is
precisely the state they were written to catch. Rewritten (not deleted, per §8.5's precedent) to
compute what the fallback would print for each row's **own** args and look for that. Perturbation:
renaming the `Raked` summariser yields `FAIL ... <- unsummarised: Raked` and
`FAIL ... <- unsummarised: Raked, Raked, Raked, Raked`.

The same defect had also been shipped in a *new* assertion during this very session — a discriminator
reading `painted.feed.classes.includes("ok") && ...includes("warn")`, which passed under perturbation
because the fixture's `Reacted` row carries `viaReactivity: false` on purpose (`fixture.js:334-340`)
and that branch emits a bare `warn` (`render.js:1526`). So `warn` was in the whole-feed class bag
whichever branch a settlement took. It was caught only because the fix was reverted to check that all
four new assertions fired, and one did not. It now renders the settlement rows **alone**
(`painted.feedSettled`) and asserts on that bag.

**So: every "X cannot happen" assertion in this suite is now paired with a control that makes X happen
and requires the same detector to fire.** Three such controls existed on this date, six as of
2026-09-03 (§8.16); deleting one restores a test that cannot fail. This is the same rule §8.5 arrived at for `claimPanel()` and is now the suite's standing
convention.

**Verification chain, in the order §8.8 requires it:** `npm test --prefix web` -> **135 PASS, 0 FAIL,
34 render calls (33 `ok` + 1 `null`)**; `npm run build` from `app/` -> clean, `dist/arena/ <- web/`;
freshness probe on `http://localhost:3000/arena/js/render.js` -> serves `no win` and the null guards;
`node app/test/arena.mjs` -> **PASS**, 0 exceptions, 0 console errors, 20 requests / 0 off-origin, 0
stranded nodes, 13 cards / 3 corpses.

**One decision is the user's and was not taken here.** The root cause of (b) is that
`Prophet.sol:138-140` *names* the event parameter `correct` while assigning it `won`. Renaming it, or
adding the graded outcome to the event, costs **no storage slots** — events are not storage, so the
2026-09-02 freeze does not forbid it. But it is a contract edit: outside `/arena`, requiring
`forge test` (98 tests) and a storage re-derive, and the deploy is the user's call. The frontend fix
stands on its own either way.

**A third defect surfaced afterwards, while reconciling these docs, and it is the sharpest of the
three.** Closing out §8.11's one open paragraph meant measuring the selected-corpse ring instead of
arguing about the cascade — and the ring turned out to be **byte-identical** to a selected living
node's. The rule that hid it had sat one line above a rule fixed for the identical flaw on
2026-09-01, and the harness check whose own message read *"selection has un-killed it"* was comparing
the wrong element and had passed all day. Written up in §8.11's last paragraph. The pattern is the same
one this whole section is about: **the instrument agreed with the page because it was not pointed at
the thing the sentence described.**

### 8.14 §5.4 — CLOSED as DO NOT BUILD, and the reason is written down

§5.4 proposed a duel-resolution timeline: an animated view of two paired organisms resolving against
each other. It is closed as **do not build**, not deferred as "optional if there is time", because the
data to draw it honestly does not exist on this page.

- **There is no counterparty field anywhere in the read surface.** `snapshot()` carries 16 fields
  (`abi.js:43`) and the per-organism reads carry 7 more (`abi.js:132-139`); none of them says who an
  organism was paired *with*. That fact lives only in the `Paired` event.
- **The log stream and the snapshot do not share a clock.** The feed refreshes at most every
  `POLL_FEED_EVERY_MS = 60_000`, or on a window change (`main.js:494-496`), over a **sliding** scan
  range whose anchor can fall out of range entirely (`main.js:94-100`). The grid and header refresh on
  the ordinary poll. So the pairing you would animate and the treasuries you would animate it against
  can be a minute apart, and nothing on the page can tell you when they are.

So a duel timeline would either invent the pairing or draw a stale one as if it were live — and this
page's stated invariant is that **motion is a property of the diff**, never of rendering. An animation
of a pairing the snapshot cannot confirm is exactly the class of thing `?demo=1`'s banner exists to
prevent. Building it would require adding a counterparty to `snapshot()`: a contract change for a
decoration, after the storage freeze, for a view whose absence no judge will notice.

Note the argument that was *rejected* on the way here: "a duel timeline is impossible because
`Deploy.s.sol` wires `DreamDEXVenue`, not the duel venue." That is wrong — `_pair` clamps both legs on
either venue, so pairing exists on both, and the venue only bears on whether the word "duel" is the
right label. The decisive facts are the missing counterparty field and the 60-second feed clock.

What ships instead is already built and is the honest version of the same idea: the scripted season
(§7) animates the four driver calls the chain actually reports, `Paired` and `Settled` rows appear in
the feed with their real arguments, and the settlement chip now grades three outcomes instead of two.

---

### 8.15 The landing's turn at the 22-null-keys bug — three fixes, CLOSED 2026-09-03

`/arena` was fixed on 2026-09-02 for rendering a screen of dashes against an address with no contract
behind it. **`app/` had the identical defect, one surface over, and a worse version of it.**

`usePopulation()` decides `status: "found"` from `isAddress()` — a forty-hex-character regex — and the
address can arrive from `localStorage["darwin.population"]`, which is whatever was last typed into the
arena's setup card. Point it at an EOA and nothing in the app ever asked the chain: all nine reads
returned `0x`, `allowFailure: true` turned them into nine `undefined`s, every `<Val>` rendered the
**loading skeleton**, and the footer went on asserting *"Read from 0x… every twenty seconds"*. A form
that cannot work, presented as a form that is still thinking. The only gate was
`pop.status === "undeployed"`, which that address does not trip.

**Three fixes, in the order they had to happen.**

**1. `src/lib/reads.js` (new) — turn the failure channel into an answer.** `readReport(query)` returns
one of four verdicts, and the two that matter most are not one verdict:

| verdict | means | what the page must do |
|---|---|---|
| `pending` | nothing settled yet, or the query is disabled | say nothing |
| `live` | ≥1 read answered | render; there is a Population here |
| `absent` | every read failed **and viem says there is no code** | accuse the address |
| `unreachable` | every read failed, for transport reasons | blame the network, never the address |

`absent` vs `unreachable` is **read off the error, never inferred from a tally**: a call to an address
with no code returns `0x`, which surfaces as `AbiDecodingZeroDataError` and is re-thrown as
`ContractFunctionZeroDataError` carrying *"returned no data (\"0x\")"*
(`viem/utils/errors/getContractError.js:15-16`). A transport failure has no such cause anywhere in its
chain. Counting failures cannot tell the two apart, and guessing would send a judge on a testnet
hiccup off to edit a perfectly good address. **Partial failure is deliberately still `live`** — one
dropped read out of nine is a flaky public RPC, and locking the form for it would be worse than the
bug being fixed; the rows that failed are named individually at their own value cells via
`readFailure(data, i)`.

**2. `src/sections/Enter.jsx` — the `badQuery` notice.** `settings()` records a malformed
`?population=` as `badQuery` and then resolves as if it were absent, so the page showed a *different*
arena than the URL asked for with no indication anything had been ignored. The arena forces its setup
card open for exactly this case (`render.js:1837-1844`); the landing now prints the notice above the
branch chain and names both what was typed and what is actually being read instead.

**3. `src/lib/liveness.js` (new) + `src/sections/Hero.jsx` — the dot had to be derived, not printed.**

This one was **the user's correction, and my call on it was wrong.** I had proposed leaving the hero's
unconditionally-pulsing `.dot-live` and its hardcoded `Season 1 · 576 windows` as a *report* only, on
the grounds that the hero is illustration and gating it is a design decision. It is not a design
decision. `.dot-live` is **the only mark on either surface that asserts "this reading is current" with
no number beside it** (`styles.css:307-311`) — the same defect class as the arena's printed
`Status: LIVE`, already logged as the most serious finding of that rebrand. It was pulsing above an
entry form that was simultaneously refusing to render because there is no contract at the address:
**the top of the page more confident than the bottom, about the same arena.**

`useArenaLiveness()` is two reads, not nine, because the hero needs exactly one thing — permission to
claim it is looking at something. It is a hook rather than a prop drilled from `App` because the hero
is mounted imperatively and the entry form is a thousand lines away. Note the deliberate asymmetry
with `Enter.jsx`: a partial batch is `live` there because eight of nine reads still quote a minimum;
here the pill needs **both** numbers, so `verdict` alone is not enough and the caller checks them.

The season pill is `seasonId`/`seasonWindows` because that is what it claims.
`Population.sol:372-373` initialises them to **1 and 576** — which is precisely why the hardcoded copy
looked correct, and why it would have gone on looking correct through a `setSeason` that moved both
(`Population.sol:639-649`). Reading the pair in one batch also means the numbers cannot be current
while the dot is dead, or the reverse.

**Checks 8, 9 and 10 in `test/landing.mjs`, and why check 7 could not have caught any of this.**
Check 7 asks "did the page render one of the two branches it has always had" — answered *yes* by the
bug it sits directly above. What distinguishes a working absent branch from a broken one is a
**difference between two pages**, so one `PROBE` expression is read against three navigations and the
assertions compare them:

- `?population=0x000000000000000000000000000000000000dEaD` — the burn address, chosen because it holds
  no code on any EVM chain *by construction*; `0x…dead` shapes are cute but could in principle be
  deployed to. 6000ms settle, because `retry: 1` (`main.jsx:38`) means viem attempts all nine reads
  twice before any is a failure. `unreachable` is **accepted alongside** `absent` here and deliberately
  not a failure: if the RPC is rate-limiting, viem never learns there is no code, and the correct page
  in that case is the one that does not accuse the address.
- `?population=0xnope` — must produce the ignored notice.
- **no query — the control.** The same detector must report something *different* here or it is reading
  nothing. Today that page is `undeployed`; after Season 0 it is the form. Either is fine; what is
  forbidden is the two navigations looking identical.

`forget()` precedes each navigation so one page's console errors are never attributed to another.

**Verified by perturbation, not by reading.** Reverting each fix in turn, rebuilding, and re-running:

| perturbation | harness said |
|---|---|
| `report.verdict === "absent"` → `&& false` | `EOA pointed: grid=true absent=false` → **FAIL, 2 problems** (notice missing; form rendered against the burn address) |
| `badQuery` notice off, `dot dot-live` unconditional, season pill hardcoded | `pulse=true season=true ignored=false` → **FAIL, 3 problems**, hero reading `"No arena at that address · 5031215-minute windowsSeason 1 · 576 windows"` |

That last string is the exact incoherence the fix exists to prevent: the pill *text* derived, the dot
and the season not. Clean run from current disk state:

```
control (no query): grid=false undeployed=true absent=false pulse=false skel=0
EOA pointed:        grid=false absent=true unreachable=false pulse=false season=false skel=0
  hero says: "No arena at that address · 5031215-minute windows"
bad query:          ignored=true grid=false pulse=false
PASS
```

0 console errors, 0 warnings, 0 exceptions; 7/7 sections; 0 stranded nodes at six scroll stops; death
fires and stays fired (doomed a52 against a living a212).

**One divergence was found here and deliberately deferred; the user asked for it the same day, so it
is CLOSED in §8.16.** `web/js/chain.js` conflated `absent` with `unreachable` on the arena side and
used a two-read threshold where the landing uses any-of-nine.

---

### 8.16 The same fix on the arena side — the two surfaces now agree. CLOSED 2026-09-03

§8.15 found the divergence and left it; the user asked for it closed the same day. One line in
`web/js/chain.js` carried **two** defects:

```js
if (!out.collateral && !out.symbol) throw new Error(`No Population at ${population} …`)
```

**Defect 1 — a two-read threshold over twenty-two settled calls.** Every other discovered key was
allowed to come back null on the stated reasoning that `readErrors` names it while the rest of the
page stays live (§8.13's 23-key null sweep exists for exactly that). But `symbol` and `collateral`
were silently exempted from that rule and promoted to a liveness test, so a node that dropped those
two while answering the other twenty declared a live arena dead. The landing uses **any-of-nine**
(`app/src/lib/reads.js`), so under partial RPC failure the two surfaces could disagree about whether
the same arena exists. It is **any-of-twenty-two** here now: one answer is proof of a contract.

**Defect 2 — `absent` conflated with `unreachable`.** Every path out of that throw printed *"No
Population at 0x…"*, so an RPC outage accused the address and sent the visitor off to edit a correct
one. That is the precise failure `reads.js` was written to avoid on the landing, reproduced one
surface over.

**What changed.** `causes` / `saysNoCode` / `readVerdict` are now in `chain.js`, kept deliberately in
step with `app/src/lib/reads.js` — the two surfaces must not disagree about whether an address holds
a contract, and they only did because this file had no equivalent at all. The verdict is read off
viem's `ContractFunctionZeroDataError` cause, never off a failure tally. `discover` throws an error
tagged `.kind`, and three things branch on it:

| | `absent` | `unreachable` |
|---|---|---|
| banner headline | *"No arena at that address."* | *"The chain did not answer."* |
| what is blamed | the address | the network |
| the address form | **forced open** | **left closed** |

The form asymmetry is the substantive half. `absent` is remedied by editing the address, so the field
that edits it must not be folded away — the same reasoning `badQuery` already used. `unreachable`
leaves the address **unjudged**, and inviting an edit there is advice to break a working setting.

**`readVerdict` is exported for the test and takes `Promise.allSettled` rows rather than a client.**
That is the only way any of this is reachable from Node: `discover` needs viem and therefore the CDN,
and `smoke.mjs` runs with no network by design.

**Verified by perturbation, in two passes.** Restoring the old two-read/conflating verdict:

```
FAIL  every read failing with 0x reads as absent  <- unreachable
FAIL  twenty answered reads outweigh the two the old test looked at  <- unreachable
FAIL  one answer out of twenty-two is live
FAIL  the detector is reading the rows: removing the successes flips the verdict
FAIL  one 0x among transport failures still names the address  <- unreachable
FAIL  an empty batch is never live
6 FAILURE(S)
```

Then, with the verdict restored, collapsing the banner to one headline and opening the form
unconditionally:

```
FAIL  the absent banner blames the address  <- Cannot read the chain. There is no Population at 0x…dEaD…
FAIL  the three banners do not share a headline
FAIL  an unreachable chain leaves the form closed  <- the form opened for a network failure
3 FAILURE(S)
```

Both reverted. Nine new assertions, and **three of them are controls** in the §8.13 sense: a mixed
batch must flip verdict when its successes are removed (or the two failure assertions are measuring
the classifier's floor rather than its logic), the three banners must not share a headline, and
`unreachable` must leave the form closed.

**One thing the harness caught that reading would not have.** The first version of the open-form
assertion was `getAttribute("open") === "true"` and failed against a form that was correctly open:
`open` is a boolean attribute, so `el()` writes it as the **empty string** (`dom.js:42-43`) and skips
a falsy prop entirely (`:28`). Present-vs-absent is the test, not a value. A `=== "true"` check would
have been a permanently-red assertion on correct code — the mirror image of the green-on-broken
checks this section keeps finding.

**Verification chain:** `npm test --prefix web` → **149 PASS / 0 FAIL** over 36 render calls
(35 `ok` + 1 `null`, up from 135/34) — *the figures of 2026-09-03; see §8.17 for the 2026-09-05
re-measurement and for why "36 render calls" was a mislabel* —; `npm run build --prefix app` clean; freshness probe on
`http://localhost:3000/arena/js/render.js` serves both new strings; `node app/test/arena.mjs` →
**PASS** (13 cards / 3 corpses, 0 stranded, 20 requests / 0 off-origin, 0 console errors, 0
exceptions); `node app/test/landing.mjs` → **PASS**, unchanged.

Nothing about `?demo=1` moved: the fixture has `failures: {}` and resolves through `discover`'s
`live` path, which is why `arena.mjs` reads identically before and after.

**Figure propagation, closed the same day.** The suite's headline numbers live in eight places and
four were still saying `34 / 135` after this work: `README.md:337`, `web/README.md:59-63`,
`SESSION_CHECKPOINT.md:1182`, and the "RESOLVED" note at `:1361` of this file. All now read `36 / 149`
or name both figures with their dates. **The dated run records are deliberately NOT rewritten** —
`:1327-1328` and `:1464` keep the figures that were actually measured on 2026-09-02 and carry a
forward pointer instead, because a checkpoint whose past entries get silently re-stamped stops being
evidence of anything. Same treatment for the detector-self-test count: three on 2026-09-02, six now,
and both §8.13 and `SESSION_CHECKPOINT.md:1288` say which is which rather than only the latest.

---

### 8.17 The season close a judge can watch, the legibility pass nobody wrote down, and the figure that was never what it claimed. CLOSED 2026-09-05.

Three things landed on the frontend between §8.16 and here, and only one of them had been recorded
anywhere. This section closes audit item **C2** — previously tagged *"[HECHO, SIN REVISAR]"*, i.e.
written but never watched in a browser — and writes down the other two.

#### 1. C2 — the demo season now closes, and the length is derived rather than chosen

`?demo=1` used to show a season that grew and never ended, which meant **two renderer branches had
never once been on screen**: `SUMMARY.SeasonEnded` and `SUMMARY.SeasonPrizePaid`
(`render.js:1463-1464`). A judge landing on the review surface could not see the payout at all — the
one moment where the whole economic argument resolves.

The fixture now runs the close. The interesting part is that **`seasonWindows: 42` is the only value
that works**, and `fixture.js:62-74` derives it rather than asserting it:

- `endSeason` opens when `windowCount - seasonStartWindow >= seasonWindows`. The base snapshot sits at
  `windowCount: 41n`, and a fixture that was *already* closeable would be showing a state the contract
  would not have left standing — so **`seasonWindows > 41`**.
- The scripted season turns the window to 42, and that turnover is the only one a judge watches — so
  **`seasonWindows <= 42`**.

`levelWindows: 12` is scaled down from the contract's 72 for the same reason and says so at the site: a
fixture running at the shipped scale (`seasonWindows = 576`, about six days) **can never show a close**,
so demonstrating the mechanism at all requires compressing it. That is a scale change, not a
favourable one — every figure still recomputes from `config` and the contract's own formulas.

`seasonId: 1` at `:231` carries its derivation in the comment: the initializer sets 1
(`Population.sol:413`), `endSeason` is the only writer and moves it by `seasonId += 1`, and 41 into 42
means it cannot have run yet. So the fixture and the live chain now agree on the season number, which
they did not before §8.16.

**One detail in the close is deliberately backwards, and it would read as a bug.** The chain emits
`SeasonPrizePaid` once per winner and `SeasonEnded` **last**; the fixture reverses that order
(`fixture.js:937`) because the feed is newest-first, and reversing the chain's own log order is what
puts the summary at the **top** rather than buried under three payouts. Both events carry the season
that **ended** (`:908`, `:914` read `s.seasonId`) while `seasonId += 1` happens after (`:923`) — same
as the contract.

**Verified in a browser, not by reading**, which is the part C2's old tag was missing.
`node app/test/arena.mjs` → **PASS**: the feed renders *"SeasonEnded · season 1 ended · pot 4.54 tUSDC ·
paid 4.54 tUSDC"* with **3 payouts**, 3 `sev-good` banners and 50 feed rows, alongside 13 cards / 3
dead, 0 stranded nodes, 20 requests / 0 off-origin and 0 exceptions.

**Six detector self-tests came with this work**, at `web/test/smoke.mjs:806`, `:811`, `:826`, `:835`,
`:841` and `:855` — each one adjacent to the assertion it protects, with the reason in the comment
above it. That brings the suite's total to **twelve**, and the standing convention holds: a check whose
subject is *"X cannot happen"* ships next to one that makes X happen on purpose and requires the same
detector to fire. Delete a control and you are back to a test that cannot fail.

#### 2. The legibility pass in `web/js/labels.js` — +52 lines, and undocumented until now

Not a rename sweep. Each addition is a claim about what a reader who has never opened the contract
would conclude from the old label.

**`BELIEF_HUMAN = ["no call", "Up", "Down", "Abstain"]`.** `None` was the one that had to be
translated, and the reason is a timing fact rather than a style preference: `None` is what
`Prophet.settleWindow` writes at `Prophet.sol:528` and what `die` writes at `:536`, so **for the whole
of phase 0 it is the value on every living organism**. "None" reads as *missing data* — as though the
page failed to load a field — when what it means is "holds no position right now". A dashboard whose
idle state looks like a loading failure is broken even though every value on it is correct.

**`Abstain` is deliberately left alone**, and this is the more useful half of the finding. It is
ordinary English *and* it is a different fact from `None`: the organism was asked, the validators
agreed, and the answer was a refusal to call the window. Collapsing the two would hide the distinction
that makes an abstain **cost the same metabolism as a wrong answer** — which is the pressure the whole
selection mechanism runs on.

**`THESIS_GLOSS`** exists because `Reversion` and `Range` are opposite claims about the same chart and
a reader without trading vocabulary cannot tell them apart. Selection-over-ideas is the headline claim;
a label a judge cannot decode does not carry it.

**`PHASE_GLOSS` and `PHASE_NEXT_HUMAN`, and the off-by-one nobody had named.** `Population.sol:92`
comments `phase` as `0 idle, 1 thinking, 2 committed` — the population's **state**. The operational
scripts' own `PHASE` array is labelled by the **next action** (`THINK`, `COMMIT`, `SETTLE`). So **the
same number 0 reads "idle" in the contract and "THINK" in the terminal.** Both are correct and they are
off by one step. A dashboard that picked one and dropped the label would describe a live population
backwards. This one shows the state (`PHASE_GLOSS`: *"between windows"*, *"inference is out with the
validators"*, *"positions are open against the market"*) and names the call that advances it
(`PHASE_NEXT_HUMAN`: *"ask every organism"*, *"pair the disagreements"*, *"settle, grade and charge"*).

**Both the sentence and the selector ship, and dropping either would be a regression.**
`PHASE_NEXT`'s `commitAll()` is a Solidity function name: exactly right for somebody who intends to
verify the cadence against the contract, and meaningless to somebody still working out what the page
is — it names the *caller's action*, not the event. The sentence leads; the selector stays beside it.

**`labels.js` imports nothing, and that is load-bearing rather than tidy.** The file says so at the
top: the fixture renderer, the formatting helpers and the lineage layout all need these labels, and
none of them should drag a 1 MB chain library off a CDN to spell the word "Momentum". `abi.js` is the
only module that touches viem and it is reached only through a lazy `import()`, which is what makes
`?demo=1` render with the network unplugged — and `web/test/smoke.mjs` asserts it by loading `chain.js`
with no network. Make either one a static import and that assertion fails.

Indices are on-chain enum values. **Do not reorder any array in this file** — a reordering silently
mislabels every organism on the page, and nothing would catch it.

#### 3. The figure this checkpoint had been repeating was never what it said it was

`149 PASS over 36 render calls` was the headline in four live places in this file. Both halves needed
correcting, and the second one was not a stale number but a **mislabelled** one.

Measured today by instrumenting the renderer in memory (`.tmp-verify/hooks.mjs`, a Node `load` hook
that wraps every `export function` in `web/js/render.js`; it works because `export function f(){}`
declares a *mutable* binding and ES-module exports are live, so **no file in the repo was touched**):

| Figure | Value | What it actually counts |
|---|---|---|
| checks | **189 PASS / 0 FAIL** | `assert()` invocations that ran |
| assert sites | **167** | `assert(` in statement position. Raw grep gives 169 = 167 + the `function assert(` definition + one mention inside a comment |
| renderer call sites | **50** | `ui.*(` in `smoke.mjs`, across **13** of `render.js`'s 16 exports |
| executed renderer calls | **313** | calls to the **fifteen exported renderers that are not `chip`** |
| … including `chip` | **1037** | `chip` alone is **724**; `1037 − 724 = 313` |
| exports exercised | **14 of 16** | `masthead` and `retime` never run under the fixture |
| printed probe lines | **36** | 35 `ok` + 1 `null` — **this is what the old "36 render calls" was** |

So `313` had been correct all along and its basis had never been written down anywhere, while `36` was
a real measurement of the wrong thing. The rule that follows, and the actual fix: **a count in these
documents carries its basis in the same sentence, or it does not get written.** *"189 checks"* is
something a reader can only believe; *"189 checks over 167 `assert()` call sites"* is something they
can re-measure.

Per §8.16's rule, the four **live** carriers of `36 / 149` were re-stamped (§1's header paragraph,
§5.1's parenthetical, §8's status header, and the "RESOLVED" note in §8.12) and the **dated run
records** were left exactly as measured — §8.8 items 1 and 5, and §8.16's own verification chain,
still read `36 / 149` and now carry a forward pointer here, *because a checkpoint whose past entries
get silently re-stamped stops being evidence of anything.*

**And the sweep that preceded this one missed two carriers, which is the more useful failure.** The
audit's N6 closed this as *"six sites, not two"* — but there were **eight**, and the two it missed
were `darwin/README.md:345` and `darwin/web/README.md:59` / `:63-64`. Both are now fixed with their
bases stated. The reason they survived is worth keeping: that sweep searched where the internal docs
cite each other, not where the project speaks **outward**, so the two stale copies left standing were
precisely the two a judge opens first. And `web/README.md` spells its figures **in words** —
*"thirty-six calls"*, *"One hundred and forty-nine assertions"* — so a grep for digits could not see
them. A figure sweep runs over the whole tree, including the READMEs, and searches for the number
written out as well as in digits.

#### 4. Two workflow traps that bit today and will bite again

**`app/dist` had gone stale, which is N7 re-arming.** 5 of the 11 files in `dist/arena/js` differed
from `web/js` (`abi.js`, `dom.js`, `fixture.js`, `labels.js`, `render.js`) — dist was built at 12:10,
`web/js` was edited 15:24–15:51. `dist/arena` is a **build-time verbatim copy**, so the harnesses were
measuring the previous bundle and passing happily. Fixed by `npm run build --prefix app`; re-hashed to
**0 of 11 differing**. The order, and the third step is the one that cannot be skipped: edit `web/` →
`npm run build --prefix app` → **hash both directories** → then the harnesses. Comparing mtimes is not
enough, and nothing in the suite detects this on its own.

**`arena.mjs` and `landing.mjs` start no server, and the failure when you forget looks like an app
bug.** Start `npm run preview --prefix app` (= `vite preview --port 3000`) first, and use `localhost`
not `127.0.0.1` — `vite preview` binds `::1` only on this machine (`arena.mjs:123`). With nothing on
`:3000` the harness attaches, navigates, and prints **sixteen lines of confident diagnostics about
Chrome's connection-error page** — `title "localhost"`, `sheets=0`, `cards 0 · feed 0 · metrics 0`, all
three fonts `MISSING`, `ground rgb(32,33,36)` — then dies 400 ms later on an unrelated
`getBoundingClientRect` of null (`cdp.mjs:187` via `arena.mjs:441`). It never says *"no server"*, and
that output is indistinguishable from *"the app rendered nothing"*, which is a real defect the harness
exists to catch. Until someone adds a reachability probe: **read `ground` and `cards` before anything
else.** A real run is `cards 13` on the app's own ground; `rgb(32,33,36)` with 0 cards is Chrome.
