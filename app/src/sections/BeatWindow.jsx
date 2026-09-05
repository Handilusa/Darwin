/**
 *  Beat 2 — one window, four driver calls.
 *
 *  The phase machine lives on chain in `Population.phase` (0 idle → 1 thinking → 2
 *  committed → 0), which is the thing worth showing: the off-chain script remembers
 *  nothing between iterations, so it can be killed, restarted or moved to another machine
 *  and resume wherever the population actually is.
 *
 *  The highlight walks the four rows on a timer rather than on scroll. That is deliberate:
 *  a window advances on its own whether or not anybody is looking at it, and a reader who
 *  stops scrolling should still see it move.
 */

import { useEffect, useState } from "react";

import { reducedMotion, useReveal } from "../motion/hooks.js";

const PHASES = [
  {
    phase: "0",
    call: "think()",
    what: "Reads the live window from the price source, records the market, and fires one inference request per living organism.",
    who: "one request per organism",
  },
  {
    phase: "1",
    call: "commitAll()",
    what: "Partitions beliefs into Up and Down and issues 1:1-backed opposing positions out of the two organisms' combined collateral. Anyone unmatched gets a zero-size position.",
    who: "disagreement is the matchmaker",
  },
  {
    phase: "2",
    call: "settleAll()",
    what: "Redeems every position, grades fitness, skims the rake on profit, charges metabolism, reaps the bankrupt, and flags who has earned a child.",
    who: "grading, then death",
  },
  {
    phase: "—",
    call: "hatchAll()",
    what: "Births the children whose mutated genomes have landed. Separate on purpose, so slow inference can never delay a settlement anyone else is waiting on.",
    who: "deliberately not in the window",
  },
];

export function BeatWindow() {
  const ref = useReveal();
  const [on, setOn] = useState(0);

  useEffect(() => {
    if (reducedMotion()) return undefined;
    const id = setInterval(() => setOn((i) => (i + 1) % PHASES.length), 2600);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="beat" id="window" ref={ref}>
      <div className="wrap beat-in">
        <div>
          <div className="beat-eyebrow" data-rise>
            <span className="beat-num">02</span>
            <span className="beat-rule" />
            <span className="label">The window</span>
          </div>

          <h2 className="beat-title" data-rise>
            Fifteen minutes, <em>four calls</em>, no memory off chain.
          </h2>

          <div className="beat-body" data-rise>
            <p className="prose">
              The phase machine is a state variable in the contract, not a job queue on a
              server. The script that drives it holds nothing between iterations — the
              active market, the window number and the phase all live on chain.
            </p>
            <p className="prose">
              So it can be killed mid-window, restarted on a different machine, and it
              resumes where the population <em>actually is</em>. Belief formation, pairing,
              fitness, death, mutation and lineage are all on chain. What is off chain is a
              clock.
            </p>
            <p className="prose">
              Each call is gated on <code>onlyDriver</code>: the owner, the{" "}
              <code>SelectionEngine</code>, or Somnia's reactivity precompile. That union is
              why the cadence can move from a script to on-chain ticks without a line of new
              code — and why this page offers you no buttons for it.
            </p>
          </div>

          <div className="notice" style={{ marginTop: "var(--s-5)" }} data-rise>
            <span className="notice-mark">↯</span>
            <div>
              Settlement and selection share a block. When a market finalizes, the
              reactivity subscription fires <code>SelectionEngine.onEvent</code> in{" "}
              <strong>that same block</strong>, and the population redeems inside the
              synthetic transaction. <code>npm run prove</code> is the gate on that claim and
              fails on a coincidence.
            </div>
          </div>
        </div>

        <div className="fig" data-rise>
          <div className="phases">
            {PHASES.map((p, i) => (
              <div className={`phase${i === on ? " is-on" : ""}`} key={p.call}>
                <span className="phase-badge">{p.phase}</span>
                <div>
                  <div className="phase-call">{p.call}</div>
                  <p className="phase-what">{p.what}</p>
                  <div className="phase-who">
                    <span className="label">{p.who}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="fig-cap">
            Measured on Shannon, not estimated: inference completes at a median of{" "}
            <strong>0.6 s</strong> and a maximum of <strong>5.3 s</strong> across 6,231
            request lifecycles, with 6,232 of 6,232 creations reaching a terminal status. A
            fifteen-minute window has roughly 170× the headroom it needs.
          </p>
        </div>
      </div>
    </section>
  );
}
