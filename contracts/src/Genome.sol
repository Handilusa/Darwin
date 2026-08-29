// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev What the organism decided to do about the next window.
enum Belief {
    None, // no inference has landed yet
    Up, // committed: YES
    Down, // committed: NO
    Abstain // failed to form a coherent belief; acts on nothing, still pays
}

/**
 *  WHY the organism believed it — the reasoning, as a machine-readable tag.
 *
 *  This exists to resolve a real tension. `allowedValues` constrains the model to
 *  an enum, and that constraint is the only reason a language model's output is
 *  safe to act on inside a contract at all. But a constrained answer is the single
 *  token "UP", which would make "readable on-chain machine reasoning" a lie.
 *
 *  So the enum carries the thesis as well as the direction. One inference call,
 *  still fully constrained, and the population's *strategies* become observable:
 *  if momentum organisms die out while reversion organisms survive, that is
 *  natural selection over ideas, visible directly from event logs. Nothing else in
 *  the design gives that away this cheaply.
 */
enum Thesis {
    Unknown,
    Momentum, // the move continues
    Reversion, // the move exhausts and snaps back
    Breakout, // range resolves in the direction of pressure
    Range // price stays pinned near the open
}

/**
 *  Genome construction and prompt assembly.
 *
 *  A genome IS an English system prompt. That is the whole trick: the heritable
 *  material is human-readable, so a spectator can read an organism's mind, and
 *  mutation is a language operation an LLM can perform on-chain.
 *
 *  Deliberately dependency-free so prompt assembly is unit-testable before any
 *  proxy or SDK plumbing exists.
 */
