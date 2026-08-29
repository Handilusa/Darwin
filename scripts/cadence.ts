/**
 *  The cadence. This is what keeps the population alive.
 *
 *  Run with:
 *    npm run cadence            # forever
 *    npm run cadence:once       # one action, then exit (for cron)
 *
 *  DESIGN: a state machine on the on-chain `phase`, not a fixed sequence.
 *
 *  Every iteration reads `Population.phase()` and performs the one action that phase
 *  permits. Nothing is remembered between iterations — the active market, the window
 *  number and the phase all live on chain, so this process can be killed, restarted,
 *  moved to another machine, or run from cron, and it resumes exactly where the
 *  population is rather than where it thinks the population should be. For a run that
 *  must not stop for eleven days, that property is worth more than any amount of
 *  cleverness in the scheduling.
 *
 *  It is also, deliberately, the thinnest possible off-chain component: it pushes two
 *  prices and calls four functions. It decides nothing. Belief formation, pairing,
 *  fitness, death, mutation and lineage are all on chain, and if this process dies the
 *  population does not lose state — it stops advancing, which `monitor.ts` alerts on.
 */
import {
  BELIEF,
  PHASE,
  fmt,
  flag,
  log,
  manifest,
  marketsModuleAbi,
  num,
  populationAbi,
  priceSourceAbi,
  prophetAbi,
  publicClient,
  selectionEngineAbi,
  sleep,
  stamp,
  wallet,
  warn,
  explorerTx,
  type Manifest,
} from "./lib/darwin.js";
import { discover, resolution } from "./lib/market.js";
import { BaseError, ContractFunctionRevertedError, type Address, type Hex } from "viem";

/*//////////////////////////////////////////////////////////////
                             TUNABLES
//////////////////////////////////////////////////////////////*/

/** Stop opening new positions this many seconds before expiry. */
const COMMIT_LEAD = num("CADENCE_COMMIT_LEAD", 60);

/**
 *  Do not START a window with less than this much time left.
 *
 *  Inference is asynchronous with a 300-second request timeout, and a window whose
 *  commitment lands after expiry is a window where every organism paid to think and
 *  then had nothing to think about. Wait for the next one instead — at a 15-minute
 *  cadence that costs at most fifteen minutes.
 */
const MIN_WINDOW_SECONDS = num("CADENCE_MIN_WINDOW", 360);

/** How long to wait for validator responses before committing on whatever arrived. */
const INFERENCE_PATIENCE = num("CADENCE_INFERENCE_PATIENCE", 330);

/** How long to wait for the reactivity precompile to settle before poking manually. */
const REACTIVITY_PATIENCE = num("CADENCE_REACTIVITY_PATIENCE", 90);

const POLL = num("CADENCE_POLL", 5) * 1000;
const IDLE = num("CADENCE_IDLE", 15) * 1000;

const USE_REACTIVITY = flag("CADENCE_USE_REACTIVITY", false);

/*//////////////////////////////////////////////////////////////
                               MAIN
//////////////////////////////////////////////////////////////*/

async function main(): Promise<void> {
  const m = manifest();
  const { account, client } = wallet();
  const once = process.argv.includes("--once");

  await preflight(m, account.address);

  log(`cadence up as ${account.address}; population ${m.population}; symbol ${m.symbol}`);

  for (;;) {
    try {
      const advanced = await step(m, client);
      if (once) break;
      if (!advanced) await sleep(IDLE);
    } catch (err) {
      // A cadence that dies on a transient RPC error is a population that dies with it.
      warn(describe(err));
      if (once) {
        process.exitCode = 1;
        break;
      }
      await sleep(IDLE);
    }
  }
}

/** @returns true if the population moved a phase this step. */
async function step(m: Manifest, client: WalletLike): Promise<boolean> {
  const phase = await read(m, "phase");

  switch (Number(phase)) {
    case 0:
      return await doThink(m, client);
    case 1:
      return await doCommit(m, client);
    case 2:
      return await doSettle(m, client);
    default:
      warn(`unknown phase ${phase} — leaving it alone. Use forcePhase(0) if it is wedged.`);
      return false;
  }
}

