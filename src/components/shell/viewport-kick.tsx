"use client";

import { useEffect } from "react";

/**
 * iOS Safari can lay out the very first paint against the WRONG viewport — the
 * address-bar-RETRACTED (large) height — and then never re-resolve the
 * viewport-based heights (the shell's `h-svh`, the today zone's `min-h-full`)
 * when the bar settles a beat later. The result: the full-height zone is taller
 * than the screen (its wax seal clips off the bottom) until a manual refresh.
 *
 * We found this by accident: a diagnostic overlay that repeatedly measured the
 * layout made the bug vanish, because *any* layout mutation forces iOS to
 * recompute at the now-settled viewport. So this component does the minimal
 * version of that on purpose: for a couple of seconds after mount — and again
 * on every real viewport change — it appends and immediately removes a
 * throwaway node, dirtying document layout so the heights re-resolve. The node
 * is zero-size and out of flow, so there's no visual change and no scroll shift;
 * on a device that already laid out correctly it's a no-op.
 */
export function ViewportReflowKick() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const kick = () => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:fixed;left:-9999px;top:0;width:0;height:0;pointer-events:none;visibility:hidden";
      document.body.appendChild(probe);
      void probe.offsetHeight; // flush: force the recompute synchronously, now
      probe.remove();
    };

    // Nudge across the address bar's settle window (~2s), then stop — the
    // resize / visualViewport listeners cover anything later (rotation, the
    // bar showing/hiding). Timestamp comes from the mount frame, not the clock.
    let raf = 0;
    let frames = 0;
    const loop = () => {
      kick();
      if (frames++ < 130) raf = requestAnimationFrame(loop); // ~2s at 60fps
    };
    raf = requestAnimationFrame(loop);

    const onResize = () => kick();
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  return null;
}
