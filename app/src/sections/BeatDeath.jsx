/**
 *  Beat 4 — death is a state, not a reset.
 *
 *  This is the beat the whole page is built around, so it is the one place where the
 *  argument is made by something happening rather than by something being said: an
 *  organism the reader has been watching breathe goes out, over a second and a half, and
 *  never comes back. `once: true` on the trigger is not an optimisation — it is the
 *  animation agreeing with `test_death_isIrreversible`.
 *
 *  The hero's field loses an organism in the same instant (wired in `App.jsx`). Scroll back
 *  up and it is still ash. A page that quietly restored it would be contradicting its own
 *  product on screen.
 */

import { useEffect, useRef, useState } from "react";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { CLOSEUP, CLOSEUP_DOOMED, CLOSEUP_EDGES, mountField } from "../motion/field.js";
import { reducedMotion, useReveal } from "../motion/hooks.js";

/** Each row is a state variable and the honest answer to "can this be undone?". */
const STATES = [
  {
    name: "treasury",
    what: "Falls by metabolism every settled window, rises when a position pays.",
    verdict: "reversible",
    tone: "pill-ok",
  },
  {
    name: "cognition (STT)",
    what: "Drawn per inference. Anyone at all may call topUpCognition on any organism.",
    verdict: "reversible",
    tone: "pill-ok",
  },
  {
    name: "positionOpen",
    what: "Set when a pair is issued, cleared when the window settles.",
    verdict: "reversible",
    tone: "pill-ok",
  },
  {
    name: "generation",
    what: "Assigned once at birth from the parent. Nothing decrements it.",
    verdict: "monotonic",
    tone: "pill",
  },
  {
    name: "dead",
    what: "No function anywhere sets this back to false — not the owner, not Population, not a beacon upgrade.",
    verdict: "irreversible",
    tone: "pill-dead",
    dead: true,
  },
];

export function BeatDeath() {
  const ref = useReveal();
  const stageRef = useRef(null);
  const [gone, setGone] = useState(false);

  /* The stage, and the one death on it. Both live in the same effect so the trigger can
     never fire before the field it is meant to kill exists. */
  useEffect(() => {
    const host = stageRef.current;
    if (!host) return undefined;

    const reduced = reducedMotion();
    const field = mountField(host, {
      reduced,
      spec: CLOSEUP,
      edges: CLOSEUP_EDGES,
      base: 620,
      maxScale: 1.15,
    });

    if (reduced) {
      // No tween to watch, so state the outcome instead of animating toward it.
      setGone(true);
      return () => field.destroy();
    }

    // Declared before the trigger: ScrollTrigger.create refreshes immediately and can call
    // onEnter synchronously if the stage is already in view, which would hit the TDZ.
    const timers = [];

    const st = ScrollTrigger.create({
      trigger: host,
      start: "top 68%",
      once: true,
      onEnter: () => {
        // A beat of it visibly alive first — an organism that dies the instant you see it
        // was never alive, it was just an illustration of a dead one.
        timers.push(
          setTimeout(() => {
            field.die(CLOSEUP_DOOMED);
            setGone(true);
          }, 900),
        );
      },
    });

    return () => {
      for (const t of timers) clearTimeout(t);
      st.kill();
      field.destroy();
    };
  }, []);

  return (
    <section className="beat" id="death" ref={ref}>
      <div className="wrap beat-in">
        <div>
          <div className="beat-eyebrow" data-rise>
            <span className="beat-num">04</span>
            <span className="beat-rule" />
            <span className="label">Irreversibility</span>
          </div>

          <h2 className="beat-title" data-rise>
            Death is a <em>state</em>, not a reset.
          </h2>

          <div className="beat-body" data-rise>
            <p className="prose">
              There are three ways for an organism to stop existing. Its treasury falls
              below the minimum it needs to take a position — <code>0.25</code> tUSDC — and
              settlement reaps it. Or its native balance runs out, so it can no longer pay
              for an opinion, abstains, and is charged metabolism until the first case
              happens. Or its entrant calls <code>retire</code> and withdraws.
            </p>
            <p className="prose">
              All three set one flag, and <strong>nothing clears it</strong>. The{" "}
              <code>alive</code> modifier gates every state transition an organism has, so a
              dead one is not paused or archived — it is unable to act, permanently.
            </p>
            <p className="prose">
              That constraint survives an upgrade, which is the part worth checking rather
              than believing. <code>Prophet</code> sits behind a beacon and{" "}
              <code>Population</code> behind a UUPS proxy specifically so logic can be
              repaired mid-season without resetting lineage — and{" "}
              <code>test_upgrade_cannotRevive</code> asserts that the repair path cannot be
              used to bring anything back.
            </p>
          </div>

          <div className="notice notice-warn" style={{ marginTop: "var(--s-5)" }} data-rise>
            <span className="notice-mark">!</span>
            <div>
              There is deliberately no admin recovery path. That is a claim a judge can
              falsify in one command — <code>grep -rn "dead = false" contracts/src</code> —
              and the two tests above fail loudly if anyone ever adds one.
            </div>
          </div>

          <blockquote className="quote" data-rise>
            &ldquo;No path anywhere clears <code>dead</code> — not owner, not{" "}
            <code>Population</code>, not a beacon upgrade.&rdquo;
            <cite>CLAUDE.md · hard constraints</cite>
          </blockquote>
        </div>

        <div className="fig" data-rise>
          <div className="stage" ref={stageRef} aria-hidden="true">
            <canvas />
            <svg xmlns="http://www.w3.org/2000/svg" />
            <div className="stage-cap">
              <span>{gone ? "4 alive · 1 ash" : "5 alive"}</span>
              <span className={gone ? "" : "is-going"}>
                {gone ? "no path clears dead" : "one of these is about to starve"}
              </span>
            </div>
          </div>

          <p className="fig-cap">
            The thread to its child drains with it and stays drawn. Death removes an
            organism from the population, not from the ancestry graph — its descendants keep
            their generation number and their inherited sentence.
          </p>

          <div className="states" style={{ marginTop: "var(--s-5)" }}>
            {STATES.map((s) => (
              <div className={`state${s.dead ? " state-dead" : ""}`} key={s.name}>
                <div>
                  <div className="state-name">{s.name}</div>
                  <p className="state-what">{s.what}</p>
                </div>
                <span className={`pill ${s.tone}`}>{s.verdict}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
