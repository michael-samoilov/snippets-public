"use client";

import { motion, useReducedMotion, type Transition } from "motion/react";
import { cn } from "@/lib/utils";

/* ── the wax stamp ────────────────────────────────────────────────
   Not a coin that drops and bounces — wax that is pressed. Wax is
   plastic, not elastic: it deforms and stays. So the motion is a press,
   in three acts:

     1. a molten blob sits on the page — domed, glossy, no impression
     2. the die comes down: the blob is driven flat and spreads outward
        (it accelerates in and stops hard — no rebound), held a beat
        under pressure while it darkens in the die's shadow
     3. the die lifts: the impression (the rim groove and the "S") is
        revealed as it clears, the gloss cools to satin, the wax relaxes
        up to its set height and holds

   The same wax material as the record `Seal`. Built from transform/
   opacity/filter only; reuses the wax tokens; collapses to a plain fade
   under reduced motion. Replays when `playKey` changes. */

const EASE_PLACE = [0.23, 1, 0.32, 1] as const; // the blob arriving
const EASE_PRESS = [0.5, 0, 0.85, 0.28] as const; // weighty, accelerates, hard stop
const EASE_LIFT = [0.16, 1, 0.3, 1] as const; // die withdraws, wax settles (no overshoot)

export type WaxTuning = {
  /** total seconds of the press. */
  dur: number;
  /** start diameter (scaleX) of the molten blob. */
  spreadFrom: number;
  /** start height (scaleY) of the domed blob. */
  domeFrom: number;
  /** flattest scaleY at peak pressure. */
  squashY: number;
  /** fraction of `dur` where the die seats. */
  pressAt: number;
  /** fraction of `dur` where the die starts to lift. */
  dwellAt: number;
};

