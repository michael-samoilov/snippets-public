"use client";

import { motion, useReducedMotion, type Transition } from "motion/react";
import { cn } from "@/lib/utils";

/* ── the wax stamp ────────────────────────────────────────────────
   The seal we already have (the record button's blue wax) caught in the
   act of pressing: it falls onto the page, grows, lands with a squash,
   and the impressed "S" sets as the wax cools. The same material as
   `Seal` — radial face, grooved rim, a colored shadow sitting proud —
   so a keep reads as the same seal, transformed.

   Built from transform/opacity/filter only. The drop shadow is its own
   layer (never an animated box-shadow); the impact ripple reuses the
   `seal-ring` motif. A keep is a once-a-thought celebration, so it runs
   ~520ms — longer than the 260ms UI budget by intent, the way the
   reference does, but every meaningful beat lands by ~460ms. Replays
   when `playKey` changes; collapses to a plain fade under reduced
   motion. */

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const EASE_IMPACT = [0.45, 0, 0.2, 1] as const; // snappier press

export type WaxTuning = {
  /** total seconds of the press (entrance → settle). */
  dur: number;
  /** px the seal falls from. */
  dropY: number;
  /** scale it appears at (never 0). */
  startScale: number;
  /** widest stretch at impact. */
  squashX: number;
  /** flattest squash at impact. */
  squashY: number;
  /** peak hand-stamped tilt, degrees. */
  rotate: number;
};

const DEFAULTS: WaxTuning = {
  dur: 0.52,
  dropY: 15,
  startScale: 0.4,
  squashX: 1.18,
  squashY: 0.82,
  rotate: 3,
};

// proportional beats (fractions of `dur`): appear, grown-at-paper,
// impact squash, rebound, settle
const T = [0, 0.12, 0.58, 0.73, 0.85, 1] as const;

export type WaxStampProps = {
  /** increment once per keep; any change replays the press. */
  playKey: number;
  /** seal diameter, px. Defaults to the Seal button's 64. */
  size?: number;
  /** the letter pressed into the wax. */
  glyph?: string;
  /** override beats for iteration (the dev harness passes these). */
  tuning?: Partial<WaxTuning>;
  className?: string;
};

