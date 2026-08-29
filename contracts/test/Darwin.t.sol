// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {Population} from "../src/Population.sol";
import {Prophet} from "../src/Prophet.sol";
import {PushedPriceSource} from "../src/PushedPriceSource.sol";
import {SelectionEngine} from "../src/SelectionEngine.sol";
import {DreamDEXVenue} from "../src/venues/DreamDEXVenue.sol";
import {IArenaVenue} from "../src/interfaces/IArenaVenue.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {Genome, Belief, Thesis} from "../src/Genome.sol";
import {IBinaryMarketsModule} from "../src/interfaces/IDreamDEX.sol";
import {
    Response,
    Request,
    ResponseStatus,
    ConsensusType,
    ISomniaEventHandler
} from "../src/interfaces/ISomnia.sol";

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
            IPriceSource(address(priceSource)),
            address(settlement),
            address(collateral),
            address(outcomeToken),
            "BTC"
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

        // Cognition is paid in native; endowments and payouts in collateral.
        vm.deal(address(population), 100 ether);
        collateral.mint(address(population), 10_000 * ONE);

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

    function _stake() internal view returns (uint256) {
        return (population.endowment() * population.stakeBps()) / 10_000;
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
        assertEq(_p(1).treasury(), endowment + stake - metabolism, "winner nets the loser's stake");
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
            endowment + stake - population.metabolicCost(),
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

        assertFalse(
            outcomeToken.isOperator(address(_p(1)), address(venue)), "the venue must not hold operator rights"
        );
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
            IPriceSource(address(priceSource)),
            address(settlement),
            address(collateral),
            address(outcomeToken),
            "BTC"
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
        assertEq(_p(1).treasury(), population.endowment() + _stake() - population.metabolicCost());
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
            population.endowment() - stake - population.metabolicCost(),
            "unbooked until it actually arrives"
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
        p.initialize(address(this), 99, 0, 0, 0, "hijacked");
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
        assertEq(_p(1).treasury(), endowment + stake - metabolism, "winner nets the loser's stake");
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
}
