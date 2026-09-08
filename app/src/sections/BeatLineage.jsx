/**
 *  Beat 5 — the headline metric is generation, not PnL.
 *
 *  The tree is one founder's line, drawn rather than revealed: `path[data-draw]` plus
 *  `useDrawPaths`, staggered so ancestry grows outward from the root. Every rule stated
 *  here is read out of `Population.sol` — the streak, the 1.5x threshold, and the fact that
 *  a parent pays for its child out of its own treasury and is measurably more fragile
 *  afterwards.
 *
 *  One node is ash and its child is alive. That is the whole argument for why lineage, not
 *  the leaderboard, is the thing being tracked.
 *
 *  ── THE TREE IS A DIAGRAM AND NOW SAYS SO (fixed 2026-09-08) ────────────────
 *  It used to be drawn with prophet ids — `#1`, `#17`, `#26` — a census rail reading
 *  `1/3/4/2` across four generations, a `deepest` counter tweening to 3, and a caption
 *  asserting "#17 is ash and #26, its child, is alive". None of it was true on chain:
 *  `generation()` is 0 in all eight organisms, `breedProphet` has never been called, and ids
 *  above 8 do not exist. The ids were the specific problem — a numbered node is a claim about
 *  a particular organism a judge can look up, and `/arena/` is one click away.
 *
 *  So the nodes are LETTERED (`A`…`K`), the caption calls itself a diagram, `.vitals-source`
 *  says outright that nothing has bred, and the rail carries the real census instead:
 *  8 born / 6 alive / 2 dead / 0 at generation 1. Keep the letters. Renumbering them to look
 *  like organisms is exactly the regression this note exists to prevent — and if a child is
 *  ever actually born, the honest version of that change reads the ids off chain rather than
 *  hard-coding a second set.
 */

import { useCounter, useDrawPaths, useReveal } from "../motion/hooks.js";

const int = (v) => String(Math.round(v));

/* x by generation, y hand-placed so the line reads as a pedigree rather than a graph. */
const NODES = [
  { id: "A", x: 58, y: 140, r: 11, k: "life" },
  { id: "B", x: 222, y: 68, r: 9, k: "life" },
  { id: "C", x: 222, y: 148, r: 9, k: "life" },
  { id: "D", x: 222, y: 222, r: 8, k: "life" },
  { id: "E", x: 388, y: 42, r: 8, k: "life" },
  { id: "F", x: 388, y: 106, r: 8, k: "life" },
  { id: "G", x: 388, y: 184, r: 8, k: "ash" },
  { id: "H", x: 388, y: 246, r: 7, k: "life" },
  { id: "J", x: 552, y: 84, r: 7, k: "life" },
  { id: "K", x: 552, y: 210, r: 7, k: "life" },
];

/** Parent index → child index. Order is the draw order: outward from the founder. */
const LINKS = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 4],
  [1, 5],
  [2, 6],
  [3, 7],
  [5, 8],
  [6, 9], // the dead organism's child, still alive
];

/*
 *  THE LIVE CENSUS, and it is deliberately unflattering.
 *
 *  This rail used to read `1 gen 0 / 3 gen 1 / 4 gen 2 / 2 gen 3`, with `3 deepest` counting
 *  up beside it — a four-generation pedigree on a deploy where `generation()` is 0 in all
 *  eight organisms and `breedProphet` has never been called. A judge one click away in
 *  `/arena/` found a population entirely at generation 0.
 *
 *  So it is the real census now: eight founders, all generation 0, deepest 0, two of them
 *  already dead. A zero here is not a weak demo — it is the metric behaving as designed,
 *  because depth has to be EARNED (four consecutive correct calls plus 1.5x endowment) and
 *  nothing has earned it yet. Faking it would have thrown away the one number the README
 *  calls the headline.
 */
const GENS = [
  { n: "8", l: "born" },
  { n: "6", l: "alive" },
  { n: "2", l: "dead" },
  { n: "0", l: "gen 1" },
];

function edge(a, b) {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
}

