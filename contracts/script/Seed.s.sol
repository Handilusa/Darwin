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
        // `spawnGenesis` reverts `NoGenesisTreasury` until the founders have an owner.
        // `onlyOwner`, one-shot, and there is no setter: a second call reverts
        // `TreasuryAlreadySet`.
        population.deployGenesisTreasury();
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

    /// @dev El orden de los campos es ALFABÉTICO y eso es funcional, no
    ///      cosmético: forge-std mapea las claves del JSON sobre los campos
    ///      del struct por nombre de clave ORDENADO, no por posición. Si
    ///      intercambias estos dos campos, cada organismo se siembra con su
    ///      nombre en la ranura del genoma y su genoma en la del nombre.
    ///      Compila, corre, y corrompe los ocho fundadores en silencio.
    ///      (Verificado: genesis.json lista "name" ANTES de "genome", así que
    ///      un mapeo posicional acertaría — no lo es.)
    struct Organism {
        string genome;
        string name;
    }

    function _loadGenomes() internal view returns (string[] memory names, string[] memory genomes) {
        string memory path = vm.envOr("GENOME_FILE", string("../genomes/genesis.json"));
        string memory json = vm.readFile(path);

        Organism[] memory parsed = abi.decode(json.parseRaw(".organisms"), (Organism[]));
        names = new string[](parsed.length);
        genomes = new string[](parsed.length);
        for (uint256 i = 0; i < parsed.length; i++) {
            names[i] = parsed[i].name;
            genomes[i] = parsed[i].genome;
        }

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

        // THE HOUSE FLOAT, WHICH IS THE ONE NATIVE NUMBER THAT CAN STOP THIS SCRIPT.
        // `spawnGenesis` is payable and checks `address(this).balance` against
        // `genomes.length * cognitionEndowment` ONCE, up front, reverting
        // `HouseCannotEndowFounders(got, want)` — atomically, before any proxy is
        // deployed. So a short float costs a broadcast and not a half-seeded population,
        // and it is worth naming the shortfall here rather than reading it out of a
        // revert.
        //
        // IT IS NOT A WARNING ABOUT RUNWAY, and this block used to print one — windows of
        // native runway computed from Population's balance over `requestDeposit()`. That
        // number was meaningless: each `Prophet` pays its own inference out of its OWN
        // balance, Population's native is the birth float alone, and the founders' runway
        // is necessarily zero here because they do not exist yet. It is bought AFTER this
        // script with `npm run fund -- --windows N`, which walks the living. The old print
        // also said SOMI; the native token on Shannon is STT.
        uint256 float_ = address(population).balance;
        uint256 cognition = population.cognitionEndowment() * n;
        uint256 perWindow = population.requestDeposit() * n;
        console.log("collateral in Population ", have);
        console.log("endowment needed         ", need);
        console.log("house float (wei)        ", float_);
        console.log("founders' cognition (wei)", cognition);
        console.log("  spawnGenesis reverts HouseCannotEndowFounders below this");
        console.log("cost to think, per window", perWindow);
        console.log("  paid by the ORGANISMS, not by Population. Fund them after seeding:");
        console.log("  npm run fund -- --windows 400");
        if (float_ < cognition) {
            console.log("WARNING: house float is short. The next transaction WILL revert");
            console.log("  HouseCannotEndowFounders. Send the difference first (wei):", cognition - float_);
            console.log("  npm run fund -- --house 4");
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
