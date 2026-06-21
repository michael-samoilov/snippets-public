"use client";

import { useEffect, type RefObject } from "react";

// Above the on-screen keyboard, iOS floats an accessory band — the autofill
// pills (passwords/cards) and the dismiss-keyboard button — OVER the page.
// visualViewport's height excludes the keyboard but NOT this floating band, so
// reserve room for it on top of the keyboard's own height.
const FLOAT = 60;

/**
 * Keep a focused field clear of the on-screen keyboard AND its floating
 * accessory band, within `scrollerRef`. While a field inside the scroller is
 * focused it (a) reserves room below the content so even the last field can
 * rise, and (b) floats the field's foot above the keyboard + accessories — so a
 * long entry's last lines and the caret never hide behind them.
 *
 * No on-screen keyboard (desktop) → visualViewport doesn't shrink → no-op, so
 * it's safe to attach everywhere. The padding is set imperatively on a property
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
    const sync = () => {
      const kb = field
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      el.style.paddingBottom = kb ? `${kb + FLOAT}px` : "";
      if (field && kb) {
        // float the field's foot above the keyboard's floating accessory band
        const over = field.getBoundingClientRect().bottom - (vv.offsetTop + vv.height - FLOAT);
        if (over > 0) el.scrollTop += over;
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) {
        field = t;
        sync();
      }
    };
    const onFocusOut = () => {
      field = null;
      el.style.paddingBottom = "";
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
      el.style.paddingBottom = "";
    };
  }, [scrollerRef, enabled]);
}