/*//////////////////////////////////////////////////////////////
                          PHASE 0 — THINK
//////////////////////////////////////////////////////////////*/

async function doThink(m: Manifest, client: WalletLike): Promise<boolean> {
  const w = await discover(m.symbol, m);
  const now = Math.floor(Date.now() / 1000);

  if (now < w.tradingStart) {
    log(`window ${short(w.marketId)} opens in ${w.tradingStart - now}s`);
    return false;
  }

  const remaining = w.expiry - now;
  if (remaining < MIN_WINDOW_SECONDS) {
    log(`window ${short(w.marketId)} has only ${remaining}s left — waiting for the next one`);
    return false;
  }

  const { resolved, voided } = await resolution(w.market);
  if (resolved || voided) {
    log(`window ${short(w.marketId)} already ${voided ? "voided" : "resolved"} — waiting for the next one`);
    return false;
  }

  // Push, then think, back to back and in that order. `PushedPriceSource` refuses a
  // price older than `maxStaleness` (180s), so any delay between these two calls is a
  // reverting `think()`.
  log(
    `push  ${m.symbol} ${short(w.marketId)} open=${fmt(w.openPrice, w.priceDecimals, 2)} ` +
      `last=${fmt(w.lastPrice, w.priceDecimals, 2)} (${w.source}) ${remaining}s left`,
  );
  await send(client, {
    address: m.priceSource,
    abi: priceSourceAbi,
    functionName: "pushWindow",
    args: [m.symbol, w.marketId, w.openPrice, w.lastPrice, w.priceDecimals],
  });

  const alive = await read(m, "aliveCount");
  if (alive === 0n) {
    warn("no living organisms — the population is extinct. Nothing left to drive.");
    return false;
  }

  const deposit = await read(m, "requestDeposit");
  const balance = await publicClient.getBalance({ address: m.population });
  const needed = deposit * alive;
  if (balance < needed) {
    warn(
      `Population holds ${fmt(balance, 18, 4)} native but this window costs ${fmt(needed, 18, 4)}. ` +
        `Some organisms will fail to think and will still pay metabolism. Fund it: npm run fund`,
    );
  }

  const hash = await send(client, {
    address: m.population,
    abi: populationAbi,
    functionName: "think",
  });
  const window = await read(m, "windowCount");
  log(`think window #${window} · ${alive} organisms · ${explorerTx(hash)}`);
  return true;
}

/*//////////////////////////////////////////////////////////////
                         PHASE 1 — COMMIT
//////////////////////////////////////////////////////////////*/

async function doCommit(m: Manifest, client: WalletLike): Promise<boolean> {
  const deadline = await commitDeadline(m);
  const patienceEndsAt = Math.floor(Date.now() / 1000) + INFERENCE_PATIENCE;

  for (;;) {
    const now = Math.floor(Date.now() / 1000);
    const pending = await pendingThinkers(m);

    if (pending.length === 0) {
      log(`all beliefs in (${await beliefSummary(m)})`);
      break;
    }
    if (deadline !== undefined && now >= deadline) {
      warn(`committing at the deadline with ${pending.length} organism(s) still thinking: ${pending.join(", ")}`);
      break;
    }
    if (now >= patienceEndsAt) {
      warn(`inference patience exhausted with ${pending.length} still pending: ${pending.join(", ")}`);
      break;
    }

    await sleep(POLL);
  }

  // An organism with no consensus answer opens a zero-size position and is scored as an
  // abstain. That is the intended mechanic, not a failure: it failed to think, it acts
  // on nothing, and it still pays metabolism.
  const hash = await send(client, {
    address: m.population,
    abi: populationAbi,
    functionName: "commitAll",
  });
  log(`commit · ${explorerTx(hash)}`);
  return true;
}

/** Seconds-since-epoch by which the commitment must land, from the market's own expiry. */
async function commitDeadline(m: Manifest): Promise<number | undefined> {
  const marketId = await read(m, "activeMarketId");
  if (marketId === "0x0000000000000000000000000000000000000000000000000000000000000000") return undefined;
  const rec = await publicClient.readContract({
    address: m.marketsModule,
    abi: marketsModuleAbi,
    functionName: "markets",
    args: [marketId as Hex],
  });
  const expiry = Number(rec[13]);
  return expiry - COMMIT_LEAD;
}

