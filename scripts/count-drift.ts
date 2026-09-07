/**
 *  The compiler that stands behind every claim about how many Solidity tests there are.
 *
 *  ## Why this is a gate and not a nicety
 *
 *  The suite count is written down in five live places — `README.md` twice, `CLAUDE.md` twice,
 *  and the landing page's own "Falsify" column in `app/src/sections/Footer.jsx`. It has been
 *  hand-corrected twice: 56 → 100 → 124 → 132. Both times the sweep missed sites. As of the
 *  audit that produced this file, `README.md` still said **100** in two places while the file
 *  held **132** declarations — stale by thirty-two, on the surface a judge opens first, in the
 *  exact section headed *"Verifying the claims yourself"*.
 *
 *  A third hand-edit would have rotted the same way, because the failure was never arithmetic.
 *  It was that **nothing derived the number and nothing compared it**. So this does both: it
 *  counts the declarations in `contracts/test/Darwin.t.sol` and fails the build on any live
 *  claim that disagrees. The number is never written here; it is read every run.
 *
 *  That is the same argument `scripts/cite-drift.ts` makes about line citations and
 *  `scripts/abi-drift.ts` makes about hand-transcribed ABI fragments: a claim nothing checks is
 *  decoration that looks like rigour, and a stale one in a "verify this yourself" block is worse
 *  than no claim at all — a reader who runs the command, counts 132, and reads 100 concludes the
 *  project is lying about its tests rather than about its README.
 *
 *  ## Where the authoritative number comes from
 *
 *  `function test` declarations at the start of a line in `contracts/test/Darwin.t.sol`.
 *
 *  That is the whole basis, and it is only equal to the suite count because of three facts that
 *  hold in this repo and are checked rather than assumed:
 *
 *    - There is exactly **one** `.t.sol` file. `contracts/test/mocks/` declares no tests.
 *    - There are **zero** `testFuzz`/`invariant` declarations, so one declaration is one case.
 *      (A fuzzed test is still one suite entry, so this fact is about clarity, not arithmetic.)
 *    - Every declaration sits at the start of its line with `function` as the first token, so
 *      anchoring the pattern at line start excludes prose and string literals by construction
 *      rather than by a heuristic that can be wrong. `DECLARATION` is anchored for that reason;
 *      un-anchoring it to "be safe" would start counting this file's own docblock.
 *
 *  The count is NOT taken from `forge test` output. That would be more authoritative and it
 *  would also make this gate need a compiler, a full suite run, and ~2 minutes — at which point
 *  it stops being the cheap static check that runs before the expensive ones. `CLAUDE.md` states
 *  the equivalence and the three facts above are what make it true; a change that breaks any of
 *  them breaks a self-test check, not just the count.
 *
 *  ## What a claim looks like, and the four buckets
 *
 *  Claims are found by sweeping the repo, not by consulting a list of known sites. The choice
 *  matters and it goes the other way from what you would guess:
 *
 *  A FILE+PATTERN LIST would be exactly as brittle as the thing being fixed. Adding a sixth
 *  claim site — a pitch deck, a new landing section, a docstring in a script — would be silently
 *  unguarded, and the person adding it is by definition not thinking about this file. The list
 *  would have to be maintained by the same discipline whose absence caused the bug.
 *
 *  So: a repo-wide sweep with an EXCLUSION list. New claims are guarded by default and the
 *  maintenance burden falls on the exclusions, which are stable directories rather than moving
 *  line numbers. Every claim gets a bucket:
 *
 *    AGREES      the number equals the derived count.
 *    STALE       it does not.                                                       → FAILS
 *    HISTORICAL  written as a ratio (`56/56`), which in this repo always means a measurement
 *                made on a day rather than a current state. Reported, never failed — see below.
 *    UNCHECKED   in an excluded path. Not collected at all; counted only in the census, so the
 *                size of the unguarded surface is visible instead of implied.
 *
 *  ## The two things this must never flag, and how it is prevented twice over
 *
 *  This is the hard half of the problem. The repo deliberately preserves dated figures, and
 *  overwriting one FABRICATES A MEASUREMENT. The load-bearing example is `CLAUDE.md`'s *"Tests:
 *  56/56 under both"* from the 2026-08-29 `paris` → `shanghai` migration. Nobody has run today's
 *  132 tests under `paris`; the entire claim is that *one identical suite* passed under both EVM
 *  versions. A 132 there would turn evidence into a false statement. `docs/SESSION_CHECKPOINT.md`
 *  makes this point at length and it is the reason the figure was left alone the last two sweeps.
 *
 *  A gate that failed on those would be turned off within a day, and then it would guard nothing
 *  — the same trap `cite-drift.ts` avoided by refusing to fail on ADRIFT. So there are two
 *  independent defences, and each is sufficient on its own:
 *
 *    1. **Shape.** A ratio is bucketed HISTORICAL wherever it appears, including in files that
 *       are otherwise fully checked. `CLAUDE.md` is NOT excluded, so this defence is the only
 *       thing standing between the gate and that line — it is doing real work, not decoration.
 *    2. **Location.** `docs/` is excluded wholesale. Both checkpoints and the design specs are
 *       an append-only ledger of what was true on which day; nearly every number in them is a
 *       dated measurement, and re-stamping them would destroy the record this project's honesty
 *       rests on. Nothing in `docs/` is a claim a judge reads as current.
 *
 *  Both are asserted by self-test controls, in both directions.
 *
 *  ## Why this file excludes itself
 *
 *  `scripts/count-drift.ts` is the one file whose numeric claims are not checked, because its
 *  self-test fixtures are deliberately-wrong numbers written as literals. Without the exclusion
 *  the scanner reports its own test data as drift and its own gate never passes. `cite-drift.ts`
 *  solved the same reflexivity by describing its patterns instead of writing them; excluding one
 *  file is the smaller lie, and the hole it leaves is documented rather than quiet: a stale
 *  suite-count claim written into THIS file would be missed. Do not put one here.
 *
 *  Run: `npm run count:check`   ·   `npm run count:selftest`
 */
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/*//////////////////////////////////////////////////////////////
                            SETTINGS
//////////////////////////////////////////////////////////////*/

