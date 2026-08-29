// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Somnia system interfaces: on-chain AI inference (AgentRequester) and the
// reactivity precompile.
//
// Signatures transcribed from docs.somnia.network. Two things here are not
// guesses but are also not yet confirmed against a live node — both are marked
// VERIFY and both are one-line changes:
//   1. LLM_AGENT_ID (the roster id for the LLM Inference base agent)
//   2. whether abi.encodeCall(ILLMAgent.inferString, ...) is byte-identical to
//      what the code generator at agents.somnia.network emits for the payload
// Do not ship a demo until both have been checked against Shannon.

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
    function subscribe(
        bytes32[4] memory topics,
        address emitter,
        address handler,
        address gasPayer,
        address refundee,
        bytes4 callbackSelector,
        uint64 gasLimit,
        uint64 maxFeePerGas,
        uint64 priorityFeePerGas,
        bool includeData,
        bool active
    ) external returns (uint256 subscriptionId);

    function unsubscribe(uint256 subscriptionId) external;
}

/*
 *  The one function a reactive handler exposes. msg.sender is the precompile.
 *
 *  VERIFY — the external NAME below is a placeholder, not a transcribed
 *  signature. The docs show only the internal `_onEvent(address, bytes32[],
 *  bytes)` override on the SomniaEventHandler base; the external entrypoint the
 *  precompile actually calls is whatever `SomniaEventHandlerABI` in
 *  @somnia-chain/reactivity declares, which has not been read yet. The PARAMETER
 *  shape is documented and correct; the selector is not.
 *
 *  Resolution: install @somnia-chain/reactivity-contracts and inherit
 *  SomniaEventHandler directly rather than reimplementing it, so the selector
 *  can never drift. This interface exists only so the Foundry suite can mock the
 *  precompile (which does not exist on local chains at all).
 */
interface ISomniaEventHandler {
    function onSomniaEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata data) external;
}
