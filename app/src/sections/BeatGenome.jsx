/**
 *  Beat 1 — the genome is prose, and that is the whole design.
 *
 *  The claim this beat has to land: nothing here is a parameter vector. An organism's
 *  strategy is a sentence, its mutation is a rewritten sentence, and both are readable by
 *  a person with no tooling. Everything on the right is a real value — the nine
 *  `allowedValues` are `Genome.sol`'s cross product, and the parse rule is quoted from
 *  `Genome.parseAnswer`.
 *
 *  ── THE CARD USED TO CONTRADICT THE CHAIN (fixed 2026-09-08) ────────────────
 *  That paragraph was true of the left column and false of the card beside it. The header
 *  read `Organism #7 · generation 2`, the body was an invented paraphrase, and `Parent` was
 *  `#3` — on a deploy where `generation()` is **0** in all eight organisms and there has
 *  never been a child, so a judge one click away in `/arena/` found a generation-2 organism
 *  that does not and cannot yet exist. Same defect class as Hero's `41.20 tUSDC`, and the
 *  same remedy: use something real, or label it.
 *
 *  It is now REVERSION, prophet id 2 (`50312.organisms.json`), genome quoted verbatim as a
 *  contiguous prefix from `genomes/genesis.json` — not paraphrased, because a paraphrase is
 *  what let the old text drift. `Dead` and the window-68 outcome are the measured ones from
 *  `docs/ERROR_W68_MOMENTUM.md` §4: REVERSION answered Down, was wrong, starved. `Parent` is
 *  `founder` rather than an id because founders have none.
 *
 *  IF A CHILD IS EVER BORN, this card may be swapped for it and the caption's last sentence
 *  drops. Until then, do NOT invent a generation — the arena is one click away and it counts.
 */

import { useReveal } from "../motion/hooks.js";

const BELIEFS = ["Up", "Down", "Abstain"];
const THESES = ["Momentum", "Reversion", "Breakout", "Range"];

export function BeatGenome() {
  const ref = useReveal();

  return (
    <section className="beat" id="genome" ref={ref}>
      <div className="wrap beat-in">
        <div>
          <div className="beat-eyebrow" data-rise>
            <span className="beat-num">01</span>
            <span className="beat-rule" />
            <span className="label">The genome</span>
          </div>

          <h2 className="beat-title" data-rise>
            A strategy you can <em>read</em>.
          </h2>

          <div className="beat-body" data-rise>
            <p className="prose">
              An organism's genome is an English sentence stored on chain as a{" "}
              <code>string</code>. It is not weights, not a parameter vector, not a config
              blob — it is a thesis a person wrote and another person can disagree with.
            </p>
            <p className="prose">
              Every window that sentence is assembled into a prompt and answered through
              on-chain inference under validator consensus. The answer is constrained to
              nine values, so a contract can act on it directly:{" "}
              <strong>a direction and a reason</strong>. Anything unrecognised parses to{" "}
              <code>Abstain</code> — never a coin flip.
            </p>
            <p className="prose">
              Breeding is the same mechanism pointed at itself. A survivor's genome is
              rewritten by a second inference call, and the child inherits the sentence, not
              the balance sheet. <strong>Selection acts on ideas.</strong>
            </p>
          </div>
        </div>

        <div className="fig" data-rise>
          <article className="genome-card">
            <div className="genome-card-top">
              <span className="label">REVERSION · #2 · generation 0</span>
              <span className="pill pill-dead">
                <span className="dot" />
                Dead
              </span>
            </div>

            <p className="genome-card-body">
              &ldquo;You believe short-horizon moves overshoot. Within a 15-minute window most
              displacement from the opening level is liquidity being consumed, not information
              arriving, and thin books overshoot before settling back. So you fade. If price is
              above the window&rsquo;s open, answer <code>DOWN_REVERSION</code>, expecting the
              move to exhaust.&rdquo;
            </p>

            <div className="genome-card-foot">
              <div>
                <span className="label">Belief</span>
                <div className="mono hl-heat" style={{ marginTop: "var(--s-1)" }}>
                  Down
                </div>
              </div>
              <div>
                <span className="label">Thesis</span>
                <div className="mono hl" style={{ marginTop: "var(--s-1)" }}>
                  Reversion
                </div>
              </div>
              <div>
                <span className="label">Parent</span>
                <div className="mono" style={{ marginTop: "var(--s-1)", color: "var(--text-3)" }}>
                  founder
                </div>
              </div>
            </div>
          </article>

          <p className="vitals-source">
            A real organism: <code>REVERSION</code>, prophet id 2, a generation-0 founder whose
            genome is quoted verbatim from <code>genomes/genesis.json</code>. It answered
            Down&nbsp;·&nbsp;Reversion in window 68, was wrong, and starved — the first
            generation of deaths on this deploy. Every founder is generation 0 and has no
            parent; the first child will have both.{" "}
            <a href="/arena/">Watch the arena</a>.
          </p>

          <p className="fig-cap">
            The nine answers a genome is allowed to give — the cross product of{" "}
            {BELIEFS.length - 1} directions and {THESES.length} theses, plus{" "}
            <code>ABSTAIN</code>. Both halves are on chain and both are in the{" "}
            <code>Believed</code> event, so selection over strategies is readable straight
            out of the log stream.
          </p>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--s-2)",
              marginTop: "var(--s-4)",
            }}
          >
            {THESES.map((t) => (
              <span className="pill pill-ok" key={`up-${t}`}>
                Up · {t}
              </span>
            ))}
            {THESES.map((t) => (
              <span className="pill pill-warn" key={`down-${t}`}>
                Down · {t}
              </span>
            ))}
            <span className="pill pill-dead">Abstain</span>
          </div>
        </div>
      </div>
    </section>
  );
}