/** The single source of truth for the number. Everything else in the repo is a copy of it. */
const SUITE_FILE = "contracts/test/Darwin.t.sol";

/**
 *  Directory names never descended into, at any depth.
 *
 *  `docs` is the consequential one and the header argues it at length: it is a dated ledger, not
 *  a set of current claims. The rest are build output, vendored dependencies and run artifacts —
 *  `app/dist` in particular carries a BUILT COPY of the footer's string (it says 98 at the time
 *  of writing), and failing on it would demand a rebuild to fix a source-code gate. `app/dist`
 *  going stale is a real hazard with its own history, but it is `npm run build`'s problem, not
 *  this one's; conflating them would make every count fix a two-step ritual.
 */
const SKIP_DIRS: ReadonlySet<string> = new Set([
    "node_modules",
    "dist",
    "out",
    "cache",
    "lib",
    "vendor",
    "broadcast",
    "coverage",
    "docs",
]);

/** Files never scanned, repo-relative with forward slashes. See "Why this file excludes itself". */
const SKIP_FILES: ReadonlySet<string> = new Set(["scripts/count-drift.ts"]);

const SCANNED_EXT = /\.(ts|js|mjs|jsx|sol|md|json)$/;

/*//////////////////////////////////////////////////////////////
                       DERIVING THE COUNT

    Anchored at line start with `function` as the first token, which is what makes this a
    declaration count rather than an occurrence count. Every one of the declarations in
    Darwin.t.sol is written that way; a comment or a string mentioning `function test` is
    not, because it is preceded by `//`, `*`, `"` or prose.
//////////////////////////////////////////////////////////////*/

/** A `function test…` declaration at the start of a line. */
const DECLARATION = /^[ \t]*function test/gm;

