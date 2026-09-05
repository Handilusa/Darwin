/**
 *  The compiler that stands behind the three hand-written ABI files.
 *
 *  `scripts/lib/darwin.ts`, `web/js/abi.js` and `app/src/lib/abi.js` each carry hand-written
 *  `parseAbi` fragments rather than imports from `contracts/out/`. That is a deliberate and
 *  well-argued choice — the operational scripts must run on a fresh clone that never compiled,
 *  and `web/` must run with no install and no toolchain — but both mirror files say the same
 *  thing in their own headers: *"There is no compiler standing behind this file."* This is that
 *  compiler. It is the only thing standing between three hand-transcribed copies and a silent
 *  divergence that would surface as a decoded-garbage read on demo day.
 *
 *  UNLIKE the rest of `scripts/`, this one REQUIRES `contracts/out/`. That is not a violation
 *  of the fresh-clone rule: this is a development gate, not life support. Nothing a live
 *  population depends on imports it. If the artifacts are missing it says so and tells you
 *  which command to run, rather than pretending to pass.
 *
 *  This is also why `npm run gate` runs `test` BEFORE `abi:check` even though `abi:check` is by
 *  far the cheaper of the two: `forge test` compiles, so putting it first means this script
 *  compares against artifacts the same invocation just built. Reversed, a green `abi:check`
 *  could be vouching for a `contracts/out/` that predates the edit under test — the exact
 *  failure mode the script exists to prevent, reproduced inside the gate meant to catch it.
 *
 *  ## What it checks
 *
 *  For every fragment in every `export const … = parseAbi([…])` block, it asks whether the
 *  compiled artifacts agree, and sorts the answer into four buckets:
 *
 *    MATCH       the signature exists, identically, in the artifact this export is bound to.
 *    MISMATCH    the NAME exists in a project artifact but no signature agrees.  → FAILS
 *    MISBOUND    a signature agrees, but only in some OTHER contract than the expected one.
 *                This is the bucket that catches transcribing `Prophet`'s `snapshot()` into
 *                the `Population` ABI — a drift that a flat name-and-signature comparator
 *                cannot see, because both signatures are individually real.  → FAILS
 *    UNGUARDED   the name is in no project artifact at all. An external surface (tUSDC,
 *                DreamDEX, AgentRequester) that no local compiler can vouch for. Reported,
 *                never failed — but listed every run, because the honest size of the
 *                unguarded surface is itself a number worth watching.
 *
 *  ## Two deliberate decisions, so nobody has to guess later
 *
 *  `view` and `pure` are treated as EQUIVALENT. Both are read-only; a mirror that says one
 *  where the contract says the other cannot produce a wrong call. `payable` and `nonpayable`
 *  are NOT normalised, because that difference reverts: `enter` being `payable` is
 *  load-bearing, and a mirror that dropped it would fail every entry with value attached.
 *
 *  Only artifacts whose source lives under `contracts/src/` are loaded. This is what keeps
 *  `forge-std`'s `Vm.snapshot()` out of the index — it collides with `Population.snapshot()`
 *  by name and produces three false positives in a comparator that globs all of
 *  `contracts/out/`. Restricting by source directory excludes it by construction rather than
 *  by a special case someone can later delete.
 *
 *  Run: `npm run abi:check`
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseAbi } from "viem";

/*//////////////////////////////////////////////////////////////
                              SHAPES
//////////////////////////////////////////////////////////////*/

type AbiParam = {
    type: string;
    name?: string;
    indexed?: boolean;
    components?: readonly AbiParam[];
};

type AbiEntry = {
    type: string;
    name?: string;
    inputs?: readonly AbiParam[];
    outputs?: readonly AbiParam[];
    stateMutability?: string;
};

type Block = { exportName: string; fragments: string[] };

/*//////////////////////////////////////////////////////////////
                            WHAT IS MIRRORED

    Which contract each hand-written ABI export is a mirror OF. An export missing from this
    table gets no MISBOUND check — it is an external surface (tUSDC's faucet, DreamDEX's
    markets module) that no artifact under contracts/src/ can vouch for either way.

    Several exports list more than one candidate on purpose: `priceSourceAbi` describes a
    surface satisfied by both the interface and its only implementation, and `venueAbi` is
    the seam two adapters implement. Matching any one of them is correct.
//////////////////////////////////////////////////////////////*/

const MIRRORS: readonly string[] = [
    "scripts/lib/darwin.ts",
    "web/js/abi.js",
    "app/src/lib/abi.js",
];

