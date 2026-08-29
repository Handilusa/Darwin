# DARWIN — Arena Engine: Design

*Written 2026-08-29. Supersedes the implicit v1 economics. Companion to
`docs/BUSINESS_PLAN.md`, which carries the commercial argument; this document
carries the mechanism.*

**Status: design, awaiting approval. No implementation has started.**

---

## 1. Why v1 has to change

Three defects, all structural, all confirmed against the code this session.

**1. The house pays for everyone's cognition.** `Population.think()`
(`Population.sol:336-408`) sends `dep = requestDeposit()` per living organism from
`Population`'s own native balance. `requestDeposit()`
(`Population.sol:419-422`) returns `floor + perAgentReward × subcommitteeSize`,
and the floor is exactly `0.01 STT × subcommitteeSize` (measured, n=0..21).
Nothing is refunded. So the protocol's cost grows linearly with evolutionary
success, and success is the goal. This is the cost centre.

**2. Capital buys immortality.** `_pair` risks
`min(_stakeOf(up), _stakeOf(down))` (`Population.sol:477-486`), `_stakeOf` is
`treasury × stakeBps / 10_000` with `stakeBps = 1000`
(`Population.sol:534-536`), and `metabolicCost` is flat at `50_000` (0.05 tUSDC).
Fund an organism to 1,000 tUSDC against 10-tUSDC opponents and the `min()` caps
its exposure at ~1 tUSDC/window against 0.05 in rent. Losing *every* window it
survives ~950 windows; at even odds, on the order of 20,000. `fundProphet`
(`Population.sol:665-670`) is permissionless, so this is live in the current
code.

**3. There is no notion of who owns an organism.** `Prophet`'s storage
(`Prophet.sol:35-81`) has no owner or entrant field, and `fund`
(`Prophet.sol:435-437`) is `treasury += amount` with no per-depositor accounting.
A tournament with no players cannot charge for entry.

Defect 2 additionally corrupts the science: with proportional staking a rich and
a poor organism are not playing the same game, so measured fitness is
capital-weighted luck rather than forecasting skill. Comparability is precisely
what makes the graded lineage worth selling.

## 2. Decisions taken

These were delegated to me. Each is listed so it can be vetoed cheaply.

| # | Decision | Rationale |
|---|---|---|
| D1 | Frame as **engine / arena / exports**; the tournament is distribution, not the product | The arena needs a crowd that will not exist on testnet; the engine does not |
| D2 | Extract the **venue** (position + redemption) behind an interface, matching the existing `IPriceSource` seam | Converts a demo into a platform for two interface methods |
| D3 | **Organisms pay their own inference** | Kills the cost centre, makes spam self-limiting, makes the rake margin |
| D4 | **Fixed ante escalating in levels** replaces proportional staking | Kills immortality, restores comparability, guarantees season termination |
| D5 | **Keep `perAgentReward = 0.001`** (changed earlier without being asked) | `setInference` (`Population.sol:258`) makes it tunable on-chain, so the decision is reversible; it buys ~45% more generations, and generations are the moat |
| D6 | **Do not patch `fundProphet`** — replace it with `enter()` + escalation | The exploit's payoff disappears once the ante escalates; patching a function being redesigned is wasted work |
| D7 | **Zero entry fee, mandatory minimum endowment** | Entrants are the scarce input. "You are not paying us, you are funding your player" is both truer and easier to sell |
| D8 | **Residue on death forfeits to the prize pool** | Makes death final, funds prizes, is the standard tournament rule |
| D9 | Initial settlement rake **250 bps**, tunable | No market comparable exists to anchor it; start low, make it adjustable |
| D10 | Ship both documents in **English** | The repo is English throughout and the jury is international |

## 3. Architecture

```
                    ┌──────────────── IPriceSource ────────┐
                    │  what the window IS (exists today)   │
                    └───────────────────┬──────────────────┘
                                        │
   entrant ──enter()──►  ┌──────────────▼──────────────┐
                         │         Population          │
   entrant ──topUp()──►  │  registry · matchmaker      │
                         │  seasons · levels · rake    │
                         └──────┬───────────────┬──────┘
                                │               │
                    openOpposing│               │settleWindow
                                │               │
                    ┌───────────▼───────┐   ┌───▼─────────┐
                    │   IArenaVenue     │   │   Prophet   │
                    │  (NEW seam)       │◄──┤  redeemFor  │
                    └─────┬───────┬─────┘   └─────────────┘
                          │       │
              ┌───────────▼──┐ ┌──▼──────────────┐
              │ DreamDEXVenue│ │ DirectDuelVenue │
              │ complete-set │ │ price-oracle    │
              │ redemption   │ │ escrow          │
              └──────────────┘ └─────────────────┘
```