export function BeatLineage() {
  const ref = useReveal();
  const treeRef = useDrawPaths(0.13);
  // Counts to 0, i.e. does not move. `generation()` is 0 in all eight — see the note on
  // GENS. A tween to 3 here was the animated half of the same overclaim.
  const deepest = useCounter({ from: 0, to: 0, duration: 1.1, format: int });

  return (
    <section className="beat" id="lineage" ref={ref}>
      <div className="wrap beat-in">
        <div>
          <div className="beat-eyebrow" data-rise>
            <span className="beat-num">05</span>
            <span className="beat-rule" />
            <span className="label">Lineage</span>
          </div>

          <h2 className="beat-title" data-rise>
            The score is a <em>generation</em> number.
          </h2>

          <div className="beat-body" data-rise>
            <p className="prose">
              A survivor breeds when it has called four consecutive windows correctly{" "}
              <em>and</em> holds at least 1.5× a starting endowment — <code>15</code> tUSDC
              against a base of <code>10</code>. Its genome is then rewritten by a second
              inference call, and the child is born carrying the new sentence.
            </p>
            <p className="prose">
              The child costs the parent a <strong>full endowment out of its own
              treasury</strong>. A survivor that breeds drops from 15 to 5 and is
              deliberately more fragile the moment afterwards. Reproduction is expensive
              here, as it is everywhere else.
            </p>
            <p className="prose">
              A child inherits the sentence, not the balance sheet, so nothing about the
              parent's PnL is transmitted. What accumulates across a season is depth: how
              many times a line of reasoning has been rewritten by something that survived
              long enough to earn the rewrite.
            </p>
            <p className="prose">
              Anyone may call <code>breedProphet</code> on a qualifying organism. The
              eligibility rules are identical to settlement's, so{" "}
              <strong>a human can choose the moment, never the outcome.</strong>
            </p>
          </div>

          <div className="gen-rail" data-rise>
            {GENS.map((g) => (
              <div className="gen" key={g.l}>
                <span className="gen-n">{g.n}</span>
                <span className="gen-l">{g.l}</span>
              </div>
            ))}
            <div className="gen">
              <span className="gen-n" ref={deepest}>
                0
              </span>
              <span className="gen-l">deepest</span>
            </div>
          </div>
        </div>

        <div className="fig" data-rise>
          <div className="tree" ref={treeRef}>
            <svg viewBox="0 0 620 288" xmlns="http://www.w3.org/2000/svg" role="img">
              <title>
                Diagram: how a founder&rsquo;s line accumulates depth, and how a dead
                organism&rsquo;s edge stays in the graph
              </title>

              {LINKS.map(([a, b]) => {
                // An edge into an ash node is drained, not deleted. Death removes an
                // organism from the population, never from the ancestry graph.
                const drained = NODES[a].k === "ash" || NODES[b].k === "ash";
                return (
                  <path
                    key={`${a}-${b}`}
                    d={edge(NODES[a], NODES[b])}
                    data-draw=""
                    fill="none"
                    stroke={drained ? "var(--ash-dim)" : "var(--life-dim)"}
                    strokeWidth="1.25"
                  />
                );
              })}

              {NODES.map((n) => (
                <g key={n.id}>
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    fill="none"
                    stroke={n.k === "ash" ? "var(--ash)" : "var(--life)"}
                    strokeWidth="1.4"
                  />
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r * 0.3}
                    fill={n.k === "ash" ? "var(--ash-dim)" : "var(--life)"}
                  />
                  <text
                    x={n.x}
                    y={n.y + n.r + 14}
                    textAnchor="middle"
                    fill={n.k === "ash" ? "var(--ash-dim)" : "var(--text-3)"}
                    fontFamily="var(--f-mono)"
                    fontSize="10"
                  >
                    {n.id}
                  </text>
                </g>
              ))}
            </svg>
          </div>

          <p className="fig-cap">
            A diagram of the rule, not a photograph of the population. Node <code>G</code> is
            ash and <code>K</code>, its child, is alive: the parent&rsquo;s edge stays drawn
            and drained, because death removes an organism from the population and never from
            the ancestry graph. That graph is the one asset here that cannot be rebuilt, which
            is why <code>Prophet</code> is beacon-backed and its storage layout is
            append-only.
          </p>

          <p className="vitals-source">
            Illustrative — the nodes are lettered, not numbered, because{" "}
            <strong>no organism has bred yet</strong>. All eight founders are generation 0 and{" "}
            <code>breedProphet</code> has never been called, so the live tree is eight
            unconnected roots with two of them ash. The rail on the left is the real census.{" "}
            <a href="/arena/">Watch the arena</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
