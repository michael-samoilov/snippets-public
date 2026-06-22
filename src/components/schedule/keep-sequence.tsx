"use client";

/* ── the keep sequence ────────────────────────────────────────────
   Orchestrates the beats when a snippet is kept, locally and decoupled from
   Dexie's live-query re-render, so the order reads right instead of backwards
   (composer snapping empty, page reshuffling, and only THEN the card):

       idle → pressing → carding → composing → idle

   • pressing  — the wax seal plays its press (bump `sealKey`); the composer
                 holds (its words don't vanish yet).
   • carding   — the kept card is born into its day slot.
   • composing — only now does the empty composer wipe back in below it. */

import { useCallback, useEffect, useRef, useState } from "react";

export type Phase = "idle" | "pressing" | "carding" | "composing";

/** The shipped keep's beats — flow A, a corner press that swells and fades.
    pressMs ≈ the canvas press (~1150ms) + a hold before the seal lifts and the
    card is born; cardMs is the seal's exit beat; composeMs is the empty
    composer's slow wipe-in (a once-or-twice-a-day beat). */
export type KeepBeats = { pressMs: number; cardMs: number; composeMs: number };
export const KEEP_BEATS: KeepBeats = { pressMs: 1700, cardMs: 420, composeMs: 1100 };

// ── the orchestrator ──────────────────────────────────────────────
export function useKeepSequence(beats: KeepBeats, reduce = false) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sealKey, setSealKey] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearAll, [clearAll]);

  const start = useCallback(() => {
    clearAll();
    setSealKey((k) => k + 1);
    setPhase("pressing");
    const press = reduce ? 0 : beats.pressMs;
    const card = reduce ? 0 : beats.cardMs;
    const compose = reduce ? 0 : beats.composeMs;
    timers.current.push(setTimeout(() => setPhase("carding"), press));
    timers.current.push(setTimeout(() => setPhase("composing"), press + card));
    timers.current.push(setTimeout(() => setPhase("idle"), press + card + compose));
  }, [beats, reduce, clearAll]);

  return { phase, sealKey, start };
}
