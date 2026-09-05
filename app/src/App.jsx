/**
 *  The page.
 *
 *  Six beats in the order an argument has to be made in: what an organism *is*, what a
 *  window *does*, what thinking *costs*, what death *means*, what accumulates, and then —
 *  only then — the form. A visitor who never reaches the form should still leave knowing
 *  what was built; a judge who scrolls straight to it should find live numbers rather than a
 *  brochure.
 *
 *  ── THE ONE PIECE OF WIRING THAT MATTERS ────────────────────────────────────
 *  `Hero` mounts the specimen field and hands its `die` handle up here. When `#death`
 *  scrolls into view, the organism the visitor has been watching breathe in the hero goes
 *  out — at the same moment as the close-up on that beat, and permanently. Scroll back to
 *  the top and it is still ash.
 *
 *  That is not a flourish. `test_death_isIrreversible` and `test_upgrade_cannotRevive` assert
 *  that no path in the contracts clears `dead`, and a page that quietly restored the
 *  organism when you scrolled away would be contradicting its own product on screen. So the
 *  handle is held in a ref (state would re-render the page for an event nothing renders),
 *  `useOnceOnScroll` fires with `once: true`, and nothing anywhere calls a revive.
 *
 *  ── WHY onField IS A useCallback ────────────────────────────────────────────
 *  `Hero`'s mount effect lists `onField` in its dependencies, so a fresh function identity
 *  on each render would tear down and rebuild the whole field — twelve heartbeats restarting
 *  in lockstep every time React re-renders for any reason at all. Stable identity keeps the
 *  field mounted exactly once for the life of the page.
 */

import { useCallback, useRef } from "react";

import { Nav } from "./sections/Nav.jsx";
import { Hero } from "./sections/Hero.jsx";
import { BeatGenome } from "./sections/BeatGenome.jsx";
import { BeatWindow } from "./sections/BeatWindow.jsx";
import { BeatCognition } from "./sections/BeatCognition.jsx";
import { BeatDeath } from "./sections/BeatDeath.jsx";
import { BeatLineage } from "./sections/BeatLineage.jsx";
import { Enter } from "./sections/Enter.jsx";
import { Footer } from "./sections/Footer.jsx";

import { DOOMED } from "./motion/field.js";
import { useOnceOnScroll } from "./motion/hooks.js";

export default function App() {
  const fieldRef = useRef(null);

  const onField = useCallback((field) => {
    fieldRef.current = field;
  }, []);

  // Child effects run before this one, so by the time the trigger is created the hero's
  // field is mounted and `#death` is in the document.
  useOnceOnScroll("#death", () => fieldRef.current?.die(DOOMED), { start: "top 62%" });

  return (
    <>
      <a className="vh" href="#genome">
        Skip to the explanation
      </a>

      <Nav />

      <main>
        <Hero onField={onField} />
        <BeatGenome />
        <BeatWindow />
        <BeatCognition />
        <BeatDeath />
        <BeatLineage />
        <Enter />
      </main>

      <Footer />
    </>
  );
}
