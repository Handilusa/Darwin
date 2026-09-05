/**
 *  The resolver that stands behind every `File.ext:N` citation in the repo.
 *
 *  This codebase argues with itself in comments, and it argues by pointing: `web/js/abi.js`
 *  says a signature is trustworthy because `Population.sol:1714` declares it, `cadence.ts`
 *  says the season boundary is `Population.sol:940`, `render.js` prints a contract line
 *  number into a tooltip a judge can hover. There are ~370 of these. Not one of them was
 *  checked by anything until this file existed.
 *
 *  ## Why this is a gate and not a nicety
 *
 *  On 2026-09-05 a single change added ~350 lines to `Population.sol`, and TWENTY of those
 *  citations silently started pointing at the wrong code. `:411-413` was cited as the two
 *  season literals; it had become `stakeBps` and `breedSurplusBps`. The comment that carried
 *  it read *"A season is a contract reading, not a constant"* — a warning against hardcoding
 *  the season, now pointing at the wrong constants. `:1376` was cited as the breeding gate
 *  and had become a bare `*​/`. Every suite stayed green, because nothing was looking.
 *
 *  That is the same failure the `ZeroArena` perturbation found in the test suite: an
 *  assertion that cannot fail is decoration. A citation nothing resolves is decoration that
 *  looks like rigour, which is worse than none — a reader who follows it lands on unrelated
 *  code and concludes the comment is lying about the contract, not about the line number.
 *
 *  ## What it checks, and what it deliberately cannot
 *
 *  It cannot know whether a comment's CLAIM about the code is true. No script can. So it
 *  checks the two things that are decidable, and sorts every citation into a bucket:
 *
 *    RESOLVED    the file exists, the line is in range, and it holds something substantive.
 *    ANCHORED    additionally: an identifier the citing comment names in backticks appears
 *                within `WINDOW` lines of the target. This is the bucket that catches a
 *                SHIFT — `enter` cited at a line that no longer mentions `enter` — which is
 *                the entire failure mode above, and which a range check alone sails past.
 *    DEAD        the file does not exist, or the line is past its end.            → FAILS
 *    FILLER      the line is blank, or a lone `*​/`, `*`, `}`, `)` or `//`. A citation whose
 *                target is punctuation is pointing at where code USED to be.      → FAILS
 *    ADRIFT      anchored check failed: not one identifier from the comment is within `WINDOW`
 *                lines. Where the anchor DOES live is printed, so a shift reads as a
 *                correction. Reported, never failed — see below.
 *    EXTERNAL    a path under node_modules or a dependency's dist/. Nothing local can
 *                resolve it and nothing should try. Reported, never failed.
 *    AMBIGUOUS   a bare basename that matches more than one file, with no same-directory
 *                candidate to break the tie. Reported, never failed: guessing which file was
 *                meant would invent failures, and the honest count is the useful output.
 *
 *  ## Why ADRIFT reports and does not fail
 *
 *  This is the load-bearing decision in the file, and it was made by running the check, not by
 *  arguing about it. DEAD and FILLER are decidable from the target alone — the line is not
 *  there, or it is a lone brace — so they fail the build and have no false positives.
 *
 *  ADRIFT is a heuristic, and there are two ways to be ADRIFT while being CORRECT. A comment
 *  may name something the citation deliberately does not point at (`fixture.js:85` cites the
 *  season literals while naming `Population.initialize`, a hundred lines above them), or the
 *  anchor may be a word the target spells differently. Of the ~120 ADRIFT in this repo, three
 *  were real drift and the rest were shaped like those two. A gate that fails on 117 correct
 *  citations is a gate whose readers learn to skip it, and then it guards nothing — which is
 *  the `ZeroArena` lesson pointed the other way: a check that always fires is as useless as one
 *  that never can.
 *
 *  So the bucket that fails is the bucket that is never wrong, and ADRIFT prints with the line
 *  where the anchor actually lives, for a human to act on. If you want it to fail, fix the ~120
 *  first; do NOT widen `WINDOW` to shrink the list.
 *
 *  ## The window, and why it is not zero
 *
 *  A comment cites the line it means, but "means" is loose by a line or two on purpose: a
 *  citation to a function usually points at its `function` keyword, while the identifier a
 *  comment names may sit in the NatSpec above it or the body below. `WINDOW` is the
 *  tolerance. It is deliberately small — wide enough that honest citations pass, narrow
 *  enough that a 350-line shift cannot. Widening it to make a failure go away is how this
 *  gate becomes decoration; fix the number instead.
 *
 *  ## Self-test
 *
 *  `--self-test` perturbs its own inputs and requires each bucket to fire: a citation past
 *  end of file must come back DEAD, one landing on `*​/` must come back FILLER, and a
 *  correctly anchored citation shifted by 400 lines must come back ADRIFT. A checker whose
 *  own failure modes have never been observed is exactly the thing it exists to prevent.
 *
 *  Run: `npm run cite:check`   ·   `npm run cite:selftest`
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname, relative, basename, sep } from "node:path";

/*//////////////////////////////////////////////////////////////
                            SETTINGS
