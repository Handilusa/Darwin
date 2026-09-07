// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Population} from "./Population.sol";
import {IBinaryMarket, IBinaryMarketsModule} from "./interfaces/IDreamDEX.sol";

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
 *    1. The precompile calls a FIXED selector, `onEvent(address,bytes32[],bytes)`,
 *       and hands over (emitter, topics, data). `settleAll()` takes no arguments and
 *       has a different selector, so it cannot be a callback target at all. Something
 *       has to adapt the handler shape to the registry, and keeping that something
 *       small means the reactive surface is one upgradeable adapter rather than the
 *       contract holding the registry.
 *    2. Reactivity does not exist on local chains at all, so `forge test` cannot
 *       exercise the real path. A thin adapter is mockable; a subscription is not.
 *       `Darwin.t.sol` reaches `onEvent` by pranking as `0x0100`, which tests the
 *       authorisation and the emitter check but not validator insertion — that last
 *       property is what `scripts/prove-same-block.ts` asserts against Shannon.
 *
 *  The handler selector was verified on 2026-08-29 against `SomniaEventHandlerABI`
 *  in `@somnia-chain/reactivity@0.2.1`, so the earlier "unverified selector" caveat
 *  is retired. The fallback driver below remains, because a subscription can still
 *  be unfunded or unfired for reasons that have nothing to do with the selector.
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
    event OwnershipTransferred(address indexed previous, address indexed current);

    error NotAuthorized();
    error UnexpectedEmitter(address got, address want);
    error FallbackClosed();
    error ZeroOwner();

    /*
     *  THE THREE REASONS A REACTIVE CALLBACK IS DECLINED.
     *
     *  Never reverted — each is encoded into `ReactionFailed.reason` so an operator reading
     *  the log gets a sentence instead of a hex blob, the same convention the script ABIs in
     *  `scripts/lib/darwin.ts` follow. They are errors rather than a bare enum so that the
     *  reason field decodes with the same tooling as a genuine `settleAll` revert, and so the
     *  two are told apart by selector rather than by guesswork.
     */

    /// @dev Nothing is committed, so `settleAll` would revert `WrongPhase` whatever we do.
    error NoCommittedWindow(uint8 phase);
    /// @dev The window's own market could not be read back — no module, no market, or a
    ///      market that does not answer `isResolved`/`isVoided`.
    error MarketUnreadable(bytes32 marketId, address market);
    /// @dev The window's market is neither resolved nor voided: this settlement belongs to
    ///      somebody else, and grading against it would close our window early.
    error MarketNotDecided(bytes32 marketId, address market);

    constructor(Population population_, address settlementEmitter_, address owner_) {
        population = population_;
        settlementEmitter = settlementEmitter_;
        owner = owner_;
    }

    /*
     *  Entrypoint invoked by the precompile.
     *
     *  `onEvent(address,bytes32[],bytes)` is VERIFIED (2026-08-29) against
     *  `SomniaEventHandlerABI` in `@somnia-chain/reactivity@0.2.1`. It is no longer
     *  a placeholder, so the selector no longer needs an env-var escape hatch.
     *
     *  ────────────────────────────────────────────────────────────────────────────
     *  THE CROSS-TALK DEFECT THIS GUARD EXISTS TO PREVENT, diagnosed 2026-09-07.
     *
     *  `BinarySettlement` is a SHARED TESTNET SINGLETON. Every DreamDEX binary market
     *  on Shannon finalizes into it, so this subscription fires on other people's
     *  markets constantly — the emitter check above cannot tell them apart, because
     *  the emitter is the same contract every time.
     *
     *  Until this guard existed, every one of those foreign finalizations called
     *  `population.settleAll()`. And `settleAll` does not care WHY it was called: it
     *  is `inPhase(2)`, it skips organisms with no open position, and it writes
     *  `phase = 0` unconditionally (`Population.sol:1851`). So a stranger's market
     *  settling would CLOSE OUR WINDOW — grading a population against a market that
     *  had not resolved, charging metabolism for it, and returning the machine to
     *  phase 0 while our own market was still live. It is not a wasted callback; it
     *  is a corrupted generation, and it looks identical in the logs to a window that
     *  simply went nowhere.
     *
     *  WHY THE GUARD IS ON OUR OWN STATE AND NOT ON THE EVENT PAYLOAD. The obvious
     *  fix is to read the settlement's pool out of `topics`/`data` and compare it to
     *  `activePool`. It is not available: the subscription is created with
     *  `isCoalesced: true`, which collapses every matching log in a block into ONE
     *  callback, and neither `@somnia-chain/reactivity@0.2.1` nor
     *  `@somnia-chain/markets-sdk@0.28.1` documents what `topics`/`data` carry in that
     *  case. A comparison against a payload whose shape is unverified would be a
     *  guess wearing the costume of a check — and if the guess were wrong it would
     *  drop OUR settlement, which is worse than the defect.
     *
     *  So the question asked here is not "whose market settled?" but "is the window
     *  this population committed to actually decidable yet?" — which is answerable
     *  entirely from state we own, needs no payload, no new constructor argument and
     *  no trust in coalescing semantics. It is also the strictly better question: a
     *  foreign settlement that happens to land in the same block as our own market's
     *  resolution SHOULD still settle us, and this lets it, whereas a pool-identity
     *  filter would have thrown that block away.
     *  ────────────────────────────────────────────────────────────────────────────
     */
    function onEvent(
        address emitter,
        bytes32[] calldata,
        /* topics */
        bytes calldata /* data */
    )
        external
    {
        if (msg.sender != REACTIVITY) revert NotAuthorized();
        // The subscription filters on emitter, but a filter is a request and this is
        // a check. Cheap enough to do both.
        if (emitter != settlementEmitter) revert UnexpectedEmitter(emitter, settlementEmitter);

        // DECLINE, DO NOT REVERT. A revert here is billed to the subscription owner and
        // buys nothing, and on a shared singleton the declining case is the COMMON one —
        // so it gets a log line rather than a failed transaction, exactly like a caught
        // `settleAll`. `prove-same-block.ts` reads `Reacted`, never `ReactionFailed`, so a
        // declined callback can never be mistaken for evidence of the same-block claim.
        (bool decidable, bytes memory why) = _windowIsDecidable();
        if (!decidable) {
            emit ReactionFailed(settlementEmitter, block.number, why);
            return;
        }

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
     *
     *  DELIBERATELY NOT GUARDED BY `_windowIsDecidable`. The guard on `onEvent` filters an
     *  UNAUTHENTICATED trigger — anyone's market finalizing pulls that lever, so the
     *  contract has to decide for itself whether the pull meant anything. `poke` is the
     *  owner, who has already decided. Putting the same guard here would convert the
     *  escape hatch into a second thing that can refuse, and the case it would refuse in
     *  is precisely the one the hatch exists for: a market that resolved in a way the
     *  module cannot report, or a window that must be closed out by hand. The owner is a
     *  `Population` driver in their own right, so `settleAll()` is reachable directly
     *  regardless — a guard here would buy nothing and cost the operator a step.
     */
    function poke() external {
        // AUTHORITY FIRST, STATE SECOND. Reversed until 2026-09-05, which made the
        // revert reason wrong for the only caller who can act on it: a stranger
        // calling after `disableFallback` was told `FallbackClosed` — a fact about
        // the contract's posture — when the true and only relevant answer is that
        // they are not the owner. Checking the caller first means each party gets
        // the error that describes their own problem, and the honesty flag stops
        // being readable through a revert by anyone who feels like probing it.
        if (msg.sender != owner) revert NotAuthorized();
        if (!fallbackEnabled) revert FallbackClosed();
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

    /**
     *  Is the window this population committed to actually decidable right now?
     *
     *  READ ORDER IS CHEAPEST-AND-MOST-SELECTIVE FIRST, which matters because this runs on
     *  every foreign settlement and the subscription owner pays for all of them. `phase`
     *  is one `SLOAD` through one external call and rejects the large majority: outside
     *  phase 2 there is nothing committed, so `settleAll` would revert `WrongPhase` and the
     *  market reads would have been bought for nothing.
     *
     *  EVERY EXTERNAL READ IS WRAPPED, and the answer to an unreadable market is "not
     *  decidable" rather than "assume it is". The direction of that default is the whole
     *  safety property: declining a callback costs one window's latency, since the next
     *  settlement in the block after ours resolves will pass the guard, and the owner's
     *  `poke()` is open besides. Proceeding on an unreadable market costs a corrupted
     *  generation, which nothing recovers — `dead` is never cleared.
     *
     *  A VOIDED MARKET COUNTS AS DECIDED. It is not a failure state: the payout vector is
     *  equal, both sides get their backing back, and `settleAll` grades the window as
     *  unadjudicable rather than wrong. Treating a void as undecidable would wedge phase 2
     *  for exactly the markets that already refused to resolve — and since `voidExpired()`
     *  is permissionless, a market that never resolves is how this guard RELEASES rather
     *  than a way it can lock.
     */
    function _windowIsDecidable() internal view returns (bool, bytes memory) {
        uint8 phase = population.phase();
        if (phase != 2) return (false, abi.encodeWithSelector(NoCommittedWindow.selector, phase));

        bytes32 marketId = population.activeMarketId();
        address market = _activeMarket(population.marketsModule(), marketId);
        if (market == address(0)) {
            return (false, abi.encodeWithSelector(MarketUnreadable.selector, marketId, market));
        }

        bool resolved;
        try IBinaryMarket(market).isResolved() returns (bool r) {
            resolved = r;
        } catch {
            return (false, abi.encodeWithSelector(MarketUnreadable.selector, marketId, market));
        }
        if (resolved) return (true, "");

        try IBinaryMarket(market).isVoided() returns (bool v) {
            if (v) return (true, "");
        } catch {
            return (false, abi.encodeWithSelector(MarketUnreadable.selector, marketId, market));
        }

        return (false, abi.encodeWithSelector(MarketNotDecided.selector, marketId, market));
    }

    /**
     *  The active window's market address, or zero if it cannot be established.
     *
     *  ITS OWN FRAME ON PURPOSE, and this is a `via_ir` stack constraint rather than a
     *  style choice — the same one documented at `PushedPriceSource._resolveMarket`.
     *  `IBinaryMarketsModule.markets` returns a FOURTEEN-value tuple, so the `returns`
     *  clause of the `try` needs fourteen stack slots live at once. Destructuring it
     *  inside `_windowIsDecidable`, which already holds a `bytes memory` and the marketId,
     *  is how that function stops compiling. Do not inline this.
     */
    function _activeMarket(address module, bytes32 marketId) internal view returns (address) {
        if (module == address(0) || marketId == bytes32(0)) return address(0);
        try IBinaryMarketsModule(module).markets(marketId) returns (
            uint256,
            uint8,
            uint8,
            address,
            uint32,
            bytes32,
            address,
            address,
            address market,
            address,
            uint256,
            uint256,
            uint64,
            uint64
        ) {
            return market;
        } catch {
            return address(0);
        }
    }

    /**
     *  ONE-STEP, BUT NOT UNGUARDED — and the missing guard mattered here more than
     *  the missing second step.
     *
     *  `owner` is the only address that can call `disableFallback`, and
     *  `disableFallback` is what turns the licensed claim from *"selection is
     *  on-chain and atomic with redemption"* into *"no keeper anywhere in the causal
     *  chain"*. Handing ownership to `address(0)` therefore did not merely lose an
     *  admin key: it froze `fallbackEnabled` at `true` permanently and made the
     *  project's central claim unprovable for the life of the contract. That is a
     *  typo away, so zero is refused.
     *
     *  A two-step handover (`pendingOwner` / `acceptOwnership`) is deliberately NOT
     *  added. It defends against a transfer to a live-but-uncontrolled address, and
     *  here that case is fully recoverable: this contract is plain, non-upgradeable
     *  and freely redeployable, and `Population.setWiring` repoints to a fresh one
     *  in a single transaction — none of which is true of `Population` itself, which
     *  uses OZ `Ownable` and gets its zero-check from there. Keeping the reactive
     *  surface small enough to redeploy IS the recovery mechanism; a state machine
     *  guarding a contract designed to be thrown away would be the more expensive
     *  half of that trade.
     */
    function transferOwnership(address to) external {
        if (msg.sender != owner) revert NotAuthorized();
        if (to == address(0)) revert ZeroOwner();
        emit OwnershipTransferred(owner, to);
        owner = to;
    }
}
