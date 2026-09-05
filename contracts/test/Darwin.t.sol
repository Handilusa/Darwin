// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, stdError} from "forge-std/Test.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {Population} from "../src/Population.sol";
import {GenesisTreasury} from "../src/GenesisTreasury.sol";
import {Prophet} from "../src/Prophet.sol";
import {PushedPriceSource} from "../src/PushedPriceSource.sol";
import {SelectionEngine} from "../src/SelectionEngine.sol";
import {DreamDEXVenue} from "../src/venues/DreamDEXVenue.sol";
import {DirectDuelVenue} from "../src/venues/DirectDuelVenue.sol";
import {IArenaVenue} from "../src/interfaces/IArenaVenue.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {Genome, Belief, Thesis} from "../src/Genome.sol";
import {IBinaryMarketsModule} from "../src/interfaces/IDreamDEX.sol";
import {Response, Request, ResponseStatus, ConsensusType, ISomniaEventHandler} from "../src/interfaces/ISomnia.sol";

import {
    MockERC20,
    MockOutcomeToken,
    MockBinaryPool,
    MockSettlement,
    MockMarketsModule,
    MockBinaryMarket,
    MockAgentRequester,
    RevertingPool
} from "./mocks/Mocks.sol";

/// @dev A v2 implementation used to prove a beacon upgrade does not disturb organism
///      storage. It appends nothing — it only reads what v1 wrote.
contract ProphetV2 is Prophet {
    function version() external pure returns (string memory) {
        return "v2";
    }

    function winRateBps() external view returns (uint256) {
        uint256 graded = uint256(correctCount) + uint256(wrongCount);
        if (graded == 0) return 0;
        return (uint256(correctCount) * 10_000) / graded;
    }
}