//////////////////////////////////////////////////////////////*/

/** How far from the cited line an anchoring identifier may sit. See the header. */
const WINDOW = 6;

/** Where citations are looked FOR. */
const SCAN: readonly string[] = [
    "app/src",
    "app/test",
    "web/js",
    "web/test",
    "scripts",
    "contracts/src",
    "contracts/test",
    "docs",
];

/** Root-level files also scanned. */
const SCAN_FILES: readonly string[] = ["CLAUDE.md", "README.md", "STORAGE.md", "SPIKE.md", "web/README.md"];

/** Where a bare basename may be resolved from, in preference order after the citing file's own dir. */
const RESOLVE_ROOTS: readonly string[] = [
    // `contracts` is here for citations written as `test/mocks/Mocks.sol` or `src/Population.sol`
    // — a suffix of the real path starting one level above `src`. Without it those read as
    // "no such file", which is the false failure this list exists to prevent.
    "contracts",
    "contracts/src",
    "contracts/src/interfaces",
    "contracts/src/venues",
    "contracts/test",
    "contracts/test/mocks",
    "contracts/script",
    "scripts",
    "scripts/lib",
    "web",
    "web/js",
    "web/test",
    "app",
    "app/src",
    "app/src/lib",
    "app/src/sections",
    "app/src/motion",
    "app/test",
    "docs",
];

const SCANNED_EXT = /\.(ts|js|mjs|jsx|sol|md)$/;
const CITED_EXT = /\.(sol|ts|js|mjs|jsx)$/;

/** Paths that no local file can or should resolve. */
function isExternal(p: string): boolean {
    return (
        p.includes("node_modules") ||
        p.startsWith("viem/") ||
        p.startsWith("wagmi/") ||
        p.startsWith("@wagmi/") ||
        p.startsWith("dist/") ||
        p.includes("/dist/") ||
        p.startsWith("actions/") ||
        p.startsWith("utils/")
    );
}

/** A line that holds nothing a citation could sensibly be pointing at. */
function isFiller(line: string): boolean {
    const t = line.trim();
    if (t === "") return true;
    return ["*/", "*", "}", ")", "});", "};", ");", "//", "{", "/**", "/*"].includes(t);
}

/*//////////////////////////////////////////////////////////////
                              SHAPES
//////////////////////////////////////////////////////////////*/

type Verdict = "anchored" | "resolved" | "dead" | "filler" | "adrift" | "external" | "ambiguous";

/**
 *  The verdicts that set a non-zero exit code — the whole gate, in one place.
 *
 *  ONE SET, READ BY BOTH `main` AND THE SELF-TEST. Written twice, the self-test would assert
 *  against its own copy and pass while the real gate failed on something else, which is the
 *  decorative-assertion failure this file was written to catch. Do not inline it.
 *
 *  `adrift` is deliberately absent; the header says why at length.
 */
const FAILING: ReadonlySet<Verdict> = new Set<Verdict>(["dead", "filler"]);

type Citation = {
    /** where the citation was written */
    from: string;
    fromLine: number;
    /** what it points at, as written */
    cited: string;
    start: number;
    end: number | null;
    /** resolution */
    target: string | null;
    verdict: Verdict;
    detail: string;
    anchors: string[];
    hit: string | null;
    /** true for a ``(`:N`)`` continuation, whose `cited` was inherited rather than written. */
    bare?: boolean;
};