/** A fuzzed or invariant declaration — must be zero for one declaration to mean one case. */
const FUZZED = /^[ \t]*function (?:testFuzz|invariant)/gm;

/** Operates on TEXT, not on a path, so the self-test can perturb the input and watch the count move. */
function countDeclarations(src: string): number {
    return [...src.matchAll(DECLARATION)].length;
}

function countFuzzed(src: string): number {
    return [...src.matchAll(FUZZED)].length;
}

/*//////////////////////////////////////////////////////////////
                         FINDING THE CLAIMS

    Four patterns, each matching a form this repo actually writes. They are deliberately
    narrow: the cost of a false positive here is a failing build on a correct sentence,
    which is how a gate earns a `--force` and stops mattering.
//////////////////////////////////////////////////////////////*/

type Kind = "suite" | "basis" | "paren" | "ratio";

type Pattern = {
    kind: Kind;
    re: RegExp;
    /**
     *  When set, the line must ALSO match this before the pattern counts. Used to keep a generic
     *  shape from matching a sentence about something else entirely.
     */
    context?: RegExp;
    why: string;
};

/**
 *  `(?<![\d/.])` and `(?!\s*[/.]\s*\d)` on the numbers together mean "not part of a ratio or a
 *  version". Without them `56/56 tests pass` would be collected as the suite claim `56 tests` and
 *  the HISTORICAL bucket would never see it — the ratio guard has to live in the SUITE pattern,
 *  not only in the ratio one, or defence #1 in the header is bypassed by pattern-ordering luck.
 */
const PATTERNS: readonly Pattern[] = [
    {
        kind: "suite",
        re: /(?<![\d/.])(\d{1,4})(?!\s*[/.]\s*\d)\s+(?:Solidity |forge |unit |passing |green )?tests\b/g,
        why: "a plain suite-size claim",
    },
    {
        kind: "basis",
        // The clause that makes the figure re-checkable: "132 `function test` declarations".
        // Guarded because it is the sentence a future sweep is most likely to leave behind —
        // CLAUDE.md:34 carries TWO numbers and the second one is this.
        re: /(?<![\d/.])(\d{1,4})(?!\s*[/.]\s*\d)\s+`?function test`?/g,
        why: "the declarations basis clause",
    },
    {
        kind: "paren",
        // "(it is 132 now)" — the forward pointer next to a dated figure that must NOT be
        // rewritten. The parenthetical is the half that must.
        re: /\((?:it is|now)\s+(?:now\s+)?\*{0,2}(\d{1,4})\*{0,2}(?:\s+now)?\)/g,
        // REQUIRED. The shape is generic enough to appear in a sentence about slots, organisms or
        // gas; demanding the word on the same line is what stops this pattern inventing failures.
        context: /\b(?:suites?|tests?)\b/i,
        why: "a forward pointer beside a dated figure",
    },
    {
        kind: "ratio",
        // A ratio is a MEASUREMENT, never a state. Collected so it is visible in the census and
        // so the self-test can prove it stays out of the failing bucket — see defence #1.
        re: /(?<![\d/.])(\d{1,4})\s*\/\s*(\d{1,4})\s*(?:tests\b|under\b)|\btests?\b[ \t]*:?[ \t]*(\d{1,4})\s*\/\s*(\d{1,4})/gi,
        why: "a dated pass ratio, never a current state",
    },
];

/*//////////////////////////////////////////////////////////////
                              SHAPES
//////////////////////////////////////////////////////////////*/

type Verdict = "agrees" | "stale" | "historical";

/**
 *  The verdicts that set a non-zero exit code — the whole gate, in one place.
 *
 *  ONE SET, READ BY BOTH `main` AND THE SELF-TEST, for the reason `cite-drift.ts` records at its
 *  own `FAILING`: written twice, the self-test asserts against its own copy and passes while the
 *  real gate fails on something else.
 *
 *  `historical` is deliberately absent. That is defence #1 from the header, and check 5 below
 *  pins it in the direction that would otherwise rot silently.
 */
const FAILING: ReadonlySet<Verdict> = new Set<Verdict>(["stale"]);

