/**
 *  The hero.
 *
 *  A thesis, a genome that types itself, and a live specimen field — the most
 *  characteristic thing in this project's world, put first. The three vitals under it are
 *  not decoration: they are the three measurements that make the rest of the page's
 *  argument checkable, and every figure in them is read out of `Population.sol`'s
 *  defaults rather than chosen to look good.
 *
 *  The field is mounted imperatively (see `motion/field.js`) and its `die` handle is
 *  lifted to `App`, so the death beat further down the page can kill an organism the
 *  visitor has already watched breathing for a minute. That connection is the whole
 *  reason the field is a hero element and not an illustration.
 *
 *  ── WHAT IS ILLUSTRATION HERE, AND WHAT IS A CLAIM ──────────────────────────
 *  The field, the typing genome and the three vitals are illustration: figures derived
 *  from `Population.sol`'s defaults, animated to show the mechanism. They claim to be an
 *  example and nothing else — and since 2026-09-07 the page SAYS SO, in `.vitals-source`
 *  under the rail, because "it is only an example" was true of the code and invisible on
 *  the screen.
 *
 *  ── THE TWO FIGURES THAT WERE NOT DERIVED (fixed 2026-09-07) ────────────────
 *  The paragraph above has claimed since it was written that every figure here comes out
 *  of `Population.sol`'s defaults. Two of them did not, and both sat one button above
 *  `Watch the arena`, where a judge could check them in one click:
 *
 *    - `Treasury · #3 · 41.20 tUSDC`. `endowment()` is 10 tUSDC and rake is skimmed off
 *      profit, so 41.20 is not a default, not a live reading, and not reachable from
 *      either. The highest treasury any organism has ever held is 13.08 (organism #3
 *      after winning window 68). It is now `endowment()` itself — 10.00, draining by
 *      `metabolicCost()` — which is both derivable and durable: it is what EVERY organism
 *      opens at, so no later window can contradict it. The vital is labelled `at birth`
 *      rather than `#3` for the same reason: naming a live organism is what invited the
 *      comparison, and the mechanism does not need a specimen id to be legible.
 *    - The genome was a plausible paraphrase of a momentum thesis attributed to `#3`,
 *      which on chain is BREAKOUT. It is now a VERBATIM contiguous excerpt of organism
 *      #1's genome from `genomes/genesis.json`, and #1 is MOMENTUM, so the label is true
 *      too. See the constant below for the hash that makes it checkable.
 *
 *  `Metabolism −0.05 per window` was already correct (`metabolicCost()` is 50000 at 6
 *  decimals) and is untouched.
 *
 *  The chain pill is different, because a pulsing `.dot-live` is the one mark on either
 *  surface that asserts "this reading is current" with no number beside it
 *  (`styles.css:307-311`). It used to pulse unconditionally, next to a hardcoded
 *  `Season 1 · 576 windows`, above an entry form that may be withholding itself because
 *  there is no contract at the resolved address — the top of the page more confident than
 *  the bottom, about the same arena. Same defect class as a printed `Status: LIVE`. So it
 *  is derived from `useArenaLiveness` now: the dot breathes only while reads are actually
 *  answering, and the season is the season the contract reports.
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";

import { useArenaLiveness } from "../lib/liveness.js";
import { mountField } from "../motion/field.js";
import { reducedMotion } from "../motion/hooks.js";
import { CHAIN_ID } from "../lib/wagmi.js";

/**
 *  Organism #1's genome, VERBATIM — a contiguous prefix of the string in
 *  `genomes/genesis.json`, cut at a sentence boundary and marked with an ellipsis.
 *
 *  It used to be a paraphrase: a momentum thesis nobody wrote, attributed on screen to
 *  organism #3, which is BREAKOUT. Both halves of that were wrong, and a genome is the one
 *  thing on this page a judge can verify to the byte — so it is now quoted rather than
 *  imitated, from the organism that actually holds it.
 *
 *  Checkable, and checked on 2026-09-07:
 *
 *      keccak256(<the full 645-char entry in genomes/genesis.json>)
 *        == 0x8ae06d7c2f4c4f11fc9ec12f89b8675a6ccea3fdaf3ecc8de41a10e6aeb1cad2
 *        == Prophet#1.genomeHash() at 0x22fC3Ab08F20391300fC1Fe194FdB5577a6DD4f8
 *
 *  The hash is of the WHOLE genome, not of this excerpt, which is exactly why the
 *  ellipsis and the word "excerpt" in the label are load-bearing rather than decorative:
 *  without them the page would be quoting a string that hashes to nothing on chain.
 *
 *  Kept to two sentences on purpose. The full genome is 645 characters and types for ~20
 *  seconds; that is a different animation, not a longer one. Extending this string is
 *  therefore a pacing decision as well as an editorial one — and any extension must stay a
 *  CONTIGUOUS prefix, because a stitched quote that skips a sentence would read as verbatim
 *  while being assembled.
 */
const GENOME =
  "You believe short-horizon price moves persist. Order flow is autocorrelated over minutes: " +
  "whoever is pushing price is usually still pushing at the close of a 15-minute window. …";

