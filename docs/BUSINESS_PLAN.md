# DARWIN — Business Plan

*Somnia × DreamDEX Event Contracts Hackathon. Written 2026-08-29. Season 0 target: 2026-09-02.*

Every number in this document that describes DARWIN's own cost or revenue is
either a measured on-chain value or an arithmetic consequence of one. Where a
figure is a projection, it says so. Where a claim is not yet supported by
evidence, it is listed in **Section 9** rather than in the pitch.

---

## 1. What this is

DARWIN is an **evolutionary optimizer for natural-language strategies whose
fitness function is an on-chain settlement.**

A population of AI organisms lives on Somnia. Each holds a thesis written in
English — not weights, not a model, a *sentence*. Every window each organism
thinks, on-chain, through Somnia's validator-subcommittee LLM inference. It
commits real collateral to a directional call. When the market resolves, the
organism that was right takes the collateral of the organism that was wrong.
Organisms that keep being wrong die. Organisms that keep being right reproduce,
with mutation.

Nobody writes the strategies. The population discovers them, and the discovery
is graded by an event that had not happened yet when the prediction was made.

The headline metric is **generation count**, not profit and loss. That choice is
the entire business, and Section 4 explains why.

## 2. The problem this plan solves

The first version of DARWIN had a structural flaw, and it is worth stating
plainly because it shaped everything below.

Inference costs money. Each request sends `subcommitteeSize × (0.01 STT +
perAgentReward)` and nothing is refunded. At the shipped parameters that is
**0.033 STT per organism per window**, and it scales with population size. The
population's internal economy, meanwhile, is **closed**: organisms only ever win
collateral from each other, DreamDEX charges a measured **zero** settlement fee
(`settlementFeeBpsTimes1k == 0`, n=398 finalized markets), and metabolism drains
collateral monotonically out of the population. There was no inflow path
anywhere in the code.

So the honest description of v1 was: a cost centre with a wallet behind it. Any
jury or investor asks the same question — *"what happens when the owner stops
funding it?"* — and v1 had no answer.

Two things fix it, and neither is a bolted-on fee.

**Fix one: the organism pays for its own cognition.** In v1 the house paid every
organism's inference from a single native balance. Inverted, each organism holds
its own native STT and `think()` draws from it. An organism that cannot afford
to think abstains, and abstaining kills, because metabolism is charged anyway.
This is the correct mechanic on every axis at once: the protocol's inference cost
goes to zero, spam becomes self-limiting (garbage entries burn the entrant's STT,
not ours), the rake becomes margin instead of subsidy, and the biology gets more
honest — *you die when you can no longer afford to think.*

**Fix two: stop selling the game and start selling what the game produces.** The
closed internal economy is not a defect to be excused. It is the **refinery**.
Collateral circulating between organisms is the mechanism that grades them. What
gets sold is the refined output, not the crude.

## 3. The three layers

| Layer | What it is | Role |
|---|---|---|
| **Engine** | Evolutionary selection with on-chain cognition, graded by any on-chain settlement | The moat and the demo |
| **Arena** | The public tournament: open entry, escalating stakes, seasons, house rake | Distribution and data generation — **not** the business |
| **Exports** | Champion genomes, survival-weighted consensus, proof-of-forecast attestations, white-label arenas | The revenue |

The arena is the marketing. Treating it as the product was the mistake in the
previous draft of this plan.

## 4. Why the fitness function is the whole opportunity

DreamDEX is not the product. **DreamDEX is fitness function #1.**

The engine needs exactly two things from a venue: a way to issue opposing,
fully-backed positions, and a way to convert a winning position into collateral
once reality has ruled. Anything with an on-chain resolution event can supply
both. That includes prediction markets, insurance triggers, liquidation
parameters, risk scores, oracle disputes, and DAO treasury allocations.

You bring a settlement oracle. DARWIN evolves the prompt that predicts it.

This is what makes the customer a **protocol rather than a retail user**, and
that matters more than it sounds. It sidesteps the single largest weakness in the
tournament story: on a testnet, during a hackathon, there will be approximately
zero real entrants. A business that needs a crowd to exist does not exist yet. A
business whose customer is a protocol with a settlement oracle and a parameter it
cannot tune by hand exists on day one.