export function WaxStamp({
  playKey,
  size = 64,
  glyph = "S",
  tuning,
  className,
}: WaxStampProps) {
  const reduce = useReducedMotion();
  const t = { ...DEFAULTS, ...tuning };

  // shared transition for the body's keyframe arrays
  const bodyTransition: Transition = reduce
    ? { duration: 0.12, ease: "linear" }
    : {
        duration: t.dur,
        times: [...T],
        ease: [EASE_OUT, EASE_OUT, EASE_IMPACT, EASE_OUT, EASE_OUT],
      };

  const body = reduce
    ? { opacity: [0, 1] }
    : {
        opacity: [0, 1, 1, 1, 1, 1],
        y: [-t.dropY, -t.dropY * 0.7, 0, 2, 0, 0],
        scaleX: [t.startScale, t.startScale * 1.5, 1.06, t.squashX, 0.97, 1],
        scaleY: [t.startScale, t.startScale * 1.5, 1.06, t.squashY, 1.04, 1],
        rotate: [-t.rotate, -t.rotate * 0.66, -0.5, t.rotate * 0.33, 0.3, 0],
        filter: [
          "blur(2px)",
          "blur(1px)",
          "blur(0px)",
          "blur(0px)",
          "blur(0px)",
          "blur(0px)",
        ],
      };

  // the "S" sets after the disc lands (the reference's "emboss resolves")
  const faceTransition: Transition = reduce
    ? { duration: 0.12, ease: "linear" }
    : { duration: t.dur, times: [0, 0.55, 0.9], ease: EASE_OUT };
  const face = reduce
    ? { opacity: [0, 1] }
    : {
        opacity: [0, 0, 1],
        scale: [1.04, 1.04, 1],
        filter: ["blur(1.5px)", "blur(1.5px)", "blur(0px)"],
      };

  // contact shadow: grows with the fall, spreads at impact, settles soft
  const shadowTransition: Transition = reduce
    ? { duration: 0.12, ease: "linear" }
    : { duration: t.dur, times: [0, 0.58, 0.73, 1], ease: EASE_OUT };
  const shadow = reduce
    ? { opacity: [0, 0.45] }
    : {
        opacity: [0.22, 0.5, 0.62, 0.45],
        scaleX: [0.4, 1, 1.25, 1],
        scaleY: [0.4, 1, 1.1, 1],
      };

  return (
    <span
      key={playKey}
      aria-hidden="true"
      className={cn("relative grid place-items-center", className)}
      style={{
        width: size,
        height: size,
        overflow: "visible",
        isolation: "isolate",
      }}
    >
      {/* contact / drop shadow — its own layer, static blur */}
      <motion.span
        className="pointer-events-none absolute rounded-full"
        style={{
          left: "50%",
          top: "76%",
          width: "72%",
          height: "16%",
          x: "-50%",
          background: "var(--wax-shadow)",
          filter: "blur(6px)",
          transformOrigin: "center",
          willChange: "transform, opacity",
        }}
        animate={shadow}
        transition={shadowTransition}
      />

      {/* impact ripple — wax squeezing out (reuses the seal-ring feel) */}
      {!reduce && (
        <motion.span
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{
            border: "1.5px solid var(--wax-faint)",
            transformOrigin: "center",
            willChange: "transform, opacity",
          }}
          animate={{ scale: [0.85, 0.85, 0.95, 1.6], opacity: [0, 0, 0.5, 0] }}
          transition={{
            duration: t.dur,
            times: [0, 0.55, 0.64, 1],
            ease: EASE_OUT,
          }}
        />
      )}

      {/* the seal body: disc + grooved rim + the impressed letter */}
      <motion.svg
        viewBox="0 0 100 100"
        className="relative block"
        style={{
          width: "100%",
          height: "100%",
          transformOrigin: "50% 88%",
          willChange: "transform, filter, opacity",
        }}
        animate={body}
        transition={bodyTransition}
      >
        <defs>
          <radialGradient id="wax-face" cx="34%" cy="30%" r="74%">
            <stop offset="0%" stopColor="var(--wax-bright)" />
            <stop offset="46%" stopColor="var(--wax)" />
            <stop offset="100%" stopColor="var(--wax-deep)" />
          </radialGradient>
          {/* roundness: top highlight fading to a lower-edge shadow */}
          <linearGradient id="wax-relief" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(255 255 255 / 0.28)" />
            <stop offset="32%" stopColor="rgb(255 255 255 / 0)" />
            <stop offset="68%" stopColor="rgb(0 0 0 / 0)" />
            <stop offset="100%" stopColor="rgb(0 0 0 / 0.22)" />
          </linearGradient>
          {/* a soft specular catch, upper-left (a radial — no filter) */}
          <radialGradient id="wax-spec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(255 255 255 / 0.5)" />
            <stop offset="100%" stopColor="rgb(255 255 255 / 0)" />
          </radialGradient>
        </defs>

        {/* proud base — the wax squeezed past the die */}
        <circle cx="50" cy="50" r="48" fill="var(--wax-deep)" />
        {/* lit face */}
        <circle cx="50" cy="50" r="46.5" fill="url(#wax-face)" />
        {/* relief overlay (top highlight + bottom shadow) */}
        <circle cx="50" cy="50" r="46.5" fill="url(#wax-relief)" />
        {/* specular catch-light, upper-left */}
        <ellipse cx="37" cy="31" rx="21" ry="14" fill="url(#wax-spec)" />
        {/* grooved rim: a recessed ring with an inner top highlight */}
        <circle
          cx="50"
          cy="50"
          r="39"
          fill="none"
          stroke="var(--wax-deep)"
          strokeWidth="2.5"
          opacity="0.45"
        />
        <circle
          cx="50"
          cy="50"
          r="37.6"
          fill="none"
          stroke="var(--press-highlight)"
          strokeWidth="1"
        />

        {/* the impressed "S" — light glyph on wax (as StampMark's mark),
            with a soft shadow below-right so it sits proud */}
        <motion.g animate={face} transition={faceTransition} style={{ transformOrigin: "center" }}>
          <text
            x="50.8"
            y="51.2"
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--wax-deep)"
            opacity="0.5"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: 58 }}
          >
            {glyph}
          </text>
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fill="var(--paper-raised)"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: 58 }}
          >
            {glyph}
          </text>
        </motion.g>
      </motion.svg>
    </span>
  );
}