/** Ids of living organisms whose inference request has not come back yet. */
async function pendingThinkers(m: Manifest): Promise<number[]> {
  const snap = await read(m, "snapshot");
  const out: number[] = [];
  for (const o of snap) {
    if (o.dead) continue;
    const pending = await publicClient.readContract({
      address: o.addr,
      abi: prophetAbi,
      functionName: "pendingBeliefRequestId",
    });
    if (pending !== 0n) out.push(Number(o.id));
  }
  return out;
}

async function beliefSummary(m: Manifest): Promise<string> {
  const snap = await read(m, "snapshot");
  const counts = new Map<string, number>();
  for (const o of snap) {
    if (o.dead) continue;
    const name = BELIEF[o.belief] ?? `?${o.belief}`;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([k, v]) => `${v} ${k}`).join(", ") || "nobody";
}

/*//////////////////////////////////////////////////////////////
                         PHASE 2 — SETTLE
//////////////////////////////////////////////////////////////*/

async function doSettle(m: Manifest, client: WalletLike): Promise<boolean> {
  const marketId = (await read(m, "activeMarketId")) as Hex;
  const rec = await publicClient.readContract({
    address: m.marketsModule,
    abi: marketsModuleAbi,
    functionName: "markets",
    args: [marketId],
  });
  const market = rec[8];
  const expiry = Number(rec[13]);

  const now = Math.floor(Date.now() / 1000);
  if (now < expiry) {
    log(`window ${short(marketId)} expires in ${expiry - now}s`);
    return false;
  }

  const { resolved, voided } = await resolution(market);
  if (!resolved && !voided) {
    log(`window ${short(marketId)} expired but not yet resolved on chain — waiting`);
    return false;
  }

  // THE CENTRAL CLAIM. When reactivity is live, the precompile inserts a synthetic
  // transaction in the SAME BLOCK as resolution and `settleAll()` has already run by the
  // time this process notices. Give it a moment to prove that before reaching for the
  // manual path — and say plainly which one happened, because "no keeper anywhere in the
  // causal chain" is only true in the first case.
  if (USE_REACTIVITY) {
    const until = Date.now() + REACTIVITY_PATIENCE * 1000;
    while (Date.now() < until) {
      if (Number(await read(m, "phase")) === 0) {
        log(`settled by reactivity — no transaction from this process. ${voided ? "(voided window)" : ""}`);
        await hatch(m, client);
        return true;
      }
      await sleep(POLL);
    }
    warn(`reactivity did not settle within ${REACTIVITY_PATIENCE}s — falling back to poke()`);
  }

  const fallbackOpen = await publicClient.readContract({
    address: m.selectionEngine,
    abi: selectionEngineAbi,
    functionName: "fallbackEnabled",
  });

  const hash = fallbackOpen
    ? await send(client, { address: m.selectionEngine, abi: selectionEngineAbi, functionName: "poke" })
    : await send(client, { address: m.population, abi: populationAbi, functionName: "settleAll" });

  log(`settle${voided ? " (voided)" : ""} via ${fallbackOpen ? "SelectionEngine.poke" : "settleAll"} · ${explorerTx(hash)}`);
  await reportDeaths(m);
  await hatch(m, client);
  return true;
}

/** Children whose mutation consensus arrived are born here, one transaction, best effort. */
async function hatch(m: Manifest, client: WalletLike): Promise<void> {
  try {
    const hash = await send(client, { address: m.population, abi: populationAbi, functionName: "hatchAll" });
    log(`hatch · ${explorerTx(hash)}`);
  } catch (err) {
    // NothingToHatch is the normal case, not an error.
    if (!/NothingToHatch/.test(describe(err))) warn(`hatchAll: ${describe(err)}`);
  }
}

