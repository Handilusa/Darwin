/**
 *  Admit a new organism to the Population via CLI.
 *
 *    npm run enter                                    # dry run with REVERSION genome
 *    npm run enter -- --broadcast                     # enter REVERSION on-chain
 *    npm run enter -- --genome PINNED --broadcast     # enter PINNED on-chain
 *    npm run enter -- --endowment 15 --cognition 12   # customize endowment / cognition
 *
 *  DRY BY DEFAULT: without `--broadcast` it reads, validates, simulates, and prints the quote.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  erc20Abi,
  explorerTx,
  fmt,
  log,
  manifest,
  parseEther,
  populationAbi,
  prophetAbi,
  publicClient,
  wallet,
  warn,
  type Hex,
  type Manifest,
} from "./lib/darwin.js";

type Args = {
  genomeName?: string;
  customGenome?: string;
  endowment?: number;
  cognition?: number;
  broadcast: boolean;
};

function parseArgs(argv: string[]): Args {
  let genomeName = "REVERSION";
  let customGenome: string | undefined;
  let endowment: number | undefined;
  let cognition = 12; // 12 STT = 50 windows of runway at 0.24 STT/w
  let broadcast = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--broadcast") {
      broadcast = true;
    } else if (a === "--genome") {
      const g = argv[++i];
      if (!g) throw new Error("--genome requires a genome name or prompt string");
      if (/^(MOMENTUM|REVERSION|BREAKOUT|PINNED|SKEPTIC|GAMBLER|PATIENT|SCALPER)$/i.test(g)) {
        genomeName = g.toUpperCase();
      } else {
        customGenome = g;
        genomeName = "CUSTOM";
      }
    } else if (a === "--endowment") {
      const v = argv[++i];
      if (!v) throw new Error("--endowment requires a number in tUSDC");
      endowment = Number(v);
    } else if (a === "--cognition") {
      const v = argv[++i];
      if (!v) throw new Error("--cognition requires a number in STT");
      cognition = Number(v);
    }
  }

  return { genomeName, customGenome, endowment, cognition, broadcast };
}

function resolveGenome(name: string, custom?: string): string {
  if (custom) return custom;
  const genesisPath = resolve(process.cwd(), "genomes", "genesis.json");
  const genesis = JSON.parse(readFileSync(genesisPath, "utf8"));
  const found = genesis.organisms.find((o: { name: string; genome: string }) => o.name.toUpperCase() === name.toUpperCase());
  if (!found) throw new Error(`Unknown founder genome: '${name}'. Check genomes/genesis.json.`);
  return found.genome;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { account, client } = wallet();
  const m = manifest();

  log(`enter organism as ${account.address}; population ${m.population}`);

  const genomeText = resolveGenome(args.genomeName ?? "REVERSION", args.customGenome);
  log(`selected genome: ${args.genomeName} (${genomeText.length} characters)`);

  const [minEndow, ante, cogEndow, living, maxPop] = await Promise.all([
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "minEndowment" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "ante" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "cognitionEndowment" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "livingCount" }),
    publicClient.readContract({
      address: m.population,
      abi: [{ type: "function", name: "maxPopulation", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" }],
      functionName: "maxPopulation",
    }),
  ]);

  const fourAntes = 4n * ante;
  const requiredCollateral = fourAntes > minEndow ? fourAntes : minEndow;
  const decimals = m.collateralDecimals;

  const targetCollateral = args.endowment !== undefined
    ? BigInt(Math.round(args.endowment * 10 ** decimals))
    : requiredCollateral;

  if (targetCollateral < minEndow) {
    throw new Error(`Endowment ${fmt(targetCollateral, decimals)} tUSDC is below minEndowment ${fmt(minEndow, decimals)} tUSDC`);
  }
  if (targetCollateral < fourAntes) {
    throw new Error(`Endowment ${fmt(targetCollateral, decimals)} tUSDC is below 4 * ante (${fmt(fourAntes, decimals)} tUSDC)`);
  }

  const cognitionWei = parseEther(String(args.cognition));
  if (cognitionWei < cogEndow) {
    throw new Error(`Cognition ${args.cognition} STT is below cognitionEndowment (${(Number(cogEndow) / 1e18).toFixed(4)} STT)`);
  }

  const [walletStt, walletCollateral, allowance] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({ address: m.collateral, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: m.collateral, abi: erc20Abi, functionName: "allowance", args: [account.address, m.population] }),
  ]);

  log("balances & requirements:");
  log(`  living / max:    ${living} / ${maxPop}`);
  log(`  wallet STT:      ${(Number(walletStt) / 1e18).toFixed(4)} STT (requires ${args.cognition} STT + gas)`);
  log(`  wallet tUSDC:    ${fmt(walletCollateral, decimals)} tUSDC (requires ${fmt(targetCollateral, decimals)} tUSDC)`);
  log(`  allowance:       ${fmt(allowance, decimals)} tUSDC`);

  if (living >= maxPop) {
    throw new Error(`Population is full (${living}/${maxPop}). Cannot enter until an organism dies or retires.`);
  }
  if (walletCollateral < targetCollateral) {
    throw new Error(`Insufficient tUSDC balance. Needs ${fmt(targetCollateral, decimals)}, holds ${fmt(walletCollateral, decimals)}. Use --faucet.`);
  }
  if (walletStt < cognitionWei + parseEther("0.1")) {
    throw new Error(`Insufficient STT balance for cognition and gas.`);
  }

  // Handle allowance
  if (allowance < targetCollateral) {
    const approveAmount = targetCollateral > 100_000_000n ? targetCollateral : 100_000_000n;
    if (!args.broadcast) {
      log(`\n  [dry-run] allowance (${fmt(allowance, decimals)}) < endowment (${fmt(targetCollateral, decimals)}). Would approve ${fmt(approveAmount, decimals)} tUSDC.`);
    } else {
      log(`\n  approving ${fmt(approveAmount, decimals)} tUSDC to Population...`);
      const hash = await client.writeContract({
        address: m.collateral,
        abi: erc20Abi,
        functionName: "approve",
        args: [m.population, approveAmount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Approve transaction reverted: ${hash}`);
      log(`  ok ${explorerTx(hash)}`);
    }
  }

  // Simulate enter
  if (allowance >= targetCollateral) {
    log("\n  simulating Population.enter()...");
    const sim = await publicClient.simulateContract({
      account,
      address: m.population,
      abi: populationAbi,
      functionName: "enter",
      args: [genomeText, targetCollateral],
      value: cognitionWei,
    });
    log(`  simulation successful! gas estimate: ${sim.request.gas ?? "default"}`);
  }

  if (!args.broadcast) {
    log("\n  dry run complete — nothing sent. Re-run with --broadcast to enter organism.");
    return;
  }

  log(`\n  broadcasting Population.enter as ${account.address}...`);
  const hash = await client.writeContract({
    address: m.population,
    abi: populationAbi,
    functionName: "enter",
    args: [genomeText, targetCollateral],
    value: cognitionWei,
  });
  log(`  tx submitted: ${hash}`);
  log(`  waiting for receipt...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`enter transaction reverted: ${hash}`);
  log(`  ok ${explorerTx(hash)}`);

  // Inspect logs for Spawned
  const spawnedLog = receipt.logs.find((l) => l.address.toLowerCase() === m.population.toLowerCase());
  log(`\n  New organism entered successfully!`);
  const newLiving = await publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "livingCount" });
  const totalProphets = await publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "prophetCount" });
  const newProphetAddr = await publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "prophetAt", args: [totalProphets] });

  const [treasury, cogBal, entrant] = await Promise.all([
    publicClient.readContract({ address: newProphetAddr, abi: prophetAbi, functionName: "treasury" }),
    publicClient.getBalance({ address: newProphetAddr }),
    publicClient.readContract({ address: newProphetAddr, abi: prophetAbi, functionName: "entrant" }),
  ]);

  log(`  Prophet #${totalProphets}:`);
  log(`    address:   ${newProphetAddr}`);
  log(`    entrant:   ${entrant}`);
  log(`    treasury:  ${fmt(treasury, decimals)} tUSDC`);
  log(`    cognition: ${(Number(cogBal) / 1e18).toFixed(4)} STT (~${Math.floor(Number(cogBal) / Number(parseEther("0.24")))}w runway)`);
  log(`    living:    ${newLiving}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