library Genome {
    /// @dev Handed to `inferString` as `allowedValues`. The model cannot answer
    ///      outside this set, so `_parseAnswer` has no unconstrained input to fear.
    ///      Nine entries: four theses × two directions, plus the escape hatch.
    function allowedBeliefs() internal pure returns (string[] memory v) {
        v = new string[](9);
        v[0] = "UP_MOMENTUM";
        v[1] = "UP_REVERSION";
        v[2] = "UP_BREAKOUT";
        v[3] = "UP_RANGE";
        v[4] = "DOWN_MOMENTUM";
        v[5] = "DOWN_REVERSION";
        v[6] = "DOWN_BREAKOUT";
        v[7] = "DOWN_RANGE";
        v[8] = "ABSTAIN";
    }

    /**
     *  The market context handed to the organism as the user prompt.
     *
     *  `openPrice` is load-bearing and the easiest thing in this integration to
     *  get wrong: a DreamDEX event contract resolves against the WINDOW'S OPENING
     *  PRICE, not the price at the moment of commitment. An organism told only the
     *  current price would be answering a different question than the one it is
     *  about to be graded on.
     */
    function beliefPrompt(
        string memory symbol,
        uint256 openPrice,
        uint256 lastPrice,
        uint8 priceDecimals,
        uint64 secondsRemaining
    ) internal pure returns (string memory) {
        // STAGED DELIBERATELY, and the staging is load-bearing rather than stylistic.
        // A single `string.concat` of all eleven operands forces the three inlined
        // number formatters — `_decimal` twice and `_toString` once, each with its own
        // locals and digit loops — to be live simultaneously alongside eleven concat
        // operands and the allocator's memory pointer. That overflows the stack even
        // under --via-ir, whose stack-limit evader misses by one slot. Formatting
        // first and concatenating in three steps keeps every step small.
        //
        // The assembled string is byte-for-byte what the single expression produced.
        // Do not collapse this back into one `string.concat`.
        string memory open_ = _decimal(openPrice, priceDecimals);
        string memory last_ = _decimal(lastPrice, priceDecimals);
        string memory secs = _toString(secondsRemaining);

        string memory head = string.concat(
            "MARKET: ",
            symbol,
            " binary event contract.\n"
            "QUESTION: at this window's close, will ",
            symbol,
            " be ABOVE (UP) or BELOW (DOWN) the window's OPENING price?\n"
        );

        string memory body = string.concat(
            "OPENING PRICE (the level you are graded against): ",
            open_,
            "\n"
            "CURRENT PRICE: ",
            last_,
            "\n"
            "SECONDS UNTIL CLOSE: ",
            secs,
            "\n\n"
        );

        return string.concat(
            head,
            body,
            "Answer with exactly one allowed value: a direction and the thesis that\n"
            "justifies it. Choose ABSTAIN only if you genuinely have no edge - you\n"
            "are charged for thinking either way, so habitual abstention starves you."
        );
    }

    /**
     *  The mutation prompt: an organism's genome rewritten by a language model.
     *
     *  The parent's own track record is included so mutation is informed rather
     *  than random — this is closer to Lamarckian than Darwinian evolution, and
     *  that is the honest description to use. Real fitness data conditions the
     *  variation, which converges far faster than blind mutation over the ~1,000
     *  windows available.
     */
    function mutationPrompt(
        string memory parentGenome,
        uint32 correct,
        uint32 wrong,
        uint32 abstained,
        uint32 generation
    ) internal pure returns (string memory) {
        return string.concat(
            "You are mutating the heritable strategy text of a forecasting organism\n"
            "that survives only while it predicts short-horizon crypto price windows\n"
            "better than it pays to think.\n\n"
            "PARENT GENOME:\n---\n",
            parentGenome,
            "\n---\n\n"
            "PARENT RECORD: ",
            _toString(correct),
            " correct, ",
            _toString(wrong),
            " wrong, ",
            _toString(abstained),
            " abstained, generation ",
            _toString(generation),
            ".\n\n"
            "Write the CHILD genome. Keep what the record suggests was working and\n"
            "change exactly one thing that plausibly explains the losses. This is a\n"
            "mutation, not a rewrite: the child must be recognisably descended from\n"
            "the parent. Under 700 characters. Output only the genome text - no\n"
            "preamble, no explanation, no quotes."
        );
    }

    /// @dev The system prompt for the mutation call itself. The mutating model is
    ///      not the organism; it is the mechanism of heredity.
    function mutationSystem() internal pure returns (string memory) {
        return "You perform small, purposeful mutations on strategy text. You never"
        " editorialise and you never output anything except the mutated text.";
    }

    /**
     *  Decode a constrained answer into a direction and a thesis.
     *
     *  Anything unrecognised returns (Abstain, Unknown). An unexpected string can
     *  only mean the `allowedValues` constraint did not hold, and the safe reading
     *  of a broken constraint is that no belief was formed — never a coin flip,
     *  which would put real collateral behind a parsing failure.
     */
    function parseAnswer(string memory answer) internal pure returns (Belief, Thesis) {
        bytes32 h = keccak256(bytes(answer));
        if (h == keccak256("UP_MOMENTUM")) return (Belief.Up, Thesis.Momentum);
        if (h == keccak256("UP_REVERSION")) return (Belief.Up, Thesis.Reversion);
        if (h == keccak256("UP_BREAKOUT")) return (Belief.Up, Thesis.Breakout);
        if (h == keccak256("UP_RANGE")) return (Belief.Up, Thesis.Range);
        if (h == keccak256("DOWN_MOMENTUM")) return (Belief.Down, Thesis.Momentum);
        if (h == keccak256("DOWN_REVERSION")) return (Belief.Down, Thesis.Reversion);
        if (h == keccak256("DOWN_BREAKOUT")) return (Belief.Down, Thesis.Breakout);
        if (h == keccak256("DOWN_RANGE")) return (Belief.Down, Thesis.Range);
        return (Belief.Abstain, Thesis.Unknown);
    }

    /*//////////////////////////////////////////////////////////////
                          FORMATTING (no OZ dep)
    //////////////////////////////////////////////////////////////*/

    function _toString(uint256 n) internal pure returns (string memory) {
        if (n == 0) return "0";
        uint256 digits;
        for (uint256 t = n; t != 0; t /= 10) digits++;
        bytes memory buf = new bytes(digits);
        while (n != 0) {
            buf[--digits] = bytes1(uint8(48 + (n % 10)));
            n /= 10;
        }
        return string(buf);
    }

    /// @dev Fixed-point integer to a human decimal string. A price handed to a
    ///      model as raw 8-decimal integer units ("11043200000000") reads as a
    ///      different order of magnitude than the number it represents, which is a
    ///      cheap way to make an otherwise capable model answer nonsense.
    function _decimal(uint256 value, uint8 decimals) internal pure returns (string memory) {
        if (decimals == 0) return _toString(value);
        uint256 unit = 10 ** decimals;
        string memory whole = _toString(value / unit);
        uint256 frac = value % unit;
        if (frac == 0) return whole;

        bytes memory fb = new bytes(decimals);
        for (uint256 i = decimals; i > 0; --i) {
            fb[i - 1] = bytes1(uint8(48 + (frac % 10)));
            frac /= 10;
        }
        // Trim trailing zeros so "2.50000000" reads as "2.5".
        uint256 end = decimals;
        while (end > 1 && fb[end - 1] == "0") end--;
        bytes memory trimmed = new bytes(end);
        for (uint256 i; i < end; ++i) {
            trimmed[i] = fb[i];
        }
        return string.concat(whole, ".", string(trimmed));
    }
}