async function reportDeaths(m: Manifest): Promise<void> {
  const snap = await read(m, "snapshot");
  const window = await read(m, "windowCount");
  for (const o of snap) {
    if (o.dead && o.deathWindow === window) {
      log(
        `DEATH  #${o.id} gen ${o.generation} after ${o.windowsLived} windows ` +
          `(${o.correctCount}/${o.wrongCount}/${o.abstainCount} right/wrong/abstain)`,
      );
    }
  }
  log(`alive ${snap.filter((o) => !o.dead).length}/${snap.length} · window #${window}`);
}

/*//////////////////////////////////////////////////////////////
                            PREFLIGHT
//////////////////////////////////////////////////////////////*/

async function preflight(m: Manifest, signer: Address): Promise<void> {
  const id = await publicClient.getChainId();
  if (id !== m.chainId) throw new Error(`RPC is chain ${id} but the manifest is for ${m.chainId}`);

  const [owner, updater, gas] = await Promise.all([
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "owner" }),
    publicClient.readContract({ address: m.priceSource, abi: priceSourceAbi, functionName: "updater" }),
    publicClient.getBalance({ address: signer }),
  ]);

  // `think`/`commitAll`/`settleAll` are gated on owner ‖ selectionEngine ‖ precompile,
  // and `pushWindow` on updater ‖ owner. Discovering that from a reverted transaction at
  // 2am is worse than discovering it now.
  if (owner.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(`signer ${signer} is not Population.owner (${owner}) — think()/commitAll() will revert NotDriver`);
  }
  if (updater.toLowerCase() !== signer.toLowerCase() && owner.toLowerCase() !== signer.toLowerCase()) {
    throw new Error(`signer ${signer} is neither updater (${updater}) nor owner — pushWindow() will revert`);
  }
  if (gas === 0n) throw new Error(`signer ${signer} has no native balance for gas`);

  log(`phase ${PHASE[Number(await read(m, "phase"))] ?? "?"} · window #${await read(m, "windowCount")}`);
}

/*//////////////////////////////////////////////////////////////
                             PLUMBING
//////////////////////////////////////////////////////////////*/

type WalletLike = ReturnType<typeof wallet>["client"];

/**
 *  A contract call, loosely typed on purpose.
 *
 *  viem's generic inference over a union of function names is more trouble than it is
 *  worth for four call sites; the ABIs are the source of truth and a wrong function name
 *  fails at the RPC, immediately and loudly.
 */
type Call = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
};

/** Typed convenience over the handful of Population reads this script makes. */
async function read<K extends "phase" | "windowCount" | "aliveCount" | "requestDeposit" | "activeMarketId" | "snapshot">(
  m: Manifest,
  functionName: K,
): Promise<ReadResult<K>> {
  return (await publicClient.readContract({
    address: m.population,
    abi: populationAbi,
    functionName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)) as ReadResult<K>;
}

type Snapshot = {
  id: bigint;
  addr: Address;
  parentId: bigint;
  generation: number;
  treasury: bigint;
  streak: number;
  windowsLived: number;
  correctCount: number;
  wrongCount: number;
  abstainCount: number;
  birthWindow: bigint;
  deathWindow: bigint;
  dead: boolean;
  belief: number;
  thesis: number;
  genomeHash: Hex;
};

type ReadResult<K> = K extends "snapshot"
  ? readonly Snapshot[]
  : K extends "activeMarketId"
    ? Hex
    : bigint;

/** Write, wait for the receipt, and fail loudly if it reverted. */
async function send(client: WalletLike, call: Call): Promise<Hex> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hash = await client.writeContract(call as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted on chain: ${explorerTx(hash)}`);
  return hash;
}

/** Turn a viem revert into a sentence. The ABIs carry the custom errors for this. */
function describe(err: unknown): string {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      const args = reverted.data?.args;
      if (name) return `${name}(${(args ?? []).join(", ")})`;
      if (reverted.reason) return reverted.reason;
    }
    return err.shortMessage || err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const short = (h: string) => `${h.slice(0, 10)}…`;

main().catch((err) => {
  console.error(`[${stamp()}] FATAL`, describe(err));
  process.exit(1);
});