/*//////////////////////////////////////////////////////////////
                         WALKING THE REPO
//////////////////////////////////////////////////////////////*/

function walk(dir: string, out: string[]): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p, out);
        else if (SCANNED_EXT.test(entry.name)) out.push(p);
    }
}

/*//////////////////////////////////////////////////////////////
                       FINDING THE CITATIONS

    One regex, because a citation is a lexical thing: a filename with a known source
    extension, a colon, a line number, optionally a range. Deliberately NOT restricted to
    comments — `render.js` prints two of these into DOM tooltips, and a stale number is
    just as wrong when a judge reads it off the screen as when a developer reads it in a
    comment. That is precisely the pair a comments-only scanner would have skipped.
//////////////////////////////////////////////////////////////*/

// `@` is in the class because scoped package paths are cited verbatim
// (`node_modules/@somnia-chain/markets-sdk/src/tradeAbi.ts:91`). Omit it and the match starts
// one character in, at `somnia-chain/...`, which resolves to nothing — the checker then reports
// DEAD for a citation a human follows without effort.
const CITE = /([@A-Za-z0-9_./-]+\.(?:sol|ts|js|mjs|jsx)):(\d+)(?:-(\d+))?/g;

/**
 *  A CONTINUATION: ``(`:1408`)`` or ``(`:474-495`)``, inheriting its file from the citation
 *  above it in the same comment block.
 *
 *  BACKTICKS AND PARENTHESES ARE BOTH REQUIRED, and that is the whole safety of this pattern.
 *  A bare `:1408` in running prose is any colon followed by digits — a time, a ratio, a
 *  `mapping` key, `logIndex 0,1,2`. Demanding the exact ``(`:N`)`` shape this repo actually
 *  writes means a false positive needs someone to type a backticked colon-number inside
 *  parentheses on purpose. Loosen it and the checker starts inventing citations.
 */
const BARE_CITE = /\(`:(\d+)(?:-(\d+))?`\)/g;

/** Bare extensions, so a mangled filename fragment can never serve as an anchor. */
const EXTS = new Set(["sol", "ts", "js", "mjs", "jsx", "md"]);

/**
 *  The contiguous comment block containing `idx`, as `[lo, hi]`.
 *
 *  Shared by `anchorsFor` (which harvests identifiers from it) and `collect` (which uses its
 *  boundaries to decide where an inherited filename stops applying). One definition, because
 *  two would let the anchor window and the inheritance window disagree about where a comment
 *  ends — and then a continuation could inherit a file from a block whose words it was never
 *  compared against.
 */
