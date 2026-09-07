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
 *
 *  `--windows` ONLY WORKS AFTER THE SEED. It walks `snapshot()` and tops up the LIVING,
 *  so before generation 0 exists it funds nothing and says so. `--house` is the one that
 *  matters pre-seed: `spawnGenesis` reverts `HouseCannotEndowFounders` unless Population
 *  already holds `8 * cognitionEndowment`. The report below states the float as founders
 *  covered rather than children while the population is empty, for exactly that reason.
 *
 *  EVERY FLAG IS ITS OWN LEG, AND ONE FAILING DOES NOT SKIP THE REST. See the block
 *  above the first leg in `main` for why that is worth the machinery.
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

/**
 *  The faucet mints at most this many tUSDC PER CALL and reverts `FaucetCapExceeded`
 *  past it. Per call, not per account: see the note at the `--faucet` leg.
 */
const FAUCET_CAP = 10_000;

/**
 *  The founding roster, for the pre-seed float threshold only.
 *
 *  `genomes/genesis.json` is the source of truth and `Seed.s.sol` reads it; this is the
 *  number the warning below scales by, so if the roster changes the two are reconciled by
 *  hand. It is only ever used while `prophetCount() == 0`, and the on-chain check it
 *  points at — `spawnGenesis`'s `HouseCannotEndowFounders` — counts the genomes actually
 *  passed, so being wrong here changes a warning and never a transaction.
 */
