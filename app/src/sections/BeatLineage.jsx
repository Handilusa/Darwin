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
 */

import { useCounter, useDrawPaths, useReveal } from "../motion/hooks.js";

const int = (v) => String(Math.round(v));

/* x by generation, y hand-placed so the line reads as a pedigree rather than a graph. */
const NODES = [
  { id: "#1", x: 58, y: 140, r: 11, k: "life" },
  { id: "#4", x: 222, y: 68, r: 9, k: "life" },
  { id: "#5", x: 222, y: 148, r: 9, k: "life" },
  { id: "#9", x: 222, y: 222, r: 8, k: "life" },
  { id: "#12", x: 388, y: 42, r: 8, k: "life" },
  { id: "#14", x: 388, y: 106, r: 8, k: "life" },
  { id: "#17", x: 388, y: 184, r: 8, k: "ash" },
  { id: "#19", x: 388, y: 246, r: 7, k: "life" },
  { id: "#23", x: 552, y: 84, r: 7, k: "life" },
  { id: "#26", x: 552, y: 210, r: 7, k: "life" },
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

const GENS = [
  { n: "1", l: "gen 0" },
  { n: "3", l: "gen 1" },
  { n: "4", l: "gen 2" },
  { n: "2", l: "gen 3" },
];

function edge(a, b) {
  const mx = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} C ${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
}

export function BeatLineage() {
  const ref = useReveal();
  const treeRef = useDrawPaths(0.13);
  const deepest = useCounter({ from: 0, to: 3, duration: 1.1, format: int });

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
                3
              </span>
              <span className="gen-l">deepest</span>
            </div>
          </div>
        </div>

        <div className="fig" data-rise>
          <div className="tree" ref={treeRef}>
            <svg viewBox="0 0 620 288" xmlns="http://www.w3.org/2000/svg" role="img">
              <title>One founder&rsquo;s line, four generations deep</title>

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
            Organism <code>#17</code> is ash and <code>#26</code>, its child, is alive and
            two generations deep. The parent&rsquo;s edge stays drawn and drained: the graph
            is the one asset in this system that cannot be rebuilt, which is why{" "}
            <code>Prophet</code> is beacon-backed and its storage layout is append-only.
          </p>
        </div>
      </div>
    </section>
  );
}