contract DarwinTest is Test {
    uint256 constant YES_ID = 1001;
    uint256 constant NO_ID = 1002;
    bytes32 constant MARKET_ID = keccak256("BTC-15m-1");

    /// @dev 6 decimals, matching Shannon tUSDC.
    uint256 constant ONE = 1e6;

    MockERC20 collateral;
    MockOutcomeToken outcomeToken;
    MockSettlement settlement;
    MockBinaryPool pool;
    MockMarketsModule module;
    MockBinaryMarket market;
    MockAgentRequester requester;
    PushedPriceSource priceSource;

    /// @dev The REAL adapter, not a mock. Every test in this file therefore exercises
    ///      the venue seam end to end: a call-counting double would prove the
    ///      interface is called, which is the uninteresting half of the claim.
    DreamDEXVenue venue;

    UpgradeableBeacon beacon;
    Population population;

    address owner = address(0xB0B);

    /// @dev What a freshly initialized proxy sets `cognitionEndowment` to, recorded
    ///      before `setUp` overrides it with a season.
    uint256 defaultCognitionEndowment;

    function setUp() public {
        collateral = new MockERC20("Test USDC", "tUSDC", 6);
        outcomeToken = new MockOutcomeToken();
        settlement = new MockSettlement(collateral, outcomeToken);
        pool = new MockBinaryPool(collateral, outcomeToken, address(settlement), YES_ID, NO_ID);
        module = new MockMarketsModule();
        market = new MockBinaryMarket();
        requester = new MockAgentRequester();

        _setPool(address(pool), YES_ID, NO_ID);

        priceSource = new PushedPriceSource(IBinaryMarketsModule(address(module)), owner, owner);
        venue = new DreamDEXVenue(
            IPriceSource(address(priceSource)), address(settlement), address(collateral), address(outcomeToken), "BTC"
        );
        beacon = new UpgradeableBeacon(address(new Prophet()), owner);

        Population impl = new Population();
        bytes memory init = abi.encodeCall(
            Population.initialize,
            (
                owner,
                Population.Wiring({
                    agentRequester: address(requester),
                    settlement: address(settlement),
                    marketsModule: address(module),
                    outcomeToken: address(outcomeToken),
                    collateral: address(collateral),
                    prophetBeacon: address(beacon),
                    priceSource: address(priceSource),
                    venue: address(venue),
                    llmAgentId: 1,
                    symbol: "BTC"
                })
            )
        );
        population = Population(payable(address(new ERC1967Proxy(address(impl), init))));

        // `spawnGenesis` REFUSES TO RUN without this, so it is part of standing up an
        // arena rather than a fixture detail: a founder minted against a zero treasury
        // would be permanently ownerless and permanently unretirable. Doing it here
        // covers `_seed` (77 callers) and the two direct `spawnGenesis` calls in
        // `test_population_capIsConcurrentNotLifetime`.
        // `test_genesis_spawnRefusesWithoutATreasury` builds its own bare proxy to
        // assert the refusal, precisely because this arena no longer can.
        vm.prank(owner);
        population.deployGenesisTreasury();

        // Cognition is paid in native; endowments and payouts in collateral.
        vm.deal(address(population), 100 ether);
        collateral.mint(address(population), 10_000 * ONE);

        // Captured BEFORE the season overrides it, because the value a fresh proxy
        // initializes with is the value the live deploy gets — `Deploy.s.sol` never
        // calls `setSeason`. See `test_cognition_freshDeployIsNotBornBrainDead`.
        defaultCognitionEndowment = population.cognitionEndowment();

        // A season with a real cognition floor, so newborns can afford to think and
        // entrants are held to funding their own. 1 ether is ~10 windows at the mock
        // deposit (0.093), which matches what `_fundCognition` gives a founder — a
        // child that could only afford ONE thought would make every multi-window
        // breeding test depend on funding order rather than on what it asserts.
        Population.SeasonParams memory s = _season();
        s.minEndowment = 10 * ONE;
        s.cognitionEndowment = 1 ether;
        _setSeason(s);

        _pushWindow();
    }

    /*//////////////////////////////////////////////////////////////
                                HELPERS
    //////////////////////////////////////////////////////////////*/

    function _setPool(address pool_, uint256 upId, uint256 downId) internal {
        module.setMarket(
            MARKET_ID,
            MockMarketsModule.Rec({
                market: address(market),
                pool: pool_,
                yesId: upId,
                noId: downId,
                tradingStart: uint64(block.timestamp),
                expiry: uint64(block.timestamp + 900)
            })
        );
    }

    function _pushWindow() internal {
        vm.prank(owner);
        priceSource.pushWindow("BTC", MARKET_ID, 100_000 * ONE, 100_000 * ONE, 6);
    }

    function _seed(uint256 n) internal {
        string[] memory genomes = new string[](n);
        for (uint256 i; i < n; ++i) {
            genomes[i] = string.concat("organism ", vm.toString(i));
        }
        vm.prank(owner);
        population.spawnGenesis(genomes);
        _fundCognition(population.prophetCount());
    }

    /// @dev Cognition is paid by each organism now, so seeding a population means
    ///      funding its thinking too. Kept a separate helper, and called with an
    ///      explicit count, so a test can deliberately leave an organism unable to
    ///      afford a thought — which is the selection pressure, not a fault.
    function _fundCognition(uint256 n) internal {
        for (uint256 id = 1; id <= n; ++id) {
            vm.deal(population.prophetAt(id), 1 ether);
        }
    }

    function _p(uint256 id) internal view returns (Prophet) {
        return Prophet(payable(population.prophetAt(id)));
    }

    function _think() internal {
        vm.prank(owner);
        population.think();
    }

    function _commit() internal {
        vm.prank(owner);
        population.commitAll();
    }

    function _settle() internal {
        vm.prank(owner);
        population.settleAll();
    }

    /// @dev Answer on behalf of a specific organism. The request id is read off the
    ///      organism rather than assumed, so these stay correct as organisms die and
    ///      the id sequence develops gaps.
    function _answer(uint256 prophetId, string memory ans) internal {
        requester.deliver(_p(prophetId).pendingBeliefRequestId(), ans);
    }

    function _upWins() internal {
        settlement.setPayouts(YES_ID, NO_ID);
    }

    /**
     *  The seven economics parameters, read and written as one value.
     *
     *  THIS EXISTS TO CLOSE A FOOTGUN, not for tidiness. `setEconomics` takes seven
     *  positional arguments, and the obvious way to change one is to pass
     *  `population.xxx()` for the other six. That is broken: Solidity evaluates
     *  arguments BEFORE the call, `vm.prank` applies to the very next call, and a
     *  `view` read is a call. So the prank is spent on `population.endowment()` and
     *  `setEconomics` itself arrives from the test contract, which is not the owner —
     *  `OwnableUnauthorizedAccount`, in a test that looks correctly pranked.
     *
     *  Read first into memory, mutate the one field under test, then prank exactly
     *  once with no call between. Never inline a `population.xxx()` read into a
     *  `setEconomics` argument list.
     */
    struct Econ {
        uint256 endowment;
        uint256 metabolicCost;
        uint256 minStake;
        uint16 stakeBps;
        uint32 breedStreak;
        uint16 breedSurplusBps;
        uint16 maxPopulation;
    }

    function _econ() internal view returns (Econ memory e) {
        e.endowment = population.endowment();
        e.metabolicCost = population.metabolicCost();
        e.minStake = population.minStake();
        e.stakeBps = population.stakeBps();
        e.breedStreak = population.breedStreak();
        e.breedSurplusBps = population.breedSurplusBps();
        e.maxPopulation = population.maxPopulation();
    }

    function _setEconomics(Econ memory e) internal {
        vm.prank(owner);
        population.setEconomics(
            e.endowment, e.metabolicCost, e.minStake, e.stakeBps, e.breedStreak, e.breedSurplusBps, e.maxPopulation
        );
    }

    /**
     *  The season parameters, read and written as one value — the same footgun as
     *  `_econ`, for the same reason.
     *
     *  `setSeason` takes eight fields, so a test that wants to change ONE of them
     *  must not have to restate the other seven: a later change to a default in
     *  `initialize` would then silently reset six unrelated parameters here. Every
     *  read happens OUTSIDE the prank, which is the whole point — `vm.prank` binds
     *  to the next call and a `view` read IS a call, so `population.setSeason(
     *  _season())` would spend the prank on the first getter and send the real
     *  transaction from the test contract, which is not the owner.
     */
    function _season() internal view returns (Population.SeasonParams memory s) {
        s.minEndowment = population.minEndowment();
        s.cognitionEndowment = population.cognitionEndowment();
        s.baseAnte = population.baseAnte();
        s.anteMultBps = population.anteMultBps();
        s.levelWindows = population.levelWindows();
        s.seasonWindows = population.seasonWindows();
        s.rakeBps = population.rakeBps();
        s.prizeShareBps = population.prizeShareBps();
    }

    function _setSeason(Population.SeasonParams memory s) internal {
        vm.prank(owner);
        population.setSeason(s);
    }

    /// @dev What the house skims from a winner whose profit was `profit`. Kept as a
    ///      helper because four pre-existing tests assert a winner's exact net and
    ///      would otherwise each hard-code the same arithmetic — and hard-coding it
    ///      is how a rake silently stops being asserted when `rakeBps` changes.
    function _skimOn(uint256 profit) internal view returns (uint256) {
        return (profit * population.rakeBps()) / 10_000;
    }

    /// @dev Metabolism alone, no market variance: makes one thought unaffordable.
    function _makeThinkingFatal() internal {
        Econ memory e = _econ();
        e.metabolicCost = 9 * ONE;
        _setEconomics(e);
    }

    /// @dev The invariant that catches almost every accounting mistake here: an
    ///      organism's ledger must equal the collateral it actually holds. If these
    ///      diverge, `treasury` is fiction and so is every death it causes.
    function _assertLedgerMatchesBalance(uint256 id) internal view {
        Prophet p = _p(id);
        assertEq(p.treasury(), collateral.balanceOf(address(p)), "ledger drifted from balance");
    }

    /// @dev What every organism risks this window. One point every staking
    ///      assertion reads through, which is what made replacing the proportional
    ///      rule with the escalating ante survivable.
    function _stake() internal view returns (uint256) {
        return population.ante();
    }

    /*//////////////////////////////////////////////////////////////
                                 GENESIS
    //////////////////////////////////////////////////////////////*/

    function test_genesis_endowsAndRegisters() public {
        _seed(8);
        assertEq(population.prophetCount(), 8);
        assertEq(population.aliveCount(), 8);

        for (uint256 i = 1; i <= 8; ++i) {
            Prophet p = _p(i);
            assertEq(p.prophetId(), i);
            assertEq(p.parentId(), 0, "founders have no parent");
            assertEq(p.generation(), 0);
            assertEq(p.treasury(), population.endowment());
            assertFalse(p.dead());
            assertEq(p.genomeHash(), keccak256(bytes(p.systemPrompt())));
            _assertLedgerMatchesBalance(i);
        }
    }

    /*//////////////////////////////////////////////////////////////
                 THE LIVING POPULATION vs. THE LINEAGE
    //////////////////////////////////////////////////////////////*/

    /**
     *  `maxPopulation` is documented as a gas bound. It read `prophets.length`,
     *  which is append-only, so it was a LIFETIME BIRTH CAP: past that many births
     *  ever, the generation counter — the headline metric — freezes permanently and
     *  attrition empties an arena nobody can rejoin.
     */
    function test_population_capIsConcurrentNotLifetime() public {
        Econ memory e = _econ();
        e.maxPopulation = 2;
        _setEconomics(e);

        _seed(2);
        assertEq(population.livingCount(), 2, "two organisms should be alive");

        // A third birth is refused while both are alive. That part was always right.
        string[] memory one = new string[](1);
        one[0] = "third";
        vm.prank(owner);
        vm.expectRevert(Population.PopulationFull.selector);
        population.spawnGenesis(one);

        // Kill them, and the slots must come back.
        _makeThinkingFatal();
        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();

        assertLt(population.livingCount(), 2, "nothing died");

        vm.prank(owner);
        population.spawnGenesis(one); // must NOT revert

        assertGt(population.prophetCount(), 2, "lineage did not grow");
        assertEq(population.livingCount(), 1, "the newborn is the only living organism");
    }

    /**
     *  A PARTIAL kill, which is the case that matters.
     *
     *  With every organism dying, `livingCount()` reaching zero proves almost
     *  nothing — and a forward `settleAll` loop would fail that case by running off
     *  the end of a shrinking array, which reads as an unrelated panic. The bug
     *  worth catching is quieter: `_removeLiving` swap-removes, so the hole is
     *  filled from the END of `living`. A forward loop hands itself an element it
     *  has not visited yet and then walks past it — an organism silently unsettled,
     *  its position left open, never graded, no event to say so.
     *
     *  So: four organisms, two survive, and the survivors must still be graded in
     *  the FOLLOWING window. `_settle` running without reverting is not the
     *  assertion; being settled is.
     */
    function test_population_livingIndexSurvivesAPartialReap() public {
        // 10 tUSDC each, 1 risked. Loser ends on 9, winner on 11; a 5 tUSDC
        // metabolism kills the first (4 < 5) and spares the second (6 >= 5).
        Econ memory e = _econ();
        e.metabolicCost = 5 * ONE;
        _setEconomics(e);

        _seed(4);
        assertEq(population.livingCount(), population.aliveCount(), "index and counter disagree at genesis");

        _upWins();
        _think();
        for (uint256 id = 1; id <= 4; ++id) {
            _answer(id, id % 2 == 0 ? "UP_MOMENTUM" : "DOWN_REVERSION");
        }
        _commit();
        _settle();

        // Ids 2 and 4 went Up and Up won; 1 and 3 are gone.
        assertEq(population.livingCount(), 2, "expected exactly two survivors");
        assertEq(population.livingCount(), population.aliveCount(), "index drifted from aliveCount");
        assertEq(population.prophetCount(), 4, "the lineage must not shrink");

        // Every id in the index is alive, and every living id is in the index.
        for (uint256 id = 1; id <= 4; ++id) {
            assertEq(population.livingIndex(id) != 0, !_p(id).dead(), "livingIndex disagrees with dead()");
        }

        // `living` must be a permutation of the survivors with no duplicates: a
        // swap-remove that wrote the wrong slot would leave one id twice and drop
        // the other, which every count above still passes.
        uint256 a = population.living(0);
        uint256 b = population.living(1);
        assertTrue(a != b, "living holds the same id twice");
        assertTrue((a == 2 && b == 4) || (a == 4 && b == 2), "living holds ids that did not survive");
        assertEq(population.livingIndex(a), 1, "livingIndex does not point back at living[0]");
        assertEq(population.livingIndex(b), 2, "livingIndex does not point back at living[1]");

        // THE REAL ASSERTION: both survivors are still being graded a window later.
        uint32 graded2 = _p(2).correctCount() + _p(2).wrongCount();
        uint32 graded4 = _p(4).correctCount() + _p(4).wrongCount();

        _pushWindow();
        _think();
        _answer(2, "UP_MOMENTUM");
        _answer(4, "DOWN_REVERSION");
        _commit();
        _settle();

        assertEq(_p(2).correctCount() + _p(2).wrongCount(), graded2 + 1, "organism 2 was skipped by settleAll");
        assertEq(_p(4).correctCount() + _p(4).wrongCount(), graded4 + 1, "organism 4 was skipped by settleAll");
        assertFalse(_p(2).positionOpen(), "organism 2 left a position open");
        assertFalse(_p(4).positionOpen(), "organism 4 left a position open");
    }

    /**
     *  Per-window work must be bounded by the living set, not by history — that is
     *  the whole point. `settleAll`'s gas grew with cumulative DEATHS against a
     *  `gasLimit` that is fixed when the reactivity subscription is created, so the
     *  same-block settlement claim would have broken before the cap did.
     */
    function test_population_deadOrganismsCostNothingToIterate() public {
        _seed(2);
        _makeThinkingFatal();
        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();

        assertEq(population.livingCount(), 0, "both should have starved");
        assertEq(population.prophetCount(), 2, "lineage must not shrink");
        assertEq(population.livingIndex(1), 0, "a dead organism is still indexed");
        assertEq(population.livingIndex(2), 0, "a dead organism is still indexed");

        // A window over an empty living set must still advance the machine rather
        // than revert: the cadence has to survive an extinction it did not expect.
        _pushWindow();
        _think();
        assertEq(population.phase(), 1, "think() did not advance the phase");
        _commit();
        assertEq(population.phase(), 2, "commitAll() did not advance the phase");
        _settle();
        assertEq(population.phase(), 0, "settleAll() did not close the window");
    }

    /*//////////////////////////////////////////////////////////////
                    OWNERSHIP, ENTRY, AND THE EXIT
    //////////////////////////////////////////////////////////////*/

    /// @dev Every entry test needs the same three lines. Kept as a helper so the
    ///      tests below assert about ownership rather than about ERC20 approval.
    function _enter(address who, string memory genome, uint256 amount) internal returns (uint256 id) {
        collateral.mint(who, amount);
        // Read and deal BEFORE the prank: a view read consumes it (see `_econ`).
        uint256 cognition = population.cognitionEndowment();
        vm.deal(who, who.balance + cognition);
        vm.startPrank(who);
        collateral.approve(address(population), amount);
        id = population.enter{value: cognition}(genome, amount);
        vm.stopPrank();
    }

    function test_entry_isPermissionlessAndRecordsTheEntrant() public {
        address alice = address(0xA11CE);
        uint256 id = _enter(alice, "buy when funding is negative", 10 * ONE);

        assertEq(_p(id).entrant(), alice, "entrant not recorded");
        assertEq(_p(id).treasury(), 10 * ONE, "endowment not credited");
        assertEq(_p(id).generation(), 0, "an entrant's organism is generation 0");
        assertEq(population.livingCount(), 1, "the entrant's organism is not in the living set");
        _assertLedgerMatchesBalance(id);
    }

    function test_entry_rejectsBelowMinEndowment() public {
        address alice = address(0xA11CE);
        collateral.mint(alice, 100 * ONE);

        // Cognition floor to zero so the revert under test is the collateral one and
        // not `CognitionTooSmall` firing first on a valueless call.
        Population.SeasonParams memory s = _season();
        s.minEndowment = 10 * ONE;
        s.cognitionEndowment = 0;
        _setSeason(s);

        vm.startPrank(alice);
        collateral.approve(address(population), 100 * ONE);
        vm.expectRevert(Population.EndowmentTooSmall.selector);
        population.enter("underfunded", 9 * ONE);
        vm.stopPrank();
    }

    /**
     *  The house grant must not be farmable.
     *
     *  Entry is free at the door and `retire` gives the collateral back, so if the
     *  arena funded an entrant's cognition, enter → retire → repeat would convert
     *  the operator's STT into free inference indefinitely, against a documented
     *  1-STT/day faucet. The entrant brings it instead. Founders and children are
     *  house-funded because neither is farmable — one is owner-only, the other
     *  takes four consecutive correct windows to earn.
     */
    function test_entry_requiresTheEntrantToFundTheirOwnCognition() public {
        address alice = address(0xA11CE);
        collateral.mint(alice, 100 * ONE);
        uint256 floorNeeded = population.cognitionEndowment();
        // Guards the revert below against being vacuous: with a zero floor there is
        // nothing to be short of and the test would pass while asserting nothing.
        assertGt(floorNeeded, 0, "the season must have a cognition floor");
        vm.deal(alice, floorNeeded);

        vm.startPrank(alice);
        collateral.approve(address(population), 100 * ONE);
        vm.expectRevert(Population.CognitionTooSmall.selector);
        population.enter{value: floorNeeded - 1}("thinks for free", 10 * ONE);
        vm.stopPrank();
    }

    /// @dev Every wei of `msg.value` must reach the organism, the floor and the
    ///      excess alike. The arena is a conduit for cognition, not a toll booth —
    ///      and an entrant who wants a long-lived organism funds it once, at entry.
    function test_entry_forwardsEveryWeiOfCognitionToTheOrganism() public {
        address alice = address(0xA11CE);
        collateral.mint(alice, 100 * ONE);
        vm.deal(alice, 3 ether);
        uint256 popBefore = address(population).balance;

        vm.startPrank(alice);
        collateral.approve(address(population), 100 * ONE);
        uint256 id = population.enter{value: 3 ether}("well funded", 10 * ONE);
        vm.stopPrank();

        assertEq(address(_p(id)).balance, 3 ether, "the organism did not receive the whole payment");
        assertEq(address(population).balance, popBefore, "the arena kept part of the payment");
    }

    /**
     *  A genome that reproduces makes its ENTRANT richer in organisms, not the
     *  house. Ownership descending the lineage is what makes breeding worth
     *  anything to the person who paid for the parent.
     */
    function test_entry_childInheritsTheEntrant() public {
        address alice = address(0xA11CE);
        uint256 parent = _enter(alice, "momentum", 100 * ONE);

        // A second organism so the parent has a counterparty to beat.
        _seed(1);
        uint256 foil = population.prophetCount();

        _upWins();
        Econ memory e = _econ();
        e.breedStreak = 1;
        _setEconomics(e);

        _think();
        _answer(parent, "UP_MOMENTUM");
        _answer(foil, "DOWN_REVERSION");
        _commit();
        _settle();

        requester.deliver(_p(parent).pendingMutationRequestId(), "mutated momentum");
        vm.prank(owner);
        population.hatchAll();

        uint256 child = population.prophetCount();
        assertGt(child, foil, "no child was born");
        assertEq(_p(child).entrant(), alice, "child did not inherit the entrant");
        assertEq(_p(child).parentId(), parent, "child parentage is wrong");
    }

    /// @dev "The house" is the Genesis Treasury, not the operator. Asserted as a pair
    ///      rather than a single equality, because `== treasury` alone would still pass
    ///      if a future change made the treasury address BE the owner.
    function test_entry_genesisOrganismsBelongToTheHouse() public {
        _seed(1);
        address treasury = population.genesisTreasury();
        assertEq(_p(1).entrant(), treasury, "genesis organism should belong to the Genesis Treasury");
        assertTrue(treasury != owner, "the treasury must not be the operator's EOA");
    }

    function test_retire_returnsTheEntrantsRemainingCapital() public {
        address alice = address(0xA11CE);
        uint256 id = _enter(alice, "momentum", 10 * ONE);

        uint256 before = collateral.balanceOf(alice);
        uint256 held = _p(id).treasury();
        uint256 livingBefore = population.livingCount();

        vm.prank(alice);
        population.retire(id);

        assertEq(collateral.balanceOf(alice) - before, held, "capital was not returned in full");
        assertEq(_p(id).treasury(), 0, "the organism kept collateral");
        assertTrue(_p(id).dead(), "retiring must kill the organism");
        assertEq(population.livingIndex(id), 0, "still in the living index");
        assertEq(population.livingCount(), livingBefore - 1, "living count did not fall");
        assertEq(population.aliveCount(), population.livingCount(), "aliveCount drifted from the index");
        assertEq(population.prophetCount(), 1, "a retired organism must stay in the lineage");
    }

    /**
     *  Exiting must return BOTH currencies.
     *
     *  The entrant funded the collateral and the cognition, so leaving the unspent
     *  native in a dead organism would turn `enter`'s native requirement into a
     *  one-way ratchet: nothing can ever move it again, because a dead organism
     *  never thinks and `retire` cannot be called twice.
     */
    function test_retire_returnsUnspentCognitionToo() public {
        address alice = address(0xA11CE);
        uint256 id = _enter(alice, "momentum", 10 * ONE);

        uint256 stranded = address(_p(id)).balance;
        // Vacuity guard: with no cognition to return, the delta below is 0 == 0.
        assertGt(stranded, 0, "the organism must hold cognition for this to mean anything");
        uint256 before = alice.balance;

        vm.prank(alice);
        population.retire(id);

        assertEq(alice.balance - before, stranded, "unspent cognition was not returned");
        assertEq(address(_p(id)).balance, 0, "the dead organism kept native it can never spend");
    }

    /// @dev A partly-spent organism returns exactly the remainder — the windows it
    ///      already thought through are paid for and gone, which is the same rule
    ///      the collateral follows.
    function test_retire_returnsOnlyTheCognitionNotYetSpent() public {
        address alice = address(0xA11CE);
        uint256 id = _enter(alice, "momentum", 10 * ONE);

        uint256 dep = population.requestDeposit();
        uint256 funded = address(_p(id)).balance;
        _think();
        _answer(id, "UP_MOMENTUM");
        _commit();
        _upWins();
        _settle();

        uint256 before = alice.balance;
        vm.prank(alice);
        population.retire(id);

        assertEq(alice.balance - before, funded - dep, "the refund did not net off the thought it bought");
    }

    function test_retire_isEntrantOnly() public {
        address alice = address(0xA11CE);
        uint256 id = _enter(alice, "momentum", 10 * ONE);

        // Not even the owner can retire someone else's organism: this is the entrant's
        // capital, and an owner-callable exit would be an admin drain path.
        vm.prank(owner);
        vm.expectRevert(Population.NotEntrant.selector);
        population.retire(id);

        // And an entrant cannot retire a house organism. `house` is hoisted out of the
        // call because a view read AFTER vm.prank consumes the prank — see _econ().
        _seed(1);
        uint256 house = population.prophetCount();
        vm.prank(alice);
        vm.expectRevert(Population.NotEntrant.selector);
        population.retire(house);
    }

    /// @dev Retiring twice must not underflow `aliveCount`, and must say why it
    ///      refused. `die` is idempotent, so without the explicit `dead()` check the
    ///      second call would corrupt the counter instead of reverting.
    function test_retire_cannotBeCalledTwice() public {
        address alice = address(0xA11CE);
        uint256 id = _enter(alice, "momentum", 10 * ONE);

        vm.prank(alice);
        population.retire(id);

        vm.prank(alice);
        vm.expectRevert(Population.ProphetIsDead.selector);
        population.retire(id);

        assertEq(population.aliveCount(), 0, "aliveCount underflowed or double-counted");
    }

    /**
     *  The anti-rage-quit rule. An entrant must not be able to watch a market move
     *  against their organism and pull the stake out from under the counterparty it
     *  is already paired 1:1 with — that would leave the winner holding tokens
     *  against collateral that has walked out of the building.
     */
    function test_retire_refusesWhileAPositionIsOpen() public {
        address alice = address(0xA11CE);
        uint256 id = _enter(alice, "momentum", 50 * ONE);

        _seed(1);
        uint256 foil = population.prophetCount();

        _upWins();
        _think();
        _answer(id, "UP_MOMENTUM");
        _answer(foil, "DOWN_REVERSION");
        _commit();

        assertTrue(_p(id).positionOpen(), "the test needs an open position to be meaningful");
        vm.prank(alice);
        vm.expectRevert(Population.PositionStillOpen.selector);
        population.retire(id);

        // Once the window closes, the exit opens again.
        _settle();
        assertFalse(_p(id).dead(), "a 50 tUSDC organism must not have starved in one window");
        vm.prank(alice);
        population.retire(id);
        assertTrue(_p(id).dead(), "retire should succeed with no position open");
    }

    /*//////////////////////////////////////////////////////////////
                     COGNITION — ALL FIVE STATUS BRANCHES
    //////////////////////////////////////////////////////////////*/

    function test_belief_successUnanimous() public {
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");

        Prophet p = _p(1);
        assertEq(uint8(p.belief()), uint8(Belief.Up));
        assertEq(uint8(p.lastThesis()), uint8(Thesis.Momentum));
        assertEq(p.lastReasoning(), "UP_MOMENTUM");
        assertEq(p.pendingBeliefRequestId(), 0, "in-flight id must be cleared");
    }

    /// @dev Every status other than Success collapses to Abstain. A revert here would
    ///      let a flaky agent halt the population; a coin flip would put real
    ///      collateral behind an infrastructure failure.
    function test_belief_allNonSuccessStatusesBecomeAbstain() public {
        ResponseStatus[4] memory bad =
            [ResponseStatus.None, ResponseStatus.Pending, ResponseStatus.Failed, ResponseStatus.TimedOut];

        for (uint256 i; i < bad.length; ++i) {
            setUp();
            _seed(1);
            _think();
            requester.deliverStatus(_p(1).pendingBeliefRequestId(), bad[i]);

            assertEq(uint8(_p(1).belief()), uint8(Belief.Abstain), "non-Success must abstain");
            assertEq(uint8(_p(1).lastThesis()), uint8(Thesis.Unknown));
        }
    }

    /// @dev `status == Success` with an empty response array. A handler that trusts
    ///      the status and indexes `responses[0]` panics here.
    function test_belief_successWithNoResponsesAbstains() public {
        _seed(1);
        _think();
        requester.deliverMixed(_p(1).pendingBeliefRequestId(), new string[](0), ResponseStatus.Success);
        assertEq(uint8(_p(1).belief()), uint8(Belief.Abstain));
    }

    /// @dev Three validators, three different answers. Nothing has two agreeing, so
    ///      no belief was actually formed however the platform tallied it.
    function test_belief_validatorDisagreementAbstains() public {
        _seed(1);
        _think();
        string[] memory answers = new string[](3);
        answers[0] = "UP_MOMENTUM";
        answers[1] = "DOWN_REVERSION";
        answers[2] = "ABSTAIN";
        requester.deliverMixed(_p(1).pendingBeliefRequestId(), answers, ResponseStatus.Success);
        assertEq(uint8(_p(1).belief()), uint8(Belief.Abstain), "1-of-3 is not consensus");
    }

    function test_belief_twoOfThreeAgreeingIsConsensus() public {
        _seed(1);
        _think();
        string[] memory answers = new string[](3);
        answers[0] = "DOWN_REVERSION";
        answers[1] = "DOWN_REVERSION";
        answers[2] = "UP_MOMENTUM";
        requester.deliverMixed(_p(1).pendingBeliefRequestId(), answers, ResponseStatus.Success);
        assertEq(uint8(_p(1).belief()), uint8(Belief.Down));
        assertEq(uint8(_p(1).lastThesis()), uint8(Thesis.Reversion));
    }

    /// @dev An answer outside `allowedValues` means the constraint did not hold, and
    ///      the only safe reading of a broken constraint is that no belief was formed.
    function test_belief_garbageAnswerAbstains() public {
        _seed(1);
        _think();
        _answer(1, "probably up? hard to say");
        assertEq(uint8(_p(1).belief()), uint8(Belief.Abstain));
    }

    function test_belief_rejectsUnknownRequestId() public {
        _seed(1);
        _think();
        Prophet p = _p(1);
        uint256 real = p.pendingBeliefRequestId();

        // The right caller, a request that belongs to nobody. `req` is built
        // BEFORE the prank: argument evaluation is a sequence of calls, and a
        // `view` read between prank and target would consume the prank.
        Request memory req = _emptyRequest();
        vm.prank(address(requester));
        vm.expectRevert(Prophet.NoSuchRequest.selector);
        p.handleBelief(real + 999, new Response[](0), ResponseStatus.Success, req);
    }

    function test_belief_rejectsNonRequesterCaller() public {
        _seed(1);
        _think();
        Prophet p = _p(1);
        Request memory req = _emptyRequest();
        vm.prank(address(0xBAD));
        vm.expectRevert(Prophet.NotAgentRequester.selector);
        p.handleBelief(1, new Response[](0), ResponseStatus.Success, req);
    }

    /// @dev A second callback for an already-answered request must not overwrite a
    ///      belief the population may have already acted on.
    function test_belief_replayIsRejected() public {
        _seed(1);
        _think();
        Prophet p = _p(1);
        uint256 rid = p.pendingBeliefRequestId();
        requester.deliver(rid, "UP_MOMENTUM");

        Request memory req = _emptyRequest();
        vm.prank(address(requester));
        vm.expectRevert(Prophet.NoSuchRequest.selector);
        p.handleBelief(rid, new Response[](0), ResponseStatus.Success, req);
        assertEq(uint8(p.belief()), uint8(Belief.Up), "original belief intact");
    }

    /// @dev A population that one malformed organism can halt is not a population.
    function test_cognition_failedRequestsDoNotHaltPopulation() public {
        _seed(4);
        requester.setFailCreate(true);
        _think(); // every createAdvancedRequest reverts, all caught
        assertEq(population.phase(), 1, "the window still opened");

        requester.setFailCreate(false);
        vm.prank(owner);
        population.forcePhase(0);
        _think();
        assertGt(_p(1).pendingBeliefRequestId(), 0, "cognition recovered");
    }

    /*//////////////////////////////////////////////////////////////
                       COGNITION — WHO PAYS FOR IT
    //////////////////////////////////////////////////////////////*/

    /// @dev The whole point of the change: the protocol stops subsidising thought.
    ///      Note `_seed` funds cognition, so the balance moved here is the
    ///      organism's own and Population is only a conduit.
    function test_cognition_organismPaysItsOwnInference() public {
        _seed(1);
        Prophet p = _p(1);

        uint256 popBefore = address(population).balance;
        uint256 orgBefore = address(p).balance;
        uint256 dep = population.requestDeposit();

        _think();

        assertEq(orgBefore - address(p).balance, dep, "organism did not pay its own deposit");
        // Population forwarded exactly what it drew, so its balance is unchanged.
        assertEq(address(population).balance, popBefore, "population subsidised the request");
        assertGt(p.pendingBeliefRequestId(), 0, "no request was made");
    }

    /// @dev Dying because you can no longer afford to think is the intended
    ///      selection pressure, not a failure mode — so it must degrade into an
    ///      abstention that still pays metabolism, and must not halt the window.
    function test_cognition_brokeOrganismAbstainsAndStillPaysMetabolism() public {
        _seed(2);
        Prophet broke = _p(1);
        Prophet solvent = _p(2);

        vm.deal(address(broke), 0);

        uint256 treasuryBefore = broke.treasury();
        _think();

        assertEq(broke.pendingBeliefRequestId(), 0, "broke organism should not have a request");
        assertGt(solvent.pendingBeliefRequestId(), 0, "solvent organism should have thought");

        _answer(2, "UP_MOMENTUM");
        _commit();
        _upWins();
        _settle();

        assertEq(broke.abstainCount(), 1, "failure to afford thought is an abstention");
        assertEq(treasuryBefore - broke.treasury(), population.metabolicCost(), "metabolism was not charged");
    }

    /// @dev Buying someone else's cognition confers no control over what they
    ///      conclude, which is why this can be permissionless.
    function test_cognition_topUpIsPermissionless() public {
        _seed(1);
        address stranger = address(0x51A5);
        vm.deal(stranger, 1 ether);
        uint256 orgBefore = address(_p(1)).balance;

        vm.prank(stranger);
        population.topUpCognition{value: 0.5 ether}(1);

        assertEq(address(_p(1)).balance - orgBefore, 0.5 ether, "top-up did not land");
    }

    /**
     *  The one assertion that catches the deploy-day version of this mistake.
     *
     *  `initialize` set `cognitionEndowment = 0` while cognition was house-funded,
     *  which was harmless then and became fatal the moment the organism started
     *  paying: `Deploy.s.sol` never calls `setSeason`, so a zero default ships to
     *  Shannon, `think` skips every organism for want of native, and the whole
     *  population abstains its way to extinction while emitting nothing but
     *  `ThinkFailed`. It fails silently and looks like an inference outage.
     */
    function test_cognition_freshDeployIsNotBornBrainDead() public view {
        assertGt(defaultCognitionEndowment, 0, "a fresh deploy would birth organisms that cannot think");
        // Enough for more than one thought, at the deposit this deploy would pay.
        assertGt(defaultCognitionEndowment, population.requestDeposit(), "one inference is not a lifespan");
    }

    /// @dev Breeding is an inference too. If the house kept paying for it, the
    ///      recurring bill would still grow with evolutionary success — the exact
    ///      dynamic this change exists to remove.
    function test_cognition_breedingIsPaidByTheParent() public {
        Prophet winner = _p(_breedingCandidate());

        uint256 popBefore = address(population).balance;
        uint256 orgBefore = address(winner).balance;
        uint256 dep = population.requestDeposit();

        _settle();

        assertGt(winner.pendingMutationRequestId(), 0, "the winner should be breeding");
        assertEq(orgBefore - address(winner).balance, dep, "the parent did not pay for the mutation");
        assertEq(address(population).balance, popBefore, "population subsidised the breeding");
    }

    /// @dev A parent that bred on merit but cannot pay for the thought keeps its
    ///      streak and its surplus. Reverting instead would abort the entire
    ///      settlement over one organism's empty pocket.
    function test_cognition_unaffordableBreedingIsSkippedNotFatal() public {
        Prophet winner = _p(_breedingCandidate());

        // Drained AFTER thinking is paid for, so this isolates the breeding draw.
        vm.deal(address(winner), 0);
        uint256 treasuryBefore = winner.treasury();

        _settle();

        // VACUITY GUARD, and the reason this test has a helper behind it: a parent
        // that was never eligible also has no pending mutation, so without proving
        // eligibility from the post-settlement numbers `settleAll` itself compared,
        // the assertion below passes for the wrong reason. It did once.
        assertGe(winner.streak(), population.breedStreak(), "the parent was not eligible: streak");
        assertGe(winner.treasury(), _breedThreshold(), "the parent was not eligible: surplus");

        assertEq(winner.pendingMutationRequestId(), 0, "it could not afford to breed");
        assertEq(winner.streak(), 1, "the streak survives an unaffordable breeding");
        assertGt(winner.treasury(), treasuryBefore, "and it kept the surplus it won");
        assertFalse(winner.dead(), "settlement completed for everyone else");
    }

    /**
     *  A HATCHED CHILD'S COGNITION IS THE PARENT'S BILL, NOT THE HOUSE'S.
     *
     *  The collateral endowment already came out of the parent (see
     *  `test_breeding_mutatesAndInheritsGeneration`); this is the other currency.
     *  Both have to move, or the house keeps paying for every descendant and the
     *  recurring bill grows with evolutionary success — the dynamic the whole
     *  organism-paid-cognition change exists to remove.
     *
     *  THE ASSERTION THAT DOES THE WORK is the pair of them: the parent's balance
     *  falls by exactly `cognitionEndowment` AND the arena's is unchanged to the wei.
     *  Either one alone is satisfiable by the bug this test was written against —
     *  funding the child from `address(this).balance` after drawing from the parent,
     *  where the draw returns the money to the very balance it is then spent out of,
     *  so a house subsidy and a parent payment are indistinguishable. The house here
     *  holds 100 ether, so it could cover this a hundred times over and the
     *  unchanged-arena assertion is what refuses to let it.
     */
    function test_cognition_hatchedChildIsPaidForByTheParent() public {
        Prophet parent = _parentReadyToHatch();
        uint256 cog = population.cognitionEndowment();

        // The parent has already spent two deposits (belief, then mutation), so top
        // it up to where it can actually afford a child's ten windows. `vm.deal`
        // rather than `topUpCognition` on purpose: a top-up would move value out of
        // this test contract THROUGH the arena, and the arena's balance is the
        // measurement below.
        vm.deal(address(parent), cog + 1 ether);

        uint256 houseBefore = address(population).balance;
        uint256 parentBefore = address(parent).balance;
        // VACUITY GUARD: if the house could not afford it either, an unchanged house
        // balance would prove nothing about who paid.
        assertGe(houseBefore, cog, "the house must be able to afford this for the test to mean anything");

        vm.expectEmit(true, true, true, true, address(population));
        emit Population.CognitionFunded(3, address(parent), cog);
        vm.prank(owner);
        population.hatchAll();

        Prophet child = _p(3);
        assertEq(population.prophetCount(), 3, "no child was born");
        assertEq(parentBefore - address(parent).balance, cog, "the parent did not pay for the child's cognition");
        assertEq(address(child).balance, cog, "the child was not funded with what the parent paid");
        assertEq(address(population).balance, houseBefore, "the house subsidised the birth");
    }

    /**
     *  A parent too poor to endow a child's thinking still bears the child.
     *
     *  `drawCognition` is all-or-nothing, so this is the 0-return branch, and the
     *  only correct answer is an unfunded newborn: reverting would make one broke
     *  parent abort `hatchAll` for everybody, and reaching for the house balance
     *  would be the same subsidy in a costume — reproduction is meant to be
     *  expensive.
     */
    function test_cognition_brokeParentBearsAnUnfundedChild() public {
        Prophet parent = _parentReadyToHatch();
        uint256 cog = population.cognitionEndowment();

        // One wei short of the draw, not zero: this must be the all-or-nothing
        // boundary rather than an empty-pocket special case.
        vm.deal(address(parent), cog - 1);

        uint256 houseBefore = address(population).balance;
        assertGe(houseBefore, cog, "the house could have covered this, and must not have");

        vm.prank(owner);
        population.hatchAll();

        Prophet child = _p(3);
        assertEq(population.prophetCount(), 3, "an unfunded birth is still a birth");
        assertEq(address(child).balance, 0, "the child was funded by someone other than its parent");
        assertEq(address(parent).balance, cog - 1, "a short draw must move nothing at all");
        assertEq(address(population).balance, houseBefore, "the house bailed the birth out");
        assertFalse(child.dead(), "the child is alive, just brain-dead");

        // §8.13 CONTROL. Everything above turns on `child.balance == 0`, and a
        // detector that can only ever read zero is not a detector. `topUpCognition`
        // is the documented remedy for exactly this state, so make the same
        // measurement fire on purpose.
        population.topUpCognition{value: cog}(3);
        assertEq(address(child).balance, cog, "the balance this test reads cannot register funding at all");
    }

    /// @dev A parent with a landed mutated genome, one `hatchAll` away from a child.
    ///      Shared by the two tests above so neither has to restate the four windows
    ///      of breeding qualification that precede the thing being asserted.
    function _parentReadyToHatch() internal returns (Prophet parent) {
        parent = _p(_breedingCandidate());
        _settle();
        uint256 mutation = parent.pendingMutationRequestId();
        assertGt(mutation, 0, "the parent is not breeding, so there is nothing to hatch");
        requester.deliver(mutation, "organism 0, but bolder");
        assertEq(parent.pendingChildPrompt(), "organism 0, but bolder", "the child genome did not land");
    }

    /// @dev The breeding surplus is measured against the HOUSE endowment, not the
    ///      organism's own stake, so a founder that wins one window off a
    ///      same-sized opponent does not clear it. Mirrors what `Population`
    ///      computes internally.
    function _breedThreshold() internal view returns (uint256) {
        uint256 endowment = population.endowment();
        return endowment + ((endowment * population.breedSurplusBps()) / 10_000);
    }

    /**
     *  Two organisms, one window, and a winner that is eligible to breed the moment
     *  `settleAll` grades it — returns that winner's id with the window committed
     *  and settlement not yet called.
     *
     *  The surplus is funded rather than won because the pair is capped at the
     *  smaller side's stake, so no single window can lift a founder from its
     *  starting treasury over the breeding threshold. Funding it keeps the
     *  cognition assertions about the mutation deposit alone.
     */
    function _breedingCandidate() internal returns (uint256 winnerId) {
        _seed(2);
        winnerId = 1;

        Econ memory e = _econ();
        e.breedStreak = 1;
        _setEconomics(e);

        collateral.mint(address(this), 100 * ONE);
        collateral.approve(address(population), 100 * ONE);
        population.fundProphet(winnerId, 100 * ONE);

        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
    }

    /*//////////////////////////////////////////////////////////////
                   COMMITMENT — PAIRING AND ITS ARITHMETIC
    //////////////////////////////////////////////////////////////*/

    function test_pairing_winnerNetsLoserStake() public {
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");

        uint256 endowment = population.endowment();
        uint256 stake = _stake();

        _commit();

        // Each side HOLDS the pair's whole backing but RISKED only its own
        // contribution. Conflating the two would make every winner read as a
        // break-even and silently zero the fitness signal.
        assertEq(_p(1).currentStake(), stake, "stake is own contribution");
        assertEq(_p(1).currentQuantity(), stake * 2, "quantity is the pair's backing");
        assertEq(outcomeToken.balanceOf(address(_p(1)), YES_ID), stake * 2);
        assertEq(outcomeToken.balanceOf(address(_p(2)), NO_ID), stake * 2);
        assertEq(_p(1).treasury(), endowment - stake);

        _upWins();
        _settle();

        uint256 metabolism = population.metabolicCost();
        assertEq(
            _p(1).treasury(),
            endowment + stake - _skimOn(stake) - metabolism,
            "winner nets the loser's stake, less the house's cut of the profit"
        );
        assertEq(_p(2).treasury(), endowment - stake - metabolism, "loser forfeits its stake");

        assertEq(_p(1).correctCount(), 1);
        assertEq(_p(1).streak(), 1);
        assertEq(_p(2).wrongCount(), 1);
        assertEq(_p(2).streak(), 0);

        // The position must be fully cleared, or the next window redeems a ghost.
        assertFalse(_p(1).positionOpen());
        assertEq(_p(1).currentQuantity(), 0);
        assertEq(_p(1).currentStake(), 0);
        assertEq(uint8(_p(1).belief()), uint8(Belief.None));

        _assertLedgerMatchesBalance(1);
        _assertLedgerMatchesBalance(2);
    }

    /// @dev A voided market pays BOTH sides 0.5. That returns each stake and must
    ///      register as neither a win nor a loss — scoring it as a loss would make
    ///      voids a hidden tax that selection cannot distinguish from being wrong.
    function test_void_paysBothSidesAndIsNeutral() public {
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();

        settlement.setVoid(YES_ID, NO_ID);
        _settle();

        uint256 expected = population.endowment() - population.metabolicCost();
        assertEq(_p(1).treasury(), expected, "void returns the stake");
        assertEq(_p(2).treasury(), expected);

        assertEq(_p(1).correctCount(), 0);
        assertEq(_p(1).wrongCount(), 0);
        assertEq(_p(1).abstainCount(), 0, "a void is not an abstain either");
        assertEq(_p(2).correctCount(), 0);
        assertEq(_p(2).wrongCount(), 0);
        _assertLedgerMatchesBalance(1);
        _assertLedgerMatchesBalance(2);
    }

    /// @dev A void must not break a streak either — the organism was not wrong.
    function test_void_doesNotBreakAStreak() public {
        _seed(2);

        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();
        _settle();
        assertEq(_p(1).streak(), 1);

        vm.prank(owner);
        population.forcePhase(0);
        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        settlement.setVoid(YES_ID, NO_ID);
        _settle();

        assertEq(_p(1).streak(), 1, "a void is not a loss");
    }

    /// @dev The whole metabolic thesis: in a zero-fee market, refusing to act is not
    ///      free, because thinking is not free.
    function test_abstain_paysMetabolismAnyway() public {
        _seed(2);
        _think();
        _answer(1, "ABSTAIN");
        _answer(2, "ABSTAIN");
        _commit();
        _settle();

        uint256 expected = population.endowment() - population.metabolicCost();
        assertEq(_p(1).treasury(), expected);
        assertEq(_p(1).abstainCount(), 1);
        assertEq(_p(1).currentQuantity(), 0);
        _assertLedgerMatchesBalance(1);
    }

    /// @dev An organism whose inference never landed at all sits in `Belief.None`,
    ///      not `Abstain`. It must be charged identically — a silent agent is not a
    ///      free window.
    function test_noAnswerAtAllStillPays() public {
        _seed(2);
        _think(); // nobody answers
        assertEq(uint8(_p(1).belief()), uint8(Belief.None));
        _commit();
        _settle();

        assertEq(_p(1).treasury(), population.endowment() - population.metabolicCost());
        assertEq(_p(1).abstainCount(), 1);
    }

    /// @dev A belief with no opposing counterparty holds no position, so no forecast
    ///      was graded — but it thought, so it pays.
    function test_unpairedBeliefScoresAsAbstainButStillPays() public {
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "UP_MOMENTUM"); // agreement: nobody to trade against
        _commit();

        assertEq(_p(1).currentQuantity(), 0);
        assertEq(_p(2).currentQuantity(), 0);

        _upWins();
        _settle();

        assertEq(_p(1).abstainCount(), 1, "no position means no graded forecast");
        assertEq(_p(1).correctCount(), 0, "must NOT be credited for a position it never held");
        assertEq(_p(1).treasury(), population.endowment() - population.metabolicCost());
    }

    /// @dev Metabolism must move real collateral, not just decrement a ledger, or the
    ///      two drift apart over a long run and a corpse appears to still hold value.
    function test_metabolism_movesRealCollateralToPopulation() public {
        _seed(2);
        uint256 before = collateral.balanceOf(address(population));

        _think();
        _answer(1, "ABSTAIN");
        _answer(2, "ABSTAIN");
        _commit();
        _settle();

        uint256 reimbursed = collateral.balanceOf(address(population)) - before;
        assertEq(reimbursed, population.metabolicCost() * 2, "population is reimbursed for cognition");
        _assertLedgerMatchesBalance(1);
        _assertLedgerMatchesBalance(2);
    }

    /// @dev A stake below `minStake` is not worth the gas of a mint, but the organism
    ///      still thought and must still be charged.
    function test_dustStakeOpensEmptyAndStillPays() public {
        Econ memory e = _econ();
        e.minStake = 100 * ONE; // far above 10% of the endowment
        _setEconomics(e);
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();

        assertEq(_p(1).currentQuantity(), 0, "no mint below minStake");
        assertTrue(_p(1).positionOpen());
        _settle();
        assertEq(_p(1).treasury(), population.endowment() - population.metabolicCost());
    }

    /// @dev One failing mint must not roll back the rest of the window. The pool is
    ///      swapped BEFORE the window opens, because the venue resolves it from
    ///      `IPriceSource` when the pair is issued and never re-reads it afterwards.
    function test_commit_failedPairDoesNotRollBackWindow() public {
        _seed(4);
        _setPool(address(new RevertingPool()), YES_ID, NO_ID);
        _pushWindow();

        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _answer(3, "ABSTAIN");
        _answer(4, "ABSTAIN");

        _commit(); // must not revert

        assertEq(population.phase(), 2, "the commit phase still completed");
        assertTrue(_p(1).positionOpen(), "a failed pair still opens empty, still pays");
        assertEq(_p(1).currentQuantity(), 0);
        assertEq(_p(1).treasury(), population.endowment(), "the failed stake was returned");
        assertTrue(_p(3).positionOpen(), "abstainers were unaffected");

        _settle();
        assertEq(_p(1).treasury(), population.endowment() - population.metabolicCost());
    }

    /*//////////////////////////////////////////////////////////////
                       THE VENUE SEAM — IArenaVenue

        DreamDEX is fitness function #1, not the definition of the
        arena. These tests pin the seam's contract rather than its
        current occupant: what `Population` and `Prophet` are allowed
        to assume about where positions live and how a resolved
        position becomes collateral.

        Note that the other tests in this file are also venue tests —
        the harness wires the REAL `DreamDEXVenue`, not a double, so
        every window in this suite already goes through the interface.
    //////////////////////////////////////////////////////////////*/

    /**
     *  THE REGRESSION GUARD FOR THE DEFECT THIS SEAM ALMOST SHIPPED WITH.
     *
     *  The first draft of `DreamDEXVenue.redeemFor` resolved the pool by calling
     *  `IPriceSource.currentWindow`, mirroring what `openOpposing` does. That is
     *  wrong in a way no ordinary test would have caught: `PushedPriceSource`
     *  reverts `StalePrice` past `maxStaleness` (180s), and in the reactive path
     *  NOBODY pushes a price between the market resolving and the callback firing
     *  — no keeper between resolution and consequence is the whole claim. So the
     *  draft would have reverted every settlement on the path that matters and
     *  passed on the keeper-driven cadence that happens to push first.
     *
     *  The fix is that the venue RECORDS the pool per position id at open time.
     *  This test is what makes that structural: it settles with a feed that has
     *  provably gone stale, and it fails against any implementation that reads
     *  prices at settlement.
     */
    function test_venue_settlesAfterThePriceFeedHasGoneStale() public {
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();

        uint256 endowment = population.endowment();
        uint256 stake = _stake();

        // Past maxStaleness. This is the NORMAL case in the reactive path, not an
        // edge case: the callback fires whenever the market settles.
        //
        // `expectPartialRevert`, not `expectRevert`, and the distinction is a
        // foundry trap worth naming: `expectRevert(bytes4)` compares the WHOLE
        // revert data, so a bare selector matches only a parameterless error.
        // `StalePrice(uint64,uint64)` carries an age and a limit, so the bare
        // selector fails with `StalePrice(181, 180) != custom error 0x2ccfc2ca` —
        // which reads like the feed was not stale when in fact it was. Matching on
        // the selector alone is also the honest assertion here: this line is a
        // precondition proving the feed HAS gone stale, and the exact age is an
        // artifact of when the harness last pushed. Encoding it (as
        // `test_priceSource_refusesStalePrice` legitimately does, because there
        // the numbers ARE the claim) would couple this test to helper timing it
        // does not care about.
        vm.warp(block.timestamp + 181);
        vm.expectPartialRevert(PushedPriceSource.StalePrice.selector);
        priceSource.currentWindow("BTC");

        _settle();

        assertEq(
            _p(1).treasury(),
            endowment + stake - _skimOn(stake) - population.metabolicCost(),
            "the winner was paid with no live price available"
        );
        assertEq(_p(1).correctCount(), 1, "and it was graded");
        _assertLedgerMatchesBalance(1);
        _assertLedgerMatchesBalance(2);
    }

    /**
     *  The organism PUSHES its position to the venue; the venue never pulls.
     *
     *  Not a stylistic choice — `finalizeAndRedeem` burns from `msg.sender`, and
     *  the ERC-6909 surface here has `transfer` and `setOperator` but no
     *  `transferFrom`, so a venue cannot pull an organism's tokens no matter what
     *  rights it holds. An earlier design granted the venue operator rights and
     *  would simply not have worked. This asserts the absence of that grant, so
     *  reintroducing the pull design breaks a test instead of a deploy.
     */
    function test_venue_organismPushesRatherThanTheVenuePulling() public {
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();

        assertFalse(outcomeToken.isOperator(address(_p(1)), address(venue)), "the venue must not hold operator rights");
        assertEq(outcomeToken.balanceOf(address(venue), YES_ID), 0, "no position parked at the venue mid-window");

        _upWins();
        _settle();

        // Custody at the venue is transient: it exists only between the push and
        // the burn, inside one call.
        assertEq(outcomeToken.balanceOf(address(venue), YES_ID), 0, "venue holds nothing after settlement");
        assertEq(outcomeToken.balanceOf(address(_p(1)), YES_ID), 0, "position was burned, not left behind");
        assertEq(collateral.balanceOf(address(venue)), 0, "and it keeps no collateral either");
    }

    /**
     *  The seam has to be live, not decorative: a running arena must be
     *  repointable at a different adjudication mechanism without touching a
     *  single organism. That is the whole platform claim, and it only holds
     *  because organisms push — there is no standing authorisation to migrate.
     */
    function test_venue_canBeRepointedBetweenWindows() public {
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();
        _settle();

        DreamDEXVenue replacement = new DreamDEXVenue(
            IPriceSource(address(priceSource)), address(settlement), address(collateral), address(outcomeToken), "BTC"
        );
        assertEq(replacement.poolOf(YES_ID), address(0), "the replacement has issued nothing yet");

        vm.prank(owner);
        population.setWiring(address(0), address(0), address(0), address(replacement));
        assertEq(population.venue(), address(replacement));

        vm.prank(owner);
        population.forcePhase(0);
        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();

        // Proof the second window went through the NEW venue: it recorded the
        // pool this position was issued against, which it could not have done
        // without issuing it.
        assertEq(replacement.poolOf(YES_ID), address(pool), "the new venue issued the pair");

        _upWins();
        _settle();

        assertEq(_p(1).correctCount(), 2, "the organism was graded through both venues");
        _assertLedgerMatchesBalance(1);
        _assertLedgerMatchesBalance(2);
    }

    /// @dev The interface's own promises, asserted against the real adapter so a
    ///      future venue has an unambiguous contract to satisfy. `positionToken()`
    ///      returning zero is a real answer meaning "skip the push", which is why
    ///      it must be non-zero here.
    function test_venue_reportsItsOwnTokens() public view {
        assertEq(population.venue(), address(venue), "the population is wired to a venue");
        assertEq(IArenaVenue(address(venue)).collateral(), address(collateral));
        assertEq(IArenaVenue(address(venue)).positionToken(), address(outcomeToken));
    }

    /// @dev A position id the venue never issued must not be redeemable through it.
    ///      Without this, a venue would happily burn tokens against whatever pool
    ///      `poolOf` returned by default — address zero — and the failure mode is
    ///      a silent zero payout rather than a revert.
    function test_venue_rejectsAPositionItNeverIssued() public {
        vm.expectRevert(abi.encodeWithSelector(DreamDEXVenue.UnknownPosition.selector, uint256(4242)));
        venue.redeemFor(address(this), 4242, 1);
    }

    /*//////////////////////////////////////////////////////////////
                          DEATH — IRREVERSIBLE
    //////////////////////////////////////////////////////////////*/

    function test_death_whenItCanNoLongerAffordToThink() public {
        _seed(2);
        _makeThinkingFatal();

        _think();
        _answer(1, "ABSTAIN");
        _answer(2, "ABSTAIN");
        _commit();
        _settle();

        Prophet p = _p(1);
        assertTrue(p.dead(), "cannot afford to think means dead");
        assertEq(population.aliveCount(), 0);
        assertEq(p.deathWindow(), population.windowCount());
    }

    /// @dev The property the whole product rests on. If any path revives an organism,
    ///      death is a UI state rather than a consequence, and the pitch is a lie.
    function test_death_isIrreversible() public {
        _seed(1);
        _makeThinkingFatal();
        _think();
        _answer(1, "ABSTAIN");
        _commit();
        _settle();

        Prophet p = _p(1);
        assertTrue(p.dead());

        // Funding a corpse is refused.
        collateral.mint(address(this), 100 * ONE);
        collateral.approve(address(population), type(uint256).max);
        vm.expectRevert(Population.ProphetIsDead.selector);
        population.fundProphet(1, 100 * ONE);

        // Breeding a corpse is refused.
        vm.expectRevert(Population.ProphetIsDead.selector);
        population.breedProphet(1);

        // It cannot be made to think again.
        vm.prank(address(population));
        vm.expectRevert(Prophet.IsDead.selector);
        p.noteThinking(999, MARKET_ID);

        // It cannot take a position again.
        vm.prank(address(population));
        vm.expectRevert(Prophet.IsDead.selector);
        p.noteCommitted(YES_ID, 1, 1);

        // It cannot stake again.
        vm.prank(address(population));
        vm.expectRevert(Prophet.IsDead.selector);
        p.stakeOut(address(this), 1, address(collateral));

        // A new window skips it entirely and the population stays at zero.
        vm.prank(owner);
        population.forcePhase(0);
        _pushWindow();
        _think();
        assertEq(p.pendingBeliefRequestId(), 0, "the dead are not asked to think");
        assertEq(population.aliveCount(), 0);
        assertTrue(p.dead(), "still dead");
    }

    /// @dev A callback that lands after death is dropped, not applied — and must not
    ///      revert, or the requester's own finalization would fail on a corpse.
    function test_death_lateCallbackIsDropped() public {
        _seed(1);
        _think();
        Prophet p = _p(1);
        uint256 rid = p.pendingBeliefRequestId();

        vm.prank(address(population));
        p.die(1);

        requester.deliver(rid, "UP_MOMENTUM");
        assertEq(uint8(p.belief()), uint8(Belief.None), "no belief after death");
    }

    /// @dev `die` is idempotent, so a double reap cannot corrupt the death record.
    function test_death_dieTwiceIsSafe() public {
        _seed(1);
        Prophet p = _p(1);
        vm.startPrank(address(population));
        p.die(5);
        p.die(9);
        vm.stopPrank();
        assertEq(p.deathWindow(), 5, "the first death is the real one");
    }

    /*//////////////////////////////////////////////////////////////
                            REPRODUCTION
    //////////////////////////////////////////////////////////////*/

    function test_breeding_requiresStreakNotJustSurplus() public {
        _seed(2);
        collateral.mint(address(this), 1_000 * ONE);
        collateral.approve(address(population), type(uint256).max);
        population.fundProphet(1, 100 * ONE);

        assertEq(_p(1).streak(), 0);
        vm.expectRevert(Population.NotEligibleToBreed.selector);
        population.breedProphet(1);
    }

    function test_breeding_requiresSurplusNotJustStreak() public {
        _seed(2);

        // Four wins with no external funding: a streak, but the winnings are far
        // short of the surplus a child costs.
        for (uint32 w; w < population.breedStreak(); ++w) {
            _runWinningWindow();
        }
        assertEq(_p(1).streak(), population.breedStreak(), "streak earned");
        assertLt(_p(1).treasury(), (population.endowment() * 3) / 2, "but no surplus");

        vm.expectRevert(Population.NotEligibleToBreed.selector);
        population.breedProphet(1);
        assertEq(_p(1).pendingMutationRequestId(), 0, "settlement did not breed it either");
    }

    function test_breeding_mutatesAndInheritsGeneration() public {
        _seed(2);
        collateral.mint(address(this), 1_000 * ONE);
        collateral.approve(address(population), type(uint256).max);
        population.fundProphet(1, 500 * ONE); // guarantee the surplus

        for (uint32 w; w < population.breedStreak(); ++w) {
            _runWinningWindow();
        }
        assertEq(_p(1).streak(), population.breedStreak());

        // The final settlement should have requested a mutation on its own.
        uint256 mutationRequest = _p(1).pendingMutationRequestId();
        assertGt(mutationRequest, 0, "breeding was requested at settlement");

        requester.deliver(mutationRequest, "organism 0, but bolder");
        assertEq(_p(1).pendingChildPrompt(), "organism 0, but bolder");
        assertEq(_p(1).pendingMutationRequestId(), 0, "mutation id cleared");

        uint256 parentTreasuryBefore = _p(1).treasury();
        vm.prank(owner);
        population.hatchAll();

        assertEq(population.prophetCount(), 3, "a child was born");
        Prophet child = _p(3);
        assertEq(child.parentId(), 1);
        assertEq(child.generation(), 1, "generation advanced");
        assertEq(child.systemPrompt(), "organism 0, but bolder", "mutated genome inherited");
        assertEq(child.genomeHash(), keccak256("organism 0, but bolder"));
        assertEq(child.treasury(), population.endowment());
        assertEq(child.birthWindow(), population.windowCount());

        // Reproduction is expensive: the parent funded the child from its own
        // treasury and is deliberately more fragile immediately afterwards.
        assertEq(_p(1).treasury(), parentTreasuryBefore - population.endowment(), "parent paid for the child");
        assertEq(_p(1).pendingChildPrompt(), "", "child prompt consumed");
        _assertLedgerMatchesBalance(1);
        _assertLedgerMatchesBalance(3);
    }

    /// @dev Validators that disagree on a genome produce no child. Averaging them or
    ///      picking one arbitrarily would make heredity unattested.
    function test_breeding_failedMutationConsensusDoesNotBreed() public {
        _seed(1);

        Prophet p = _p(1);
        vm.prank(address(population));
        p.noteMutating(4242);

        string[] memory answers = new string[](3);
        answers[0] = "genome A";
        answers[1] = "genome B";
        answers[2] = "genome C";

        Response[] memory rs = _responsesFrom(answers);
        Request memory req = _emptyRequest();
        vm.prank(address(requester));
        p.handleMutation(4242, rs, ResponseStatus.Success, req);

        assertEq(p.pendingChildPrompt(), "", "no consensus, no child");
    }

    function test_breeding_hatchIsANoOpWithoutAGenome() public {
        _seed(2);
        vm.prank(owner);
        population.hatchAll();
        assertEq(population.prophetCount(), 2, "nothing to hatch");
    }

    /// @dev `maxPopulation` is a gas bound. Hitting it must stop births, not revert
    ///      the settlement that triggered them.
    function test_breeding_respectsMaxPopulation() public {
        _seed(2);
        Econ memory e = _econ();
        e.maxPopulation = 2; // already at the cap
        _setEconomics(e);

        Prophet p1 = _p(1);
        vm.prank(address(population));
        p1.noteMutating(77);

        // Delivered straight to the Prophet, not through `requester.deliver`: the
        // mock only knows about ids its own `createAdvancedRequest` issued, and 77
        // was set directly via `noteMutating`, so the mock has no record of it.
        // This is the same idiom as test_breeding_failedMutationConsensusDoesNotBreed.
        string[] memory answers = new string[](3);
        answers[0] = "a child that cannot be born";
        answers[1] = "a child that cannot be born";
        answers[2] = "a child that cannot be born";
        Response[] memory rs = _responsesFrom(answers);
        Request memory req = _emptyRequest();
        vm.prank(address(requester));
        p1.handleMutation(77, rs, ResponseStatus.Success, req);

        vm.prank(owner);
        population.hatchAll(); // must not revert
        assertEq(population.prophetCount(), 2, "the cap held");
    }

    /*//////////////////////////////////////////////////////////////
                     CREDITED PAYOUTS — STRANDED VALUE
    //////////////////////////////////////////////////////////////*/

    /// @dev Settlement may credit an `owed` balance instead of transferring. The
    ///      organism is graded on what the position was WORTH, while its ledger
    ///      tracks what it actually CUSTODIES — so it is scored a winner AND its
    ///      treasury still equals its balance. Both have to hold at once.
    function test_creditedPayout_isRescuedInTheSameCall() public {
        _seed(2);
        settlement.setCreditMode(true);

        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();
        _settle();

        assertEq(_p(1).correctCount(), 1, "graded on worth, not on custody");
        assertEq(_p(1).treasury(), population.endowment() + _stake() - _skimOn(_stake()) - population.metabolicCost());
        assertEq(settlement.owed(address(_p(1)), address(collateral)), 0, "claimed inside settlement");
        _assertLedgerMatchesBalance(1);
    }

    /// @dev And if the claim is unavailable at settlement time, the winnings are not
    ///      lost: the ledger simply does not book them yet, and anyone can rescue
    ///      them afterwards. The invariant holds at every step.
    function test_creditedPayout_survivesAnUnavailableClaim() public {
        _seed(2);
        settlement.setCreditMode(true);
        settlement.setClaimEnabled(false);

        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();
        _settle();

        uint256 stake = _stake();
        assertEq(_p(1).correctCount(), 1, "still correctly graded as a winner");
        assertEq(settlement.owed(address(_p(1)), address(collateral)), stake * 2, "stranded, not lost");
        assertEq(
            _p(1).treasury(),
            population.endowment() - stake - _skimOn(stake) - population.metabolicCost(),
            "unbooked until it actually arrives, but the rake is still owed"
        );
        _assertLedgerMatchesBalance(1);

        // Permissionless rescue. It can only ever move value INTO the organism.
        settlement.setClaimEnabled(true);
        Prophet p = _p(1);
        uint256 before = p.treasury();
        vm.prank(address(0xDEAD)); // a spectator, neither the owner nor Population
        uint256 claimed = p.claimOwed();

        assertEq(claimed, stake * 2);
        assertEq(p.treasury(), before + stake * 2);
        _assertLedgerMatchesBalance(1);
    }

    /// @dev With nothing owed the claim is a harmless no-op rather than a revert — it
    ///      gets called speculatively by monitoring.
    function test_claimOwed_withNothingOwedIsANoOp() public {
        _seed(1);
        uint256 before = _p(1).treasury();
        assertEq(_p(1).claimOwed(), 0);
        assertEq(_p(1).treasury(), before);
    }

    /*//////////////////////////////////////////////////////////////
                          BEACON UPGRADE SAFETY
    //////////////////////////////////////////////////////////////*/

    /// @dev The population goes live on day 2 and must survive logic repairs without
    ///      losing ancestry. If an upgrade disturbs storage, the run is over.
    function test_upgrade_preservesEveryOrganismField() public {
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();
        _settle();

        Prophet p = _p(1);
        address populationBefore = p.population();
        uint256 idBefore = p.prophetId();
        uint256 parentBefore = p.parentId();
        uint32 genBefore = p.generation();
        uint256 treasuryBefore = p.treasury();
        bytes32 hashBefore = p.genomeHash();
        string memory genomeBefore = p.systemPrompt();
        string memory reasoningBefore = p.lastReasoning();
        uint32 streakBefore = p.streak();
        uint32 livedBefore = p.windowsLived();
        uint32 correctBefore = p.correctCount();
        uint32 wrongBefore = p.wrongCount();
        uint32 abstainBefore = p.abstainCount();
        uint64 birthBefore = p.birthWindow();
        Thesis thesisBefore = p.lastThesis();
        address entrantBefore = p.entrant();
        // Guards the assertion below against being vacuous: if `entrant` were never
        // written, comparing address(0) to address(0) after the upgrade would pass
        // while proving nothing about whether the field survives.
        assertTrue(entrantBefore != address(0), "the organism must have an entrant to preserve");

        // Deployed BEFORE the prank: a CREATE is a call, and it would consume the
        // prank, leaving `upgradeTo` to arrive from the unauthorized test contract.
        address v2 = address(new ProphetV2());
        vm.prank(owner);
        beacon.upgradeTo(v2);
        assertEq(ProphetV2(payable(address(p))).version(), "v2", "the upgrade took effect");

        assertEq(p.population(), populationBefore);
        assertEq(p.prophetId(), idBefore);
        assertEq(p.parentId(), parentBefore);
        assertEq(p.generation(), genBefore);
        assertEq(p.treasury(), treasuryBefore);
        assertEq(p.genomeHash(), hashBefore);
        assertEq(p.systemPrompt(), genomeBefore);
        assertEq(p.lastReasoning(), reasoningBefore);
        assertEq(p.streak(), streakBefore);
        assertEq(p.windowsLived(), livedBefore);
        assertEq(p.correctCount(), correctBefore);
        assertEq(p.wrongCount(), wrongBefore);
        assertEq(p.abstainCount(), abstainBefore);
        assertEq(p.birthWindow(), birthBefore);
        assertEq(uint8(p.lastThesis()), uint8(thesisBefore));
        assertEq(p.entrant(), entrantBefore, "ownership must survive a beacon upgrade");

        // And v2's derived view reads v1's counters correctly.
        assertEq(ProphetV2(payable(address(p))).winRateBps(), 10_000);

        // The organism must still be able to run a window after the upgrade.
        vm.prank(owner);
        population.forcePhase(0);
        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();
        assertEq(p.windowsLived(), livedBefore + 1, "still alive and running");
    }

    /// @dev An upgrade must not be able to resurrect the dead either.
    function test_upgrade_cannotRevive() public {
        _seed(1);
        _makeThinkingFatal();
        _think();
        _answer(1, "ABSTAIN");
        _commit();
        _settle();
        Prophet p = _p(1);
        assertTrue(p.dead());

        // Deployed BEFORE the prank: a CREATE is a call, and it would consume the
        // prank, leaving `upgradeTo` to arrive from the unauthorized test contract.
        address v2 = address(new ProphetV2());
        vm.prank(owner);
        beacon.upgradeTo(v2);
        assertTrue(p.dead(), "death survives an upgrade");
    }

    /*//////////////////////////////////////////////////////////////
                             PRICE SOURCE
    //////////////////////////////////////////////////////////////*/

    /// @dev A stalled pusher must STOP the population, not feed it a stale opening
    ///      level. Committing collateral against a twenty-minute-old open would make
    ///      the fitness signal measure the pusher instead of the forecaster.
    function test_priceSource_refusesStalePrice() public {
        _seed(1);
        uint64 limit = priceSource.maxStaleness();
        vm.warp(block.timestamp + limit + 1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PushedPriceSource.StalePrice.selector, limit + 1, limit));
        population.think();
    }

    function test_priceSource_refusesResolvedMarket() public {
        _seed(1);
        market.setState(true, false);
        vm.prank(owner);
        vm.expectRevert(Population.MarketNotTradeable.selector);
        population.think();
    }

    function test_priceSource_refusesExpiredMarket() public {
        _seed(1);
        vm.warp(block.timestamp + 901);
        _pushWindow(); // fresh price, expired market
        vm.prank(owner);
        vm.expectRevert(Population.MarketNotTradeable.selector);
        population.think();
    }

    /// @dev Pools are per-market and RECYCLED across windows. Re-resolving every
    ///      window is what stops a mint landing against a pool that now belongs to
    ///      someone else's market.
    function test_priceSource_resolvesPoolFreshEachWindow() public {
        (, address poolA,,,,,,,) = priceSource.currentWindow("BTC");
        assertEq(poolA, address(pool));

        MockBinaryPool pool2 = new MockBinaryPool(collateral, outcomeToken, address(settlement), YES_ID, NO_ID);
        _setPool(address(pool2), YES_ID + 10, NO_ID + 10);

        (, address poolB, uint256 upB, uint256 downB,,,,,) = priceSource.currentWindow("BTC");
        assertEq(poolB, address(pool2), "the pool must be re-resolved");
        assertEq(upB, YES_ID + 10, "and so must the outcome ids");
        assertEq(downB, NO_ID + 10);
    }

    function test_priceSource_onlyUpdaterCanPush() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(PushedPriceSource.NotAuthorized.selector);
        priceSource.pushWindow("BTC", MARKET_ID, 1, 1, 6);
    }

    /// @dev Declared locally so `vm.expectEmit` has a shape to match. Mirrors
    ///      `PushedPriceSource.MaxStalenessChanged`.
    event MaxStalenessChanged(uint64 previous, uint64 current);

    /**
     *  A ZERO PRICE IS THE ONE BAD PUSH THAT DOES NOT ANNOUNCE ITSELF.
     *
     *  Staleness already had a guard, because a stalled pusher must stop the
     *  population rather than feed it an old level. A zero is worse: nothing reverts
     *  anywhere, and every organism is graded against nothing. On the duel venue the
     *  outcome is the sign of `lastPrice - openPrice`, so an `openPrice` of zero
     *  makes UP win deterministically whatever BTC actually did — a whole window of
     *  fitness signal measuring the pusher instead of the forecaster, in counters
     *  that are permanent.
     *
     *  `scripts/lib/market.ts:151` names this exact failure and guards `undefined`,
     *  but a REST payload carrying a literal `0` — or `OPEN_PRICE=0` in the env
     *  override — still arrives as a well-formed zero. The updater is a hot key on a
     *  script, so the check belongs on the contract side of that boundary.
     */
    function test_priceSource_refusesAZeroPriceAndAZeroMarket() public {
        vm.startPrank(owner);

        vm.expectRevert(PushedPriceSource.ZeroPrice.selector);
        priceSource.pushWindow("BTC", MARKET_ID, 0, 100_000 * ONE, 6);

        vm.expectRevert(PushedPriceSource.ZeroPrice.selector);
        priceSource.pushWindow("BTC", MARKET_ID, 100_000 * ONE, 0, 6);

        // A zero `marketId` reads back as "no window at all" (`NoWindow`), so pushing
        // one writes a window the reader denies exists. Failing at the push says what
        // actually went wrong.
        vm.expectRevert(PushedPriceSource.ZeroMarket.selector);
        priceSource.pushWindow("BTC", bytes32(0), 100_000 * ONE, 100_000 * ONE, 6);

        // CONTROL. Three reverts above prove nothing if this function refuses
        // everything — the same push with all three fields non-zero must land, and
        // the window must read back.
        priceSource.pushWindow("BTC", MARKET_ID, 100_000 * ONE, 100_001 * ONE, 6);
        vm.stopPrank();

        (bytes32 id,,,, uint256 open, uint256 last,,,) = priceSource.currentWindow("BTC");
        assertEq(id, MARKET_ID, "the valid push did not land");
        assertEq(open, 100_000 * ONE, "the valid push did not land");
        assertEq(last, 100_001 * ONE, "the valid push did not land");
    }

    /// @dev An external boundary for an `internal` library call, so a panic inside it
    ///      can be caught. `vm.expectRevert` needs a call to unwind; `Genome` is
    ///      inlined into whoever uses it.
    function externalBeliefPrompt(uint8 decimals) external pure returns (string memory) {
        return Genome.beliefPrompt("BTC", 110_432_500_000, 110_500_000_000, decimals, 420);
    }

    /**
     *  A GARBAGE `priceDecimals` IS REFUSED AT THE PUSH, because the alternative is
     *  a population that cannot think and a revert reason that says nothing.
     *
     *  The first half of this test is the hazard itself, executed rather than
     *  asserted: `Genome._decimal` computes `10 ** decimals`, so 78 overflows uint256
     *  and panics. That call sits in `Population.think`'s scoped window block —
     *  OUTSIDE the per-organism try/catch — so it is not one `ThinkFailed` among
     *  eight, it is the whole window reverting on `Panic(0x11)`, a reason naming
     *  neither the field nor the contract that supplied it. The operator's actual
     *  mistake is one uint8 in a script; what they would see is an unexplained dead
     *  population.
     *
     *  The cap is 18 rather than 77, and that number is a judgment, not a
     *  measurement — tUSDC is 6, `market.ts` defaults to 6, no ERC-20 or price feed
     *  reports more than 18 — so nothing real is rejected while every value that
     *  could brick a window is. The second half asserts the boundary in both
     *  directions, since a cap is only meaningful if it also lets 18 through.
     */
    function test_priceSource_refusesAPriceScaleThatWouldBrickEveryWindow() public {
        // THE HAZARD, DEMONSTRATED. Not "78 would overflow" — 78 overflows.
        vm.expectRevert(stdError.arithmeticError);
        this.externalBeliefPrompt(78);

        // And 18 does not, which is what makes the cap below safe to set there.
        assertGt(bytes(this.externalBeliefPrompt(18)).length, 0, "18 decimals cannot render a prompt");

        vm.startPrank(owner);

        vm.expectRevert(abi.encodeWithSelector(PushedPriceSource.BadDecimals.selector, uint8(78), uint8(18)));
        priceSource.pushWindow("BTC", MARKET_ID, 100_000 * ONE, 100_001 * ONE, 78);

        // 19 is the first refused value, not merely some large one — a guard that
        // only catches absurd inputs leaves the plausible typo through.
        vm.expectRevert(abi.encodeWithSelector(PushedPriceSource.BadDecimals.selector, uint8(19), uint8(18)));
        priceSource.pushWindow("BTC", MARKET_ID, 100_000 * ONE, 100_001 * ONE, 19);

        // CONTROL. The boundary value itself must land, or the cap is off by one and
        // this test could not tell.
        priceSource.pushWindow("BTC", MARKET_ID, 100_000 * ONE, 100_001 * ONE, 18);
        vm.stopPrank();

        (,,,,,, uint8 decimals,,) = priceSource.currentWindow("BTC");
        assertEq(decimals, 18, "the boundary push did not land");
    }

    /**
     *  `setMaxStaleness(0)` bricked the feed, and with it every `think`, from one
     *  `onlyOwner` call whose likeliest cause is an uninitialised variable rather
     *  than an intention: `currentWindow` refuses a price when `age > maxStaleness`,
     *  and `pushWindow` and `think` are two transactions, so zero refuses every price
     *  that will ever be pushed.
     *
     *  A LARGE value is deliberately still allowed. That one is a real loosening an
     *  operator might want on a chain having a slow minute, so it is recorded by an
     *  event instead of being capped at a number picked here on the owner's behalf.
     */
    function test_priceSource_refusesToBrickItselfWithZeroStaleness() public {
        vm.prank(owner);
        vm.expectRevert(PushedPriceSource.ZeroStaleness.selector);
        priceSource.setMaxStaleness(0);
        assertEq(priceSource.maxStaleness(), 180, "the rejected write must not have landed");

        // A loosening is allowed, and it is no longer silent: `setUpdater` has always
        // emitted, so this was the one operator change to the feed that left no trace.
        vm.expectEmit(true, true, true, true, address(priceSource));
        emit MaxStalenessChanged(180, 900);
        vm.prank(owner);
        priceSource.setMaxStaleness(900);
        assertEq(priceSource.maxStaleness(), 900, "the accepted write did not land");

        // CONTROL for the two assertions above: the guard is on the VALUE, not on the
        // function, and a `maxStaleness` that never actually moved would satisfy both
        // `assertEq`s by accident. So warp past the OLD limit and read the feed — it
        // must answer under 900 and refuse under 180, from the same pushed window.
        vm.warp(block.timestamp + 800);
        priceSource.currentWindow("BTC");

        vm.prank(owner);
        priceSource.setMaxStaleness(180);
        vm.expectRevert(abi.encodeWithSelector(PushedPriceSource.StalePrice.selector, uint64(800), uint64(180)));
        priceSource.currentWindow("BTC");
    }

    /*//////////////////////////////////////////////////////////////
                          PROMPT CONSTRUCTION
    //////////////////////////////////////////////////////////////*/

    /// @dev A model handed "110432500000" instead of "110432.5" is being asked about
    ///      a different order of magnitude than the market it is trading.
    function test_genome_formatsPricesReadably() public pure {
        string memory p = Genome.beliefPrompt("BTC", 110_432_500_000, 110_500_000_000, 6, 420);
        assertTrue(_contains(p, "110432.5"), "opening price must be human-readable");
        assertTrue(_contains(p, "110500"), "current price must be human-readable");
        assertTrue(_contains(p, "420"), "time remaining must be present");
        assertTrue(_contains(p, "OPENING PRICE"), "must state what it is graded against");
        assertTrue(_contains(p, "BTC"), "must name the market");
    }

    function test_genome_allowedValuesCoverEveryParse() public pure {
        string[] memory allowed = Genome.allowedBeliefs();
        assertEq(allowed.length, 9);

        uint256 ups;
        uint256 downs;
        uint256 abstains;
        for (uint256 i; i < allowed.length; ++i) {
            (Belief b, Thesis t) = Genome.parseAnswer(allowed[i]);
            if (b == Belief.Up) ups++;
            else if (b == Belief.Down) downs++;
            else abstains++;
            // Every directional answer must carry a real thesis, or the enum's whole
            // purpose — readable reasoning — is defeated.
            if (b != Belief.Abstain) assertTrue(t != Thesis.Unknown, "a direction needs a thesis");
        }
        assertEq(ups, 4);
        assertEq(downs, 4);
        assertEq(abstains, 1);
    }

    function test_genome_mutationPromptCarriesParentRecord() public pure {
        string memory m = Genome.mutationPrompt("be bold", 7, 3, 1, 2);
        assertTrue(_contains(m, "be bold"), "parent genome included");
        assertTrue(_contains(m, "7 correct"), "the record informs the mutation");
        assertTrue(_contains(m, "3 wrong"));
        assertTrue(_contains(m, "generation 2"));
    }

    /*//////////////////////////////////////////////////////////////
                            ACCESS CONTROL
    //////////////////////////////////////////////////////////////*/

    function test_access_onlyDriverCanRunAWindow() public {
        _seed(1);
        vm.prank(address(0xBAD));
        vm.expectRevert(Population.NotDriver.selector);
        population.think();
    }

    function test_access_prophetRejectsNonPopulation() public {
        _seed(1);
        Prophet p = _p(1);
        vm.prank(address(0xBAD));
        vm.expectRevert(Prophet.NotPopulation.selector);
        p.die(1);
    }

    function test_access_executePairIsInternalOnly() public {
        _seed(2);
        Prophet up = _p(1);
        Prophet down = _p(2);
        vm.expectRevert(Population.NotDriver.selector);
        population.executePair(up, down, 1);
    }

    function test_access_prophetCannotBeReinitialized() public {
        _seed(1);
        Prophet p = _p(1);
        vm.expectRevert(Prophet.AlreadyInitialized.selector);
        p.initialize(address(this), 99, 0, 0, 0, address(this), "hijacked");
    }

    function test_access_phaseMachineIsOrdered() public {
        _seed(1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Population.WrongPhase.selector, 1, 0));
        population.commitAll();
    }

    /*//////////////////////////////////////////////////////////////
                              TEST UTILS
    //////////////////////////////////////////////////////////////*/

    /// @dev One full window in which organism 1 is right and organism 2 is wrong.
    function _runWinningWindow() internal {
        vm.prank(owner);
        population.forcePhase(0);
        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();
        _settle();
    }

    function _responsesFrom(string[] memory answers) internal view returns (Response[] memory out) {
        out = new Response[](answers.length);
        for (uint256 i; i < answers.length; ++i) {
            out[i] = Response({
                validator: address(uint160(1000 + i)),
                result: abi.encode(answers[i]),
                status: ResponseStatus.Success,
                receipt: i,
                timestamp: block.timestamp,
                executionCost: 1
            });
        }
    }

    function _emptyRequest() internal view returns (Request memory) {
        return Request({
            id: 0,
            requester: address(requester),
            callbackAddress: address(0),
            callbackSelector: bytes4(0),
            subcommittee: new address[](0),
            responses: new Response[](0),
            responseCount: 0,
            failureCount: 0,
            threshold: 2,
            createdAt: block.timestamp,
            deadline: block.timestamp,
            status: ResponseStatus.Success,
            consensusType: ConsensusType.Majority,
            remainingBudget: 0,
            perAgentBudget: 0
        });
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i; i <= h.length - n.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length; ++j) {
                if (h[i + j] != n[j]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return true;
        }
        return false;
    }

    /*//////////////////////////////////////////////////////////////
                        THE REACTIVE HANDLER

        SelectionEngine had no coverage at all until 2026-08-29, which is
        backwards: it carries the project's central claim. What CANNOT be
        tested here is validator insertion — the precompile does not exist
        on chain id 31337, so `prove-same-block.ts` owns that property
        against Shannon. What CAN be tested is everything around it: who
        is allowed to call the callback, which emitter it accepts, and
        whether a failing callback costs the subscription owner a revert.
    //////////////////////////////////////////////////////////////*/

    address constant REACTIVITY = 0x0000000000000000000000000000000000000100;

    event Reacted(
        address indexed emitter, uint64 indexed window, uint256 blockNumber, bytes32 parentHash, bool viaReactivity
    );
    event ReactionFailed(address indexed emitter, uint256 blockNumber, bytes reason);

    function _engine() internal returns (SelectionEngine e) {
        e = new SelectionEngine(population, address(settlement), owner);
        vm.prank(owner);
        population.setWiring(address(0), address(e), address(0), address(0));
    }

    /**
     *  The regression guard for the bug this section was written after.
     *
     *  The handler was originally named `onSomniaEvent`, a name this repo invented
     *  while the real one was unread. The precompile calls a FIXED selector, so an
     *  invented name is not a cosmetic problem — validators would have called a
     *  function that does not exist, the callback would have failed, and the symptom
     *  (reactivity appears not to work) is indistinguishable from the feature being
     *  broken upstream. Pinning the literal signature string means any future rename
     *  breaks this test instead of breaking production silently.
     */
    function test_reactivity_handlerSelectorIsTheOneThePrecompileCalls() public pure {
        assertEq(
            SelectionEngine.onEvent.selector,
            bytes4(keccak256("onEvent(address,bytes32[],bytes)")),
            "handler selector must match SomniaEventHandlerABI in @somnia-chain/reactivity"
        );
        assertEq(
            SelectionEngine.onEvent.selector,
            ISomniaEventHandler.onEvent.selector,
            "engine and interface must not drift apart"
        );
    }

    function test_reactivity_precompileAddressIs0x0100() public {
        assertEq(_engine().REACTIVITY(), REACTIVITY);
    }

    function test_reactivity_onlyThePrecompileMayInvokeTheCallback() public {
        SelectionEngine e = _engine();
        vm.expectRevert(SelectionEngine.NotAuthorized.selector);
        e.onEvent(address(settlement), new bytes32[](0), "");

        // Not even the owner. The owner's path is `poke()`, which is recorded as
        // NOT via reactivity — otherwise the owner could manufacture the evidence
        // that the central claim is proved by.
        vm.prank(owner);
        vm.expectRevert(SelectionEngine.NotAuthorized.selector);
        e.onEvent(address(settlement), new bytes32[](0), "");
    }

    /**
     *  BinarySettlement is a shared singleton, so a subscription on it fires for
     *  every market on DreamDEX, not only ours. The emitter check is the second
     *  line of defence behind the subscription filter.
     */
    function test_reactivity_foreignEmitterIsRejected() public {
        SelectionEngine e = _engine();
        address foreign = address(0xF0E1);

        vm.prank(REACTIVITY);
        vm.expectRevert(
            abi.encodeWithSelector(SelectionEngine.UnexpectedEmitter.selector, foreign, address(settlement))
        );
        e.onEvent(foreign, new bytes32[](0), "");
    }

    /// @dev The happy path: a callback from the precompile settles the window and
    ///      records `viaReactivity == true`, which is the flag `npm run prove` reads.
    function test_reactivity_callbackSettlesTheWindowAndRecordsItAsReactive() public {
        SelectionEngine e = _engine();
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");

        uint256 endowment = population.endowment();
        uint256 stake = _stake();
        _commit();
        _upWins();

        uint64 window = population.windowCount();

        vm.expectEmit(true, true, true, true, address(e));
        emit Reacted(address(settlement), window, block.number, blockhash(block.number - 1), true);

        vm.prank(REACTIVITY);
        e.onEvent(address(settlement), new bytes32[](0), "");

        // Selection actually happened — this is not merely an event being emitted.
        uint256 metabolism = population.metabolicCost();
        assertEq(
            _p(1).treasury(),
            endowment + stake - _skimOn(stake) - metabolism,
            "winner nets the loser's stake, less the house's cut of the profit"
        );
        assertEq(_p(2).treasury(), endowment - stake - metabolism, "loser forfeits its stake");
        assertFalse(_p(1).positionOpen(), "position must be cleared by the reactive path too");
    }

    /**
     *  A revert inside a reactive callback is paid for by the subscription owner and
     *  buys nothing. Because the emitter is a shared singleton, MOST callbacks will
     *  be for windows this population never committed to — so the common case must
     *  be a caught failure, not a revert.
     */
    function test_reactivity_failingCallbackIsLoggedRatherThanReverted() public {
        SelectionEngine e = _engine();
        _seed(2);
        // Phase 0: `settleAll()` reverts. The callback must absorb it.

        vm.expectEmit(true, false, false, false, address(e));
        emit ReactionFailed(address(settlement), 0, "");

        vm.prank(REACTIVITY);
        e.onEvent(address(settlement), new bytes32[](0), "");
    }

    /// @dev The fallback must never be able to masquerade as the reactive path.
    function test_reactivity_pokeIsOwnerOnlyAndNotMarkedReactive() public {
        SelectionEngine e = _engine();
        _seed(2);
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();

        vm.expectRevert(SelectionEngine.NotAuthorized.selector);
        e.poke();

        uint64 window = population.windowCount();

        vm.expectEmit(true, true, true, true, address(e));
        emit Reacted(address(settlement), window, block.number, blockhash(block.number - 1), false);

        vm.prank(owner);
        e.poke();
    }

    function test_reactivity_disableFallbackIsIrreversible() public {
        SelectionEngine e = _engine();
        assertTrue(e.fallbackEnabled());

        vm.prank(owner);
        e.disableFallback();
        assertFalse(e.fallbackEnabled());

        // Closed for the owner as well, and there is no re-enable function at all —
        // which is what makes "no keeper in the causal chain" structural rather than
        // a promise about operator behaviour.
        vm.prank(owner);
        vm.expectRevert(SelectionEngine.FallbackClosed.selector);
        e.poke();

        // The reactive path is unaffected by closing the fallback.
        vm.prank(REACTIVITY);
        e.onEvent(address(settlement), new bytes32[](0), "");
    }

    /// @dev Declared locally so `vm.expectEmit` has a shape to match. Mirrors
    ///      `SelectionEngine.OwnershipTransferred`.
    event OwnershipTransferred(address indexed previous, address indexed current);

    /**
     *  A STRANGER IS TOLD THEY ARE A STRANGER, whatever the honesty flag happens to
     *  say. `poke` checked `fallbackEnabled` before ownership until 2026-09-05, so
     *  after `disableFallback` a passer-by got `FallbackClosed` — a fact about the
     *  contract's posture — when the only answer relevant to them is that they are
     *  not the owner. Two consequences, one of them the reason this is worth a test:
     *  the caller who cannot act on it is the one who learns the state, and the flag
     *  that licenses the project's strongest claim became readable through a revert
     *  by anyone who felt like probing it.
     */
    function test_reactivity_pokeAnswersAStrangerAsAStrangerNotAsAnOracle() public {
        SelectionEngine e = _engine();
        address passerby = makeAddr("passerby");

        vm.prank(passerby);
        vm.expectRevert(SelectionEngine.NotAuthorized.selector);
        e.poke();

        vm.prank(owner);
        e.disableFallback();

        // Same caller, same error — the closed fallback did not change what a
        // stranger is told about it.
        vm.prank(passerby);
        vm.expectRevert(SelectionEngine.NotAuthorized.selector);
        e.poke();

        // CONTROL. The assertion above is that a stranger CANNOT see the state, which
        // is worth nothing unless the state is genuinely closed and genuinely visible
        // to somebody. The owner, at this exact moment, gets the other error.
        vm.prank(owner);
        vm.expectRevert(SelectionEngine.FallbackClosed.selector);
        e.poke();
    }

    /**
     *  OWNERSHIP CANNOT BE HANDED TO NOBODY, and here that is not the usual
     *  lost-admin-key argument.
     *
     *  `owner` is the only address that can call `disableFallback`, and
     *  `disableFallback` is what turns the licensed claim from *"selection is
     *  on-chain and atomic with redemption"* into *"no keeper anywhere in the causal
     *  chain"*. A transfer to `address(0)` therefore froze `fallbackEnabled` at
     *  `true` forever and made the project's central claim unprovable for the life of
     *  the contract — one typo away, in a function that took any address at all.
     *
     *  A two-step handover is deliberately absent, and this test is where that
     *  decision is recorded: a transfer to a live-but-wrong address is fully
     *  recoverable here, because this contract is plain, non-upgradeable, and
     *  `Population.setWiring` repoints to a fresh one in a single transaction. Being
     *  cheap to redeploy IS the recovery mechanism.
     */
    function test_reactivity_ownershipCannotBeHandedToNobody() public {
        SelectionEngine e = _engine();

        vm.prank(owner);
        vm.expectRevert(SelectionEngine.ZeroOwner.selector);
        e.transferOwnership(address(0));
        assertEq(e.owner(), owner, "the rejected transfer must not have landed");

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(SelectionEngine.NotAuthorized.selector);
        e.transferOwnership(stranger);

        // A real handover still works, and no longer does so silently — an ownership
        // change on the contract that gates the honesty flag should be greppable in
        // the log stream, not only in storage.
        address successor = makeAddr("successor");
        vm.expectEmit(true, true, true, true, address(e));
        emit OwnershipTransferred(owner, successor);
        vm.prank(owner);
        e.transferOwnership(successor);
        assertEq(e.owner(), successor, "the accepted transfer did not land");

        // CONTROL. Two `assertEq`s on `owner()` above would both pass against a field
        // nobody can move, so require the authority itself to have followed it: the
        // old owner is now a stranger, and the new one can close the fallback.
        vm.prank(owner);
        vm.expectRevert(SelectionEngine.NotAuthorized.selector);
        e.disableFallback();

        vm.prank(successor);
        e.disableFallback();
        assertFalse(e.fallbackEnabled(), "the new owner could not exercise ownership");
    }

    /*//////////////////////////////////////////////////////////////
              THE ARENA — ANTE, SEASONS, PRIZE POOL, RAKE
    //////////////////////////////////////////////////////////////*/

    /**
     *  The ante is a climate, not a fraction of a bankroll.
     *
     *  Under the rule this replaces — `min(_stakeOf(up), _stakeOf(down))`, ten
     *  percent of each treasury — capital bought immortality: a 1,000 tUSDC
     *  organism against 10 tUSDC opponents risked ~1 tUSDC per window against 0.05
     *  of rent, so it survived hundreds of windows while losing EVERY call. A flat
     *  ante is the same number for everybody at a given level, so the only thing a
     *  larger treasury buys is more windows of being wrong.
     */
    function test_ante_isFlatWithinALevelAndIgnoresTreasury() public {
        _seed(2);

        // `fundProphet` PULLS via `transferFrom`, so the CALLER must hold and
        // approve the collateral. Minting to `address(population)` and pranking the
        // owner would revert on balance and allowance both — and no prank belongs
        // here at all, because funding an organism is permissionless by design.
        collateral.mint(address(this), 1_000 * ONE);
        collateral.approve(address(population), 1_000 * ONE);
        population.fundProphet(1, 1_000 * ONE);
        assertGt(_p(1).treasury(), _p(2).treasury() * 10, "the pair is not lopsided enough to prove anything");

        uint256 expected = population.ante();
        assertGt(expected, 0, "test is vacuous: the ante is zero");

        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();

        assertEq(_p(1).currentStake(), expected, "rich organism did not risk the ante");
        assertEq(_p(2).currentStake(), expected, "poor organism did not risk the ante");
    }

    /// @dev The climate escalates on a schedule nobody controls: every
    ///      `levelWindows` the ante multiplies by `anteMultBps`. A genome that is
    ///      merely break-even survives early and is squeezed out later, which is
    ///      what makes a season terminate instead of drifting.
    function test_ante_escalatesByLevel() public {
        Population.SeasonParams memory s = _season();
        s.baseAnte = 1 * ONE;
        s.levelWindows = 2;
        _setSeason(s);

        assertEq(population.level(), 0, "level should start at 0");
        uint256 l0 = population.ante();
        assertEq(l0, 1 * ONE, "level 0 must be the base ante exactly");

        // `windowCount` advances once per `think()`, and it does so BEFORE
        // `commitAll` reads the ante — so window 1 pairs at level 0 and window 2 at
        // level 1. Both sides stay solvent at 2 tUSDC out of a 10 tUSDC endowment,
        // which is what keeps this a test about the ante and not about death.
        _seed(2);
        _upWins();
        for (uint256 i; i < 2; ++i) {
            _pushWindow();
            _think();
            _answer(1, "UP_MOMENTUM");
            _answer(2, "DOWN_REVERSION");
            _commit();
            _settle();
        }

        assertEq(population.level(), 1, "level did not advance");
        assertEq(population.ante(), l0 * 2, "ante did not double at level 1");
        assertFalse(_p(1).dead(), "the escalation must not have killed the winner");
        assertFalse(_p(2).dead(), "the escalation must not have killed the loser yet");
    }

    /**
     *  Two revenue lines, one balance, and books that distinguish them.
     *
     *  Population's collateral balance holds the house float, every organism's rent,
     *  the house's cut of every winner's profit, and the prize pool. Without an
     *  explicit split, `withdrawRake` would be indistinguishable from the operator
     *  helping themselves to the players' pot.
     */
    function test_rake_isBookedSeparatelyFromEntrantCollateral() public {
        _seed(2);
        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();

        uint256 rakeBefore = population.rakeAccrued();
        uint256 poolBefore = population.prizePool();
        uint256 staked = _p(1).currentStake(); // read before settlement zeroes it
        _settle();

        // Income this window is BOTH lines: rent from both organisms, plus the skim
        // on the winner's profit — which under a flat ante is exactly the ante,
        // because a paired mintSet lets the winner redeem 2x what it risked.
        uint256 income = 2 * population.metabolicCost() + _skimOn(staked);
        uint256 toPool = (income * population.prizeShareBps()) / 10_000;
        assertGt(toPool, 0, "test is vacuous: prizeShareBps or income is zero");

        assertEq(population.prizePool() - poolBefore, toPool, "pool did not take its share of income");
        assertEq(population.rakeAccrued() - rakeBefore, income - toPool, "revenue not booked as rake");
    }

    /// @dev A paired `mintSet` gives each side `2 * staked` tokens for `staked`
    ///      risked, so the winner's redemption is 2x and its PROFIT is exactly
    ///      `staked`. Taxing the gross would take twice this and would tax the
    ///      organism's own returned stake — a 2.5% rake that is really 5%, levied
    ///      on capital rather than on winnings.
    function test_rake_isTakenOnProfitNotOnGrossRedemption() public {
        _seed(2);
        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();

        uint256 staked = _p(1).currentStake();
        uint256 held = _p(1).treasury(); // endowment minus the ante it just risked
        _settle();

        uint256 skim = _skimOn(staked);
        assertGt(skim, 0, "test is vacuous: rakeBps or the ante is zero");
        assertEq(
            _p(1).treasury(),
            held + 2 * staked - skim - population.metabolicCost(),
            "winner's net is not redemption - skim - rent"
        );
        _assertLedgerMatchesBalance(1);
    }

    /// @dev The rake is a claim, not a balance. `withdrawRake` may only ever draw
    ///      against what the books say the house earned — the house float, the
    ///      organisms' endowments and the prize pool sit in the same contract, and
    ///      an owner who can reach them is an owner who can rug the arena.
    function test_rake_withdrawalCannotTouchEntrantCollateral() public {
        _seed(2);
        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();

        uint256 accrued = population.rakeAccrued();
        assertGt(accrued, 0, "test is vacuous: nothing was raked");

        vm.prank(owner);
        vm.expectRevert(Population.RakeExceeded.selector);
        population.withdrawRake(owner, accrued + 1);

        uint256 held = collateral.balanceOf(address(population));
        vm.prank(owner);
        population.withdrawRake(owner, accrued);
        assertEq(population.rakeAccrued(), 0, "rake not drawn down");
        assertEq(collateral.balanceOf(owner), accrued, "the owner was not paid");
        assertEq(collateral.balanceOf(address(population)), held - accrued, "more than the rake left the arena");
        assertLe(population.prizePool(), collateral.balanceOf(address(population)), "the pot was drained with it");
    }

    /// @dev A corpse must not be a vault. What is left when an organism can no
    ///      longer pay for cognition goes to the players, not to the house — and it
    ///      must LEAVE the organism, because `stakeOut` carries the `alive` modifier
    ///      and a corpse can never be emptied afterwards.
    function test_death_residueForfeitsToThePrizePool() public {
        _seed(2);
        _makeThinkingFatal();

        uint256 poolBefore = population.prizePool();
        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();

        assertTrue(_p(1).dead(), "the winner could not afford the next thought either");
        assertTrue(_p(2).dead(), "the loser survived a fatal metabolism");
        assertGt(population.prizePool(), poolBefore, "residue did not reach the prize pool");

        // And nothing is stranded in a dead organism.
        assertEq(_p(1).treasury(), 0, "dead organism still holds a ledger balance");
        assertEq(collateral.balanceOf(address(_p(1))), 0, "dead organism still holds collateral");
        assertEq(_p(2).treasury(), 0, "dead organism still holds a ledger balance");
        assertEq(collateral.balanceOf(address(_p(2))), 0, "dead organism still holds collateral");
    }

    /// @dev A season that only the operator can close is a season the operator can
    ///      hold open until the standings suit them.
    function test_season_endsPermissionlesslyAndPaysTheEntrant() public {
        address alice = address(0xA11CE);
        uint256 id = _enter(alice, "momentum", 10 * ONE);
        _fundCognition(population.prophetCount());
        assertEq(_p(id).entrant(), alice, "the payee must be the entrant, not the house");

        Population.SeasonParams memory s = _season();
        s.seasonWindows = 1;
        _setSeason(s);

        _upWins();
        _think();
        _answer(id, "UP_MOMENTUM");
        _commit();
        _settle();

        uint256 pot = population.prizePool();
        assertGt(pot, 0, "test is vacuous: the season earned nothing to pay out");
        uint256 aliceBefore = collateral.balanceOf(alice);
        uint256 seasonBefore = population.seasonId();

        // Season length is one window, so anyone may close it.
        vm.prank(address(0xDEAD));
        population.endSeason();

        assertEq(population.seasonId(), seasonBefore + 1, "season did not roll over");
        assertEq(population.seasonStartWindow(), population.windowCount(), "the new season starts here");
        assertEq(collateral.balanceOf(alice), aliceBefore + (pot * 6_000) / 10_000, "first place was not paid 60%");
        assertEq(population.prizePool(), pot - (pot * 6_000) / 10_000, "unawarded places must roll over, not vanish");
    }

    /// @dev Permissionless is not the same as unconditional.
    function test_season_cannotBeEndedBeforeItIsOver() public {
        _seed(2);
        assertGt(population.seasonWindows(), 1, "the default season must be longer than one window");

        vm.prank(address(0xDEAD));
        vm.expectRevert(Population.SeasonNotOver.selector);
        population.endSeason();
    }

    /*//////////////////////////////////////////////////////////////
                    SEASONS — THE PRIZE PAYOUT PATH

        Everything below moves real value on a live chain, and the two
        tests above are the only coverage it used to have: one winner
        collecting 60%, and one revert. `_topThree()` had none at all.
    //////////////////////////////////////////////////////////////*/

    /**
     *  The whole 60/30/10 split, with a live claimant in every place.
     *
     *  Nothing previously asserted that second and third place are paid AT ALL,
     *  that the three cuts are struck against the SAME pot — `endSeason` reads
     *  `prizePool` once for exactly this reason — or that the rounding remainder
     *  stays in the pool. All three are exact balances here.
     *
     *  The standings are deliberately NOT in id order: id 1 is paired and right, id
     *  2 is paired and wrong, id 3 has no counterparty and abstains, so the net
     *  records are +1 / -1 / 0 and the payout order must be 1, 3, 2. A test whose
     *  winners happen to fall in id order cannot tell the split apart from the walk.
     */
    function test_season_paysSixtyThirtyTenToThreeLivingWinners() public {
        address alice = address(0xA11CE);
        address bruno = address(0xB121);
        address carol = address(0xCA201);

        assertEq(_enter(alice, "momentum", 10 * ONE), 1, "ids are assigned in entry order");
        assertEq(_enter(bruno, "reversion", 10 * ONE), 2, "ids are assigned in entry order");
        assertEq(_enter(carol, "range", 10 * ONE), 3, "ids are assigned in entry order");

        Population.SeasonParams memory s = _season();
        s.seasonWindows = 1;
        _setSeason(s);

        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _answer(3, "ABSTAIN");
        _commit();
        _settle();

        // The records the standings are derived from, asserted rather than assumed:
        // if these are not +1 / -1 / 0 the payout order below proves nothing.
        assertEq(_p(1).correctCount(), 1, "id 1 was not graded correct");
        assertEq(_p(1).wrongCount(), 0, "id 1 was graded wrong");
        assertEq(_p(2).wrongCount(), 1, "id 2 was not graded wrong");
        assertEq(_p(2).correctCount(), 0, "id 2 was graded correct");
        assertEq(_p(3).abstainCount(), 1, "id 3 found a counterparty it was not supposed to have");
        assertEq(_p(3).correctCount(), 0, "an abstention was graded");
        assertEq(_p(3).wrongCount(), 0, "an abstention was graded");
        assertEq(population.aliveCount(), 3, "all three must be alive to be ranked");

        uint256 pot = population.prizePool();
        assertGt(pot, 0, "test is vacuous: the season earned nothing to pay out");

        uint256 first = (pot * 6_000) / 10_000;
        uint256 second = (pot * 3_000) / 10_000;
        uint256 third = (pot * 1_000) / 10_000;
        assertGt(third, 0, "test is vacuous: third place's cut rounds to zero");

        uint256 aliceBefore = collateral.balanceOf(alice);
        uint256 brunoBefore = collateral.balanceOf(bruno);
        uint256 carolBefore = collateral.balanceOf(carol);
        uint256 arenaBefore = collateral.balanceOf(address(population));

        vm.prank(address(0xDEAD));
        population.endSeason();

        // 1st is id 1 (+1), 2nd is id 3 (0), 3rd is id 2 (-1).
        assertEq(collateral.balanceOf(alice), aliceBefore + first, "id 1 was not paid 60%");
        assertEq(collateral.balanceOf(carol), carolBefore + second, "id 3 was not paid 30%");
        assertEq(collateral.balanceOf(bruno), brunoBefore + third, "id 2 was not paid 10%");

        assertEq(population.prizePool(), pot - first - second - third, "the pot was not drawn down by exactly the cuts");
        assertEq(
            collateral.balanceOf(address(population)),
            arenaBefore - first - second - third,
            "more or less than the three prizes left the arena"
        );
    }

    /**
     *  `_topThree()` uses a STRICT `>`, so a tie is settled by the walk — and the
     *  walk is ascending by id. Ties therefore favour the LOWER id, and that is a
     *  real economic rule (an early entrant outranks a later one on an identical
     *  record), not an implementation detail.
     *
     *  Constructed so the comparison is observable at BOTH ends of the standings:
     *  ids 1 and 2 tie at +1 and ids 3 and 4 tie at -1. Under `>=` the shift chain
     *  would run on every equal score and the result would be [2, 1, 4] — a
     *  different organism in first place and a different one paid at all — so this
     *  discriminates the operator rather than merely exercising it.
     */
    function test_season_topThreeBreaksTiesTowardTheLowerId() public {
        address alice = address(0xA11CE);
        address bruno = address(0xB121);
        address carol = address(0xCA201);
        address dora = address(0xD012A);

        assertEq(_enter(alice, "momentum", 10 * ONE), 1, "ids are assigned in entry order");
        assertEq(_enter(bruno, "breakout", 10 * ONE), 2, "ids are assigned in entry order");
        assertEq(_enter(carol, "reversion", 10 * ONE), 3, "ids are assigned in entry order");
        assertEq(_enter(dora, "range", 10 * ONE), 4, "ids are assigned in entry order");

        Population.SeasonParams memory s = _season();
        s.seasonWindows = 1;
        _setSeason(s);

        // `commitAll` pairs ups[i] with downs[i] in living order, so this is
        // (1 vs 3) and (2 vs 4) — two winners and two losers, tied pairwise.
        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "UP_BREAKOUT");
        _answer(3, "DOWN_REVERSION");
        _answer(4, "DOWN_RANGE");
        _commit();
        _settle();

        // THE VACUITY GUARD, and it is the whole test: without an actual tie the
        // assertions below would pass on a `>=` implementation too.
        assertEq(_p(1).correctCount(), _p(2).correctCount(), "ids 1 and 2 must tie");
        assertEq(_p(1).wrongCount(), _p(2).wrongCount(), "ids 1 and 2 must tie");
        assertEq(_p(3).correctCount(), _p(4).correctCount(), "ids 3 and 4 must tie");
        assertEq(_p(3).wrongCount(), _p(4).wrongCount(), "ids 3 and 4 must tie");
        assertEq(_p(1).correctCount(), 1, "the winners were not graded correct");
        assertEq(_p(3).wrongCount(), 1, "the losers were not graded wrong");
        assertEq(population.aliveCount(), 4, "all four must be alive to be ranked");

        uint256 pot = population.prizePool();
        assertGt(pot, 0, "test is vacuous: the season earned nothing to pay out");
        uint256 first = (pot * 6_000) / 10_000;
        uint256 second = (pot * 3_000) / 10_000;
        uint256 third = (pot * 1_000) / 10_000;
        assertGt(third, 0, "test is vacuous: third place's cut rounds to zero");

        uint256 aliceBefore = collateral.balanceOf(alice);
        uint256 brunoBefore = collateral.balanceOf(bruno);
        uint256 carolBefore = collateral.balanceOf(carol);
        uint256 doraBefore = collateral.balanceOf(dora);

        vm.prank(address(0xDEAD));
        population.endSeason();

        assertEq(collateral.balanceOf(alice), aliceBefore + first, "the lower of the two tied leaders must take 60%");
        assertEq(collateral.balanceOf(bruno), brunoBefore + second, "the higher of the two tied leaders takes 30%");
        assertEq(collateral.balanceOf(carol), carolBefore + third, "the lower of the two tied losers takes 10%");
        assertEq(collateral.balanceOf(dora), doraBefore, "id 4 tied id 3 and must lose the tie to the lower id");
    }

    /**
     *  Survival is a CONDITION, not a tiebreak: a corpse is skipped however good its
     *  record was.
     *
     *  Death here is `retire`, which is the sharper case rather than the convenient
     *  one — a starving organism is by definition a poor one, but a retiring entrant
     *  cashes out at will and could otherwise take the collateral home AND collect
     *  first prize on the way out. `_topThree()` cannot see the difference; it reads
     *  `dead()`, which `retire` sets.
     *
     *  The corpse has the strictly best lifetime record (+2 against +1 / -1 / -2), so
     *  removing the `dead()` guard changes both who is paid and how much: the
     *  standings become [1, 2, 4] instead of [2, 4, 3].
     */
    function test_season_topThreeSkipsTheDeadHoweverGoodTheirRecord() public {
        address alice = address(0xA11CE);
        address bruno = address(0xB121);
        address carol = address(0xCA201);
        address dora = address(0xD012A);

        assertEq(_enter(alice, "momentum", 10 * ONE), 1, "ids are assigned in entry order");
        assertEq(_enter(bruno, "breakout", 10 * ONE), 2, "ids are assigned in entry order");
        assertEq(_enter(carol, "reversion", 10 * ONE), 3, "ids are assigned in entry order");
        assertEq(_enter(dora, "range", 10 * ONE), 4, "ids are assigned in entry order");

        Population.SeasonParams memory s = _season();
        s.seasonWindows = 2;
        _setSeason(s);
        _upWins();

        // Window 1: (1 vs 3) and (2 vs 4). Window 2: only 1 vs 3, with 2 and 4
        // abstaining, which is what spreads the four records to +2 / +1 / -1 / -2.
        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "UP_BREAKOUT");
        _answer(3, "DOWN_REVERSION");
        _answer(4, "DOWN_RANGE");
        _commit();
        _settle();

        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "ABSTAIN");
        _answer(3, "DOWN_REVERSION");
        _answer(4, "ABSTAIN");
        _commit();
        _settle();

        assertEq(_p(1).correctCount(), 2, "id 1 must hold the best record in the arena");
        assertEq(_p(1).wrongCount(), 0, "id 1 must hold the best record in the arena");
        assertEq(_p(2).correctCount(), 1, "id 2's record is the runner-up");
        assertEq(_p(2).wrongCount(), 0, "id 2's record is the runner-up");
        assertEq(_p(3).wrongCount(), 2, "id 3 must hold the worst record in the arena");
        assertEq(_p(4).wrongCount(), 1, "id 4 must sit between id 2 and id 3");

        // The best organism in the arena leaves, and takes its collateral with it.
        vm.prank(alice);
        population.retire(1);
        assertTrue(_p(1).dead(), "retire did not kill the organism");
        assertEq(population.aliveCount(), 3, "the corpse is still counted alive");

        uint256 pot = population.prizePool();
        assertGt(pot, 0, "test is vacuous: the season earned nothing to pay out");
        uint256 first = (pot * 6_000) / 10_000;
        uint256 second = (pot * 3_000) / 10_000;
        uint256 third = (pot * 1_000) / 10_000;
        assertGt(third, 0, "test is vacuous: third place's cut rounds to zero");

        // Captured AFTER the retirement, so this is only about the prize.
        uint256 aliceBefore = collateral.balanceOf(alice);
        uint256 brunoBefore = collateral.balanceOf(bruno);
        uint256 carolBefore = collateral.balanceOf(carol);
        uint256 doraBefore = collateral.balanceOf(dora);

        vm.prank(address(0xDEAD));
        population.endSeason();

        assertEq(collateral.balanceOf(alice), aliceBefore, "a corpse's entrant was paid a prize");
        assertEq(collateral.balanceOf(bruno), brunoBefore + first, "id 2 (+1) was not paid 60%");
        assertEq(collateral.balanceOf(dora), doraBefore + second, "id 4 (-1) was not paid 30%");
        assertEq(collateral.balanceOf(carol), carolBefore + third, "id 3 (-2) was not paid 10%");
        assertEq(population.prizePool(), pot - first - second - third, "the pot was not drawn down by exactly the cuts");
    }

    /**
     *  The score is a LIFETIME net record, not a per-season one.
     *
     *  That is a design decision with teeth and it is currently invisible: nothing
     *  else in this file runs two seasons, so nothing distinguishes lifetime from
     *  per-season scoring. Here they disagree outright — id 2 wins every window of
     *  season 2 and id 1 wins none of them, yet id 1 takes first place on a record
     *  built up in season 1. An arena that reset scores at the season boundary would
     *  reverse both payouts.
     *
     *  Not asserted as approval of the rule, only as its contract: an entrant joining
     *  season 3 competes against every window season 1 ever graded, and if that is
     *  the wrong economics it has to be changed deliberately rather than discovered.
     */
    function test_season_topThreeScoresLifetimeRecordNotThisSeasonsRecord() public {
        address alice = address(0xA11CE);
        address bruno = address(0xB121);

        assertEq(_enter(alice, "momentum", 10 * ONE), 1, "ids are assigned in entry order");
        assertEq(_enter(bruno, "reversion", 10 * ONE), 2, "ids are assigned in entry order");

        Population.SeasonParams memory s = _season();
        s.seasonWindows = 3;
        _setSeason(s);
        _upWins();

        // SEASON 1 — id 1 is right three times, id 2 is wrong three times.
        for (uint256 i; i < 3; ++i) {
            _pushWindow();
            _think();
            _answer(1, "UP_MOMENTUM");
            _answer(2, "DOWN_REVERSION");
            _commit();
            _settle();
        }
        vm.prank(address(0xDEAD));
        population.endSeason();
        assertEq(population.seasonId(), 2, "season 1 did not close");

        uint32 aliceCorrectAtBreak = _p(1).correctCount();
        uint32 brunoCorrectAtBreak = _p(2).correctCount();

        // SEASON 2 — the roles reverse, then both abstain to reach the third window.
        for (uint256 i; i < 2; ++i) {
            _pushWindow();
            _think();
            _answer(1, "DOWN_MOMENTUM");
            _answer(2, "UP_REVERSION");
            _commit();
            _settle();
        }
        _pushWindow();
        _think();
        _answer(1, "ABSTAIN");
        _answer(2, "ABSTAIN");
        _commit();
        _settle();

        // WITHIN SEASON 2, id 2 strictly dominates: two wins to nil.
        assertEq(_p(2).correctCount() - brunoCorrectAtBreak, 2, "id 2 must win both graded windows of season 2");
        assertEq(_p(1).correctCount() - aliceCorrectAtBreak, 0, "id 1 must win nothing in season 2");

        // OVER ITS LIFETIME, id 1 is still ahead: 3-2 against 2-3.
        assertEq(_p(1).correctCount(), 3, "id 1's lifetime record");
        assertEq(_p(1).wrongCount(), 2, "id 1's lifetime record");
        assertEq(_p(2).correctCount(), 2, "id 2's lifetime record");
        assertEq(_p(2).wrongCount(), 3, "id 2's lifetime record");
        assertEq(population.prophetCount(), 2, "an unexpected birth would change the standings");

        uint256 pot = population.prizePool();
        assertGt(pot, 0, "test is vacuous: the season earned nothing to pay out");
        uint256 first = (pot * 6_000) / 10_000;
        uint256 second = (pot * 3_000) / 10_000;

        uint256 aliceBefore = collateral.balanceOf(alice);
        uint256 brunoBefore = collateral.balanceOf(bruno);

        vm.prank(address(0xDEAD));
        population.endSeason();

        assertEq(population.seasonId(), 3, "season 2 did not close");
        assertEq(collateral.balanceOf(alice), aliceBefore + first, "the better LIFETIME record was not paid 60%");
        assertEq(collateral.balanceOf(bruno), brunoBefore + second, "the better SEASON record was not paid 30%");
    }

    /**
     *  THE RESOLUTION OF THE PINNED FINDING: a founder's prize goes to the Genesis
     *  Treasury, and the operator's balance does not move.
     *
     *  What this replaces. Until 2026-09-05 `spawnGenesis` passed `msg.sender` as the
     *  founders' `entrant` and was `onlyOwner`, so a founder in the top three paid 60%
     *  of the players' pot straight to the operator's EOA — and did it WITHOUT touching
     *  `rakeAccrued`, i.e. outside the one cap the contract puts on operator
     *  withdrawals (`withdrawRake`'s `RakeExceeded`). Measured then: a 42,500 pot paid
     *  the owner 25,500 with `rakeAccrued` unmoved. The predecessor of this test
     *  asserted exactly that, deliberately, so the finding could not be lost.
     *
     *  The third assertion is the actual claim; the first two are what make it
     *  non-vacuous. `treasury += cut` alone would pass if the treasury WERE the owner,
     *  and `rakeAccrued` unmoved alone would pass if nothing had been paid at all.
     *
     *  The founders are the protocol's seed position, so their winnings land in a
     *  contract with no owner, no withdrawal and one outlet — `recycle()`, back into
     *  the players' pot. `endSeason`'s `to == address(0)` guard survives as a
     *  revert-proofing measure rather than as a claim about founders; see the rewritten
     *  comment at its site.
     */
    function test_season_founderPrizeGoesToTheTreasuryAndNotTheOwner() public {
        _seed(1); // the arena's own organism — nobody entered it
        address alice = address(0xA11CE);
        assertEq(_enter(alice, "reversion", 10 * ONE), 2, "the entrant's organism is id 2");

        // THE PRECONDITION. Hoisted into a local before any prank-bearing call, and
        // asserted as a pair: `== treasury` on its own would still hold if a future
        // change made the treasury address be the owner, which is the whole bug.
        address treasury = population.genesisTreasury();
        assertEq(_p(1).entrant(), treasury, "a founder's entrant must be the Genesis Treasury");
        assertTrue(treasury != owner, "test is vacuous: the treasury is the owner's address");

        Population.SeasonParams memory s = _season();
        s.seasonWindows = 1;
        _setSeason(s);

        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();

        assertEq(_p(1).correctCount(), 1, "the founder must finish first for this to test the branch");
        assertEq(_p(2).wrongCount(), 1, "the entrant must finish second for this to test the branch");

        uint256 pot = population.prizePool();
        assertGt(pot, 0, "test is vacuous: the season earned nothing to pay out");
        uint256 founderCut = (pot * 6_000) / 10_000;
        uint256 entrantCut = (pot * 3_000) / 10_000;
        assertGt(entrantCut, 0, "test is vacuous: second place's cut rounds to zero");

        uint256 aliceBefore = collateral.balanceOf(alice);
        uint256 arenaBefore = collateral.balanceOf(address(population));
        uint256 founderHeld = collateral.balanceOf(address(_p(1)));
        uint256 ownerBefore = collateral.balanceOf(owner);
        uint256 treasuryBefore = collateral.balanceOf(treasury);
        uint256 rakeBefore = population.rakeAccrued();

        vm.prank(address(0xDEAD));
        population.endSeason();

        // 1. The 60% reached the treasury.
        assertEq(
            collateral.balanceOf(treasury), treasuryBefore + founderCut, "the founder's 60% did not reach the treasury"
        );
        // 2. It did not pass through the house's book on the way.
        assertEq(population.rakeAccrued(), rakeBefore, "the founder's cut moved rakeAccrued");
        // 3. THE CLAIM. The operator was paid nothing.
        assertEq(collateral.balanceOf(owner), ownerBefore, "the operator was paid a founder's prize");

        assertEq(collateral.balanceOf(alice), aliceBefore + entrantCut, "second place was not paid 30%");
        assertEq(
            population.prizePool(), pot - founderCut - entrantCut, "only the vacant third place should have rolled over"
        );
        assertEq(
            collateral.balanceOf(address(population)),
            arenaBefore - founderCut - entrantCut,
            "the collateral that left the arena is not the two cuts"
        );

        assertEq(collateral.balanceOf(address(_p(1))), founderHeld, "the prize went to the entrant, not the organism");
        assertEq(collateral.balanceOf(address(0)), 0, "a prize was transferred to the zero address");
    }

    /*//////////////////////////////////////////////////////////////
                            GENESIS TREASURY
    //////////////////////////////////////////////////////////////*/

    /// @dev The four reads a judge with an explorer makes, as one test. `setUp` has
    ///      already run the factory, so this asserts the state a live arena is in.
    function test_genesis_foundersBelongToTheTreasuryNotTheOwner() public {
        _seed(2);
        address treasury = population.genesisTreasury();

        assertTrue(treasury != address(0), "the factory did not record a treasury");
        assertTrue(treasury != owner, "the treasury is the operator's EOA");
        assertEq(_p(1).entrant(), treasury, "founder 1 does not belong to the treasury");
        assertEq(_p(2).entrant(), treasury, "founder 2 does not belong to the treasury");

        // The treasury knows which arena it serves, and reads the token off it rather
        // than holding an immutable copy — so a `setWiring` repoint cannot strand it.
        GenesisTreasury t = GenesisTreasury(treasury);
        assertEq(t.arena(), address(population), "the treasury is bound to another arena");
        assertEq(t.collateral(), address(collateral), "the treasury reads the wrong collateral");
        assertEq(t.totalRecycled(), 0, "nothing has been recycled yet");

        // `arena` is immutable and every outlet in the file reads through it, so a
        // treasury built against zero would be a contract holding collateral with no
        // code path out. The factory can never pass zero, but a hand-deployment could,
        // and this is the assertion that keeps the constructor guard from being
        // decorative — nothing else in the suite reaches it.
        vm.expectRevert(GenesisTreasury.ZeroArena.selector);
        new GenesisTreasury(address(0));
    }

    /**
     *  A founder can never be minted ownerless, and the treasury can never be replaced.
     *
     *  Both halves guard the same hazard from opposite ends. `entrant` is written
     *  exactly once ever (`Prophet.initialize`), so a founder minted against
     *  `address(0)` would be permanently ownerless AND permanently unretirable —
     *  `retire` requires `msg.sender == entrant`, which nobody can satisfy. There is no
     *  repair path, which is why `spawnGenesis` refuses rather than defaulting.
     *
     *  A BARE PROXY, not `population`: `setUp` has already run the factory on that one,
     *  so the refusal is not reachable there. This is the only test in the file that
     *  stands up an arena without a treasury, and that is the point.
     */
    function test_genesis_spawnRefusesWithoutATreasury() public {
        Population impl = new Population();
        bytes memory init = abi.encodeCall(
            Population.initialize,
            (
                owner,
                Population.Wiring({
                    agentRequester: address(requester),
                    settlement: address(settlement),
                    marketsModule: address(module),
                    outcomeToken: address(outcomeToken),
                    collateral: address(collateral),
                    prophetBeacon: address(beacon),
                    priceSource: address(priceSource),
                    venue: address(venue),
                    llmAgentId: 1,
                    symbol: "BTC"
                })
            )
        );
        Population bare = Population(payable(address(new ERC1967Proxy(address(impl), init))));
        collateral.mint(address(bare), 10_000 * ONE);
        vm.deal(address(bare), 100 ether);

        assertEq(bare.genesisTreasury(), address(0), "a fresh proxy must have no treasury");

        string[] memory genomes = new string[](1);
        genomes[0] = "momentum";
        vm.prank(owner);
        vm.expectRevert(Population.NoGenesisTreasury.selector);
        bare.spawnGenesis(genomes);
        assertEq(bare.prophetCount(), 0, "a founder was minted against a zero treasury");

        // The factory is `onlyOwner`, so it is not a public path to a treasury either.
        vm.prank(address(0xBAD));
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), address(0xBAD)));
        bare.deployGenesisTreasury();

        vm.prank(owner);
        address t = bare.deployGenesisTreasury();
        assertEq(bare.genesisTreasury(), t, "the factory did not record what it returned");

        // And now the same call that refused above succeeds, which is the control that
        // stops the revert assertion from passing for some unrelated reason.
        vm.prank(owner);
        bare.spawnGenesis(genomes);
        assertEq(bare.prophetCount(), 1, "the founder was not minted once a treasury existed");
        assertEq(Prophet(payable(bare.prophetAt(1))).entrant(), t, "the founder does not belong to the new treasury");
    }

    /**
     *  ONCE, EVER. This is what makes "the treasury can never become an EOA" checkable
     *  without reading access control: there is no setter anywhere, and the one creator
     *  refuses to run a second time.
     *
     *  Run against the REAL arena rather than a bare proxy, because the state this
     *  asserts on is the state every other test and the live deploy are already in —
     *  `setUp` ran the factory. That successful first call is also the control: the
     *  revert below cannot be passing because `deployGenesisTreasury` is broken, since
     *  the treasury it created is a live `GenesisTreasury` bound to this arena.
     */
    function test_genesis_theTreasuryCanNeverBeReplaced() public {
        address t = population.genesisTreasury();
        assertTrue(t != address(0), "setUp did not deploy a treasury, so there is nothing to replace");
        assertEq(GenesisTreasury(t).arena(), address(population), "the recorded treasury is not this arena's");

        vm.prank(owner);
        vm.expectRevert(Population.TreasuryAlreadySet.selector);
        population.deployGenesisTreasury();
        assertEq(population.genesisTreasury(), t, "the treasury address moved");

        // Not even a fresh owner. `transferOwnership` is the only way the operator key
        // rotates, and it must not hand the new holder a second chance at the one
        // address the whole no-owner argument rests on.
        address successor = address(0x50CC);
        vm.prank(owner);
        population.transferOwnership(successor);
        vm.prank(successor);
        vm.expectRevert(Population.TreasuryAlreadySet.selector);
        population.deployGenesisTreasury();
        assertEq(population.genesisTreasury(), t, "an owner rotation reopened the factory");
    }

    /**
     *  `recycle()` is permissionless, and the players' pot is the only place it reaches.
     *
     *  The three "did not move" assertions are the substance. A `recycle` that also
     *  incremented `rakeAccrued`, or that left collateral behind, would satisfy the
     *  first assertion alone — so the pot rising is necessary and nowhere near
     *  sufficient.
     */
    function test_genesisTreasury_recycleIsPermissionlessAndOnlyReachesThePlayers() public {
        _seed(1);
        GenesisTreasury t = GenesisTreasury(population.genesisTreasury());

        // THE CONTROL, and it runs first: an empty treasury says so rather than
        // silently succeeding with a zero transfer, which would make the assertions
        // below true of a no-op.
        vm.prank(address(0xBAD));
        vm.expectRevert(GenesisTreasury.NothingToRecycle.selector);
        t.recycle();

        // Fund it the way a season would: put collateral in it directly, since
        // `endSeason` transfers to the `entrant` and this is that address.
        uint256 amount = 1_234 * ONE;
        collateral.mint(address(t), amount);

        uint256 potBefore = population.prizePool();
        uint256 rakeBefore = population.rakeAccrued();
        uint256 arenaBefore = collateral.balanceOf(address(population));

        // A STRANGER, deliberately. There is no privileged caller because there is no
        // privileged destination.
        vm.prank(address(0xBAD));
        uint256 moved = t.recycle();

        assertEq(moved, amount, "recycle did not report what it moved");
        assertEq(population.prizePool(), potBefore + amount, "the players' pot did not rise by the whole balance");
        assertEq(collateral.balanceOf(address(t)), 0, "the treasury kept some of it");
        assertEq(collateral.balanceOf(address(population)), arenaBefore + amount, "the arena did not receive it");
        assertEq(population.rakeAccrued(), rakeBefore, "recycle moved the house's book");
        assertEq(t.totalRecycled(), amount, "totalRecycled disagrees with what moved");

        // Twice over: the counter accumulates rather than overwrites, and the second
        // pass proves the first did not leave the treasury in a state it cannot repeat.
        collateral.mint(address(t), amount);
        vm.prank(address(0xBAD));
        t.recycle();
        assertEq(t.totalRecycled(), 2 * amount, "totalRecycled did not accumulate");
        assertEq(population.prizePool(), potBefore + 2 * amount, "the second recycle did not reach the pot");
    }

    /**
     *  §5.1 OF THE SPEC, PINNED AS INTENDED BEHAVIOUR: the founder lineage is permanently
     *  unretirable, and 8 x `endowment` of house collateral is committed for the life of
     *  the arena.
     *
     *  This is the HLP parallel done honestly — the protocol's own capital is not
     *  withdrawable at the operator's convenience — and it is written down as a test
     *  rather than a comment so nobody rediscovers it later as a bug and "fixes" it by
     *  adding an owner-callable exit. The founders leave the arena the way every other
     *  organism does: by dying. Death is not a leak, because an organism dies at zero
     *  treasury.
     */
    function test_genesis_lineageInheritsTheTreasuryAndCannotBeRetired() public {
        _seed(1);
        address treasury = population.genesisTreasury();
        address alice = address(0xA11CE);
        uint256 foil = _enter(alice, "reversion", 50 * ONE);

        // A ONE-WINDOW STREAK IS NOT ENOUGH ON ITS OWN. `_settle` gates breeding on
        // BOTH `streak() >= breedStreak` AND `treasury() >= _breedThreshold()`, and a
        // founder seeded at exactly `endowment` cannot reach 1.5x endowment off one
        // winning window. Funded rather than relaxing `breedSurplusBps`, so the
        // lineage this test asserts on is one the deployed economy would actually
        // produce.
        collateral.mint(address(this), 1_000 * ONE);
        collateral.approve(address(population), type(uint256).max);
        population.fundProphet(1, 500 * ONE);

        Econ memory e = _econ();
        e.breedStreak = 1;
        _setEconomics(e);

        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(foil, "DOWN_REVERSION");
        _commit();
        _settle();

        requester.deliver(_p(1).pendingMutationRequestId(), "mutated momentum");
        vm.prank(owner);
        population.hatchAll();

        uint256 child = population.prophetCount();
        assertGt(child, foil, "no child was born, so the inheritance claim is untested");
        assertEq(_p(child).parentId(), 1, "the child is not the founder's");
        assertEq(_p(child).entrant(), treasury, "the child did not inherit the treasury");

        // NOT EVEN THE OWNER. `retire` requires `msg.sender == entrant`, and the
        // treasury has no path to `Population.retire` — no arbitrary call, no owner.
        vm.prank(owner);
        vm.expectRevert(Population.NotEntrant.selector);
        population.retire(1);
        vm.prank(owner);
        vm.expectRevert(Population.NotEntrant.selector);
        population.retire(child);

        // Nor a stranger, and nor the treasury address itself if someone could somehow
        // send from it — asserted because `vm.prank` can, and a reader should see that
        // the refusal is about the CALLER not being able to exist, not about the check.
        vm.prank(address(0xBAD));
        vm.expectRevert(Population.NotEntrant.selector);
        population.retire(1);

        assertFalse(_p(1).dead(), "the founder was retired after all");
        assertFalse(_p(child).dead(), "the child was retired after all");

        // THE CONTROL: `retire` itself is not broken. An entrant's own organism still
        // exits, so the three reverts above are about ownership rather than about
        // `retire` having been disabled.
        vm.prank(alice);
        population.retire(foil);
        assertTrue(_p(foil).dead(), "an entrant can no longer retire their own organism");
    }

    /**
     *  `sweep` may not draw the collateral the two books are claims on — and the
     *  `CognitionUnspent` remedy still works.
     *
     *  This replaces `test_sweep_canOverdrawTheBooksAndStrandTheSeason`, which pinned
     *  the hole as a known finding on the argument that a book-aware cap "would block
     *  the recovery `sweep` exists for". That argument over-reaches by exactly one step,
     *  and the over-reach is checkable: stranded cognition is NATIVE, so the remedy
     *  lives entirely in the `token == address(0)` leg and a collateral-only cap cannot
     *  touch it. The second half of this test is that claim in executable form.
     *
     *  Without the cap, `GenesisTreasury` is decorative: a reader who greps `onlyOwner`
     *  finds a path from the players' pot to the operator, and the treasury reads as
     *  theatre.
     */
    function test_sweep_cannotOverdrawTheCollateralBooksButStillRecoversStrandedCognition() public {
        _seed(2);
        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();

        uint256 pot = population.prizePool();
        uint256 rake = population.rakeAccrued();
        uint256 reserved = pot + rake;
        assertGt(pot, 0, "test is vacuous: the books hold nothing to protect");
        assertGt(rake, 0, "test is vacuous: the house book is empty");

        uint256 held = collateral.balanceOf(address(population));
        assertGt(held, reserved, "precondition: there must be unreserved collateral to sweep");

        // One wei past the books is refused.
        vm.prank(owner);
        vm.expectRevert(Population.BooksReserved.selector);
        population.sweep(address(collateral), owner, held - reserved + 1);

        // And everything up to them is not — the cap is a cap, not a freeze.
        uint256 free = held - reserved;
        vm.prank(owner);
        population.sweep(address(collateral), owner, free);
        assertEq(collateral.balanceOf(address(population)), reserved, "the sweep did not draw the free collateral");
        assertEq(population.prizePool(), pot, "the sweep touched the players' book");
        assertEq(population.rakeAccrued(), rake, "the sweep touched the house's book");

        // At the boundary there is nothing left, and it still says so rather than
        // succeeding with a silent zero.
        vm.prank(owner);
        vm.expectRevert(Population.BooksReserved.selector);
        population.sweep(address(collateral), owner, 1);

        // THE CONTROL THAT STOPS THE CAP FROM BEING A REGRESSION. `CognitionUnspent` is
        // a NATIVE amount and its documented remedy is `sweep(address(0), organism, n)`.
        // The address is resolved into a local FIRST: `_p(1)` is a call and would eat
        // the prank. See the `_econ()` note.
        address p1 = address(_p(1));
        vm.deal(address(population), 5 ether);
        uint256 cognitionBefore = p1.balance;
        vm.prank(owner);
        population.sweep(address(0), p1, 2 ether);
        assertEq(p1.balance, cognitionBefore + 2 ether, "the cap broke the CognitionUnspent remedy");
        assertEq(address(population).balance, 3 ether, "more native left the arena than was swept");

        // The season can still close, which is the state the deleted test pinned as
        // unreachable-from: `endSeason` reverting on `TransferFailed` forever.
        Population.SeasonParams memory s = _season();
        s.seasonWindows = 1;
        _setSeason(s);
        vm.prank(address(0xDEAD));
        population.endSeason();
        assertEq(population.seasonId(), 2, "the season could not close after the sweep");
    }

    /// @dev `donatePrizePool` in isolation: the only inbound path to the players' book,
    ///      and it must not become an outbound one in reverse. Asserted from a plain
    ///      address rather than through `recycle()` so the function is covered
    ///      independently of the treasury that motivates it.
    function test_prizePool_canBeDonatedToButNeverDrawnFrom() public {
        _seed(1);
        address donor = address(0xD0A0);
        uint256 amount = 500 * ONE;
        collateral.mint(donor, amount);

        vm.prank(donor);
        vm.expectRevert(Population.ZeroAmount.selector);
        population.donatePrizePool(0);

        uint256 potBefore = population.prizePool();
        uint256 rakeBefore = population.rakeAccrued();

        vm.prank(donor);
        collateral.approve(address(population), amount);
        vm.prank(donor);
        population.donatePrizePool(amount);

        assertEq(population.prizePool(), potBefore + amount, "the pot did not rise by the donation");
        assertEq(population.rakeAccrued(), rakeBefore, "a donation reached the house's book");
        assertEq(collateral.balanceOf(donor), 0, "the donor was not actually debited");

        // The donation is immediately reserved: the owner cannot take it back out.
        uint256 held = collateral.balanceOf(address(population));
        uint256 reserved = population.prizePool() + population.rakeAccrued();
        vm.prank(owner);
        vm.expectRevert(Population.BooksReserved.selector);
        population.sweep(address(collateral), owner, held - reserved + 1);

        // And `withdrawRake` cannot reach it either, which is the other half of "no path
        // back to the donor".
        vm.prank(owner);
        vm.expectRevert(Population.RakeExceeded.selector);
        population.withdrawRake(owner, rakeBefore + 1);
    }

    /**
     *  THE CONTRACT BETWEEN `endSeason` AND `scripts/cadence.ts`.
     *
     *  `reportSeasonClose()` reads the close out of the receipt rather than out of
     *  storage, because `endSeason` moves `seasonId`, `seasonStartWindow` and
     *  `prizePool` in the same transaction and a post-hoc read would report the NEW
     *  season's empty state as the old one's result. So these two logs ARE the record,
     *  and four properties of them are load-bearing off-chain:
     *
     *    - `SeasonEnded.pot` and `.paid`, from which the script derives the rollover
     *      it prints as `pot - paid`;
     *    - `SeasonEnded.season` and `SeasonPrizePaid.season` carrying the
     *      PRE-INCREMENT id, so the log names the season that just finished;
     *    - `SeasonPrizePaid.prophetId` / `.to` / `.amount`, printed per winner;
     *    - `.amount` as a SHARE OF `SeasonEnded.pot`, which is how the script names the
     *      place. It deliberately does NOT count log positions: `endSeason` skips a
     *      vacant place instead of compacting it, so the k-th log is not the k-th place
     *      and a positional label announces the true 3rd as 2nd. 60/30/10 in tenths of a
     *      percent are 6000 / 3000 / 1000 bps, so nearest-of-three has 1500 bps of room
     *      either side and the two integer divisions cannot reach a wrong bucket.
     *
     *  What the ORDER still carries is the ranking itself — best first — which is a
     *  property of `_topThree()` rather than of the payout. Standings here are 1, 3, 2
     *  rather than 1, 2, 3 precisely so that claim stays falsifiable: the amounts pin
     *  each place, and the emit sequence pins who earned it.
     */
    function test_season_emitsTheStandingsTheCadenceScriptDecodes() public {
        address alice = address(0xA11CE);
        address bruno = address(0xB121);
        address carol = address(0xCA201);

        assertEq(_enter(alice, "momentum", 10 * ONE), 1, "ids are assigned in entry order");
        assertEq(_enter(bruno, "reversion", 10 * ONE), 2, "ids are assigned in entry order");
        assertEq(_enter(carol, "range", 10 * ONE), 3, "ids are assigned in entry order");

        Population.SeasonParams memory s = _season();
        s.seasonWindows = 1;
        _setSeason(s);

        _upWins();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _answer(3, "ABSTAIN");
        _commit();
        _settle();

        uint256 pot = population.prizePool();
        assertGt(pot, 0, "test is vacuous: the season earned nothing to pay out");
        uint256 first = (pot * 6_000) / 10_000;
        uint256 second = (pot * 3_000) / 10_000;
        uint256 third = (pot * 1_000) / 10_000;

        // PRE-INCREMENT, which is the half of the claim a `seasonId - 1` in the script
        // would silently invert.
        uint32 season = population.seasonId();
        assertEq(season, 1, "the fixture must still be in season 1");

        vm.expectEmit(true, true, true, true, address(population));
        emit Population.SeasonPrizePaid(season, 1, alice, first);
        vm.expectEmit(true, true, true, true, address(population));
        emit Population.SeasonPrizePaid(season, 3, carol, second);
        vm.expectEmit(true, true, true, true, address(population));
        emit Population.SeasonPrizePaid(season, 2, bruno, third);
        vm.expectEmit(true, false, false, true, address(population));
        emit Population.SeasonEnded(season, pot, first + second + third);

        vm.prank(address(0xDEAD));
        population.endSeason();

        assertEq(population.seasonId(), season + 1, "the emitted id must be the season that just finished");
    }

    /**
     *  Two consecutive seasons, and the first direct test of `level()` anywhere.
     *
     *  `endSeason` anchors the next season at `windowCount` rather than at
     *  `seasonStartWindow + seasonWindows`, and that choice is what makes `level()`
     *  fall back to 0 — the ante genuinely restarts at the base rather than
     *  continuing to escalate across the boundary. Dating the next season from a
     *  window already past would shorten it by however late the close was; far
     *  enough late, it would open already over.
     *
     *  The pot assertion is the other half: what the standings did not claim in
     *  season 1 must still be in the pool when season 2 closes. Both seasons here
     *  earn identical income — same rents, same antes, same skims, no deaths — so
     *  season 2's pot must be season 1's pot PLUS season 1's rollover, exactly.
     */
    function test_level_reAnchorsToZeroWhenTheSeasonRollsOver() public {
        Population.SeasonParams memory s = _season();
        s.baseAnte = 1 * ONE;
        s.levelWindows = 1; // one doubling per window, so the escalation is visible in two
        s.seasonWindows = 2;
        _setSeason(s);

        // Breeding out of the way: a child would change both the standings and the
        // arithmetic, and this test is about the clock.
        Econ memory e = _econ();
        e.breedStreak = 1_000;
        _setEconomics(e);

        assertEq(population.windowCount(), 0, "no window has opened yet");
        assertEq(population.level(), 0, "a season opens at level 0");
        assertEq(population.ante(), 1 * ONE, "level 0 must be the base ante exactly");

        address alice = address(0xA11CE);
        address bruno = address(0xB121);
        assertEq(_enter(alice, "momentum", 200 * ONE), 1, "ids are assigned in entry order");
        assertEq(_enter(bruno, "reversion", 200 * ONE), 2, "ids are assigned in entry order");
        _upWins();

        // SEASON 1. `windowCount` advances in `think()`, before `commitAll` reads the
        // ante, so these two windows pair at level 1 and level 2.
        for (uint256 i; i < 2; ++i) {
            _pushWindow();
            _think();
            _answer(1, "UP_MOMENTUM");
            _answer(2, "DOWN_REVERSION");
            _commit();
            _settle();
        }

        assertEq(population.windowCount(), 2, "two windows should have opened");
        assertEq(population.level(), 2, "at one window per level, two windows is level 2");
        assertEq(population.ante(), 4 * ONE, "the ante must have doubled twice");

        uint256 pot1 = population.prizePool();
        assertGt(pot1, 0, "test is vacuous: season 1 earned nothing");
        uint256 claimed1 = (pot1 * 6_000) / 10_000 + (pot1 * 3_000) / 10_000;

        vm.prank(address(0xDEAD));
        population.endSeason();

        assertEq(population.seasonId(), 2, "season 1 did not close");
        assertEq(population.seasonStartWindow(), 2, "the new season must be anchored at the closing window");
        assertEq(population.level(), 0, "level did not fall back to 0 with the new season");
        assertEq(population.ante(), 1 * ONE, "the ante did not fall back to the base");

        // Third place was vacant, so 10% rolls forward. That number carries the whole
        // second half of this test, so it must not be zero.
        uint256 rollover = population.prizePool();
        assertEq(rollover, pot1 - claimed1, "the unclaimed share was not carried forward");
        assertGt(rollover, 0, "test is vacuous: nothing rolled over");

        // SEASON 2 — identical shape, so its income must be identical too.
        for (uint256 i; i < 2; ++i) {
            _pushWindow();
            _think();
            _answer(1, "UP_MOMENTUM");
            _answer(2, "DOWN_REVERSION");
            _commit();
            _settle();
        }

        assertEq(population.windowCount(), 4, "four windows should have opened in total");
        assertEq(population.level(), 2, "the second season did not escalate from its own anchor");
        assertEq(population.ante(), 4 * ONE, "the ante did not escalate again in the second season");
        assertEq(
            population.prizePool(), rollover + pot1, "season 2's pot is not season 1's rollover plus its own income"
        );
        assertEq(population.aliveCount(), 2, "a death would break the income symmetry this test relies on");

        vm.prank(address(0xDEAD));
        population.endSeason();

        assertEq(population.seasonId(), 3, "season 2 did not close");
        assertEq(population.seasonStartWindow(), 4, "the third season must be anchored at ITS closing window");
        assertEq(population.level(), 0, "level did not fall back to 0 a second time");
        assertEq(population.ante(), 1 * ONE, "the ante did not fall back to the base a second time");
    }

    /**
     *  `level()` clamps at 40, and the clamp is an anti-brick guard rather than a
     *  nicety: `ante()` multiplies in a loop bounded by exactly this number, and an
     *  uncaught exponent overflows `ante()` after ~78 doublings — which reverts every
     *  pairing, every entry and every settlement in a population nobody could rescue
     *  without an upgrade.
     *
     *  Run with no organisms on purpose. `level()` reads nothing but `windowCount` and
     *  `seasonStartWindow`, an empty living set still advances the phase machine, and
     *  42 windows of thinking would otherwise cost more cognition than the fixture
     *  funds.
     */
    function test_level_clampsAtFortyDoublings() public {
        Population.SeasonParams memory s = _season();
        s.levelWindows = 1;
        _setSeason(s);

        for (uint256 i; i < 42; ++i) {
            _pushWindow();
            _think();
            _commit();
            _settle();
        }

        assertEq(population.windowCount(), 42, "forty-two windows should have opened");
        assertEq(population.level(), 40, "level must clamp at 40 rather than track the window count");
        assertEq(population.ante(), population.baseAnte() * (2 ** 40), "the ante must still be computable at the clamp");
    }

    /**
     *  The second entry floor, and the reason there are two.
     *
     *  `minEndowment` is a fixed number; the ante doubles every level. An entrant
     *  who buys in late with exactly the minimum would be able to fund one window
     *  and would be dead before the next, which is a worse experience than being
     *  turned away at the door.
     */
    function test_enter_refusesAnEndowmentThatCannotCoverTheAnte() public {
        // Put the OTHER floor out of the way so this test can only pass or fail on
        // the ante floor.
        Population.SeasonParams memory s = _season();
        s.minEndowment = 1;
        s.baseAnte = 10 * ONE;
        _setSeason(s);

        address bob = address(0xB0B);
        collateral.mint(bob, 100 * ONE);
        uint256 cognition = population.cognitionEndowment();
        vm.deal(bob, cognition);

        vm.startPrank(bob);
        collateral.approve(address(population), 100 * ONE);
        // Parameterized error, so the WHOLE revert data must be matched — a bare
        // selector fails here for the reason CLAUDE.md documents.
        vm.expectRevert(abi.encodeWithSelector(Population.EndowmentBelowAnte.selector, 20 * ONE, 40 * ONE));
        population.enter{value: cognition}("dead on arrival", 20 * ONE);
        vm.stopPrank();
    }

    /**
     *  The invariant that makes the books trustworthy, asserted as an EQUALITY
     *  rather than as `booked <= holdings`.
     *
     *  `<=` is nearly vacuous against a 10,000 tUSDC house float — it would pass on
     *  an implementation that never booked anything at all. Equality of the DELTA is
     *  the real claim, and it is sound because pairing nets to zero through this
     *  contract (stake in, venue pulls it straight out) and redemption pays the
     *  organism directly. So every tUSDC the arena's balance gains over a window is
     *  rent, skim, or a corpse's residue — exactly the three things the books claim.
     */
    function test_accounting_rakeAndPoolAndTreasuriesNeverExceedHoldings() public {
        _seed(4);
        _upWins();

        uint256 bookedBefore = population.rakeAccrued() + population.prizePool();
        uint256 heldBefore = collateral.balanceOf(address(population));

        for (uint256 w; w < 3; ++w) {
            _pushWindow();
            _think();
            _answer(1, "UP_MOMENTUM");
            _answer(2, "UP_MOMENTUM");
            _answer(3, "DOWN_REVERSION");
            _answer(4, "DOWN_REVERSION");
            _commit();
            _settle();
        }

        uint256 booked = population.rakeAccrued() + population.prizePool();
        uint256 held = collateral.balanceOf(address(population));
        assertLe(booked, held, "books claim more than the contract holds");
        assertGt(booked - bookedBefore, 0, "test is vacuous: three windows booked no income");
        assertEq(
            booked - bookedBefore, held - heldBefore, "the arena's balance moved by something the books do not name"
        );

        for (uint256 id = 1; id <= 4; ++id) {
            _assertLedgerMatchesBalance(id);
        }
    }

    /*//////////////////////////////////////////////////////////////
            snapshot() AND sweep() — THE TWO SURFACES WITH NO TESTS
    //////////////////////////////////////////////////////////////*/

    /**
     *  Does this population actually SEPARATE every pair of same-typed fields?
     *
     *  A mirror assertion `assertEq(s.correctCount, p.correctCount())` has no power
     *  to catch `s.correctCount = p.wrongCount()` unless some organism holds
     *  different values in the two. `snapshot()` assigns sixteen fields one at a
     *  time — a shape `Population.sol:1634` documents as load-bearing and forbids
     *  tidying into a struct literal — and within a type group every such swap
     *  compiles, produces a byte-identical ABI, and survives `scripts/abi-drift.ts`.
     *  So the discriminating power of the fixture is asserted here rather than
     *  assumed, and a future edit that flattens the histories fails HERE, naming the
     *  pair it stopped separating, instead of quietly making the mirror vacuous.
     */
    function _assertSeparated(uint256[][] memory vals, string[] memory names) internal pure {
        for (uint256 a; a < names.length; ++a) {
            for (uint256 b = a + 1; b < names.length; ++b) {
                bool separated;
                for (uint256 i; i < vals.length; ++i) {
                    if (vals[i][a] != vals[i][b]) {
                        separated = true;
                        break;
                    }
                }
                assertTrue(
                    separated,
                    string.concat(
                        "no organism separates ",
                        names[a],
                        " from ",
                        names[b],
                        ": swapping those two inside snapshot() would pass every assertion in this test"
                    )
                );
            }
        }
    }

    /**
     *  `snapshot()` is the one read the whole product stands on, and it had no test.
     *
     *  `web/js/chain.js`, `app/src/lib/abi.js`, `scripts/cadence.ts`, `scripts/fund.ts`
     *  and `scripts/monitor.ts` all render from this single call — no indexer sits
     *  between the chain and the UI — and its sixteen-field tuple is transcribed by
     *  hand into three ABI mirrors. `scripts/abi-drift.ts` guards the SHAPE of that
     *  tuple. Nothing guarded its CONTENTS, and the two failures are not the same
     *  failure: a reordered struct breaks decoding loudly on the first read, while a
     *  swapped assignment between two `uint32` fields decodes perfectly and puts
     *  plausible wrong numbers on every surface a judge looks at. That is the gap
     *  this test closes, and it closes it before the layout freeze rather than after.
     *
     *  The fixture is three organisms with deliberately unequal histories, one of
     *  them retired, because a population where every counter reads 3 would make
     *  every assertion below true by accident — see `_assertSeparated`.
     */
    function test_snapshot_mirrorsEveryOrganismFieldForField() public {
        _seed(2);
        address alice = address(0xA11CE);
        assertEq(_enter(alice, "abstainer", 10 * ONE), 3, "ids are assigned in lineage order");

        // Three windows, with the winning side flipped in the middle so 1 and 2 do
        // not end up with the same record, and organism 3 abstaining throughout so
        // the pair is always exactly one up against one down. A third opinion would
        // leave one organism unpaired, and what an unpaired organism is graded as is
        // not what this test is about.
        for (uint256 w; w < 3; ++w) {
            if (w == 1) settlement.setPayouts(NO_ID, YES_ID);
            else _upWins();
            _pushWindow();
            _think();
            _answer(1, "UP_MOMENTUM");
            _answer(2, "DOWN_REVERSION");
            _answer(3, "ABSTAIN");
            _commit();
            _settle();
        }

        // A DEAD ORGANISM, for two reasons. It is the only way to separate
        // `birthWindow` from `deathWindow` — both read 0 for everything alive — and
        // the lineage/living distinction below is exactly what the frontend's
        // ancestry graph and death display depend on.
        vm.prank(alice);
        population.retire(3);
        assertTrue(_p(3).dead(), "the fixture needs one dead organism");

        uint256 n = population.prophetCount();
        assertEq(n, 3, "breeding or death changed the lineage under this test");

        // Read the truth out of the organisms themselves. `snapshot()` is a mirror;
        // the `Prophet` is the thing being mirrored, so it is the only sound source
        // for the expected values.
        uint256[][] memory u32 = new uint256[][](n);
        uint256[][] memory u64 = new uint256[][](n);
        uint256[][] memory u8s = new uint256[][](n);
        uint256[][] memory u256 = new uint256[][](n);
        for (uint256 i; i < n; ++i) {
            Prophet p = _p(i + 1);
            u32[i] = new uint256[](6);
            u32[i][0] = p.generation();
            u32[i][1] = p.streak();
            u32[i][2] = p.windowsLived();
            u32[i][3] = p.correctCount();
            u32[i][4] = p.wrongCount();
            u32[i][5] = p.abstainCount();
            u64[i] = new uint256[](2);
            u64[i][0] = p.birthWindow();
            u64[i][1] = p.deathWindow();
            u8s[i] = new uint256[](2);
            u8s[i][0] = uint8(p.belief());
            u8s[i][1] = uint8(p.lastThesis());
            u256[i] = new uint256[](3);
            u256[i][0] = p.prophetId();
            u256[i][1] = p.parentId();
            u256[i][2] = p.treasury();
        }

        string[] memory n32 = new string[](6);
        n32[0] = "generation";
        n32[1] = "streak";
        n32[2] = "windowsLived";
        n32[3] = "correctCount";
        n32[4] = "wrongCount";
        n32[5] = "abstainCount";
        string[] memory n64 = new string[](2);
        n64[0] = "birthWindow";
        n64[1] = "deathWindow";
        string[] memory n8 = new string[](2);
        n8[0] = "belief";
        n8[1] = "thesis";
        string[] memory n256 = new string[](3);
        n256[0] = "id";
        n256[1] = "parentId";
        n256[2] = "treasury";

        _assertSeparated(u32, n32);
        _assertSeparated(u64, n64);
        _assertSeparated(u8s, n8);
        _assertSeparated(u256, n256);

        Population.Snapshot[] memory snap = population.snapshot();

        // THE LINEAGE, NOT THE LIVING SET. `web/` renders the dead — an ancestry
        // graph with the ancestors missing is not an ancestry graph — so a
        // `snapshot()` that filtered would break the page without breaking any ABI.
        assertEq(snap.length, n, "snapshot must cover every organism that ever lived");
        assertEq(population.livingCount(), 2, "the fixture should have exactly one retired organism");

        for (uint256 i; i < n; ++i) {
            Prophet p = _p(i + 1);
            Population.Snapshot memory s = snap[i];
            string memory at = string.concat(" [organism ", vm.toString(i + 1), "]");

            // ASCENDING BY ID, with no gap left by the dead one. Every consumer
            // indexes this array positionally and none of them re-sorts it.
            assertEq(s.id, i + 1, string.concat("out of order", at));
            assertEq(s.addr, address(p), string.concat("addr", at));
            assertEq(s.parentId, p.parentId(), string.concat("parentId", at));
            assertEq(s.generation, p.generation(), string.concat("generation", at));
            assertEq(s.treasury, p.treasury(), string.concat("treasury", at));
            assertEq(s.streak, p.streak(), string.concat("streak", at));
            assertEq(s.windowsLived, p.windowsLived(), string.concat("windowsLived", at));
            assertEq(s.correctCount, p.correctCount(), string.concat("correctCount", at));
            assertEq(s.wrongCount, p.wrongCount(), string.concat("wrongCount", at));
            assertEq(s.abstainCount, p.abstainCount(), string.concat("abstainCount", at));
            assertEq(s.birthWindow, p.birthWindow(), string.concat("birthWindow", at));
            assertEq(s.deathWindow, p.deathWindow(), string.concat("deathWindow", at));
            assertEq(s.dead, p.dead(), string.concat("dead", at));
            assertEq(s.belief, uint8(p.belief()), string.concat("belief", at));
            assertEq(s.thesis, uint8(p.lastThesis()), string.concat("thesis", at));
            assertEq(s.genomeHash, p.genomeHash(), string.concat("genomeHash", at));

            // The ledger invariant, through the snapshot rather than the getter:
            // `treasury` is what the page shows and a drift here is a wrong number
            // on screen, not just a wrong number in storage.
            assertEq(s.treasury, collateral.balanceOf(address(p)), string.concat("snapshot treasury vs balance", at));
        }
    }

    /**
     *  `sweep()` cannot reach an organism, which is the claim its doc comment makes.
     *
     *  Worth pinning rather than reading, because the reason is structural and easy
     *  to lose: an organism custodies its own collateral in its own contract, so
     *  there is no amount of `sweep` that touches it. The test sweeps the arena down
     *  to zero — strictly more than any real operator would — and requires every
     *  treasury to survive it.
     */
    function test_sweep_isOwnerOnlyAndCannotReachAnOrganismsTreasury() public {
        _seed(2);
        address intruder = address(0xBAD);

        // Parameterized error, so the WHOLE revert data must match. Spelled as a
        // selector rather than imported: `Ownable` is not in this file's imports and
        // adding one for a single assertion would be the larger change.
        vm.prank(intruder);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableUnauthorizedAccount(address)")), intruder));
        population.sweep(address(collateral), intruder, 1);

        uint256 t1 = _p(1).treasury();
        uint256 t2 = _p(2).treasury();
        assertGt(t1, 0, "test is vacuous: the organisms hold nothing to protect");

        uint256 held = collateral.balanceOf(address(population));
        assertGt(held, 0, "test is vacuous: the arena holds nothing, so the sweep moves nothing");
        vm.prank(owner);
        population.sweep(address(collateral), owner, held);

        assertEq(collateral.balanceOf(address(population)), 0, "the sweep did not actually empty the arena");
        assertEq(_p(1).treasury(), t1, "sweep reached into an organism's ledger");
        assertEq(_p(2).treasury(), t2, "sweep reached into an organism's ledger");
        _assertLedgerMatchesBalance(1);
        _assertLedgerMatchesBalance(2);

        // The native leg, which is the documented remedy for `CognitionUnspent`:
        // `address(0)` plus the organism's address returns the deposit to the
        // organism it was drawn from. The address is resolved into a local FIRST —
        // `_p(1)` is a call, and inline as an argument it would eat the prank and
        // send this sweep from the test contract. See the `_econ()` note above.
        address p1 = address(_p(1));
        vm.deal(address(population), 5 ether);
        uint256 cognitionBefore = p1.balance;
        vm.prank(owner);
        population.sweep(address(0), p1, 2 ether);
        assertEq(p1.balance, cognitionBefore + 2 ether, "the native residue did not reach the organism");
        assertEq(address(population).balance, 3 ether, "more native left the arena than was swept");
    }

    // `test_sweep_canOverdrawTheBooksAndStrandTheSeason` STOOD HERE until 2026-09-05.
    // It pinned, as a known finding, that `sweep` could draw straight through
    // `prizePool` and `rakeAccrued` and leave a season that could never close —
    // `endSeason` reverting on `TransferFailed` forever, `seasonId` frozen. Its
    // argument against an on-chain guard was that `sweep` is the documented remedy for
    // stranded cognition and a book-aware cap would block the recovery it exists for.
    //
    // That argument over-reaches by one step: the remedy is NATIVE, so a
    // COLLATERAL-ONLY cap preserves it exactly. `sweep` now carries that cap, so this
    // test has no subject left — it is deleted rather than inverted, and
    // `test_sweep_cannotOverdrawTheCollateralBooksButStillRecoversStrandedCognition`
    // asserts the new behaviour including the remedy as its control.
    //
    // `monitor.ts`'s alert 7b (`pool + rake > coll`) STAYS, and deliberately: deleting
    // a detector because an invariant now holds is how you lose the detector that
    // would have caught the invariant breaking.

    /*//////////////////////////////////////////////////////////////
             THE SECOND VENUE — SETTLEMENT AS A REPLACEABLE PART
    //////////////////////////////////////////////////////////////*/

    /**
     *  A second arena, wired to `DirectDuelVenue` and to nothing else new.
     *
     *  Deliberately a second `Population` rather than a `setWiring` on the first:
     *  the two then run side by side in one test process over one price source and
     *  one beacon, which is the actual platform claim — the same organism code
     *  settling against two unrelated mechanisms. Only the `venue` field differs
     *  from `setUp`'s wiring, so anything that breaks here is the venue.
     *
     *  No season is set on it, ON PURPOSE. This arena runs the parameters a fresh
     *  proxy initializes with — the ones a real deploy gets, since `Deploy.s.sol`
     *  never calls `setSeason` — so the numbers these tests assert are the numbers
     *  the live system would produce. Note that `_season`/`_econ` are bound to the
     *  `population` field and must not be used against this one.
     */
    function _duelArena() internal returns (Population arena, DirectDuelVenue duel) {
        duel = new DirectDuelVenue(address(collateral), IPriceSource(address(priceSource)), "BTC");

        Population impl = new Population();
        bytes memory init = abi.encodeCall(
            Population.initialize,
            (
                owner,
                Population.Wiring({
                    agentRequester: address(requester),
                    settlement: address(settlement),
                    marketsModule: address(module),
                    outcomeToken: address(outcomeToken),
                    collateral: address(collateral),
                    prophetBeacon: address(beacon),
                    priceSource: address(priceSource),
                    venue: address(duel),
                    llmAgentId: 1,
                    symbol: "BTC"
                })
            )
        );
        arena = Population(payable(address(new ERC1967Proxy(address(impl), init))));

        // Its OWN treasury, not the main arena's. Each `Population` deploys its own —
        // there is no setter to share one — which is also why the duel arena's
        // founders can never be confused with the DreamDEX arena's on an explorer.
        vm.prank(owner);
        arena.deployGenesisTreasury();

        vm.deal(address(arena), 100 ether);
        collateral.mint(address(arena), 10_000 * ONE);

        string[] memory genomes = new string[](2);
        genomes[0] = "duel momentum";
        genomes[1] = "duel reversion";
        vm.prank(owner);
        arena.spawnGenesis(genomes);

        vm.deal(arena.prophetAt(1), 1 ether);
        vm.deal(arena.prophetAt(2), 1 ether);
    }

    function _dp(Population arena, uint256 id) internal view returns (Prophet) {
        return Prophet(payable(arena.prophetAt(id)));
    }

    /// @dev Phases 0 and 1 on a duel arena: organism 1 says up, organism 2 says down,
    ///      so `commitAll` has exactly one pair to open. Left as its own helper
    ///      because every test below has to manipulate the price BETWEEN commit and
    ///      settle — which is the only place a duel's closing price can come from.
    function _duelOpen(Population arena) internal {
        vm.prank(owner);
        arena.think();
        requester.deliver(_dp(arena, 1).pendingBeliefRequestId(), "UP_MOMENTUM");
        requester.deliver(_dp(arena, 2).pendingBeliefRequestId(), "DOWN_REVERSION");
        vm.prank(owner);
        arena.commitAll();
    }

    function _duelSettle(Population arena) internal {
        vm.prank(owner);
        arena.settleAll();
    }

    /// @dev A duel venue holding both antes of a single hand-opened duel, with no
    ///      `Population` involved. Used by the unit tests below, where routing
    ///      through the engine would only obscure which contract is being asserted.
    function _openDuel(uint256 amount)
        internal
        returns (DirectDuelVenue duel, address up, address down, uint256 upId, uint256 downId)
    {
        duel = new DirectDuelVenue(address(collateral), IPriceSource(address(priceSource)), "BTC");
        up = makeAddr("duelUp");
        down = makeAddr("duelDown");

        collateral.mint(address(this), amount);
        collateral.approve(address(duel), amount);
        (upId, downId,) = duel.openOpposing(up, down, amount);
    }

    /// @dev The close the duel will be judged against. `openPrice` is deliberately
    ///      restated at `_pushWindow`'s level: a duel compares the close against the
    ///      level it RECORDED at open, so moving the opening price here would prove
    ///      nothing about the comparison.
    function _pushClose(uint256 closePrice) internal {
        vm.prank(owner);
        priceSource.pushWindow("BTC", MARKET_ID, 100_000 * ONE, closePrice, 6);
    }

    /**
     *  The mechanism itself: a duel is decided by the sign of a price change, and the
     *  loser is paid zero rather than reverting.
     *
     *  That last clause is the interface's hardest rule (`IArenaVenue.redeemFor`) and
     *  the reason a losing organism does not abort the whole window's settlement.
     */
    function test_directDuel_settlesFromAPriceComparison() public {
        (DirectDuelVenue duel, address up, address down, uint256 upId, uint256 downId) = _openDuel(10 * ONE);

        // The branch that only this venue reaches: no transferable position exists, so
        // `Prophet.settleWindow` must skip the ERC-6909 push entirely.
        assertEq(duel.positionToken(), address(0), "a duel issues no transferable position");
        assertEq(duel.collateral(), address(collateral));
        assertTrue(upId != downId, "the two sides must hold distinct positions");
        assertEq(collateral.balanceOf(address(duel)), 10 * ONE, "both antes should be escrowed");

        _pushClose(101_000 * ONE); // it rose, so UP was right

        vm.prank(up);
        uint256 won = duel.redeemFor(up, upId, 10 * ONE);
        vm.prank(down);
        uint256 lost = duel.redeemFor(down, downId, 10 * ONE);

        assertEq(won, 10 * ONE, "the winner takes the whole backing, not its own ante back");
        assertEq(lost, 0, "the loser must be paid zero, not reverted");
        assertEq(collateral.balanceOf(up), 10 * ONE, "the winner was not actually paid");
        assertEq(collateral.balanceOf(down), 0);
        assertEq(collateral.balanceOf(address(duel)), 0, "the escrow must be empty once both sides have claimed");
    }

    /**
     *  A flat print pays each side its ante back and grades nobody.
     *
     *  Two things are being asserted at once and both matter: that the collateral is
     *  returned rather than stranded in the venue forever, and that half the backing
     *  is exactly one ante — which is only true because `Population._pair` clamps
     *  both legs to the same number before opening. Paying zero instead would delete
     *  the collateral AND book both forecasters as wrong.
     */
    function test_directDuel_refundsBothSidesWhenThePriceDidNotMove() public {
        (DirectDuelVenue duel, address up, address down, uint256 upId, uint256 downId) = _openDuel(10 * ONE);

        // `setUp`'s window already has last == open, so this is a flat print with no
        // further push. Asserting the outcome by name, because a void that arrives
        // via the unadjudicable path would pay identically and prove something else.
        vm.prank(up);
        assertEq(duel.redeemFor(up, upId, 10 * ONE), 5 * ONE, "up should get its ante back");
        assertEq(uint8(duel.outcomeOf(1)), uint8(DirectDuelVenue.Outcome.Void), "a flat print is a void");

        vm.prank(down);
        assertEq(duel.redeemFor(down, downId, 10 * ONE), 5 * ONE, "down should get its ante back");

        assertEq(collateral.balanceOf(address(duel)), 0, "a void must not strand the backing in the venue");
    }

    /**
     *  THE SOLVENCY PROPERTY: the outcome is frozen by the first claim, so a price
     *  that moves between the two redemptions cannot pay both sides.
     *
     *  Without the freeze, each side would be judged against whatever price was live
     *  when it happened to claim — and redeeming up while the price was high and down
     *  after it fell would pay the whole backing twice out of an escrow holding it
     *  once. This test is the reason `_resolve` writes `outcome` instead of just
     *  reading the feed.
     *
     *  VERIFIED BY MUTATION, not by argument: with `_resolve`'s `Pending` guard
     *  commented out, this is the ONLY test in the file that fails, and it fails as
     *  `panic: arithmetic underflow` inside the collateral transfer — the venue
     *  attempting to pay the backing a second time out of an empty escrow. That the
     *  other five still pass is the point: nothing else here covers this.
     */
    function test_directDuel_cannotPayBothSidesWhenThePriceMovesBetweenClaims() public {
        (DirectDuelVenue duel, address up, address down, uint256 upId, uint256 downId) = _openDuel(10 * ONE);

        _pushClose(101_000 * ONE);
        vm.prank(up);
        assertEq(duel.redeemFor(up, upId, 10 * ONE), 10 * ONE, "up won on the price current at the first claim");

        // Now it is below the open. If resolution were re-read per claim, down would
        // also be the winner.
        _pushClose(99_000 * ONE);
        vm.prank(down);
        assertEq(duel.redeemFor(down, downId, 10 * ONE), 0, "the second claim re-adjudicated the duel");

        assertEq(uint8(duel.outcomeOf(1)), uint8(DirectDuelVenue.Outcome.Up), "the frozen outcome was overwritten");
        assertEq(collateral.balanceOf(address(duel)), 0);
        assertEq(
            collateral.balanceOf(up) + collateral.balanceOf(down),
            10 * ONE,
            "the venue paid out more or less than the backing"
        );
    }

    /**
     *  Only the holder may redeem, and there is no public `resolve`.
     *
     *  Resolution reads whatever price is current, so whoever can trigger it chooses
     *  when the window closes — an entrant watching the feed would resolve at the
     *  instant their own organism was ahead. Closing that is a grief fix, not a
     *  formality, which is why it is asserted rather than left to the docblock.
     */
    function test_directDuel_refusesToBeResolvedByABystander() public {
        (DirectDuelVenue duel, address up,, uint256 upId,) = _openDuel(10 * ONE);

        _pushClose(101_000 * ONE);

        vm.prank(address(0xBADBAD));
        vm.expectRevert(DirectDuelVenue.NotHolder.selector);
        duel.redeemFor(up, upId, 10 * ONE);

        assertEq(uint8(duel.outcomeOf(1)), uint8(DirectDuelVenue.Outcome.Pending), "a bystander pinned the close");
    }

    /**
     *  `positionIdsOf(0)` answers with an error rather than an arithmetic panic.
     *
     *  Small, and worth the four lines anyway: ids start at 1 (`++duelCount`), so
     *  zero is never a duel — it is what a caller passes when it *has* no duel, an
     *  unset variable or a lookup that came back empty. `0 * 2 - 1` met that with a
     *  bare panic naming nothing, from a `pure` helper whose entire purpose is to
     *  save a reader from knowing the id convention. `UnknownDuel(0)` is the same
     *  answer `outcomeOf` already gives for every other id that does not exist.
     */
    function test_directDuel_positionIdsOfZeroIsNotAnArithmeticPanic() public {
        DirectDuelVenue duel = new DirectDuelVenue(address(collateral), IPriceSource(address(priceSource)), "BTC");

        vm.expectRevert(abi.encodeWithSelector(DirectDuelVenue.UnknownDuel.selector, uint256(0)));
        duel.positionIdsOf(0);

        // CONTROL. A guard that refuses everything would satisfy the line above, so
        // the convention it documents is asserted on both sides: duel 1 owns ids 1
        // and 2, and duel 7 owns 13 and 14 — the `2k-1` / `2k` pairing, from a duel
        // that need not exist for a `pure` function to describe it.
        (uint256 upId, uint256 downId) = duel.positionIdsOf(1);
        assertEq(upId, 1, "duel 1 up id");
        assertEq(downId, 2, "duel 1 down id");

        (upId, downId) = duel.positionIdsOf(7);
        assertEq(upId, 13, "duel 7 up id");
        assertEq(downId, 14, "duel 7 down id");
    }

    /**
     *  THE CLAIM, EXECUTABLE: a full window — think, answer, commit, settle — through
     *  a `Population` that has never heard of DreamDEX's settlement contract.
     *
     *  Calling the venue directly would prove far less. Routed through the engine,
     *  this also exercises the `positionToken() == address(0)` branch of
     *  `Prophet.settleWindow`, which no other test in this file reaches, and shows
     *  that grading, rake, metabolism and the season books all work off nothing but
     *  `redeemFor`'s return value.
     *
     *  Every expected number is derived from the arena's own parameters rather than
     *  hard-coded, so this keeps asserting the same property after a default changes.
     */
    function test_venue_engineIsIndifferentToTheSettlementMechanism() public {
        (Population arena, DirectDuelVenue duel) = _duelArena();

        uint256 ante = arena.ante();
        uint256 endowment = arena.endowment();
        uint256 metabolism = arena.metabolicCost();
        assertGt(ante, 0, "test would be vacuous with a zero ante");

        _duelOpen(arena);
        assertEq(collateral.balanceOf(address(duel)), 2 * ante, "both antes should be escrowed with the venue");

        _pushClose(101_000 * ONE); // it rose, so organism 1 (up) was right
        _duelSettle(arena);

        Prophet winner = _dp(arena, 1);
        Prophet loser = _dp(arena, 2);

        assertEq(winner.correctCount(), 1, "the winner was not graded correct");
        assertEq(loser.wrongCount(), 1, "the loser was not graded wrong");
        assertEq(winner.abstainCount(), 0);
        assertEq(loser.abstainCount(), 0);

        // Won the loser's ante, paid the skim on that profit, then paid rent.
        uint256 skim = (ante * arena.rakeBps()) / 10_000;
        assertGt(skim, 0, "rake is not being exercised");
        assertEq(winner.treasury(), endowment + ante - skim - metabolism, "winner's net is wrong");
        assertEq(loser.treasury(), endowment - ante - metabolism, "loser's net is wrong");

        assertEq(winner.treasury(), collateral.balanceOf(address(winner)), "winner's ledger drifted from its balance");
        assertEq(loser.treasury(), collateral.balanceOf(address(loser)), "loser's ledger drifted from its balance");

        // The house booked exactly two rents and one skim, and the venue kept nothing.
        assertEq(arena.rakeAccrued() + arena.prizePool(), 2 * metabolism + skim, "the season books do not add up");
        assertEq(collateral.balanceOf(address(duel)), 0, "the venue is still holding collateral after settlement");
    }

    /**
     *  A settlement the venue cannot observe a closing price for voids and refunds —
     *  it does not misgrade, and it does not abort the window.
     *
     *  This path is REACHABLE IN PRODUCTION, not a contrivance: `settleAll` reads no
     *  price of its own, and on the reactive path nobody pushes one between
     *  resolution and the callback, so `currentWindow` reverting `StalePrice` is an
     *  ordinary condition at settlement time. Letting it propagate would leave the
     *  organism's position open with its ante already escrowed; grading against a
     *  stale price would book a forecast as right or wrong on no evidence. Both
     *  organisms must come out with their ante back and their counters untouched.
     */
    function test_venue_voidsRatherThanMisgradingWhenTheCloseCannotBeObserved() public {
        (Population arena, DirectDuelVenue duel) = _duelArena();

        uint256 endowment = arena.endowment();
        uint256 metabolism = arena.metabolicCost();

        // Opened while the feed was fresh — `openOpposing` demands that. The staleness
        // arrives afterwards, which is exactly the production shape.
        _duelOpen(arena);
        vm.warp(block.timestamp + 181);
        _duelSettle(arena);

        assertEq(uint8(duel.outcomeOf(1)), uint8(DirectDuelVenue.Outcome.Void), "an unobservable close must void");

        for (uint256 id = 1; id <= 2; ++id) {
            Prophet p = _dp(arena, id);
            assertEq(p.correctCount(), 0, "a void was graded as a win");
            assertEq(p.wrongCount(), 0, "a void was graded as a loss");
            assertEq(p.abstainCount(), 0, "the organism answered; it did not abstain");
            assertEq(p.streak(), 0);
            assertEq(p.treasury(), endowment - metabolism, "the ante was not refunded");
            assertEq(p.treasury(), collateral.balanceOf(address(p)), "ledger drifted from balance");
        }

        // Rent was still due — thinking is not free just because the window decided
        // nothing — but there was no profit, so nothing was skimmed.
        assertEq(arena.rakeAccrued() + arena.prizePool(), 2 * metabolism, "a void booked something other than rent");
        assertEq(collateral.balanceOf(address(duel)), 0, "the voided backing is stranded in the venue");
    }

    /*//////////////////////////////////////////////////////////////
        A SETTLEMENT THAT REVERTS — THE ONE FAILURE THAT COSTS MONEY
    //////////////////////////////////////////////////////////////*/

    /**
     *  A `SettleFailed` must not cost the organism its ante.
     *
     *  Three mechanisms meet here, each right on its own:
     *
     *    1. `Prophet.settleWindow` clears `positionOpen` in its FIRST statement, so a
     *       revert anywhere below unwinds that write with everything else. The
     *       organism comes out of the failed transaction still holding an open
     *       position — which is accurate, because the position genuinely is open.
     *    2. `Population.settleAll` catches per-organism reverts and emits
     *       `SettleFailed`, because one bad organism must never halt the population.
     *    3. `Prophet.noteCommitted` has no guard of its own and cannot have one (see
     *       the comment at the skip in `commitAll` for why `_pair`'s catch makes that
     *       impossible), so it will overwrite `currentOutcomeId` on request.
     *
     *  Composed naively those three lose collateral: `settleWindow` only ever redeems
     *  `currentOutcomeId`, a duel may only be redeemed by its own holder, and `Prophet`
     *  exposes no arbitrary call — so once the id is overwritten, the one address
     *  permitted to claim the escrow is a contract that no longer knows what to ask
     *  for. Nothing retries, either: `settleAll` visits each organism once per window.
     *
     *  `commitAll` closes it by skipping an organism whose position is still open, which
     *  turns the failure into a one-window delay: the next `settleAll` finds
     *  `positionOpen` still true and redeems the ORIGINAL position. This test walks that
     *  whole path and ends on the assertion that matters — the venue is empty.
     *
     *  THE CHEATCODE IS THE POINT, not a shortcut. `Prophet` deliberately does not wrap
     *  `redeemFor` (CLAUDE.md's conventions, and `Prophet.sol:414`) precisely so a
     *  genuinely broken settlement aborts rather than being silenced. On the live arena
     *  that is `BinarySettlement` reverting; in-repo the mocks answer every call and the
     *  duel venue's escrow can never be short, so no local state produces one.
     *  `mockCallRevert` supplies the integration break the production code is written to
     *  expect, scoped to `redeemFor` alone and cleared immediately.
     */
    function test_settle_aFailedSettlementIsRetriedRatherThanCommittedOver() public {
        (Population arena, DirectDuelVenue duel) = _duelArena();

        _duelOpen(arena);

        uint256 escrowed = collateral.balanceOf(address(duel));
        uint256 openId = _dp(arena, 1).currentOutcomeId();
        uint256 stake = _dp(arena, 1).currentStake();
        assertGt(escrowed, 0, "both antes must be escrowed or this test measures nothing");
        assertGt(openId, 0, "organism 1 must hold a real duel position");
        assertEq(stake * 2, escrowed, "both legs are equal, so the escrow is exactly two antes");

        _pushClose(101_000 * ONE);

        vm.mockCallRevert(address(duel), abi.encodeWithSelector(IArenaVenue.redeemFor.selector), "settlement down");
        vm.expectEmit(true, false, false, false, address(arena));
        emit Population.SettleFailed(1);
        _duelSettle(arena);
        vm.clearMockedCalls();

        // 1. The position survived the failure, ante and all, and the window it was
        //    opened in was not counted as lived.
        assertTrue(_dp(arena, 1).positionOpen(), "a reverted settlement must leave the position open");
        assertEq(_dp(arena, 1).currentOutcomeId(), openId, "the position id survived the revert");
        assertEq(_dp(arena, 1).windowsLived(), 0, "an unsettled window must not count as lived");
        assertEq(collateral.balanceOf(address(duel)), escrowed, "the ante is still escrowed, as it should be");
        assertEq(uint8(duel.outcomeOf(1)), uint8(DirectDuelVenue.Outcome.Pending), "nothing adjudicated it");

        // 2. THE FIX. The next window opens and commits normally for everyone else, and
        //    passes over these two: no new duel is issued, so the venue's balance does
        //    not move and the stale ids are untouched.
        _pushWindow();
        _duelOpen(arena);

        assertEq(_dp(arena, 1).currentOutcomeId(), openId, "the open position was committed over");
        assertEq(_dp(arena, 2).currentOutcomeId(), openId + 1, "the counterparty was committed over");
        assertEq(collateral.balanceOf(address(duel)), escrowed, "a second duel was opened over the stale one");
        assertEq(_dp(arena, 1).currentStake(), stake, "the stake was overwritten");

        // THE ONE THING A RETRY DOES NOT CARRY, asserted here because `settleWindow`
        // clears `belief` on its way out (`Prophet.sol:528`) and this is the last point
        // it can be read. Being skipped by `commitAll` does NOT skip `think`: the
        // organism was asked again and answered again, so its live belief is this
        // window's, not the one the open position was taken on.
        //
        // WHICH IS NOW HARMLESS, and the assertion below is what keeps it that way.
        // Until 2026-09-05 the grade branch consulted that live belief and booked an
        // abstain whenever it was Abstain/None, so a retry landing in a window where
        // the organism happened not to form a belief overwrote a position that won or
        // lost real money with a non-result — money right, fitness counter lying. It
        // no longer does: `Prophet.sol:476` branches on `quantity == 0`, and
        // `quantity` is one of the two fields that actually travelled with the
        // position. No `__gap` slot was needed to carry the grade, because the fields
        // the money is already graded from were the right ones all along. The line
        // below asserts the divergence is real — this belief is THIS window's — and
        // `correctCount` further down asserts the grade came from the position
        // anyway.
        assertEq(uint8(_dp(arena, 1).belief()), uint8(Belief.Up), "the skipped organism was not asked again");

        // 3. The retry. `settleAll` finds `positionOpen` still true and redeems the
        //    ORIGINAL position, which is why nothing was lost.
        _pushClose(101_000 * ONE);
        _duelSettle(arena);

        assertEq(collateral.balanceOf(address(duel)), 0, "the ante was stranded in the venue");
        assertFalse(_dp(arena, 1).positionOpen(), "the retry did not close the position");
        assertEq(_dp(arena, 1).windowsLived(), 1, "the recovered window was not counted");
        assertEq(uint8(duel.outcomeOf(1)), uint8(DirectDuelVenue.Outcome.Up), "the original duel was never adjudicated");
        _assertDuelLedger(arena, 1);
        _assertDuelLedger(arena, 2);

        // The GRADE survives the delay too, because it is taken from the position and
        // not from the forecast: `Prophet.sol:444` decides won/lost on
        // `collateralOut > currentStake`, and both of those fields came through the
        // failure untouched. So the retry scores the ORIGINAL window's bet.
        assertEq(_dp(arena, 1).correctCount(), 1, "the retried winner was not graded correct");
        assertEq(_dp(arena, 2).wrongCount(), 1, "the retried loser was not graded wrong");

        // THE CONTROL for the measurement above. An empty venue is only evidence of
        // recovery if the venue can hold a balance at this point in the sequence at all
        // — otherwise this test would pass just as happily against a venue that never
        // escrows anything. Same organisms, same venue, one uninterrupted window: the
        // escrow appears, and only then goes away.
        (Population clean, DirectDuelVenue cleanDuel) = _duelArena();
        _duelOpen(clean);
        assertEq(collateral.balanceOf(address(cleanDuel)), escrowed, "the control never escrowed anything");
        _pushClose(101_000 * ONE);
        _duelSettle(clean);
        assertEq(collateral.balanceOf(address(cleanDuel)), 0, "a settled window must leave nothing behind");
    }

    /// @dev `treasury == balanceOf` on an organism of a secondary arena. `_assertLedgerMatchesBalance`
    ///      is bound to the `population` field and cannot be pointed at one.
    function _assertDuelLedger(Population arena, uint256 id) internal view {
        Prophet p = Prophet(payable(arena.prophetAt(id)));
        assertEq(p.treasury(), collateral.balanceOf(address(p)), "ledger drifted from balance");
    }

    /**
     *  `POPULATION HOLDS NO STANDING AUTHORITY OVER AN ORGANISM.` This test asserts an
     *  ABSENCE, which is why it carries its own control at the bottom.
     *
     *  Until 2026-09-05 `Prophet.grantPopulation` handed out two of them at birth, from
     *  every organism ever born: an infinite ERC-20 allowance over the whole treasury,
     *  and ERC-6909 operator rights over the positions. Nothing used either. The
     *  earlier version of this test revoked both and ran a window to prove it; the
     *  grants are now gone from the source, so the same proof is stronger — the window
     *  runs with authority that was never issued in the first place.
     *
     *  Both were worse than the case this codebase already refuses. `executePair`
     *  approves the venue PER CALL on the stated grounds that *"a standing allowance to
     *  an address we have since stopped using is a liability nobody is watching"* — and
     *  `Population` is UUPS-upgradeable, so an allowance to it is not a promise about
     *  today's bytecode. The failure mode was quiet too: a `transferFrom` against an
     *  organism moves collateral without decrementing `treasury`, so it breaks the
     *  `treasury == balanceOf` invariant this suite asserts everywhere rather than
     *  reverting somewhere a test would see it.
     *
     *  Value only ever moves INTO this contract as a push from the organism — the ante
     *  via `stakeOut` (`Population.sol:1268`), metabolism via `transfer`
     *  (`Prophet.sol:520`) — and the outcome tokens likewise (`Prophet.sol:404`),
     *  because the ERC-6909 surface has no `transferFrom` for anyone to pull with. So
     *  neither grant had a caller, and re-adding one now fails here.
     */
    function test_prophet_populationHoldsNoStandingAuthorityOverAnOrganism() public {
        _seed(2);

        // Nothing was granted at birth. This is the assertion that a restored
        // `grantPopulation` breaks.
        for (uint256 id = 1; id <= 2; ++id) {
            address p = population.prophetAt(id);
            assertEq(collateral.allowance(p, address(population)), 0, "an organism granted a collateral allowance");
            assertFalse(outcomeToken.isOperator(p, address(population)), "an organism granted operator rights");
        }

        // A whole window — think, pair, redeem a winner and a loser, skim, charge rent
        // — with Population holding no authority over either organism.
        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();
        _settle();

        assertEq(_p(1).windowsLived(), 1, "the window did not complete without the grants");
        assertEq(_p(1).correctCount(), 1, "the winner was not graded");
        assertEq(_p(2).wrongCount(), 1, "the loser was not graded");
        assertFalse(_p(1).positionOpen(), "the position was not closed");
        _assertLedgerMatchesBalance(1);
        _assertLedgerMatchesBalance(2);

        // The window did not quietly grant anything on its way through either — the
        // absence is a property of the run, not just of the birth.
        address p1 = population.prophetAt(1);
        assertEq(collateral.allowance(p1, address(population)), 0, "a window granted a collateral allowance");
        assertFalse(outcomeToken.isOperator(p1, address(population)), "a window granted operator rights");

        // CONTROL. Four assertions above claim two reads are zero/false, and a read
        // that is ALWAYS zero/false would satisfy them without watching anything. So
        // grant both here, on purpose, and require the same two reads to move. Delete
        // this and the test above can no longer fail.
        vm.prank(p1);
        collateral.approve(address(population), type(uint256).max);
        vm.prank(p1);
        outcomeToken.setOperator(address(population), true);
        assertEq(collateral.allowance(p1, address(population)), type(uint256).max, "the allowance read is inert");
        assertTrue(outcomeToken.isOperator(p1, address(population)), "the operator read is inert");
    }

    /**
     *  A TOKEN THAT ANSWERS `false` INSTEAD OF REVERTING IS NOT IGNORED.
     *
     *  ERC-6909's `transfer` returns a bool exactly like ERC-20's, and this push was
     *  the last unchecked return in `src/` until 2026-09-05. Its consequence is not a
     *  failed transfer — it is a DOUBLE CREDIT: the organism keeps the position
     *  tokens it was supposed to hand over, and the venue redeems for it anyway.
     *
     *  THIS TEST CALLS `settleWindow` DIRECTLY, and that is not a shortcut. Through
     *  `settleAll` the two versions are indistinguishable: the catch turns both into
     *  the same `SettleFailed(1)` with the same open position, because the mock
     *  settlement burns from `msg.sender` (`Mocks.sol:202`) and a venue holding
     *  nothing underflows one line further on. A test written at that level would
     *  have passed with the check deleted — verified by deleting it, not by reading.
     *  So the claim is made where the two actually differ, on the revert reason:
     *  `TransferFailed` is this contract refusing to proceed, and a panic is the
     *  counterparty catching it afterwards by luck of implementation.
     *
     *  Luck is the right word. The real DreamDEX burns from `msg.sender` too, so
     *  today the unchecked version fails loudly anyway — but `IArenaVenue` is a seam
     *  whose whole purpose is that the settlement mechanism is replaceable, and a
     *  venue that credits a redemption it never received would pay this organism out
     *  of somebody else's backing. The check is what makes that a revert here rather
     *  than a property of whoever is on the other side.
     */
    function test_settle_aPositionPushThatAnswersFalseAbortsTheSettlement() public {
        _seed(2);
        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _upWins();

        Prophet p = _p(1);
        uint256 outcomeId = p.currentOutcomeId();
        uint256 quantity = p.currentQuantity();
        assertGt(quantity, 0, "the window did not produce a real position to push");

        // The singleton answers `false` without moving anything — an ERC-6909 that
        // violates the same convention ERC-20's `transfer` does.
        vm.mockCall(
            address(outcomeToken),
            abi.encodeWithSelector(MockOutcomeToken.transfer.selector, address(venue), outcomeId, quantity),
            abi.encode(false)
        );

        uint256 cost = population.metabolicCost();
        uint16 rake = population.rakeBps();
        vm.prank(address(population));
        vm.expectRevert(Prophet.TransferFailed.selector);
        p.settleWindow(address(venue), address(collateral), cost, rake);
        vm.clearMockedCalls();

        // Nothing was graded and nothing was paid, and the ante is still recoverable —
        // `positionOpen` is cleared as the FIRST statement of `settleWindow`, so a
        // revert anywhere below it puts the flag back.
        assertTrue(p.positionOpen(), "the failed settlement closed the position anyway");
        assertEq(p.windowsLived(), 0, "a failed settlement must not grade the organism");
        assertEq(outcomeToken.balanceOf(address(p), outcomeId), quantity, "the position left the organism");

        // CONTROL. Every assertion above is about a settlement that did NOT happen,
        // which a permanently broken window would satisfy just as well. Same organism,
        // same position, no mock: it settles.
        _settle();
        assertFalse(p.positionOpen(), "the retry did not close the position");
        assertEq(p.correctCount(), 1, "the retry did not grade the winner");
        assertEq(outcomeToken.balanceOf(address(p), outcomeId), 0, "the retry did not push the position");
        _assertLedgerMatchesBalance(1);
    }

    /**
     *  A VOID IS THE ONLY SETTLEMENT OUTCOME THAT MOVES NO COUNTER, and that is how
     *  `monitor.ts` finds one. This test is the contract half of that derivation.
     *
     *  `settleWindow` advances `windowsLived` unconditionally and then takes exactly
     *  one of three branches — abstain, correct, wrong. A window played with a real
     *  position that is graded as neither leaves all three untouched, so
     *  `windowsLived - (correct + wrong + abstain)` is an exact void count. Nothing
     *  else in either contract writes those four (one increment site each, all inside
     *  `settleWindow`), which is what makes it exact rather than an estimate.
     *
     *  Worth pinning here because a void is invisible everywhere else: it is not a
     *  revert, so no `SettleFailed` fires; `DuelUnadjudicable` is in no off-chain ABI
     *  the operator runs; and monitor's "nobody took a position" check cannot see one,
     *  since a void has `currentQuantity > 0` by definition. A population that voids
     *  every window looks healthy by every other measure and is not selecting at all.
     *
     *  THE ABSTAIN LEG IS THE CONTROL, and it is the assertion that earns the test. An
     *  abstain is the ordinary, uninteresting way for a window to grade nobody, and it
     *  is far more common than a void — a detector that cannot tell them apart would
     *  page the operator every time an inference timed out. The gap must NOT move
     *  there.
     */
    function test_void_isTheOnlyOutcomeThatMovesNoCounter() public {
        (Population arena,) = _duelArena();

        assertEq(_voidGap(arena, 1), 0, "nothing has been settled yet");

        // 1. A void: answered, paired, and unadjudicable because the feed went stale
        //    between open and settle.
        _duelOpen(arena);
        vm.warp(block.timestamp + 181);
        _duelSettle(arena);
        assertEq(_dp(arena, 1).windowsLived(), 1);
        assertEq(_voidGap(arena, 1), 1, "a void must be visible in the counter gap");
        assertEq(_voidGap(arena, 2), 1, "both sides of a voided duel are ungraded");

        // 2. A graded window: the gap must stay where it was, not grow.
        _pushWindow();
        _duelOpen(arena);
        _pushClose(101_000 * ONE);
        _duelSettle(arena);
        assertEq(_dp(arena, 1).windowsLived(), 2);
        assertEq(_dp(arena, 1).correctCount() + _dp(arena, 1).wrongCount(), 1, "the window was not graded");
        assertEq(_voidGap(arena, 1), 1, "a graded window must not read as a void");

        // 3. THE CONTROL — an abstain. Neither organism produces a parseable answer, so
        //    both open an empty position and are counted as abstaining. `windowsLived`
        //    advances, `abstainCount` advances with it, and the gap must not move.
        _pushWindow();
        vm.prank(owner);
        arena.think();
        requester.deliver(_dp(arena, 1).pendingBeliefRequestId(), "NOT_AN_ALLOWED_VALUE");
        requester.deliver(_dp(arena, 2).pendingBeliefRequestId(), "ALSO_NOT_ONE");
        vm.prank(owner);
        arena.commitAll();
        _duelSettle(arena);

        assertEq(_dp(arena, 1).windowsLived(), 3);
        assertEq(_dp(arena, 1).abstainCount(), 1, "the unparseable answer was not scored as an abstain");
        assertEq(_voidGap(arena, 1), 1, "an abstain must never read as a void");
    }

    /// @dev The exact arithmetic `monitor.ts`'s void check runs, over the same four
    ///      fields `snapshot()` already publishes.
    function _voidGap(Population arena, uint256 id) internal view returns (uint256) {
        Prophet p = Prophet(payable(arena.prophetAt(id)));
        return uint256(p.windowsLived()) - (uint256(p.correctCount()) + p.wrongCount() + p.abstainCount());
    }

    /*//////////////////////////////////////////////////////////////
              THE GRADE AND THE PRICE TRAVEL WITH THE POSITION
    //////////////////////////////////////////////////////////////*/

    /**
     *  A retried settlement is graded from the POSITION, never from the belief the
     *  organism happens to hold by the time the retry lands.
     *
     *  This is the corner that `commitAll`'s skip opens up, and it is the reason
     *  `settleWindow` no longer consults `belief` at all when deciding whether a window
     *  was graded. The sequence below is the only one that reaches it: a settlement
     *  fails, the position stays open, the organism is skipped by the next `commitAll`
     *  but is STILL ASKED by the next `think` — and here it answers with something
     *  unparseable, so its live belief becomes `Abstain` while the position it still
     *  holds is a directional bet that won real money.
     *
     *  Grading on the live belief books that as an abstain. `quantity` and `currentStake`
     *  are the two fields that actually travelled with the position, so they are what the
     *  grade is taken from — and `quantity` is nonzero if and only if `_pair` issued a
     *  real position, because `_openEmpty` always records zero.
     */
    function test_settle_aRetryIsGradedFromThePositionNotFromTheLaterWindowsBelief() public {
        (Population arena, DirectDuelVenue duel) = _duelArena();

        _duelOpen(arena);
        uint256 escrowed = collateral.balanceOf(address(duel));
        assertGt(escrowed, 0, "both antes must be escrowed or this test measures nothing");

        _pushClose(101_000 * ONE);
        vm.mockCallRevert(address(duel), abi.encodeWithSelector(IArenaVenue.redeemFor.selector), "settlement down");
        _duelSettle(arena);
        vm.clearMockedCalls();
        assertTrue(_dp(arena, 1).positionOpen(), "the failure did not leave the position open");

        // THE WINDOW THAT MAKES THIS A TEST. Both organisms are asked again and neither
        // produces a parseable answer, so `Genome.parseAnswer` maps both to Abstain —
        // the live belief now contradicts the position still open underneath it.
        _pushWindow();
        vm.prank(owner);
        arena.think();
        requester.deliver(_dp(arena, 1).pendingBeliefRequestId(), "NOT_AN_ALLOWED_VALUE");
        requester.deliver(_dp(arena, 2).pendingBeliefRequestId(), "ALSO_NOT_ONE");
        vm.prank(owner);
        arena.commitAll();

        assertEq(uint8(_dp(arena, 1).belief()), uint8(Belief.Abstain), "the contradiction was not set up");
        assertEq(uint8(_dp(arena, 2).belief()), uint8(Belief.Abstain), "the contradiction was not set up");
        assertTrue(_dp(arena, 1).positionOpen(), "commitAll did not pass over the open position");
        assertGt(_dp(arena, 1).currentQuantity(), 0, "the directional position did not survive");

        // The retry. The money is recovered and the grade follows the money.
        _pushClose(101_000 * ONE);
        _duelSettle(arena);

        assertEq(collateral.balanceOf(address(duel)), 0, "the ante was stranded in the venue");
        assertEq(_dp(arena, 1).correctCount(), 1, "an abstaining belief graded a winning position as an abstain");
        assertEq(_dp(arena, 2).wrongCount(), 1, "an abstaining belief graded a losing position as an abstain");
        assertEq(_dp(arena, 1).abstainCount(), 0, "the winner was booked as an abstain");
        assertEq(_dp(arena, 2).abstainCount(), 0, "the loser was booked as an abstain");
        _assertDuelLedger(arena, 1);
        _assertDuelLedger(arena, 2);

        // THE CONTROL. An unparseable answer must STILL produce an abstain when there is
        // no position underneath it — otherwise this test would pass just as well against
        // a build that had stopped counting abstains altogether, which is the cheapest
        // way to make the four assertions above green for the wrong reason.
        _pushWindow();
        vm.prank(owner);
        arena.think();
        requester.deliver(_dp(arena, 1).pendingBeliefRequestId(), "STILL_NOT_ONE");
        requester.deliver(_dp(arena, 2).pendingBeliefRequestId(), "NOR_THIS");
        vm.prank(owner);
        arena.commitAll();
        _pushClose(101_000 * ONE);
        _duelSettle(arena);

        assertEq(_dp(arena, 1).currentQuantity(), 0, "the control must have no position to grade");
        assertEq(_dp(arena, 1).abstainCount(), 1, "an unparseable answer with no position is still an abstain");
        assertEq(_dp(arena, 1).correctCount(), 1, "the control must not have added a second win");
    }

    /**
     *  The ante is fixed when the window OPENS, not when it pairs — against the owner.
     *
     *  `ante()` is derived from `windowCount - seasonStartWindow` over `levelWindows`,
     *  and `setSeason` rewrites three of those inputs with no phase guard. So without a
     *  snapshot an owner could let the population forecast a window at a late-season ante
     *  and then stake it at an early-season one, or the reverse.
     */
    function test_ante_isFrozenWhenTheWindowOpensNotWhenItPairs() public {
        Population.SeasonParams memory s = _season();
        s.baseAnte = 1 * ONE;
        s.levelWindows = 2;
        s.anteMultBps = 20_000;
        _setSeason(s);

        _seed(2);
        _upWins();

        // One full window, so the next one opens at level 1 rather than level 0 and the
        // frozen number is distinguishable from `baseAnte`.
        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();

        _pushWindow();
        _think();

        uint256 frozen = population.windowAnte();
        assertEq(frozen, population.ante(), "the snapshot must be the ante of the window just opened");
        assertEq(frozen, 2 * ONE, "level 1 of a doubling season is twice the base");

        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");

        // MID-WINDOW RE-PRICING: the forecasts exist, nothing is staked yet.
        Population.SeasonParams memory cheap = s;
        cheap.baseAnte = ONE / 100;
        _setSeason(cheap);
        assertLt(population.ante(), frozen, "the re-pricing did not take, so this proves nothing");

        _commit();

        assertEq(_p(1).currentStake(), frozen, "the window was staked at the re-priced ante");
        assertEq(_p(2).currentStake(), frozen, "both legs must follow the same snapshot");

        // And the next window does pick the new price up — a snapshot that never
        // refreshed would satisfy the two assertions above just as well.
        _settle();
        _pushWindow();
        _think();
        assertEq(population.windowAnte(), population.ante(), "the snapshot did not refresh");
        assertLt(population.windowAnte(), frozen, "the snapshot outlived the season parameters that made it");
    }

    /**
     *  The same guarantee against a STRANGER, which is the path that actually matters.
     *
     *  `endSeason` is permissionless on purpose: if it were gated on the phase, a cadence
     *  that died mid-window would leave the phase at 1 or 2 with `forcePhase` behind
     *  `onlyDriver`, and the prize pool could then be released by nobody at all. So the
     *  fix cannot be a guard on the caller or on the phase — it has to be that the price
     *  of a window in flight is no longer derivable from state a stranger can move.
     */
    function test_ante_aStrangerEndingTheSeasonCannotRepriceAWindowInFlight() public {
        Population.SeasonParams memory s = _season();
        s.baseAnte = 1 * ONE;
        s.levelWindows = 2;
        s.anteMultBps = 20_000;
        s.seasonWindows = 2;
        _setSeason(s);

        _seed(2);
        _upWins();

        _pushWindow();
        _think();
        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");
        _commit();
        _settle();

        // Window 2 opens at level 1, and opening it is also what makes the season due:
        // `windowCount - seasonStartWindow` is now 2, which is `seasonWindows`.
        _pushWindow();
        _think();
        uint256 frozen = population.windowAnte();
        assertEq(frozen, 2 * ONE, "the window did not open at level 1");

        _answer(1, "UP_MOMENTUM");
        _answer(2, "DOWN_REVERSION");

        address stranger = makeAddr("passerby");
        vm.prank(stranger);
        population.endSeason();

        assertEq(population.seasonStartWindow(), population.windowCount(), "the season did not roll");
        assertEq(population.level(), 0, "a rolled season must be back at level 0");
        assertEq(population.ante(), 1 * ONE, "the live ante did not fall, so this proves nothing");

        _commit();

        assertEq(_p(1).currentStake(), frozen, "a stranger re-priced a window that was already forecast");
        assertEq(_p(2).currentStake(), frozen, "both legs must follow the same snapshot");
    }
}
