/**
 *  Life support: collateral for the organisms, native SOMI for their cognition.
 *
 *    npm run fund -- --faucet                  # pull tUSDC from the testnet faucet
 *    npm run fund -- --collateral 100          # 100 tUSDC into Population
 *    npm run fund -- --native 5                # 5 SOMI into Population (inference)
 *    npm run fund -- --windows 200             # native for ~200 windows, computed
 *    npm run fund -- --prophet 3 --amount 5    # 5 tUSDC into organism #3
 *    npm run fund                              # report only, no transactions
 *
 *  TWO CURRENCIES, TWO FAILURE MODES, AND THEY LOOK NOTHING ALIKE. Native SOMI pays for
 *  inference: run out and organisms stop thinking, abstain, pay metabolism anyway, and
 *  die of nothing. Collateral is what they stake and what they eat: run out at Population
 *  level and new births revert. The first is silent and fatal to the run; check the
 *  runway number below before walking away from the machine.
 */
import {
  erc20Abi,
  faucetAbi,
  fmt,
  log,
  manifest,
  populationAbi,
  publicClient,
  wallet,
  warn,
  explorerTx,
  type Manifest,
} from "./lib/darwin.js";
import { parseEther, type Address, type Hex } from "viem";

/** The testnet faucet caps a single account at 10,000 tUSDC and reverts past it. */
const FAUCET_CAP = 10_000;

type Args = {
  faucet: boolean;
  collateral?: number;
  native?: number;
  windows?: number;
  prophet?: number;
  amount?: number;
};

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const m = manifest();

  await report(m);

  const anyAction =
    a.faucet || a.collateral !== undefined || a.native !== undefined || a.windows !== undefined || a.prophet !== undefined;
  if (!anyAction) {
    log("report only — pass --faucet / --collateral / --native / --windows / --prophet to act");
    return;
  }

  const { account, client } = wallet();
  const decimals = m.collateralDecimals;

  if (a.faucet) {
    // UNVERIFIED: whether `faucet(uint256)` takes raw units or whole tokens. Raw units
    // is the convention everywhere else in this codebase and matches the 6dp cap, so
    // that is what is sent; if it reverts FaucetCapExceeded on a small number, the
    // argument is whole tokens instead.
    const want = BigInt(FAUCET_CAP) * 10n ** BigInt(decimals);
    log(`faucet ${FAUCET_CAP} tUSDC to ${account.address}`);
    await send(client, { address: m.collateral, abi: faucetAbi, functionName: "faucet", args: [want] });
  }

  if (a.collateral !== undefined) {
    const amount = scale(a.collateral, decimals);
    const held = await publicClient.readContract({
      address: m.collateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    if (held < amount) throw new Error(`signer holds ${fmt(held, decimals)} tUSDC, needs ${a.collateral}. Try --faucet.`);
    log(`send ${a.collateral} tUSDC -> Population`);
    await send(client, {
      address: m.collateral,
      abi: erc20Abi,
      functionName: "transfer",
      args: [m.population, amount],
    });
  }

  // `--windows` is the number that actually matters: how long the population can think
  // for. Converted here so nobody has to do the multiplication at 2am.
  let nativeWei = a.native !== undefined ? parseEther(String(a.native)) : 0n;
  if (a.windows !== undefined) {
    const [deposit, alive] = await Promise.all([
      publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "requestDeposit" }),
      publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "aliveCount" }),
    ]);
    const perWindow = deposit * (alive === 0n ? 1n : alive);
    const need = perWindow * BigInt(a.windows);
    const have = await publicClient.getBalance({ address: m.population });
    const top = need > have ? need - have : 0n;
    log(`${a.windows} windows x ${alive} organisms = ${fmt(need, 18, 4)} SOMI; topping up ${fmt(top, 18, 4)}`);
    nativeWei += top;
  }
  if (nativeWei > 0n) {
    const hash = await client.sendTransaction({ to: m.population, value: nativeWei });
    await publicClient.waitForTransactionReceipt({ hash });
    log(`sent ${fmt(nativeWei, 18, 4)} SOMI -> Population · ${explorerTx(hash)}`);
  }

  if (a.prophet !== undefined) {
    if (a.amount === undefined) throw new Error("--prophet requires --amount (in tUSDC)");
    const amount = scale(a.amount, decimals);
    // fundProphet pulls with transferFrom, so Population needs an allowance first.
    log(`approve ${a.amount} tUSDC to Population`);
    await send(client, {
      address: m.collateral,
      abi: erc20Abi,
      functionName: "approve",
      args: [m.population, amount],
    });
    log(`fund organism #${a.prophet} with ${a.amount} tUSDC`);
    await send(client, {
      address: m.population,
      abi: populationAbi,
      functionName: "fundProphet",
      args: [BigInt(a.prophet), amount],
    });
  }

  await report(m);
}

async function report(m: Manifest): Promise<void> {
  const [native, coll, deposit, alive, count] = await Promise.all([
    publicClient.getBalance({ address: m.population }),
    publicClient.readContract({
      address: m.collateral,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [m.population],
    }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "requestDeposit" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "aliveCount" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "prophetCount" }),
  ]);

  const perWindow = deposit * (alive === 0n ? 1n : alive);
  const runway = perWindow === 0n ? 0n : native / perWindow;

  log(`Population ${m.population}`);
  log(`  organisms        ${alive} alive / ${count} ever`);
  log(`  collateral       ${fmt(coll, m.collateralDecimals)} tUSDC`);
  log(`  native           ${fmt(native, 18, 4)} SOMI`);
  log(`  per window       ${fmt(perWindow, 18, 4)} SOMI`);
  log(`  runway           ${runway} windows (~${(Number(runway) / 4).toFixed(1)} hours at 15m)`);
  if (runway < 96n) warn("under a day of inference runway — top up with --windows 400");
}

/*//////////////////////////////////////////////////////////////
                             PLUMBING
//////////////////////////////////////////////////////////////*/

function parseArgs(argv: string[]): Args {
  const out: Args = { faucet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    switch (k) {
      case "--faucet":
        out.faucet = true;
        break;
      case "--collateral":
        out.collateral = numArg(argv, ++i, k);
        break;
      case "--native":
        out.native = numArg(argv, ++i, k);
        break;
      case "--windows":
        out.windows = numArg(argv, ++i, k);
        break;
      case "--prophet":
        out.prophet = numArg(argv, ++i, k);
        break;
      case "--amount":
        out.amount = numArg(argv, ++i, k);
        break;
      default:
        throw new Error(`unknown argument ${k}`);
    }
  }
  return out;
}

function numArg(argv: string[], i: number, flagName: string): number {
  const v = argv[i];
  if (v === undefined) throw new Error(`${flagName} needs a value`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${flagName} needs a non-negative number, got ${v}`);
  return n;
}

/** Human amount -> raw units, via a decimal string so no float rounds a balance. */
function scale(amount: number, decimals: number): bigint {
  const [whole = "0", frac = ""] = String(amount).split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded === "" ? "0" : padded);
}

type Call = { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] };

async function send(client: ReturnType<typeof wallet>["client"], call: Call): Promise<Hex> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await client.writeContract(call as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted: ${explorerTx(hash)}`);
  log(`  ok ${explorerTx(hash)}`);
  return hash;
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
