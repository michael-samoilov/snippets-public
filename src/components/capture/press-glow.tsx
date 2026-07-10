"use client";

import { useEffect, useRef } from "react";

/**
 * The press glow — light pooling under a finger on a writing surface,
 * tracking a drag, adopted from /lab/press-glow (the Claude-app composer
 * micro-interaction, rebuilt in the desk's own light).
 *
 * Drop it INSIDE a positioned, rounded container, before the content:
 * it renders an absolute glow layer clipped to the surface and wires its
 * pointer handlers onto the parent. Content that must sit above the light
 * (the words — ink lies ON the light) needs to be positioned and come
 * later in the DOM, since both paint in the positioned phase.
 *
 * Two lights ride one compositor transform: a tight bright core at the
 * finger and a wide soft ambient halo that lifts the whole surface — the
 * whole card brightens, most at the touch. The ink is the per-theme
 * --glow-ink token (Paper: pure white, genuinely whitening the cream;
 * Lamplight: warm candle gold).
 *
 * Gesture story (hard-won on device — see the lab's history):
 * - a drag that becomes a page scroll takes the pointer (pointercancel)
 *   but iOS keeps streaming touch events, so the light keeps following
 *   the finger through the scroll and leaves the moment it lifts;
 * - where touches die with the pointer (Android), the light rides the
 *   moving card (finger and content travel together in a 1:1 drag) and
 *   slips away once the page settles;
 * - a quiet-finger guard fades a ride when touches stop arriving, so the
 *   light can never strand after a missed lift;
 * - a grab during scroll DECELERATION never lights: iOS consumes the
 *   braking touch entirely — no event ever reaches the page. Verified
 *   on device; not fixable without owning scrolling in JS.
 *
 * Reduced motion: the light still answers the hand (it's light, not
 * motion) but instantly — no trailing lerp, no grow, no fades.
 */

interface GlowRecipe {
  /** peak strength while the finger is down, 0..1 */
  strength: number;
  /** the bright core's diameter, css px */
  size: number;
  /** the core's blur (the ambient runs 3×) */
  blur: number;
  /** ambient halo diameter as a multiple of the core's */
  reach: number;
  /** the ambient's strength as a fraction of the core's */
  ambient: number;
  /** 0 = pinned to the finger; toward 1 = trails it */
  lag: number;
  /** bloom while pressed/focused, normalized to a ~525px-diagonal surface */
  grow: number;
}

/* owner-tuned recipes (from the lab): Paper runs a big, strong pool with a
   heavy ambient — the cream leaves so little luminance headroom that
   presence has to come from area, not intensity — while Lamplight's candle
   carries at low strength, so it goes smaller, softer, and trails more */
export const GLOW_PAPER: GlowRecipe = {
  strength: 0.7,
  size: 410,
  blur: 32,
  reach: 2.1,
  ambient: 0.8,
  lag: 0.55,
  grow: 1.016,
};

export const GLOW_LAMPLIGHT: GlowRecipe = {
  strength: 0.4,
  size: 210,
  blur: 46,
  reach: 3.6,
  ambient: 0.35,
  lag: 0.65,
  grow: 1.016,
};

const ink = (alpha: number) =>
  `color-mix(in srgb, var(--glow-ink) ${Math.round(alpha * 100)}%, transparent)`;