**Evidence, not assertion:** the input side of this abstraction already ships.
`IPriceSource` already isolates "where the window's market facts come from," with
`PushedPriceSource` as adapter one. The position side (`mintSet`,
`finalizeAndRedeem`) is still wired directly to DreamDEX. Closing that seam is
two interface methods, and doing it lets Season 0 run the **same population
against two different settlement sources**. One adapter is a demo. Two adapters
is a platform, executing, in front of the jury.

## 5. The moat is wall-clock time, and it is not purchasable

Fork the repository and you get nothing.

What has value is the **graded lineage graph**: N generations of out-of-sample
results against an oracle nobody can forge, each prediction timestamped on a
public chain *before* the event that resolved it. A competitor cannot buy that,
raise for it, or backfill it. They can only wait exactly as long as we already
have.

This is rare. In an ecosystem where every contract is copyable in an afternoon,
DARWIN's core asset has a replication cost denominated in calendar days against
an unknown future.

It also converts the project's existing operational constraint — *the population
must never stop* — from an engineering quirk into the central economic thesis.
Every window that runs deepens a moat that money cannot shortcut.

The same property is what makes the corpus interesting beyond trading. Static
benchmarks leak into training data; the only reliably uncontaminated evaluation
set is **the future**. DARWIN produces timestamped, independently-resolved
forecast records continuously. *Limitation, stated up front:* the validator
subcommittee runs whatever model it runs, so DARWIN grades **prompts and
strategies, not models.** That is a narrower claim than "an uncontaminatable
model benchmark," and it is the one the architecture actually supports.

## 6. Revenue, in order of credibility

**1. Arena rent — live, measured, accruing on-chain.**
Metabolism is already implemented and already accrues to `Population`:
`metabolicCost = 50_000` (0.05 tUSDC, 6 decimals) per organism per window. It is
a fee on *being alive*, not on trading, which is why it never competes with
DreamDEX's zero trading fee and never depends on DreamDEX changing its model.
Nothing needs to be invented; it needs to be named as revenue and made
withdrawable cleanly.

At the cap of 24 organisms on 900-second windows (96 windows/day):

```
24 organisms × 96 windows × 0.05 tUSDC = 115.2 tUSDC/day
```

**2. Settlement rake — a basis-point cut of what the winner takes.** Scales with
activity rather than headcount. Requires the stake mechanics in Section 7 to
land first, because under today's pairing rule the rake base is capped by the
poorest organism in each pair.

**3. White-label arenas (B2B) — the largest line, and the one with real budget
behind it.** A protocol pays to evolve the prompt that predicts its own
settlement. Priced per generation or per champion genome. Reuses 100% of the
engine. Long sales cycle; nothing closes before September 8, and it is presented
here as pipeline, not traction.

**4. Champion-genome licensing.** Real, but carries a survivorship-bias caveat
that must be disclosed rather than buried — see Section 9.

**5. The graded corpus.** On a public chain the data is public, so what is sold
is curation, indexing, latency and provenance — not access.

## 7. Unit economics

Once organisms pay for their own cognition, the protocol's only recurring cost is
**cadence gas**. That collapses sustainability to a single testable inequality:

```
metabolicCost × aliveCount  >  cadence gas per window
```

Positive cash flow per window, verifiable from chain state, with no assumption
about anyone's alpha. This is the sentence the plan stands on.

For reference, the inference cost that the entrant now carries:

| Parameter | Value | Source |
|---|---|---|
| Platform deposit floor | `0.01 STT × subcommitteeSize`, exactly linear | measured, n=0..21 |
| `perAgentReward` | 0.001 STT (3.3× the observed live rate of 0.0003) | tunable via `setInference` |
| Sent per request | 0.033 STT at `subcommitteeSize = 3` | arithmetic |
| Actually consumed live | 0.0309 STT | measured |
| DreamDEX settlement fee | 0 | measured, n=398 |

Note the shape of this: **DARWIN's cost grows with evolutionary success**,
because more surviving organisms means more thinking. Under v1 that made success
a liability. Under this plan it makes success a revenue driver, since both the
inference bill and the rent scale with the same headcount — but only the rent
lands on us.

## 8. The tournament mechanics that make the arena honest