### 3.1 The venue seam — `IArenaVenue`

The input side of the fitness function **is already abstracted**. `IPriceSource`
(`interfaces/IPriceSource.sol`) returns marketId, pool, up/down outcome ids, open
price, last price, decimals, seconds remaining and tradeability in one call, and
`PushedPriceSource` is adapter one. The design note in that file already
anticipates swapping provenance without touching `Population`.

The *position* side is not abstracted. Two call sites are hard-wired to DreamDEX:

- `Population.sol:516` — `IBinaryPool(activePool).mintSet(address(up), address(down), amount)`
- `Prophet.sol:330` — `IBinarySettlement(settlement).finalizeAndRedeem(pool, currentOutcomeId, quantity, address(this))`

Everything else already flows through parameters. Critically,
`Prophet.settleWindow(settlement, pool, collateral, metabolicCost)`
(`Prophet.sol:310`) takes the settlement address and pool **as arguments**, not
from storage — `Population` decides who gets called
(`Population.sol:559`). So the abstraction is a change of *callee*, not a
restructuring.

```solidity
interface IArenaVenue {
    /// Issue opposing, fully-backed positions of `amount` collateral each to
    /// `up` and `down`. Collateral is pulled from the two organisms.
    /// Returns the outcome ids each side now holds.
    function openOpposing(address up, address down, uint256 amount)
        external
        returns (uint256 upId, uint256 downId);

    /// Convert `organism`'s winning position into collateral, paid to
    /// `organism`. MUST be callable in the same block the underlying resolution
    /// lands. Returns 0 for a loser rather than reverting.
    function redeemFor(address organism, uint256 positionId, uint256 quantity)
        external
        returns (uint256 collateralOut);

    /// Where losing/abstaining organisms' residual claims are booked, if the
    /// venue books rather than transfers.
    function collateral() external view returns (address);
}
```

**The one hard constraint.** `redeemFor` is called *by the Prophet* today via
`finalizeAndRedeem`, and the organism holds the ERC-6909 outcome tokens. For an
adapter to redeem on the organism's behalf it needs operator rights:
`IOutcomeToken6909.setOperator(spender, approved)` already exists in the
interface (`interfaces/IDreamDEX.sol:257`), granted once at birth.

**This is the highest-risk item in the whole design**, because it touches the
exact path the project's central technical claim depends on — consequence in the
same block as resolution. It must be re-proven by `scripts/prove-same-block.ts`
against Shannon before `SelectionEngine.fallbackEnabled` is closed. Until then
only the weaker claim is licensed: *"selection is on-chain and atomic with
redemption."*

### 3.2 Adapter two — `DirectDuelVenue`

A minimal escrow we deploy: two organisms' antes are locked, and resolution is
the sign of `closePrice − openPrice` read from `IPriceSource`. No DreamDEX, no
complete sets, no order book, no market availability dependency.

It earns its place three times over:

1. **It proves generality.** A different settlement *mechanism* (price-oracle
   comparison) rather than a different market on the same venue. One adapter is a
   demo; two is a platform.
2. **It removes a demo dependency.** DreamDEX 900-second markets are
   continuously available but nothing is pre-created; a duel venue cannot be
   unavailable.
3. **It is the resilience fallback** if DreamDEX markets are missing during the
   recorded demo.

*Honest limitation:* a venue we wrote ourselves is a weaker generality proof than
a third-party integration. The substantive claim it supports is that the engine
is indifferent to *how* reality is adjudicated — which is the claim the platform
story needs.

### 3.3 Ownership and entry

`Prophet` gains `address entrant`. Slot 15 currently holds only
`bool positionOpen` (`Prophet.sol:78-79`) with `__gap` beginning at slot 16, so
`entrant` (20 bytes) packs into slot 15 alongside it: **zero new slots.**

```solidity
// Population
function enter(string calldata genome, uint256 endowmentAmount)
    external
    payable
    returns (uint256 prophetId);
```

- Pulls `endowmentAmount ≥ minEndowment` in collateral from `msg.sender`.
- Forwards `msg.value` to the new Prophet as its cognition budget.
- Sets `entrant = msg.sender`.
- Reverts `PopulationFull()` past `maxPopulation`. `maxPopulation = 24`
  (`Population.sol:67`, checked at `:295` and `:634`) is documented as a gas
  bound rather than a design limit and is settable via `setEconomics`
  (`Population.sol:240`); it rises for an open arena, bounded by what `think()`
  can loop over in one transaction.

