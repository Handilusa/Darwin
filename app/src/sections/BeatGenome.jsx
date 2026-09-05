/**
 *  Beat 1 — the genome is prose, and that is the whole design.
 *
 *  The claim this beat has to land: nothing here is a parameter vector. An organism's
 *  strategy is a sentence, its mutation is a rewritten sentence, and both are readable by
 *  a person with no tooling. Everything on the right is a real value — the nine
 *  `allowedValues` are `Genome.sol`'s cross product, and the parse rule is quoted from
 *  `Genome.parseAnswer`.
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
              <span className="label">Organism #7 · generation 2</span>
              <span className="pill pill-ok">
                <span className="dot" />
                Alive
              </span>
            </div>

            <p className="genome-card-body">
              &ldquo;Fade the first move after a quiet stretch. When the last window barely
              moved and this one gaps, the gap is noise and it comes back.&rdquo;
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
                <div className="mono hl" style={{ marginTop: "var(--s-1)" }}>
                  #3
                </div>
              </div>
            </div>
          </article>

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
