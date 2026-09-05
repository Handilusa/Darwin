/**
 *  Motion hooks shared by the landing's sections.
 *
 *  Two rules hold for everything here, and they are the same two the arena console
 *  documents in `web/js/motion.js`:
 *
 *    1. Under `prefers-reduced-motion` every hook is a no-op and the page renders
 *       complete and static. Motion is an enhancement, never a prerequisite for
 *       reading the page.
 *    2. Anything that tweens FROM `opacity: 0` must be able to fail safe. Here the
 *       `.rise` class that hides an element is added by script, inside the effect that
 *       is about to animate it — so a browser that never runs this code, or one that
 *       asked for reduced motion, never hides anything in the first place.
 */

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/** One source of truth for the reduced-motion question, read fresh at each call. */
export function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 *  Reveal the elements matching `selector` inside the returned ref as they scroll in.
 *
 *  `fromTo`, never `to`: an explicit start value beats making GSAP infer one by reading
 *  a class back out of the cascade, which is how an element ends up animating from
 *  whatever the last render left it at.
 */
export function useReveal(selector = "[data-rise]") {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || reducedMotion()) return undefined;

    const els = Array.from(root.querySelectorAll(selector));
    const tweens = els.map((el) => {
      el.classList.add("rise");
      return gsap.fromTo(
        el,
        { opacity: 0, y: 14 },
        {
          opacity: 1,
          y: 0,
          duration: 0.62,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
          onStart: () => el.classList.add("lit"),
          // Belt and braces: if a ScrollTrigger is killed before it fires (a fast
          // unmount, a layout that never reaches the element) the element must not
          // be left invisible.
          onComplete: () => el.classList.remove("rise"),
        },
      );
    });

    return () => {
      for (const t of tweens) {
        t.scrollTrigger?.kill();
        t.kill();
      }
      for (const el of els) el.classList.remove("rise");
    };
  }, [selector]);

  return ref;
}

/**
 *  Tween a number into a DOM node's text, formatted by `format`.
 *
 *  The page's claim is that this is being metered right now. A digit that slides carries
 *  that; a digit that snaps into place undercuts it. `ease: "none"` is the default here
 *  on purpose — a settlement clock that accelerates would be a lie about the mechanism.
 *
 *  Returns a ref to attach to the element holding the number.
 */
export function useCounter({
  from,
  to,
  duration = 1.2,
  format = (v) => String(Math.round(v)),
  ease = "none",
  start = "top 85%",
  onDone,
}) {
  const ref = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (reducedMotion()) {
      el.textContent = format(to);
      doneRef.current?.();
      return undefined;
    }

    const state = { v: from };
    el.textContent = format(from);

    const tween = gsap.to(state, {
      v: to,
      duration,
      ease,
      scrollTrigger: { trigger: el, start, once: true },
      onUpdate: () => {
        el.textContent = format(state.v);
      },
      onComplete: () => doneRef.current?.(),
    });

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [from, to, duration, ease, start, format]);

  return ref;
}

/**
 *  Scale a bar's fill along X as it scrolls in — a treasury draining, not a progress bar
 *  filling. `transformOrigin` is left, so what shrinks is the right-hand end: the
 *  organism keeps what it has not yet spent.
 */
export function useDrain({ from = 1, to = 0.62, duration = 2.4 }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (reducedMotion()) {
      el.style.transform = `scaleX(${to})`;
      return undefined;
    }

    const tween = gsap.fromTo(
      el,
      { scaleX: from },
      {
        scaleX: to,
        duration,
        ease: "none",
        scrollTrigger: { trigger: el, start: "top 88%", once: true },
      },
    );

    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [from, to, duration]);

  return ref;
}

/**
 *  Fire `fn` once, the first time `selector` scrolls into view.
 *
 *  `once: true` is load-bearing where this is used: it is what makes the death on the
 *  irreversibility beat unrepeatable, matching a contract with no path that clears
 *  `dead`. Scrolling back up must not bring anything back to life.
 */
export function useOnceOnScroll(selector, fn, { start = "top 78%" } = {}) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (reducedMotion()) return undefined;
    const el = document.querySelector(selector);
    if (!el) return undefined;

    const st = ScrollTrigger.create({
      trigger: el,
      start,
      once: true,
      onEnter: () => fnRef.current?.(),
    });

    return () => st.kill();
  }, [selector, start]);
}

/**
 *  Draw an SVG path as it scrolls in — the lineage tree in beat 5, and the same
 *  technique the hero's threads use. `getTotalLength` needs the path to be laid out,
 *  so this runs in an effect rather than at render.
 */
export function useDrawPaths(stagger = 0.14) {
  const ref = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return undefined;

    const paths = Array.from(root.querySelectorAll("path[data-draw]"));
    if (paths.length === 0) return undefined;

    if (reducedMotion()) {
      for (const p of paths) {
        p.style.strokeDasharray = "none";
        p.style.strokeDashoffset = "0";
      }
      return undefined;
    }

    const tweens = paths.map((p, i) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
      return gsap.to(p, {
        strokeDashoffset: 0,
        duration: 0.9,
        delay: i * stagger,
        ease: "power2.inOut",
        scrollTrigger: { trigger: root, start: "top 82%", once: true },
      });
    });

    return () => {
      for (const t of tweens) {
        t.scrollTrigger?.kill();
        t.kill();
      }
    };
  }, [stagger]);

  return ref;
}
