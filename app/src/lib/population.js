/**
 *  Which Population is this page talking to?
 *
 *  Since 2026-09-08 the answer is normally Season 0's proxy: `POPULATION` in `web/config.js`
 *  carries it and the deployment manifest agrees. The gating below is kept anyway, because
 *  the address is still resolved at runtime from four sources and every one of them can come
 *  up empty — a judge on a fork with no manifest, a cleared `localStorage`, a `?population=`
 *  typo. An entry form that rendered a Connect button and a genome box with no contract
 *  behind it would take a signature and hand back a revert, so the entry surface stays gated
 *  on a resolved address rather than on the constant being non-empty.
 *
 *  Precedence, most specific first — the same order `web/config.js:settings()` uses, so
 *  the landing and the arena can never disagree about which arena they are showing:
 *
 *      1. ?population=0x…      an explicit override in the URL
 *      2. localStorage         whatever the visitor last pointed the arena at
 *      3. config.js            the constant this repo ships, resolved synchronously
 *      4. the manifest         contracts/deployments/50312.json, written by Deploy.s.sol
 *
 *  THIS LIST USED TO SAY THE MANIFEST WAS 3 AND config.js 4, AND THAT WAS BACKWARDS — read
 *  the code below: `settings()` already consults `POPULATION`, and the fetch only runs when
 *  it returned nothing. `web/js/main.js:479` calls the manifest its "last resort" for the
 *  same reason. The order is deliberate — the fetch is async and 404s under `npx serve web`,
 *  where the manifest is outside the served root — but it puts the burden on a hand-edited
 *  constant: **a redeploy that rewrites the manifest and not `web/config.js` leaves both
 *  surfaces pointing at the dead population.** Change them in the same commit.
 */

import { useEffect, useState } from "react";

import { MANIFEST_PATH, isAddress, settings } from "../../../web/config.js";

/**
 *  Where the manifest is served from.
 *
 *  `MANIFEST_PATH` is `../contracts/deployments/50312.json`, written relative to a page
 *  living in `web/`. This app is served from `/`, so the same file is one absolute path,
 *  and `vite.config.js` serves `/contracts/deployments/` off disk for both surfaces —
 *  which also makes the arena's own relative fetch resolve under the dev server.
 */
const MANIFEST_URL = `/${MANIFEST_PATH.replace(/^(\.\.\/)+/, "")}`;

/** The shape `Deploy.s.sol:_writeManifest` produces. Only `population` is required here. */
async function fromManifest(signal) {
  const res = await fetch(MANIFEST_URL, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const json = await res.json();
  const addr = json?.population ?? json?.Population ?? "";
  if (!isAddress(addr)) throw new Error("manifest has no population address");
  return addr;
}

/**
 *  Resolution states, named for what the UI must say in each:
 *
 *    "loading"    — asking for the manifest; show nothing conclusive
 *    "found"      — there is an arena; the entry flow is live
 *    "undeployed" — no arena yet; say so plainly and point at ?demo=1
 */
export function usePopulation() {
  const [state, setState] = useState(() => {
    const s = settings();
    return s.population
      ? { status: "found", address: s.population, source: s.source, badQuery: s.badQuery }
      : { status: "loading", address: "", source: "", badQuery: s.badQuery };
  });

  useEffect(() => {
    if (state.status !== "loading") return;
    const ac = new AbortController();
    fromManifest(ac.signal)
      .then((address) => setState((p) => ({ ...p, status: "found", address, source: "manifest" })))
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setState((p) => ({ ...p, status: "undeployed", address: "", source: "" }));
      });
    return () => ac.abort();
    // Runs once: `status` only ever leaves "loading" and never returns to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