const EXPECTED = new Map<string, readonly string[]>([
    ["populationAbi", ["Population"]],
    ["populationReadAbi", ["Population"]],
    ["populationWriteAbi", ["Population"]],
    ["populationErrorsAbi", ["Population"]],
    ["prophetAbi", ["Prophet"]],
    ["priceSourceAbi", ["PushedPriceSource", "IPriceSource"]],
    ["selectionEngineAbi", ["SelectionEngine"]],
    ["venueAbi", ["IArenaVenue", "DreamDEXVenue", "DirectDuelVenue"]],
]);

/*//////////////////////////////////////////////////////////////
                          CANONICAL SIGNATURES
//////////////////////////////////////////////////////////////*/

/** Structural type string, parameter names discarded. Tuples recurse; array suffixes survive. */
function canonType(p: AbiParam): string {
    if (p.type.startsWith("tuple")) {
        const suffix = p.type.slice("tuple".length);
        const inner = (p.components ?? []).map(canonType).join(",");
        return `(${inner})${suffix}`;
    }
    return p.type;
}

/** One comparable string per entry, or null for constructor/fallback/receive. */
function canonSig(e: AbiEntry): string | null {
    const name = e.name;
    if (name === undefined || name === "") return null;
    const ins = (e.inputs ?? []).map(canonType).join(",");

    if (e.type === "function") {
        const outs = (e.outputs ?? []).map(canonType).join(",");
        const raw = e.stateMutability ?? "nonpayable";
        const sm = raw === "pure" ? "view" : raw;
        return `function ${name}(${ins}) ${sm} returns (${outs})`;
    }
    if (e.type === "event") {
        const parts = (e.inputs ?? []).map((p) => `${canonType(p)}${p.indexed === true ? " indexed" : ""}`);
        return `event ${name}(${parts.join(",")})`;
    }
    if (e.type === "error") {
        return `error ${name}(${ins})`;
    }
    return null;
}

/*//////////////////////////////////////////////////////////////
                        EXTRACTING THE FRAGMENTS

    A scanner rather than a regex, because parseAbi blocks contain BOTH comments and string
    literals, and each can hold characters the other would misread — an apostrophe inside a
    `//` comment looks exactly like the start of a string to a naive balancer, and a fragment
    like "…returns ((uint256 id,…)[])" is full of brackets. So: skip strings, skip comments,
    balance everything else.
//////////////////////////////////////////////////////////////*/

function extractBlocks(src: string, where: string): Block[] {
    const blocks: Block[] = [];
    const opener = /export\s+const\s+([A-Za-z0-9_]+)\s*=\s*parseAbi\s*\(/g;

    let m: RegExpExecArray | null;
    while ((m = opener.exec(src)) !== null) {
        const exportName = m[1];
        if (exportName === undefined) continue;

        const start = opener.lastIndex - 1; // the '(' parseAbi opened
        let depth = 0;
        let end = -1;

        for (let j = start; j < src.length; j++) {
            const ch = src[j] ?? "";
            const next = src[j + 1] ?? "";

            if (ch === "/" && next === "/") {
                while (j < src.length && src[j] !== "\n") j++;
                continue;
            }
            if (ch === "/" && next === "*") {
                j += 2;
                while (j < src.length && !(src[j] === "*" && src[j + 1] === "/")) j++;
                j++; // land on '/', loop increments past it
                continue;
            }
            if (ch === '"' || ch === "'" || ch === "`") {
                const quote = ch;
                j++;
                while (j < src.length) {
                    const c = src[j] ?? "";
                    if (c === "\\") {
                        j += 2;
                        continue;
                    }
                    if (c === quote) break;
                    j++;
                }
                continue;
            }
            if (ch === "(" || ch === "[") depth++;
            else if (ch === ")" || ch === "]") {
                depth--;
                if (depth === 0) {
                    end = j;
                    break;
                }
            }
        }

        if (end < 0) throw new Error(`${where}: unbalanced parseAbi( for ${exportName}`);

        const body = src.slice(start, end + 1);
        const fragments: string[] = [];
        // Fragments are plain double-quoted literals. A leading keyword is what distinguishes a
        // fragment from any other string that happens to sit in the block.
        for (const lit of body.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
            const text = lit[1];
            if (text === undefined) continue;
            if (/^\s*(function|event|error|struct|constructor|fallback|receive)\b/.test(text)) {
                fragments.push(text);
            }
        }
        blocks.push({ exportName, fragments });
    }
    return blocks;
}

/*//////////////////////////////////////////////////////////////
                          THE ARTIFACT INDEX
//////////////////////////////////////////////////////////////*/

/** Every .sol basename under contracts/src, recursively. */
function projectSources(srcDir: string): Set<string> {
    const names = new Set<string>();
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.endsWith(".sol")) names.add(entry.name);
        }
    };
    walk(srcDir);
    return names;
}

