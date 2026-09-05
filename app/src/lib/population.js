/**
 *  Which Population is this page talking to?
 *
 *  The honest answer today is "none" — `POPULATION` in `web/config.js` is `""` until the
 *  Season 0 deploy, and the deployment manifest does not exist yet. That is not a bug to
 *  paper over: an entry form that renders a Connect button and a genome box while there
 *  is no contract behind it would take a judge's signature and hand back a revert. So the
 *  address is resolved first and the entry surface is gated on it.
 *
 *  Precedence, most specific first — the same order `web/config.js:settings()` uses, so
 *  the landing and the arena can never disagree about which arena they are showing:
 *
 *      1. ?population=0x…      an explicit override in the URL
 *      2. localStorage         whatever the visitor last pointed the arena at
 *      3. the manifest         contracts/deployments/50312.json, written by Deploy.s.sol
 *      4. config.js            the compiled-in constant
 *
 *  The manifest sits at 3 rather than 1 deliberately: it is the source of truth for a
 *  normal visit, but a judge debugging a second arena needs the URL to win.
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
