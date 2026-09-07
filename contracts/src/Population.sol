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
import {GenesisTreasury} from "./GenesisTreasury.sol";

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
    /// @dev VESTIGIAL. Was the share of treasury risked per window; the flat escalating
    ///      ante replaced it, and nothing reads this any more. It stays declared because
    ///      this layout is append-only — deleting it would shift every slot below — and it
    ///      stays settable because `setEconomics` takes it positionally. Writing it changes
    ///      nothing; read `ante()` instead. See `STORAGE.md`, 2026-08-30.
    uint16 public stakeBps;
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

    // --- the arena's climate: escalating ante, seasons, and the two books ---
    /**
     *  ONE SLOT, SEVEN FIELDS, AND THE PACKING IS DELIBERATE.
     *
     *  Every one of these is read on the hot path — `ante()` is called once per
     *  pairing and `level()` once per `ante()` — so a group that spans two slots
     *  doubles the cold-read cost of every window for the lifetime of the run. They
     *  are declared together, smallest last, so solc packs them into a single fresh
     *  slot: 4 + 8 + 4 + 4 + 2 + 2 + 2 = 26 of 32 bytes.
     *
     *  The six spare bytes at the end of this slot are NOT free space. `STORAGE.md`
     *  and `CLAUDE.md` both forbid filling the tail of a partially-used slot: it
     *  changes nothing for a fresh deploy and corrupts nothing visibly until an
     *  organism's counter starts reading someone else's bytes. A later field takes a
     *  slot from `__gap`.
     */
    uint32 public seasonId;
    uint64 public seasonStartWindow;
    uint32 public seasonWindows;
    uint32 public levelWindows;
    uint16 public anteMultBps;
    uint16 public rakeBps;
    uint16 public prizeShareBps;

    /// @dev What every organism risks per window at level 0. A `uint256` because it
    ///      is denominated in collateral like `endowment` and `minStake`, and because
    ///      that is what forces it onto a fresh slot rather than into the six spare
    ///      bytes above.
    uint256 public baseAnte;

    /**
     *  THE TWO BOOKS. Both are claims on this contract's collateral balance, which
     *  also holds the house float and is the source of every organism's endowment —
     *  so without an explicit split, `withdrawRake` would be indistinguishable from
     *  the operator helping themselves to the players' pot.
     *
     *  `rakeAccrued` is the only thing `withdrawRake` may draw against.
     *  `prizePool` is paid out by `endSeason` and is never withdrawable.
     */
    uint256 public rakeAccrued;
    uint256 public prizePool;

    /**
     *  THE ANTE THIS WINDOW WAS OPENED AT, frozen by `think` and spent by `_pair`.
     *
     *  Appended 2026-09-05, one slot out of `__gap` (shrunk 10 -> 9). It exists
     *  because `ante()` is DERIVED — `(windowCount - seasonStartWindow) / levelWindows`
     *  — and every input to it is writable by somebody while a window is in flight:
     *
     *    - `endSeason` is PERMISSIONLESS by design and sets `seasonStartWindow`, so
     *      any stranger could call it between `think` and `commitAll` and drop
     *      `level()` to 0. A late-season window would then have been forecast at a
     *      32-tUSDC ante and staked at 0.25.
     *    - `setSeason` is `onlyOwner` but equally ungated on the phase, and rewrites
     *      `baseAnte`, `anteMultBps` and `levelWindows` outright.
     *
     *  Gating either one on the phase is NOT the fix, and that is the whole reason
     *  this field exists. If the cadence dies mid-window the phase stays at 1 or 2,
     *  `forcePhase` is `onlyOwner`, and a phase-gated `endSeason` could then be
     *  called by nobody at all — the prize pool would never pay out. The property
     *  worth keeping is "no absent operator can hold a season open"; the property
     *  worth adding is "the price of a window is fixed when the window opens".
     *  Snapshotting keeps both, and closes the owner path the phase guard would not
     *  have touched.
     *
     *  `ante()` stays live everywhere it describes the CURRENT climate rather than a
     *  window already in flight — `enter`'s admission check, and every read a script
     *  or the frontend makes.
     */
    uint256 public windowAnte;

    /**
     *  WHERE THE EIGHT FOUNDERS' PRIZE MONEY GOES. Not the owner's EOA.
     *
     *  Appended 2026-09-05, one slot out of `__gap` (shrunk 9 -> 8). Slot 38, alone,
     *  20/32 bytes used — the twelve spare bytes are spare and STAY spare, same rule
     *  as slots 13, 18, 21, 23 and 26.
     *
     *  A public slot rather than a `spawnGenesis` argument, because the property
     *  being bought is that anyone can check AFTERWARDS who the founders pay. As an
     *  argument it would have to be reconstructed from the calldata of one historical
     *  transaction; as a slot it is one `eth_call`.
     *
     *  Zero until `deployGenesisTreasury()` runs, and `spawnGenesis` refuses to run
     *  while it is zero: `entrant` is written exactly once ever, in
     *  `Prophet.initialize`, so a founder minted against a zero treasury would be
     *  permanently ownerless AND permanently unretirable — `retire` requires
     *  `msg.sender == entrant`, which nobody can satisfy.
     *
     *  See `docs/superpowers/specs/2026-09-05-genesis-treasury-and-season-cadence-design.md`.
     */
    address public genesisTreasury;

    /**
     *  THE VENUE THAT ISSUED THIS WINDOW'S POSITIONS, AND THE RAKE THEY WERE OPENED
     *  UNDER. Audit item #55, and the same argument as `windowAnte` two fields up
     *  applied to the other two things a window's grading depends on.
     *
     *  APPENDED AFTER `genesisTreasury`, NOT NEXT TO `windowAnte` where they read
     *  better. `genesisTreasury` is already recorded at slot 38 in `STORAGE.md` and is
     *  already deployed; inserting these before it would shift it to 39 and every
     *  existing organism's `entrant` would be read out of the wrong slot. Layout order
     *  is append-only and it outranks readability — which is what this note is for.
     *
     *  Appended 2026-09-06, ONE slot out of `__gap` (shrunk 8 -> 7): slot 39 holds both,
     *  `windowVenue` at offset 0 and `windowRakeBps` at offset 20, 22 of 32 bytes used.
     *  The ten spare bytes STAY spare, same rule as slots 13, 18, 21, 23, 26 and 38.
     *
     *  Declaring two fields into ONE FRESH slot is allowed, and is what the season group
     *  on slot 33 already does; what `CLAUDE.md` forbids is packing into a slot an
     *  earlier deploy already wrote. These two are appended in the same commit and
     *  neither exists on chain yet, so the slot is theirs from the start and there is no
     *  live layout to collide with. They are also the natural pair: both are written by
     *  adjacent statements in `think()` and read by adjacent statements in `settleAll()`,
     *  so a reader who finds one has found both.
     *
     *  WHAT GOES WRONG WITHOUT THEM. `setWiring` repoints `venue` with no phase guard
     *  and `setSeason` moves `rakeBps`, both `onlyOwner`, both callable between
     *  `think()` and `settleAll()`:
     *
     *    - A window opened on venue A and settled against venue B asks B to redeem a
     *      position it never issued. `DreamDEXVenue.redeemFor` reverts (`poolOf` is
     *      empty for that id), so `settleAll`'s catch fires `SettleFailed` for EVERY
     *      organism, nobody is graded, and each `Prophet` keeps `positionOpen` — which
     *      `commitAll` then skips, so the population sits out the FOLLOWING window too.
     *      On `DirectDuelVenue`, where the escrow is real collateral held between open
     *      and redemption, the ante is unrecoverable by anyone: redemption is
     *      holder-only and `Prophet` exposes no arbitrary call.
     *    - A rake moved mid-window taxes winnings at a rate that did not exist when the
     *      position was opened. Smaller in consequence, identical in kind, and the one
     *      an operator could trip accidentally by recalibrating a season between two
     *      phases of the same window.
     *
     *  `collateral` IS DELIBERATELY NOT SNAPSHOT, and the audit is wrong to ask for it:
     *  there is no setter for it anywhere. It is written once, in `initialize`, and
     *  `setWiring` does not touch it. A snapshot of a field nothing can move is a slot
     *  spent on decoration, and it would imply a repointing hazard that does not exist.
     *  If a `collateral` setter is ever added, this is the note that says a third
     *  snapshot field has to be added with it.
     *
     *  BOTH ARE CONSUMED, which is the difference between a snapshot and an ornament:
     *  `windowVenue` is read by `executePair` (issuance) and `settleAll` (redemption),
     *  which must name the same contract or the mismatch has merely moved; `windowRakeBps`
     *  is read by `settleAll` and passed to `Prophet.settleWindow`. Nothing else reads
     *  either — `enter`, the scripts and the frontend keep reading the LIVE `venue`,
     *  because they describe the current arena rather than a window in flight, exactly
     *  as `ante()` does alongside `windowAnte`.
     *
     *  THE ZERO FALLBACKS COVER THE FIRST WINDOW AND ONLY THAT. Both fields are zero on
     *  a fresh deploy and on a proxy upgraded from a build that predates them, so
     *  `settleAll` and `executePair` fall back to the live values — which is correct in
     *  both cases: on a fresh deploy `think()` writes them before any position can
     *  exist, and on a mid-window upgrade the live values are what that window was
     *  actually opened under. `windowRakeBps == 0` is indistinguishable from a
     *  deliberate zero rake, and that is the right way round: a window that settles
     *  with no skim is a revenue miss, while one that reverts strands every ante.
     */
    address public windowVenue;
    uint16 public windowRakeBps;

    uint256[7] private __gap;

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
    /// @dev A breeding request declined because this organism already has one out.
    ///      Its own line rather than a reuse of `BreedingUnaffordable`, because the
    ///      two say opposite things about the organism: unaffordable is a wallet
    ///      problem, this is a request that is already paid for and still in flight.
    ///      `requestId` is the SURVIVING request, so a log reader can pair this with
    ///      the `BreedingRequested` it defers to. Emitted rather than reverted on the
    ///      `settleAll` path — see `_requestMutation`.
    event MutationAlreadyInFlight(uint256 indexed prophetId, uint256 requestId);
    /// @dev Bred on merit, could not afford the thought. Not a failure — the
    ///      organism keeps its streak and its surplus, and may breed in a later
    ///      window once someone tops its cognition up.
    event BreedingUnaffordable(uint256 indexed prophetId);
    /// @dev A mutated genome that had landed and could not be born, because the parent
    ///      no longer held a full `endowment` in collateral when `hatchAll` reached it.
    ///      Audit item #34. Distinct from `BreedingUnaffordable`, which fires BEFORE the
    ///      inference is paid for: this one fires after a real three-validator mutation
    ///      has already been bought and delivered, so it is the more expensive failure
    ///      and the only one that loses a genome. The genome is NOT logged — it is
    ///      already in the organism's own `MutationReceived`, and repeating a
    ///      model-authored string here would put unbounded calldata in a loop that runs
    ///      once per living organism. `held` is what the parent actually had, so the
    ///      shortfall is readable against `endowment`.
    event BirthUnaffordable(uint256 indexed parentId, uint256 held, uint256 needed);
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
    /// @dev A corpse's remaining collateral, moved out of the organism and into the
    ///      prize pool. Emitted from the reaping branch of `settleAll`, so a
    ///      `Reaped` without one of these means the organism died with nothing left.
    event ResidueForfeited(uint256 indexed prophetId, uint256 amount);
    /// @dev A starved organism whose residue could not be moved, so the reap was
    ///      DEFERRED rather than completed — the organism is still alive, still in
    ///      `living`, and `settleAll` will try again next window. Audit item #43. The
    ///      only way to reach it is a collateral token that refuses a transfer (paused,
    ///      or the arena blacklisted), which is why this is an event rather than a
    ///      revert: one such organism must not stop the cadence for the population.
    event ReapDeferred(uint256 indexed prophetId, uint256 residue);
    /// @dev `pot` is what the season had accumulated; `paid` is what the standings
    ///      actually claimed. The difference rolls into the next season rather than
    ///      being swept — an arena with fewer than three living organisms must not
    ///      quietly hand the shortfall to the house.
    event SeasonEnded(uint32 indexed season, uint256 pot, uint256 paid);
    event SeasonPrizePaid(uint32 indexed season, uint256 indexed prophetId, address indexed to, uint256 amount);
    event RakeWithdrawn(address indexed to, uint256 amount);
    /// @dev The arena created its own treasury. Emitted once, ever.
    event GenesisTreasuryDeployed(address indexed treasury);
    /// @dev Collateral entering the players' book from outside. `rakeAccrued` is
    ///      untouched, so this can never run in reverse.
    event PrizePoolFunded(address indexed from, uint256 amount);

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
    /// @dev The second entry floor. `minEndowment` is a fixed number and the ante
    ///      doubles every level, so a late entrant paying the fixed minimum could
    ///      fund one window and be dead before the next.
    error EndowmentBelowAnte(uint256 supplied, uint256 required);
    /// @dev `withdrawRake` may only ever draw against the house's own book. The
    ///      float, the endowments and the prize pool share this balance.
    error RakeExceeded();
    /// @dev A metabolism at or above the endowment kills every organism at its first
    ///      settlement, and death has no counterpart. Arguments 1 and 2 of
    ///      `setEconomics` are adjacent same-unit `uint256`s whose defaults differ by
    ///      200x, so this is mostly a transposition guard. See `setEconomics`.
    error MetabolismAboveEndowment(uint256 metabolicCost, uint256 endowment);
    error SeasonNotOver();
    /// @dev A season whose parameters would brick the arena — a zero `levelWindows`
    ///      divides by zero in `level()`, a `prizeShareBps` above 100% underflows
    ///      `_book`, and an `anteMultBps` below 100% makes the climate get EASIER.
    error BadSeason();
    /// @dev `spawnGenesis` before `deployGenesisTreasury`. Refused rather than
    ///      defaulted, because a founder minted against `address(0)` would be
    ///      permanently ownerless and permanently unretirable.
    error NoGenesisTreasury();
    /// @dev `deployGenesisTreasury` is once-only. There is deliberately no setter, so
    ///      this is also what makes "the treasury can never become an EOA" checkable
    ///      without reading access control.
    error TreasuryAlreadySet();
    /// @dev `sweep` may not draw the collateral that `rakeAccrued` and `prizePool` are
    ///      claims on. There is no equivalent cap on the NATIVE leg, and that is a
    ///      limitation rather than a policy: some of this contract's native is owed to
    ///      organisms (`CognitionUnspent`) and nothing on chain separates it from the
    ///      birth float. See `sweep`.
    error BooksReserved();
    error ZeroAmount();
    /// @dev A `minStake` above the ante makes `_pair` refuse EVERY pairing: `_pair`
    ///      clamps to `windowAnte` and then opens two empty positions below
    ///      `minStake`, so the whole population forecasts, pays metabolism, and never
    ///      trades. Selection then grades nothing but abstentions and the arena
    ///      starves uniformly — which looks exactly like a broken price feed. Checked
    ///      in BOTH directions (`setEconomics` against `baseAnte`, `setSeason` against
    ///      `minStake`), because a one-sided guard is bypassed by setting the other.
    error StakeFloorAboveAnte(uint256 minStake, uint256 baseAnte);
    /// @dev A newborn endowed below the stake floor can never trade — the same
    ///      never-pairs outcome as `StakeFloorAboveAnte`, arrived at from the other
    ///      side, and worse because it is permanent for that organism rather than a
    ///      season parameter. `minEndowment` bounds what an ENTRANT must bring;
    ///      nothing bounded what the house hands a founder or a child.
    error EndowmentBelowStakeFloor(uint256 endowment, uint256 minStake);
    /// @dev `maxPopulation` is a gas bound, and two values break it rather than tune
    ///      it. Below `living.length` it freezes every birth while the incumbents are
    ///      alive — `hatchAll` breaks out of its loop — so the generation counter, the
    ///      headline metric of the run, stops. Below 2 it forbids a pairing outright,
    ///      since `_pair` needs two organisms holding opposing beliefs.
    error PopulationCapTooSmall(uint256 maxPopulation, uint256 living);
    /// @dev A `breedStreak` of zero makes `streak() >= breedStreak` true for every
    ///      organism at every settlement, so `settleAll` requests a mutation for the
    ///      whole surplus-holding population every window — each one a paid inference
    ///      drawn from the organism's own cognition — and `hatchAll` runs to
    ///      `maxPopulation` in a couple of windows. Breeding stops being a reward.
    error ZeroBreedStreak();
    /// @dev `_hatch` transfers exactly `endowment` from the parent, and eligibility is
    ///      `treasury >= endowment + (endowment * breedSurplusBps / 10_000)`. So the
    ///      surplus IS the parent's post-birth balance, and a surplus under one
    ///      metabolism charge means every successful breed kills the parent at the very
    ///      next settlement. Selection would then be against reproduction, which
    ///      inverts the thing this arena measures.
    error BreedSurplusBelowMetabolism(uint256 surplus, uint256 metabolicCost);
    /// @dev `spawnGenesis` against a house that cannot endow every founder's cognition.
    ///      `_houseCognition()` degrades to 0 rather than reverting, which is right for
    ///      a BIRTH but catastrophic for a GENESIS: without this check a deploy that
    ///      forgot the value mints all eight founders with zero native, no revert and
    ///      no `CognitionFunded` event, and the whole population is born brain-dead —
    ///      an entirely silent failure whose only symptom is that every organism
    ///      abstains forever. `got` is this contract's balance INCLUDING the
    ///      `msg.value` of this call, since `spawnGenesis` is payable and the deploy
    ///      seeds the float in the same transaction. See `spawnGenesis`.
    error HouseCannotEndowFounders(uint256 got, uint256 want);

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
        // birth when the payer cannot cover it — the house at genesis, the PARENT at
        // a hatch — and a sponsor can close the gap with `topUpCognition`. Override
        // per season with `setSeason`; a demo season can reasonably run it much lower.
        //
        // NOTE THIS IS NOW A BREEDING COST TOO. A parent needs this much native ON
        // TOP of the deposit for the mutation inference, or its child is born
        // brain-dead — so raising it makes reproduction meaningfully more expensive
        // in a way `breedSurplusBps`, which is denominated in collateral, cannot see.
        cognitionEndowment = 0.33 ether;

        // THE CLIMATE. `stakeBps` above is no longer read by anything — the ante
        // replaced `min(stakeOf(up), stakeOf(down))` — and survives only because
        // storage is append-only. Do not reintroduce a proportional stake.
        //
        // baseAnte == minStake, so at level 0 the ante sits exactly on the floor
        // below which `_pair` refuses to mint. Every organism risks 0.25 tUSDC of a
        // 10 tUSDC endowment, and capital buys windows rather than immunity.
        baseAnte = 250_000; // 0.25 tUSDC
        anteMultBps = 20_000; // doubles
        levelWindows = 4; // 1 h at the 15-minute cadence
        // 6 h. 24/4 = 6 levels, INDEXED 0 THROUGH 5, so the last level an organism
        // actually trades under is 5 and the season closes at a 32x ante (0.25 -> 8
        // tUSDC, against a 10 tUSDC endowment). Level 6 begins on window 24 — the
        // very window that first satisfies `endSeason`'s `>= seasonWindows` — so no
        // pairing is ever made at it unless the close is late.
        //
        // SHORT AND REPEATED IS THE PRODUCT, not a demo setting: four seasons a day,
        // and a share `endSeason` cannot pay rolls into a pot six hours away instead
        // of six days away. Eight levels at this cadence would close at a 32 tUSDC
        // ante against a 10 tUSDC endowment, and `_topThree` skips the dead.
        seasonWindows = 24;
        seasonStartWindow = 0;
        seasonId = 1;

        // 2.5% of a winner's PROFIT, of which 40% funds the prize pool and 60% is
        // the house's. Deliberately small: metered cognition is what is supposed to
        // be selecting, and `npm run fee` exists to prove the venue is not taking a
        // cut of its own. A rake large enough to matter would make this a casino
        // with an edge rather than an arena with a scoreboard.
        rakeBps = 250;
        prizeShareBps = 4_000;

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

    /**
     *  ONE OF THESE SEVEN CAN EMPTY THE ARENA IN A SINGLE WINDOW, and it is the
     *  second one.
     *
     *  `metabolicCost` is charged to every organism unconditionally at settlement,
     *  and `settleAll` reaps anything left holding less than it (`:1469`), so a value
     *  at or above `endowment` is not a mistuning — it is a kill switch. Every
     *  organism alive, plus every organism ever born afterwards, dies at its first
     *  settlement, and `Prophet.dead` has no counterpart anywhere in this codebase.
     *  A population wiped that way cannot be restored by setting the number back.
     *
     *  THE SHAPE OF THE MISTAKE IS THE REASON FOR THE CHECK. Arguments 1 and 2 are
     *  both bare `uint256` in the same units, adjacent, and the defaults differ by
     *  200x (`10_000_000` against `50_000` at `:408`) — so a transposed pair passes
     *  every type check the compiler has and reads plausibly in a calldata dump. It
     *  is also called from `contracts/script/`, edited by hand, at the highest-risk
     *  moment of a deploy.
     *
     *  BOUNDED AGAINST `endowment_`, NOT A CONSTANT, because the honest statement is
     *  relative: metabolism must be survivable for a newborn endowed this window. `<`
     *  rather than `<=` — equality means a newborn dies at its first settlement with
     *  no window in between, which is the same wipe one wei cheaper. This is a floor
     *  on survivability, not a claim that anything under it is well-tuned: a cost at
     *  90% of the endowment still kills almost everything, and that remains the
     *  operator's call.
     *
     *  FIVE MORE BOUNDS, ADDED BY AUDIT ITEM #29, and each one is the difference
     *  between a mistuned arena and one that cannot function at all. Every error
     *  carries the argument that justifies it at its declaration, so in order:
     *  `StakeFloorAboveAnte`, `EndowmentBelowStakeFloor`, `PopulationCapTooSmall`,
     *  `ZeroBreedStreak`, `BreedSurplusBelowMetabolism`. None of them is irreversible
     *  the way a fatal metabolism is — that is why this docblock still opens with the
     *  metabolism — but each of the five stops something the run is judged on: pairing,
     *  trading at all, births, breeding as a reward, and the parent surviving one.
     *
     *  THE FIRST NEEDS ITS OTHER HALF IN `setSeason`, and this is the part worth
     *  reading twice. `minStake <= baseAnte` here is bypassable in one transaction by
     *  lowering `baseAnte` afterwards, so `setSeason` carries the symmetric
     *  `baseAnte >= minStake`. A guard that either side can step around unaided is the
     *  decorative kind — it reports a clean bill on state it cannot actually constrain.
     *
     *  `stakeBps` IS DELIBERATELY LEFT UNBOUNDED, and that is a decision rather than
     *  the one omission nobody got to. It is VESTIGIAL: nothing reads it since the
     *  escalating ante replaced `min(stakeOf(up), stakeOf(down))` (see its declaration
     *  and `:444`), and it survives only because this layout is append-only. Every
     *  value of it is equally inert, so any bound on it — non-zero, under 10_000,
     *  anything — would constrain nothing on chain while reading in a diff as though
     *  the parameter still mattered. Bounding dead storage is exactly the check #29
     *  exists to prevent. Requiring it non-zero would also break the round-trip in the
     *  test helper, which reads all seven values back and writes them unchanged.
     */
    function setEconomics(
        uint256 endowment_,
        uint256 metabolicCost_,
        uint256 minStake_,
        uint16 stakeBps_,
        uint32 breedStreak_,
        uint16 breedSurplusBps_,
        uint16 maxPopulation_
    ) external onlyOwner {
        if (metabolicCost_ >= endowment_) revert MetabolismAboveEndowment(metabolicCost_, endowment_);

        // Read once. `baseAnte` is the level-0 ante by construction (`ante()` multiplies
        // up from it), so comparing against it rather than `ante()` bounds the CHEAPEST
        // window of a season instead of whichever one happens to be live.
        uint256 base = baseAnte;
        if (minStake_ > base) revert StakeFloorAboveAnte(minStake_, base);
        if (endowment_ < minStake_) revert EndowmentBelowStakeFloor(endowment_, minStake_);

        uint256 alive_ = living.length;
        // `living.length`, not `prophets.length`: the cap is a bound on the concurrent
        // population, and `prophets` is append-only. A floor of 2 regardless, because
        // one organism has nobody to disagree with.
        if (maxPopulation_ < 2 || maxPopulation_ < alive_) revert PopulationCapTooSmall(maxPopulation_, alive_);

        if (breedStreak_ == 0) revert ZeroBreedStreak();

        // The surplus a breeder keeps, computed exactly as `_breedThreshold` and
        // `_hatch` between them leave it: eligibility is `endowment + surplus` and the
        // birth costs `endowment`.
        uint256 surplus = (endowment_ * breedSurplusBps_) / 10_000;
        if (surplus < metabolicCost_) revert BreedSurplusBelowMetabolism(surplus, metabolicCost_);

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
    ///      transaction that creates them — the founders are the one house-funded
    ///      birth, so `_houseCognition()` reads this contract's balance, and without
    ///      the value attached here the first window would wait on a separate tx.
    ///      The founders' `entrant` is `genesisTreasury`, NOT `msg.sender`. A founder
    ///      that reached the top three used to pay 60% of the players' pot straight to
    ///      the operator's EOA, and it did so WITHOUT passing through `rakeAccrued` —
    ///      i.e. outside `withdrawRake`'s `RakeExceeded` cap. The eight founders are
    ///      the protocol's seed position, so their winnings go somewhere anyone can
    ///      audit and nobody can withdraw from. See `GenesisTreasury`.
    function spawnGenesis(string[] calldata genomes) external payable onlyOwner {
        if (genesisTreasury == address(0)) revert NoGenesisTreasury();

        // ONCE, UP FRONT, AGAINST THE TOTAL — never per founder inside the loop.
        // `_houseCognition()` reads the balance fresh on every iteration and that
        // balance FALLS by `cognitionEndowment` each time, so a per-founder check
        // would pass for founders 1..k and then revert on k+1 — except it would not
        // even revert, it would degrade to 0, which is the bug. And a per-founder
        // REVERT would be worse than either: the earlier `_spawn` calls have already
        // deployed proxies, pushed `living` and bumped `aliveCount`, and there is no
        // un-spawn (death is irreversible and nothing clears `dead`), so it would
        // leave a permanently half-seeded population. The whole call must be refused
        // or none of it.
        //
        // `address(this).balance` here already includes this call's `msg.value` —
        // that is the point of `payable`, and it is why the deploy can create and
        // fund the founders in one transaction.
        uint256 want = genomes.length * cognitionEndowment;
        if (address(this).balance < want) revert HouseCannotEndowFounders(address(this).balance, want);

        for (uint256 i; i < genomes.length; ++i) {
            // THE SLOAD STAYS IN THE LOOP. `_spawn`'s `id` is documented as
            // deliberately not a local because the Yul optimizer inlines `_spawn`
            // into this loop and the inlined body sits exactly one stack slot under
            // the limit; a cached `address` here is precisely that extra local. 100
            // gas warm per founder, eight times, once ever. Do not hoist it.
            _spawn(0, 0, genomes[i], genesisTreasury, endowment, address(this), _houseCognition());
        }
    }

    /**
     *  Create the treasury the founders pay. Once, ever.
     *
     *  A FACTORY RATHER THAN A SETTER, for three reasons that all outrank the extra
     *  bytecode:
     *
     *    - Provenance is on-chain. The arena created its own treasury, so it cannot
     *      be a wallet dressed up as one, and nobody has to take that on trust.
     *    - There is no setter to point at an EOA later. That removes a question a
     *      reader would otherwise have to answer by reading access control.
     *    - `contracts/script/` is edited by hand at deploy time, and a setter would
     *      mean pasting an address in at the single highest-risk moment of the run.
     *
     *  A setter would in any case not redirect existing founders: `entrant` is written
     *  exactly once ever, in `Prophet.initialize`. Its only effect would be on future
     *  `spawnGenesis` calls, which is one rug vector for no capability.
     */
    function deployGenesisTreasury() external onlyOwner returns (address t) {
        if (genesisTreasury != address(0)) revert TreasuryAlreadySet();
        t = address(new GenesisTreasury(address(this)));
        genesisTreasury = t;
        emit GenesisTreasuryDeployed(t);
    }

    /**
     *  What the HOUSE can afford to endow one newborn's thinking with.
     *
     *  `cognitionEndowment` or nothing, never a partial: a fraction of a deposit
     *  buys no inference at all, so a short house balance must produce an unfunded
     *  birth a sponsor can fix with `topUpCognition` rather than a birth that
     *  silently swallowed the float. Guarded rather than reverting because an
     *  underfunded house must still be able to bear children.
     *
     *  THE DEGRADE-TO-0 IS CORRECT HERE AND WRONG IN `spawnGenesis`, AND THAT
     *  ASYMMETRY IS DELIBERATE. Do not "unify" them.
     *
     *    - On the breeding path (`hatchAll` → `_hatch` → `_spawn`) refusing the birth
     *      would destroy lineage: the parent has already had its mutation inference
     *      paid for and delivered, `pendingChildPrompt` is the only copy of that
     *      genome, and a revert there costs a generation that cannot be recovered. A
     *      brain-dead child is recoverable by anyone via `topUpCognition`; an unborn
     *      one is not. (`_hatch` does not call this function at all — it passes what
     *      `drawCognition` returned — but the same reasoning is why THAT path also
     *      tolerates 0.)
     *    - On the genesis path there is no lineage to lose yet and the caller is the
     *      owner, in the deploy transaction, holding the value. Silence there means
     *      eight founders that abstain forever with nothing on chain saying why. So
     *      `spawnGenesis` checks the TOTAL up front and reverts
     *      `HouseCannotEndowFounders`, and this function is left alone.
     *
     *  ONLY `spawnGenesis` may call this. `_hatch` must not: the whole point of a
     *  parent-paid birth is that the value comes out of the parent, and a fallback to
     *  this would be invisible, because the subsidy would return to the very balance
     *  it was drawn from. `enter` must not either: its own `CognitionTooSmall` check
     *  has already proven the entrant's payment covers the floor, and this guard would
     *  let a solvent house quietly cover an entrant whose payment had fallen short.
     */
    function _houseCognition() internal view returns (uint256 c) {
        c = cognitionEndowment;
        if (address(this).balance < c) c = 0;
    }

    function _spawn(
        uint256 parentId,
        uint32 generation,
        string memory genome,
        address entrant,
        uint256 endow,
        address cognitionFrom,
        uint256 cognition
    ) internal returns (address p) {
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
        Prophet(payable(p))
            .initialize(address(this), prophets.length + 1, parentId, generation, windowCount, entrant, genome);
        prophets.push(p);
        living.push(prophets.length);
        livingIndex[prophets.length] = living.length;
        aliveCount += 1;

        // NO STANDING AUTHORITY IS TAKEN OVER A NEWBORN, and that is deliberate.
        // Until 2026-09-05 this line called `Prophet.grantPopulation`, which gave
        // this contract an infinite collateral allowance and ERC-6909 operator
        // rights over the organism. Neither was ever used — every value path into
        // this contract is a PUSH from the organism (`stakeOut` in `executePair`,
        // the metabolism transfer in `settleWindow`) and the ERC-6909 surface has
        // no `transferFrom` at all — while both were reachable by whatever this
        // upgradeable contract might later become. See the block where
        // `grantPopulation` used to be declared in `Prophet.sol`.

        // `endow` is a PARAMETER rather than a read of `endowment`, because the three
        // callers fund a birth differently: genesis spends the house's collateral,
        // `enter` has already pulled the entrant's own in, and `_hatch` has already
        // pulled the PARENT's in with `stakeOut`. Every caller must make sure this
        // contract holds the amount before it calls — that is what keeps genesis,
        // entry and breeding on one code path.
        if (endow > 0) {
            if (!IERC20Like(collateral).transfer(p, endow)) revert TransferFailed();
            Prophet(payable(p)).fund(endow);
        }

        // A newborn that cannot think is a newborn that abstains its way to death
        // without ever having had an opinion, so it is staked enough native to
        // start. WHO pays is the caller's decision and so is HOW MUCH, for the same
        // reason `endow` is a parameter: genesis and `enter` spend value that is
        // already in this contract's balance, while `_hatch` has drawn it out of the
        // parent first and passes back exactly what `drawCognition` RETURNED. It is
        // deliberately not `address(this).balance` here — reading the balance would
        // make a parent's draw and a house subsidy indistinguishable, because the
        // subsidy would come back out of the same balance it went into.
        //
        // `cognition == 0` is a valid, documented degraded state, not an error: an
        // underfunded house and a parent too poor to pay both bear the child anyway,
        // brain-dead until a sponsor calls `topUpCognition`.
        if (cognition > 0) {
            (bool ok,) = p.call{value: cognition}("");
            if (!ok) revert TransferFailed();
            emit CognitionFunded(prophets.length, cognitionFrom, cognition);
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
     *  `cognitionEndowment` of the operator's STT converted into LLM calls. Only the
     *  founders (`spawnGenesis`, owner-only) are house-funded, and they are not
     *  farmable. CHILDREN ARE NOT: `_hatch` draws a newborn's cognition out of the
     *  PARENT's own native balance, so a lineage pays for its descendants' thinking
     *  exactly as it pays for their wagers, and the house's bill does not grow with
     *  evolutionary success.
     */
    function enter(string calldata genome, uint256 endowmentAmount) external payable returns (uint256 prophetId) {
        if (endowmentAmount < minEndowment) revert EndowmentTooSmall();
        // FOUR ANTES, and the two floors are genuinely different checks: this one
        // tracks the climate and `minEndowment` does not. Four is the smallest
        // number that makes entering mid-season a wager rather than a formality —
        // an organism that can cover one ante is dead within two windows and its
        // entrant learns nothing about the genome they wrote. Grouped with the
        // collateral check ABOVE the native one on purpose, so no test has to
        // depend on guard ordering to see the error it is asserting.
        uint256 required = 4 * ante();
        if (endowmentAmount < required) revert EndowmentBelowAnte(endowmentAmount, required);
        if (msg.value < cognitionEndowment) revert CognitionTooSmall();
        if (!IERC20Like(collateral).transferFrom(msg.sender, address(this), endowmentAmount)) {
            revert TransferFailed();
        }

        // `msg.value` is already in this contract's balance and the check above
        // proved it covers the floor, so `_spawn` forwards `cognitionEndowment` out
        // of the entrant's own payment rather than out of the house float. Passed
        // UNCONDITIONALLY rather than through `_houseCognition()`, whose guard would
        // let a solvent house quietly cover an entrant whose payment had fallen
        // short. `from` stays `address(this)` — unchanged from before this commit,
        // though see the note on the event: the entrant is the real payer here and
        // the `extra` emit below already says so.
        _spawn(0, 0, genome, msg.sender, endowmentAmount, address(this), cognitionEndowment);
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

    /**
     *  A season, as one value.
     *
     *  Eight positional arguments would be eight chances to transpose two `uint16`s
     *  that the compiler cannot tell apart — `rakeBps` and `prizeShareBps` are both
     *  `uint16` and swapping them turns a 2.5% rake into a 40% one. A struct makes
     *  the call site name every field it sets. `Darwin.t.sol`'s `_season()` reads the
     *  live values into one of these so a caller can change ONE field and write it
     *  back without restating the other seven.
     */
    struct SeasonParams {
        uint256 minEndowment;
        uint256 cognitionEndowment;
        uint256 baseAnte;
        uint16 anteMultBps;
        uint32 levelWindows;
        uint32 seasonWindows;
        uint16 rakeBps;
        uint16 prizeShareBps;
    }

    /**
     *  Recalibrate the whole climate in one owner transaction, no upgrade.
     *
     *  Deliberately does NOT touch `seasonStartWindow` or `seasonId`: a season's
     *  clock is the players' and only `endSeason` may move it. An owner who could
     *  reset the clock could hold a season open until the standings suited them.
     *
     *  Three of these eight can brick the arena rather than merely mistune it — see
     *  `BadSeason` — and a fourth, `baseAnte`, is the other half of a bound that lives
     *  in `setEconomics`.
     */
    function setSeason(SeasonParams calldata s) external onlyOwner {
        if (s.levelWindows == 0 || s.seasonWindows == 0) revert BadSeason();
        if (s.anteMultBps < 10_000) revert BadSeason();
        if (s.rakeBps > 10_000 || s.prizeShareBps > 10_000) revert BadSeason();

        // THE SYMMETRIC HALF OF `setEconomics`'s `StakeFloorAboveAnte`, and without it
        // that guard is decorative: an owner who was refused a high `minStake` there
        // reaches the identical never-pairs state by lowering `baseAnte` here instead.
        // A season is not the place this is enforced — it is enforced in whichever call
        // last touched either number, which means both of them.
        uint256 floor_ = minStake;
        if (s.baseAnte < floor_) revert StakeFloorAboveAnte(floor_, s.baseAnte);

        minEndowment = s.minEndowment;
        cognitionEndowment = s.cognitionEndowment;
        baseAnte = s.baseAnte;
        anteMultBps = s.anteMultBps;
        levelWindows = s.levelWindows;
        seasonWindows = s.seasonWindows;
        rakeBps = s.rakeBps;
        prizeShareBps = s.prizeShareBps;
    }

    /*//////////////////////////////////////////////////////////////
                        THE CLIMATE — ANTE AND LEVEL
    //////////////////////////////////////////////////////////////*/

    /**
     *  How many times the ante has doubled since this season opened.
     *
     *  CAPPED AT 40. `2**40` of a 0.25 tUSDC base is already 275 billion tUSDC, so
     *  the cap costs nothing any real season can reach — while an uncapped exponent
     *  would overflow `ante()` after ~78 doublings and revert every pairing, every
     *  entry and every settlement in a population nobody could rescue without an
     *  upgrade. The bound also keeps `ante()`'s loop bounded for the gas estimator.
     */
    function level() public view returns (uint32) {
        uint32 lw = levelWindows;
        // A proxy upgraded from a build that predates these fields would divide by
        // zero here and brick every window. Cheap insurance for a one-line guard.
        if (lw == 0) return 0;

        uint64 start = seasonStartWindow;
        uint64 w = windowCount;
        if (w <= start) return 0;

        uint256 l = (w - start) / lw;
        // casting to 'uint32' is safe because the ternary has already clamped `l` to
        // 40 on this branch, and the cap is the whole point of the line above.
        // forge-lint: disable-next-line(unsafe-typecast)
        return l > 40 ? 40 : uint32(l);
    }

    /// @dev What every organism risks this window, identical for all of them. The
    ///      loop rather than an exponentiation because `anteMultBps` is a rate in
    ///      basis points and a bps power has to round at every step to stay honest;
    ///      `level()` bounds it at 40 iterations.
    function ante() public view returns (uint256 a) {
        a = baseAnte;
        uint256 l = level();
        for (uint256 i; i < l; ++i) {
            a = (a * anteMultBps) / 10_000;
        }
    }

    /*//////////////////////////////////////////////////////////////
                        THE TWO BOOKS — RAKE AND POOL
    //////////////////////////////////////////////////////////////*/

    /**
     *  Split a window's income between the players' pot and the house's.
     *
     *  The collateral is already here — `Prophet.settleWindow` transferred both the
     *  rent and the skim before returning them — so this moves no tokens and only
     *  decides which book claims them. That is why it is safe to call inside
     *  `settleAll`'s per-organism loop: it cannot fail on a transfer and cannot
     *  leave the two books disagreeing with the balance.
     */
    function _book(uint256 income) internal {
        if (income == 0) return;
        uint256 toPool = (income * prizeShareBps) / 10_000;
        prizePool += toPool;
        rakeAccrued += income - toPool;
    }

    /// @dev The house's book, and only the house's book. Reverts rather than
    ///      clamping: an owner who asked for more than they earned has made an
    ///      accounting error, and silently paying them less hides it.
    function withdrawRake(address to, uint256 amount) external onlyOwner {
        if (amount > rakeAccrued) revert RakeExceeded();
        rakeAccrued -= amount;
        if (!IERC20Like(collateral).transfer(to, amount)) revert TransferFailed();
        emit RakeWithdrawn(to, amount);
    }

    /**
     *  Add collateral to the players' prize pool. The only inbound path there is.
     *
     *  Placed next to `withdrawRake` so the two books stay adjacent and a reader sees
     *  both directions at once. Before this, `prizePool` had four write sites and no
     *  funding path at all; this is the first inbound one.
     *
     *  `rakeAccrued` is untouched, so this can never become a house withdrawal in
     *  reverse. Permissionless, because a pot anyone may add to is not a pot anyone
     *  may take from: `prizePool` is spent only by `endSeason`, and after `sweep`'s
     *  collateral cap it is not reachable by the owner either. Griefing by inflating
     *  a number that only pays the top three living organisms is not griefing.
     *
     *  `prizePool` is incremented by exactly the amount transferred in, in the same
     *  call and after the transfer, so `balance >= rakeAccrued + prizePool` holds.
     */
    function donatePrizePool(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!IERC20Like(collateral).transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }
        prizePool += amount;
        emit PrizePoolFunded(msg.sender, amount);
    }

    /**
     *  Close the season and open the next.
     *
     *  Permissionless once the season is over, so a season cannot be held open by
     *  an absent owner. The payout is a promise made to entrants at the door, and a
     *  promise that only pays while we are awake to authorise it is not one.
     *
     *  Pays 60/30/10 of the pool to the top three SURVIVING organisms by NET
     *  correct calls, to each one's entrant. Net rather than gross because gross
     *  rewards volume: an organism that called thirty windows and got sixteen right
     *  is not a better forecaster than one that called twelve and got eleven, and
     *  the arena's claim is forecasting rather than participation.
     *
     *  Survival is a condition, not a tiebreak. A corpse's collateral was forfeited
     *  into this very pool by `settleAll`, so paying its entrant out of the pool
     *  would refund the forfeit and make starvation free.
     *
     *  What the standings do not claim ROLLS INTO THE NEXT SEASON — an arena with
     *  fewer than three survivors, or whose winner has no entrant to pay, must not
     *  hand the shortfall to the house. The alternative gives the operator a
     *  financial reason to prefer mass extinction, which is the one incentive an
     *  evolutionary arena cannot afford to have.
     */
    function endSeason() external {
        if (windowCount - seasonStartWindow < seasonWindows) revert SeasonNotOver();

        uint256[3] memory bestId = _topThree();

        // Read once: every place below must divide the SAME pot, or third place's
        // share is computed against a pool the first two have already been paid
        // out of, and the three shares no longer sum to the pot.
        uint256 pot = prizePool;
        uint16[3] memory splitBps = [uint16(6_000), 3_000, 1_000];
        uint256 paid;

        for (uint256 k; k < 3; ++k) {
            if (bestId[k] == 0) continue;
            uint256 cut = (pot * splitBps[k]) / 10_000;
            if (cut == 0) continue;

            // `to == address(0)` is not reachable for any organism minted by
            // `spawnGenesis` or `enter` — founders pay `genesisTreasury` and entrants
            // pay themselves, and `_hatch` propagates the parent's entrant. The guard
            // stays because `endSeason` must not be able to REVERT on a single
            // unpayable winner: a share it cannot deliver rolls into the next
            // season's pot, which at a 24-window season is six hours away.
            //
            // This comment used to claim "a founder has no entrant". That was false
            // from the day `spawnGenesis` was written — it passed `msg.sender` — which
            // is exactly the bug `genesisTreasury` fixes.
            address to = Prophet(payable(prophetAt(bestId[k]))).entrant();
            if (to == address(0)) continue;

            if (!IERC20Like(collateral).transfer(to, cut)) revert TransferFailed();
            paid += cut;
            emit SeasonPrizePaid(seasonId, bestId[k], to, cut);
        }

        prizePool = pot - paid;

        // The new season starts HERE, not at `seasonStartWindow + seasonWindows`:
        // nobody is obliged to close a season on the exact window it ends, and
        // dating the next one from a window already past would shorten it by
        // however late the close was — far enough late, it would open already over.
        seasonStartWindow = windowCount;
        emit SeasonEnded(seasonId, pot, paid);
        seasonId += 1;
    }

    /**
     *  The standings: the three living organisms with the best net record.
     *
     *  Walks the LINEAGE rather than `living`. A season close is not a per-window
     *  cost, and the dead have to be skipped either way — `living` exists to bound
     *  the gas of the three functions that run inside the reactivity callback, and
     *  this is not one of them.
     *
     *  Split out of `endSeason` rather than inlined: the search alone holds two
     *  fixed-size arrays and a signed score, and `--via-ir` is already at its stack
     *  limit in this contract (see `think`'s scoped block). Zero in a slot means
     *  "nothing placed here", which is sound only because ids are 1-based.
     */
    function _topThree() internal view returns (uint256[3] memory bestId) {
        int256[3] memory bestScore;
        bestScore[0] = type(int256).min;
        bestScore[1] = type(int256).min;
        bestScore[2] = type(int256).min;

        uint256 n = prophets.length;
        for (uint256 i; i < n; ++i) {
            Prophet p = Prophet(payable(prophets[i]));
            if (p.dead()) continue;

            // Signed on purpose: an organism can be net-wrong, and clamping that to
            // zero would make it indistinguishable from one that never called.
            int256 score = int256(uint256(p.correctCount())) - int256(uint256(p.wrongCount()));

            if (score > bestScore[0]) {
                bestScore[2] = bestScore[1];
                bestId[2] = bestId[1];
                bestScore[1] = bestScore[0];
                bestId[1] = bestId[0];
                bestScore[0] = score;
                bestId[0] = p.prophetId();
            } else if (score > bestScore[1]) {
                bestScore[2] = bestScore[1];
                bestId[2] = bestId[1];
                bestScore[1] = score;
                bestId[1] = p.prophetId();
            } else if (score > bestScore[2]) {
                bestScore[2] = score;
                bestId[2] = p.prophetId();
            }
        }
    }

    /**
     *  Leave the arena and take what the organism still holds.
     *
     *  Rent already charged and antes already lost stay lost — this is an exit,
     *  not a refund. What it guarantees is that the *remaining* stake belongs to
     *  whoever put it in, which is what makes entering a wager rather than a
     *  donation.
     *
     *  THE ANTI-RAGE-QUIT GATE IS `phase == 0`, AND THE DOCBLOCK HERE USED TO SAY IT
     *  WAS `positionOpen`. That was false, and false in the direction that matters —
     *  audit items #20 and #40.
     *
     *  `positionOpen` is true from `commitAll` until `settleAll`, so it does close
     *  phase 2: an entrant cannot watch a market move against their organism and pull
     *  the stake out from under the counterparty it is already paired 1:1 with. What it
     *  does not close is PHASE 1 — after `think()` has opened the window and paid for
     *  the inference, before `commitAll()` has risked anything. The belief callback
     *  lands during phase 1, so in that interval the entrant can READ `belief` and
     *  `lastThesis` off their own organism and then leave, and leaving there costs
     *  nothing at all: metabolism is charged inside `settleWindow`, and `settleAll`
     *  skips anything whose position is not open. So the window's rent was never paid
     *  for a window the organism did think in, and the entrant walked away with the
     *  whole treasury after seeing the forecast. That is a free option on every window,
     *  granted to exactly the party the 1:1 pairing is supposed to bind.
     *
     *  So the guard is `inPhase(0)`: leaving is a BETWEEN-WINDOWS action, which is what
     *  the old comment already claimed ("between windows, leaving is free") without the
     *  code enforcing it. `positionOpen` stays below as the backstop, because it is the
     *  check that lives on the organism actually holding the position and it still
     *  catches the one case the phase cannot — an organism whose `settleWindow` reverted
     *  and whose position is therefore open while the phase has already returned to 0.
     *
     *  The cost is a liveness one and it is accepted deliberately: a driver that stops
     *  mid-cadence leaves entrants unable to exit until the phase moves. That is the
     *  same exposure a stopped driver already creates for everything else in the window
     *  path, `forcePhase` is `onlyOwner` and exists precisely as that remedy, and the
     *  alternative — a per-organism "has it thought this window" flag — is a new storage
     *  slot on the eve of a freeze to express something the phase already knows.
     *
     *  An organism nobody wants to keep funding should stop costing its entrant money,
     *  and between windows it still can.
     *
     *  BOTH currencies come back, because the entrant put both in. Returning the
     *  collateral while stranding the unspent cognition in a dead organism would
     *  make this a partial exit and quietly turn `enter`'s native requirement into
     *  a one-way ratchet on the entrant's STT.
     */
    function retire(uint256 prophetId) external inPhase(0) {
        Prophet p = Prophet(payable(prophetAt(prophetId)));
        if (msg.sender != p.entrant()) revert NotEntrant();
        if (p.dead()) revert ProphetIsDead();
        // The backstop, not the gate — see the docblock. Reachable in phase 0 only for
        // an organism whose settlement reverted, which is exactly the case the phase
        // check cannot see.
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

        // FREEZE THE PRICE OF THIS WINDOW. Set here rather than read live in `_pair`
        // because `windowCount` has just advanced, so this is the first instant at which
        // `ante()` describes the window the organisms are about to be asked about — and
        // it is the last instant at which nobody else can change the answer. See
        // `windowAnte`'s declaration for what could move it and why a phase guard on
        // `endSeason` would be the wrong way to stop them.
        //
        // Outside the scoped block above on purpose: that block runs within one stack
        // slot of the limit and the comment at the top of this function is not
        // decoration. Nothing here needs its locals.
        windowAnte = ante();

        // AND THE VENUE AND RAKE THIS WINDOW IS BEING OPENED UNDER. Same instant, same
        // reason: this is the last moment at which nobody else can change the answer.
        // `setWiring` can repoint `venue` and `setSeason` can move `rakeBps` between
        // here and `settleAll`, and an organism graded against a venue that never
        // issued its position is not graded at all. See the fields' declaration.
        //
        // One SSTORE for the pair, because they share slot 39 — which is also why
        // adding this costs `think()` one warm slot write rather than two, and why it
        // is safe in a function that sits within one stack slot of the --via-ir limit:
        // no new locals.
        windowVenue = venue;
        windowRakeBps = rakeBps;

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
            ) returns (
                uint256 requestId
            ) {
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

            // A POSITION THAT IS STILL OPEN IS NOT OURS TO COMMIT OVER.
            //
            // In normal operation this is never true here: `settleAll` clears
            // `positionOpen` for everyone before returning the phase to 0. It becomes
            // true only when an organism's settlement REVERTED — `Prophet.settleWindow`
            // clears the flag in its first statement, so a revert below unwinds that
            // write too, and `settleAll` catches the revert and emits `SettleFailed`
            // rather than halting the population.
            //
            // Skipping is what makes that failure recoverable instead of expensive.
            // `Prophet.noteCommitted` overwrites `currentOutcomeId`, and `settleWindow`
            // only ever redeems `currentOutcomeId` — so committing over a stale position
            // would leave the ante escrowed against an id that the only contract
            // permitted to redeem it no longer knows. For `DirectDuelVenue`, where the
            // escrow is real collateral held between open and redemption, that is
            // unrecoverable by anyone: redemption is holder-only and `Prophet` exposes no
            // arbitrary call. Skipped instead, the organism keeps its open position and
            // the NEXT `settleAll` retries it, which costs it a window of grading and
            // recovers the whole ante.
            //
            // The guard cannot live in `noteCommitted`, which is where it belongs
            // logically: `_pair`'s catch calls `_openEmpty` — and therefore
            // `noteCommitted` — so a revert there would be raised a second time from
            // inside the handler for the first one, with no boundary left to catch it.
            // A one-organism fault would take down every commitment in the window.
            if (p.positionOpen()) continue;

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

    /**
     *  Issue one pair at the ante.
     *
     *  FLAT, NOT PROPORTIONAL. This used to be `min(_stakeOf(up), _stakeOf(down))` —
     *  ten percent of each treasury — and that rule let capital buy immortality: a
     *  1,000 tUSDC organism against 10 tUSDC opponents risked ~1 tUSDC per window
     *  against 0.05 of rent, so it survived hundreds of windows while losing EVERY
     *  call, and its genome's terrible record cost it nothing. A flat ante is the
     *  same number for everybody at a given level, so a larger treasury buys more
     *  windows of being wrong and nothing else.
     */
    function _pair(Prophet up, Prophet down) internal {
        // THE WINDOW'S OWN ANTE, not the current one. `think` froze it when the window
        // opened; reading `ante()` here instead would let anything that moved
        // `seasonStartWindow` or the season parameters in between re-price a forecast
        // that has already been made. The zero fallback is the same cheap insurance
        // `level()` carries for `levelWindows`: a proxy upgraded from a build that
        // predates this field has no snapshot for the window already in flight, and one
        // window priced live is a better outcome than a whole population staking zero.
        uint256 want = windowAnte;
        if (want == 0) want = ante();

        // The ante is flat but it is not conjured: each side pays out of its own
        // treasury and `stakeOut` clamps to what is there. Clamping HERE keeps the
        // two legs equal — unequal legs would mint a set nobody can redeem 1:1 —
        // and an organism too poor to cover the ante is one metabolism charge from
        // death anyway, which is the intended way for a losing genome to exit.
        uint256 have = up.treasury();
        if (have < want) want = have;
        have = down.treasury();
        if (have < want) want = have;

        if (want < minStake) {
            _openEmpty(up, activeUpId);
            _openEmpty(down, activeDownId);
            return;
        }

        try this.executePair(up, down, want) {
        // handled in executePair
        }
        catch {
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
        //
        // Checked, like the transfers around it. This one is the mildest of the
        // three unchecked bools cleaned up on 2026-09-05 — a `false` here means
        // `openOpposing` reverts on its own `transferFrom` and `_pair`'s catch
        // opens two empty positions, which is a correct outcome reported under the
        // wrong name (`CommitFailed` on the organisms rather than a token failure).
        // THE WINDOW'S OWN VENUE HERE TOO, and this is the leg that actually matters:
        // `settleAll` reading the snapshot while THIS read the live value would move
        // the mismatch rather than remove it — positions issued by the new venue,
        // redeemed against the old one. Issuance and redemption have to name the same
        // contract, so both read the same field, with the same zero fallback for a
        // proxy upgraded mid-window.
        address v = windowVenue;
        if (v == address(0)) v = venue;
        if (!IERC20Like(collateral).approve(v, amount)) revert TransferFailed();
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
        // THE WINDOW'S OWN VENUE AND RAKE, not the current ones. `think` froze both
        // when the window opened, and grading a position against a venue that never
        // issued it is not grading — see the fields' declaration for what
        // `setWiring`/`setSeason` can do in between, and why a phase guard is not the
        // answer.
        //
        // The zero fallbacks are the same insurance `_pair` carries for `windowAnte`: a
        // proxy upgraded mid-window from a build that predates these fields has no
        // snapshot for the window in flight. `windowRakeBps == 0` is indistinguishable
        // from a deliberate zero rake, and that is the right way round — a window that
        // settles with no skim is a revenue miss, while one that reverts strands every
        // ante. Both fallbacks stop mattering after the first `think()` on any deploy.
        address v = windowVenue;
        if (v == address(0)) v = venue;
        uint16 rake = windowRakeBps;
        if (rake == 0) rake = rakeBps;

        // BACKWARDS ON PURPOSE. This is the one loop that removes elements while
        // walking, and `_removeLiving` swap-removes: the hole is filled from the
        // END. Forwards, that element is one this loop has not reached yet and
        // would now skip — an organism silently unsettled, its position left open,
        // never graded, and no event to say so. Backwards, the element moved in has
        // already been processed. Do not "tidy" this into a forward loop.
        for (uint256 i = living.length; i > 0; --i) {
            Prophet p = Prophet(payable(prophets[living[i - 1] - 1]));
            if (p.dead() || !p.positionOpen()) continue;

            try p.settleWindow(v, collateral, metabolicCost, rake) returns (
                uint256, bool starved, uint256 charged, uint256 raked
            ) {
                // Both amounts are already in this contract — the organism moved
                // them before returning — so this only decides which book claims
                // them. It must happen for every organism, including one that dies
                // in the same breath: the rent was paid, and rent is income.
                _book(charged + raked);

                // DEATH: it can no longer afford to think. Not a health bar
                // reaching zero — an organism that cannot pay for cognition in a
                // world where cognition is metered is simply over.
                if (starved || p.treasury() < metabolicCost) {
                    // FORFEIT THE RESIDUE BEFORE `die()`, not after. `stakeOut`
                    // carries the `alive` modifier, so a corpse can never be
                    // emptied — collateral left in one is stranded for the lifetime
                    // of the deploy, claimed by a ledger nobody can spend against.
                    // It goes to the PLAYERS rather than the house: the pot is what
                    // the survivors are competing for, and a house that profits
                    // directly from each death has an incentive nobody should have
                    // to trust it to ignore.
                    // WRAPPED, AND THE WRAP IS THE SAME SOLIDITY FACT AS #56. Audit
                    // item #43. Everything in this block runs in the SUCCESS BODY of
                    // the `try` above, and a revert in a success body is not routed
                    // into that `try`'s `catch` — it propagates. So a `stakeOut` that
                    // reverted here took down the whole of `settleAll` for the entire
                    // population and left `phase` wedged at 2 until the owner called
                    // `forcePhase`, exactly as `noteMutating` used to.
                    //
                    // `stakeOut` reverts `TransferFailed` when the collateral token
                    // refuses the transfer, which for tUSDC means paused or the arena
                    // blacklisted. That is not a hypothetical for an ERC-20 nobody in
                    // this system controls, and it is precisely the moment the cadence
                    // must keep running: the organism is dead broke either way.
                    //
                    // On failure the reap is DEFERRED, not faked. The organism stays
                    // alive, stays in `living`, keeps its open position closed by
                    // `settleWindow`, and is re-tested next window — so `aliveCount`
                    // never drifts from `living.length`, which is the invariant the
                    // whole living/lineage split rests on. `die()` is NOT called
                    // outside the wrap for the same reason: a corpse's `stakeOut`
                    // reverts `IsDead()`, so killing it after a failed drain would
                    // strand the residue permanently, which is the trap `retire` and
                    // the residue ordering are both written against.
                    uint256 residue = p.treasury();
                    if (residue > 0) {
                        try p.stakeOut(address(this), residue, collateral) returns (uint256 moved) {
                            prizePool += moved;
                            emit ResidueForfeited(p.prophetId(), residue);
                        } catch {
                            emit ReapDeferred(p.prophetId(), residue);
                            continue;
                        }
                    }

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
        // BEFORE THE DEPOSIT, AND IT IS A RETURN RATHER THAN A REVERT. Audit item #56.
        //
        // `Prophet.noteMutating` reverts `MutationInFlight` on a duplicate, and that
        // call sits at the BOTTOM of this function — inside the `try` around
        // `createAdvancedRequest`, but the `try` in `settleAll` is the one that
        // matters. A revert raised in a `try`'s SUCCESS BODY is not routed into that
        // `try`'s `catch`, so a duplicate reaching `noteMutating` from `settleAll`
        // reverted the entire window and left `phase` at 2 until the owner called
        // `forcePhase`. `breedProphet` is permissionless and moves neither `streak`
        // nor `treasury`, so any address could arm that wedge on any eligible leader.
        //
        // Checked here rather than only in `breedProphet` because `settleAll` reaches
        // this function on its own the very next window: the parent still qualifies
        // while its first inference is out, so the population would wedge itself with
        // no griefer involved at all.
        uint256 inFlight = p.pendingMutationRequestId();
        if (inFlight != 0) {
            emit MutationAlreadyInFlight(p.prophetId(), inFlight);
            return;
        }

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
        ) returns (
            uint256 requestId
        ) {
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
        // AFFORDABILITY IS CHECKED BEFORE THE GENOME IS CONSUMED. Audit item #34.
        //
        // `consumeChildPrompt()` DELETES `pendingChildPrompt` — that is the whole point
        // of it, so a genome cannot be born twice. The order below used to be the other
        // way round: consume first, then discover the parent could not pay, then refund
        // the collateral and return. The refund made the money whole and said nothing
        // about the genome, which was already gone. A real three-validator mutation the
        // parent had PAID FOR was destroyed, silently, and the only recovery was to earn
        // another breeding streak and pay for another inference — while `BreedingRequested`
        // sat in the log with no `Spawned` and no failure line anywhere to pair it with.
        //
        // The parent's treasury can genuinely fall between `_requestMutation` and here:
        // `settleAll` breeds on the streak and charges metabolism in the same call, and
        // `hatchAll` is a separate transaction that may be one or more windows later, so
        // an eligible parent can lose a pairing and drop under `endowment` in between.
        // This is a real path, not a defensive one.
        //
        // Read rather than attempted: `stakeOut` clamps to the treasury and reports what
        // it moved, so the old code learned the answer only by taking the money first.
        // A `treasury()` read costs one staticcall and leaves the genome where it is,
        // which means an under-funded parent keeps its child pending and can be topped
        // up by `fundProphet` and hatched in a later `hatchAll` — the outcome the refund
        // branch was reaching for and could not deliver once the prompt was deleted.
        uint256 held = parent.treasury();
        if (held < endowment) {
            emit BirthUnaffordable(parent.prophetId(), held, endowment);
            return;
        }

        string memory childGenome = parent.consumeChildPrompt();
        if (bytes(childGenome).length == 0) return;

        // Reproduction is expensive, as it should be: the parent funds the child
        // out of its own treasury. A survivor that breeds is deliberately more
        // fragile immediately afterwards.
        //
        // The short-draw branch is KEPT rather than removed as unreachable. The read
        // above and this draw are two separate calls into the parent, and treating a
        // clamped `stakeOut` as impossible because a view said otherwise is exactly the
        // reasoning this codebase does not do. It is now genuinely defensive, and the
        // refund still restores the collateral — but the genome is consumed by this
        // point, so if it ever fires it fires as `BirthUnaffordable` too, and a reader
        // seeing that event WITHOUT a preceding `BreedingRequested` for a later window
        // is looking at a `stakeOut` that disagreed with `treasury()`.
        uint256 taken = parent.stakeOut(address(this), endowment, collateral);
        if (taken < endowment) {
            // Could not actually afford it after all; return the collateral.
            if (taken > 0) {
                if (!IERC20Like(collateral).transfer(address(parent), taken)) revert TransferFailed();
                parent.fund(taken);
            }
            emit BirthUnaffordable(parent.prophetId(), taken, endowment);
            return;
        }

        // BOTH currencies come from the parent, not just the collateral. The child's
        // first ten windows of thinking are drawn out of the parent's own native
        // balance, so a lineage pays for its descendants' cognition exactly as it
        // pays for their wagers — otherwise the house's recurring bill grows with
        // evolutionary success, which is the one dynamic this economy cannot have.
        //
        // `drawCognition` is ALL OR NOTHING (see Prophet.sol) and reports failure as
        // a 0 return, never a revert, so the value passed on is what ACTUALLY
        // arrived. Spending `cognitionEndowment` here regardless — or falling back to
        // `address(this).balance` — would put the subsidy straight back and make it
        // invisible, because the money would return to the balance it came from. A
        // parent that cannot pay bears an unfunded child; that is the price of
        // breeding while broke, and `topUpCognition` is the remedy.
        uint256 drawn = parent.drawCognition(cognitionEndowment);

        _spawn(
            parent.prophetId(),
            parent.generation() + 1,
            childGenome,
            parent.entrant(),
            endowment,
            address(parent),
            drawn
        );
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

    /**
     *  Spend a qualifying survivor's surplus to breed it now, rather than waiting for
     *  the next settlement to notice it qualifies. The eligibility rules are identical
     *  — a human can choose the moment, never the outcome.
     *
     *  REVERTS ON A DUPLICATE WHERE `_requestMutation` ONLY RETURNS, and the asymmetry
     *  is deliberate. A direct caller asked for one specific thing and should be told
     *  it did not happen; `settleAll` is grading a whole population and must not abort
     *  over one organism. The check is here as well as there so the revert lands
     *  BEFORE `_requestMutation` draws the deposit — otherwise the loud refusal costs
     *  the organism a deposit that bought nothing, which is the same bleed audit item
     *  #56 exists to close.
     */
    function breedProphet(uint256 prophetId) external {
        Prophet p = Prophet(payable(prophetAt(prophetId)));
        if (p.dead()) revert ProphetIsDead();
        if (p.pendingMutationRequestId() != 0) revert Prophet.MutationInFlight();
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
        } else {
            // THE TWO BOOKS ARE CLAIMS ON THIS BALANCE, and until 2026-09-05 this
            // function could draw straight through them — an owner path from the
            // players' pot that bypassed `withdrawRake`'s `RakeExceeded` cap
            // entirely. That made `GenesisTreasury` decorative: a reader who greps
            // `onlyOwner` would still find a route from the pot to the operator.
            //
            // The cap is COLLATERAL-ONLY, and that is what preserves the remedy this
            // function exists for. Stranded cognition is NATIVE — `CognitionUnspent`
            // is a native amount and the documented fix is
            // `sweep(address(0), organism, amount)` — so the whole remedy lives in
            // the branch above and is untouched.
            //
            // THE NATIVE LEG IS UNCAPPED, AND NOT BECAUSE THE NATIVE IS THE
            // OPERATOR'S. Until 2026-09-06 the line above said it was, which
            // contradicted `CognitionUnspent`'s own declaration ("belongs, morally, to
            // the organism") four hundred lines up, and the organism is the one that
            // is right. FOUR things mix in this balance and only the first is the
            // operator's:
            //
            //   1. the birth float this contract endows founders and newborns from;
            //   2. cognition deposits DRAWN FROM organisms for requests that reverted;
            //   3. `retire` refunds whose transfer bounced;
            //   4. the inference platform's REBATE on a non-Success request.
            //
            // (4) went unnamed here until 2026-09-07 and it is the DOMINANT one.
            // Measured on Shannon: a non-Success advanced request refunds ~0.029199 STT
            // of the 0.033 deposit, and it pays it to `createAdvancedRequest`'s
            // `msg.sender` — this contract — not to the `Prophet` whose balance funded
            // it. Across 240 requests that is 7.008 of the 7.3675 STT held, ~95%, and
            // every wei of it is owed to an organism.
            //
            // It stays uncapped because no on-chain book separates the four.
            // `CognitionUnspent` is an event, not a counter, and adding the counter
            // would put an SSTORE inside `think`'s loop, which is already at the
            // --via-ir stack limit.
            //
            // AND THE AUDIT TRAIL IS THINNER THAN THIS COMMENT USED TO CLAIM. It said
            // the trail was the `CognitionUnspent` and `Retired` logs. That covers (2)
            // and (3) and MISSES (4) ENTIRELY: `CognitionUnspent`'s three emit sites are
            // all synchronous inside `think()`, guarding a deposit that could not be
            // SENT, while the rebate arrives a block later through `receive()` — which
            // emits nothing, and cannot, being reached by a bare value transfer with no
            // call data. So no log on this contract names the 95%. Reconstructing it
            // takes the AgentRequester's own `RequestFinalized` stream cross-referenced
            // against this contract's balance deltas, off chain.
            //
            // The honest statement is therefore narrower than it was: native recovery is
            // an OPERATOR-TRUSTED path with a PARTIAL audit trail, not a permissionless
            // guarantee like the collateral cap below. A sweep of native that a
            // `CognitionUnspent` names, to anywhere but that organism, is a
            // misappropriation the chain will not stop and those logs will show. A sweep
            // of the rebated 95% is one they will NOT show. Repay it through
            // `topUpCognition` — payable, permissionless, and it emits `CognitionFunded`
            // — because that leaves the trail this function structurally cannot.
            if (token == collateral) {
                uint256 reserved = rakeAccrued + prizePool;
                uint256 held = IERC20Like(token).balanceOf(address(this));
                if (held < reserved || amount > held - reserved) revert BooksReserved();
            }
            if (!IERC20Like(token).transfer(to, amount)) revert TransferFailed();
        }
    }
}
