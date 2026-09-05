// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {Population} from "../src/Population.sol";
import {Prophet} from "../src/Prophet.sol";
import {IERC20Like} from "../src/interfaces/IDreamDEX.sol";

/**
 *  Generation 0.
 *
 *  Run with:
 *    forge script script/Seed.s.sol --rpc-url somnia --broadcast -vvv
 *
 *  Reads `../genomes/genesis.json` and `./deployments/<chainid>.json`, so the founding
 *  population is data rather than a hardcoded array — the genomes get edited far more
 *  often than this script does, and editing Solidity to change a prompt is how you end
 *  up redeploying on demo day.
 *
 *  ONE-SHOT BY DEFAULT. `spawnGenesis` appends; it does not replace. Running this
 *  twice produces sixteen organisms, half of them duplicate strategies, and the
 *  duplicates would pair against each other and mint positions with no disagreement
 *  behind them. So a non-empty registry is a hard stop unless ALLOW_RESEED is set.
 */
contract Seed is Script {
    using stdJson for string;

    /// @dev Native runway, expressed in windows rather than ether, because the number
    ///      that matters is "how long can this think for". Four windows is one hour at
    ///      the 15-minute cadence — enough to prove the loop, not enough to leave
    ///      unattended overnight.
    uint256 internal constant MIN_WINDOWS_OF_RUNWAY = 4;

    error AlreadySeeded(uint256 existing);
    error NoGenomes();
    error GenomeNameMismatch(uint256 genomes, uint256 names);
    error TooManyGenomes(uint256 got, uint256 max);
    error InsufficientCollateral(uint256 have, uint256 need);

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");

        Population population = Population(payable(_population()));
        address collateral = population.collateral();

        (string[] memory names, string[] memory genomes) = _loadGenomes();
        uint256 n = genomes.length;

        _preflight(population, collateral, n);

        vm.startBroadcast(pk);
        population.spawnGenesis(genomes);
        vm.stopBroadcast();

        _report(population, names, n);
    }

    /*//////////////////////////////////////////////////////////////
                                 INPUTS
    //////////////////////////////////////////////////////////////*/

    function _population() internal view returns (address p) {
        p = vm.envOr("POPULATION", address(0));
        if (p != address(0)) return p;

        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        string memory json = vm.readFile(path);
        p = json.readAddress(".population");
    }

    function _loadGenomes() internal view returns (string[] memory names, string[] memory genomes) {
        string memory path = vm.envOr("GENOME_FILE", string("../genomes/genesis.json"));
        string memory json = vm.readFile(path);

        names = json.readStringArray(".organisms[*].name");
        genomes = json.readStringArray(".organisms[*].genome");

        if (genomes.length == 0) revert NoGenomes();
        if (names.length != genomes.length) revert GenomeNameMismatch(genomes.length, names.length);
    }

    /*//////////////////////////////////////////////////////////////
                               PREFLIGHT
    //////////////////////////////////////////////////////////////*/

    function _preflight(Population population, address collateral, uint256 n) internal view {
        uint256 existing = population.prophetCount();
        if (existing != 0 && !vm.envOr("ALLOW_RESEED", false)) revert AlreadySeeded(existing);

        uint256 max = population.maxPopulation();
        if (existing + n > max) revert TooManyGenomes(existing + n, max);

        // `_spawn` transfers `endowment` out of Population per organism and reverts
        // TransferFailed on a short balance — which is an opaque way to learn you are
        // 30 tUSDC short, so the number is computed and named here instead.
        uint256 need = population.endowment() * n;
        uint256 have = IERC20Like(collateral).balanceOf(address(population));
        if (have < need) revert InsufficientCollateral(have, need);

        // Native SOMI pays the inference deposits. Not fatal — Population is fundable
        // at any time and an unfunded think is caught per-organism rather than
        // reverting the window — but a population that cannot think is a population
        // that abstains, pays metabolism anyway, and dies of nothing.
        uint256 perWindow = population.requestDeposit() * n;
        uint256 runway = perWindow == 0 ? 0 : address(population).balance / perWindow;
        console.log("collateral in Population ", have);
        console.log("endowment needed         ", need);
        console.log("native per window (wei)  ", perWindow);
        console.log("windows of native runway ", runway);
        if (runway < MIN_WINDOWS_OF_RUNWAY) {
            console.log("WARNING: less than one hour of inference runway. Fund Population before starting.");
        }
    }

    /*//////////////////////////////////////////////////////////////
                                 OUTPUT
    //////////////////////////////////////////////////////////////*/

    /**
     *  Names are OFF-CHAIN on purpose.
     *
     *  `spawnGenesis` takes genomes only: the organism's identity is its genome, and a
     *  human label is presentation. But the frontend needs the labels, so the id →
     *  name → address → genomeHash map is written here. `genomeHash` is the join key
     *  that survives — it is `keccak256(systemPrompt)` on-chain, so a label can always
     *  be re-attached to the right organism even if this file is lost.
     */
    function _report(Population population, string[] memory names, uint256 n) internal {
        uint256 total = population.prophetCount();
        uint256 firstId = total - n + 1;

        string memory json = "{\n  \"organisms\": [\n";
        console.log("");
        console.log("=== generation 0 ============================================");

        for (uint256 i; i < n; ++i) {
            uint256 id = firstId + i;
            Prophet p = Prophet(payable(population.prophetAt(id)));

            console.log(string.concat("  #", vm.toString(id), " ", names[i], "  "), address(p));

            json = string.concat(
                json,
                "    {",
                '"id": ',
                vm.toString(id),
                ", ",
                '"name": "',
                names[i],
                '", ',
                '"address": "',
                vm.toString(address(p)),
                '", ',
                '"genomeHash": "',
                vm.toString(p.genomeHash()),
                '", ',
                '"generation": ',
                vm.toString(uint256(p.generation())),
                ", ",
                '"birthWindow": ',
                vm.toString(uint256(p.birthWindow())),
                i + 1 == n ? "}\n" : "},\n"
            );
        }

        json = string.concat(json, "  ]\n}\n");
        console.log("=============================================================");

        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".organisms.json");
        vm.writeFile(path, json);
        console.log("wrote", path);
        console.log("");
        console.log("The population exists but has not thought yet. Start the cadence:");
        console.log("  pushWindow -> think -> (await inference) -> commitAll -> settleAll");
    }
}
