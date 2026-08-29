// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Somnia system interfaces: on-chain AI inference (AgentRequester) and the
// reactivity precompile.
//
// Signatures transcribed from docs.somnia.network, then CONFIRMED against Shannon
// on 2026-08-29 by decoding a live request payload (tx 0x78b04fc8…, block
// 474393064, agentId 12847293847561029384):
//   1. LLM_AGENT_ID = 12847293847561029384. Of the three agent ids observed across
//      6,236 request-creation logs, only this one carries selector 0xfe7ca098 in
//      its payload — in 96 of 96 of its requests. The other two never do.
//   2. abi.encodeCall(ILLMAgent.inferString, ...) matches what the platform
//      receives: 0xfe7ca098 is the selector this declaration hashes to, and it is
//      the selector live requests actually carry.
// The live payload also settles the parameter semantics below: arg1 decoded to
// "/no_think\n[SYSTEM POLICY]…", so it is a SYSTEM PROMPT, not a model name —
// which is what Population.think passes (p.systemPrompt()).
//
// Not yet observed live: a request with a non-empty `allowedValues`. The one
// decoded sample passed `false` and `[]`. See docs/SESSION_CHECKPOINT.md §3.

/// @dev Consensus rule the subcommittee applies to validator responses.
enum ConsensusType {
    Majority,
    Threshold
}

/// @dev Lifecycle of a single validator response, and of the request overall.
///      Ordinals are load-bearing: 0..4 as documented.
enum ResponseStatus {
    None,
    Pending,
    Success,
    Failed,
    TimedOut
}

struct Response {
    address validator;
    bytes result;
    ResponseStatus status;
    uint256 receipt;
    uint256 timestamp;
    uint256 executionCost;
}

struct Request {
    uint256 id;
    address requester;
    address callbackAddress;
    bytes4 callbackSelector;
    address[] subcommittee;
    Response[] responses;
    uint256 responseCount;
    uint256 failureCount;
    uint256 threshold;
    uint256 createdAt;
    uint256 deadline;
    ResponseStatus status;
    ConsensusType consensusType;
    uint256 remainingBudget;
    uint256 perAgentBudget;
}

/**
 *  The AgentRequester system contract — NOT a precompile, a regular contract at a
 *  fixed address per network. Inference is ALWAYS asynchronous:
 *
 *    createRequest -> RequestCreated -> validators submitResponse -> consensus
 *      -> handleResponse (on callbackAddress) -> rebate -> RequestFinalized
 *
 *  `callbackAddress` need not be the caller. DARWIN exploits that: Population pays
 *  every deposit from one funded account while each Prophet receives its own
 *  callback, so a ten-day unattended run has exactly one balance to watch.
 */
interface IAgentRequester {
    function createRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);

    function createAdvancedRequest(
        uint256 agentId,
        address callbackAddress,
        bytes4 callbackSelector,
        bytes calldata payload,
        uint256 subcommitteeSize,
        uint256 threshold,
        ConsensusType consensusType,
        uint256 timeout
    ) external payable returns (uint256 requestId);

    function getRequest(uint256 requestId) external view returns (Request memory);
    function hasRequest(uint256 requestId) external view returns (bool);

    /// @dev minPerAgentDeposit * subcommitteeSize. This is the ESCROW FLOOR only —
    ///      a request funded at exactly this amount is liable to be skipped,
    ///      because runners compare perAgentBudget against their own
    ///      scheduledExecutionCost. Add a per-agent reward on top.
    function getRequestDeposit() external view returns (uint256);
    function getAdvancedRequestDeposit(uint256 subcommitteeSize) external view returns (uint256);
}

/**
 *  The LLM Inference base agent.
 *
 *  Consensus over a language model works here only because the models are run
 *  deterministically across validating nodes. `allowedValues` is the important
 *  one for DARWIN: it constrains the output to an enum, which is what makes a
 *  model's answer safe to act on inside a contract at all.
 *
 *  Note what is absent: no model selector, no temperature, no max-tokens. The
 *  only knobs are chainOfThought, allowedValues, the numeric clamp, and
 *  maxIterations.
 */
interface ILLMAgent {
    function inferString(
        string calldata prompt,
        string calldata system,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory);

    function inferNumber(
        string calldata prompt,
        string calldata system,
        int256 minValue,
        int256 maxValue,
        bool chainOfThought
    ) external returns (int256);
}