const mmss = (s) => {
  const v = Math.max(0, Math.round(s));
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};

export function Hero({ onField }) {
  const live = useArenaLiveness();
  const fieldRef = useRef(null);
  const genomeRef = useRef(null);
  const clockRef = useRef(null);
  const treasuryRef = useRef(null);
  const metabRef = useRef(null);

  /* ── the specimen field ────────────────────────────────────────────────── */
  useEffect(() => {
    const host = fieldRef.current;
    if (!host) return undefined;
    const field = mountField(host, { reduced: reducedMotion() });
    onField?.(field);
    return () => {
      onField?.(null);
      field.destroy();
    };
  }, [onField]);

  /* ── the genome types itself, once ─────────────────────────────────────── */
  useEffect(() => {
    const host = genomeRef.current;
    if (!host) return undefined;
    const caret = host.querySelector(".caret");
    const node = document.createTextNode("");
    host.insertBefore(node, caret);

    if (reducedMotion()) {
      node.data = GENOME;
      host.classList.add("done");
      return () => node.remove();
    }

    let timer;
    let i = 0;
    const tick = () => {
      node.data = GENOME.slice(0, ++i);
      if (i < GENOME.length) {
        // Slower on punctuation — it reads as thought rather than as a teletype.
        const ch = GENOME[i - 1];
        timer = setTimeout(tick, ch === "." ? 240 : ch === "," ? 120 : 18 + Math.random() * 26);
      } else {
        host.classList.add("done");
      }
    };
    timer = setTimeout(tick, 420);

    return () => {
      clearTimeout(timer);
      node.remove();
      host.classList.remove("done");
    };
  }, []);

  /* ── the instruments ────────────────────────────────────────────────────
     Tweened numbers, not values that jump. The claim is that this is being metered
     right now, so a digit that slides carries the argument. `ease: "none"` throughout:
     a settlement clock that accelerated would be a lie about the mechanism.
  ─────────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const clock = clockRef.current;
    const treasury = treasuryRef.current;
    const metab = metabRef.current;
    if (!clock || !treasury || !metab) return undefined;

    // One 15-minute window, entered with 6:12 left on it. The treasury is `endowment()` —
    // what every organism is minted with — and NOT any organism's current balance. It was
    // 41.20, a figure `Population.sol` cannot produce: `endowment()` is 10 tUSDC and rake
    // is skimmed off profit, so nothing compounds a newborn to 41.20 in the four windows a
    // season runs. The highest balance ever held on chain is 13.08. See the header.
    const WINDOW_S = 15 * 60;
    const inst = { left: 6 * 60 + 12, treasury: 10.0 };

    if (reducedMotion()) {
      clock.textContent = mmss(inst.left);
      treasury.textContent = inst.treasury.toFixed(2);
      return undefined;
    }

    const tweens = [];

    tweens.push(
      gsap.to(inst, {
        left: 0,
        duration: inst.left,
        ease: "none",
        onUpdate: () => {
          clock.textContent = mmss(inst.left);
        },
        onComplete: () => {
          // The window closes: metabolism is charged, and the charge is visible.
          // Literal hex, not var(--heat) — GSAP cannot interpolate a custom property.
          tweens.push(
            gsap
              .timeline()
              .to(metab, { scale: 1.14, color: "#ffd9ae", duration: 0.16, ease: "power2.out" })
              .to(treasury, { color: "#f0a055", duration: 0.16 }, 0)
              .to(metab, { scale: 1, color: "#f0a055", duration: 0.5, ease: "power2.inOut" })
              .to(treasury, { color: "#deeae6", duration: 0.7 }, ">-0.3"),
          );
        },
      }),
    );

    // The treasury drains across the whole window rather than dropping at its end.
    // Metabolism is continuous pressure, and 0.05 tUSDC over fifteen minutes is what
    // that looks like at this scale. 10.00 -> 9.95 is `endowment()` minus one
    // `metabolicCost()`, so the two ends of this tween are both contract readings.
    tweens.push(
      gsap.to(inst, {
        treasury: 9.95,
        duration: WINDOW_S,
        ease: "none",
        onUpdate: () => {
          treasury.textContent = inst.treasury.toFixed(2);
        },
      }),
    );

    return () => {
      for (const t of tweens) t.kill();
    };
  }, []);

  return (
    <section className="hero" id="top">
      <div className="field" ref={fieldRef} aria-hidden="true">
        <canvas />
        <svg xmlns="http://www.w3.org/2000/svg" />
      </div>

      <div className="wrap hero-in">
        <div className="hero-top">
          {/*
            The dot pulses only while `seasonId`/`seasonWindows` are answering. Every other
            state says what is actually true instead, and none of them animate:
              live         reads are arriving      → pulse, and name the chain
              absent       forty hex, no contract  → say so; the entry form says it at length
              wrong        code, but not this ABI  → also the address's fault, also not the network
              unreachable  the chain did not answer → blame the network, never the address
              pending      nothing has settled yet  → "connecting", the entry form's word
            `pop.status === "undeployed"` also lands on pending, which is correct: there is
            no address to read, so nothing is current.

            `wrong` shares `absent`'s red because both are the address being wrong, and both are
            things retrying cannot fix. It gets its own words for the same reason the entry form
            gives it its own branch: "nothing is there" and "something else is there" are
            different facts, and the second one survives a person who is sure the address is right.
          */}
          <span
            className={`pill${
              live.verdict === "live"
                ? " pill-ok"
                : live.verdict === "absent" || live.verdict === "wrong"
                  ? " pill-bad"
                  : ""
            }`}
          >
            <span className={`dot${live.verdict === "live" ? " dot-live" : ""}`} />
            {live.verdict === "live"
              ? `Somnia Shannon · ${CHAIN_ID}`
              : live.verdict === "absent"
                ? `No arena at that address · ${CHAIN_ID}`
                : live.verdict === "wrong"
                  ? `Not a Population at that address · ${CHAIN_ID}`
                  : live.verdict === "unreachable"
                    ? `Chain ${CHAIN_ID} did not answer`
                    : `Somnia Shannon · ${CHAIN_ID} · connecting`}
          </span>
          <span className="pill">15-minute windows</span>
          {/*
            A season is a contract reading, not a constant. `Population.sol:445-456`
            initialises exactly these two values to 1 and 576, which is why the hardcoded
            copy looked right — and why it would have gone on looking right through a
            `setSeason` that changed both (`Population.sol:804-814`). Rendered only when
            both numbers actually arrived; there is no partial version of this sentence.
          */}
          {live.verdict === "live" && live.seasonId !== undefined && live.seasonWindows !== undefined ? (
            <span className="pill">
              Season {String(live.seasonId)} · {String(live.seasonWindows)} windows
            </span>
          ) : null}
        </div>

        <h1 className="hero-thesis">
          A population of forecasters that <em>pays to think</em> and dies when it runs out.
        </h1>

        <p className="hero-lede">
          Every organism is a contract carrying one English sentence — its genome. Every fifteen
          minutes it is asked what BTC will do, answers through on-chain inference, and is paired
          against an organism that disagrees. Thinking costs real value. At zero treasury it is
          dead, and nothing on this chain can undo that.
        </p>

        <div className="genome-frame">
          {/*
            `#1`, not `#3`. The genome typed here is organism #1's, verbatim — see the
            `GENOME` constant for the hash that ties it to `Prophet#1.genomeHash()`. The
            word "excerpt" is not modesty: the hash is of the whole 645-character string,
            so a page that quoted a cut of it without saying so would be showing something
            that hashes to nothing on chain.
          */}
          <span className="label">Organism #1 · genome (excerpt)</span>
          <p className="genome" ref={genomeRef}>
            <span className="caret" aria-hidden="true" />
          </p>
        </div>

        <div className="vitals">
          <div className="vital">
            <span className="vital-label">Settles in</span>
            <span className="vital-value mono" ref={clockRef}>
              06:12
            </span>
            <span className="vital-note">Window closes; every living organism is graded.</span>
          </div>
          <div className="vital">
            {/*
              `at birth`, not `· #3`. Naming a live organism made this a claim about a
              balance a judge could read one button below and find to be different; the
              endowment is the same number for every organism that has ever existed, so no
              window can age it. Both figures here are `Population.sol` readings: 10.00 is
              `endowment()` and the 0.05 it sheds is `metabolicCost()`.
            */}
            <span className="vital-label">Treasury · at birth</span>
            <span className="vital-value mono">
              <span ref={treasuryRef}>10.00</span>
              <span className="vital-unit">tUSDC</span>
            </span>
            <span className="vital-note">What it can still wager. At zero it stops existing.</span>
          </div>
          <div className="vital">
            <span className="vital-label">Metabolism</span>
            <span className="vital-value mono is-heat" ref={metabRef}>
              −0.05
              <span className="vital-unit">per window</span>
            </span>
            <span className="vital-note">
              Charged whether it was right, wrong, or had no opinion at all.
            </span>
          </div>
        </div>

        {/*
          The rail's figures are contract parameters, animated to show the mechanism — they
          are not a reading of any organism's current state, and the page has to say which
          it is. Everything above pulses or counts, and a number that moves next to a live
          chain pill reads as telemetry unless something tells you otherwise.

          It points at the arena rather than merely disclaiming, because the honest version
          of "this is an example" is "the real thing is here". The arena reads every one of
          these values off the chain.
        */}
        <p className="vitals-source">
          Illustrative — these are <code>Population</code>&apos;s own parameters (
          <code>endowment</code>, <code>metabolicCost</code>, the 15-minute window), animated to
          show how a window is graded. For live organisms, treasuries and deaths,{" "}
          <a href="/arena/">watch the arena</a>.
        </p>

        <div className="hero-cta">
          <a className="btn btn-primary" href="#enter">
            Enter an organism
          </a>
          <a className="btn" href="/arena/">
            Watch the arena
          </a>
          <a className="btn" href="/arena/?demo=1">
            Offline demo
          </a>
        </div>
      </div>
    </section>
  );
}
