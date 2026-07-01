"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Zoom relief — a permanent answer to the pinch-zoom crash on low-memory
 * iPhones.
 *
 * A pinch makes iOS re-rasterize the whole composited page at the magnified
 * scale. The app's grace layers are cheap at 1× but murderous when blown up: the
 * full-viewport soft-light desk grain, the ink-into-paper `multiply` blends on
 * every line of prose, the per-card isolation, the big blurred fills.
 * Multiplied by scale² on a device with little GPU memory, the compositor runs
 * out and Safari kills the page. (The sheet's paper grain is a static bitmap —
 * cheap to re-raster — so it's kept, not shed.)
 *
 * Earlier mitigations *reacted* to `visualViewport.scale > 1.2` — i.e. mid-pinch,
 * after the oversized layers were already being allocated, so they were always
 * racing the crash. This instead fires at the gesture's FIRST touch — the moment
 * a second finger lands (`touchstart` with two touches) or iOS's `gesturestart`,
 * before any magnification — and sheds every heavy layer at once via a single
 * `data-zooming` flag on <html> that globals.css and sheet.tsx key off. There is
 * then simply nothing expensive left to re-raster, so the crash can't occur.
 *
 * Relief is HELD as long as the page is actually magnified (scale > ~1), not
 * just while fingers are down — restoring the heavy layers while still zoomed-in
 * would re-trigger the very re-raster we're avoiding. It lifts only once the
 * scale settles back to rest, and the grace returns. Zoom itself is never
 * blocked (these listeners are all passive and never preventDefault) — it just
 * renders flat for the duration of the pinch.
 */

let zooming = false;
let started = false;
const listeners = new Set<() => void>();

function setZooming(next: boolean) {
  if (next === zooming) return;
  zooming = next;
  const root = document.documentElement;
  if (next) root.dataset.zooming = "1";
  else delete root.dataset.zooming;
  listeners.forEach((l) => l());
}

// idempotent: many components may consume the store, but the global listeners
// attach exactly once for the life of the page
function startOnce() {
  if (started || typeof window === "undefined") return;
  started = true;
  const vv = window.visualViewport;
  const magnified = () => (vv ? vv.scale > 1.01 : false);

  // earliest possible signals — before iOS ramps the scale
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length >= 2) setZooming(true);
  };
  const onGestureStart = () => setZooming(true);
  // a two-finger gesture that wasn't a zoom (scale still at rest) releases relief
  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length < 2 && !magnified()) setZooming(false);
  };
  // steady state: stay shed while magnified, restore only once back at rest
  const onViewport = () => setZooming(magnified());

  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener(
    "gesturestart",
    onGestureStart as EventListener,
    { passive: true },
  );
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("touchcancel", onTouchEnd, { passive: true });
  vv?.addEventListener("resize", onViewport);
  vv?.addEventListener("scroll", onViewport);
}

/** Mount once near the app root to drive the `data-zooming` relief flag. */
export function useZoomRelief() {
  useEffect(() => {
    startOnce();
  }, []);
}

/** Reactive read of the relief state for components that drop their own heavy
 *  layer during a pinch (the WebGL sheet texture). */
export function useZooming() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      startOnce();
      return () => {
        listeners.delete(cb);
      };
    },
    () => zooming,
    () => false,
  );
}