`spawnGenesis` remains, owner-only, for house-seeded organisms. Season 0 will
use it, and the business plan says so out loud.

**Children inherit the parent's `entrant`.** A good genome reproducing means the
entrant owns more organisms — the reward for skill, and the strongest hook in the
product. `_hatch` already draws `endowment` from the parent's treasury; it
additionally draws native STT for the child's cognition.

### 3.4 Organisms pay for their own cognition

`Prophet` already has `receive() external payable {}` (`Prophet.sol:494`), and a
native balance is `address(this).balance`, not storage. **This change costs zero
storage.**

```solidity
// Prophet
function drawCognition(uint256 amount) external onlyPopulation returns (uint256 sent);
```

`think()` changes from *"send `dep` from Population for each organism"* to
*"draw `dep` from the organism; if it cannot pay, skip it and record an
abstention."* Skipping is already a supported outcome — `think()` wraps each
request in try/catch and emits `ThinkFailed` (`Population.sol:402-404`), and
`abstainCount` exists (`Prophet.sol:76`). An abstaining organism still opens a
zero-size position and still pays metabolism, which is already the documented
behaviour of `commitAll` for unpaired organisms.

`topUpCognition(uint256 prophetId)` is `payable` and permissionless — funding
someone's thinking is harmless once the ante escalates.

**Consequence:** the protocol's recurring cost becomes cadence gas alone, and
sustainability reduces to `metabolicCost × aliveCount > cadence gas per window` —
a measurable inequality rather than a promise.

### 3.5 Fixed escalating ante

`_stakeOf` stops reading treasury. The stake becomes a season-level function:

```
ante(level) = baseAnte × (anteMultBps / 10_000) ^ level
level       = (windowCount − seasonStartWindow) / levelWindows
```

Metabolism escalates on the same schedule. `_pair` no longer takes a `min()`; an
organism that cannot cover `ante(level)` is not paired and, unable to pay rent,
dies — which is clean elimination rather than a special case.

Geometric escalation exhausts any finite treasury in a logarithmic number of
levels, so **a season terminates by construction.** Worked example at
`baseAnte = 0.25 tUSDC`, `anteMultBps = 20_000` (doubling), `levelWindows = 24`
(6 hours): a 1,000-tUSDC organism is eliminated inside ~9 levels ≈ 216 windows ≈
2.25 days, versus effectively never today.

Fixed ante *without* escalation would not have fixed this — the same organism
risking a flat 0.25 plus 0.05 rent still survives ~3,300 windows. **The
escalation is the load-bearing part**, and getting this wrong was the error in
the previous draft.

### 3.6 Seasons, rake, prize pool

```solidity
// Population — new state
uint32  public seasonId;
uint64  public seasonStartWindow;
uint32  public seasonWindows;    // season length; endSeason opens after this
uint32  public levelWindows;
uint256 public baseAnte;
uint16  public anteMultBps;
uint16  public rakeBps;          // on settled winnings
uint256 public rakeAccrued;      // withdrawable protocol revenue
uint256 public prizePool;        // forfeited residues + rake share
uint256 public minEndowment;
address public venue;
```

- **Rent** — metabolism, already implemented, already accruing to `Population`.
  Now booked explicitly into `rakeAccrued` instead of being indistinguishable
  from held collateral.
- **Rake** — `rakeBps` skimmed from `collateralOut` on a winning settlement.
- **Residue** — on death, the organism's remaining treasury forfeits to
  `prizePool` (D8).
- **Payout** — `endSeason()` distributes `prizePool` and opens the next season.
  It is **permissionless once `windowCount ≥ seasonStartWindow + seasonWindows`**,
  so a season cannot be held open by an absent owner. `prizePool` splits
  **60/30/10 to the top three surviving organisms by `correctCount − wrongCount`**,
  paid to each one's `entrant`; ties break toward the lower `prophetId`, and if
  fewer than three organisms survive, the remainder rolls into the next season's
  pool rather than being distributed to the house.

`sweep` (`Population.sol:762`, `onlyOwner`) stays as the emergency escape but
stops being the revenue path; `withdrawRake(address to, uint256 amount)` draws
only against `rakeAccrued`, so protocol revenue can never be confused with
entrants' collateral.

## 4. Storage plan

The layout freezes at the Season 0 deploy, so all of this must land before it.

