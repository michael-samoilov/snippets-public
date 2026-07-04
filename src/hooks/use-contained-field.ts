"use client";

import { useEffect, type RefObject } from "react";

/**
 * Contain a growing textarea to the visible area above the on-screen
 * keyboard: a live max-height caps its autosize there, and past the cap it
 * scrolls its OWN words. WebKit's caret-follow then acts on the box itself —
 * dragging the caret (the spacebar trackpad) scrolls inside the field, never
 * the page — and no line can ever sit under the keyboard. The cap floors at
 * ~6 lines so a squeezed viewport still leaves a workable window.
 *
 * The visible bottom is read the way the today zone's kbGeom does it:
 * vv.pageTop minus the document scroll is the visual viewport's offset in
 * LAYOUT coordinates (iOS reports vv.offsetTop document-relative), plus
 * vv.height. Re-measured across the keyboard's rise and on every viewport
 * change while active.
 */
export function useContainedField(
  areaRef: RefObject<HTMLTextAreaElement | null>,
  active = true,
  bottomGap = 12,
) {
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const vv = window.visualViewport;
    // dereference at call time: the field can unmount and remount (the
    // capture sheet swaps it out during a voice take) under one hook run
    const fit = () => {
      const area = areaRef.current;
      if (!area) return;
      const doc = document.scrollingElement?.scrollTop ?? 0;
      const visBottom = vv ? vv.pageTop - doc + vv.height : window.innerHeight;
      const top = area.getBoundingClientRect().top;
      area.style.maxHeight = `${Math.max(120, Math.round(visBottom - top - bottomGap))}px`;
    };
    fit();
    const timers = [300, 700].map((ms) => setTimeout(fit, ms)); // across the keyboard's rise
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    // the field's own growth moves nothing, but a remount needs a re-fit
    const iv = setInterval(fit, 1200);
    const uncap = () => {
      // whatever field CURRENTLY holds the cap sheds it (deliberately the
      // live ref: the element may have been swapped since the effect ran)
      const area = areaRef.current;
      if (area) area.style.maxHeight = "";
    };
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(iv);
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
      uncap();
    };
  }, [areaRef, active, bottomGap]);
}