const FOUNDERS = 8;

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

  /*
   *  EVERY LEG RUNS, EVEN AFTER ONE FAILS — and until 2026-09-06 that was not true.
   *
   *  The legs used to be bare `if` blocks in one straight-line `main()`, so the FIRST
   *  throw skipped every leg after it and the process exited 1 having done part of the
   *  job. `--faucet --collateral 100 --house 4` is the one command an operator runs on
   *  deploy morning, and a faucet that reverts (it has a per-call cap) took the house
   *  float down with it. The float being absent is the expensive half: `spawnGenesis`
   *  reverts `HouseCannotEndowFounders` and the seed has to be re-run.
   *
   *  INDEPENDENT LEGS RATHER THAN REFUSING TO COMBINE FLAGS, which was the other option
   *  and is worse here for two reasons. The dependency between the legs is real but it
   *  is already checked where it matters — `--collateral` reads the signer's balance and
   *  throws naming the shortfall and suggesting `--faucet`, so a skipped faucet fails the
   *  next leg loudly rather than silently. And the legs are otherwise genuinely
   *  independent: STT and tUSDC are different currencies going to different addresses,
   *  and there is no ordering between the house float and the organisms' cognition at
   *  all. Forcing three invocations would trade a real failure mode for three chances to
   *  forget one.
   *
   *  What must NOT happen is a partial run reporting success, so failures are collected
   *  and re-raised at the end with the ledger of what did and did not land.
   */
  const failed: { leg: string; why: string }[] = [];
  const done: string[] = [];
  const leg = async (name: string, body: () => Promise<void>): Promise<void> => {
    try {
      await body();
      done.push(name);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      warn(`${name} FAILED: ${why}`);
      warn(`  continuing with the remaining legs — see the summary at the end`);
      failed.push({ leg: name, why });
    }
  };

  if (a.faucet) {
    // SETTLED 2026-09-06, and it used to say UNVERIFIED here. `faucet(uint256)` takes
    // RAW UNITS and mints them verbatim: `cast call --trace` on `faucet(1000000)`
    // against the live token emits `Transfer(0x0 -> caller, 1000000)`, and on
    // `faucet(10000)` emits `Transfer(..., 10000)`. So `FAUCET_CAP * 10^decimals` below
    // is right, and the whole-token reading would have minted a ten-thousandth of a
    // cent while looking like it worked.
    //
    // The cap is real and it is PER CALL, not cumulative per account.
    // `faucet(10_000e6)` succeeds, `faucet(10_000e6 + 1)` reverts `0x37583762` =
    // `FaucetCapExceeded()`, and `2540be400` (10,000e6) appears as a constant in the
    // runtime bytecode. Negative control: the same maximum call from an account already
    // holding 12.4M tUSDC also succeeds and mints another 10,000, and no cooldown was
    // observed — so this can be run repeatedly and nobody needs tUSDC handed to them.
    await leg("--faucet", async () => {
      const want = BigInt(FAUCET_CAP) * 10n ** BigInt(decimals);
      log(`faucet ${FAUCET_CAP} tUSDC to ${account.address}`);
      await send(client, { address: m.collateral, abi: faucetAbi, functionName: "faucet", args: [want] });
    });
  }

  if (a.collateral !== undefined) {
    const target = a.collateral;
    await leg("--collateral", async () => {
      const amount = scale(target, decimals);
      const held = await publicClient.readContract({
        address: m.collateral,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account.address],
      });
      if (held < amount) throw new Error(`signer holds ${fmt(held, decimals)} tUSDC, needs ${target}. Try --faucet.`);
      log(`send ${target} tUSDC -> Population`);
      await send(client, {
        address: m.collateral,
        abi: erc20Abi,
        functionName: "transfer",
        args: [m.population, amount],
      });
    });
  }

  /*
   *  The birth float, and it runs BEFORE `--windows` — which is a change, and the reason
   *  is the pre-seed case. `--windows` funds LIVING organisms, so before the seed it is a
   *  no-op, while the float is the one thing `spawnGenesis` hard-reverts on. Running the
   *  no-op first meant `--house 4 --windows 400` typed on deploy morning sent nothing,
   *  said so, and only then sent the transfer that actually gated the seed. Ordering the
   *  legs so the blocking one goes first costs nothing after the seed, when both work.
   *
   *  Sized in children rather than in windows: it buys newborns their first endowment,
   *  not the population's thinking.
   */
  if (a.house !== undefined) {
    const stt = a.house;
    await leg("--house", async () => {
      const value = parseEther(String(stt));
      log(`send ${stt} STT -> Population (birth float)`);
      /*
       *  THE ONE TRANSFER OF THE DAY THAT MUST LAND, and until 2026-09-06 the only one here
       *  that did not check its receipt: it went through `sendTransaction` and awaited the
       *  receipt without reading `status`, so a reverting `receive()` printed `sent 5 STT ->
       *  Population` with an explorer link and exited 0 with the float still at zero. It
       *  used to be invisible until `think` raised seven `ThinkFailed`s; since
       *  `spawnGenesis` began checking the total up front it is instead invisible until the
       *  seed reverts `HouseCannotEndowFounders`, which is louder but still a wasted
       *  broadcast. Routed through the same helper as every other write, which throws on a
       *  non-success status.
       */
      await send(client, { to: m.population, value });
    });
  }

  // `--windows` is the number that actually matters: how long the population can think
  // for. It tops each organism UP TO that runway rather than adding to it, so running it
  // twice is idempotent and an organism that is already flush is skipped instead of
  // being handed STT that only `retire` can get back out.
  if (a.windows !== undefined) {
    const target = a.windows;
    await leg("--windows", async () => {
      const rows = await runways(m);
      const deposit = await publicClient.readContract({
        address: m.population,
        abi: populationAbi,
        functionName: "requestDeposit",
      });
      const want = deposit * BigInt(target);
      const short = rows.filter((r) => r.bal < want);
      if (rows.length === 0) {
        warn("no living organisms — nothing to fund. Seed the population first.");
      } else if (short.length === 0) {
        log(`all ${rows.length} organisms already hold ${target}+ windows; nothing to send`);
      } else {
        const total = short.reduce((sum, r) => sum + (want - r.bal), 0n);
        log(
          `${target} windows = ${fmt(want, 18, 4)} STT each; topping up ${short.length}/${rows.length} ` +
            `organisms for ${fmt(total, 18, 4)} STT in ${short.length} transactions`,
        );
        const held = await publicClient.getBalance({ address: account.address });
        if (held < total) throw new Error(`signer holds ${fmt(held, 18, 4)} STT, needs ${fmt(total, 18, 4)}`);
        for (const r of short) {
          const top = want - r.bal;
          log(`  organism #${r.id}: ${r.windows}w -> ${target}w (+${fmt(top, 18, 4)} STT)`);
          await send(client, {
            address: m.population,
            abi: populationAbi,
            functionName: "topUpCognition",
            args: [r.id],
            value: top,
          });
        }
      }
    });
  }

  // One organism, an explicit amount. The escape hatch for reviving a child that was
  // born brain-dead because the house float was empty at `hatchAll`.
  if (a.cognition !== undefined) {
    const stt = a.cognition;
    const id = a.prophet;
    await leg("--cognition", async () => {
      if (id === undefined) throw new Error("--cognition requires --prophet <id>");
      const value = parseEther(String(stt));
      log(`send ${stt} STT of cognition -> organism #${id}`);
      await send(client, {
        address: m.population,
        abi: populationAbi,
        functionName: "topUpCognition",
        args: [BigInt(id)],
        value,
      });
    });
  }

  if (a.prophet !== undefined && a.amount !== undefined) {
    const id = a.prophet;
    const tokens = a.amount;
    await leg("--prophet --amount", async () => {
      const amount = scale(tokens, decimals);
      // fundProphet pulls with transferFrom, so Population needs an allowance first.
      log(`approve ${tokens} tUSDC to Population`);
      await send(client, {
        address: m.collateral,
        abi: erc20Abi,
        functionName: "approve",
        args: [m.population, amount],
      });
      log(`fund organism #${id} with ${tokens} tUSDC`);
      await send(client, {
        address: m.population,
        abi: populationAbi,
        functionName: "fundProphet",
        args: [BigInt(id), amount],
      });
    });
  }

  await report(m);

  // THE LEDGER, then the failure. Printed after the closing report so the last thing on
  // screen is what did not happen rather than a balance table that looks fine, and
  // thrown rather than returned so the exit code still says the command did not do what
  // it was asked. A partial run must never exit 0.
  if (failed.length > 0) {
    log("");
    if (done.length > 0) log(`legs that LANDED: ${done.join(", ")}`);
    for (const f of failed) warn(`leg ${f.leg} did NOT land: ${f.why}`);
    throw new Error(`${failed.length} of ${failed.length + done.length} legs failed — see above`);
  }
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
  const covers = endow === 0n ? 0n : native / endow;
  const births = endow === 0n ? "unbounded (cognitionEndowment is 0)" : `${covers} more children`;

  // BEFORE THE SEED, "one newborn" IS THE WRONG THRESHOLD. `spawnGenesis` needs the
  // whole founding roster's cognition in one atomic check — `FOUNDERS *
  // cognitionEndowment` — so a float that endows one founder passes the old warning and
  // still reverts `HouseCannotEndowFounders` on the seed. The threshold therefore
  // switches on whether the population exists: founders while `count == 0`, then births.
  const preSeed = count === 0n;
  const need = endow * BigInt(FOUNDERS);

  log(`Population ${m.population}`);
  log(`  organisms        ${alive} alive / ${count} ever`);
  log(`  collateral       ${fmt(coll, m.collateralDecimals)} tUSDC`);
  log(`  cost to think    ${fmt(deposit, 18, 4)} STT per organism per window`);
  log(`  cognition held   ${fmt(cognition, 18, 4)} STT across ${rows.length} living organisms`);
  log(`  worst runway     ${worst} windows (~${(Number(worst) / 4).toFixed(1)} hours at 15m)`);
  if (preSeed && endow > 0n) {
    log(
      `  birth float      ${fmt(native, 18, 4)} STT in Population = ${covers}/${FOUNDERS} founders ` +
        `(seed needs ${fmt(need, 18, 4)} STT)`,
    );
  } else {
    log(`  birth float      ${fmt(native, 18, 4)} STT in Population = ${births}`);
  }
  for (const r of rows) {
    log(`    #${String(r.id).padStart(2)}  ${fmt(r.bal, 18, 4).padStart(9)} STT  ${String(r.windows).padStart(4)}w`);
  }
  if (rows.length > 0 && worst < 96n) warn("an organism is under a day of runway — top up with --windows 400");
  if (endow > 0n && preSeed && native < need) {
    warn(
      `Population cannot endow ${FOUNDERS} founders: holds ${fmt(native, 18, 4)} STT, ` +
        `spawnGenesis needs ${fmt(need, 18, 4)} and reverts HouseCannotEndowFounders below it`,
    );
    warn(`  top up with --house ${Math.ceil(Number(need) / 1e18)} before seeding`);
  } else if (endow > 0n && !preSeed && native < endow) {
    warn("Population cannot endow one newborn — top up with --house 5");
  }
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

/** A contract write. */
type Call = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  /** Set for the payable calls — `topUpCognition` is the only one here. */
  value?: bigint;
};

/** A bare value transfer — `--house`, whose target is `Population.receive()`. */
type Transfer = { to: Address; value: bigint };

/**
 *  Every write in this file goes through here, so every write checks its receipt.
 *
 *  The `to`/`value` shape exists because `--house` used to call `sendTransaction` inline and
 *  was therefore the one transaction of the deploy day that could fail silently. Keeping both
 *  shapes in one helper is what makes "checked" the default rather than a thing each call
 *  site has to remember.
 */
async function send(
  client: ReturnType<typeof wallet>["client"],
  call: Call | Transfer,
): Promise<Hex> {
  const hash =
    "to" in call
      ? await client.sendTransaction(call as never)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await client.writeContract(call as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted: ${explorerTx(hash)}`);
  log(`  ok ${explorerTx(hash)}`);
  return hash;
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