const DEFAULTS: WaxTuning = {
  dur: 0.6,
  spreadFrom: 0.84,
  domeFrom: 1.12,
  squashY: 0.86,
  pressAt: 0.46,
  dwellAt: 0.6,
};

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

  // the press timeline: place · seat · dwell · set
  const TT = [0, 0.12, t.pressAt, t.dwellAt, 1];
  const segEase = [EASE_PLACE, EASE_PRESS, "linear", EASE_LIFT] as const;

  // ── the wax body: spreads wide and flat under the die, then relaxes
  // up to its set height. scaleX is monotonic (it spreads and stays);
  // scaleY squishes then relaxes — neither crosses its rest value, so
  // there is no bounce.
  const bodyTransition: Transition = reduce
    ? { duration: 0.14, ease: "linear" }
    : { duration: t.dur, times: TT, ease: [...segEase] };
  const body = reduce
    ? { opacity: [0, 1], scaleX: 1, scaleY: 1, y: 0, filter: "blur(0px)" }
    : {
        opacity: [0, 1, 1, 1, 1],
        scaleX: [t.spreadFrom, t.spreadFrom + 0.02, 1, 1, 1],
        scaleY: [t.domeFrom, t.domeFrom - 0.02, t.squashY, t.squashY, 1],
        y: [0, 0, 1.5, 1.5, 0],
        filter: ["blur(1.2px)", "blur(0.6px)", "blur(0px)", "blur(0px)", "blur(0px)"],
      };

  // ── the die's shadow: the wax darkens as the die seats over it, and
  // brightens as it withdraws (the reveal)
  const dieTransition: Transition = reduce
    ? { duration: 0.14, ease: "linear" }
    : { duration: t.dur, times: TT, ease: [...segEase] };
  const die = reduce
    ? { opacity: 0 }
    : { opacity: [0, 0.08, 0.34, 0.34, 0] };

  // ── the impression: rim groove + the "S", revealed as the die lifts
  const reliefTransition: Transition = reduce
    ? { duration: 0.14, ease: "linear" }
    : { duration: t.dur, times: [0, t.dwellAt, 0.95], ease: EASE_LIFT };
  const relief = reduce
    ? { opacity: [0, 1], scale: 1, filter: "blur(0px)" }
    : {
        opacity: [0, 0, 1],
        scale: [1.05, 1.05, 1],
        filter: ["blur(1.6px)", "blur(1.6px)", "blur(0px)"],
      };

  // ── the gloss: wet molten wax cools to a satin set
  const specTransition: Transition = reduce
    ? { duration: 0.14, ease: "linear" }
    : { duration: t.dur, times: [0, t.pressAt, 1], ease: EASE_LIFT };
  const spec = reduce ? { opacity: 0.38 } : { opacity: [0.62, 0.52, 0.38] };

  // ── the contact shadow spreads under pressure and stays spread
  const shadowTransition: Transition = reduce
    ? { duration: 0.14, ease: "linear" }
    : { duration: t.dur, times: TT, ease: [...segEase] };
  const shadow = reduce
    ? { opacity: [0, 0.42], scaleX: 1, scaleY: 1 }
    : {
        opacity: [0.18, 0.26, 0.55, 0.55, 0.42],
        scaleX: [0.7, 0.74, 1.16, 1.16, 1.06],
        scaleY: [0.6, 0.64, 1.12, 1.12, 1.02],
      };

  return (
    <span
      key={playKey}
      aria-hidden="true"
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size, overflow: "visible", isolation: "isolate" }}
    >
      {/* contact / drop shadow — its own layer, static blur */}
      <motion.span
        className="pointer-events-none absolute rounded-full"
        style={{
          left: "50%",
          top: "78%",
          width: "74%",
          height: "15%",
          x: "-50%",
          background: "var(--wax-shadow)",
          filter: "blur(6px)",
          transformOrigin: "center",
          willChange: "transform, opacity",
        }}
        animate={shadow}
        transition={shadowTransition}
      />

      {/* the wax body */}
      <motion.svg
        viewBox="0 0 100 100"
        className="relative block"
        style={{
          width: "100%",
          height: "100%",
          transformOrigin: "50% 92%",
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
          <linearGradient id="wax-relief" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(255 255 255 / 0.28)" />
            <stop offset="32%" stopColor="rgb(255 255 255 / 0)" />
            <stop offset="68%" stopColor="rgb(0 0 0 / 0)" />
            <stop offset="100%" stopColor="rgb(0 0 0 / 0.22)" />
          </linearGradient>
          <radialGradient id="wax-spec" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(255 255 255 / 0.5)" />
            <stop offset="100%" stopColor="rgb(255 255 255 / 0)" />
          </radialGradient>
          {/* the die's shadow falls from above */}
          <linearGradient id="wax-die" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(0 0 0 / 0.6)" />
            <stop offset="62%" stopColor="rgb(0 0 0 / 0)" />
          </linearGradient>
          {/* a real bevel: the letter is the same wax, raised and lit
              from the upper-left — a crevice shadow lower-right, a
              specular highlight on the lit edges. No contrasting fill;
              the impression reads through light alone, as pressed wax
              does. */}
          <filter id="wax-emboss" x="-35%" y="-35%" width="170%" height="170%">
            {/* crevice shadow the raised letter casts into the field */}
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.9" result="sb" />
            <feOffset in="sb" dx="0.5" dy="0.9" result="so" />
            <feFlood floodColor="#091420" floodOpacity="0.55" result="sc" />
            <feComposite in="sc" in2="so" operator="in" result="cast" />
            {/* a slope from the letter's alpha, lit from upper-left */}
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.2" result="slope" />
            <feSpecularLighting
              in="slope"
              surfaceScale="3"
              specularConstant="0.8"
              specularExponent="13"
              lightingColor="#ffffff"
              result="hi"
            >
              <feDistantLight azimuth="225" elevation="58" />
            </feSpecularLighting>
            <feComposite in="hi" in2="SourceAlpha" operator="in" result="hiClip" />
            {/* stack: cast shadow · the wax letter · the lit edges */}
            <feMerge>
              <feMergeNode in="cast" />
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="hiClip" />
            </feMerge>
          </filter>
        </defs>

        {/* proud base — wax squeezed past the die (spreads with the body) */}
        <circle cx="50" cy="50" r="48" fill="var(--wax-deep)" />
        {/* lit face */}
        <circle cx="50" cy="50" r="46.5" fill="url(#wax-face)" />
        {/* roundness */}
        <circle cx="50" cy="50" r="46.5" fill="url(#wax-relief)" />
        {/* specular catch-light, cooling wet → satin */}
        <motion.ellipse
          cx="37"
          cy="31"
          rx="21"
          ry="14"
          fill="url(#wax-spec)"
          animate={spec}
          transition={specTransition}
        />
        {/* the die's shadow over the wax while it is seated */}
        <motion.circle
          cx="50"
          cy="50"
          r="46.5"
          fill="url(#wax-die)"
          animate={die}
          transition={dieTransition}
        />

        {/* the impression: rim groove + the "S", revealed on the lift */}
        <motion.g
          animate={relief}
          transition={reliefTransition}
          style={{ transformOrigin: "center" }}
        >
          {/* grooved rim: a recessed ring with an inner top highlight */}
          <circle cx="50" cy="50" r="39" fill="none" stroke="var(--wax-deep)" strokeWidth="2.5" opacity="0.45" />
          <circle cx="50" cy="50" r="37.6" fill="none" stroke="var(--press-highlight)" strokeWidth="1" />
          {/* the "S", raised in the same wax and lit from upper-left */}
          <text
            x="50"
            y="50"
            textAnchor="middle"
            dominantBaseline="central"
            fill="url(#wax-face)"
            filter="url(#wax-emboss)"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: 58 }}
          >
            {glyph}
          </text>
        </motion.g>
      </motion.svg>
    </span>
  );
}