/** contractName → set of canonical signatures it declares. */
function buildIndex(outDir: string, sources: Set<string>): Map<string, Set<string>> {
    const index = new Map<string, Set<string>>();

    for (const solFile of sources) {
        const dir = join(outDir, solFile);
        if (!existsSync(dir)) continue;

        for (const file of readdirSync(dir)) {
            if (!file.endsWith(".json")) continue;
            const contract = file.slice(0, -".json".length);

            const parsed: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
            if (typeof parsed !== "object" || parsed === null) continue;
            const abi = (parsed as { abi?: unknown }).abi;
            if (!Array.isArray(abi)) continue;

            let sigs = index.get(contract);
            if (sigs === undefined) {
                sigs = new Set<string>();
                index.set(contract, sigs);
            }
            for (const raw of abi) {
                const sig = canonSig(raw as AbiEntry);
                if (sig !== null) sigs.add(sig);
            }
        }
    }
    return index;
}

/*//////////////////////////////////////////////////////////////
                                RUN
//////////////////////////////////////////////////////////////*/

type Verdict = "match" | "mismatch" | "misbound" | "unguarded";

type Finding = {
    file: string;
    exportName: string;
    name: string;
    fragment: string;
    canonical: string;
    verdict: Verdict;
    matchedIn: string[];
    nameSeenIn: string[];
};

/**
 * The hand-written literal a parsed entry came from, found by NAME rather than by position.
 *
 * Position would be the obvious thing and it is wrong: `parseAbi` emits nothing for a `struct`
 * fragment, so in any block that declares one, entry i stops corresponding to fragment i and
 * every reported literal after it is off by the number of structs above. Reporting the wrong
 * source line is worst precisely in the case that matters — a real drift, misattributed.
 */
function sourceFragment(fragments: readonly string[], entry: AbiEntry, fallback: string): string {
    const name = entry.name ?? "";
    if (name === "") return fallback;
    const hits = fragments.filter((f) => new RegExp(`\\b${name}\\s*\\(`).test(f));
    return hits.length === 1 ? (hits[0] ?? fallback) : fallback;
}

