/**
 *  The season boundary, as one predicate, in a module with no dependencies.
 *
 *  WHY IT LIVES HERE AND NOT IN `cadence.ts`. Two processes need this comparison and they
 *  need it for opposite reasons: the cadence asks "may I close the season?" before sending
 *  `endSeason`, and the monitor asks "should someone have closed it by now?" while the
 *  cadence is the thing suspected of being dead. Until 2026-09-06 only the cadence owned
 *  it, so the monitor mirrored the same two guards by hand a few hundred lines away — a
 *  duplicated consensus boundary, which is precisely the drift class the rest of this repo
 *  spends `cite-drift`, `abi-drift` and `count-drift` catching. One of the two copies being
 *  wrong is not a hypothetical: an off-by-one in the closer costs a season, and the same
 *  off-by-one in the monitor makes the alert that would have caught it silent.
 *
 *  `cadence.ts` re-exports this so its `--self-test` table keeps exercising the same symbol
 *  under the same name, and `monitor.ts` imports it directly rather than through the cadence
 *  — the point of the move is that the monitor must not pull the cadence's module graph
 *  (viem, the manifest reader, a `wallet()` that wants a key) into a process whose whole job
 *  is to keep running when the cadence cannot. This file imports nothing, so it cannot.
 */

/**
 *  `endSeason`'s own guard, in TypeScript.
 *
 *  Pure so the comparison can be exercised without a chain — it is the one piece of the
 *  season work that is arithmetic rather than plumbing, and the arithmetic is where an
 *  off-by-one would cost a whole season. The table that exercises it lives behind
 *  `cadence.ts --self-test`, which needs no RPC, no key and no deployment.
 *
 *  MIRRORS `Population.endSeason`'s guard EXACTLY (verified against that line, not
 *  remembered), including the subtraction order:
 *
 *      if (windowCount - seasonStartWindow < seasonWindows) revert SeasonNotOver();
 *
 *  so `>=` here is `!<` there. Written as `count - start >= windows` rather than the more
 *  readable `count >= start + windows` on purpose: the on-chain expression underflows and
 *  reverts if `start` ever exceeds `count`, and a local predicate that quietly returned
 *  `false` where the contract reverts would be a different function. `bigint` throughout —
 *  `windowCount` is a `uint64` and viem hands it over as a `bigint`, while `seasonWindows`
 *  is a `uint32` and arrives as a `number`, so the widening is explicit at the call site
 *  rather than accidental here.
 */
export function seasonIsOver(windowCount: bigint, seasonStartWindow: bigint, seasonWindows: bigint): boolean {
  // A `seasonWindows` of zero would make every window a season boundary. `setSeason`
  // rejects it (`BadSeason`) and `initialize` sets 24, so this is only reachable on a
  // proxy upgraded from a build that predates the field — the same case `level()` guards.
  // Treat it as "no season configured" and never close.
  if (seasonWindows === 0n) return false;
  if (windowCount < seasonStartWindow) return false;
  return windowCount - seasonStartWindow >= seasonWindows;
}

/**
 *  How many windows have opened SINCE the boundary the closer should have acted on.
 *
 *  The monitor's question, and deliberately not a second copy of the predicate above: it
 *  returns `undefined` in exactly the cases where `seasonIsOver` returns `false` for a
 *  reason other than "not yet", so the two can never disagree about whether a boundary
 *  exists. `0n` is the ordinary in-flight state at every boundary — the season became
 *  closeable and the closer reaches it on its next tick — so a caller must compare against
 *  a grace window rather than treating any overshoot as an alarm.
 *
 *  `undefined` means "nothing is known to be overdue", which covers all three of: the
 *  season is not over, the season has no length configured, and `seasonStartWindow` is
 *  ahead of `windowCount` (the read that underflows on chain). A caller that cannot
 *  distinguish those does not need to: none of them is a missed close.
 */
export function seasonOvershoot(
  windowCount: bigint | undefined,
  seasonStartWindow: bigint | undefined,
  seasonWindows: bigint | undefined,
): bigint | undefined {
  if (windowCount === undefined || seasonStartWindow === undefined || seasonWindows === undefined) return undefined;
  if (!seasonIsOver(windowCount, seasonStartWindow, seasonWindows)) return undefined;
  return windowCount - seasonStartWindow - seasonWindows;
}
