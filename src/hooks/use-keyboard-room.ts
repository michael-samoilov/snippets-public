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

    const correct = () => {
      if (!field) {
        el.style.paddingBottom = "";
        el.style.scrollPaddingBottom = "";
        return;
      }
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      if (!kb) {
        el.style.paddingBottom = "";
        el.style.scrollPaddingBottom = "";
        return;
      }
      // the top of the keyboard's floating accessory band (autofill pills +
      // dismiss button) — the real ceiling the words must stay above
      const bandTop = vv.offsetTop + vv.height - FLOAT;
      if (field.hasAttribute("data-room-center")) {
        // a tall, growing field (the today zone) keeps the line being written
        // CENTRED between the top of the writing area and that band, so the
        // current line never creeps down under the keyboard as the entry grows.
        const availTop = el.getBoundingClientRect().top;
        const targetY = (availTop + bandTop) / 2;
        // reserve enough room below the content that even the last line can be
        // lifted all the way to the centre (half the available height + the
        // keyboard itself), then glue the caret's line to that centre line
        const halfAvail = Math.max(0, (bandTop - availTop) / 2);
        el.style.paddingBottom = `${kb + FLOAT + halfAvail}px`;
        el.style.scrollPaddingBottom = `${kb + FLOAT}px`;
        const lineH = parseFloat(getComputedStyle(field).lineHeight) || 24;
        const lineCentre = field.getBoundingClientRect().bottom - lineH / 2;
        const delta = lineCentre - targetY;
        if (Math.abs(delta) > 1) el.scrollTop += delta;
      } else {
        // a short field: just float its foot above the band, no more
        el.style.paddingBottom = `${kb + FLOAT}px`;
        el.style.scrollPaddingBottom = `${kb + FLOAT}px`;
        const over = field.getBoundingClientRect().bottom - bandTop;
        if (over > 0.5) el.scrollTop += over;
      }
    };
    // Run the correction NOW and again after the browser's own scrolling
    // settles. iOS runs its OWN focus/caret scroll across a focus, each newline,
    // and the keyboard's rise, and parks the caret right at the keyboard top
    // (under the floating band). A purely synchronous correction lands BEFORE
    // that scroll and gets overridden — which is why the current line dropped
    // under the keyboard on a newline (our pass lost the race) yet reappeared on
    // the next keystroke (iOS's own caret-scroll). So every trigger fires several
    // passes: immediate (wins on Android/desktop, where nothing fights us), the
    // next frame (after iOS's own scroll), and after short settles (after the
    // rise / a late caret-scroll). Each pass only moves the caret line toward its
    // target, so they converge instead of fighting.
    const settles = new Set<ReturnType<typeof setTimeout>>();
    const clearSettles = () => {
      settles.forEach(clearTimeout);
      settles.clear();
    };
    const run = (late: number[] = [140]) => {
      correct();
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0;
          correct();
        });
      clearSettles();
      for (const ms of late) {
        const id = setTimeout(() => {
          settles.delete(id);
          correct();
        }, ms);
        settles.add(id);
      }
    };
    // The field grows a whole line at a time as it's typed into; an input event
    // fires BEFORE the autosize reflow (it bubbles to us ahead of React's
    // onChange), so reacting to input alone lands a beat behind. A ResizeObserver
    // on the field instead fires AFTER layout, on the actual height change, so the
    // correction tracks every line as it appears.
    const ro = new ResizeObserver(() => run());
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) {
        field = t;
        ro.observe(t);
        // extra late passes to outlast the keyboard's rise (~250ms) and iOS's
        // settle-scroll after it
        run([140, 300, 450]);
      }
    };
    const onFocusOut = () => {
      if (field) ro.unobserve(field);
      field = null;
      clearSettles();
      el.style.paddingBottom = "";
      el.style.scrollPaddingBottom = "";
    };
    const onVvResize = () => run([140, 300]); // the keyboard opens/closes
    const onVvScroll = () => run();
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    vv.addEventListener("resize", onVvResize);
    vv.addEventListener("scroll", onVvScroll);
    // A field can be focused BEFORE this effect attaches — the entry editor
    // focuses its textarea and only THEN flips `editing`, which is what enables
    // us, so its focusin already fired into nothing. Adopt the live field now,
    // or the room never engages and the keyboard-covered tail can't be reached.
    const pre = document.activeElement as HTMLElement | null;
    if (pre && el.contains(pre) && (pre.tagName === "TEXTAREA" || pre.tagName === "INPUT")) {
      field = pre;
      ro.observe(pre);
      run([140, 300, 450]);
    }
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      vv.removeEventListener("resize", onVvResize);
      vv.removeEventListener("scroll", onVvScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      clearSettles();
      el.style.paddingBottom = "";
      el.style.scrollPaddingBottom = "";
    };
  }, [scrollerRef, enabled]);
}
