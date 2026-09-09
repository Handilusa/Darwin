/**
 *  Refresh the staleness clock on the CURRENT window without moving the price.
 *
 *  THE SITUATION THIS IS FOR, named at `cadence.ts:435-442` as a known limit. `PushedPriceSource`
 *  rejects a read older than `maxStaleness` (180 s). `commitAll` reads the price inside
 *  `_pair`, so a phase-1 commit that arrives late does not merely commit stale — it reverts
 *  `StalePrice`, every organism comes back `CommitFailed`/`Unpaired`, and each one still pays
 *  metabolism at settlement having thought, answered, and never been played. Under the
 *  continuous cadence the gap is seconds and this never happens. Under `cadence:once` the
 *  push and the commit are separate invocations with an operator in between, and 180 s is
 *  easy to lose.
 *
 *  WHAT IT PUSHES: exactly what is already stored. `openPrice`, `lastPrice`, `marketId` and
 *  `priceDecimals` are read from `rawWindow` and written back byte for byte; the only field
 *  that moves is `updatedAt`, which `pushWindow` sets from the block timestamp and which is
 *  the only field the staleness check reads.
 *
 *  That identity is the entire safety argument. `openPrice` is the level every organism in
 *  this window is graded against, so a re-push that "refreshes" it would not delay the
 *  fitness signal, it would corrupt it — the population would be scored against a line it
 *  was never asked about. Refusing to touch any value makes this operation semantically
 *  inert by construction rather than by care.
 *
 *  `--last <price>` is offered for the case where a genuinely fresher mark is wanted, and it
 *  still refuses to move `openPrice`.
 *
 *  DELIBERATELY NOT WIRED INTO `doCommit`. `cadence.ts:441` declined to add a second
 *  transaction to the commit path untested against a live population, and that judgement is
 *  still right: this is an explicit operator action, taken when the warning fires, and it
 *  leaves its own line in the log.
 *
 *    tsx scripts/repush.ts                 # show the age and what would be written
 *    tsx scripts/repush.ts --broadcast     # refresh the clock
 */
import "dotenv/config";
import { explorerTx, log, manifest, populationAbi, priceSourceAbi, publicClient, wallet, warn } from "./lib/darwin.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const broadcast = process.argv.includes("--broadcast");
  const m = manifest();
  const S = { address: m.priceSource, abi: priceSourceAbi } as const;

  const [raw, limit, updater, phase, activeMarketId] = await Promise.all([
    publicClient.readContract({ ...S, functionName: "rawWindow", args: [m.symbol] }),
    publicClient.readContract({ ...S, functionName: "maxStaleness" }),
    publicClient.readContract({ ...S, functionName: "updater" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "phase" }),
    publicClient.readContract({ address: m.population, abi: populationAbi, functionName: "activeMarketId" }),
  ]);

  if (raw.updatedAt === 0n) throw new Error(`nothing has ever been pushed for ${m.symbol} — there is no window to refresh`);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const age = now - raw.updatedAt;

  log(`PriceSource ${m.priceSource}  symbol ${m.symbol}`);
  log(`  marketId       ${raw.marketId}`);
  log(`  openPrice      ${raw.openPrice}   (the level this window is graded against — NOT touched)`);
  log(`  lastPrice      ${raw.lastPrice}`);
  log(`  priceDecimals  ${raw.priceDecimals}`);
  log(`  updatedAt      ${raw.updatedAt}   age ~${age}s against a ${limit}s limit`);
  log(`  population     phase ${phase} · activeMarketId ${activeMarketId}`);

  /**
   *  THE WINDOW THE ORGANISMS WERE ASKED ABOUT, not merely the newest one on the feed.
   *  `think` copies `currentWindow`'s marketId into `activeMarketId` and every position in
   *  this phase settles against it. If the price source has since rolled to a different
   *  market, refreshing it does not rescue this commit — it re-times a window nobody holds
   *  a belief about, and the commit still fails. Refuse rather than paper over that.
   */
  if (String(activeMarketId).toLowerCase() !== String(raw.marketId).toLowerCase()) {
    warn(`\n  ✗ REFUSING — the price source has rolled to a different market.`);
    warn(`    population is committed to ${activeMarketId}`);
    warn(`    price source now holds     ${raw.marketId}`);
    warn(`    refreshing this would re-time a window the organisms never saw.`);
    process.exit(1);
  }

  if (age < BigInt(limit)) {
    log(`\n  price is still fresh — ${BigInt(limit) - age}s of budget left. Nothing to do.`);
    log(`  (re-pushing anyway is harmless but spends gas for no reason.)`);
    if (!broadcast) return;
  } else {
    warn(`\n  STALE by ${age - BigInt(limit)}s — commitAll would revert StalePrice inside _pair.`);
  }

  const lastRaw = arg("--last");
  const lastPrice = lastRaw === undefined ? raw.lastPrice : BigInt(lastRaw);
  if (lastRaw !== undefined) log(`  --last given: lastPrice ${raw.lastPrice} → ${lastPrice} (openPrice still unchanged)`);
  else log(`  writing back identical values; only updatedAt moves`);

  const { account, client } = wallet();
  if (account.address.toLowerCase() !== String(updater).toLowerCase()) {
    // Owner is also allowed (`cadence.ts:1143-1149`); simulate will settle it either way.
    log(`  note: signer ${account.address} is not the updater (${updater}) — relying on owner rights`);
  }

  const { request } = await publicClient.simulateContract({
    ...S,
    functionName: "pushWindow",
    args: [m.symbol, raw.marketId, raw.openPrice, lastPrice, raw.priceDecimals],
    account,
  });
  log(`  simulated clean from ${account.address}`);

  if (!broadcast) {
    log(`\n  dry run — nothing sent. Re-run with --broadcast to refresh the clock.`);
    return;
  }

  const hash = await client.writeContract(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`pushWindow REVERTED: ${hash}`);
  log(`  ok ${explorerTx(hash)}`);

  // Prove the two things that matter: the clock moved, and the graded level did not.
  const after = await publicClient.readContract({ ...S, functionName: "rawWindow", args: [m.symbol] });
  if (after.openPrice !== raw.openPrice) {
    warn(`  ✗ openPrice CHANGED ${raw.openPrice} → ${after.openPrice} — the fitness signal for this window is corrupt.`);
    process.exit(1);
  }
  if (after.updatedAt <= raw.updatedAt) {
    warn(`  ✗ updatedAt did not advance (${raw.updatedAt} → ${after.updatedAt}) — the clock was not refreshed.`);
    process.exit(1);
  }
  log(`  ✓ openPrice byte-identical (${after.openPrice}); updatedAt ${raw.updatedAt} → ${after.updatedAt}`);
  log(`  commit within ${limit}s. Run: npm run cadence:once`);
}

main().catch((err) => {
  console.error("FATAL", err instanceof Error ? err.message : err);
  process.exit(1);
});
