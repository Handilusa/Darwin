// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

import {IAgentRequester, ILLMAgent, ConsensusType} from "./interfaces/ISomnia.sol";
import {IERC20Like} from "./interfaces/IDreamDEX.sol";
import {IArenaVenue} from "./interfaces/IArenaVenue.sol";
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

    // --- the venue seam ---
    /**
     *  THE PADDING IS NOT DEAD WEIGHT. `phase` above is a `uint8`, so its slot has
     *  thirty-one bytes spare and Solidity would happily pack a 20-byte `address`
     *  into them. `CLAUDE.md` forbids exactly that — *"`Population` slots 13, 18,
     *  21, 23, 26 have free bytes. Do not fill them. Packing into a partially-used
     *  slot changes nothing for a fresh deploy and corrupts nothing visibly until
     *  an organism's counter starts reading someone else's bytes. Take a fresh slot
     *  from `__gap`."* A `uint256` cannot fit in thirty-one bytes, so declaring one
     *  here is what forces `venue` onto a fresh slot; there is no padding
     *  primitive that does it more directly.
     *
     *  Cost: two slots out of twenty, one of them unused, to keep every slot
     *  boundary where `STORAGE.md` says it is. That is the cheap side of the trade.
     */
    uint256 private __slotAlign;

    /// @dev Where positions live and how a resolved position becomes collateral.
    ///      DreamDEX is fitness function #1, not the definition of the arena.
    address public venue;

    // --- the living population, as distinct from the lineage ---
    /**
     *  Prophet ids of organisms that are still alive, in no particular order.
     *
     *  `prophets` is append-only and must stay that way: ids ARE array positions
     *  (`prophetAt` returns `prophets[prophetId - 1]`), and the ancestry graph is
     *  the one asset this design refuses to be able to rebuild. So the lineage
     *  cannot be compacted — which is exactly why the cap and the per-window loops
     *  must not read it. They read this instead.
     */
    uint256[] public living;

    /// @dev prophetId -> its 1-BASED position in `living`. Zero means "not living",
    ///      which is what makes `_removeLiving` idempotent.
    mapping(uint256 => uint256) public livingIndex;

    // --- open arena ---
    /// @dev Floor on what an entrant must stake to play. No padding needed here,
    ///      unlike `venue` and `Prophet.entrant`: a `uint256` occupies a whole slot
    ///      by definition, so it cannot pack into the trailing bytes of anything.
    uint256 public minEndowment;

    /// @dev Native STT handed to a newborn to think with. Zero until Task 3 makes
    ///      organisms pay for their own cognition; set per-deploy after that.
    uint256 public cognitionEndowment;

    uint256[14] private __gap;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    event WindowOpened(uint64 indexed window, bytes32 indexed marketId, address pool, uint256 openPrice);
    event Spawned(uint256 indexed prophetId, address prophet, uint256 indexed parentId, uint32 generation);
    event Paired(uint256 indexed upId, uint256 indexed downId, uint256 amount);
    event Unpaired(uint256 indexed prophetId, Belief belief);
    event Reaped(uint256 indexed prophetId, uint64 window, uint256 aliveRemaining);
    /// @dev An entrant left voluntarily and took what the organism still held —
    ///      both currencies, because they funded both. `cognitionReturned` is what
    ///      actually landed, so a zero there against a live organism means the
    ///      refund bounced and a `CognitionUnspent` log names the amount to sweep.
    ///      Distinct from `Reaped`, which is death by starvation and forfeits.
    event Retired(
        uint256 indexed prophetId, address indexed entrant, uint256 collateralReturned, uint256 cognitionReturned
    );
    event BreedingRequested(uint256 indexed parentId, uint256 requestId);
    /// @dev Bred on merit, could not afford the thought. Not a failure — the
    ///      organism keeps its streak and its surplus, and may breed in a later
    ///      window once someone tops its cognition up.
    event BreedingUnaffordable(uint256 indexed prophetId);
    event WindowClosed(uint64 indexed window, uint256 aliveCount);
    /// @dev An unattended run must never be stalled by one bad organism. Each of
    ///      these is a caught revert, kept as a log so the monitor can see it.
    event ThinkFailed(uint256 indexed prophetId);
    event CommitFailed(uint256 indexed prophetId);
    event SettleFailed(uint256 indexed prophetId);
    /// @dev A drawn cognition deposit that bought no inference: the request was
    ///      already paid for when `createAdvancedRequest` reverted, so the native
    ///      stays in this contract and belongs, morally, to the organism. Emitted
    ///      rather than refunded because `think`'s loop is at the --via-ir stack
    ///      limit; reconciled by the operator, not on chain. Bounded by one
    ///      deposit per failed request.
    event CognitionUnspent(uint256 indexed prophetId, uint256 amount);
    /// @dev Someone paid for an organism's thinking — at birth, or as a sponsor.
    ///      The counterpart of the collateral funding path, kept separate because
    ///      the two buy different things: collateral buys a bigger wager, native
    ///      buys more windows to live through.
    event CognitionFunded(uint256 indexed prophetId, address indexed from, uint256 amount);

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
    error EndowmentTooSmall();
    /// @dev An entrant must fund their own organism's thinking. See `enter`.
    error CognitionTooSmall();
    error NotEntrant();
    error PositionStillOpen();

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
        address venue;
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
        venue = w.venue;
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

        minEndowment = 10_000_000; // 10 tUSDC — the same as a house endowment

        // TEN WINDOWS OF THINKING, and it must not be zero. Once cognition is paid
        // by the organism, a newborn with an empty native balance is skipped by
        // `think`, abstains, is charged metabolism anyway, and starves without ever
        // having had an opinion — so a zero here does not mean "off", it means the
        // population is born brain-dead. The arithmetic is the measured live price:
        // `requestDeposit() = 3 x (0.01 + 0.001) = 0.033 STT` per inference, so
        // 0.33 STT buys exactly ten, and a newborn's lifespan at the 15-minute
        // cadence is legible rather than notional. `_spawn` degrades to an unfunded
        // birth if the house cannot cover it, and a sponsor can close the gap with
        // `topUpCognition`. Override per season with `setSeason`; a demo season can
        // reasonably run it much lower.
        cognitionEndowment = 0.33 ether;

        subcommitteeSize = 3;
        threshold = 2;
        // 300 s, deliberately below the platform's defaultTimeout() of 600 s. Verified
        // 2026-08-29 on Shannon: AgentRequester enforces no minimum — every value from 1 to
        // 86400 is accepted and only 0 reverts (InvalidTimeout()). Measured latency over
        // 6,231 completed requests was p50 0.6 s, max 5.3 s, so this is ~50x headroom, and a
        // shorter deadline means a stalled request abstains within one window instead of
        // straddling two. Adjustable post-deploy via setInference; see SPIKE.md row 8.
        requestTimeout = 300;
        chainOfThought = true;
        // 0.001, lowered from 0.01 on 2026-08-29 because the run's STT budget is the
        // binding constraint on how long this population can live, and 0.01 was a guess.
        //
        // Measured on Shannon: getAdvancedRequestDeposit(n) is EXACTLY 0.01 STT * n,
        // linear across n = 1..21, so the floor is 0.01 per validator and the total
        // deposit is n * (0.01 + perAgentReward). Real traffic on the platform pays
        // 0.0003 per validator and gets served — five single-request transactions cost
        // 0.0309 STT net each, which is exactly 3 * (0.01 + 0.0003). See §2.13.
        //
        // So 0.01 was ~33x the reward real requests pay, making our deposit 0.06 against
        // their 0.0309. 0.001 is still 3.3x the observed rate, which keeps the margin the
        // comment on requestDeposit() argues for while cutting the deposit to 0.033 —
        // a 45% cut in the cost of every window the population lives through.
        //
        // If validators start declining (indistinguishable from a silent population —
        // watch ThinkFailed and the abstain counts), raise it with setInference. That is
        // one onlyOwner tx, no upgrade. Do not go below 0.0003.
        perAgentReward = 0.001 ether;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /*//////////////////////////////////////////////////////////////
                                 CONFIG
    //////////////////////////////////////////////////////////////*/

    /// @dev The venue is swappable so a running arena can be repointed at a
    ///      different settlement mechanism. Existing organisms need no re-grant:
    ///      they PUSH their position to the venue at settlement rather than the
    ///      venue pulling it, so there is no standing authorisation to migrate.
    function setWiring(address priceSource_, address selectionEngine_, address prophetBeacon_, address venue_)
        external
        onlyOwner
    {
        if (priceSource_ != address(0)) priceSource = priceSource_;
        if (selectionEngine_ != address(0)) selectionEngine = selectionEngine_;
        if (prophetBeacon_ != address(0)) prophetBeacon = prophetBeacon_;
        if (venue_ != address(0)) venue = venue_;
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
    ///
    ///      `payable` so a deploy can seed the founders' cognition in the same
    ///      transaction that creates them — `_spawn` forwards `cognitionEndowment`
    ///      out of this contract's balance, and without the value attached here the
    ///      first window would have to wait on a separate funding tx.
    function spawnGenesis(string[] calldata genomes) external payable onlyOwner {
        for (uint256 i; i < genomes.length; ++i) {
            _spawn(0, 0, genomes[i], msg.sender, endowment);
        }
    }

    function _spawn(uint256 parentId, uint32 generation, string memory genome, address entrant, uint256 endow)
        internal
        returns (address p)
    {
        // `living.length`, NOT `prophets.length`. `prophets` is append-only, so
        // capping on it makes `maxPopulation` a LIFETIME BIRTH CAP rather than the
        // gas bound it is documented to be: after that many births ever, the
        // generation counter freezes permanently and attrition empties an arena
        // nobody can join. See STORAGE.md and the Task 2A commit.
        if (living.length >= maxPopulation) revert PopulationFull();

        // `id` IS NOT A LOCAL ON PURPOSE. The Yul optimizer inlines this function
        // into `spawnGenesis`'s loop, and the inlined body sits exactly one stack
        // slot over the limit; holding the id in a local is what pushes it over.
        // Ids are 1-based (0 means "no parent"), so it is `prophets.length + 1`
        // before the push and `prophets.length` after — the same number, read twice
        // for a warm SLOAD each. Do not reintroduce the local. The two index writes
        // below re-read it for the same reason.
        p = address(new BeaconProxy(prophetBeacon, ""));
        Prophet(payable(p)).initialize(
            address(this), prophets.length + 1, parentId, generation, windowCount, entrant, genome
        );
        prophets.push(p);
        living.push(prophets.length);
        livingIndex[prophets.length] = living.length;
        aliveCount += 1;

        // Operator rights on the ERC-6909 singleton and a collateral allowance, so
        // this contract can route on the organism's behalf later without a second
        // transaction per birth.
        Prophet(payable(p)).grantPopulation(outcomeToken, collateral);

        // `endow` is a PARAMETER rather than a read of `endowment`, because the three
        // callers fund a birth differently: genesis and hatching spend the house's
        // balance, while `enter` has already pulled the entrant's own collateral in.
        // Every caller must make sure this contract holds the amount first — that is
        // what keeps genesis, entry and breeding on one code path.
        if (endow > 0) {
            if (!IERC20Like(collateral).transfer(p, endow)) revert TransferFailed();
            Prophet(payable(p)).fund(endow);
        }

        // A newborn that cannot think is a newborn that abstains its way to death
        // without ever having had an opinion, so the house stakes it enough native
        // to start. Scoped, and guarded on the balance rather than reverting: an
        // underfunded house must still be able to bear children, and a sponsor can
        // top the child up afterwards through `topUpCognition`. `from` is this
        // contract because the native is this contract's, whoever triggered the
        // birth.
        if (cognitionEndowment > 0 && address(this).balance >= cognitionEndowment) {
            (bool ok,) = p.call{value: cognitionEndowment}("");
            if (!ok) revert TransferFailed();
            emit CognitionFunded(prophets.length, address(this), cognitionEndowment);
        }

        emit Spawned(prophets.length, p, parentId, generation);
    }

    /*//////////////////////////////////////////////////////////////
                               OPEN ARENA
    //////////////////////////////////////////////////////////////*/

    /**
     *  Enter the arena.
     *
     *  Permissionless and deliberately free at the door: entrants are the scarce
     *  input, so revenue comes from time spent in the arena (metabolism, and the
     *  rake on settlement) rather than from a toll. What the entrant must supply
     *  is their own organism's backing — they are not paying the house, they are
     *  funding their player.
     *
     *  Two currencies, and both come from the entrant. `endowmentAmount` is
     *  collateral: how large a wager the organism can make. `msg.value` is native:
     *  how many windows it can afford to think through. `cognitionEndowment` is the
     *  floor on the second, and requiring it HERE rather than granting it from the
     *  house is a griefing fix, not a style choice — entry is free and `retire`
     *  refunds the collateral, so a house-funded grant would be an unbounded free
     *  inference faucet: enter, retire, repeat, and every cycle walks off with
     *  `cognitionEndowment` of the operator's STT converted into LLM calls. The
     *  founders (`spawnGenesis`, owner-only) and children (`_hatch`, earned over
     *  four correct windows) are house-funded because neither is farmable.
     */
    function enter(string calldata genome, uint256 endowmentAmount) external payable returns (uint256 prophetId) {
        if (endowmentAmount < minEndowment) revert EndowmentTooSmall();
        if (msg.value < cognitionEndowment) revert CognitionTooSmall();
        if (!IERC20Like(collateral).transferFrom(msg.sender, address(this), endowmentAmount)) {
            revert TransferFailed();
        }

        // `msg.value` is already in this contract's balance, so `_spawn` forwards
        // `cognitionEndowment` out of the entrant's own payment rather than out of
        // the house float.
        _spawn(0, 0, genome, msg.sender, endowmentAmount);
        prophetId = prophets.length;

        // Anything above the floor is forwarded too, so `msg.value` lands in the
        // organism to the wei and nothing accrues here. An entrant who wants a
        // long-lived organism funds it once, at the door.
        uint256 extra = msg.value - cognitionEndowment;
        if (extra > 0) {
            (bool ok,) = prophets[prophetId - 1].call{value: extra}("");
            if (!ok) revert TransferFailed();
            emit CognitionFunded(prophetId, msg.sender, extra);
        }
    }

    function setSeason(uint256 minEndowment_, uint256 cognitionEndowment_) external onlyOwner {
        minEndowment = minEndowment_;
        cognitionEndowment = cognitionEndowment_;
    }

    /**
     *  Leave the arena and take what the organism still holds.
     *
     *  Rent already charged and antes already lost stay lost — this is an exit,
     *  not a refund. What it guarantees is that the *remaining* stake belongs to
     *  whoever put it in, which is what makes entering a wager rather than a
     *  donation.
     *
     *  `positionOpen` is the entire anti-rage-quit gate, and it needs no new
     *  state: it is true from `commitAll` until `settleAll`, so an entrant cannot
     *  watch a market move against their organism and pull the stake out from
     *  under the counterparty it is already paired 1:1 with. Between windows,
     *  leaving is free — an organism nobody wants to keep funding should stop
     *  costing its entrant money.
     *
     *  BOTH currencies come back, because the entrant put both in. Returning the
     *  collateral while stranding the unspent cognition in a dead organism would
     *  make this a partial exit and quietly turn `enter`'s native requirement into
     *  a one-way ratchet on the entrant's STT.
     */
    function retire(uint256 prophetId) external {
        Prophet p = Prophet(payable(prophetAt(prophetId)));
        if (msg.sender != p.entrant()) revert NotEntrant();
        if (p.dead()) revert ProphetIsDead();
        if (p.positionOpen()) revert PositionStillOpen();

        // `stakeOut` carries the `alive` modifier, so the drain MUST come before
        // die(). Reversing these two lines does not merely reorder them: `stakeOut`
        // then reverts `IsDead()` and the whole exit becomes impossible, locking the
        // entrant's capital in an organism that can no longer earn it back. Verified
        // by flipping them — all three test_retire_* cases fail with `IsDead()`.
        uint256 remaining = p.treasury();
        if (remaining > 0) p.stakeOut(msg.sender, remaining, collateral);

        // Drawn here for symmetry with the collateral, though `drawCognition`
        // deliberately carries no `alive` modifier and so would work after die()
        // too. All-or-nothing means asking for the whole balance always succeeds.
        uint256 cognition = p.drawCognition(address(p).balance);

        p.die(windowCount);
        aliveCount -= 1;
        _removeLiving(prophetId);

        // LAST, and deliberately after every state write. This is the only call in
        // `retire` that can hand control to arbitrary code — an entrant contract's
        // `receive` — and a reentrant `retire` reaching `_removeLiving` a second
        // time would run the swap-remove twice and corrupt `living`. Placed after
        // the writes, a reentrant call simply reverts on `ProphetIsDead`.
        uint256 cognitionReturned;
        if (cognition > 0) {
            (bool ok,) = msg.sender.call{value: cognition}("");
            if (ok) {
                cognitionReturned = cognition;
            } else {
                // NOT a revert. An entrant whose address cannot receive native must
                // still be able to leave: the collateral, the end of metabolism and
                // the freed arena slot all matter more than the refund. Logged so
                // the owner can `sweep` it to them instead.
                emit CognitionUnspent(prophetId, cognition);
            }
        }
        emit Retired(prophetId, msg.sender, remaining, cognitionReturned);
    }

    /*//////////////////////////////////////////////////////////////
                             1. COGNITION
    //////////////////////////////////////////////////////////////*/

    /**
     *  Open a window and pay for every living organism to think about it.
     *
     *  One `createAdvancedRequest` per organism, each naming the ORGANISM as the
     *  callback target while this contract is the payer of record. That asymmetry —
     *  `callbackAddress` need not be the payer — is what lets the answer land
     *  directly on the organism that asked.
     *
     *  THE ORGANISM FUNDS IT. This contract is only the conduit: it draws the
     *  deposit out of the organism's own native balance immediately before each
     *  request and forwards exactly that, keeping nothing. It used to pay out of its
     *  own float, which made the protocol's bill grow linearly with the number of
     *  living organisms — that is, linearly with evolutionary success, the one thing
     *  the whole system is trying to maximise. An organism that cannot afford the
     *  deposit is skipped, abstains, and is still charged metabolism at settlement:
     *  running out of cognition is how selection is supposed to feel.
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

        uint256 n = living.length;
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[living[i] - 1]));
            if (p.dead()) continue;

            // THE ORGANISM PAYS. Population is a conduit, not a patron: it forwards
            // exactly what it drew and keeps nothing. A short draw takes nothing at
            // all (see Prophet.drawCognition), so an organism that cannot afford to
            // think simply does not think — it will abstain in commitAll, open an
            // empty position, and still be charged metabolism at settlement. That is
            // the selection pressure working, not a fault.
            if (p.drawCognition(dep) < dep) {
                emit ThinkFailed(living[i]);
                continue;
            }

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
                // `living[i]`, NOT `i + 1`. `i` is a position in `living` now, not an
                // id, so emitting `i + 1` would blame a different organism and
                // `monitor.ts` would chase the wrong one.
                emit ThinkFailed(living[i]);
                // The deposit was already drawn and the request did not happen, so
                // `dep` of an ENTRANT's native is now sitting in this contract. Not
                // refunded here: this loop is the scope that overflows the --via-ir
                // stack limit. Emitted so it is reconcilable off chain instead.
                emit CognitionUnspent(living[i], dep);
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
        uint256 n = living.length;
        address[] memory ups = new address[](n);
        address[] memory downs = new address[](n);
        uint256 nu;
        uint256 nd;

        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[living[i] - 1]));
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

        // The venue pulls the collateral, so it needs an allowance for exactly
        // this amount. Approving per-call rather than infinitely: a venue is
        // replaceable via setWiring, and a standing allowance to an address we
        // have since stopped using is a liability nobody is watching.
        address v = venue;
        IERC20Like(collateral).approve(v, amount);
        (uint256 upId, uint256 downId, uint256 quantity) =
            IArenaVenue(v).openOpposing(address(up), address(down), amount);

        // Each side HOLDS `quantity` tokens but RISKED only its own contribution,
        // so the winner redeems the pair's whole backing and nets the loser's
        // stake. Even odds at an effective price of 0.5. The venue reports the
        // quantity rather than this contract deriving it from `amount`, because
        // what a position unit means is the venue's business, not ours.
        up.noteCommitted(upId, fromUp, quantity);
        down.noteCommitted(downId, fromDown, quantity);
        emit Paired(up.prophetId(), down.prophetId(), amount);
    }

    /**
     *  Record a zero-size position: the organism had a forecast but no
     *  counterparty, or no forecast at all.
     *
     *  THE ID HERE IS A LABEL, NOT A CLAIM ON ANYTHING. It comes from the price
     *  source's view of the window rather than from the venue, which is the one
     *  place the engine still names an outcome id the venue did not issue. That is
     *  sound because `quantity` is zero: `Prophet.settleWindow` skips the venue
     *  entirely on a zero quantity, so the id is never pushed and never redeemed.
     *  A venue whose ids are pure bookkeeping (`positionToken() == address(0)`)
     *  therefore costs nothing here — but do not start treating this argument as a
     *  position the venue knows about.
     */
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
     *  market settled. The venue folds finalization into redemption, so nothing
     *  keeper-shaped sits between resolution and consequence — that is the demo's
     *  central claim, and it is architecturally exact rather than aspirational.
     *  It is also the reason `IArenaVenue.redeemFor` may not read a price feed:
     *  on this path no price has been pushed since the window opened.
     */
    function settleAll() external onlyDriver inPhase(2) {
        address v = venue;

        // BACKWARDS ON PURPOSE. This is the one loop that removes elements while
        // walking, and `_removeLiving` swap-removes: the hole is filled from the
        // END. Forwards, that element is one this loop has not reached yet and
        // would now skip — an organism silently unsettled, its position left open,
        // never graded, and no event to say so. Backwards, the element moved in has
        // already been processed. Do not "tidy" this into a forward loop.
        for (uint256 i = living.length; i > 0; --i) {
            Prophet p = Prophet(payable(prophets[living[i - 1] - 1]));
            if (p.dead() || !p.positionOpen()) continue;

            try p.settleWindow(v, collateral, metabolicCost) returns (uint256, bool starved) {
                // DEATH: it can no longer afford to think. Not a health bar
                // reaching zero — an organism that cannot pay for cognition in a
                // world where cognition is metered is simply over.
                if (starved || p.treasury() < metabolicCost) {
                    p.die(windowCount);
                    aliveCount -= 1;
                    _removeLiving(p.prophetId());
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

    /**
     *  Swap-remove an id from `living`.
     *
     *  Idempotent by construction: an id whose `livingIndex` is zero is simply not
     *  there, so a second reap — or a `retire` racing a starvation — cannot corrupt
     *  the array or underflow the pop.
     */
    function _removeLiving(uint256 prophetId) internal {
        uint256 pos = livingIndex[prophetId];
        if (pos == 0) return;
        uint256 last = living.length;
        if (pos != last) {
            uint256 movedId = living[last - 1];
            living[pos - 1] = movedId;
            livingIndex[movedId] = pos;
        }
        living.pop();
        livingIndex[prophetId] = 0;
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
     *
     *  THE PARENT PAYS FOR IT. Breeding is an inference like any other, so leaving
     *  it house-funded would have left the protocol with a recurring bill that grows
     *  in proportion to evolutionary success — precisely the dynamic organism-paid
     *  cognition exists to remove. Note that this does not endanger the settlement
     *  it runs inside: `settleWindow` moves COLLATERAL and `drawCognition` moves
     *  NATIVE, and the two balances do not interact.
     */
    function _requestMutation(Prophet p) internal {
        uint256 dep = requestDeposit();

        // Unaffordable breeding is a skip, never a revert: reverting here would
        // abort an entire settlement over one organism's empty pocket. The parent
        // keeps its streak and its surplus and may breed in a later window, so the
        // merit it earned is deferred rather than destroyed.
        if (p.drawCognition(dep) < dep) {
            emit BreedingUnaffordable(p.prophetId());
            return;
        }

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

        try IAgentRequester(agentRequester).createAdvancedRequest{value: dep}(
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
            // `ThinkFailed` is kept as-is because `monitor.ts` filters on its
            // topic0; `CognitionUnspent` is the accounting for the deposit that was
            // drawn from the parent and bought nothing.
            emit ThinkFailed(p.prophetId());
            emit CognitionUnspent(p.prophetId(), dep);
        }
    }

    /// @dev Birth every child whose mutated genome has landed. Separate from
    ///      settleAll so a slow inference never delays a settlement, and so the
    ///      gas of a birth is never charged to the settlement callback.
    function hatchAll() external onlyDriver {
        // Forwards is correct here: `_spawn` APPENDS to `living`, and `n` is
        // captured before the loop, so newborns are not iterated in the call that
        // bore them.
        uint256 n = living.length;
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[living[i] - 1]));
            if (p.dead()) continue;
            if (bytes(p.pendingChildPrompt()).length == 0) continue;
            if (living.length >= maxPopulation) break;
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

        _spawn(parent.prophetId(), parent.generation() + 1, childGenome, parent.entrant(), endowment);
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

    /**
     *  Pay for an organism's thinking.
     *
     *  The native sibling of `fundProphet`, and permissionless for the same reason:
     *  it can only ever move value INTO an organism, and buying someone else's
     *  cognition confers no control whatsoever over what they conclude — the genome
     *  is fixed and the inference is the platform's.
     *
     *  This is the sponsorship surface. `fundProphet` buys an organism a bigger
     *  wager; this one buys it more windows to live through, which is the scarcer
     *  of the two.
     */
    function topUpCognition(uint256 prophetId) external payable {
        address p = prophetAt(prophetId);
        if (Prophet(payable(p)).dead()) revert ProphetIsDead();
        (bool ok,) = p.call{value: msg.value}("");
        if (!ok) revert TransferFailed();
        emit CognitionFunded(prophetId, msg.sender, msg.value);
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

    /// @dev The concurrent population. `prophetCount()` is the LINEAGE — every
    ///      organism that ever lived, and the number the generation metric is read
    ///      from. This is how many are alive right now, and it is what
    ///      `maxPopulation` bounds and what each window's gas is proportional to.
    function livingCount() external view returns (uint256) {
        return living.length;
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

    /// @dev Native here endows FOUNDERS and NEWBORNS with cognition — it is not what
    ///      pays for thinking, which each organism now funds from its own balance.
    ///      Keep it above `cognitionEndowment` or children are born brain-dead and
    ///      have to be revived with `topUpCognition`; `monitor.ts` watches both this
    ///      balance and the organisms'.
    receive() external payable {}

    /**
     *  Recover collateral or native that is not owed to an organism.
     *
     *  Cannot touch a `Prophet`'s treasury — an organism custodies its own
     *  collateral and its own cognition balance, and this contract holds only the
     *  accumulated metabolic reimbursement plus any cognition deposit that was
     *  drawn for a request that then reverted.
     *
     *  Which makes this the reconciliation path for `CognitionUnspent`: pass
     *  `address(0)` and the organism's address to return the native to the organism
     *  it was drawn from. Doing it here rather than inside `think`'s loop is forced
     *  by the --via-ir stack limit, so the event is the record and this is the
     *  remedy.
     */
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else if (!IERC20Like(token).transfer(to, amount)) {
            revert TransferFailed();
        }
    }
}