function commentBlock(lines: readonly string[], idx: number): [number, number] {
    const isComment = (s: string): boolean => /^\s*(\/\/|\*|\/\*|#)/.test(s) || s.includes("//");
    let lo = idx;
    let hi = idx;
    while (lo > 0 && isComment(lines[lo - 1] ?? "")) lo--;
    while (hi + 1 < lines.length && isComment(lines[hi + 1] ?? "")) hi++;
    return [lo, hi];
}

/**
 * Identifiers the citing comment names in backticks, as bare names.
 *
 * Scans the CONTIGUOUS comment block around the citation rather than just its line, because
 * these comments wrap: the subject is regularly a line or two above the number that supports
 * it. `Contract.member` yields both halves, `fn()` yields `fn`, so a citation naming
 * `Population.donatePrizePool` anchors on the member even when the file is the contract.
 */
function anchorsFor(lines: readonly string[], idx: number): string[] {
    const [lo, hi] = commentBlock(lines, idx);

    // THE CITATION IS USUALLY BACKTICKED ITSELF. Strip every `File.ext:N` before harvesting
    // anchors, or the citation becomes its own anchor: `Population.sol:445-456` yields the
    // token `sol445456`, which appears nowhere, and the comment is marked ADRIFT for being
    // correctly written. This one line is the difference between 207 false failures and 0.
    const text = lines
        .slice(lo, hi + 1)
        .join("\n")
        .replace(CITE, " ");

    const names = new Set<string>();
    for (const m of text.matchAll(/`([^`\n]{1,80})`/g)) {
        const raw = m[1] ?? "";
        // Strip a call's arguments, then split a dotted path into its parts.
        for (const part of raw.replace(/\([^)]*\)/g, "").split(/[.\s]+/)) {
            const id = part.replace(/[^A-Za-z0-9_$]/g, "");
            // Two chars is noise; a name that is also a filename anchors nothing useful.
            if (id.length > 2 && !/\.(sol|ts|js|mjs|jsx)$/.test(part) && !EXTS.has(id)) names.add(id);
        }
    }
    return [...names];
}

/*//////////////////////////////////////////////////////////////
                           RESOLUTION
//////////////////////////////////////////////////////////////*/

function resolveCited(root: string, from: string, cited: string): { path: string | null; ambiguous: string[] } {
    const isFile = (p: string): boolean => existsSync(p) && statSync(p).isFile();

    // A path with a separator: repo-root-relative first, then relative to the citing file.
    if (cited.includes("/")) {
        const asRoot = resolve(root, cited);
        if (isFile(asRoot)) return { path: asRoot, ambiguous: [] };
        const asRel = resolve(dirname(from), cited);
        if (isFile(asRel)) return { path: asRel, ambiguous: [] };
        // AND a SUFFIX of a real path, which is how these are actually written: `lib/reads.js`
        // means `app/src/lib/reads.js`, `interfaces/IDreamDEX.sol` means the one under
        // `contracts/src/`. Root-relative alone reports "no such file" for a citation that is
        // perfectly followable by a human, which is a false failure and the worse kind.
        const hits: string[] = [];
        for (const r of RESOLVE_ROOTS) {
            const p = resolve(root, r, cited);
            if (isFile(p)) hits.push(p);
        }
        if (hits.length === 1) return { path: hits[0] ?? null, ambiguous: [] };
        if (hits.length > 1) return { path: null, ambiguous: hits };
        return { path: null, ambiguous: [] };
    }

    // A bare basename: the citing file's own directory wins, then the known roots.
    const sameDir = join(dirname(from), cited);
    if (isFile(sameDir)) return { path: sameDir, ambiguous: [] };

    const hits: string[] = [];
    for (const r of RESOLVE_ROOTS) {
        const p = resolve(root, r, cited);
        if (isFile(p)) hits.push(p);
    }
    if (hits.length === 1) return { path: hits[0] ?? null, ambiguous: [] };
    if (hits.length === 0) return { path: null, ambiguous: [] };
    return { path: null, ambiguous: hits };
}

/*//////////////////////////////////////////////////////////////
                            THE CHECK
//////////////////////////////////////////////////////////////*/

const fileCache = new Map<string, string[]>();

function linesOf(path: string): string[] {
    let l = fileCache.get(path);
    if (l === undefined) {
        l = readFileSync(path, "utf8").split(/\r?\n/);
        fileCache.set(path, l);
    }
    return l;
}

/** One citation, judged. `window` is injectable so the self-test can pin it. */
function judge(root: string, c: Citation, window: number): Citation {
    if (isExternal(c.cited)) return { ...c, verdict: "external", detail: "dependency path" };

    const { path, ambiguous } = resolveCited(root, c.from, c.cited);
    if (ambiguous.length > 0) {
        return {
            ...c,
            verdict: "ambiguous",
            detail: `${ambiguous.length} files named ${basename(c.cited)}`,
        };
    }
    if (path === null) return { ...c, verdict: "dead", detail: "no such file" };

    const rel = relative(root, path).split(sep).join("/");
    const lines = linesOf(path);
    const withTarget = { ...c, target: rel };

    // Ranges: both endpoints must exist and the range must run forwards.
    const last = c.end ?? c.start;
    if (c.start < 1 || c.start > lines.length) {
        return { ...withTarget, verdict: "dead", detail: `line ${c.start} of ${lines.length}` };
    }
    if (last > lines.length) {
        return { ...withTarget, verdict: "dead", detail: `range ends at ${last}, file has ${lines.length}` };
    }
    if (c.end !== null && c.end <= c.start) {
        return { ...withTarget, verdict: "dead", detail: `range ${c.start}-${c.end} does not run forwards` };
    }

    // FILLER APPLIES TO A SINGLE-LINE CITATION ONLY, and the distinction is not pedantic.
    // `Genome.sol:5-10` cites an enum: line 10 IS its closing `}`, and a range that ends on
    // its own delimiter is correctly written, not broken. A range is judged by whether it
    // CONTAINS substance; only a bare `:N` landing on punctuation means the code moved out
    // from under it. Flagging correct ranges is how a gate trains its readers to ignore it.
    if (c.end === null) {
        const startLine = lines[c.start - 1] ?? "";
        if (isFiller(startLine)) {
            return {
                ...withTarget,
                verdict: "filler",
                detail: `line ${c.start} is \`${startLine.trim() || "(blank)"}\``,
            };
        }
    } else if (lines.slice(c.start - 1, c.end).every(isFiller)) {
        return { ...withTarget, verdict: "filler", detail: `lines ${c.start}-${c.end} hold no code at all` };
    }

    // Anchoring. No anchors discoverable → RESOLVED, which is honest rather than a pass.
    if (c.anchors.length === 0) return { ...withTarget, verdict: "resolved", detail: "no backticked anchor nearby" };

    const lo = Math.max(0, c.start - 1 - window);
    const hi = Math.min(lines.length, last + window);
    const hay = lines.slice(lo, hi).join("\n");
    for (const a of c.anchors) {
        if (new RegExp(`\\b${a.replace(/[$]/g, "\\$")}\\b`).test(hay)) {
            return { ...withTarget, verdict: "anchored", detail: "", hit: a };
        }
    }
    // No anchor nearby. WHERE ELSE the anchor lives decides how much this is worth saying:
    // if `spawnGenesis` is named and sits 80 lines away, that is a shift with a computable
    // correction. If it appears nowhere, the comment is naming something the file does not
    // contain, which is a different and vaguer problem.
    const elsewhere: string[] = [];
    for (const a of c.anchors) {
        const re = new RegExp(`\\b${a.replace(/[$]/g, "\\$")}\\b`);
        for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i] ?? "")) {
                elsewhere.push(`${a} at :${i + 1}`);
                break;
            }
        }
    }
    return {
        ...withTarget,
        verdict: "adrift",
        detail:
            elsewhere.length > 0
                ? `${c.anchors.slice(0, 4).join(", ")} not within ${window} lines; found ${elsewhere.slice(0, 3).join(", ")}`
                : `none of ${c.anchors.slice(0, 6).join(", ")} appears anywhere in the file`,
    };
}

