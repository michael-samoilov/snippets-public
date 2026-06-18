"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { WaxStamp, type Tint } from "@/components/capture/wax-stamp";

/* The masthead wordmark: a pressed wax seal stamped with the letter "S" (it
   replaces the old wax dot), with "nippets" tucked over the seal's right edge.
   Paper: a lighter-blue seal with a deep-ink S. Lamplight: a deep-blue seal with
   a light S, and a soft drop shadow on "nippets" (see .wordmark-tail in
   globals.css) echoing the seal's own contact shadow. The press plays once on
   load; reduced motion and re-renders (theme toggles) settle without replaying. */

const LIGHT_BLUE: Tint = { wax: "#5b8cc0", bright: "#6f9fd0", shadow: "#142841" };
const DEEP_BLUE: Tint = { wax: "#2e5685", bright: "#3d6b9e", shadow: "#0a1a2e" };
const DARK_S_INK = "#120f0b"; // the deep-ink S on Paper (the text ink, darkened)
const LIGHT_S_INK = "#eae1cd"; // the light S on Lamplight (matches the light text)

const FONT_PX = 20.8;       // 1.3rem masthead size
const SEAL_RATIO = 2.1;     // seal diameter / font size
const OVERLAP = 0.38;       // how far "nippets" laps over the seal's right edge
const VNUDGE = 0.22;        // vertical nudge so the S sits at the text's height

export function Wordmark() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  // resolvedTheme is only known after mount; gate the (theme-coloured) seal so it
  // never paints the wrong recipe, then let the press play once.
  const [mounted, setMounted] = useState(false);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setMounted(true);
    const t = setTimeout(() => setSettled(true), 1500);
    return () => clearTimeout(t);
  }, []);

  const sealPx = Math.round(FONT_PX * SEAL_RATIO);

  return (
    <Link
      href="/"
      aria-label="Snippets"
      className="voice-display pressable inline-flex items-center text-[1.3rem] italic leading-none tracking-tight text-ink"
    >
      <span className="relative inline-block shrink-0" style={{ width: sealPx, height: sealPx, marginTop: VNUDGE * FONT_PX }}>
        {mounted && (
          <WaxStamp
            playKey={1}
            size={sealPx}
            glyph="S"
            mode="press"
            still={settled}
            tint={dark ? DEEP_BLUE : LIGHT_BLUE}
            glyphColor={dark ? LIGHT_S_INK : DARK_S_INK}
            variant="spring"
          />
        )}
      </span>
      <span className="wordmark-tail relative z-10" style={{ marginLeft: -OVERLAP * sealPx }}>nippets</span>
    </Link>
  );
}
