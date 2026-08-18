"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { WaxStamp, type Tint } from "@/components/capture/wax-stamp";
import { ICON_SEAL } from "@/lib/seal-spec";
import { copy } from "@/lib/copy";

/* The masthead wordmark: a pressed wax seal stamped with the letter "S" (it
   replaces the old wax dot), with "nippets" tucked over the seal's right edge.
   The whole wordmark is exempt from the .voice-display multiply (globals.css)
   so the cream sheet can't tint the wax; the seal is the same vibrant blue in
   both themes. In Lamplight "nippets" carries a soft dark drop shadow
   (.dark .wordmark-tail) to sit on the dark sheet; in Paper it's plain ink.

   Alignment is deterministic across engines: the row aligns on the text BASELINE
   (so the tight line box of italic Fraunces, which WebKit and Blink distribute
   differently, can't shift it), and the seal is nudged with a transform so the
   embossed S's baseline meets "nippets". The press plays once on load and again
   on tap; reduced motion and re-renders settle without replaying. */

// Exported for the OG-image lab (/lab/og), which restates the wordmark statically.
export const LIGHT_BLUE: Tint = { wax: "#5b8cc0", bright: "#6f9fd0", shadow: "#142841" };
export const DEEP_BLUE: Tint = { wax: "#2e5685", bright: "#3d6b9e", shadow: "#0a1a2e" };
const DARK_S_INK = "#120f0b";  // the deep-ink S on Paper
const LIGHT_S_INK = "#eae1cd"; // the light S on Lamplight

// "has this hydrated yet?" as a value, not as an effect: the server
// snapshot is false and the client snapshot is true, so the canvas seal
// stays out of the server render without a mount flag.
const subscribeNever = () => () => {};
const onServer = () => false;
const onClient = () => true;

const SEAL_RATIO = 2.1;   // seal diameter / font size
const OVERLAP = 0.37;     // "nippets" laps this fraction of the seal (over the wax, right of the S)
const NUDGE = 0.04;       // small seal down-shift (× seal) so the S's baseline meets the text

export function Wordmark() {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const ref = useRef<HTMLAnchorElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [fontPx, setFontPx] = useState(20.8);
  const hydrated = useSyncExternalStore(subscribeNever, onClient, onServer);
  // the press plays on tap, never on load, so the seal starts at rest
  const [settled, setSettled] = useState(true);
  // the resting shape is the canonical seal (same seed the app icon bakes), so
  // the masthead and the home-screen icon wear one silhouette. A tap still
  // reshuffles as before; the colours stay the per-theme blues below.
  const [playKey, setPlayKey] = useState(ICON_SEAL.seed);

  const armSettle = () => {
    clearTimeout(timer.current);
    setSettled(false);
    timer.current = setTimeout(() => setSettled(true), 1500);
  };
  // the canvas needs the seal's size in pixels, so read the rendered font size
  // rather than sizing in em. A ResizeObserver reports the first measurement on
  // observe and every later one, so the seal also tracks a font-size change
  // instead of holding the value it happened to see at mount.
  useEffect(() => {
    const el = ref.current;
    if (!el) return () => clearTimeout(timer.current);
    const measure = () => {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs > 0) setFontPx(fs);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(timer.current);
    };
  }, []);

  const sealPx = Math.round(fontPx * SEAL_RATIO);

  return (
    <Link
      ref={ref}
      href="/calendar"
      aria-label={copy.app.name}
      onClick={(e) => {
        setPlayKey((k) => k + 1);
        armSettle();
        // already on the calendar → glide to today's zone instead of a no-op
        // re-navigation (which wouldn't move the scroll). Elsewhere, let the Link
        // navigate to /calendar, which opens on today on its own.
        if (window.location.pathname === "/calendar") {
          e.preventDefault();
          window.dispatchEvent(new Event("snippets:go-today"));
        }
      }}
      className="wordmark voice-display pressable inline-flex items-center text-[1.3rem] italic tracking-tight text-ink"
    >
      <span className="relative inline-block shrink-0" style={{ width: sealPx, height: sealPx, transform: `translateY(${NUDGE * sealPx}px)` }}>
        {hydrated && (
          <WaxStamp
            playKey={playKey}
            size={sealPx}
            glyph="S"
            mode="press"
            still={settled}
            tint={dark ? DEEP_BLUE : LIGHT_BLUE}
            glyphColor={dark ? LIGHT_S_INK : DARK_S_INK}
            variant="spring"
            superSample={2}
          />
        )}
      </span>
      {/* "nippets" laps onto the seal's right edge. It is never blended into the
          sheet (the .wordmark exemption, globals.css); Lamplight adds a soft
          dark drop shadow (.dark .wordmark-tail), Paper leaves it as plain ink. */}
      <span
        className="wordmark-tail relative z-10"
        style={{ marginLeft: -OVERLAP * sealPx, lineHeight: `${sealPx}px` }}
      >
        nippets
      </span>
    </Link>
  );
}