type Claim = {
    file: string;
    line: number;
    kind: Kind;
    /** the matched text, for a report a human can act on without opening the file */
    text: string;
    /** the number claimed — null for a ratio, where the pair is the point and neither half is a state */
    claimed: number | null;
    verdict: Verdict;
};

/*//////////////////////////////////////////////////////////////
                         WALKING THE REPO
//////////////////////////////////////////////////////////////*/

function walk(root: string, dir: string, out: string[]): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(root, p, out);
            continue;
        }
        if (!SCANNED_EXT.test(entry.name)) continue;
        if (SKIP_FILES.has(relative(root, p).split(sep).join("/"))) continue;
        out.push(p);
    }
}

/*//////////////////////////////////////////////////////////////
                            THE CHECK
//////////////////////////////////////////////////////////////*/

/**
 *  Every claim in one blob of text, judged against `derived`.
 *
 *  Takes TEXT rather than a path so the self-test drives it on synthetic lines. A scanner that
 *  could only be exercised through the filesystem would have to write fixture files to test its
 *  own controls, and then the controls would be testing the fixtures.
 */
function scanText(text: string, file: string, derived: number): Claim[] {
    const found: Claim[] = [];
    const lines = text.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        for (const pat of PATTERNS) {
            if (pat.context !== undefined && !pat.context.test(line)) continue;
            pat.re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = pat.re.exec(line)) !== null) {
                // A ratio carries no single state to compare, so it is bucketed by SHAPE alone and
                // never gets a number. This is where defence #1 actually happens.
                if (pat.kind === "ratio") {
                    found.push({
                        file,
                        line: i + 1,
                        kind: pat.kind,
                        text: m[0].trim(),
                        claimed: null,
                        verdict: "historical",
                    });
                    continue;
                }
                // The first defined capture group. `paren` and `basis` have one; `suite` has one.
                const raw = m.slice(1).find((g) => g !== undefined);
                if (raw === undefined) continue;
                const claimed = Number(raw);
                found.push({
                    file,
                    line: i + 1,
                    kind: pat.kind,
                    text: m[0].trim(),
                    claimed,
                    verdict: claimed === derived ? "agrees" : "stale",
                });
            }
        }
    }
    return found;
}

/*//////////////////////////////////////////////////////////////
                            SELF-TEST

    Every bucket watched firing, and — the half that matters here — every deliberately
    preserved historical figure watched NOT firing. A control that cannot fail is the exact
    anti-pattern this repo's audit is about, so each "X must not be flagged" check is paired
    with one that makes X flaggable and requires the same scanner to catch it.
//////////////////////////////////////////////////////////////*/