export function PressGlow({ grow = false, className }: {
  /** bloom the host a hair while pressed/focused. Leave OFF on surfaces
      whose transform is owned elsewhere (the composer's press dip, the
      entry card's open/close zoom) */
  grow?: boolean;
  /** extra classes for the clipping layer — e.g. a corner radius when the
      host itself carries none (the layer inherits the host's otherwise) */
  className?: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const growRef = useRef(grow);
  useEffect(() => {
    growRef.current = grow;
  });

  useEffect(() => {
    const layer = layerRef.current;
    const glow = glowRef.current;
    const core = coreRef.current;
    const amb = ambientRef.current;
    const host = layer?.parentElement;
    if (!layer || !glow || !core || !amb || !host) return;

    let raf = 0;
    let down = false;
    let focused = false;
    // the scroll took the pointer; the glow rides the moving surface
    let riding = false;
    // …and on iOS, touch events outlive the cancelled pointer
    let touchLive = false;
    let settle = 0;
    // finger target and the glow's eased position, host-local
    let tx = 0, ty = 0, x = 0, y = 0;
    // the recipe in force for the current press (re-read per press: theme
    // and reduced-motion can both change under a live app)
    let rec = GLOW_PAPER;
    let reduce = false;

    const arm = () => {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      rec = document.documentElement.classList.contains("dark")
        ? GLOW_LAMPLIGHT
        : GLOW_PAPER;
      glow.style.width = `${rec.size}px`;
      glow.style.height = `${rec.size}px`;
      core.style.width = `${rec.size}px`;
      core.style.height = `${rec.size}px`;
      core.style.filter = `blur(${rec.blur}px)`;
      core.style.background = `radial-gradient(circle closest-side, ${ink(rec.strength)}, transparent 72%)`;
      const d = Math.round(rec.size * rec.reach);
      amb.style.width = `${d}px`;
      amb.style.height = `${d}px`;
      amb.style.filter = `blur(${rec.blur * 3}px)`;
      amb.style.background = `radial-gradient(circle closest-side, ${ink(rec.strength * rec.ambient)}, transparent 78%)`;
      glow.style.transitionDuration = reduce ? "0ms" : "";
    };

    const place = () => {
      glow.style.transform = `translate3d(${x - rec.size / 2}px, ${y - rec.size / 2}px, 0)`;
    };
    const step = () => {
      raf = 0;
      const k = reduce ? 1 : 1 - Math.min(0.95, rec.lag);
      x += (tx - x) * k;
      y += (ty - y) * k;
      place();
      if (Math.abs(tx - x) + Math.abs(ty - y) > 0.5) raf = requestAnimationFrame(step);
    };
    const nudge = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };
    const level = () => {
      glow.style.opacity = down || riding ? "1" : "0";
    };
    const scale = () => {
      if (!growRef.current) return;
      if ((down || focused || riding) && !reduce) {
        // normalized bloom: calibrated on the today zone's ~525px diagonal,
        // smaller surfaces scale proportionally more so every card visibly
        // grows the same few pixels
        // the HOST declares its own `transition` for transform (the glow
        // never writes that property — the surface may be transitioning
        // border-color or others of its own)
        const r = host.getBoundingClientRect();
        const diag = Math.max(120, Math.hypot(r.width, r.height));
        const eff = Math.min(1.06, 1 + (rec.grow - 1) * (525 / diag));
        host.style.transform = `scale(${eff})`;
      } else {
        host.style.transform = "";
      }
    };
    const local = (cx: number, cy: number) => {
      const r = host.getBoundingClientRect();
      tx = cx - r.left;
      ty = cy - r.top;
    };
    const onDown = (e: PointerEvent) => {
      if (riding) settleRide(); // a new press takes over from a live ride
      arm();
      down = true;
      local(e.clientX, e.clientY);
      // first light lands where the finger did — no glide-in from a stale spot
      x = tx;
      y = ty;
      place();
      level();
      scale();
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      local(e.clientX, e.clientY);
      nudge();
    };
    const onUp = () => {
      down = false;
      level();
      scale();
    };
    /* the ride: a pointercancel means the browser took the drag for
       scrolling. iOS keeps streaming touch events to the gesture's original
       target, so the light follows the finger for real (the host's rect is
       re-read each event — the surface itself is moving) and leaves on
       touchend. Where touches die too (Android's touchcancel before any
       move), the light stays pinned to the surface — finger and content
       move together in a 1:1 drag — and settles when the scroll does. */
    const settleRide = () => {
      riding = false;
      touchLive = false;
      clearTimeout(settle);
      window.removeEventListener("scroll", onScrollRide, true);
      host.removeEventListener("touchmove", onRideMove);
      host.removeEventListener("touchend", onRideEnd);
      host.removeEventListener("touchcancel", onRideEnd);
      level();
      scale();
    };
    const onScrollRide = () => {
      if (touchLive) return; // the finger is tracked; touchend ends the ride
      clearTimeout(settle);
      settle = window.setTimeout(settleRide, 220);
    };
    const onRideMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!riding || !t) return;
      touchLive = true;
      // quiet-finger guard: the light must never strand after a lift — a
      // ride survives only while touches keep arriving
      clearTimeout(settle);
      settle = window.setTimeout(settleRide, 700);
      local(t.clientX, t.clientY);
      nudge();
    };
    const onRideEnd = (e: TouchEvent) => {
      if (e.type === "touchcancel" && !touchLive) return;
      if (riding) settleRide();
    };
    const onCancel = () => {
      if (!down) return;
      down = false;
      riding = true;
      window.addEventListener("scroll", onScrollRide, true);
      host.addEventListener("touchmove", onRideMove, { passive: true });
      host.addEventListener("touchend", onRideEnd);
      host.addEventListener("touchcancel", onRideEnd);
      clearTimeout(settle);
      settle = window.setTimeout(settleRide, 340);
    };
    const onFocusIn = () => {
      focused = true;
      scale();
    };
    const onFocusOut = () => {
      focused = false;
      scale();
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
    host.addEventListener("pointerleave", onUp);
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      window.removeEventListener("scroll", onScrollRide, true);
      host.removeEventListener("touchmove", onRideMove);
      host.removeEventListener("touchend", onRideEnd);
      host.removeEventListener("touchcancel", onRideEnd);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
      host.removeEventListener("pointerleave", onUp);
      host.removeEventListener("focusin", onFocusIn);
      host.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <div
      ref={layerRef}
      aria-hidden
      className={`pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] ${className ?? ""}`}
    >
      <div
        ref={glowRef}
        className="absolute left-0 top-0 opacity-0 transition-opacity duration-[320ms] ease-[var(--ease-out)]"
        style={{ willChange: "transform, opacity" }}
      >
        <div
          ref={ambientRef}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        />
        <div
          ref={coreRef}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
        />
      </div>
    </div>
  );
}
