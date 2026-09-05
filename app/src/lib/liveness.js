/**
 *  Is there a live arena, and what season is it in?
 *
 *  ── WHY THIS EXISTS SEPARATELY FROM THE ENTRY FORM ──────────────────────────
 *  `Enter.jsx` reads nine values because it has to quote a minimum it will take a
 *  signature against. The hero needs exactly one thing: permission to claim it is looking
 *  at something. So this is two reads, not nine — and it is a hook rather than a prop
 *  drilled down from `App` because the hero is mounted imperatively and the entry form is
 *  a thousand lines away; a shared parent holding this would couple two surfaces that
 *  otherwise share nothing but a chain id.
 *
 *  ── WHY THE DOT IS NOT A DECORATION ─────────────────────────────────────────
 *  `.dot-live` is the only element on either surface that says "this reading is current"
 *  without a number beside it (`styles.css:307-311`), and the entry form already treats it
 *  that way: its pulse is gated on `report.verdict === "live"` and stops when reads stop
 *  (`Enter.jsx:749-752`). The hero was pulsing the same dot unconditionally, next to a
 *  hardcoded `Season 1 · 576 windows`, above an entry form that could be withholding
 *  itself because there is no contract at the address. Two surfaces disagreeing about
 *  whether the arena exists, with the more confident one on top.
 *
 *  This is the same defect class as the arena's `Status: LIVE` — a liveness claim that was
 *  printed rather than derived. The fix is the same shape: derive it, and let it go quiet.
 *
 *  ── WHY seasonId AND seasonWindows ARE THE TWO READS ────────────────────────
 *  They are what the pill claims, so they are what it reads. `Population.sol:445-456`
 *  initialises them to 576 and 1, which is exactly why the hardcoded copy looked right and
 *  would have stayed looking right through a `setSeason` call that changed both
 *  (`Population.sol:804-814`). Reading the pair also means the pill and the verdict come
 *  from one batch: the numbers cannot be current while the dot is dead, or vice versa.
 */

import { useReadContracts } from "wagmi";

import { populationReadAbi } from "./abi.js";
import { usePopulation } from "./population.js";
import { readReport } from "./reads.js";

/**
 *  `{ verdict, ok, total, seasonId, seasonWindows, address }`.
 *
 *  `verdict` is `readReport`'s, so the four states and their meanings are identical to the
 *  entry form's — including the distinction that matters most here: `unreachable` is not
 *  `absent`, and neither one licenses a pulse.
 *
 *  Note the deliberate asymmetry with `Enter.jsx`: a *partial* batch is `live` there,
 *  because eight good reads out of nine still quote a minimum. Here the batch is two reads
 *  and the pill needs both, so the numbers are rendered only when they actually arrived —
 *  `verdict` alone is not enough, and the caller checks them.
 */
export function useArenaLiveness() {
  const pop = usePopulation();
  const address = pop.status === "found" ? pop.address : undefined;

  const batch = useReadContracts({
    allowFailure: true,
    contracts: address
      ? [
          { address, abi: populationReadAbi, functionName: "seasonId" },
          { address, abi: populationReadAbi, functionName: "seasonWindows" },
        ]
      : [],
    // Slower than the entry form's twenty seconds on purpose: nothing here is quoted
    // against a signature, and a season boundary is six days wide.
    query: { enabled: Boolean(address), refetchInterval: 60_000 },
  });

  const report = readReport(batch);

  return {
    verdict: report.verdict,
    ok: report.ok,
    total: report.total,
    address,
    seasonId: batch.data?.[0]?.result,
    seasonWindows: batch.data?.[1]?.result,
  };
}
