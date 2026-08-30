/**
 *  Life support: collateral for the organisms, native STT for their cognition.
 *
 *    npm run fund -- --faucet                  # pull tUSDC from the testnet faucet
 *    npm run fund -- --collateral 100          # 100 tUSDC into Population
 *    npm run fund -- --windows 200             # every living organism up to ~200 windows
 *    npm run fund -- --cognition 1 --prophet 3 # 1 STT of cognition into organism #3
 *    npm run fund -- --house 5                 # 5 STT into Population (funds BIRTHS only)
 *    npm run fund -- --prophet 3 --amount 5    # 5 tUSDC into organism #3
 *    npm run fund                              # report only, no transactions
 *
 *  TWO CURRENCIES, TWO FAILURE MODES, AND THEY LOOK NOTHING ALIKE. Native STT pays for
 *  inference: run out and an organism stops thinking, abstains, pays metabolism anyway,
 *  and dies of nothing. Collateral is what they stake and what they eat: run out at
 *  Population level and new births revert. The first is silent and fatal to the run;
 *  check the runway numbers below before walking away from the machine.
 *
 *  AND THE COGNITION LIVES IN THE ORGANISMS, NOT HERE. Each `Prophet` pays its own
 *  inference deposits from its own balance, so funding Population does NOT buy anybody a
 *  thought — it only endows founders and newborns. `--windows` therefore sends one
 *  `topUpCognition` per living organism, which is why it costs N transactions instead of
 *  one, and `--house` is the separate, much smaller flag for the birth float.
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
  house?: number;
  windows?: number;
  cognition?: number;
  prophet?: number;
  amount?: number;
};

/** One row of the cognition ledger: an organism, what it holds, what that buys. */
type Runway = { id: bigint; addr: Address; bal: bigint; windows: bigint };

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const m = manifest();

  await report(m);

  const anyAction =
    a.faucet ||
    a.collateral !== undefined ||
    a.house !== undefined ||
    a.windows !== undefined ||
    a.cognition !== undefined ||
    a.prophet !== undefined;
  if (!anyAction) {
    log("report only — pass --faucet / --collateral / --windows / --cognition / --house / --prophet to act");
    return;
  }

  // `--prophet` is a target, not an action: it needs to be told WHICH currency. Caught
  // here rather than silently doing nothing, because "the command ran and printed a
  // report" is indistinguishable from "the organism was funded" in a scrollback.
  if (a.prophet !== undefined && a.amount === undefined && a.cognition === undefined) {
    throw new Error("--prophet needs --amount <tUSDC> (collateral) or --cognition <STT> (inference)");
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
  // for. It tops each organism UP TO that runway rather than adding to it, so running it
  // twice is idempotent and an organism that is already flush is skipped instead of
  // being handed STT that only `retire` can get back out.
  if (a.windows !== undefined) {
    const rows = await runways(m);
    const deposit = await publicClient.readContract({
      address: m.population,
      abi: populationAbi,
      functionName: "requestDeposit",
    });
    const want = deposit * BigInt(a.windows);
    const short = rows.filter((r) => r.bal < want);
    if (rows.length === 0) {
      warn("no living organisms — nothing to fund. Seed the population first.");
    } else if (short.length === 0) {
      log(`all ${rows.length} organisms already hold ${a.windows}+ windows; nothing to send`);
    } else {
      const total = short.reduce((sum, r) => sum + (want - r.bal), 0n);
      log(
        `${a.windows} windows = ${fmt(want, 18, 4)} STT each; topping up ${short.length}/${rows.length} ` +
          `organisms for ${fmt(total, 18, 4)} STT in ${short.length} transactions`,
      );
      const held = await publicClient.getBalance({ address: account.address });
      if (held < total) throw new Error(`signer holds ${fmt(held, 18, 4)} STT, needs ${fmt(total, 18, 4)}`);
      for (const r of short) {
        const top = want - r.bal;
        log(`  organism #${r.id}: ${r.windows}w -> ${a.windows}w (+${fmt(top, 18, 4)} STT)`);
        await send(client, {
          address: m.population,
          abi: populationAbi,
          functionName: "topUpCognition",
          args: [r.id],
          value: top,
        });
      }
    }
  }

  // One organism, an explicit amount. The escape hatch for reviving a child that was
  // born brain-dead because the house float was empty at `hatchAll`.
  if (a.cognition !== undefined) {
    if (a.prophet === undefined) throw new Error("--cognition requires --prophet <id>");
    const value = parseEther(String(a.cognition));
    log(`send ${a.cognition} STT of cognition -> organism #${a.prophet}`);
    await send(client, {
      address: m.population,
      abi: populationAbi,
      functionName: "topUpCognition",
      args: [BigInt(a.prophet)],
      value,
    });
  }

  // The birth float. Small on purpose: it buys newborns their first endowment, not the
  // population's thinking, so it is sized in children rather than in windows.
  if (a.house !== undefined) {
    const value = parseEther(String(a.house));
    const hash = await client.sendTransaction({ to: m.population, value });
    await publicClient.waitForTransactionReceipt({ hash });
    log(`sent ${a.house} STT -> Population (birth float) · ${explorerTx(hash)}`);
  }

  if (a.prophet !== undefined && a.amount !== undefined) {
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

/**
 *  Every living organism, what native it holds, and how many more thoughts that buys.
 *
 *  Reads `snapshot()` rather than walking `prophetAt` because the runway of a DEAD
 *  organism is not a number anybody should act on, and snapshot is the one call that
 *  distinguishes them.
 */
async function runways(m: Manifest): Promise<Runway[]> {
  const [deposit, snap] = await Promise.all([
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "requestDeposit" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "snapshot" }),
  ]);
  const living = (snap as readonly { id: bigint; addr: Address; dead: boolean }[]).filter((o) => !o.dead);
  return Promise.all(
    living.map(async (o) => {
      const bal = await publicClient.getBalance({ address: o.addr });
      return { id: o.id, addr: o.addr, bal, windows: deposit === 0n ? 0n : bal / deposit };
    }),
  );
}