function collect(root: string): Citation[] {
    const files: string[] = [];
    for (const d of SCAN) walk(resolve(root, d), files);
    for (const f of SCAN_FILES) {
        const p = resolve(root, f);
        if (existsSync(p)) files.push(p);
    }

    const found: Citation[] = [];
    for (const path of files) {
        const lines = linesOf(path);
        const from = path;
        /*
         *  THE SECOND FORM: a bare parenthesised-backtick colon-number that inherits its file
         *  from the citation above it. There are ~99 of these and they drift the same way —
         *  worse, actually, because they are the half a fixer forgets. In `render.js`, the full
         *  citation for the breeding gate was corrected and the continuation on the very next
         *  line, carrying `_breedThreshold`'s number, was not; this branch found it.
         *
         *  The forms are DESCRIBED rather than written out here on purpose: `collect` scans this
         *  file too, so an example would be collected as a citation to whatever file the prose
         *  around it last named, and the checker would report itself broken. A gate that flags
         *  its own documentation teaches its readers to ignore it.
         *
         *  INHERITANCE IS SCOPED TO THE COMMENT BLOCK, NOT THE FILE. A bare `:N` means "the
         *  file we are already talking about", and that subject resets at a blank line or the
         *  end of a comment. Carrying it further would attribute a spec's `:295` to whatever
         *  contract the section above it happened to name — a confident wrong answer, which is
         *  worse than no answer. So `inherited` is cleared by `anchorsFor`'s own block
         *  boundaries: any line that is not part of the same contiguous comment drops it.
         *
         *  AND THEY CARRY NO ANCHORS. The identifiers in the block belong to the full citation's
         *  subject, not to this line's, so anchoring a continuation would compare the wrong
         *  words and manufacture ADRIFT. They are checked for existence only, which is precisely
         *  the check that catches the fixer's forgotten half.
         */
        let inherited: string | null = null;
        let blockAt = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? "";
            const [lo] = commentBlock(lines, i);
            if (lo !== blockAt) {
                inherited = null;
                blockAt = lo;
            }
            for (const m of line.matchAll(CITE)) {
                const cited = m[1] ?? "";
                if (!CITED_EXT.test(cited)) continue;
                inherited = cited;
                found.push({
                    from,
                    fromLine: i + 1,
                    cited,
                    start: Number(m[2]),
                    end: m[3] === undefined ? null : Number(m[3]),
                    target: null,
                    verdict: "resolved",
                    detail: "",
                    anchors: anchorsFor(lines, i),
                    hit: null,
                });
            }
            if (inherited === null) continue;
            for (const m of line.matchAll(BARE_CITE)) {
                found.push({
                    from,
                    fromLine: i + 1,
                    cited: inherited,
                    start: Number(m[1]),
                    end: m[2] === undefined ? null : Number(m[2]),
                    target: null,
                    verdict: "resolved",
                    detail: "",
                    anchors: [],
                    hit: null,
                    bare: true,
                });
            }
        }
    }
    return found;
}

