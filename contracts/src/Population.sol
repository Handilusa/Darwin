// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

import {IAgentRequester, ILLMAgent, ConsensusType} from "./interfaces/ISomnia.sol";
import {IBinaryPool, IERC20Like} from "./interfaces/IDreamDEX.sol";
import {IPriceSource} from "./interfaces/IPriceSource.sol";
import {Prophet} from "./Prophet.sol";
import {Genome, Belief} from "./Genome.sol";

/**
 *  The population: registry, paymaster, matchmaker.
 *
 *  UUPS-upgradeable, and that is not a nicety. Each Prophet binds to its Population
 *  address at birth, so a redeployed Population could not command the existing
 *  organisms — fixing a bug here without upgradeability would mean destroying the
 *  ancestry graph, which is the one asset in this project that cannot be rebuilt in
 *  a hurry. The population starts running on day 2 and must not stop.
 *
 *  It holds nothing between transactions. Collateral belongs to organisms; this
 *  contract only routes it. What it does hold is the native balance that pays for
 *  cognition, which is why every economic parameter is settable: the whole run can
 *  be recalibrated from one transaction without touching organism storage.
 *
 *  A WINDOW, in four driver calls:
 *
 *    think()    fires one constrained LLM inference per living organism
 *    commitAll() pairs opposing beliefs into fully-backed positions
 *    settleAll() redeems, grades, charges metabolism, kills, flags breeding
 *    hatchAll()  births the children whose mutated genomes have landed
 *
 *  Each is callable by the owner, by SelectionEngine, or by the reactivity
 *  precompile, so cadence can migrate from a script to on-chain ticks without a
 *  code change.
 */
