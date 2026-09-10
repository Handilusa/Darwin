// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentRequester, ILLMAgent, Response, Request, ResponseStatus} from "./interfaces/ISomnia.sol";
// `IBinaryPool` is deliberately absent: an organism no longer touches a pool at all.
// What remains DreamDEX-shaped here is the ERC-6909 position token it custodies and the
// owed-balance rescue in `_sweepOwed` — both narrowed further as venues are added.
import {IBinarySettlement, IOutcomeToken6909, IERC20Like} from "./interfaces/IDreamDEX.sol";
import {IArenaVenue} from "./interfaces/IArenaVenue.sol";
import {Genome, Belief, Thesis} from "./Genome.sol";

/**
 *  A single organism.
 *
 *  Deployed as a BeaconProxy clone so logic can be repaired mid-run without
 *  resetting the population's ancestry — which matters because the population
 *  starts running on day 2 and the lineage IS the moat. Storage is therefore
 *  APPEND-ONLY from that point: see ../../STORAGE.md.
 *
 *  An organism owns its own collateral and its own ERC-6909 outcome tokens. It
 *  is not a row in a registry — it is a party that holds positions, forms
 *  beliefs, and can be made permanently inert. Population is a matchmaker and
 *  paymaster that holds nothing between transactions.
 *
 *  THE METABOLIC MODEL. There is no separate health bar. An organism's treasury
 *  is its life, and it dies when it can no longer afford to think. Cognition
 *  costs real value on this chain (validators are paid per inference), market
 *  fees are zero, so a coin-flipper has no expected drift from rake and dies at
 *  exactly its metabolic rate. Survival requires edge in excess of the cost of
 *  thought. Every parameter that tunes this lives in Population, not here, so it
 *  can be recalibrated during the run without a beacon upgrade.
 */
