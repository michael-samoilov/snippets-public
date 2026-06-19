"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp, type Tint } from "@/components/capture/wax-stamp";

/* The masthead wordmark: a pressed wax seal stamped with the letter "S" (it
   replaces the old wax dot), with "nippets" tucked over the seal's right edge.
   Paper: a deep-blue seal with a deep-ink S, rendered straight onto the sheet —
   the wordmark is exempt from the .voice-display multiply (globals.css) so the
   cream can't tint the wax. Lamplight: the same deep-blue seal with a light S,
   and a soft drop shadow on "nippets" (.wordmark-tail) echoing the seal's own
   contact shadow.

   Alignment is deterministic across engines: the row aligns on the text BASELINE
   (so the tight line box of italic Fraunces, which WebKit and Blink distribute
   differently, can't shift it), and the seal is nudged with a transform so the
   embossed S's baseline meets "nippets". The press plays once on load and again
   on tap; reduced motion and re-renders settle without replaying. */

const LIGHT_BLUE: Tint = { wax: "#2e5685", bright: "#3d6b9e", shadow: "#142841" };
const DEEP_BLUE: Tint = { wax: "#2e5685", bright: "#3d6b9e", shadow: "#0a1a2e" };
const DARK_S_INK = "#120f0b";  // the deep-ink S on Paper
const LIGHT_S_INK = "#eae1cd"; // the light S on Lamplight

const SEAL_RATIO = 2.1;   // seal diameter / font size
const OVERLAP = 0.37;     // "nippets" laps this fraction of the seal (over the wax, right of the S)
const NUDGE = 0.04;       // small seal down-shift (× seal) so the S's baseline meets the text

export function Wordmark() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const ref = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [fontPx, setFontPx] = useState(20.8);
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  const [playKey, setPlayKey] = useState(1);

  const armSettle = () => {
    clearTimeout(timer.current);
    setSettled(false);
    timer.current = setTimeout(() => setSettled(true), 1500);
  };
  useEffect(() => {
    setMounted(true);
    if (ref.current) {
      const fs = parseFloat(getComputedStyle(ref.current).fontSize);
      if (fs > 0) setFontPx(fs);
    }
    setSettled(true); // no entrance animation on load — the press plays only on tap (home)
    return () => clearTimeout(timer.current);
  }, []);

  const sealPx = Math.round(fontPx * SEAL_RATIO);

  return (
    <Link
      ref={ref}
      href="/"
      aria-label="Snippets"
      onClick={() => { setPlayKey((k) => k + 1); armSettle(); }}
      className="wordmark voice-display pressable inline-flex items-center text-[1.3rem] italic tracking-tight text-ink"
    >
      <span className="relative inline-block shrink-0" style={{ width: sealPx, height: sealPx, transform: `translateY(${NUDGE * sealPx}px)` }}>
        {mounted && (
          <WaxStamp
            playKey={playKey}
            size={sealPx}
            glyph="S"
            mode="press"
            still={settled}
            tint={dark ? DEEP_BLUE : LIGHT_BLUE}
            glyphColor={dark ? LIGHT_S_INK : DARK_S_INK}
            variant="spring"
            rotate={30}
            superSample={2}
          />
        )}
      </span>
      {/* "nippets" laps onto the seal's right edge. In Paper it multiplies into
          the sheet (ink on paper); over the wax, though, that multiply would
          turn the overlapping letters near-black. A paper-coloured copy sits
          beneath them so the ink multiplies against paper across the whole word
          — the wax shows through untouched. Lamplight doesn't multiply (the seal
          is on a dark sheet), so it needs no backing. */}
      <span
        className="relative z-10 grid"
        style={{ marginLeft: -OVERLAP * sealPx, lineHeight: `${sealPx}px` }}
      >
        {!dark && (
          <span aria-hidden="true" className="col-start-1 row-start-1" style={{ color: "var(--paper)" }}>
            nippets
          </span>
        )}
        <span className="wordmark-tail col-start-1 row-start-1">nippets</span>
      </span>
    </Link>
  );
}
