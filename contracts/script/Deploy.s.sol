// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {Population} from "../src/Population.sol";
import {Prophet} from "../src/Prophet.sol";
import {PushedPriceSource} from "../src/PushedPriceSource.sol";
import {SelectionEngine} from "../src/SelectionEngine.sol";
import {DreamDEXVenue} from "../src/venues/DreamDEXVenue.sol";
import {IPriceSource} from "../src/interfaces/IPriceSource.sol";
import {IBinaryMarketsModule, IERC20Like} from "../src/interfaces/IDreamDEX.sol";

/**
 *  Day-2 go-live deploy.
 *
 *  Run with:
 *    forge script script/Deploy.s.sol --rpc-url somnia --broadcast -vvv
 *
 *  Required env: PRIVATE_KEY, LLM_AGENT_ID.
 *  Optional env: OWNER, UPDATER, ENGINE_OWNER, MARKET_SYMBOL, ALLOW_ANY_CHAIN,
 *                ALLOW_PLACEHOLDER_AGENT, ALLOW_ANY_DECIMALS, and an override for
 *                every external address.
 *
 *  WHAT THIS DEPLOY FREEZES. From the moment it lands, `STORAGE.md` is binding.
 *  Prophet sits behind a beacon and Population behind a UUPS proxy so logic can be
 *  repaired for the remaining nine days WITHOUT resetting lineage — the ancestry graph
 *  is the only asset here that cannot be rebuilt in a hurry. Reconcile `STORAGE.md`
 *  against `forge inspect Prophet storage-layout` before running this.
 *
 *  ORDERING IS NOT COSMETIC. Population is initialized with the DEPLOYER as owner so
 *  the deployer can finish wiring, and ownership is handed to `OWNER` in the last
 *  transaction of the same broadcast. Initializing straight to a cold `OWNER` would
 *  leave `setWiring` uncallable and the selection engine unregistered.
 *
 *  Everything is carried in one struct rather than in locals and long parameter lists,
 *  because a deploy script that fails to compile with "stack too deep" on the morning
 *  of the go-live is a self-inflicted lost day.
 */