contract Population is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    /*//////////////////////////////////////////////////////////////
                          STORAGE — FROZEN LAYOUT
        Append into __gap only. Never reorder, retype, or remove.
        OZ v5 keeps its own state in ERC-7201 namespaces, so slot 0
        below is genuinely slot 0 and nothing collides.
    //////////////////////////////////////////////////////////////*/

    // --- wiring ---
    address public agentRequester;
    address public settlement;
    address public marketsModule;
    address public outcomeToken;
    address public collateral;
    address public prophetBeacon;
    address public priceSource;
    address public selectionEngine;
    uint256 public llmAgentId;
    string public symbol; // "BTC"

    // --- economics: tunable mid-run, deliberately NOT in Prophet ---
    uint256 public endowment; // collateral handed to a newborn
    uint256 public metabolicCost; // charged every window, win or lose
    uint256 public minStake; // below this, pairing is not worth the gas
    uint16 public stakeBps; // share of treasury risked per window
    uint16 public breedSurplusBps; // surplus over endowment required to breed
    uint32 public breedStreak; // consecutive correct calls required to breed
    uint16 public maxPopulation; // gas bound, not a design limit

    // --- inference request parameters ---
    uint256 public perAgentReward; // ON TOP of getRequestDeposit(); see _deposit()
    uint256 public subcommitteeSize;
    uint256 public threshold;
    uint256 public requestTimeout;
    bool public chainOfThought;

    // --- registry ---
    address[] public prophets;
    uint256 public aliveCount;
    uint64 public windowCount;

    // --- the live window ---
    bytes32 public activeMarketId;
    address public activePool; // resolved every window; never persisted as truth
    uint256 public activeUpId;
    uint256 public activeDownId;
    uint8 public phase; // 0 idle, 1 thinking, 2 committed

    uint256[20] private __gap;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event WindowOpened(uint64 indexed window, bytes32 indexed marketId, address pool, uint256 openPrice);
    event Spawned(uint256 indexed prophetId, address prophet, uint256 indexed parentId, uint32 generation);
    event Paired(uint256 indexed upId, uint256 indexed downId, uint256 amount);
    event Unpaired(uint256 indexed prophetId, Belief belief);
    event Reaped(uint256 indexed prophetId, uint64 window, uint256 aliveRemaining);
    event BreedingRequested(uint256 indexed parentId, uint256 requestId);
    event WindowClosed(uint64 indexed window, uint256 aliveCount);
    /// @dev An unattended run must never be stalled by one bad organism. Each of
    ///      these is a caught revert, kept as a log so the monitor can see it.
    event ThinkFailed(uint256 indexed prophetId);
    event CommitFailed(uint256 indexed prophetId);
    event SettleFailed(uint256 indexed prophetId);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error NotDriver();
    error WrongPhase(uint8 expected, uint8 actual);
    error MarketNotTradeable();
    error PopulationFull();
    error NoSuchProphet();
    error ProphetIsDead();
    error NotEligibleToBreed();
    error TransferFailed();
    error NothingToHatch();

    /// @dev The reactivity precompile. Has no bytecode and does not exist on local
    ///      chains, so this is only ever a `msg.sender` comparison here.
    address internal constant REACTIVITY = 0x0000000000000000000000000000000000000100;

    modifier onlyDriver() {
        if (msg.sender != owner() && msg.sender != selectionEngine && msg.sender != REACTIVITY) {
            revert NotDriver();
        }
        _;
    }

    modifier inPhase(uint8 expected) {
        if (phase != expected) revert WrongPhase(expected, phase);
        _;
    }

    /*//////////////////////////////////////////////////////////////
                              INITIALIZER
    //////////////////////////////////////////////////////////////*/

    struct Wiring {
        address agentRequester;
        address settlement;
        address marketsModule;
        address outcomeToken;
        address collateral;
        address prophetBeacon;
        address priceSource;
        uint256 llmAgentId;
        string symbol;
    }

    /// @dev Locks the IMPLEMENTATION against direct initialization. Without this,
    ///      anyone may call `initialize` on the implementation address (the proxy's
    ///      storage is separate, so this is not otherwise noticeable), become its
    ///      `owner()`, satisfy `_authorizeUpgrade`, and `upgradeToAndCall` into a
    ///      contract that `selfdestruct`s. Pre-Cancun that DESTROYS the implementation,
    ///      and since the proxy's upgrade logic lives in the implementation it is
    ///      bricked with no recovery path — the ancestry graph would be unrecoverable.
    ///      We compile for `paris` precisely because Shannon's fork is unconfirmed, so
    ///      we cannot assume EIP-6780 defuses this. Constructors allocate no storage,
    ///      so this is layout-neutral and safe to add before the freeze.
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, Wiring calldata w) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();

        agentRequester = w.agentRequester;
        settlement = w.settlement;
        marketsModule = w.marketsModule;
        outcomeToken = w.outcomeToken;
        collateral = w.collateral;
        prophetBeacon = w.prophetBeacon;
        priceSource = w.priceSource;
        llmAgentId = w.llmAgentId;
        symbol = w.symbol;

        // Defaults calibrated so DEATH IS VISIBLE INSIDE A DAY. A demo needs a
        // real death on camera, and a population that starves gently over three
        // weeks is indistinguishable from one that does nothing. At 10 tUSDC of
        // endowment and 10% risked per 15-minute window, a bad run of a dozen
        // calls is fatal — variance kills faster and far more legibly than
        // metabolism alone, while metabolism guarantees a coin-flipper still dies.
        //
        // 6 decimals on Shannon tUSDC. Recompute against decimals() for mainnet.
        endowment = 10_000_000; // 10 tUSDC
        metabolicCost = 50_000; // 0.05 tUSDC per window
        minStake = 250_000; // 0.25 tUSDC
        stakeBps = 1000; // 10% of treasury
        breedStreak = 4;
        breedSurplusBps = 5000; // needs 1.5x endowment to afford a child
        maxPopulation = 24;

        subcommitteeSize = 3;
        threshold = 2;
        requestTimeout = 300;
        chainOfThought = true;
        perAgentReward = 0.01 ether;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*//////////////////////////////////////////////////////////////
                                 CONFIG
    //////////////////////////////////////////////////////////////*/

    function setWiring(address priceSource_, address selectionEngine_, address prophetBeacon_) external onlyOwner {
        if (priceSource_ != address(0)) priceSource = priceSource_;
        if (selectionEngine_ != address(0)) selectionEngine = selectionEngine_;
        if (prophetBeacon_ != address(0)) prophetBeacon = prophetBeacon_;
    }

    function setEconomics(
        uint256 endowment_,
        uint256 metabolicCost_,
        uint256 minStake_,
        uint16 stakeBps_,
        uint32 breedStreak_,
        uint16 breedSurplusBps_,
        uint16 maxPopulation_
    ) external onlyOwner {
        endowment = endowment_;
        metabolicCost = metabolicCost_;
        minStake = minStake_;
        stakeBps = stakeBps_;
        breedStreak = breedStreak_;
        breedSurplusBps = breedSurplusBps_;
        maxPopulation = maxPopulation_;
    }

    function setInference(
        uint256 llmAgentId_,
        uint256 perAgentReward_,
        uint256 subcommitteeSize_,
        uint256 threshold_,
        uint256 requestTimeout_,
        bool chainOfThought_
    ) external onlyOwner {
        llmAgentId = llmAgentId_;
        perAgentReward = perAgentReward_;
        subcommitteeSize = subcommitteeSize_;
        threshold = threshold_;
        requestTimeout = requestTimeout_;
        chainOfThought = chainOfThought_;
    }

    /// @dev Escape hatch for a wedged window. Does NOT revive anything and cannot
    ///      touch an organism's treasury or `dead` flag — it only unsticks the
    ///      phase machine so the next window can run.
    function forcePhase(uint8 p) external onlyOwner {
        phase = p;
    }

    /*//////////////////////////////////////////////////////////////
                                 GENESIS
    //////////////////////////////////////////////////////////////*/

    /// @dev Generation 0. Each genome is a distinct English strategy; the founders
    ///      must actually disagree with each other or there is nothing for
    ///      selection to act on and no counterparty for pairing.
    function spawnGenesis(string[] calldata genomes) external onlyOwner {
        for (uint256 i; i < genomes.length; ++i) {
            _spawn(0, 0, genomes[i]);
        }
    }

    function _spawn(uint256 parentId, uint32 generation, string memory genome) internal returns (address p) {
        if (prophets.length >= maxPopulation) revert PopulationFull();

        // `id` IS NOT A LOCAL ON PURPOSE. The Yul optimizer inlines this function
        // into `spawnGenesis`'s loop, and the inlined body sits exactly one stack
        // slot over the limit; holding the id in a local is what pushes it over.
        // Ids are 1-based (0 means "no parent"), so it is `prophets.length + 1`
        // before the push and `prophets.length` after — the same number, read twice
        // for a warm SLOAD each. Do not reintroduce the local.
        p = address(new BeaconProxy(prophetBeacon, ""));
        Prophet(payable(p)).initialize(address(this), prophets.length + 1, parentId, generation, windowCount, genome);
        prophets.push(p);
        aliveCount += 1;

        // Operator rights on the ERC-6909 singleton and a collateral allowance, so
        // this contract can route on the organism's behalf later without a second
        // transaction per birth.
        Prophet(payable(p)).grantPopulation(outcomeToken, collateral);

        if (endowment > 0) {
            if (!IERC20Like(collateral).transfer(p, endowment)) revert TransferFailed();
            Prophet(payable(p)).fund(endowment);
        }

        emit Spawned(prophets.length, p, parentId, generation);
    }

    /*//////////////////////////////////////////////////////////////
                             1. COGNITION
    //////////////////////////////////////////////////////////////*/

    /**
     *  Open a window and pay for every living organism to think about it.
     *
     *  One `createAdvancedRequest` per organism, each naming the ORGANISM as the
     *  callback target while this contract funds the deposit. That asymmetry —
     *  `callbackAddress` need not be the payer — is what keeps a ten-day unattended
     *  run down to a single native balance to monitor.
     *
     *  Every request is wrapped in try/catch. A population that a single
     *  malformed organism can halt is not a population.
     */
    function think() external onlyDriver inPhase(0) {
        // SCOPED DELIBERATELY. `currentWindow` returns nine values, but only two
        // are still needed once the window is recorded. Holding the others alive
        // across the per-organism request loop below overflows the stack — under the
        // legacy codegen AND under --via-ir, which misses by exactly one slot. The
        // `WindowOpened` emit lives inside this block for the same reason: it is the
        // only later use of `openPrice` and `pool`, and moving it here is what frees
        // the last slot. Do not hoist these declarations or that emit out.
        bytes32 marketId;
        string memory context;
        {
            (
                bytes32 marketId_,
                address pool_,
                uint256 upId,
                uint256 downId,
                uint256 openPrice_,
                uint256 lastPrice,
                uint8 priceDecimals,
                uint64 secondsRemaining,
                bool tradeable
            ) = IPriceSource(priceSource).currentWindow(symbol);

            // status != 1 means not trading. Opening a position anyway is the fastest
            // way to lose an organism's stake to a revert instead of to a bad forecast.
            if (!tradeable) revert MarketNotTradeable();

            activeMarketId = marketId_;
            activePool = pool_;
            activeUpId = upId;
            activeDownId = downId;
            windowCount += 1;

            context = Genome.beliefPrompt(symbol, openPrice_, lastPrice, priceDecimals, secondsRemaining);
            marketId = marketId_;

            // Emitted before the requests rather than after. Same transaction and
            // same block either way, so every consumer — including
            // `prove-same-block.ts`, which recovers marketId and pool from this log
            // — is unaffected. Ordering now reads truthfully anyway: the window is
            // open, and then the organisms think about it.
            emit WindowOpened(windowCount, marketId_, pool_, openPrice_);
        }

        string[] memory allowed = Genome.allowedBeliefs();
        uint256 dep = requestDeposit();

        uint256 n = prophets.length;
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[i]));
            if (p.dead()) continue;

            bytes memory payload =
                abi.encodeCall(ILLMAgent.inferString, (context, p.systemPrompt(), chainOfThought, allowed));

            try IAgentRequester(agentRequester).createAdvancedRequest{value: dep}(
                llmAgentId,
                address(p),
                Prophet.handleBelief.selector,
                payload,
                subcommitteeSize,
                threshold,
                ConsensusType.Majority,
                requestTimeout
            ) returns (uint256 requestId) {
                p.noteThinking(requestId, marketId);
            } catch {
                emit ThinkFailed(i + 1);
            }
        }

        phase = 1;
    }

    /**
     *  What to escrow per request.
     *
     *  `getRequestDeposit()` is a FLOOR, not a price. The docs are explicit that a
     *  request funded at exactly the floor is liable to be skipped, because runners
     *  compare `perAgentBudget` against their own `scheduledExecutionCost` and
     *  decline when it does not clear. A skipped request is indistinguishable from
     *  a silent population, so the reward sits on top deliberately.
     */
    function requestDeposit() public view returns (uint256) {
        uint256 floor_ = IAgentRequester(agentRequester).getAdvancedRequestDeposit(subcommitteeSize);
        return floor_ + (perAgentReward * subcommitteeSize);
    }

    /*//////////////////////////////////////////////////////////////
                            2. COMMITMENT
    //////////////////////////////////////////////////////////////*/

    /**
     *  Turn beliefs into fully-backed positions.
     *
     *  `mintSet(yesTo, noTo, amount)` takes INDEPENDENT recipients, which is the
     *  single most useful thing in the DreamDEX surface for this design: two
     *  organisms that disagree are issued real, exactly-1:1-backed opposing
     *  positions out of their combined collateral, with no order book, no external
     *  trader, and no cold-start problem. On a quiet testnet that is the difference
     *  between a live population and a stalled one.
     *
     *  An organism left unpaired still opens a zero-size position, because it still
     *  has to pay for having thought. Being unable to find a counterparty is not an
     *  excuse from metabolism.
     */
    function commitAll() external onlyDriver inPhase(1) {
        uint256 n = prophets.length;
        address[] memory ups = new address[](n);
        address[] memory downs = new address[](n);
        uint256 nu;
        uint256 nd;

        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[i]));
            if (p.dead()) continue;
            Belief b = p.belief();
            if (b == Belief.Up) {
                ups[nu++] = address(p);
            } else if (b == Belief.Down) {
                downs[nd++] = address(p);
            } else {
                // Abstained, or never received a consensus answer at all.
                _openEmpty(p, 0);
            }
        }

        uint256 pairs = nu < nd ? nu : nd;
        for (uint256 i; i < pairs; ++i) {
            _pair(Prophet(payable(ups[i])), Prophet(payable(downs[i])));
        }
        for (uint256 i = pairs; i < nu; ++i) {
            _openEmpty(Prophet(payable(ups[i])), activeUpId);
        }
        for (uint256 i = pairs; i < nd; ++i) {
            _openEmpty(Prophet(payable(downs[i])), activeDownId);
        }

        phase = 2;
    }

    function _pair(Prophet up, Prophet down) internal {
        uint256 want = _stakeOf(up);
        uint256 other = _stakeOf(down);
        if (other < want) want = other;

        if (want < minStake) {
            _openEmpty(up, activeUpId);
            _openEmpty(down, activeDownId);
            return;
        }

        try this.executePair(up, down, want) {
            // handled in executePair
        } catch {
            emit CommitFailed(up.prophetId());
            emit CommitFailed(down.prophetId());
            _openEmpty(up, activeUpId);
            _openEmpty(down, activeDownId);
        }
    }

    /**
     *  The pairing body, external so a single failed mint cannot roll back an
     *  entire window of commitments. `this.executePair(...)` gives a revert
     *  boundary; the `onlyPopulation` checks downstream still pass because
     *  `msg.sender` is still this contract.
     */
    function executePair(Prophet up, Prophet down, uint256 stake) external {
        if (msg.sender != address(this)) revert NotDriver();

        uint256 fromUp = up.stakeOut(address(this), stake, collateral);
        uint256 fromDown = down.stakeOut(address(this), stake, collateral);
        uint256 amount = fromUp + fromDown;

        // The pool pulls the collateral, so it needs an allowance for exactly this
        // amount. Approving per-call rather than infinitely: pools are recycled
        // across windows, and a standing allowance to a recycled address is a
        // liability nobody is watching.
        IERC20Like(collateral).approve(activePool, amount);
        IBinaryPool(activePool).mintSet(address(up), address(down), amount);

        // Each side HOLDS `amount` tokens but RISKED only its own contribution, so
        // the winner redeems the pair's whole backing and nets the loser's stake.
        // Even odds at an effective price of 0.5.
        up.noteCommitted(activeUpId, fromUp, amount);
        down.noteCommitted(activeDownId, fromDown, amount);
        emit Paired(up.prophetId(), down.prophetId(), amount);
    }

    function _openEmpty(Prophet p, uint256 outcomeId) internal {
        try p.noteCommitted(outcomeId, 0, 0) {
            emit Unpaired(p.prophetId(), p.belief());
        } catch {
            emit CommitFailed(p.prophetId());
        }
    }

    function _stakeOf(Prophet p) internal view returns (uint256) {
        return (p.treasury() * stakeBps) / 10_000;
    }

    /*//////////////////////////////////////////////////////////////
                             3. SELECTION
    //////////////////////////////////////////////////////////////*/

    /**
     *  Grade the window: redeem, score, charge metabolism, reap, flag breeding.
     *
     *  Invoked from SelectionEngine's reactive callback in the SAME BLOCK the
     *  market settled. `finalizeAndRedeem` folds finalization into redemption, so
     *  nothing keeper-shaped sits between resolution and consequence — that is the
     *  demo's central claim, and it is architecturally exact rather than
     *  aspirational.
     */
    function settleAll() external onlyDriver inPhase(2) {
        address pool = activePool;
        uint256 n = prophets.length;

        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[i]));
            if (p.dead() || !p.positionOpen()) continue;

            try p.settleWindow(settlement, pool, collateral, metabolicCost) returns (uint256, bool starved) {
                // DEATH: it can no longer afford to think. Not a health bar
                // reaching zero — an organism that cannot pay for cognition in a
                // world where cognition is metered is simply over.
                if (starved || p.treasury() < metabolicCost) {
                    p.die(windowCount);
                    aliveCount -= 1;
                    emit Reaped(p.prophetId(), windowCount, aliveCount);
                } else if (p.streak() >= breedStreak && p.treasury() >= _breedThreshold()) {
                    _requestMutation(p);
                }
            } catch {
                emit SettleFailed(p.prophetId());
            }
        }

        phase = 0;
        emit WindowClosed(windowCount, aliveCount);
    }

    function _breedThreshold() internal view returns (uint256) {
        return endowment + ((endowment * breedSurplusBps) / 10_000);
    }

    /*//////////////////////////////////////////////////////////////
                           4. REPRODUCTION
    //////////////////////////////////////////////////////////////*/

    /**
     *  Ask a language model to mutate the parent's genome.
     *
     *  Heredity is itself an on-chain inference call. The parent's record goes into
     *  the prompt, so variation is informed by measured fitness rather than random
     *  — Lamarckian rather than strictly Darwinian, which is the honest description
     *  and also the only one that converges over the ~1,000 windows available.
     */
    function _requestMutation(Prophet p) internal {
        bytes memory payload = abi.encodeCall(
            ILLMAgent.inferString,
            (
                Genome.mutationPrompt(
                    p.systemPrompt(), p.correctCount(), p.wrongCount(), p.abstainCount(), p.generation()
                ),
                Genome.mutationSystem(),
                false, // no chain-of-thought: we want the genome text, nothing else
                new string[](0) // free-form: a genome cannot be an enum
            )
        );

        try IAgentRequester(agentRequester).createAdvancedRequest{value: requestDeposit()}(
            llmAgentId,
            address(p),
            Prophet.handleMutation.selector,
            payload,
            subcommitteeSize,
            threshold,
            ConsensusType.Majority,
            requestTimeout
        ) returns (uint256 requestId) {
            p.noteMutating(requestId);
            emit BreedingRequested(p.prophetId(), requestId);
        } catch {
            emit ThinkFailed(p.prophetId());
        }
    }

    /// @dev Birth every child whose mutated genome has landed. Separate from
    ///      settleAll so a slow inference never delays a settlement, and so the
    ///      gas of a birth is never charged to the settlement callback.
    function hatchAll() external onlyDriver {
        uint256 n = prophets.length;
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[i]));
            if (p.dead()) continue;
            if (bytes(p.pendingChildPrompt()).length == 0) continue;
            if (prophets.length >= maxPopulation) break;
            _hatch(p);
        }
    }

    function _hatch(Prophet parent) internal {
        string memory childGenome = parent.consumeChildPrompt();
        if (bytes(childGenome).length == 0) return;

        // Reproduction is expensive, as it should be: the parent funds the child
        // out of its own treasury. A survivor that breeds is deliberately more
        // fragile immediately afterwards.
        uint256 taken = parent.stakeOut(address(this), endowment, collateral);
        if (taken < endowment) {
            // Could not actually afford it after all; return the collateral.
            if (taken > 0) {
                if (!IERC20Like(collateral).transfer(address(parent), taken)) revert TransferFailed();
                parent.fund(taken);
            }
            return;
        }

        _spawn(parent.prophetId(), parent.generation() + 1, childGenome);
    }

    /*//////////////////////////////////////////////////////////////
                            HUMAN INTERACTION
    //////////////////////////////////////////////////////////////*/

    /// @dev Anyone can feed an organism. Pulls collateral from the caller — a
    ///      spectator putting real backing behind an organism they believe in.
    function fundProphet(uint256 prophetId, uint256 amount) external {
        address p = prophetAt(prophetId);
        if (Prophet(payable(p)).dead()) revert ProphetIsDead();
        if (!IERC20Like(collateral).transferFrom(msg.sender, p, amount)) revert TransferFailed();
        Prophet(payable(p)).fund(amount);
    }

    /// @dev Spend a qualifying survivor's surplus to breed it now, rather than
    ///      waiting for the next settlement to notice it qualifies. The eligibility
    ///      rules are identical — a human can choose the moment, never the outcome.
    function breedProphet(uint256 prophetId) external {
        Prophet p = Prophet(payable(prophetAt(prophetId)));
        if (p.dead()) revert ProphetIsDead();
        if (p.streak() < breedStreak || p.treasury() < _breedThreshold()) revert NotEligibleToBreed();
        _requestMutation(p);
    }

    /*//////////////////////////////////////////////////////////////
                                 VIEWS
    //////////////////////////////////////////////////////////////*/

    function prophetCount() external view returns (uint256) {
        return prophets.length;
    }

    function prophetAt(uint256 prophetId) public view returns (address) {
        if (prophetId == 0 || prophetId > prophets.length) revert NoSuchProphet();
        return prophets[prophetId - 1];
    }

    struct Snapshot {
        uint256 id;
        address addr;
        uint256 parentId;
        uint32 generation;
        uint256 treasury;
        uint32 streak;
        uint32 windowsLived;
        uint32 correctCount;
        uint32 wrongCount;
        uint32 abstainCount;
        uint64 birthWindow;
        uint64 deathWindow;
        bool dead;
        uint8 belief;
        uint8 thesis;
        bytes32 genomeHash;
    }

    /// @dev The whole population in one call. The frontend renders every surface
    ///      from this plus per-organism genome/reasoning reads, so no indexer sits
    ///      between the chain and the UI for live state.
    function snapshot() external view returns (Snapshot[] memory out) {
        uint256 n = prophets.length;
        out = new Snapshot[](n);
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[i]));

            // FIELD BY FIELD, NOT A STRUCT LITERAL, AND THIS IS LOAD-BEARING.
            // `Snapshot({...})` requires all sixteen field values to be live at the
            // same moment, which — together with the loop counter and the array's
            // memory pointer — overflows the stack even under --via-ir, whose
            // stack-limit evader misses by exactly one slot. Assigning one field at a
            // time keeps a single external call result live. The resulting struct is
            // identical; do not tidy this back into a literal.
            Snapshot memory s;
            s.id = p.prophetId();
            s.addr = address(p);
            s.parentId = p.parentId();
            s.generation = p.generation();
            s.treasury = p.treasury();
            s.streak = p.streak();
            s.windowsLived = p.windowsLived();
            s.correctCount = p.correctCount();
            s.wrongCount = p.wrongCount();
            s.abstainCount = p.abstainCount();
            s.birthWindow = p.birthWindow();
            s.deathWindow = p.deathWindow();
            s.dead = p.dead();
            s.belief = uint8(p.belief());
            s.thesis = uint8(p.lastThesis());
            s.genomeHash = p.genomeHash();
            out[i] = s;
        }
    }

    /*//////////////////////////////////////////////////////////////
                              HOUSEKEEPING
    //////////////////////////////////////////////////////////////*/

    /// @dev Native funds the cognition of the entire population. Keep it topped up
    ///      or the run stops — `monitor.ts` watches exactly this balance.
    receive() external payable {}

    /// @dev Recover collateral or native that is not owed to an organism. Cannot
    ///      touch a Prophet's treasury: this contract holds nothing between
    ///      transactions except accumulated metabolic reimbursement.
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else if (!IERC20Like(token).transfer(to, amount)) {
            revert TransferFailed();
        }
    }
}
