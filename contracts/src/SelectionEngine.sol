// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Population} from "./Population.sol";

/*
 *  The reactive handler: consequence in the same block as resolution.
 *
 *  Somnia's reactivity precompile lets validators insert a synthetic transaction in
 *  the SAME BLOCK as a matching log. Subscribed to BinarySettlement's resolution
 *  event, this contract turns a market settling into an organism dying without any
 *  keeper, cron, bot, or server in between. That is the project's central technical
 *  claim, and `scripts/prove-same-block.ts` exists to assert it by comparing the two
 *  transactions' `blockNumber` — if that assertion ever fails, the claim is false and
 *  the pitch has to change.
 *
 *  WHY AN ADAPTER RATHER THAN SUBSCRIBING POPULATION DIRECTLY. Population already
 *  accepts the precompile as a driver, so in principle a subscription could target
 *  `settleAll()` and this contract would be unnecessary. Two reasons it exists
 *  anyway:
 *
 *    1. The external entrypoint the precompile actually invokes is NOT verified.
 *       The docs show only the internal `_onEvent` override on the
 *       `SomniaEventHandler` base; the real selector belongs to whatever that base
 *       declares. Isolating it in a small contract means the unverified part is one
 *       upgradeable adapter, not the contract holding the registry.
 *    2. Reactivity does not exist on local chains at all, so `forge test` cannot
 *       exercise the real path. A thin adapter is mockable; a subscription is not.
 *
 *  RESOLUTION PATH: install `@somnia-chain/reactivity-contracts`, make this contract
 *  inherit `SomniaEventHandler`, and move the body of `_handle` into the `_onEvent`
 *  override. Delete `onSomniaEvent` at that point. Until then the fallback driver
 *  below keeps the population running, because the day-2 go-live must not be blocked
 *  on an unverified selector.
 */
contract SelectionEngine {
    /// @dev The reactivity precompile. No bytecode — `eth_getCode` returns `0x` —
    ///      so its presence cannot be probed and this is only ever compared against
    ///      `msg.sender`.
    address public constant REACTIVITY = 0x0000000000000000000000000000000000000100;

    Population public immutable population;
    address public immutable settlementEmitter;
    address public owner;

    /// @dev Set false once reactivity is confirmed working, to close the manual
    ///      path and make the keeperless claim structurally true rather than merely
    ///      preferred.
    bool public fallbackEnabled = true;

    /**
     *  The evidence event.
     *
     *  Deliberately records `block.number` and `blockhash` even though both are
     *  implicit in the receipt: it makes the same-block property provable from a
     *  log query alone, without correlating two transactions by hand, and it gives
     *  the frontend's death feed something to deep-link.
     */
    event Reacted(
        address indexed emitter, uint64 indexed window, uint256 blockNumber, bytes32 parentHash, bool viaReactivity
    );
    event ReactionFailed(address indexed emitter, uint256 blockNumber, bytes reason);
    event FallbackDisabled();

    error NotAuthorized();
    error UnexpectedEmitter(address got, address want);
    error FallbackClosed();

    constructor(Population population_, address settlementEmitter_, address owner_) {
        population = population_;
        settlementEmitter = settlementEmitter_;
        owner = owner_;
    }

    /**
     *  Entrypoint invoked by the precompile.
     *
     *  UNVERIFIED SELECTOR — see the contract-level note. The parameter shape is
     *  documented and correct; the function NAME is a placeholder standing in for
     *  whatever `SomniaEventHandler` declares.
     */
    function onSomniaEvent(address emitter, bytes32[] calldata, /* topics */ bytes calldata /* data */ )
        external
    {
        if (msg.sender != REACTIVITY) revert NotAuthorized();
        // The subscription filters on emitter, but a filter is a request and this is
        // a check. Cheap enough to do both.
        if (emitter != settlementEmitter) revert UnexpectedEmitter(emitter, settlementEmitter);
        _handle(true);
    }

    /**
     *  Manual driver, for the window between go-live and reactivity being verified.
     *
     *  This is the honest seam in the architecture and it is named as one. While it
     *  is open, the correct claim is "selection is on-chain and atomic with
     *  redemption"; only once `disableFallback()` has been called is "no keeper
     *  anywhere in the causal chain" literally true. Do not narrate the stronger
     *  claim while this returns true.
     */
    function poke() external {
        if (!fallbackEnabled) revert FallbackClosed();
        if (msg.sender != owner) revert NotAuthorized();
        _handle(false);
    }

    /// @dev One-way. Closes the manual path for good.
    function disableFallback() external {
        if (msg.sender != owner) revert NotAuthorized();
        fallbackEnabled = false;
        emit FallbackDisabled();
    }

    /**
     *  Grade the window.
     *
     *  A revert inside a reactive callback is paid for by the subscription owner and
     *  buys nothing, so the failure is caught and logged instead. Bubbling it would
     *  drain the subscription on every settlement of a window this population never
     *  committed to.
     */
    function _handle(bool viaReactivity) internal {
        uint64 window = population.windowCount();
        try population.settleAll() {
            emit Reacted(settlementEmitter, window, block.number, blockhash(block.number - 1), viaReactivity);
        } catch (bytes memory reason) {
            emit ReactionFailed(settlementEmitter, block.number, reason);
        }
    }

    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotAuthorized();
        owner = to;
    }
}
