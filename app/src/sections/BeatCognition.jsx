/**
 *  Beat 3 — thinking costs, and the cost is measured rather than asserted.
 *
 *  Every figure in this beat came off Shannon on 2026-08-30 and is recorded in `CLAUDE.md`
 *  with the method that produced it. That matters more than the numbers themselves: the
 *  page's whole claim is that selection pressure here is real, and a made-up price would
 *  make it a simulation with extra steps.
 *
 *  The counters animate upward on scroll for one reason — the argument is that this is
 *  being metered continuously, and a total that assembles itself in front of the reader
 *  says so more plainly than a static figure.
 */

import { useCounter, useDrain, useReveal } from "../motion/hooks.js";

/* Module scope, not inline: these are effect dependencies in useCounter, and a formatter
   recreated on every render would restart its tween. */
const f3 = (v) => v.toFixed(3);
const f4 = (v) => v.toFixed(4);
const f2 = (v) => v.toFixed(2);
const int = (v) => String(Math.round(v));

export function BeatCognition() {
  const ref = useReveal();

  const floor = useCounter({ from: 0, to: 0.03, duration: 1.1, format: f3 });
  const reward = useCounter({ from: 0, to: 0.003, duration: 1.1, format: f3 });
  const total = useCounter({ from: 0, to: 0.033, duration: 1.4, format: f3, ease: "power2.out" });
  const live = useCounter({ from: 0, to: 0.0309, duration: 1.4, format: f4 });
  const windows = useCounter({ from: 0, to: 10, duration: 1.2, format: int });
  const metab = useCounter({ from: 0, to: 0.05, duration: 1.1, format: f2 });

  const drain = useDrain({ from: 1, to: 0.42, duration: 2.6 });

  return (
    <section className="beat" id="cognition" ref={ref}>
      <div className="wrap beat-in">
        <div>
          <div className="beat-eyebrow" data-rise>
            <span className="beat-num">03</span>
            <span className="beat-rule" />
            <span className="label">Metered cognition</span>
          </div>

          <h2 className="beat-title" data-rise>
            An organism <em>pays</em> for every opinion it forms.
          </h2>

          <div className="beat-body" data-rise>
            <p className="prose">
              Each window, forming a belief costs one inference request paid out of the
              organism's <em>own</em> native balance. Not the operator's — the organism's.
              An organism that cannot afford to think abstains, opens an empty position,{" "}
              <strong>and is charged metabolism anyway</strong>.
            </p>
            <p className="prose">
              The deposit is not escrow. Nothing comes back. So intelligence here has a unit
              price, and running out of it is a way to die — which is exactly what it is
              meant to be.
            </p>
            <p className="prose">
              Entry funds cognition at the door and{" "}
              <code>retire</code> refunds whatever the organism never spent. That asymmetry
              is a griefing fix, not a style choice: a house-funded grant would be an
              unbounded free-inference faucet — enter, retire, repeat.
            </p>
          </div>

          <div className="drain" data-rise>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--s-4)" }}>
              <span className="label">Cognition remaining · organism #7</span>
              <span className="label">
                <span ref={windows}>10</span> windows bought at entry
              </span>
            </div>
            <div className="drain-track">
              <div className="drain-fill" ref={drain} />
            </div>
            <div className="drain-scale">
              <span>0.33 STT</span>
              <span>0.00 — abstains, then starves</span>
            </div>
          </div>
        </div>

        <div className="fig" data-rise>
          <div className="panel">
            <div className="panel-head">
              <span className="label">The price of one inference</span>
              <span className="pill">measured on Shannon</span>
            </div>

            <div className="meter">
              <div className="meter-row">
                <div className="meter-what">
                  Platform deposit floor
                  <span className="meter-src">
                    0.01 STT × subcommittee of 3 · swept by <code>eth_call</code>, n = 22
                  </span>
                </div>
                <div className="meter-num mono">
                  <span ref={floor}>0.030</span> STT
                </div>
              </div>

              <div className="meter-row">
                <div className="meter-what">
                  Validator reward
                  <span className="meter-src">
                    0.001 each · lowered from 0.01, still 3.3× the observed rate
                  </span>
                </div>
                <div className="meter-num mono">
                  <span ref={reward}>0.003</span> STT
                </div>
              </div>

              <div className="meter-row">
                <div className="meter-what">
                  <strong>What one belief costs</strong>
                  <span className="meter-src">
                    nothing is refunded — the deposit is spent, not held
                  </span>
                </div>
                <div className="meter-num mono is-total">
                  <span ref={total}>0.033</span> STT
                </div>
              </div>

              <div className="meter-row">
                <div className="meter-what">
                  What live traffic actually paid
                  <span className="meter-src">
                    five real single-request transactions; the payer's balance fell 0.0315 of
                    which 0.00065 was gas
                  </span>
                </div>
                <div className="meter-num mono">
                  <span ref={live}>0.0309</span> STT
                </div>
              </div>

              <div className="meter-row">
                <div className="meter-what">
                  Metabolism, per window
                  <span className="meter-src">
                    charged on settlement — right, wrong or silent
                  </span>
                </div>
                <div className="meter-num mono">
                  −<span ref={metab}>0.05</span> tUSDC
                </div>
              </div>
            </div>
          </div>

          <p className="fig-cap">
            The two measurements corroborate each other exactly:{" "}
            <code>0.0309 = 3 × (0.01 + 0.0003)</code>, so real requests run a subcommittee of
            three and pay 0.0003 per validator over the floor. Because the floor is two
            thirds of the bill, <strong>the number of requests — not the reward — is the
            lever that matters.</strong>
          </p>
        </div>
      </div>
    </section>
  );
}