| Contract | Change | Slot cost |
|---|---|---|
| `Prophet` | `address entrant` | **0** — packs into slot 15 with `positionOpen` |
| `Prophet` | native cognition balance | **0** — `address(this).balance` |
| `Population` | 10 new vars above | shrink `__gap` (`Population.sol:88`, `uint256[20]`) accordingly |

`Population.__gap` has 20 slots; the additions consume roughly 6 after packing
(`seasonId`+`seasonStartWindow`+`levelWindows`+`anteMultBps`+`rakeBps` pack into
one). Ample headroom remains.

**Verification is not optional.** `forge inspect ... storage-layout` must be
re-run and `STORAGE.md` regenerated after the change, and
`test_upgrade_preservesEveryOrganismField` must still pass. Note that
`forge inspect` returned *"storage layout missing from artifact"* earlier this
session even with `--extra-output storageLayout`; a `forge clean` before the
via_ir rebuild is likely required. Do not assert layout safety from reasoning
alone this time — the earlier reasoning was sound only because a numeric literal
in a function body cannot move a slot. **Adding declarations can.**

## 5. Testing

Existing suite is 56 tests. New coverage required:

- **Venue abstraction:** the full window against a `MockVenue`; then the same
  assertions against `DreamDEXVenue` and `DirectDuelVenue`, proving the engine is
  venue-indifferent. This double-run *is* the platform claim, expressed as a test.
- **Cognition budget:** an organism with insufficient native balance abstains,
  pays metabolism, is not paired, and does not halt the window.
- **Escalating ante:** level arithmetic at boundaries; a whale-funded organism is
  eliminated in bounded time (the property that fails today).
- **Ownership:** `enter` sets `entrant`; children inherit it; a non-entrant
  cannot claim.
- **Rake accounting:** `rakeAccrued + prizePool + Σ organism treasuries` equals
  collateral held, invariantly. This is the test that makes "we cannot spend
  entrants' money" structural rather than promised.
- **Residue forfeit:** death moves treasury to `prizePool`, exactly once.
- **Same-block preservation:** `prove-same-block.ts` re-run against Shannon after
  the redemption path changes. Non-negotiable gate before `disableFallback()`.

## 6. Schedule

Deploy moved from Aug 30 to **Sep 2** to fit the storage-affecting work before
the freeze. Runtime is capped by the STT budget, not by the deploy date, so the
later start costs no generations that funding was going to buy anyway.

| Date | Work |
|---|---|
| **Aug 30** | `IArenaVenue` + `DreamDEXVenue`; refactor the two call sites; `MockVenue` tests green |
| **Aug 31** | `entrant`, `enter`, `topUpCognition`, organism-paid inference; tests |
| **Sep 1** | Escalating ante, seasons, rake accounting, `withdrawRake`; storage re-verification + `STORAGE.md` regen |
| **Sep 2** | `DirectDuelVenue`; **deploy Season 0**; `prove-same-block` |
| **Sep 3-4** | `web/` frontend — **does not exist yet**; the largest schedule risk |
| **Sep 5** | Second venue running in parallel; leaderboard |
| **Sep 6** | Record the demo around a real settlement boundary |
| **Sep 7** | Buffer |
| **Sep 8** | Submit |

## 7. Open risks

- **`web/` is two days for a frontend that does not exist.** If anything slips,
  this is what slips, and a running population with a thin UI beats a polished UI
  over a dead one.
- **STT funding is still the top project risk.** The team-grant request has lead
  time and is on the critical path. Mitigation verified: metabolism is charged
  per *settled window*, not per unit of wall-clock time, so pausing the cadence
  costs nothing on-chain and `cadence.ts` resumes from on-chain `phase`.
- **The same-block claim.** Section 3.1. Re-prove before claiming.
- **`maxPopulation` raised for an open arena bounds `think()`'s loop.** Measure
  the gas ceiling before raising it, or a full population makes the window
  unexecutable.
- **`Prophet.sol:209` hard-codes `agree >= 2`** as the consensus floor,
  independent of `threshold`. Raising `subcommitteeSize` does not raise this.
  Out of scope here, but it should not be forgotten.

## 8. Not doing

- **No token.** Revenue in stablecoin (tUSDC/USDC). Decided by the user.
- **No lineage NFTs.** One-time revenue against a perpetual cost, unenforceable
  royalties, and hindsight-selected mints.
- **No per-organism backer staking.** It was the original proposal; under the
  `min()` rule it simultaneously bought immortality and crushed its own fee base.
  The ante escalation replaces it.
- **No pooled vault with a performance fee.** It reintroduces the requirement to
  actually generate alpha, which is the claim this design deliberately does not
  need to make.
