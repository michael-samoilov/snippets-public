"use client";

/* ── the keep sequence ────────────────────────────────────────────
   The shared seam between the schedule-submit LAB and production. It owns
   the ONE thing the current flow gets wrong: the order of beats when a
   snippet is kept.

   Today the visuals are slaved to Dexie's live-query re-render, so the
   composer snaps back to empty, the page reshuffles, and only THEN the
   card fades in — backwards. Here the sequence is orchestrated locally and
   decoupled from the write:

       idle → pressing → carding → composing → idle

   • pressing  — the wax seal plays its press (bump `sealKey`); the composer
                 holds (its words don't vanish yet).
   • carding   — the kept card is born into its day slot (the flow's birth).
   • composing — only now does the empty composer wipe back in below it.

   A `FlowSpec` is the dial-set the lab tunes and production ships. The lab
   drives this with mock data; production hands `start()` the real keep. */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, type TargetAndTransition, type Transition } from "motion/react";
import { cn } from "@/lib/utils";

export type FlowId = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type Grade = "lush" | "quick";
export type Phase = "idle" | "pressing" | "carding" | "composing";
export type ComposerReturn = "wipe" | "paint" | "fade";
export type SealPos = "corner" | "centre" | "travel";
export type Birth = "rise" | "morph" | "impact" | "emboss" | "file" | "quiet";

export const FLOWS: { id: FlowId; name: string; blurb: string }[] = [
  { id: "A", name: "Seal & settle", blurb: "Press → the card rises into its slot → the composer wipes in. Sequential, literal." },
  { id: "B", name: "Wax-to-card morph", blurb: "The pressed puck unfolds into the tile — the stamp itself becomes the kept card." },
  { id: "C", name: "Impact ripple", blurb: "The wax landing recoils the stack below; the card drops in carrying the impact." },
  { id: "D", name: "Ink-dry, then seal", blurb: "The words set and dry first, then the seal confirms, then the card slides up." },
  { id: "E", name: "Lift & file", blurb: "The composer IS the card: its paint completes, it files upward, a fresh composer wipes in." },
  { id: "F", name: "Press-in emboss", blurb: "The card is pressed into being in place — paint, shadow and ink rise on the seal's relief. Nothing slides." },
  { id: "G", name: "Quiet keep", blurb: "The everyday budget grade — short press, small rise, wipe. Honours the frequency rule." },
];

export type FlowSpec = {
  id: FlowId;
  /** delay from keep → the card's birth (the press read). */
  pressMs: number;
  /** the card's birth duration before the composer returns. */
  cardMs: number;
  /** the composer's wipe-in duration. */
  composeMs: number;
  birth: Birth;
  sealPos: SealPos;
  /** the stack below recoils on the wax landing. */
  recoil: boolean;
  /** the composer holds its words through the press, then completes (flow E). */
  liftAndFile: boolean;
  /** the typed words "dry" before the press (flow D). */
  inkDry: boolean;
  composerReturn: ComposerReturn;
  /** keep the typeset "Kept." confirmation, or let the seal speak alone. */
  keptWord: boolean;
};

