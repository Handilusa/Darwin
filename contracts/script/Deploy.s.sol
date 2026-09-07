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
import {IAgentRequester} from "../src/interfaces/ISomnia.sol";

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

    /// @dev The founding population, for the budget arithmetic only. `Seed.s.sol` reads
    ///      the real count out of `genomes/genesis.json`, which is the source of truth;
    ///      this is what the number printed below is scaled by, so it is named rather
    ///      than inlined and the two are reconciled by hand if the roster changes.
    uint256 internal constant FOUNDERS = 8;

    /**
     *  A reactive subscription is refused while its OWNER holds less than this.
     *
     *  MEASURED, not read from the SDK. The reactivity package (somnia-chain/reactivity
     *  0.2.1) checks it client-side, which would make it a bypassable convenience;
     *  probing the precompile
     *  directly with a state-overridden balance shows the gate is on chain and it is
     *  exact — 31.9 STT reverts with empty data, 32 STT returns a subscription id, and
     *  varying `gasLimit` between 100k and 10M changes nothing at any balance.
     *
     *  IT IS A BALANCE GATE, NOT A SPEND. The 32 STT is not consumed; it has to be
     *  sitting in the signer's own wallet at the moment `--create` runs. Which is the
     *  whole reason it belongs in a deploy-time budget: an operator who spends the
     *  population's runway down to 20 STT has not overspent, they have made the central
     *  claim unprovable until they top the wallet back up.
     */
    uint256 internal constant REACTIVITY_OWNER_FLOOR = 32 ether;

    /*//////////////////////////////////////////////////////////////
                        BUDGET BASIS — see _budget()
    //////////////////////////////////////////////////////////////*/

    /// @dev Mirrors the `cognitionEndowment` default in `Population.initialize`. It is
    ///      duplicated here because the budget has to be printed BEFORE the proxy
    ///      exists — and duplication that can drift is worth nothing, so `_report`
    ///      re-reads the live value off the deployed proxy and shouts if the two
    ///      disagree. Do not change one of these without the other.
    uint256 internal constant COGNITION_ENDOWMENT_DEFAULT = 0.33 ether;

    /// @dev The other two `initialize` defaults `requestDeposit()` is built from, under
    ///      the same drift check.
    uint256 internal constant SUBCOMMITTEE_DEFAULT = 3;
    uint256 internal constant PER_AGENT_REWARD_DEFAULT = 0.001 ether;

    /**
     *  Gas. MEASURED ON SHANNON, not taken from `forge --gas-report`, and the gap
     *  between the two is a factor of twenty-three on the deploy. Read this before
     *  "correcting" any number here downwards.
     *
     *  Local revm prices a code deposit at the EVM-standard 200 gas/byte. Shannon does
     *  not. Measured two independent ways on 2026-09-06 against dream-rpc:
     *
     *    - `eth_call` with `to: null` and a descending `gas` cap, which finds what the
     *      NODE'S EXECUTOR actually charges: depositing 0 bytes needs ~454k, 1,000 bytes
     *      ~3.58M, 10,000 bytes ~31.7M. Marginal cost is a clean 3,125 gas/byte at both
     *      steps.
     *    - `eth_estimateGas` on the real initcode out of `out/`, which adds the
     *      estimator's own margin on top: 4,688 gas/byte, fitting
     *      `680,709 + 4,688*runtime + 269*initcode` to within 0.6% of the two creations
     *      big enough to measure directly (`Population` 168,860,071 and `Prophet`
     *      48,751,684).
     *    - THE REAL RECEIPTS, which settle it. The deploy landed on 2026-09-06 and
     *      metered 180,575,218 gas across eight transactions. Fitting the two largest
     *      creations against each other (`Population` 113,145,022 at 34,226 runtime
     *      bytes, `Prophet` 32,501,123 at 9,754) gives a marginal **3,295 gas/byte**
     *      over a ~358k fixed base. So the `eth_call` figure above was right to within
     *      5% and `eth_estimateGas` carries a flat **1.50x** margin on creations —
     *      exactly 1.50 on both, which is a fixed safety factor and not noise. Quote
     *      3,295 as the metered cost; quote 4,688 only as what the estimator returns.
     *
     *  THE MULTIPLIER IS THE PART THAT BITES, and it is not in these numbers.
     *  `forge script` never asks the chain what a creation costs — it estimates in local
     *  revm at 200 gas/byte and applies `-g` (default 130, i.e. 130%). Against Shannon's
     *  real 3,295 that default is short by **22.7x**, so the first attempt at this deploy
     *  mined seven transactions with `gasUsed == gasLimit` and status 0, burned 0.0966
     *  STT, and still wrote a manifest naming seven addresses that held no code. Both
     *  scripts must be run with **`-g 3000`**; `Seed.s.sol` included, because its eight
     *  `BeaconProxy` are created inside `spawnGenesis` and are underestimated the same
     *  way. The successful run confirmed the flag is free: every transaction returned
     *  between 1.98x and 6.92x of its limit unused, and unused gas is not billed. A
     *  gasLimit is a ceiling, not a charge — only a FAILURE burns the whole thing.
     *
     *  `DEPLOY_GAS` and `SEED_GAS` below are that fitted model summed over every
     *  creation each script performs — for the deploy: `Prophet`, `UpgradeableBeacon`,
     *  `PushedPriceSource`, `DreamDEXVenue`, the `Population` implementation,
     *  `ERC1967Proxy` with `initialize` inside it, `SelectionEngine`, then `setWiring`;
     *  for the seed: `GenesisTreasury` plus eight `BeaconProxy` and their initializers.
     *  Both are rounded UP. `forge script` will print a far smaller "Estimated total gas
     *  used for script" from its local simulation. That figure is wrong on this chain
     *  and being wrong in the cheap direction is what makes it dangerous.
     *
     *  THE PESSIMISTIC FIGURE IS DELIBERATE. Every one of these numbers feeds the
     *  windows-of-runway print below, and the two directions of error are not
     *  symmetric: overstating setup gives an operator more runway than promised, while
     *  understating it strands a population mid-season with no STT to think. Real
     *  receipts on Shannon do meter a plain transfer at exactly 21,000 (six samples),
     *  so standard pricing is what settles for calldata and simple compute. The deploy
     *  is now measured rather than modelled: **180,575,218 gas, 1.0835 STT at 6 gwei**,
     *  against the 1.65 `DEPLOY_GAS` claims. Overstated by 1.52x, in the safe
     *  direction, and left as it stands — the pessimism is the point, and `SEED_GAS`
     *  has still never been metered. Budget for the ceiling; enjoy the floor.
     *
     *  `WINDOW_GAS` is the one figure that cannot be measured this way — the contracts
     *  are not deployed yet, so there is nothing to estimate against. It is the local
     *  `--gas-report` sum for the whole cadence loop (`pushWindow` ~0.12M + `think`
     *  ~4.57M + `commitAll` ~0.93M + `settleAll` ~1.15M = 6.8M) scaled by
     *  `SHANNON_GAS_FACTOR`. Replaying fourteen real Shannon transactions through
     *  `eth_estimateGas` at their parent block gave estimate/actual ratios from 0.52 to
     *  10.92 with a median of 3.23 — an estimator that misses in BOTH directions, hence
     *  a factor chosen above that median rather than a claim of precision. The loop also
     *  scales with the living population, so 6.8M is a floor for eight organisms and not
     *  a ceiling for twenty-four.
     */
    uint256 internal constant SHANNON_GAS_FACTOR = 4;
    uint256 internal constant DEPLOY_GAS = 275_000_000;
    uint256 internal constant SEED_GAS = 65_000_000;
    uint256 internal constant WINDOW_GAS = 6_800_000 * SHANNON_GAS_FACTOR;

    /// @dev Shannon's base fee measured 6 gwei with an empty priority fee, and
    ///      `block.basefee` is used when the fork reports one. This is only the
    ///      fallback for an RPC that answers 0, which would otherwise print a budget
    ///      claiming gas is free.
    uint256 internal constant FALLBACK_GAS_PRICE = 6 gwei;

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

        _budget(d);
    }

    /**
     *  What the whole sequence costs in native STT, and what the signer's balance buys.
     *
     *  A WARNING, NEVER A REVERT. Every leg after this one is separately fundable, and
     *  an operator who deploys with a thin wallet and tops it up before seeding has done
     *  nothing wrong — so refusing here would block a legitimate order of operations to
     *  guard against a mistake this print already prevents. The one hard floor in the
     *  sequence is on chain, not here: `spawnGenesis` reverts
     *  `HouseCannotEndowFounders(got, want)` if Population's balance is under
     *  `FOUNDERS * cognitionEndowment`, atomically, before any founder exists.
     *
     *  IT IS PRINTED BEFORE THE DEPLOY RATHER THAN AFTER because after is too late to
     *  be useful: the numbers below decide whether to run the faucet first, and reading
     *  them under a broadcast that has already spent 0.14 STT is reading them for the
     *  next attempt. The deposit is read live off `AGENT_REQUESTER` so the per-window
     *  figure is the real one; every other input is a measured constant above, and the
     *  three `initialize` defaults are re-checked against the live proxy in `_report`.
     */
    function _budget(D memory d) internal view {
        uint256 gasPrice = tx.gasprice > 0 ? tx.gasprice : FALLBACK_GAS_PRICE;
        uint256 held = d.deployer.balance;

        uint256 house = FOUNDERS * COGNITION_ENDOWMENT_DEFAULT;
        uint256 deposit = _deposit(d.agentRequester);
        uint256 perWindow = FOUNDERS * deposit + WINDOW_GAS * gasPrice;
        uint256 setupGas = (DEPLOY_GAS + SEED_GAS) * gasPrice;

        // Everything that must be SPENT before the first window can run. The 32 STT
        // reactivity floor is deliberately not in this total — it is a balance the
        // signer must still hold afterwards, which is a different constraint and is
        // reported as one.
        uint256 setup = setupGas + house;

        console.log("");
        console.log("=== NATIVE STT BUDGET =======================================");
        console.log("gas price (wei)            ", gasPrice);
        console.log("deploy + seed gas (wei)    ", setupGas);
        console.log("  Shannon meters a code deposit at ~3295 gas/byte, NOT the standard");
        console.log("  200 - measured from the 2026-09-06 receipts, 180.6M gas for the");
        console.log("  deploy. This total is ~1.5x that, deliberately: SEED_GAS has never");
        console.log("  been metered and the safe error is upwards.");
        console.log("  RUN BOTH SCRIPTS WITH -g 3000. forge estimates creations in local");
        console.log("  revm at 200 gas/byte and its default -g 130 is 22.7x short, which");
        console.log("  mines status-0 transactions. Unused gas is refunded; a limit is a");
        console.log("  ceiling, not a charge.");
        console.log("house float, 8 founders    ", house);
        console.log("  = FOUNDERS * cognitionEndowment; spawnGenesis reverts under it");
        console.log("inference per window (wei) ", FOUNDERS * deposit);
        console.log("  = 8 * requestDeposit(), read live from AgentRequester");
        console.log("cadence gas per window     ", WINDOW_GAS * gasPrice);
        console.log("TOTAL per window (wei)     ", perWindow);
        console.log("setup, before window 1     ", setup);
        console.log("reactivity: signer must HOLD", REACTIVITY_OWNER_FLOOR);
        console.log("  a balance gate at --create, not a spend. Measured on chain.");
        console.log("signer holds (wei)         ", held);

        // THE NUMBER THIS WHOLE FUNCTION EXISTS TO PRINT. Windows, not wei: "how long
        // can this population think for" is the only budget question an operator
        // actually has, and it is the one that decides whether to walk away from the
        // machine. Reserving the reactivity floor rather than spending into it, because
        // a run that thinks for two extra hours and cannot prove reactivity has spent
        // its balance on the wrong thing.
        uint256 spendable = held > setup + REACTIVITY_OWNER_FLOOR ? held - setup - REACTIVITY_OWNER_FLOOR : 0;
        uint256 windows = perWindow == 0 ? 0 : spendable / perWindow;
        console.log("-------------------------------------------------------------");
        console.log("AFTER setup, holding 32 STT back, this buys WINDOWS:", windows);
        console.log("  at the 15-minute cadence that is HOURS:", windows / 4);
        console.log("=============================================================");

        if (held < setup) {
            console.log("WARNING: signer cannot cover deploy + seed + house float.");
            console.log("  Top up before seeding, or spawnGenesis reverts HouseCannotEndowFounders.");
            console.log("  npm run fund -- --faucet   funds tUSDC, not STT. STT comes from the");
            console.log("  Somnia testnet faucet at testnet.somnia.network.");
        } else if (held < setup + REACTIVITY_OWNER_FLOOR) {
            console.log("WARNING: setup fits, but the 32 STT reactivity floor does not.");
            console.log("  `npm run subscribe -- --create` will be refused, and without it the");
            console.log("  central claim is unproven. Fund the signer before spending on windows.");
        } else if (windows < 24) {
            console.log("WARNING: under one season (24 windows) of runway after setup.");
            console.log("  The population will abstain, pay metabolism, and die of nothing.");
        }
    }

    /**
     *  `requestDeposit()` before Population exists.
     *
     *  Recomputed from the two `initialize` defaults rather than read off the proxy for
     *  the obvious reason — there is no proxy yet — and the arithmetic is
     *  `Population.requestDeposit()` verbatim: the requester's floor for the
     *  subcommittee, plus the reward that sits on top so runners do not decline the
     *  request. Wrapped in a try/catch because a requester that does not answer is a
     *  finding, not a reason to abandon the deploy: the caller has an override for the
     *  address, and this function's only job is to make a number printable.
     */
    function _deposit(address requester) internal view returns (uint256) {
        try IAgentRequester(requester).getAdvancedRequestDeposit(SUBCOMMITTEE_DEFAULT) returns (uint256 floor_) {
            return floor_ + PER_AGENT_REWARD_DEFAULT * SUBCOMMITTEE_DEFAULT;
        } catch {
            console.log("WARNING: AGENT_REQUESTER did not answer getAdvancedRequestDeposit.");
            console.log("  Budget below assumes the measured 0.01 STT per committee member.");
            return (0.01 ether + PER_AGENT_REWARD_DEFAULT) * SUBCOMMITTEE_DEFAULT;
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
            new DreamDEXVenue(IPriceSource(d.priceSource), d.settlement, d.collateral, d.outcomeToken, d.symbol)
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

        _next(d);
        _writeManifest(d);
    }

    /**
     *  The printed runbook. It is ORDER-BEARING, and the order is not the obvious one.
     *
     *  Until 2026-09-06 this block said five things and three of them were wrong in ways
     *  an operator only discovers from a reverted transaction:
     *
     *    - It said "native SOMI". The native token on Shannon is STT. An operator who
     *      goes looking for SOMI on a testnet faucet finds nothing and assumes the
     *      instruction, not the token name, is what they misread.
     *    - It put `pushWindow` BEFORE the seed. `pushWindow` starts a 180-second
     *      staleness clock (`PushedPriceSource.maxStaleness`), and the seed is a
     *      multi-minute forge broadcast, so following the old order means the first
     *      `think()` reverts `StalePrice` on a window that expired during the seed. The
     *      cadence pushes and thinks back-to-back for exactly this reason; there is no
     *      reason for a human to push a window by hand at all.
     *    - It gave `--windows` no position, and it has only one: AFTER the seed.
     *      `--windows` walks `snapshot()` and sends one `topUpCognition` per LIVING
     *      organism, so before the seed there are none and it funds nothing while
     *      reporting success.
     *
     *  It also named the subscription as prose rather than a command, which is the one
     *  step here that is easy to get subtly and expensively wrong — see the topic0 note.
     *
     *  THE HOUSE FLOAT IS THE STEP WITH A HARD FLOOR, so it is stated as a number read
     *  off the live proxy rather than as advice. `spawnGenesis` is atomic on it.
     */
    function _next(D memory d) internal view {
        Population p = Population(payable(d.population));
        uint256 endow = p.cognitionEndowment();
        uint256 house = FOUNDERS * endow;
        uint256 collateral = FOUNDERS * p.endowment();

        // THE ONE CHECK THAT MAKES THE BUDGET ABOVE MORE THAN DECORATION. `_budget` ran
        // before the proxy existed and had to use a constant; this compares that
        // constant against what `initialize` actually set. If someone retunes
        // `Population.initialize` and not this file, the pre-deploy numbers are quietly
        // wrong and every figure an operator planned from is wrong with them.
        if (endow != COGNITION_ENDOWMENT_DEFAULT) {
            console.log("WARNING: cognitionEndowment on chain differs from this script's constant.");
            console.log("  The STT budget printed above used the constant and is WRONG. On chain:", endow);
        }

        console.log("");
        console.log("NEXT, IN ORDER. The order is load-bearing; see _next() for why.");
        console.log("");
        console.log(" 1. Collateral into Population - 8 founders * endowment (raw units):");
        console.log("      ", collateral);
        console.log("    npm run fund -- --faucet");
        console.log("    npm run fund -- --collateral 100");
        console.log("    Short here and Seed refuses with InsufficientCollateral(have, need).");
        console.log("");
        console.log(" 2. Native STT into Population - the BIRTH FLOAT, 8 * cognitionEndowment (wei):");
        console.log("      ", house);
        console.log("    npm run fund -- --house 4");
        console.log("    This is a HARD floor, not a target: spawnGenesis reverts");
        console.log("    HouseCannotEndowFounders(got, want) below it, atomically, so a short");
        console.log("    float costs a transaction and not a half-seeded population.");
        console.log("");
        console.log(" 3. Seed generation 0:");
        console.log("    forge script script/Seed.s.sol:Seed --rpc-url somnia --broadcast -vvv");
        console.log("    Seed calls deployGenesisTreasury() ITSELF, in the same broadcast, one");
        console.log("    line before spawnGenesis. Do NOT call it by hand first: it is onlyOwner,");
        console.log("    once-ever, has no setter, and a second call reverts TreasuryAlreadySet,");
        console.log("    which then makes the whole seed unrunnable. NoGenesisTreasury is only");
        console.log("    reachable by calling spawnGenesis outside this script.");
        console.log("");
        console.log(" 4. Subscribe the engine to BinarySettlement (precompile 0x0100):");
        console.log("    npm run subscribe -- --discover");
        console.log("    npm run subscribe -- --create --topic0 \\");
        console.log("      0xb1884334e955f8d8727678d4fa52dd9fc7140ff5e4ad38d358453bd400ada178");
        console.log("    PASS --topic0 EXPLICITLY. It is MarketFinalized, and it is the value");
        console.log("    `subscribe.ts` derives anyway - passing it makes the run self-documenting");
        console.log("    and immune to a stale event signature in the SDK. Do not take a topic0");
        console.log("    from --discover's frequency ranking: redeem events vastly outnumber");
        console.log("    finalizations, so the most common topic0 in a lookback window is the");
        console.log("    redeem, and subscribing to that is circular - our own redemption is");
        console.log("    downstream of the settlement we are waiting for, so it never fires first.");
        console.log("    The signer must HOLD 32 STT at this moment. Measured on chain, exact,");
        console.log("    and a gate on balance rather than a spend. IT COMES BEFORE STEP 5 for");
        console.log("    exactly that reason: step 5 spends the balance this step gates on, so");
        console.log("    subscribing after prepaying cognition can leave it unsatisfiable with");
        console.log("    the STT already locked inside the organisms.");
        console.log("");
        console.log(" 5. Fund the organisms' thinking. ONLY WORKS AFTER STEP 3 - it sends one");
        console.log("    topUpCognition per LIVING organism, and before the seed there are none.");
        console.log("    THE NUMBER IS NOT 400 UNLESS YOU CAN AFFORD 400. Windows this signer's");
        console.log("    CURRENT balance covers, after holding the 32 STT back:");
        console.log("      ", _affordableWindows(d));
        console.log("    npm run fund -- --windows <that number, or less>");
        console.log("    Each window costs 8 * requestDeposit() prepaid into the organisms PLUS");
        console.log("    cadence gas the signer keeps paying, and --windows only funds the first");
        console.log("    of those two. Overfunding is not a rounding error: the STT is inside the");
        console.log("    organisms, and only `retire` gets it back.");
        console.log("");
        console.log(" 6. Start the cadence. It pushes the window and thinks in the same pass,");
        console.log("    which is why nothing above pushes one by hand - maxStaleness is 180s:");
        console.log("    npm run cadence");
        console.log("    It must not stop until submission.");
        console.log("");
    }

    /**
     *  How many windows the signer's CURRENT balance actually covers.
     *
     *  Deliberately recomputed here rather than passed down from `_budget`: by the time
     *  this prints, the deploy has spent real gas, so `_budget`'s figure is stale by
     *  exactly the amount that matters most at the moment someone is about to hand STT
     *  to eight organisms they cannot get it back out of.
     *
     *  BOTH LEGS OF A WINDOW ARE COUNTED, which is the whole point. `--windows N`
     *  prepays only the inference deposits; the signer still pays cadence gas out of
     *  what is left, every window, forever. Sizing `--windows` against the inference
     *  cost alone funds organisms that outlive the keeper's ability to call them, which
     *  looks identical to a bug and is not one.
     */
    function _affordableWindows(D memory d) internal view returns (uint256) {
        uint256 gasPrice = tx.gasprice > 0 ? tx.gasprice : FALLBACK_GAS_PRICE;
        uint256 perWindow = FOUNDERS * _deposit(d.agentRequester) + WINDOW_GAS * gasPrice;
        if (perWindow == 0) return 0;
        uint256 held = d.deployer.balance;
        uint256 reserve = REACTIVITY_OWNER_FLOOR;
        return held > reserve ? (held - reserve) / perWindow : 0;
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
