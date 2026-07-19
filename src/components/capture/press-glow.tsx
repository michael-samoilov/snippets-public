"use client";

import { useEffect, useRef } from "react";

/**
 * The press glow — light pooling under a finger on a writing surface,
 * tracking a drag, adopted from /lab/press-glow (the Claude-app composer
 * micro-interaction, rebuilt in the desk's own light).
 *
 * Drop it INSIDE a positioned, rounded container: it renders an absolute
 * glow layer clipped to the surface (painted ABOVE the content — light
 * falls on the printed page; see the blend notes at the layer) and wires
 * its pointer handlers onto the parent.
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

/* a tap plays the light's FULL arc, like Liquid Glass (measured at 60fps:
   a native tap shows ~330ms of light no matter how briefly the finger
   rested; ours showed ~50ms — the exit used to start from wherever the
   rise had gotten). The exit may not begin until the swell has finished. */
const DWELL_MS = 220;

export function PressGlow({ grow = false, growWhileFocused = true, className }: {
  /** bloom the surface a hair while pressed/focused. `true` scales the host
      itself; `"parent"` scales the host's parent — for surfaces whose own
      transform belongs to another animation (the entry card's open/close
      zoom, a tile's FLIP), give them a dedicated wrapper and point the
      bloom there. The bloom target declares its own transform transition. */
  grow?: boolean | "parent";
  /** writing surfaces hold their bloom while the caret is inside; a BUTTON
      surface (an entry tile) keeps DOM focus long after the press opened
      something else — set false so its bloom is press-only, never stuck */
  growWhileFocused?: boolean;
  /** extra classes for the clipping layer — e.g. a corner radius when the
      host itself carries none (the layer inherits the host's otherwise) */
  className?: string;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const ambientRef = useRef<HTMLDivElement>(null);
  const growRef = useRef(grow);
  const growFocusRef = useRef(growWhileFocused);
  useEffect(() => {
    growRef.current = grow;
    growFocusRef.current = growWhileFocused;
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
    // light quenched by finger stillness while the gesture may still live
    let quenched = false;
    let settle = 0;
    let lastScrollAt = 0;
    let scaleClear = 0;
    let stillDeath = 0;
    let dwell = 0;
    let litAt = 0;
    let scaleHold = 0;
    let levelHold = 0;
    // finger target and the glow's eased position, host-local
    let tx = 0, ty = 0, x = 0, y = 0;
    // the recipe in force for the current press (re-read per press: theme
    // and reduced-motion can both change under a live app)
    let rec = GLOW_PAPER;
    let reduce = false;

    let shedWC = 0;
    // a standing selection in this surface owns its taps: iOS shows the
    // Cut/Copy/Paste callout for them, and it dismisses on any nearby
    // relayering — the glow's blend/will-change/transform writes are exactly
    // that. Both kinds count: a field's own selection (invisible to
    // getSelection) AND a DOM selection on static words (a long-press on the
    // card view's prose). While one stands, the light neither arrives nor
    // sheds nor retracts its bloom.
    const selectionStands = () => {
      const a = document.activeElement;
      if (
        (a instanceof HTMLTextAreaElement || a instanceof HTMLInputElement) &&
        host.contains(a) &&
        a.selectionStart !== a.selectionEnd
      )
        return true;
      const sel = document.getSelection();
      return (
        !!sel &&
        !sel.isCollapsed &&
        !!sel.anchorNode &&
        host.contains(
          sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode.parentElement,
        )
      );
    };
    const arm = () => {
      reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      rec = document.documentElement.classList.contains("dark")
        ? GLOW_LAMPLIGHT
        : GLOW_PAPER;
      // will-change and the blend live only for the press's lifetime: a
      // standing hint/blend would hold a compositor layer (and an offscreen
      // blend group) per surface, and the book renders hundreds of tiles —
      // the exact per-card cost perf-flat and zoom relief exist to shed
      clearTimeout(shedWC);
      glow.style.willChange = "transform, opacity";
      layer.style.mixBlendMode = rec === GLOW_PAPER ? "overlay" : "";
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
      const lit = (down || riding) && !quenched;
      // fading out is a paint change beside a possibly-open callout — while
      // a selection stands on this surface, the light simply stays (the
      // hand's work is ongoing) and fades once the selection collapses
      if (!lit && glow.style.opacity !== "0" && selectionStands()) {
        clearTimeout(levelHold);
        levelHold = window.setTimeout(level, 350);
        return;
      }
      // per-direction envelopes, measured from iOS's Liquid Glass bar
      // (30fps frame analysis): the light swells in over ~200ms and leaves
      // on a long, near-linear ~380ms tail. One shared snappy ease-out
      // made it flash on and cut off — the exact opposite read.
      glow.style.transition = reduce
        ? "opacity 0ms"
        : lit
          ? "opacity 200ms cubic-bezier(0.25, 0.1, 0.4, 1)"
          : "opacity 380ms cubic-bezier(0.3, 0, 0.6, 1)";
      glow.style.opacity = lit ? "1" : "0";
      if (!lit) {
        // shed the compositor hint once the fade has finished — but never
        // while a selection stands (a long-press select ends with the
        // callout open; the blend flip would knock it down). Re-check until
        // the selection collapses.
        clearTimeout(shedWC);
        const shed = () => {
          if (selectionStands()) {
            shedWC = window.setTimeout(shed, 350);
            return;
          }
          glow.style.willChange = "";
          layer.style.mixBlendMode = "";
        };
        shedWC = window.setTimeout(shed, 400);
      }
    };
    // the bloom's target: the host, or — where the host's transform belongs
    // to another animation (a press dip, an open/close zoom) — a dedicated
    // ancestor nothing else transforms
    const bloomEl = growRef.current === "parent" ? (host.parentElement ?? host) : host;
    const scale = () => {
      if (!growRef.current) return;
      if ((down || riding || (focused && growFocusRef.current)) && !reduce) {
        // normalized bloom: calibrated on the today zone's ~525px diagonal,
        // smaller surfaces scale proportionally more so every card visibly
        // grows the same few pixels
        // the bloom TARGET declares its own `transition` for transform (the
        // glow never writes that property — the surface may be transitioning
        // border-color or others of its own).
        // Measure the HOST (the card), never bloomEl: a "parent" wrapper can be
        // far taller than the card it carries, which both STARVED the scale (a
        // bigger diagonal shrinks `eff`) and floated the card upward (origin at
        // the tall wrapper's centre, well above the card). Pin the origin to the
        // host's centre so a tall wrapper blooms about the card itself.
        const r = host.getBoundingClientRect();
        const diag = Math.max(120, Math.hypot(r.width, r.height));
        const eff = Math.min(1.06, 1 + (rec.grow - 1) * (525 / diag));
        // set the origin only on the FIRST application: re-measuring while
        // the wrapper is already scaled reads transformed rects, drifting
        // the origin a few px per call (and each write is a style mutation
        // near a possible iOS callout, which dismisses on relayering)
        if (bloomEl !== host && !bloomEl.style.transform) {
          const b = bloomEl.getBoundingClientRect();
          bloomEl.style.transformOrigin =
            `${r.left + r.width / 2 - b.left}px ${r.top + r.height / 2 - b.top}px`;
        }
        const next = `scale(${eff})`;
        if (bloomEl.style.transform !== next) bloomEl.style.transform = next;
      } else if (bloomEl.style.transform !== "") {
        if (selectionStands()) {
          // a callout may be showing over this surface — retracting the
          // bloom would relayer it away; retry once the selection collapses
          clearTimeout(scaleHold);
          scaleHold = window.setTimeout(scale, 350);
          return;
        }
        bloomEl.style.transform = "";
      }
    };
    const local = (cx: number, cy: number) => {
      const r = host.getBoundingClientRect();
      tx = cx - r.left;
      ty = cy - r.top;
    };
    // run an exit only once the light has had its full swell — a quick tap
    // still shows the whole arc (in, held, out), never a one-frame flash
    const afterDwell = (exit: () => void) => {
      clearTimeout(dwell);
      const wait = Math.max(0, DWELL_MS - (performance.now() - litAt));
      if (wait > 0) dwell = window.setTimeout(exit, wait);
      else exit();
    };
    const onDown = (e: PointerEvent) => {
      if (selectionStands()) return; // the callout's tap — stay dark
      if (riding) settleRide(); // a new press takes over from a live ride
      clearTimeout(scaleClear);
      clearTimeout(dwell);
      arm();
      litAt = performance.now();
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
      if (!down) return; // a swallowed press (standing selection) exits nothing
      down = false;
      afterDwell(() => {
        level();
        scale();
      });
    };
    /* the ride: a pointercancel means the browser took the drag for
       scrolling. iOS keeps streaming touch events to the gesture's original
       target, so the light follows the finger for real (the host's rect is
       re-read each event — the surface itself is moving) and leaves on
       touchend. Where touches die too (Android's touchcancel before any
       move), the light stays pinned to the surface — finger and content
       move together in a 1:1 drag — and settles when the scroll does. */
    /* the bloom must not retract while a scroll it hosts is alive: iOS
       kills a live scroll gesture — and its momentum — the moment an
       ancestor of the scroller changes transform. So the LIGHT answers the
       finger (off at lift, quenched by stillness), while the SCALE waits
       out the scroll and releases only once it settles. */
    const releaseScale = () => {
      clearTimeout(scaleClear);
      if (performance.now() - lastScrollAt < 240) {
        scaleClear = window.setTimeout(releaseScale, 260);
        return;
      }
      window.removeEventListener("scroll", onScrollRide, true);
      scale();
    };
    const settleRide = () => {
      riding = false;
      touchLive = false;
      quenched = false;
      clearTimeout(settle);
      clearTimeout(stillDeath);
      host.removeEventListener("touchmove", onRideMove);
      host.removeEventListener("touchend", onRideEnd);
      host.removeEventListener("touchcancel", onRideEnd);
      afterDwell(() => {
        level();
        releaseScale();
      });
    };
    const onScrollRide = () => {
      lastScrollAt = performance.now();
      if (touchLive || !riding) return; // tracked finger / momentum tail
      clearTimeout(settle);
      settle = window.setTimeout(settleRide, 220);
    };
    // finger stillness only dims the light (it must never strand after a
    // missed lift) — the gesture may still be alive, so the ride and the
    // bloom stay until a real end. A long-dead gesture is torn down whole.
    const quench = () => {
      quenched = true;
      level();
    };
    const onRideMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!riding || !t) return;
      touchLive = true;
      if (quenched) {
        quenched = false; // the finger moved again — same gesture, relight
        level();
      }
      clearTimeout(settle);
      settle = window.setTimeout(quench, 700);
      clearTimeout(stillDeath);
      stillDeath = window.setTimeout(settleRide, 3000);
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
    // iOS keeps a field focused when a tap lands on nothing focusable, so
    // `focusout` never fires and a focus-held bloom stays lit after the hand
    // left. A capture-phase document listener releases it on any tap outside the
    // host. (Capture so it runs even if the target stops propagation.)
    const onDocDown = (e: PointerEvent) => {
      if (!focused) return;
      if (e.target instanceof Node && host.contains(e.target)) return;
      focused = false;
      scale();
    };
    // a press the browser never resolves (the app backgrounded mid-press)
    // must not strand the light or the bloom — going hidden rests everything
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      down = false;
      focused = false;
      litAt = 0; // no dwell theatre with the app away — rest at once
      if (riding) settleRide();
      else {
        level();
        scale();
      }
    };
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
    host.addEventListener("pointerleave", onUp);
    host.addEventListener("focusin", onFocusIn);
    host.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      clearTimeout(shedWC);
      clearTimeout(scaleClear);
      clearTimeout(stillDeath);
      clearTimeout(dwell);
      clearTimeout(scaleHold);
      clearTimeout(levelHold);
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
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("visibilitychange", onHidden);
      // the bloom target is OUTSIDE this component (the host or its parent):
      // unmounting mid-bloom (the entry view re-keys to another entry) must
      // not leave it scaled forever
      bloomEl.style.transform = "";
      layer.style.mixBlendMode = "";
    };
  }, []);

  return (
    // ABOVE the words (z-15 clears the entry fade z-6 and top-edge z-10):
    // light falls ON the printed page. Paper blends `overlay` — it saturates
    // the cream toward white but only nudges the ink (≈12%→20% luminance),
    // so the pool brightens the sheet while the words stay printed matter.
    // Lamplight paints plain: a low-alpha warm veil never outshines the
    // cream glyphs. This dissolves the words>light>fade>words paint cycle —
    // the terminus fade keeps its place beneath the light.
    // The blend is applied per-press in arm() (a transparent glow blends
    // identically either way): a standing mix-blend would hold an offscreen
    // blend group per surface — hundreds of tiles — at rest, the exact
    // per-card compositing tax perf-flat and zoom relief exist to shed.
    <div
      ref={layerRef}
      data-press-glow
      aria-hidden
      className={`pointer-events-none absolute inset-0 z-[15] overflow-hidden rounded-[inherit] ${className ?? ""}`}
    >
      {/* no standing will-change here: arm() raises the hint for the press's
          lifetime and level() sheds it after — an inline hint would hold a
          compositor layer per surface across the book's hundreds of tiles,
          exactly the cost the shedding exists to avoid */}
      <div
        ref={glowRef}
        className="absolute left-0 top-0 opacity-0"
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