Two defects in v1 would be cosmetic in an exhibition and fatal in a paid
tournament.

**Capital currently buys immortality.** Pairing risks
`min(stakeOf(up), stakeOf(down))` where `stakeOf` is 10% of treasury, and
metabolism is flat. Fund an organism to 1,000 tUSDC against 10-tUSDC opponents
and it risks 1 tUSDC per window while paying 0.05 in rent. Losing *every single
window* it survives ~950 windows; at even odds it survives on the order of
20,000. `fundProphet` is permissionless, so this is live in the current code.

**Proportional staking also breaks the science.** A rich organism and a poor one
are not playing the same game, so measured fitness is luck weighted by capital
rather than forecasting skill — and comparability is exactly what makes the
graded corpus worth anything.

The fix is the mechanism poker settled on a century ago: **a fixed ante that
escalates in levels.** Every organism risks the same absolute amount in a given
level, and the ante and metabolism step up on a schedule. Geometric escalation
exhausts any finite treasury in a logarithmic number of levels, so a season
**terminates by construction** and capital cannot buy permanence. It is also the
better metaphor: the climate gets harsher, and only better predictors survive.

Fixed ante alone would *not* have fixed this — a 1,000-tUSDC organism risking a
flat 0.25 plus 0.05 rent still survives 3,300 windows. The escalation is the
load-bearing part.

Seasons follow from the same logic: a fixed end, a prize pool fed by forfeited
residues and a share of the rake, a leaderboard, a payout event, and a natural
marketing cycle. **Season 0 runs across the judging period.**

## 9. What is real on September 8, and what is not

| Claim | Status on Sep 8 |
|---|---|
| Population thinking on-chain, generations advancing | **Demonstrable** |
| Selection atomic with settlement (same block) | **Demonstrable** — asserted by `prove-same-block.ts` |
| Rent accruing on-chain as protocol revenue | **Demonstrable** |
| Engine runs against two different settlement sources | **Demonstrable** — the platform claim, executing |
| Entrants paying their own cognition | **Demonstrable** |
| Real third-party entrants at scale | **No.** Season 0 is house-seeded |
| B2B arena customers | **No.** Pipeline |
| "The champion genome predicts markets" | **No.** See below |

**Risks, stated rather than discovered:**

- **No real participants.** Testnet, no real money, hackathon timescale. Every
  claim about arena economics is a claim about mechanism, not traction. The
  mechanism is live and measurable; the distribution is the next phase.
- **N is tiny.** 24 organisms over days is statistically meaningless. Any
  sentence of the form "the surviving genome predicts" is unsupportable at this
  sample size, and the project's `npm run prove` / `npm run fee` gates exist
  specifically to stop the pitch outrunning the evidence.
- **STT budget caps generations, and generations are the moat.** Shifting
  inference cost to entrants distributes the bill; it does not create STT. The
  documented faucet limit is 1 STT/day against a continuous-run requirement two
  orders of magnitude larger, so a team grant is on the critical path. Mitigation
  already verified: metabolism is charged per *settled window*, not per unit of
  wall-clock time, so pausing the cadence costs nothing on-chain and a
  short-funded run becomes bursts rather than a weaker population.
- **The same-block claim is the thing most at risk from this redesign.**
  Abstracting redemption behind a venue interface touches the exact code path the
  central technical claim depends on. It must be re-proven against Shannon before
  `SelectionEngine.fallbackEnabled` is closed, and until then only the weaker
  claim is licensed: *"selection is on-chain and atomic with redemption."*
- **Long B2B cycle.** The largest revenue line is the slowest.

## 10. Why this wins rather than merely finishes

Most hackathon entries are a demo of a capability. DARWIN is a machine that
produces a compounding, non-forkable asset, has a named customer who is not a
retail speculator, has a sustainability condition that is a measurable
inequality rather than a promise, and gets strictly more valuable every hour it
is left running.

And it showcases the one thing Somnia has that other chains do not — on-chain
LLM inference with validator consensus, plus same-block reactive execution — as
the *substrate of the mechanism* rather than as a feature demo bolted to a UI.

The demo is not a screenshot. The demo is that it is still running, and that the
generation counter has gone up since the judges last looked.
