// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Response, Request, ResponseStatus, ConsensusType} from "../../src/interfaces/ISomnia.sol";

/**
 *  Test doubles.
 *
 *  These are not conveniences, they are the only way to test this system at all.
 *  Somnia's reactivity precompile DOES NOT EXIST on chain ids 31337/1337 — not "is
 *  unfunded" or "reverts", it is absent — and `AgentRequester` is a live system
 *  contract with real validators behind it. Neither can be reached from `forge test`.
 *
 *  So the async inference round-trip and the reactive callback are mocked here, and
 *  the real paths are validated only on Shannon. That split is a hard constraint of
 *  the platform, not a testing preference, and it is why `scripts/prove-same-block.ts`
 *  exists: the one claim these mocks cannot support is the same-block property, which
 *  therefore has to be asserted against the live chain.
 */

/*//////////////////////////////////////////////////////////////
                              ERC-20
//////////////////////////////////////////////////////////////*/

contract MockERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /**
     *  Refuse transfers FROM one address, optionally after letting `grace` of them
     *  through first.
     *
     *  Per-holder rather than a blanket `paused` flag because the interesting case is
     *  ONE holder failing while the rest of the population settles normally — a halted
     *  cadence and a deferred single reap are indistinguishable if everybody fails at
     *  once.
     *
     *  THE `grace` COUNTER IS SYNTHETIC AND THE TEST THAT USES IT SAYS SO. A real
     *  pausable token cannot start refusing between two transfers inside one
     *  transaction, so this does not model a reachable Shannon state; it exists to make
     *  a handler that is otherwise unprovable actually watchable. Same precedent as
     *  `GenesisTreasury`'s `ZeroArena` check, which was decorative until a test
     *  constructed the argument the factory can never produce.
     */
    mapping(address => bool) public frozen;
    mapping(address => uint256) public transferGrace;

    constructor(string memory n, string memory s, uint8 d) {
        name = n;
        symbol = s;
        decimals = d;
    }

    function setFrozen(address who, bool on) external {
        frozen[who] = on;
        transferGrace[who] = 0;
    }

    /// @dev Freeze `who`, but let its next `grace` transfers succeed first.
    function setFrozenAfter(address who, uint256 grace) external {
        frozen[who] = true;
        transferGrace[who] = grace;
    }

    function _checkFrozen(address from) internal {
        if (!frozen[from]) return;
        uint256 g = transferGrace[from];
        if (g == 0) revert("frozen");
        transferGrace[from] = g - 1;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    /// @dev REVERTS rather than returning false when frozen. Both are real ERC-20
    ///      behaviours and `Prophet.stakeOut` already checks the boolean
    ///      (`if (!transfer(...)) revert TransferFailed()`), so a `false` would be
    ///      converted into a revert one frame up and could not tell whether the revert
    ///      is caught. Reverting here exercises the raw propagation path instead.
    function transfer(address to, uint256 amount) external returns (bool) {
        _checkFrozen(msg.sender);
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _checkFrozen(from);
        if (from != msg.sender) {
            uint256 a = allowance[from][msg.sender];
            if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/*//////////////////////////////////////////////////////////////
                        ERC-6909 OUTCOME TOKEN
//////////////////////////////////////////////////////////////*/

/// @dev One singleton for all markets; Up and Down are token *ids*, not separate
///      ERC-20s. Getting that wrong is the most likely integration mistake, so the
///      mock keeps the same shape.
contract MockOutcomeToken {
    mapping(address => mapping(uint256 => uint256)) public balanceOf;
    mapping(address => mapping(address => bool)) public isOperator;

    function mint(address to, uint256 id, uint256 amount) external {
        balanceOf[to][id] += amount;
    }

    function burn(address from, uint256 id, uint256 amount) external {
        balanceOf[from][id] -= amount;
    }

    function transfer(address to, uint256 id, uint256 amount) external returns (bool) {
        balanceOf[msg.sender][id] -= amount;
        balanceOf[to][id] += amount;
        return true;
    }

    function approve(address, uint256, uint256) external pure returns (bool) {
        return true;
    }

    function setOperator(address spender, bool approved) external returns (bool) {
        isOperator[msg.sender][spender] = approved;
        return true;
    }
}

/*//////////////////////////////////////////////////////////////
                            BINARY POOL
//////////////////////////////////////////////////////////////*/

contract MockBinaryPool {
    MockERC20 public immutable collateral;
    MockOutcomeToken public immutable outcomeToken;
    address public immutable settlement;
    uint256 public yesId;
    uint256 public noId;

    constructor(MockERC20 c, MockOutcomeToken t, address s, uint256 yes, uint256 no) {
        collateral = c;
        outcomeToken = t;
        settlement = s;
        yesId = yes;
        noId = no;
    }

    /// @dev Independent recipients — the property the whole pairing design rests on.
    ///      Collateral is forwarded straight to settlement so the mock's books close:
    ///      backing lives where payouts come from, exactly as on chain after
    ///      finalization.
    function mintSet(address yesTo, address noTo, uint256 amount) external {
        collateral.transferFrom(msg.sender, settlement, amount);
        outcomeToken.mint(yesTo, yesId, amount);
        outcomeToken.mint(noTo, noId, amount);
    }

    function burnSet(uint256) external pure {}

    function placeBinaryOrder(uint8, uint256, uint256, uint64, uint8, uint8, address, uint96, uint64)
        external
        payable
        returns (bool, uint128)
    {
        return (true, 1);
    }
}

/// @dev A pool that reverts on mintSet, to prove one failed pair cannot roll back a
///      whole window of commitments.
contract RevertingPool {
    function mintSet(address, address, uint256) external pure {
        revert("pool down");
    }
}

/*//////////////////////////////////////////////////////////////
                            SETTLEMENT
//////////////////////////////////////////////////////////////*/

contract MockSettlement {
    MockERC20 public immutable collateral;
    MockOutcomeToken public immutable outcomeToken;

    /// @dev Payout per outcome token, in bps. 10000 = winner, 0 = loser,
    ///      5000 = voided (a real void pays BOTH sides 0.5).
    mapping(uint256 => uint256) public payoutBps;
    mapping(address => mapping(address => uint256)) public owed;

    /// @dev When true, pay via the `owed` credit path instead of transferring, so the
    ///      claim path is exercised. Note the return value is still the honest
    ///      `collateralOut` — the real contract reports what the position was worth
    ///      regardless of how it chose to deliver it, and a Prophet that ledgered the
    ///      return value instead of its own balance delta would book collateral it
    ///      does not hold.
    bool public creditInsteadOfPay;

    /// @dev Lets a test make `claimOwed` unavailable for one window, so the
    ///      "credited, could not claim yet, rescued later" path is reachable.
    bool public claimEnabled = true;

    constructor(MockERC20 c, MockOutcomeToken t) {
        collateral = c;
        outcomeToken = t;
    }

    function setPayouts(uint256 winnerId, uint256 loserId) external {
        payoutBps[winnerId] = 10_000;
        payoutBps[loserId] = 0;
    }

    function setVoid(uint256 upId, uint256 downId) external {
        payoutBps[upId] = 5_000;
        payoutBps[downId] = 5_000;
    }

    function setCreditMode(bool on) external {
        creditInsteadOfPay = on;
    }

    function setClaimEnabled(bool on) external {
        claimEnabled = on;
    }

    function finalizeAndRedeem(address, uint256 outcomeId, uint256 amount, address to)
        external
        returns (uint256 collateralOut)
    {
        outcomeToken.burn(msg.sender, outcomeId, amount);
        collateralOut = (amount * payoutBps[outcomeId]) / 10_000;
        if (collateralOut == 0) return 0;
        if (creditInsteadOfPay) {
            owed[to][address(collateral)] += collateralOut;
            return collateralOut; // worth is reported; custody has not moved
        }
        collateral.transfer(to, collateralOut);
    }

    function claimOwed(address token) external returns (uint256 amount) {
        require(claimEnabled, "claims disabled");
        amount = owed[msg.sender][token];
        if (amount == 0) return 0;
        owed[msg.sender][token] = 0;
        MockERC20(token).transfer(msg.sender, amount);
    }
}

/*//////////////////////////////////////////////////////////////
                          MARKETS MODULE
//////////////////////////////////////////////////////////////*/

contract MockMarketsModule {
    struct Rec {
        address market;
        address pool;
        uint256 yesId;
        uint256 noId;
        uint64 tradingStart;
        uint64 expiry;
    }

    mapping(bytes32 => Rec) public recs;

    function setMarket(bytes32 id, Rec calldata r) external {
        recs[id] = r;
    }

    function markets(bytes32 marketId)
        external
        view
        returns (
            uint256,
            uint8,
            uint8,
            address,
            uint32,
            bytes32,
            address,
            address,
            address,
            address,
            uint256,
            uint256,
            uint64,
            uint64
        )
    {
        Rec memory r = recs[marketId];
        return (
            0,
            2,
            0,
            address(0),
            0,
            bytes32(0),
            address(0),
            address(0),
            r.market,
            r.pool,
            r.yesId,
            r.noId,
            r.tradingStart,
            r.expiry
        );
    }
}

contract MockBinaryMarket {
    bool public isResolved;
    bool public isVoided;

    function setState(bool resolved, bool voided) external {
        isResolved = resolved;
        isVoided = voided;
    }
}

/*//////////////////////////////////////////////////////////////
                          AGENT REQUESTER
//////////////////////////////////////////////////////////////*/

/**
 *  Stands in for the real `AgentRequester`, whose responses come from a validator
 *  subcommittee running a model deterministically.
 *
 *  `deliver` is the important part: it lets a test drive ANY of the five
 *  `ResponseStatus` values and any degree of validator disagreement, including the
 *  cases that are hard to provoke on a live chain and therefore the ones most likely
 *  to be wrong in production — timeouts, empty response arrays, and two validators
 *  returning different answers.
 */
contract MockAgentRequester {
    struct Pending {
        address callbackAddress;
        bytes4 callbackSelector;
        bytes payload;
        uint256 value;
        bool delivered;
    }

    uint256 public nextId = 1;
    /// @dev PER VALIDATOR, because `getAdvancedRequestDeposit` multiplies by the
    ///      subcommittee size below. 0.01 ether is the floor MEASURED on Shannon, and
    ///      it is measured rather than guessed: the real `AgentRequester` returns
    ///      exactly `0.01 STT * subcommitteeSize`, linearly, with no fixed component.
    ///      Until 2026-09-06 this was 0.03, which made `requestDeposit()` report 0.093
    ///      against a live 0.033 — a 2.8x overstatement, in the one direction that
    ///      hides a problem: every cognition-budget test was passing against a bill
    ///      almost three times the real one, so a genuinely underfunded organism would
    ///      have looked fine here. A mock that is wrong in the SAFE direction is worse
    ///      than one that is wrong loudly.
    uint256 public depositFloor = 0.01 ether;
    mapping(uint256 => Pending) public pending;

    /// @dev Set to make every `createAdvancedRequest` revert, proving one organism's
    ///      failure to think cannot halt the population.
    bool public failCreate;

    event Created(uint256 id, address callbackAddress);

    function setFailCreate(bool on) external {
        failCreate = on;
    }

    function setDepositFloor(uint256 v) external {
        depositFloor = v;
    }

    function getRequestDeposit() external view returns (uint256) {
        return depositFloor;
    }

    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256) {
        return depositFloor * subcommitteeSize;
    }

    function createRequest(uint256, address cb, bytes4 sel, bytes calldata payload) external payable returns (uint256) {
        return _create(cb, sel, payload);
    }

    function createAdvancedRequest(
        uint256,
        address cb,
        bytes4 sel,
        bytes calldata payload,
        uint256,
        uint256,
        ConsensusType,
        uint256
    ) external payable returns (uint256) {
        if (failCreate) revert("agent down");
        return _create(cb, sel, payload);
    }

    function _create(address cb, bytes4 sel, bytes calldata payload) internal returns (uint256 id) {
        id = nextId++;
        pending[id] =
            Pending({callbackAddress: cb, callbackSelector: sel, payload: payload, value: msg.value, delivered: false});
        emit Created(id, cb);
    }

    /// @dev Deliver a unanimous answer.
    function deliver(uint256 requestId, string memory answer) external {
        string[] memory answers = new string[](3);
        answers[0] = answer;
        answers[1] = answer;
        answers[2] = answer;
        _deliver(requestId, answers, ResponseStatus.Success, ResponseStatus.Success);
    }

    /// @dev Deliver per-validator answers, so disagreement can be tested. Pass an
    ///      empty array to deliver a `Success` with NO responses — the case that
    ///      indexes out of bounds if a handler trusts `status` alone.
    function deliverMixed(uint256 requestId, string[] memory answers, ResponseStatus overallStatus) external {
        _deliver(requestId, answers, overallStatus, ResponseStatus.Success);
    }

    /// @dev Deliver a non-Success overall status (Failed / TimedOut / Pending / None).
    function deliverStatus(uint256 requestId, ResponseStatus overallStatus) external {
        string[] memory none = new string[](0);
        _deliver(requestId, none, overallStatus, ResponseStatus.Failed);
    }

    function _deliver(
        uint256 requestId,
        string[] memory answers,
        ResponseStatus overallStatus,
        ResponseStatus perResponseStatus
    ) internal {
        Pending storage p = pending[requestId];
        require(p.callbackAddress != address(0), "no such request");
        p.delivered = true;

        Response[] memory responses = new Response[](answers.length);
        address[] memory committee = new address[](answers.length);
        for (uint256 i; i < answers.length; ++i) {
            // Deterministic, low, easily recognisable validator addresses.
            address v = address(uint160(1000 + i));
            committee[i] = v;
            responses[i] = Response({
                validator: v,
                result: abi.encode(answers[i]),
                status: perResponseStatus,
                receipt: uint256(keccak256(abi.encode(requestId, i))),
                timestamp: block.timestamp,
                executionCost: 1
            });
        }

        Request memory req = Request({
            id: requestId,
            requester: address(this),
            callbackAddress: p.callbackAddress,
            callbackSelector: p.callbackSelector,
            subcommittee: committee,
            responses: responses,
            responseCount: answers.length,
            failureCount: 0,
            threshold: 2,
            createdAt: block.timestamp,
            deadline: block.timestamp + 300,
            status: overallStatus,
            consensusType: ConsensusType.Majority,
            remainingBudget: 0,
            perAgentBudget: p.value / 3
        });

        (bool ok, bytes memory err) =
            p.callbackAddress.call(abi.encodeWithSelector(p.callbackSelector, requestId, responses, overallStatus, req));
        if (!ok) {
            if (err.length == 0) revert("callback reverted");
            assembly {
                revert(add(err, 0x20), mload(err))
            }
        }
    }
}