/*//////////////////////////////////////////////////////////////
                            SELF-TEST

    Every failing bucket, watched failing. The three perturbations are the three ways the
    2026-09-05 shift actually manifested, so this is a reproduction of a real defect rather
    than a synthetic exercise.
//////////////////////////////////////////////////////////////*/

function selfTest(root: string): void {
    const checks: { name: string; ok: boolean; got: string; want: string }[] = [];
    // `string`, not `Verdict`: checks 10 and 11 compare booleans about the FAILING set, not
    // verdicts. Narrowing this to `Verdict` is what a tidy-up would do, and it would delete the
    // only two checks that assert which buckets move the exit code.
    const expect = (name: string, got: string, want: string): void =>
        void checks.push({ name, ok: got === want, got, want });

    const base = (over: Partial<Citation>): Citation => ({
        from: resolve(root, "scripts/cite-drift.ts"),
        fromLine: 1,
        cited: "contracts/src/Population.sol",
        start: 1,
        end: null,
        target: null,
        verdict: "resolved",
        detail: "",
        anchors: [],
        hit: null,
        ...over,
    });

    const pop = resolve(root, "contracts/src/Population.sol");
    if (!existsSync(pop)) {
        console.error("cite:selftest needs contracts/src/Population.sol");
        process.exitCode = 1;
        return;
    }
    const popLines = linesOf(pop);

    // 1. Out of range is DEAD.
    expect("a line past end of file is DEAD", judge(root, base({ start: popLines.length + 500 }), WINDOW).verdict, "dead");

    // 2. A missing file is DEAD.
    expect("a nonexistent file is DEAD", judge(root, base({ cited: "contracts/src/NoSuch.sol" }), WINDOW).verdict, "dead");

    // 3. A line holding only `*/` is FILLER. Found from the real file, not assumed.
    const fillerLine = popLines.findIndex((l) => l.trim() === "*/") + 1;
    if (fillerLine === 0) {
        checks.push({ name: "a `*/` line exists to test FILLER against", ok: false, got: "none", want: "one" });
    } else {
        expect("a line holding only `*/` is FILLER", judge(root, base({ start: fillerLine }), WINDOW).verdict, "filler");
    }

    // 4. A correctly anchored citation is ANCHORED — the control. Without this the three
    //    failures above could all be produced by a checker that fails everything.
    const enterLine = popLines.findIndex((l) => l.includes("function enter(")) + 1;
    expect(
        "a citation to `enter` at its own line is ANCHORED",
        judge(root, base({ start: enterLine, anchors: ["enter"] }), WINDOW).verdict,
        "anchored",
    );

    // 5. The same citation, shifted the way the real defect shifted it, is ADRIFT.
    expect(
        "that same citation shifted 400 lines is ADRIFT",
        judge(root, base({ start: Math.max(1, enterLine - 400), anchors: ["enter"] }), WINDOW).verdict,
        "adrift",
    );

    // 6. WINDOW is load-bearing: a citation one line off its anchor passes, and the same
    //    citation fails once the window is closed to zero. This is what proves the tolerance
    //    is doing work rather than being wide enough to accept anything.
    const near = judge(root, base({ start: enterLine + 1, anchors: ["enter"] }), WINDOW).verdict;
    const zero = judge(root, base({ start: enterLine + 1, anchors: ["enter"] }), 0).verdict;
    checks.push({
        name: "the window is load-bearing (passes at WINDOW, fails at 0)",
        ok: near === "anchored" && zero === "adrift",
        got: `${near} at ${WINDOW}, ${zero} at 0`,
        want: "anchored at WINDOW, adrift at 0",
    });

    // 7. An anchor must be matched as a WORD, or `enter` would match `entrant` and every
    //    shift inside a file that mentions a superstring would pass.
    expect(
        "a substring is not an anchor (`ente` does not match `enter`)",
        judge(root, base({ start: enterLine, anchors: ["ente"] }), WINDOW).verdict,
        "adrift",
    );

    // 8. A dependency path is EXTERNAL, never a failure.
    expect(
        "a node_modules path is EXTERNAL",
        judge(root, base({ cited: "viem/utils/errors/getContractError.js" }), WINDOW).verdict,
        "external",
    );

    // 9. A backwards range is DEAD.
    expect("a backwards range is DEAD", judge(root, base({ start: 400, end: 100 }), WINDOW).verdict, "dead");

    /*
     *  10 & 11. WHICH BUCKETS MOVE THE EXIT CODE. Everything above asserts what `judge`
     *  RETURNS; neither of those says which verdicts `main` actually fails on, and that is a
     *  separate line of code that can be got wrong on its own. It nearly was: ADRIFT failed the
     *  gate in the first draft, and 117 correct citations failed with it.
     *
     *  So the two halves are pinned in opposite directions, which is the only shape that can
     *  catch a regression either way. Drop DEAD from the failing set and #10 fails; add ADRIFT
     *  back and #11 fails. Without #11 in particular, "ADRIFT reports and does not fail" is a
     *  claim living only in a comment.
     */
    const fails = (v: Verdict): boolean => FAILING.has(v);
    expect("DEAD and FILLER are what fail the gate", `${fails("dead")} ${fails("filler")}`, "true true");
    expect(
        "ADRIFT, EXTERNAL and AMBIGUOUS do NOT fail the gate",
        `${fails("adrift")} ${fails("external")} ${fails("ambiguous")}`,
        "false false false",
    );

    const failed = checks.filter((c) => !c.ok);
    for (const c of checks) {
        console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.ok ? "" : `  (got ${c.got}, want ${c.want})`}`);
    }
    // #4 (a correct citation must NOT be flagged), the passing half of #6, and #11 (a bucket
    // that must not fail the build). Each one is a check that fires on the healthy state.
    const controls = 3;
    if (failed.length > 0) {
        console.log(`\nFAIL — ${failed.length} of ${checks.length} self-checks failed.`);
        process.exitCode = 1;
        return;
    }
    console.log(
        `\nPASS — ${checks.length} self-checks, ${controls} of them controls: every bucket that fails the ` +
            `gate was watched firing, and every bucket that must not was watched staying quiet.`,
    );
}

/*//////////////////////////////////////////////////////////////
                                RUN
//////////////////////////////////////////////////////////////*/

function main(): void {
    const root = process.cwd();
    if (!existsSync(resolve(root, "contracts/src"))) {
        console.error(`cite:check must run from the darwin/ root — no contracts/src under ${root}`);
        process.exitCode = 1;
        return;
    }

    if (process.argv.includes("--self-test")) {
        selfTest(root);
        return;
    }

    const judged = collect(root).map((c) => judge(root, c, WINDOW));
    const tally = (v: Verdict): number => judged.filter((c) => c.verdict === v).length;
    const show = (c: Citation): string =>
        `${relative(root, c.from).split(sep).join("/")}:${c.fromLine} → ${c.cited}:${c.start}${c.end === null ? "" : `-${c.end}`}`;

    console.log(`cite:check — ${judged.length} line citations across the repo\n`);

    // Per cited FILE, because that is the axis a change moves: one edit to Population.sol
    // shifts every citation to it at once, and a per-file count makes that visible.
    const byTarget = new Map<string, Citation[]>();
    for (const c of judged) {
        const k = c.target ?? c.cited;
        const list = byTarget.get(k);
        if (list === undefined) byTarget.set(k, [c]);
        else list.push(c);
    }
    for (const [target, list] of [...byTarget].sort((a, b) => b[1].length - a[1].length)) {
        const t = (v: Verdict): number => list.filter((c) => c.verdict === v).length;
        const bad = list.filter((c) => FAILING.has(c.verdict)).length;
        const drift = t("adrift");
        console.log(
            `  ${target.padEnd(34)} ${String(list.length).padStart(3)} cited   ` +
                `${t("anchored")} anchored  ${t("resolved")} unanchored  ` +
                `${t("external")} external  ${t("ambiguous")} ambiguous` +
                (drift > 0 ? `   ${drift} adrift` : "") +
                (bad > 0 ? `   ${bad} BROKEN` : ""),
        );
    }
    console.log("");

    // WHAT FAILS THE GATE AND WHAT ONLY REPORTS. This split is the most consequential
    // decision in the file, so the reasoning is here rather than in a commit message.
    //
    // DEAD and FILLER are decidable from the target file alone: the line does not exist, or
    // it holds nothing but punctuation. No judgement, no tolerance, no false positives —
    // those fail the build.
    //
    // ADRIFT is a heuristic and cannot fail it. The check is "a backticked identifier from
    // the comment appears within WINDOW lines", and there are two ways to be ADRIFT while
    // being CORRECT: the comment names something the citation deliberately does not point at
    // (`fixture.js:85` cites the season literals while naming `Population.initialize`, a
    // hundred lines off), or the anchor is a word the target spells differently. A gate that
    // fails on those trains its readers to pass `--force`, and then it is guarding nothing —
    // the same way a decorative assertion is worse than no assertion.
    //
    // So ADRIFT prints, with the line where the anchor actually lives, and a human decides.
    // The bucket that fails is the bucket that is never wrong.
    const broken = judged.filter((c) => FAILING.has(c.verdict));
    const adrift = judged.filter((c) => c.verdict === "adrift");
    const ambiguous = judged.filter((c) => c.verdict === "ambiguous");

    if (ambiguous.length > 0) {
        console.log(`AMBIGUOUS (${ambiguous.length}) — a bare basename matching more than one file, not checked:`);
        for (const c of ambiguous) console.log(`  ${show(c)}   ${c.detail}`);
        console.log("");
    }

    if (adrift.length > 0) {
        console.log(
            `ADRIFT (${adrift.length}) — resolves to real code, but no identifier the comment names is within ` +
                `${WINDOW} lines. Reported, NOT failed: review by hand.`,
        );
        for (const c of adrift) {
            console.log(`  ${show(c)}`);
            console.log(`    ${c.detail}`);
        }
        console.log("");
    }

    if (broken.length > 0) {
        console.log(`BROKEN (${broken.length}) — the cited line does not exist or holds no code:`);
        for (const c of broken) {
            console.log(`  ${c.verdict.toUpperCase()}  ${show(c)}`);
            console.log(`    ${c.detail}`);
        }
        console.log("");
    }

    const good = tally("anchored") + tally("resolved");
    const census =
        `${good}/${judged.length} resolve (${tally("anchored")} anchored to a named identifier, ` +
        `${tally("resolved")} unanchored), ${adrift.length} adrift, ${tally("external")} external, ` +
        `${ambiguous.length} ambiguous`;
    if (broken.length === 0) {
        console.log(`PASS — no citation points at a line that does not exist. ${census}.`);
    } else {
        console.log(`FAIL — ${broken.length} citations point at nothing. ${census}.`);
        process.exitCode = 1;
    }
}

main();