// the lush, per-session-or-day grade. `resolveFlow` derives the quick grade.
// composeMs is the empty composer's wipe-in (slow by design — the page settling
// back, not a frequent beat); the lab's speed dial scales it (and the rest).
const BASE: Record<FlowId, FlowSpec> = {
  A: { id: "A", pressMs: 520, cardMs: 380, composeMs: 560, birth: "rise", sealPos: "corner", recoil: false, liftAndFile: false, inkDry: false, composerReturn: "wipe", keptWord: false },
  B: { id: "B", pressMs: 600, cardMs: 460, composeMs: 560, birth: "morph", sealPos: "centre", recoil: false, liftAndFile: false, inkDry: false, composerReturn: "wipe", keptWord: false },
  C: { id: "C", pressMs: 300, cardMs: 420, composeMs: 560, birth: "impact", sealPos: "centre", recoil: true, liftAndFile: false, inkDry: false, composerReturn: "wipe", keptWord: false },
  D: { id: "D", pressMs: 720, cardMs: 380, composeMs: 600, birth: "rise", sealPos: "corner", recoil: false, liftAndFile: false, inkDry: true, composerReturn: "fade", keptWord: false },
  E: { id: "E", pressMs: 460, cardMs: 460, composeMs: 600, birth: "file", sealPos: "corner", recoil: false, liftAndFile: true, inkDry: false, composerReturn: "wipe", keptWord: false },
  F: { id: "F", pressMs: 120, cardMs: 620, composeMs: 560, birth: "emboss", sealPos: "centre", recoil: false, liftAndFile: false, inkDry: false, composerReturn: "wipe", keptWord: false },
  G: { id: "G", pressMs: 220, cardMs: 260, composeMs: 420, birth: "quiet", sealPos: "corner", recoil: false, liftAndFile: false, inkDry: false, composerReturn: "wipe", keptWord: true },
};

/** the lush base, or a tightened quick grade (the frequency-rule everyday). */
export function resolveFlow(id: FlowId, grade: Grade, overrides?: Partial<FlowSpec>): FlowSpec {
  const base = BASE[id];
  const spec =
    grade === "quick"
      ? { ...base, pressMs: Math.round(base.pressMs * 0.5), cardMs: Math.round(base.cardMs * 0.6), composeMs: Math.round(base.composeMs * 0.7) }
      : { ...base };
  return { ...spec, ...overrides };
}

/** the seal's resting glyph + a matched size, by quill set (a–e). */
export const QUILL_SETS = ["a", "b", "c", "d", "e"] as const;
export type QuillSet = (typeof QUILL_SETS)[number];
export const QUILL_SCALE: Record<QuillSet, number> = { a: 0.4, b: 0.42, c: 0.46, d: 0.4, e: 0.36 };

// ── the orchestrator ──────────────────────────────────────────────
export function useKeepSequence(spec: FlowSpec, reduce = false) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sealKey, setSealKey] = useState(0);
  const [armed, setArmed] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearAll, [clearAll]);

  const start = useCallback(() => {
    clearAll();
    setArmed(true);
    setSealKey((k) => k + 1);
    setPhase("pressing");
    const press = reduce ? 0 : spec.pressMs;
    const card = reduce ? 0 : spec.cardMs;
    const compose = reduce ? 0 : spec.composeMs;
    timers.current.push(setTimeout(() => setPhase("carding"), press));
    timers.current.push(setTimeout(() => setPhase("composing"), press + card));
    timers.current.push(setTimeout(() => setPhase("idle"), press + card + compose));
  }, [spec, reduce, clearAll]);

  return { phase, sealKey, armed, start };
}

// ── the card's birth ──────────────────────────────────────────────
// transform/opacity/filter only; the morph also rides border-radius (cheap,
// it's one element). Each reads as a different answer to "what the press did".
function birthMotion(birth: Birth): { initial: TargetAndTransition; animate: TargetAndTransition; transition: Transition } {
  switch (birth) {
    case "morph": // the round puck unfolds into the tile
      return {
        initial: { opacity: 0, scale: 0.42, borderRadius: 40, filter: "blur(1px)" },
        animate: { opacity: 1, scale: 1, borderRadius: 6, filter: "blur(0px)" },
        transition: { duration: 0.46, ease: [0.23, 1, 0.32, 1] },
      };
    case "impact": // dropped in, carrying the stamp's force
      return {
        initial: { opacity: 0, y: -12 },
        animate: { opacity: 1, y: [-12, 3, 0] },
        transition: { duration: 0.42, ease: [0.23, 1, 0.32, 1], times: [0, 0.62, 1] },
      };
    case "emboss": // pressed into being in place — no travel
      return {
        initial: { opacity: 0, scale: 0.992 },
        animate: { opacity: 1, scale: 1 },
        transition: { duration: 0.5, ease: [0.23, 1, 0.32, 1] },
      };
    case "file": // rose up out of the composer below it
      return {
        initial: { opacity: 1, y: 64, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        transition: { type: "spring", duration: 0.5, bounce: 0.16 },
      };
    case "quiet": // the budget rise
      return {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.26, ease: [0.23, 1, 0.32, 1] },
      };
    case "rise": // freshly pressed onto the page
    default:
      return {
        initial: { opacity: 0, y: 8, scale: 0.965, filter: "blur(2px)" },
        animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
        transition: { type: "spring", duration: 0.5, bounce: 0.18 },
      };
  }
}