function selfTest(root: string): void {
    const checks: { name: string; ok: boolean; got: string; want: string }[] = [];
    // `string`, not `Verdict`: the last two checks compare booleans about the FAILING set rather
    // than verdicts, and narrowing this type would delete them.
    const expect = (name: string, got: string, want: string): void =>
        void checks.push({ name, ok: got === want, got, want });

    const suitePath = resolve(root, SUITE_FILE);
    if (!existsSync(suitePath)) {
        console.error(`count:selftest needs ${SUITE_FILE}`);
        process.exitCode = 1;
        return;
    }
    const suiteSrc = readFileSync(suitePath, "utf8");
    const derived = countDeclarations(suiteSrc);

    const verdicts = (text: string, file = "README.md"): string =>
        scanText(text, file, derived)
            .map((c) => c.verdict)
            .join(",") || "(none)";

    /* ---------------------------- the derivation ---------------------------- */

    // 1. The count is derived and plausible. A zero would mean the pattern stopped matching the
    //    file's style, and every claim in the repo would then read as stale at once — a failure
    //    mode that looks like drift but is the scanner breaking.
    expect(
        "the suite file yields a plausible declaration count",
        derived > 50 && derived < 1000 ? "plausible" : `implausible (${derived})`,
        "plausible",
    );

    // 2. THE COUNT IS DERIVED, NOT HARDCODED — the whole premise. Append one declaration to the
    //    text and the count must follow it. This is the check that would fail if someone
    //    "simplified" the derivation into a constant, which is the third hand-edit this file
    //    exists to prevent.
    expect(
        "appending a declaration moves the derived count by exactly one",
        String(countDeclarations(`${suiteSrc}\n    function test_selfTestSyntheticCase() public {}\n`) - derived),
        "1",
    );

    // 3. Declarations, not occurrences: a mention inside a comment or a string must not count.
    const noise = `${suiteSrc}\n    // function test_thisIsProseAboutFunctionTest() public {}\n    string memory s = "function test";\n`;
    expect("a commented-out or quoted `function test` is NOT counted", String(countDeclarations(noise) - derived), "0");

    // 4. The equivalence CLAUDE.md asserts — one declaration is one case — rests on there being
    //    no fuzzed declarations and exactly one .t.sol file. Both are facts about today's repo,
    //    so both are checked rather than believed.
    const testDir = resolve(root, "contracts/test");
    const tsol = existsSync(testDir)
        ? readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith(".t.sol")).length
        : 0;
    expect(
        "one .t.sol file, zero fuzzed declarations — the basis of the equivalence",
        `${tsol} files, ${countFuzzed(suiteSrc)} fuzzed`,
        "1 files, 0 fuzzed",
    );

    /* ------------------------- catching a stale claim ------------------------- */

    // 5. THE GATE CAN FAIL. A deliberately wrong number in each checked form must come back
    //    STALE. Without this the passes below could all be produced by a scanner that matches
    //    nothing at all.
    expect("a wrong plain suite claim is STALE", verdicts("# 100 tests: death irreversible"), "stale");
    expect("a wrong basis clause is STALE", verdicts("100 `function test` declarations in the one file"), "stale");
    expect(
        "a wrong forward pointer is STALE",
        verdicts("not a current count for the suite (it is 100 now), and the figure is"),
        "stale",
    );

    // 6. And the same three forms carrying the DERIVED number must come back AGREES. This is the
    //    control for #5: a scanner that returned STALE unconditionally would pass every check
    //    above and fail here.
    expect(
        "the same three forms at the derived count all AGREE",
        verdicts(
            `${derived} Solidity tests\n${derived} \`function test\` declarations\n` +
                `the suite as it stood (it is ${derived} now)`,
        ),
        "agrees,agrees,agrees",
    );

    /* ------------- the records that must never be flagged (defence #1) ------------- */

    // 7. THE LOAD-BEARING ONE. `CLAUDE.md:390`'s paris/shanghai equivalence record. It lives in a
    //    file that IS scanned, so shape is the only thing protecting it. Rewriting that 56 would
    //    assert a `paris` run of today's suite that nobody has performed.
    expect(
        "`Tests: 56/56 under both` is HISTORICAL, not stale",
        verdicts("simulates the full deploy clean. Tests: 56/56 under both — that is the", "CLAUDE.md"),
        "historical",
    );

    // 8. The other ratio spelling, as `docs/` and `STORAGE.md` write it. Same shape, same bucket.
    expect(
        "`56/56 tests pass` is HISTORICAL, not stale",
        verdicts("window 45%. 56/56 tests pass; no state variable declaration changed", "STORAGE.md"),
        "historical",
    );

    // 9. CONTROL FOR #7 AND #8. A ratio must be recognised by its SLASH, not by its numbers —
    //    otherwise `56` would be whitelisted everywhere and a genuinely stale `56 tests` would
    //    sail through. Same number, no slash, must be caught.
    expect(
        "the ratio exemption is about the slash, not about the number 56",
        verdicts("the suite is 56 tests today", "CLAUDE.md"),
        "stale",
    );

    /* -------------- the paths that must never be flagged (defence #2) -------------- */

    // 10. `docs/` is not descended into at all. Checked through `walk`, because the exclusion is
    //     implemented there and asserting it against `scanText` would prove nothing.
    const files: string[] = [];
    walk(root, root, files);
    const rel = files.map((f) => relative(root, f).split(sep).join("/"));
    expect(
        "no file under docs/ is collected",
        String(rel.filter((f) => f.startsWith("docs/")).length),
        "0",
    );

    // 11. CONTROL FOR #10, and the reason it is not just a tautology: the exclusion must be
    //     NARROW. `docs/` out, but the five real claim surfaces in. An exclusion list that grew
    //     to cover `app/` or the repo root would silence the gate while every check above still
    //     passed.
    const mustScan = ["README.md", "CLAUDE.md", "app/src/sections/Footer.jsx", "package.json", SUITE_FILE];
    expect(
        "the live claim surfaces ARE collected",
        mustScan.filter((f) => !rel.includes(f)).join(",") || "all present",
        "all present",
    );

    /* ---------------------------- no false positives ---------------------------- */

    // 12. A bare number near unrelated prose is not a claim. `STORAGE.md` and `CLAUDE.md` are
    //     full of counts about slots, organisms, requests and gas; a scanner that read those as
    //     test claims would fail the build on correct sentences until someone disabled it.
    expect(
        "counts about other things are not test claims",
        verdicts("`Population` is therefore 49 rows, not 47, and 132 slots is not a thing", "STORAGE.md"),
        "(none)",
    );

    // 13. Nor is a singular `test` in a sentence about something else. `CLAUDE.md:452` says
    //     "This caused 14 test failures once" — a historical anecdote about `vm.prank`, sharing
    //     almost every token with a suite claim.
    expect(
        "`14 test failures once` is not a suite claim",
        verdicts("wrong thing. This caused 14 test failures once. Use the `_econ()` helpers", "CLAUDE.md"),
        "(none)",
    );

    // 14. CONTROL FOR #12 AND #13: the same sentence shape, made into a real claim, must be
    //     caught. Otherwise "we do not fire on prose" is indistinguishable from "we do not fire".
    expect(
        "the same prose carrying a real stale claim IS caught",
        verdicts("wrong thing. This caused 14 tests to fail once.", "CLAUDE.md"),
        "stale",
    );

    /* ------------------------- which buckets move the exit code ------------------------- */

    /*
     *  15 & 16. Everything above asserts what `scanText` RETURNS. Neither of those says which
     *  verdicts `main` actually FAILS on, which is a separate line of code that can be wrong on
     *  its own — and getting it wrong in the permissive direction produces a gate that reports
     *  drift and exits 0, indistinguishable from a healthy repo in CI.
     *
     *  Pinned in both directions: drop `stale` and #15 fails; add `historical` and #16 fails.
     *  Without #16, defence #1 is a claim living only in a comment.
     */
    const fails = (v: Verdict): boolean => FAILING.has(v);
    expect("STALE is what fails the gate", String(fails("stale")), "true");
    expect(
        "AGREES and HISTORICAL do NOT fail the gate",
        `${fails("agrees")} ${fails("historical")}`,
        "false false",
    );

    /* ---------------------------------- report ---------------------------------- */

    for (const c of checks) {
        console.log(`  ${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.ok ? "" : `  (got ${c.got}, want ${c.want})`}`);
    }

    // Checks that fire on the HEALTHY state — the ones that would still pass if the scanner
    // matched nothing, and which therefore prove it is not silently inert: #2, #3, #4, #6, #7,
    // #8, #10, #11, #12, #13, #16. Each is paired with a check that makes its subject fail.
    const controls = 11;
    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) {
        console.log(`\nFAIL — ${failed.length} of ${checks.length} self-checks failed.`);
        process.exitCode = 1;
        return;
    }
    console.log(
        `\nPASS — ${checks.length} self-checks against a count derived as ${derived}, ${controls} of them ` +
            `controls: the gate was watched failing on a wrong number in all three checked forms, and watched ` +
            `staying quiet on both dated ratio records, on every file under docs/, and on prose carrying ` +
            `unrelated counts.`,
    );
}