contract Deploy is Script {
    /*//////////////////////////////////////////////////////////////
                       SHANNON TESTNET — chain 50312
    //////////////////////////////////////////////////////////////*/

    uint256 internal constant SHANNON = 50312;

    // Verified against the DreamDEX and Somnia docs. Every one is overridable by env so
    // a redeploy against a moved testnet contract needs no code change.
    address internal constant AGENT_REQUESTER = 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
    address internal constant BINARY_MARKETS_MODULE = 0x3ecC694Cef705358864a646142ac17A90E29e388;
    address internal constant BINARY_SETTLEMENT = 0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23;
    address internal constant OUTCOME_TOKEN_6909 = 0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9;
    address internal constant TUSDC = 0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E;

    /// @dev Shannon tUSDC is 6dp; mainnet USDso is 18dp. The economic defaults in
    ///      `Population.initialize` are written in 6dp units, so deploying against an
    ///      18dp collateral without recalibrating would endow each organism with a
    ///      millionth of a cent and starve the population in its first window.
    uint8 internal constant EXPECTED_DECIMALS = 6;

    error WrongChain(uint256 got, uint256 want);
    error PlaceholderAgentId();
    error UnexpectedDecimals(uint8 got, uint8 want);

    struct D {
        // inputs
        address deployer;
        address owner;
        address updater;
        address engineOwner;
        address agentRequester;
        address marketsModule;
        address settlement;
        address outcomeToken;
        address collateral;
        uint256 llmAgentId;
        string symbol;
        // outputs
        address prophetImpl;
        address prophetBeacon;
        address populationImpl;
        address population;
        address priceSource;
        address venue;
        address selectionEngine;
        uint8 collateralDecimals;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        D memory d = _inputs(vm.addr(pk));
        _preflight(d);
        _deploy(pk, d);
        _report(d);
    }

    /*//////////////////////////////////////////////////////////////
                                 INPUTS
    //////////////////////////////////////////////////////////////*/

    function _inputs(address deployer) internal view returns (D memory d) {
        d.deployer = deployer;

        // The owner is ALSO the cadence driver: `Population.onlyDriver` accepts the
        // owner, the selection engine, or the reactivity precompile, and the cadence
        // calls `think()`/`commitAll()` directly. A cold owner therefore silently
        // disables the population. Default to the deployer and shout if they diverge.
        d.owner = vm.envOr("OWNER", deployer);
        d.updater = vm.envOr("UPDATER", deployer);

        // `poke()` stands in for the precompile until the real callback selector is
        // verified, so it is a cadence call, not an administrative one — it belongs to
        // the hot key.
        d.engineOwner = vm.envOr("ENGINE_OWNER", d.updater);

        d.agentRequester = vm.envOr("AGENT_REQUESTER", AGENT_REQUESTER);
        d.marketsModule = vm.envOr("BINARY_MARKETS_MODULE", BINARY_MARKETS_MODULE);
        d.settlement = vm.envOr("BINARY_SETTLEMENT", BINARY_SETTLEMENT);
        d.outcomeToken = vm.envOr("OUTCOME_TOKEN", OUTCOME_TOKEN_6909);
        d.collateral = vm.envOr("COLLATERAL", TUSDC);

        d.llmAgentId = vm.envOr("LLM_AGENT_ID", uint256(0));
        d.symbol = vm.envOr("MARKET_SYMBOL", string("BTC"));

        d.collateralDecimals = IERC20Like(d.collateral).decimals();
    }

    function _preflight(D memory d) internal view {
        if (block.chainid != SHANNON && !vm.envOr("ALLOW_ANY_CHAIN", false)) {
            revert WrongChain(block.chainid, SHANNON);
        }

        // A population deployed with a placeholder agent id cannot think: every
        // `createAdvancedRequest` fails, every organism abstains, every organism still
        // pays metabolism, and the run dies quietly of nothing at all.
        //
        // The id was measured from Shannon on 2026-08-29 and is:
        //   LLM_AGENT_ID=12847293847561029384
        // If it ever needs re-deriving, the testnet roster is at
        // agents.testnet.somnia.network (NOT agents.somnia.network — that is mainnet),
        // and the chain-side method is recorded in docs/SESSION_CHECKPOINT.md §2.4.
        if (d.llmAgentId == 0 && !vm.envOr("ALLOW_PLACEHOLDER_AGENT", false)) revert PlaceholderAgentId();

        if (d.collateralDecimals != EXPECTED_DECIMALS && !vm.envOr("ALLOW_ANY_DECIMALS", false)) {
            revert UnexpectedDecimals(d.collateralDecimals, EXPECTED_DECIMALS);
        }

        if (d.owner != d.updater) {
            console.log("WARNING: OWNER != UPDATER.");
            console.log("  Population.think()/commitAll() are owner-gated. If OWNER is not the");
            console.log("  key the cadence signs with, the population will not run.");
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 DEPLOY
    //////////////////////////////////////////////////////////////*/

    function _deploy(uint256 pk, D memory d) internal {
        vm.startBroadcast(pk);

        // 1. Organism logic, and the beacon that lets it be repaired mid-run.
        d.prophetImpl = address(new Prophet());
        d.prophetBeacon = address(new UpgradeableBeacon(d.prophetImpl, d.owner));

        // 2. Price source. Deployed before Population so it goes straight into the
        //    initializer. Non-upgradeable by design and freely re-pointable later.
        d.priceSource = address(new PushedPriceSource(IBinaryMarketsModule(d.marketsModule), d.owner, d.updater));

        // 3. Venue — where positions live and how a resolved position becomes
        //    collateral. Also before Population, and also freely replaceable: it holds
        //    nothing between transactions, so `setWiring` can repoint the population at
        //    a different adjudication mechanism without touching an organism.
        //
        //    "Freely" is wrong in one specific way, and this is the comment an operator
        //    reads before doing it. `setWiring` has NO PHASE GUARD. Repoint only in
        //    phase 0, with no position open: the two adapters fail in opposite
        //    directions on a position the new venue never issued — DreamDEXVenue reverts
        //    UnknownPosition (loud, recoverable), DirectDuelVenue returns 0 (silent, and
        //    it grades both duellists as total losses while the escrow goes unreachable
        //    short of a beacon upgrade). See STORAGE.md, "Contracts with no storage
        //    constraint". Repointing to a fresh instance of the SAME adapter between
        //    windows is the only version the test suite covers
        //    (test_venue_canBeRepointedBetweenWindows).
        d.venue = address(
            new DreamDEXVenue(
                IPriceSource(d.priceSource), d.settlement, d.collateral, d.outcomeToken, d.symbol
            )
        );

        // 4. Population, behind UUPS. Owner is the deployer for now — see the header.
        d.populationImpl = address(new Population());
        d.population = address(
            new ERC1967Proxy(d.populationImpl, abi.encodeCall(Population.initialize, (d.deployer, _wiring(d))))
        );

        // 5. The reactive adapter, and the one contract that knows the unverified
        //    callback selector.
        d.selectionEngine = address(new SelectionEngine(Population(payable(d.population)), d.settlement, d.engineOwner));

        // 6. Register the engine as a driver, then hand over. The venue went in through
        //    the initializer, so the fourth argument is a deliberate no-op here.
        Population(payable(d.population)).setWiring(address(0), d.selectionEngine, address(0), address(0));
        if (d.owner != d.deployer) Population(payable(d.population)).transferOwnership(d.owner);

        vm.stopBroadcast();
    }

    function _wiring(D memory d) internal pure returns (Population.Wiring memory) {
        return Population.Wiring({
            agentRequester: d.agentRequester,
            settlement: d.settlement,
            marketsModule: d.marketsModule,
            outcomeToken: d.outcomeToken,
            collateral: d.collateral,
            prophetBeacon: d.prophetBeacon,
            priceSource: d.priceSource,
            venue: d.venue,
            llmAgentId: d.llmAgentId,
            symbol: d.symbol
        });
    }

    /*//////////////////////////////////////////////////////////////
                                 OUTPUT
    //////////////////////////////////////////////////////////////*/

    function _report(D memory d) internal {
        console.log("");
        console.log("=== DARWIN deployed =========================================");
        console.log("chainId          ", block.chainid);
        console.log("population       ", d.population);
        console.log("populationImpl   ", d.populationImpl);
        console.log("prophetBeacon    ", d.prophetBeacon);
        console.log("prophetImpl      ", d.prophetImpl);
        console.log("priceSource      ", d.priceSource);
        console.log("venue            ", d.venue);
        console.log("selectionEngine  ", d.selectionEngine);
        console.log("owner            ", d.owner);
        console.log("updater          ", d.updater);
        console.log("=============================================================");
        console.log("");
        console.log("NEXT, IN ORDER:");
        console.log(" 1. Fund Population with collateral and native SOMI.");
        console.log(" 2. Push the first window:  priceSource.pushWindow(...)");
        console.log(" 3. Seed generation 0:      forge script script/Seed.s.sol --broadcast");
        console.log(" 4. Subscribe the engine to BinarySettlement via precompile 0x0100.");
        console.log(" 5. Start the cadence. It must not stop until submission.");

        _writeManifest(d);
    }

    /**
     *  Written as a flat JSON object, built in small chunks.
     *
     *  Not `serializeJson`: every later script, the monitor and the frontend read this
     *  file, and a hand-built string has no dependency on cheatcode key ordering. Not
     *  one big `string.concat` either — a forty-argument concat is exactly how a script
     *  stops compiling.
     *
     *  A DRY RUN MUST NOT WRITE THIS FILE. Without `--broadcast`, forge still executes
     *  the whole script, so the addresses here are simulated and will not exist on chain.
     *  Every downstream script, `monitor.ts` and the frontend read this manifest as the
     *  source of truth, so writing it on a dry run would point the entire operational
     *  surface at contracts that were never deployed — and it looks exactly like a
     *  successful deploy. Dry-running the deploy is the cheapest possible check that it
     *  works, so it must be safe to do repeatedly.
     */
    function _writeManifest(D memory d) internal {
        if (vm.isContext(VmSafe.ForgeContext.ScriptDryRun)) {
            console.log("");
            console.log("DRY RUN - manifest NOT written. Addresses above are simulated.");
            console.log("Re-run with --broadcast to deploy and write deployments/<chainid>.json.");
            return;
        }

        string memory j = "{\n";
        j = string.concat(j, '  "chainId": ', vm.toString(block.chainid), ",\n");
        j = string.concat(j, '  "deployedAtBlock": ', vm.toString(block.number), ",\n");
        j = string.concat(j, '  "deployedAtTimestamp": ', vm.toString(block.timestamp), ",\n");
        j = string.concat(j, '  "deployer": "', vm.toString(d.deployer), '",\n');
        j = string.concat(j, '  "owner": "', vm.toString(d.owner), '",\n');
        j = string.concat(j, '  "updater": "', vm.toString(d.updater), '",\n');
        j = string.concat(j, '  "population": "', vm.toString(d.population), '",\n');
        j = string.concat(j, '  "populationImpl": "', vm.toString(d.populationImpl), '",\n');
        j = string.concat(j, '  "prophetBeacon": "', vm.toString(d.prophetBeacon), '",\n');
        j = string.concat(j, '  "prophetImpl": "', vm.toString(d.prophetImpl), '",\n');
        j = string.concat(j, '  "priceSource": "', vm.toString(d.priceSource), '",\n');
        j = string.concat(j, '  "venue": "', vm.toString(d.venue), '",\n');
        j = string.concat(j, '  "selectionEngine": "', vm.toString(d.selectionEngine), '",\n');
        j = string.concat(j, '  "agentRequester": "', vm.toString(d.agentRequester), '",\n');
        j = string.concat(j, '  "marketsModule": "', vm.toString(d.marketsModule), '",\n');
        j = string.concat(j, '  "settlement": "', vm.toString(d.settlement), '",\n');
        j = string.concat(j, '  "outcomeToken": "', vm.toString(d.outcomeToken), '",\n');
        j = string.concat(j, '  "collateral": "', vm.toString(d.collateral), '",\n');
        j = string.concat(j, '  "collateralDecimals": ', vm.toString(uint256(d.collateralDecimals)), ",\n");
        j = string.concat(j, '  "llmAgentId": ', vm.toString(d.llmAgentId), ",\n");
        j = string.concat(j, '  "symbol": "', d.symbol, '"\n');
        j = string.concat(j, "}\n");

        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeFile(path, j);
        console.log("wrote", path);
    }
}