/**
 *  The reactivity precompile at 0x0100.
 *
 *  It has NO bytecode, so eth_getCode returns 0x and presence cannot be probed
 *  that way. It does not exist at all on local dev chains (31337/1337), which is
 *  why the Foundry suite mocks this address rather than calling it: the real
 *  subscription path is only exercisable on Shannon.
 *
 *  A subscription is created off-chain (SDK) or on-chain; either way the OWNER
 *  funds every callback, and the callback arrives as a synthetic transaction
 *  inserted by validators in the SAME BLOCK as the matching log.
 */
interface ISomniaReactivityPrecompile {
    /*
     *  VERIFIED 2026-08-29 against `SomniaReactivityPrecompileABI` in
     *  `@somnia-chain/reactivity@0.2.1` (`dist/index.d.ts`, `dist/index.cjs`).
     *
     *  Field ORDER is load-bearing — this is a single struct argument, not a
     *  parameter list, so `subscribe` takes ONE tuple and the selector is
     *  `subscribe((bytes32[4],address,address,address,address,bytes4,uint64,uint64,uint64,bool,bool))`.
     *  The fee fields are `uint64`, not `uint256`.
     *
     *  There is deliberately NO `gasPayer` and NO `refundee`: the subscription's
     *  OWNER — whoever sent the `subscribe` transaction — funds every callback out
     *  of its own balance. An earlier revision of this interface invented both
     *  fields, plus `includeData` and `active`; none of them exist.
     */
    struct SubscriptionData {
        /// @dev Up to four topic filters, left-padded with bytes32(0). At least one
        ///      of (eventTopics, origin, emitter) must be non-zero — a subscription
        ///      with no filter at all is rejected rather than treated as a wildcard.
        bytes32[4] eventTopics;
        /// @dev Optional `tx.origin` filter. Zero means "any".
        address origin;
        /// @dev Reserved by the protocol; not currently used in event matching.
        ///      The SDK always sends address(0).
        address caller;
        /// @dev Optional emitting-contract filter. Zero means "any".
        address emitter;
        address handlerContractAddress;
        /// @dev Selector invoked on the handler. `onEvent(address,bytes32[],bytes)`.
        bytes4 handlerFunctionSelector;
        uint64 priorityFeePerGas;
        /// @dev Either zero, or at least `priorityFeePerGas + 6 gwei`. Violating the
        ///      separation rule is rejected, which is easy to do accidentally when
        ///      gas is cheap and the cap is derived from the current base fee.
        uint64 maxFeePerGas;
        /// @dev Must satisfy `0 < gasLimit <= 200_000_000`.
        uint64 gasLimit;
        /// @dev Deliver the notification even when the block-inclusion distance from
        ///      the emitting block grows. The SDK's friendly wrapper hardcodes false.
        bool isGuaranteed;
        /// @dev Collapse several matching events in one block into a single handler
        ///      call. Relevant here: the settlement emitter is a shared singleton, so
        ///      a busy block can carry many `MarketFinalized` logs and the owner pays
        ///      per callback. The SDK's friendly wrapper hardcodes false.
        bool isCoalesced;
    }

    function subscribe(SubscriptionData calldata subscriptionData) external returns (uint256 subscriptionId);

    function unsubscribe(uint256 subscriptionId) external;

    function getSubscriptionInfo(uint256 subscriptionId)
        external
        view
        returns (SubscriptionData memory subscriptionData, address owner);
}

/*
 *  The one function a reactive handler exposes. msg.sender is the precompile.
 *
 *  VERIFIED 2026-08-29 against `SomniaEventHandlerABI` in
 *  `@somnia-chain/reactivity@0.2.1`:
 *
 *      onEvent(address emitter, bytes32[] eventTopics, bytes data)
 *
 *  This replaces `onSomniaEvent`, which was a placeholder name this repo invented
 *  while only the internal `_onEvent` override was documented. The parameter shape
 *  was already right; the selector was wrong, and a wrong selector is the silent
 *  failure mode — validators would call a function that does not exist, the
 *  callback would revert into the fallback, and the subscription would look like
 *  reactivity simply not working.
 *
 *  Note `eventTopics` is a DYNAMIC `bytes32[]` here, while the subscription filter
 *  is a fixed `bytes32[4]`. That asymmetry is theirs, not a transcription slip.
 */
interface ISomniaEventHandler {
    function onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata data) external;
}