/*//////////////////////////////////////////////////////////////
                                RUN
//////////////////////////////////////////////////////////////*/

function main(): void {
    const root = process.cwd();
    const suitePath = resolve(root, SUITE_FILE);
    if (!existsSync(suitePath)) {
        console.error(`count:check must run from the darwin/ root — no ${SUITE_FILE} under ${root}`);
        process.exitCode = 1;
        return;
    }

    if (process.argv.includes("--self-test")) {
        selfTest(root);
        return;
    }

    const suiteSrc = readFileSync(suitePath, "utf8");
    const derived = countDeclarations(suiteSrc);
    const fuzzed = countFuzzed(suiteSrc);

    if (derived === 0) {
        console.error(
            `count:check derived 0 test declarations from ${SUITE_FILE}, which cannot be right.\n` +
                "The declaration pattern is anchored at line start; if the file's style changed, fix\n" +
                "DECLARATION rather than the claims — every claim in the repo would read as stale.",
        );
        process.exitCode = 1;
        return;
    }

    const files: string[] = [];
    walk(root, root, files);

    const claims: Claim[] = [];
    for (const path of files) {
        const rel = relative(root, path).split(sep).join("/");
        claims.push(...scanText(readFileSync(path, "utf8"), rel, derived));
    }

    console.log(
        `count:check — ${derived} \`function test\` declarations in ${SUITE_FILE}` +
            `${fuzzed === 0 ? " (none fuzzed, so this is the suite count)" : ` (${fuzzed} fuzzed)`}\n`,
    );

    const tally = (v: Verdict): number => claims.filter((c) => c.verdict === v).length;
    const show = (c: Claim): string => `${c.file}:${c.line}  «${c.text}»`;

    const stale = claims.filter((c) => c.verdict === "stale");
    const historical = claims.filter((c) => c.verdict === "historical");
    const agrees = claims.filter((c) => c.verdict === "agrees");

    if (agrees.length > 0) {
        console.log(`AGREES (${agrees.length}):`);
        for (const c of agrees) console.log(`  ${show(c)}`);
        console.log("");
    }

    // Printed every run rather than hidden, because the honest size of the un-failable surface is
    // itself worth watching — the same reason `abi:check` lists UNGUARDED. If a ratio ever shows
    // up that is NOT a dated record, this list is where it becomes visible.
    if (historical.length > 0) {
        console.log(
            `HISTORICAL (${historical.length}) — dated pass ratios. Reported, NOT failed: a ratio is a ` +
                `measurement made on a day, and overwriting one fabricates a run that never happened.`,
        );
        for (const c of historical) console.log(`  ${show(c)}`);
        console.log("");
    }

    if (stale.length > 0) {
        console.log(`STALE (${stale.length}) — claims the suite file contradicts:`);
        for (const c of stale) {
            console.log(`  ${show(c)}`);
            console.log(`    claims ${c.claimed}, ${SUITE_FILE} declares ${derived}  (${c.kind})`);
        }
        console.log("");
    }

    const census =
        `${claims.length} claims found: ${tally("agrees")} agree, ${stale.length} stale, ` +
        `${historical.length} dated ratios; ${files.length} files scanned, ` +
        `${[...SKIP_DIRS].join("/")} excluded`;

    if (stale.length === 0) {
        console.log(`PASS — every live claim about the suite size matches the suite. ${census}.`);
    } else {
        console.log(`FAIL — ${stale.length} claims disagree with ${SUITE_FILE}. ${census}.`);
        process.exitCode = 1;
    }
}

// Guarded exactly as `cadence.ts` and `lib/logscan.ts` are, and for the reason recorded there: an
// unguarded side-effecting module scope means an `import` of this file runs the whole scan inside
// the importer. Compared on realpath because Windows can disagree with itself about drive-letter
// casing, and a string compare would then be false — failing in the direction that never
// announces itself, the gate declining to run and exiting 0.
const invokedDirectly = (() => {
    const argv1 = process.argv[1];
    if (argv1 === undefined) return false;
    try {
        return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argv1);
    } catch {
        return false;
    }
})();

if (invokedDirectly) main();