/** The flow's card birth (transform/opacity/filter), for callers that animate
    their own element (e.g. the real ScheduleCards tile) rather than KeptCard. */
export function birthFor(spec: FlowSpec, reduce = false) {
  return birthMotion(reduce ? "quiet" : spec.birth);
}

/** A kept entry in the schedule's tile material, born by the flow. The
    `emboss` birth additionally rises the tile's paint (border + fill +
    top-highlight) from nothing, so the words are pressed onto bare page. */
export function KeptCard({
  text,
  spec,
  reduce = false,
  className,
}: {
  text: string;
  spec: FlowSpec;
  reduce?: boolean;
  className?: string;
}) {
  const m = birthMotion(reduce ? "quiet" : spec.birth);
  const emboss = spec.birth === "emboss" && !reduce;
  return (
    <motion.div
      layout="position"
      initial={m.initial}
      animate={m.animate}
      transition={reduce ? { duration: 0 } : m.transition}
      style={{ originX: 0.5, originY: 0.5 }}
      className={cn("relative isolate block w-full text-left", className)}
    >
      {/* the tile paint — for emboss it fades up under the words */}
      <motion.span
        aria-hidden="true"
        initial={emboss ? { opacity: 0 } : false}
        animate={emboss ? { opacity: 1 } : undefined}
        transition={emboss ? { duration: spec.cardMs / 1000, ease: [0.23, 1, 0.32, 1] } : undefined}
        className="pointer-events-none absolute inset-0 rounded-[6px] border border-rule-faint bg-paper shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]"
      />
      <p className="voice-prose relative line-clamp-6 whitespace-pre-wrap p-2.5 text-[0.9rem] leading-[1.42]">
        {text}
      </p>
    </motion.div>
  );
}

/** Wraps the returning empty composer in the flow's re-entry. `wipe` opens
    a grid column from the left (followable, collapses under reduced motion
    via the duration token like the date-header wipe); `paint` and `fade`
    are softer re-entries. `active` is true while it should be shown. */
export function ComposerWipe({
  active,
  style,
  durationMs,
  children,
  className,
}: {
  active: boolean;
  style: ComposerReturn;
  /** the wipe-in duration; falls back to the CSS token when unset. */
  durationMs?: number;
  children: React.ReactNode;
  className?: string;
}) {
  // an explicit duration (the flow's composeMs, tunable by the lab's speed)
  // overrides the token, so the return reads as slow as the flow asks
  const dur = durationMs != null ? { transitionDuration: `${durationMs}ms` } : undefined;
  if (style === "wipe") {
    return (
      <span
        data-wipe={active ? "open" : "closed"}
        style={dur}
        className={cn(
          "grid transition-[grid-template-columns,opacity] ease-[var(--ease-out)]",
          durationMs == null && "duration-[calc(var(--dur-slow)*1.4)]",
          active ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
          className,
        )}
      >
        <span className="min-w-0 overflow-hidden">{children}</span>
      </span>
    );
  }
  return (
    <span
      style={dur}
      className={cn(
        "block transition-opacity ease-[var(--ease-out)]",
        durationMs == null && "duration-[var(--dur-slow)]",
        active ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {children}
    </span>
  );
}