contract Prophet {
    /*//////////////////////////////////////////////////////////////
                          STORAGE — FROZEN LAYOUT
        Append into __gap only. Never reorder, retype, or remove.
    //////////////////////////////////////////////////////////////*/

    // slot 0 — packed (20 + 4 + 4 + 1 + 1 + 1 = 31 bytes)
    address public population;
    uint32 public generation;
    uint32 public streak;
    bool public dead;
    Belief public belief;
    Thesis public lastThesis;

    // slots 1..4
    uint256 public prophetId;
    uint256 public parentId;
    uint256 public treasury; // raw collateral units (6dp on Shannon tUSDC)
    bytes32 public genomeHash;

    // slots 5..6 — dynamic
    string public systemPrompt; // THE GENOME. On-chain because it must be readable.
    string public lastReasoning; // why it believed what it believed, verbatim

    // slots 7..10 — the current window's commitment
    bytes32 public currentMarketId;
    uint256 public currentOutcomeId;
    /// @dev Collateral this organism actually put at risk.
    uint256 public currentStake;
    /// @dev Outcome tokens held. NOT the same number as `currentStake`: a paired
    ///      mint backs one token per unit of collateral from BOTH sides, so each
    ///      organism holds ~2x its own contribution. Redemption is measured in
    ///      tokens, profit and loss in collateral — conflating them would make
    ///      every winner read as a break-even.
    uint256 public currentQuantity;

    // slots 11..13 — in-flight inference
    uint256 public pendingBeliefRequestId;
    uint256 public pendingMutationRequestId;
    string public pendingChildPrompt; // a mutated genome awaiting a birth

    // slot 14 — packed lifetime counters
    uint64 public birthWindow;
    uint64 public deathWindow;
    uint32 public windowsLived;
    uint32 public correctCount;
    uint32 public wrongCount;
    uint32 public abstainCount;

    // slot 15
    bool public positionOpen;

    /**
     *  PADDING, AND NOT DEAD WEIGHT. Slot 15 above holds one `bool` and has
     *  thirty-one bytes spare, so `address public entrant` declared straight after
     *  it lands AT offset 1 of slot 15 rather than on a slot of its own.
     *  `CLAUDE.md` names slot 15 as *"the most inviting place in the contract to
     *  'just add a bool'"* and forbids filling it: packing into a partially-used
     *  slot is invisible on a fresh deploy and only surfaces once a beacon upgrade
     *  puts a live organism's counter on top of another field's bytes. A `uint256`
     *  cannot fit in thirty-one bytes, so declaring one is what forces the
     *  boundary; there is no padding primitive that does it more directly. Two
     *  slots, one of them permanently unread, is the cheap side of that trade.
     *
     *  Mirrors `Population.__slotAlign`, for the same reason and at the same cost.
     */
    uint256 private __slotAlign;

    // slot 17 — reached because the padding above forced a boundary, NOT because
    // declaration order alone would have put it here. Verified with
    // `forge inspect Prophet storage-layout`, not by reading this comment.
    /**
     *  Who owns this organism: whoever paid to enter it, or the parent's entrant
     *  for a child.
     *
     *  This is the field that turns the population into an arena. It is deliberately
     *  NOT an owner in the access-control sense — an entrant cannot make their
     *  organism think, trade, or refuse to pay metabolism. The only right it confers
     *  is `Population.retire`: taking back what the organism still holds. Selection
     *  pressure has to stay indifferent to who is paying.
     */
    address public entrant;

    uint256[18] private __gap;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event Born(uint256 indexed prophetId, uint256 indexed parentId, uint32 generation, bytes32 genomeHash);
    event Thinking(uint256 indexed prophetId, uint256 indexed requestId, bytes32 indexed marketId);
    /// @dev `validators` is the attestation set — who ran the model and agreed.
    ///      `thesis` is the organism's stated reason, which makes selection over
    ///      *strategies* readable straight from the log stream.
    event Believed(
        uint256 indexed prophetId,
        bytes32 indexed marketId,
        Belief belief,
        Thesis thesis,
        string reasoning,
        address[] validators
    );
    event Committed(
        uint256 indexed prophetId, bytes32 indexed marketId, uint256 outcomeId, uint256 stake, uint256 quantity
    );
    event Settled(
        uint256 indexed prophetId, bytes32 indexed marketId, bool correct, uint256 collateralOut, uint256 treasury
    );
    event Starved(uint256 indexed prophetId, uint256 metabolicCost, uint256 treasury);
    /// @dev Emitted only when a skim actually moves. `profit` is carried alongside
    ///      `amount` so the log stream proves the rake was taken on the profit and
    ///      not on the gross redemption, without anyone having to re-derive it.
    event Raked(uint256 indexed prophetId, uint256 profit, uint256 amount);
    event Died(uint256 indexed prophetId, uint64 window, uint32 windowsLived, uint32 correct, uint32 wrong);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotPopulation();
    error NotAgentRequester();
    error AlreadyInitialized();
    error IsDead();
    error NoSuchRequest();
    /// @dev A second mutation request while one is still in flight. See
    ///      `noteMutating` — overwriting the id would orphan an inference this
    ///      organism has already paid for.
    error MutationInFlight();
    error NothingCommitted();
    error TransferFailed();

    /*//////////////////////////////////////////////////////////////
                               MODIFIERS
    //////////////////////////////////////////////////////////////*/

    modifier onlyPopulation() {
        if (msg.sender != population) revert NotPopulation();
        _;
    }

    /// @dev Death is absolute. There is deliberately no path — not owner, not
    ///      beacon upgrade, not Population — that clears `dead`. A judge should
    ///      be able to grep for one and fail to find it.
    modifier alive() {
        if (dead) revert IsDead();
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              INITIALIZER
    //////////////////////////////////////////////////////////////*/

    function initialize(
        address population_,
        uint256 prophetId_,
        uint256 parentId_,
        uint32 generation_,
        uint64 birthWindow_,
        address entrant_,
        string calldata systemPrompt_
    ) external {
        if (population != address(0)) revert AlreadyInitialized();
        population = population_;
        prophetId = prophetId_;
        parentId = parentId_;
        generation = generation_;
        birthWindow = birthWindow_;
        entrant = entrant_;
        systemPrompt = systemPrompt_;
        genomeHash = keccak256(bytes(systemPrompt_));
        emit Born(prophetId_, parentId_, generation_, genomeHash);
    }

    /*//////////////////////////////////////////////////////////////
                                COGNITION
    //////////////////////////////////////////////////////////////*/

    /**
     *  Population pays the AgentRequester deposit from one funded account and
     *  names this organism as the callback target, so a ten-day unattended run
     *  has exactly one native balance to watch. This records the in-flight id so
     *  a callback for a request we never made is rejected.
     */
    function noteThinking(uint256 requestId, bytes32 marketId) external onlyPopulation alive {
        pendingBeliefRequestId = requestId;
        if (!positionOpen) {
            currentMarketId = marketId;
        }
        belief = Belief.None;
        // Clear the PREVIOUS window's rationale in the same breath as its belief.
        //
        // `handleBelief` already writes `Unknown` / `""` when consensus fails, so the
        // gap this closes is not the abstain path — it is the NO-CALLBACK-AT-ALL path.
        // A request the validators never deliver leaves `pendingBeliefRequestId` set
        // and nothing else written, so without these two lines an organism carries the
        // last window it actually thought in: `belief` reads `None` (correctly), while
        // `lastThesis` and `lastReasoning` still name a thesis and quote a rationale.
        // Every reader of this contract pairs those three — `snapshot`, the dashboard's
        // organism card, and anyone auditing "readable on-chain reasoning" — so the
        // stale pair is read as THIS window's reasoning for a window in which the
        // organism said nothing. That is the one failure mode this project cannot
        // present, because the whole claim is that the reasoning on chain is the
        // reasoning that was acted on.
        //
        // Clearing on the way IN rather than on the way out is deliberate: there is no
        // "way out" on the path that matters, since the callback is what never arrives.
        // Cost is two SSTOREs per organism per window, both to slots already being
        // written or already warm (`lastThesis` shares slot 0 with `belief`, so it is
        // free), and `lastReasoning` is a short-string slot going to zero, which is the
        // cheap direction. `Believed` is not emitted here — nothing was believed — and
        // the `Thinking` log below is already the marker a reader pairs against.
        lastThesis = Thesis.Unknown;
        lastReasoning = "";
        emit Thinking(prophetId, requestId, marketId);
    }

    /**
     *  The AgentRequester callback carrying the subcommittee's verdict.
     *
     *  Every non-Success status collapses to Abstain rather than reverting. That
     *  is a deliberate product decision, not laziness: an organism that cannot
     *  get validators to agree on a coherent answer has failed to think, so it
     *  acts on nothing and still pays its metabolic cost. An infrastructure
     *  failure mode is absorbed as a biological one, which means the population
     *  cannot be stalled by a flaky agent.
     */
    function handleBelief(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    )
        external
    {
        if (msg.sender != _agentRequester()) revert NotAgentRequester();
        if (requestId == 0 || requestId != pendingBeliefRequestId) revert NoSuchRequest();
        pendingBeliefRequestId = 0;

        if (dead) return; // died between commit and callback; drop it quietly

        Belief b = Belief.Abstain;
        Thesis t = Thesis.Unknown;
        string memory reasoning = "";
        address[] memory validators = new address[](responses.length);

        if (status == ResponseStatus.Success && responses.length > 0) {
            (bytes memory modal, uint256 agree) = _modalResult(responses);
            // A single agreeing validator is not consensus, whatever the
            // platform's own tally says. Require at least two.
            if (agree >= 2 && modal.length > 0) {
                string memory answer = abi.decode(modal, (string));
                (b, t) = Genome.parseAnswer(answer);
                reasoning = answer;
            }
            for (uint256 i; i < responses.length; ++i) {
                validators[i] = responses[i].validator;
            }
        }

        belief = b;
        lastThesis = t;
        lastReasoning = reasoning;
        emit Believed(prophetId, currentMarketId, b, t, reasoning, validators);
    }

    /// @dev A mutated genome arriving for a child that has not been born yet.
    ///      Population reads `pendingChildPrompt` when it spawns.
    function handleMutation(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    )
        external
    {
        if (msg.sender != _agentRequester()) revert NotAgentRequester();
        if (requestId == 0 || requestId != pendingMutationRequestId) revert NoSuchRequest();
        pendingMutationRequestId = 0;

        // Mirror of `handleBelief`'s guard. A parent that starved between
        // `_requestMutation` and this callback is a corpse, and `hatchAll` does not
        // iterate corpses — so writing the genome here would strand a real
        // three-validator inference in unreachable storage AND leave
        // `pendingChildPrompt` non-empty forever on an organism nothing can hatch.
        // Dropped quietly for the same reason as the belief: a callback that reverts
        // is an inference the platform records as failed delivery.
        if (dead) return;

        if (status != ResponseStatus.Success || responses.length == 0) return;
        (bytes memory modal, uint256 agree) = _modalResult(responses);
        if (agree < 2 || modal.length == 0) return;
        pendingChildPrompt = abi.decode(modal, (string));
    }

    /**
     *  Record the in-flight mutation, and refuse to forget one.
     *
     *  THE GUARD IS ABOUT `breedProphet`, WHICH IS PERMISSIONLESS. Overwriting a
     *  live `pendingMutationRequestId` orphans the first request: `handleMutation`
     *  rejects any id that is not the stored one, so the earlier inference — three
     *  validators, already paid for out of this organism's own native balance —
     *  comes back and reverts with `NoSuchRequest`, and the genome it produced is
     *  gone. Two callers racing the same qualifying leader could do that as often as
     *  the leader could afford it.
     *
     *  REVERTS RATHER THAN RETURNING, unlike the `dead` guard in `handleMutation`.
     *  The direction of the call is what makes the difference: a callback that
     *  reverts is recorded by the platform as a failed delivery, but this is a
     *  forward call from `Population._requestMutation`, and it must fail loudly so
     *  the `try` around `createAdvancedRequest` is not the only thing standing
     *  between a duplicate breed and a silently discarded deposit.
     *
     *  THIS IS NOT THE GUARD THAT PROTECTS `settleAll` — IT IS THE ONE THAT USED TO
     *  BREAK IT. An earlier version of this comment claimed the population's
     *  per-organism `try`/`catch` swallowed this revert as a `SettleFailed`, leaving
     *  only a wasted deposit. That was FALSE, and the correction is audit item #56.
     *
     *  `Population.settleAll` calls `_requestMutation` from INSIDE the success body of
     *  its `try p.settleWindow(...)`, and Solidity does not route a revert raised in a
     *  `try`'s success block into that same `try`'s `catch` — only a revert from the
     *  external call in the `try` header is caught. So this revert propagated out of
     *  the whole loop: `settleAll` reverted, no organism was graded, and `phase` stayed
     *  at 2 until the owner called `forcePhase`. Since `breedProphet` is permissionless
     *  and moves neither `streak` nor `treasury`, any address could arm that wedge on
     *  any eligible leader — and the population could also arm it on itself, because a
     *  parent whose first inference is still out qualifies again at the next settlement.
     *
     *  WHICH IS WHY THE CALLER MUST PRE-CHECK, and both callers now do.
     *  `_requestMutation` reads `pendingMutationRequestId` before it draws anything and
     *  early-returns with `MutationAlreadyInFlight`, so `settleAll` never reaches this
     *  revert and never pays a deposit for a request it will not make.
     *  `Population.breedProphet` checks the same condition first and reverts loudly,
     *  because a direct caller asked for one specific thing. This guard stays as the
     *  backstop that makes the orphaning impossible rather than merely unlikely: it is
     *  the only check that lives in the contract holding the id.
     */
    function noteMutating(uint256 requestId) external onlyPopulation alive {
        if (pendingMutationRequestId != 0) revert MutationInFlight();
        pendingMutationRequestId = requestId;
    }

    function consumeChildPrompt() external onlyPopulation returns (string memory prompt) {
        prompt = pendingChildPrompt;
        delete pendingChildPrompt;
    }

    /*//////////////////////////////////////////////////////////////
                              COMMITMENT
    //////////////////////////////////////////////////////////////*/

    /**
     *  Hand `amount` collateral to Population so it can mint a complete pair and
     *  send the two legs to two organisms holding opposing beliefs.
     *
     *  Population is a router, not a bank: it must spend this within the same
     *  transaction. The pool's `mintSet(yesTo, noTo, amount)` takes independent
     *  recipients, which is what lets the population be its own counterparty —
     *  no order book, no external trader, exact 1:1 backing. On a quiet testnet
     *  that is the difference between a live population and a stalled one.
     */
    function stakeOut(address to, uint256 amount, address collateral)
        external
        onlyPopulation
        alive
        returns (uint256 sent)
    {
        sent = amount > treasury ? treasury : amount;
        treasury -= sent;
        if (!IERC20Like(collateral).transfer(to, sent)) revert TransferFailed();
    }

    /**
     *  Record the position Population just opened on this organism's behalf.
     *
     *  `quantity == 0` is a legitimate, meaningful state: the organism formed a
     *  belief but no opposing counterparty existed, so it holds no position. It is
     *  still marked open, because it must still be charged for having thought.
     */
    function noteCommitted(uint256 outcomeId, uint256 stake, uint256 quantity) external onlyPopulation alive {
        currentOutcomeId = outcomeId;
        currentStake = stake;
        currentQuantity = quantity;
        positionOpen = true;
        emit Committed(prophetId, currentMarketId, outcomeId, stake, quantity);
    }

    /*//////////////////////////////////////////////////////////////
                         SELECTION — same block as settlement
    //////////////////////////////////////////////////////////////*/

    /**
     *  Redeem the window's position and apply the consequence.
     *
     *  Called from SelectionEngine inside the reactive callback the validators
     *  insert in the SAME BLOCK the market settled — so redemption, the
     *  organism's winnings, its fitness, and its death all land before the block
     *  closes. Nothing keeper-shaped sits between resolution and consequence.
     *  `IArenaVenue.redeemFor` inherits that requirement as its hardest
     *  constraint; a venue that needs a second transaction breaks the claim
     *  rather than merely slowing it.
     *
     *  A losing position redeems successfully and pays nothing, so there is no
     *  branch on winning here — `collateralOut` tells the truth either way. A
     *  voided market pays both sides 0.5, which lands as roughly the stake back
     *  and is correctly scored as neither a win nor a loss.
     *
     *  Takes the VENUE rather than a settlement/pool pair. Population chooses the
     *  callee; the organism does not know or care whether adjudication is a
     *  complete-set redemption or a price comparison.
     *
     *  Returns the two amounts it moved back to Population — `charged` (rent) and
     *  `raked` (the house's cut of the profit) — because Population books them as
     *  revenue and cannot recover them from a balance delta: the same call receives
     *  redemptions for other organisms in the same loop.
     */
    function settleWindow(address venue, address collateral, uint256 metabolicCost, uint16 rakeBps_)
        external
        onlyPopulation
        returns (uint256 collateralOut, bool starved, uint256 charged, uint256 raked)
    {
        if (!positionOpen) revert NothingCommitted();
        positionOpen = false;

        uint256 quantity = currentQuantity;
        uint256 staked = currentStake;
        uint256 received;

        if (quantity > 0) {
            uint256 balBefore = IERC20Like(collateral).balanceOf(address(this));

            // PUSH the position to the venue before asking it to redeem. Forced by
            // the redemption primitive rather than chosen: finalizeAndRedeem burns
            // from msg.sender — DreamDEX's Redeemed event distinguishes `holder`
            // from `to` for exactly that reason — and the ERC-6909 surface here
            // exposes `transfer` and `setOperator` but no `transferFrom`, so no
            // grant of any kind lets a venue pull these tokens. Custody is
            // transient: a revert below unwinds this transfer with it.
            //
            // A venue with no transferable position token reports address(0), and
            // its ids are pure bookkeeping.
            //
            // The return value is CHECKED. ERC-6909's `transfer` returns a bool like
            // ERC-20's, and a token that answers `false` instead of reverting would
            // leave the position in this organism's hands while `redeemFor` runs
            // against a venue that holds nothing. On DreamDEX that happens to fail
            // loudly one line later — `finalizeAndRedeem` burns from `msg.sender` —
            // but `IArenaVenue` is a seam, and a future venue crediting a redemption
            // it never received would pay this organism out of somebody else's
            // backing. Every other value movement in this file is checked; this was
            // the one that was not, until 2026-09-05.
            {
                address ptoken = IArenaVenue(venue).positionToken();
                if (ptoken != address(0)) {
                    if (!IOutcomeToken6909(ptoken).transfer(venue, currentOutcomeId, quantity)) {
                        revert TransferFailed();
                    }
                }
            }

            // Redeeming a losing outcome id is legal and returns zero; only a
            // genuinely reverting settlement should abort the whole population,
            // so this is deliberately NOT wrapped in a try/catch that would
            // silence a real integration break.
            collateralOut = IArenaVenue(venue).redeemFor(address(this), currentOutcomeId, quantity);

            // THE RETURN VALUE AND THE BALANCE ANSWER DIFFERENT QUESTIONS, and
            // conflating them is a genuine bug rather than a stylistic choice.
            // `collateralOut` states what the position was WORTH — that is the
            // fitness signal. The balance delta states what this organism now
            // CUSTODIES, and settlement is documented to be able to credit an
            // `owed` balance instead of transferring. Ledgering the return value
            // would let `treasury` claim collateral the organism does not hold,
            // and over a ten-day unattended run that gap is unrecoverable.
            received = IERC20Like(collateral).balanceOf(address(this)) - balBefore;

            if (collateralOut > received) {
                // Credited, not paid. Claim it in the same call: a WINNER must
                // never starve because its winnings are sitting in an escrow
                // ledger. If the claim is unavailable this window, the payout is
                // not lost — `claimOwed()` is permissionless and can rescue it
                // later — but the organism is exposed to metabolism until then.
                //
                // The settlement address comes from Population rather than from
                // the removed `settlement` parameter, so this path and the
                // permissionless `claimOwed()` below read the SAME source. A
                // venue with no owed ledger never reaches here: it cannot report
                // more worth than it paid.
                received += _sweepOwed(IPopulationConfig(population).settlement(), collateral);
            }
        }

        // Graded in COLLATERAL against what was RISKED, not in tokens against
        // what was held, and on worth rather than on custody.
        bool won = collateralOut > staked;
        bool lost = collateralOut < staked;

        treasury += received;
        windowsLived += 1;

        // THE HOUSE'S CUT, TAKEN ON PROFIT AND ONLY ON PROFIT.
        //
        // `collateralOut - staked` is what this window actually made. Skimming the
        // gross would take twice as much and would tax the organism's own returned
        // stake — a 2.5% rake that is really 5%, levied on capital rather than on
        // winnings, and levied identically on a break-even redemption.
        //
        // Taken BEFORE metabolism deliberately: the skim belongs to the window whose
        // profit produced it, and an organism whose rent then finishes it off has its
        // residue forfeited to the prize pool anyway, so this ordering cannot lose
        // the house money — it only decides which book it lands in.
        //
        // Clamped to `treasury` for the same reason `charge` below is: the settlement
        // may have CREDITED the winnings rather than transferred them (see
        // `_sweepOwed`), so `collateralOut` can exceed what this organism custodies.
        // A rake that could exceed the balance would revert the whole settlement.
        if (rakeBps_ > 0 && collateralOut > staked) {
            raked = ((collateralOut - staked) * rakeBps_) / 10_000;
            if (raked > treasury) raked = treasury;
            if (raked > 0) {
                treasury -= raked;
                if (!IERC20Like(collateral).transfer(population, raked)) revert TransferFailed();
                emit Raked(prophetId, collateralOut - staked, raked);
            }
        }

        if (quantity == 0) {
            // No position was taken, so no forecast was graded — whether the organism
            // failed to think, abstained, or merely failed to find a counterparty. All
            // three arrive here identically: `_openEmpty` records a zero quantity
            // (`Population.sol:1423`) and `_pair` clamps to `minStake` before it can
            // issue anything at all (`Population.sol:1354`), and `noteCommitted` is the
            // only writer. So a nonzero quantity means this organism was paired into a
            // real directional position, and nothing else produces one.
            //
            // THE BELIEF IS DELIBERATELY NOT CONSULTED HERE, and re-adding it is a
            // regression rather than a safety net. `belief` is a LIVE field, cleared at
            // the bottom of this function and rewritten by every `think`. An organism
            // whose settlement reverted keeps its position open and is skipped by the
            // next `commitAll` (`Population.sol:1603`) — but it is NOT skipped by
            // `think`, so by the time the retry redeems the ORIGINAL position the live
            // belief belongs to a different window. Grading on it would book an abstain
            // over a position that won or lost real money, and the same is true of a
            // voided position redeemed a window late. `quantity` and `staked` are the
            // two fields that actually travelled with the position, which is exactly
            // why the money above is graded from them and not from the forecast.
            abstainCount += 1;
            streak = 0;
        } else if (won) {
            correctCount += 1;
            streak += 1;
        } else if (lost) {
            wrongCount += 1;
            streak = 0;
        }

        // METABOLISM — charged unconditionally: winners, losers, and organisms
        // that failed to form a belief at all. This is the selection pressure,
        // and it is why a coin-flipper cannot survive in a zero-fee market.
        //
        // The debit moves REAL collateral back to Population rather than just
        // decrementing a ledger. Population spends native SOMI on validator
        // inference and is reimbursed here in collateral, so the accounting is a
        // closed loop and `treasury` never drifts from the actual token balance
        // over a ten-day unattended run. It also means a dead organism leaves
        // nothing stranded that the books claim it still has.
        uint256 charge = treasury >= metabolicCost ? metabolicCost : treasury;
        starved = charge < metabolicCost;
        treasury -= charge;
        charged = charge;
        if (charge > 0 && !IERC20Like(collateral).transfer(population, charge)) revert TransferFailed();

        emit Settled(prophetId, currentMarketId, won, collateralOut, treasury);
        if (starved) emit Starved(prophetId, metabolicCost, treasury);

        currentStake = 0;
        currentQuantity = 0;
        currentOutcomeId = 0;
        belief = Belief.None;
    }

    /// @dev Irreversible. No counterpart exists anywhere in this codebase.
    function die(uint64 window) external onlyPopulation {
        if (dead) return;
        dead = true;
        deathWindow = window;
        belief = Belief.None;
        emit Died(prophetId, window, windowsLived, correctCount, wrongCount);
    }

    /*//////////////////////////////////////////////////////////////
                              HOUSEKEEPING
    //////////////////////////////////////////////////////////////*/

    /// @dev A payout can be credited as an `owed` balance instead of transferred.
    ///      Without this an organism can silently strand its winnings, and the
    ///      ledger would understate what it actually holds. Left permissionless
    ///      on purpose: it can only ever move value INTO this organism, so
    ///      anyone — a spectator, a monitor script — should be able to rescue a
    ///      stranded payout without waiting on Population.
    ///
    ///      Both addresses are read from Population rather than passed in.
    ///      Permissionless + caller-supplied addresses would let anyone hand us a
    ///      fake settlement that reports an enormous `claimOwed` and inflate
    ///      `treasury` with collateral that does not exist.
    function claimOwed() external returns (uint256 claimed) {
        IPopulationConfig cfg = IPopulationConfig(population);
        claimed = _sweepOwed(cfg.settlement(), cfg.collateral());
        treasury += claimed;
    }

    /**
     *  THERE IS DELIBERATELY NO `grantPopulation` HERE, and the gap is the point.
     *
     *  Until 2026-09-05 every organism handed `Population` an infinite collateral
     *  allowance plus ERC-6909 operator rights over its positions, at birth,
     *  forever. Nothing ever used either one. `Population` reaches `transferFrom`
     *  at exactly two sites and both pull from `msg.sender`; it never touches the
     *  ERC-6909 surface at all, because that surface has no `transferFrom` to pull
     *  with — settlement is a PUSH from this contract (`:394`), and the ante is a
     *  push too (`stakeOut`, called by `Population.executePair`).
     *
     *  Removing it is not tidying. A standing allowance is not a promise about
     *  today's bytecode when the grantee is UUPS-upgradeable: it made every
     *  organism's whole treasury reachable by whatever `Population` becomes, which
     *  is precisely the liability `Population.executePair` refuses to create for
     *  the venue when it approves per call. It also failed quietly rather than
     *  loudly — a `transferFrom` against an organism moves collateral without
     *  decrementing `treasury`, breaking the `treasury == balanceOf` invariant
     *  instead of reverting.
     *
     *  `test_prophet_populationHoldsNoStandingAuthorityOverAnOrganism` asserts the
     *  absence, so re-adding a grant fails a test rather than passing review.
     */
    function fund(uint256 amount) external onlyPopulation {
        treasury += amount;
    }

    /**
     *  Hand Population the native value for one inference this organism is about
     *  to be charged for.
     *
     *  Reports failure by returning less than `amount` instead of reverting: the
     *  caller compares the two and skips the organism, so an empty pocket becomes
     *  an abstention rather than a revert that would take the whole window down
     *  with it.
     *
     *  ALL OR NOTHING, and that is the correctness-relevant part. An earlier shape
     *  sent `min(amount, balance)` and let the caller reject the short draw — which
     *  moved the organism's entire remaining balance into Population and bought it
     *  no inference, so one entrant's residual STT quietly funded other entrants'
     *  thinking with no event to reconcile against. Sending nothing when the
     *  balance is short leaves the residue where it belongs, and makes a top-up
     *  cumulative instead of a payment into a leak.
     *
     *  Note there is no `alive` modifier. A dead organism is never in `living`, so
     *  `think` cannot reach it, and any native it still holds should stay drainable
     *  by the same path that funded it rather than being stranded behind a
     *  liveness check.
     */
    function drawCognition(uint256 amount) external onlyPopulation returns (uint256 sent) {
        if (amount > address(this).balance) return 0;
        sent = amount;
        if (sent > 0) {
            (bool ok,) = population.call{value: sent}("");
            if (!ok) revert TransferFailed();
        }
    }

    /*//////////////////////////////////////////////////////////////
                                INTERNAL
    //////////////////////////////////////////////////////////////*/

    /// @dev Read through Population so a redeploy of the requester needs one
    ///      write, not N beacon upgrades.
    function _agentRequester() internal view returns (address) {
        return IPopulationConfig(population).agentRequester();
    }

    /**
     *  Pull whatever settlement is holding for this organism, and report the
     *  amount that ACTUALLY ARRIVED rather than the amount it claimed to send.
     *
     *  Never touches `treasury` — both callers add the delta themselves, exactly
     *  once. Returning the balance delta rather than the return value is what
     *  keeps `treasury == balanceOf(this)` true no matter how settlement chooses
     *  to pay, and a settlement that cannot service a claim right now must not be
     *  able to abort a window, so the call is caught.
     */
    function _sweepOwed(address settlement, address collateral) internal returns (uint256 received) {
        uint256 before = IERC20Like(collateral).balanceOf(address(this));
        try IBinarySettlement(settlement).claimOwed(collateral) {
        // Return value deliberately ignored — the balance is the truth.
        }
        catch {
            return 0;
        }
        received = IERC20Like(collateral).balanceOf(address(this)) - before;
    }

    /**
     *  The most-agreed result among Success responses, and how many agreed.
     *
     *  The platform already computed consensus before calling us, so the first
     *  Success entry would usually do. This counts anyway: it is O(n^2) over a
     *  subcommittee of three, it costs almost nothing, and it means a mixed
     *  response array can never be read as agreement.
     */
    function _modalResult(Response[] memory responses) internal pure returns (bytes memory modal, uint256 best) {
        for (uint256 i; i < responses.length; ++i) {
            if (responses[i].status != ResponseStatus.Success) continue;
            uint256 count;
            for (uint256 j; j < responses.length; ++j) {
                if (responses[j].status != ResponseStatus.Success) continue;
                if (keccak256(responses[i].result) == keccak256(responses[j].result)) count++;
            }
            if (count > best) {
                best = count;
                modal = responses[i].result;
            }
        }
    }

    /// @dev AgentRequester rebates unused escrow. Without a receiver the refund
    ///      reverts, which would fail the request that carried it.
    receive() external payable {}
}

/**
 *  The slice of Population an organism needs to read.
 *
 *  Addresses live in Population, not in each Prophet, so a redeployed system
 *  contract is one write instead of N beacon upgrades — and so a permissionless
 *  entrypoint can never be handed a spoofed one.
 */
interface IPopulationConfig {
    function agentRequester() external view returns (address);
    function settlement() external view returns (address);
    function collateral() external view returns (address);
}