async function report(m: Manifest): Promise<void> {
  const [native, coll, deposit, alive, count, endow, rows] = await Promise.all([
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
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "cognitionEndowment" }),
    runways(m),
  ]);

  const cognition = rows.reduce((sum, r) => sum + r.bal, 0n);
  const worst = rows.reduce((lo, r) => (r.windows < lo ? r.windows : lo), rows[0]?.windows ?? 0n);
  // What the HOUSE balance actually buys: children, not thoughts.
  const births = endow === 0n ? "unbounded (cognitionEndowment is 0)" : `${native / endow} more children`;

  log(`Population ${m.population}`);
  log(`  organisms        ${alive} alive / ${count} ever`);
  log(`  collateral       ${fmt(coll, m.collateralDecimals)} tUSDC`);
  log(`  cost to think    ${fmt(deposit, 18, 4)} STT per organism per window`);
  log(`  cognition held   ${fmt(cognition, 18, 4)} STT across ${rows.length} living organisms`);
  log(`  worst runway     ${worst} windows (~${(Number(worst) / 4).toFixed(1)} hours at 15m)`);
  log(`  birth float      ${fmt(native, 18, 4)} STT in Population = ${births}`);
  for (const r of rows) {
    log(`    #${String(r.id).padStart(2)}  ${fmt(r.bal, 18, 4).padStart(9)} STT  ${String(r.windows).padStart(4)}w`);
  }
  if (rows.length > 0 && worst < 96n) warn("an organism is under a day of runway — top up with --windows 400");
  if (endow > 0n && native < endow) warn("Population cannot endow one newborn — top up with --house 5");
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
      // Renamed from `--native` on 2026-08-30 rather than redefined, because the flag's
      // MEANING changed: it used to fund the whole population's thinking and now funds
      // only births. A runbook line typed from muscle memory should fail loudly instead
      // of quietly sending the population's runway to the wrong address.
      case "--house":
        out.house = numArg(argv, ++i, k);
        break;
      case "--native":
        throw new Error(
          "--native is gone: organisms pay for their own cognition now. Use --windows <n> to fund " +
            "the organisms' thinking, or --house <STT> for Population's birth float.",
        );
      case "--cognition":
        out.cognition = numArg(argv, ++i, k);
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

type Call = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  /** Set for the payable calls — `topUpCognition` is the only one here. */
  value?: bigint;
};

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
