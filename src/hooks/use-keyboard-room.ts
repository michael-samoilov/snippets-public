"use client";

import { useEffect, type RefObject } from "react";

// Above the on-screen keyboard, iOS floats an accessory band — the autofill
// pills (passwords/cards) and the dismiss-keyboard button — OVER the page.
// visualViewport's height excludes the keyboard but NOT this floating band, so
// reserve room for it on top of the keyboard's own height.
const FLOAT = 64;

/**
 * Keep a focused field clear of the on-screen keyboard AND its floating
 * accessory band, within `scrollerRef`. While a field inside the scroller is
 * focused it (a) reserves room below the content so even the last field can
 * rise, and (b) floats the field's foot above the keyboard + accessories — so a
 * long entry's last lines and the caret never hide behind them.
 *
 * The hard part is iOS, which runs its OWN focus-scroll across the keyboard's
 * rise and parks the field right at the keyboard top (under the floating band).
 * A synchronous nudge lands before that and gets overridden, so we (1) defer our
 * correction to the next frame — after iOS has scrolled — (2) run one more pass
 * once the rise has settled, and (3) set `scroll-padding-bottom` so that if iOS
 * honors it, its own scroll already clears the band and ours is a no-op. The
 * correction only ever scrolls toward the float line and never past it, so the
 * repeated passes converge instead of fighting.
 *
 * No on-screen keyboard (desktop) → visualViewport doesn't shrink → no-op, so
 * it's safe to attach everywhere. The padding is set imperatively on properties
 * React doesn't manage, so a re-render won't clear it.
 */
export function useKeyboardRoom(
  scrollerRef: RefObject<HTMLElement | null>,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const vv = window.visualViewport;
    const el = scrollerRef.current;
    if (!vv || !el) return;
    let field: HTMLElement | null = null;
    let raf = 0;
    let settle: ReturnType<typeof setTimeout> | null = null;

    const correct = () => {
      const kb = field
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      const room = kb ? `${kb + FLOAT}px` : "";
      el.style.paddingBottom = room;
      // if iOS honors it, its own focus-scroll leaves the band clear — no fight
      el.style.scrollPaddingBottom = room;
      if (field && kb) {
        // float the field's foot above the keyboard's floating accessory band
        const over =
          field.getBoundingClientRect().bottom -
          (vv.offsetTop + vv.height - FLOAT);
        if (over > 0.5) el.scrollTop += over;
      }
    };
    // always deferred: a frame after the triggering event iOS has done its own
    // focus-scroll, so ours is the offset that sticks
    const sync = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        correct();
      });
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) {
        field = t;
        sync();
        // one more pass past the keyboard's rise (~250ms), in case iOS's
        // settle-scroll lands after our frame
        if (settle) clearTimeout(settle);
        settle = setTimeout(correct, 350);
      }
    };
    const onFocusOut = () => {
      field = null;
      if (settle) clearTimeout(settle);
      settle = null;
      el.style.paddingBottom = "";
      el.style.scrollPaddingBottom = "";
    };
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("input", sync); // the field grows as it's typed into
    vv.addEventListener("resize", sync); // the keyboard opens/closes
    vv.addEventListener("scroll", sync);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("input", sync);
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
      if (raf) cancelAnimationFrame(raf);
      if (settle) clearTimeout(settle);
      el.style.paddingBottom = "";
      el.style.scrollPaddingBottom = "";
    };
  }, [scrollerRef, enabled]);
}