function main(): void {
    const root = process.cwd();
    const srcDir = resolve(root, "contracts/src");
    const outDir = resolve(root, "contracts/out");

    if (!existsSync(srcDir)) {
        console.error(`abi:check must run from the darwin/ root — no contracts/src under ${root}`);
        process.exitCode = 1;
        return;
    }
    if (!existsSync(outDir)) {
        console.error(
            "abi:check needs compiled artifacts and contracts/out is absent.\n" +
                "  Run: npm run build     (forge build --root contracts)\n" +
                "This gate compares hand-written ABI fragments against the compiler's own output,\n" +
                "so with nothing to compare against it fails rather than reporting a false pass.",
        );
        process.exitCode = 1;
        return;
    }

    const sources = projectSources(srcDir);
    const index = buildIndex(outDir, sources);

    if (index.size === 0) {
        console.error(`abi:check found no usable artifacts under ${outDir} — try: npm run build`);
        process.exitCode = 1;
        return;
    }

    // name → contracts declaring anything by that name, for the MISMATCH-vs-UNGUARDED split.
    const byName = new Map<string, Set<string>>();
    for (const [contract, sigs] of index) {
        for (const sig of sigs) {
            const m = /^(?:function|event|error) ([A-Za-z0-9_$]+)\(/.exec(sig);
            const name = m?.[1];
            if (name === undefined) continue;
            let set = byName.get(name);
            if (set === undefined) {
                set = new Set<string>();
                byName.set(name, set);
            }
            set.add(contract);
        }
    }

    const findings: Finding[] = [];
    let missingMirror = false;

    for (const rel of MIRRORS) {
        const path = resolve(root, rel);
        if (!existsSync(path)) {
            console.error(`  MISSING MIRROR  ${rel}`);
            missingMirror = true;
            continue;
        }
        const blocks = extractBlocks(readFileSync(path, "utf8"), rel);

        for (const block of blocks) {
            if (block.fragments.length === 0) continue;

            // The real parseAbi does the semantics. Struct fragments in the same block resolve
            // here, which is why the whole block goes through in one call rather than one at a time.
            let entries: readonly AbiEntry[];
            try {
                entries = parseAbi(block.fragments as readonly string[]) as readonly AbiEntry[];
            } catch (err) {
                console.error(
                    `  UNPARSEABLE  ${rel} ${block.exportName}: ${err instanceof Error ? err.message : String(err)}`,
                );
                process.exitCode = 1;
                continue;
            }

            const expected = EXPECTED.get(block.exportName);

            for (const entry of entries) {
                const canonical = canonSig(entry);
                if (canonical === null) continue; // structs and constructors carry no callable signature

                const name = entry.name ?? "";
                const matchedIn = [...index].filter(([, sigs]) => sigs.has(canonical)).map(([c]) => c);
                const nameSeenIn = [...(byName.get(name) ?? [])];

                let verdict: Verdict;
                if (matchedIn.length === 0) {
                    verdict = nameSeenIn.length > 0 ? "mismatch" : "unguarded";
                } else if (expected !== undefined && !matchedIn.some((c) => expected.includes(c))) {
                    verdict = "misbound";
                } else {
                    verdict = "match";
                }

                findings.push({
                    file: rel,
                    exportName: block.exportName,
                    name,
                    fragment: sourceFragment(block.fragments, entry, canonical),
                    canonical,
                    verdict,
                    matchedIn,
                    nameSeenIn,
                });
            }
        }
    }

    /* ------------------------------- report ------------------------------- */

    const tally = (fs: Finding[], v: Verdict): number => fs.filter((f) => f.verdict === v).length;

    console.log(`abi:check — ${findings.length} hand-written signatures against ${index.size} compiled contracts\n`);

    for (const rel of MIRRORS) {
        const mine = findings.filter((f) => f.file === rel);
        if (mine.length === 0) continue;
        console.log(rel);
        const exportNames = [...new Set(mine.map((f) => f.exportName))];
        for (const exportName of exportNames) {
            const fs = mine.filter((f) => f.exportName === exportName);
            const bound = EXPECTED.get(exportName)?.join("|") ?? "(external)";
            console.log(
                `  ${exportName.padEnd(22)} → ${bound.padEnd(38)} ` +
                    `${String(fs.length).padStart(3)} sigs   ` +
                    `${tally(fs, "match")} match  ${tally(fs, "mismatch")} mismatch  ` +
                    `${tally(fs, "misbound")} misbound  ${tally(fs, "unguarded")} unguarded`,
            );
        }
        console.log("");
    }

    const bad = findings.filter((f) => f.verdict === "mismatch" || f.verdict === "misbound");
    const unguarded = findings.filter((f) => f.verdict === "unguarded");

    if (unguarded.length > 0) {
        console.log(`UNGUARDED (${unguarded.length}) — external surfaces no local artifact can vouch for:`);
        for (const f of unguarded) console.log(`  ${f.file}  ${f.exportName}  ${f.canonical}`);
        console.log("");
    }

    if (bad.length > 0) {
        console.log(`DRIFT (${bad.length}):`);
        for (const f of bad) {
            console.log(`  ${f.verdict.toUpperCase()}  ${f.file}  ${f.exportName}`);
            console.log(`    hand-written: ${f.fragment}`);
            console.log(`    canonical:    ${f.canonical}`);
            if (f.verdict === "misbound") {
                console.log(
                    `    matches ${f.matchedIn.join(", ")} but this export mirrors ` +
                        `${EXPECTED.get(f.exportName)?.join("|") ?? "?"}`,
                );
            } else {
                console.log(`    name declared by ${f.nameSeenIn.join(", ")}, but with a different signature:`);
                for (const contract of f.nameSeenIn) {
                    for (const sig of index.get(contract) ?? []) {
                        if (new RegExp(`\\b${f.name}\\(`).test(sig)) console.log(`      ${contract}: ${sig}`);
                    }
                }
            }
        }
        console.log("");
    }

    const total = findings.length;
    const matched = tally(findings, "match");
    if (bad.length === 0 && !missingMirror && process.exitCode !== 1) {
        console.log(`PASS — ${matched}/${total} guarded signatures agree with the compiler, ${unguarded.length} unguarded.`);
    } else {
        console.log(`FAIL — ${bad.length} drifted, ${matched}/${total} agree.`);
        process.exitCode = 1;
    }
}

main();
