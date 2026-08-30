/**
 *  The one place a version of viem is named.
 *
 *  Pinned to 2.56.0 because that is what `node_modules/viem` actually resolved to for the
 *  operational scripts (`package.json` asks for `^2.21.0`; npm gave 2.56.0). The browser and
 *  the scripts therefore encode calldata with the same code, which matters: if a snapshot
 *  decodes here it decodes in `monitor.ts`, and a disagreement between the page and the
 *  terminal cannot be a version skew.
 *
 *  Re-exported through this shim rather than imported directly in a dozen files so the
 *  dependency is auditable in one grep and swappable in one line — including swapping it for
 *  a vendored copy if a judge ever has to run this offline. There is no other third-party
 *  code on the page.
 */
export * from "https://esm.sh/viem@2.56.0";
