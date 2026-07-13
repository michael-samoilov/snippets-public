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
    // whether WE wrote the scroller's bottom padding. The today zone manages its
    // own padding on this same scroller (see anchorTail in calendar/page.tsx) and
    // its textarea's input events bubble here — an unconditional clear on the
    // "no managed field" path was silently wiping the zone's padding a frame
    // after every keystroke, clamping its scroll correction.
    let padOurs = false;
    const clearPad = () => {
      if (!padOurs) return;
      padOurs = false;
      el.style.paddingBottom = "";
      el.style.scrollPaddingBottom = "";
    };
    // the visual viewport's height with NO keyboard, tracked as its running max.
    // The keyboard's inset is then how far the viewport has shrunk from that —
    // which works whether iOS keeps window.innerHeight full and only shrinks
    // visualViewport (Safari) OR shrinks the layout viewport too (standalone
    // PWA), where the old `innerHeight - vv.height` read zero and the correction
    // never engaged.
    let baseVh = vv.height;

    // While a managed field is being written in AND the editing state is at
    // rest, the book is FROZEN. These fields are contained cards — their own
    // box scrolls the words internally — so no outer scroll is ever
    // legitimate unless a real mover speaks: a finger, a wheel, a keystroke
    // (whose reflow may need the room correction), or the keyboard resizing.
    // Everything else — above all WebKit's selection auto-scroll chasing the
    // spacebar-trackpad's virtual cursor beyond the box, which flings the
    // whole schedule — is pathology and is simply held still. Each legitimate
    // mover thaws and re-arms a beat later (past iOS's own late caret-reveal
    // scrolls). Walk detection by caret movement is NOT enough here: an
    // EMPTY composer emits no selectionchange at all while the cursor roams.
    // Coarse pointers only — a desktop scrollbar drag must never be fought.
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    let frozenSt: number | null = null;
    let touchDown = false;
    let lastElMoveAt = 0; // the scroller's last movement (any cause)
    let armT: ReturnType<typeof setTimeout> | undefined;
    const thaw = () => { frozenSt = null; };
    const rearm = () => {
      thaw();
      clearTimeout(armT);
      if (!coarse) return;
      const arm = () => {
        // never freeze a book still in motion: a fling can outlast the arm
        // delay, and locking mid-momentum both kills the fling (the exact
        // jank the feed design exists to avoid) and captures an arbitrary
        // scroll as "the" position — stranding the field off-screen
        if (performance.now() - lastElMoveAt < 300) {
          armT = setTimeout(arm, 400);
          return;
        }
        if (field && document.activeElement === field && !touchDown) frozenSt = el.scrollTop;
      };
      armT = setTimeout(arm, 900);
    };
    const onTouchStart = () => { touchDown = true; thaw(); clearTimeout(armT); };
    const onTouchEnd = () => { touchDown = false; rearm(); };

    // A SELECTION-HANDLE drag is the freeze's hardest case: iOS delivers no
    // touch events under a native handle, and WebKit's auto-scroll chases the
    // handle into the outer book — snapping back after each step painted as a
    // janky tug-of-war. The words the drag could want are all reachable inside
    // the contained box, so while a non-collapsed selection is moving in the
    // managed field the outer scroller is made unscrollable outright
    // (overflow hidden — the scrollbar is already hidden, so nothing shifts),
    // with the snap kept underneath as a fallback for engines that still
    // programmatically scroll a hidden-overflow box. The lock lifts when the
    // selection collapses, the field blurs, or the drag goes quiet.
    let selLocked = false;
    let selLockTimer: ReturnType<typeof setTimeout> | undefined;
    let savedOverflowY = "";
    const unlockSelection = () => {
      if (!selLocked) return;
      selLocked = false;
      clearTimeout(selLockTimer);
      el.style.overflowY = savedOverflowY;
      rearm();
    };
    const lockForSelection = () => {
      if (!selLocked) {
        selLocked = true;
        savedOverflowY = el.style.overflowY;
        el.style.overflowY = "hidden";
        if (frozenSt == null) frozenSt = el.scrollTop; // the snap fallback's target
      }
      clearTimeout(selLockTimer);
      selLockTimer = setTimeout(unlockSelection, 700);
    };
    const onDocSelChange = () => {
      if (!coarse || !field || document.activeElement !== field) return;
      const f = field as HTMLTextAreaElement;
      if (typeof f.selectionStart !== "number") return;
      if (f.selectionStart !== f.selectionEnd) lockForSelection();
      else unlockSelection();
    };

    const onElScroll = () => {
      // Cheap first, and NEVER touch layout unless we're actually pinning.
      // Reading `el.scrollTop` forces a synchronous layout flush whenever the
      // DOM is dirty — and the WINDOWED feed dirties it on every reshuffle, so an
      // unconditional read here (this fires on every scroll event of a fling)
      // thrashed layout and stalled the scroll. With nothing frozen there is
      // nothing to correct, so record the movement and get out layout-free.
      lastElMoveAt = performance.now();
      if (frozenSt == null && !selLocked) return;
      const st = el.scrollTop;
      if (selLocked && frozenSt != null) {
        // during a handle drag the page holds still, full stop — the finger
        // on the handle is not a page scroll, so touchDown doesn't exempt it
        if (Math.abs(st - frozenSt) > 0.5) el.scrollTop = frozenSt;
        return;
      }
      if (touchDown || frozenSt == null) return;
      if (Math.abs(st - frozenSt) > 0.5) el.scrollTop = frozenSt; // absolute: idempotent
    };

    const correct = () => {
      if (selLocked) return; // a handle drag owns the view outright
      if (frozenSt != null) return; // a walk owns the view; the box reveals its own caret
      if (!field) {
        clearPad();
        return;
      }
      baseVh = Math.max(baseVh, vv.height);
      // vv.offsetTop is document-relative on iOS (== pageTop, double-counting
      // the keyboard pan); pageTop minus the document scroll is the visual
      // viewport's offset in LAYOUT coordinates on every engine — the same
      // read as the today zone's kbGeom and useContainedField
      const doc = document.scrollingElement?.scrollTop ?? window.scrollY ?? 0;
      const layoutTop = vv.pageTop - doc;
      const kb = Math.max(
        window.innerHeight - vv.height - layoutTop, // Safari: layout stays full
        baseVh - vv.height, // PWA: layout viewport shrinks with the keyboard
      );
      if (kb < 60) {
        clearPad();
        return;
      }
      // the top of the keyboard's floating accessory band (autofill pills +
      // dismiss button) — the real ceiling the words must stay above
      const bandTop = layoutTop + vv.height - FLOAT;
      // float the field's foot above the band, no more
      padOurs = true;
      el.style.paddingBottom = `${kb + FLOAT}px`;
      el.style.scrollPaddingBottom = `${kb + FLOAT}px`;
      const r = field.getBoundingClientRect();
      const over = r.bottom - bandTop;
      if (over > 0.5) {
        el.scrollTop += over;
      } else if (!touchDown) {
        // …and the symmetric rescue: a scroll (or a freeze that captured the
        // wrong moment) can park the book PAST the field, leaving the writer
        // typing into a card stranded above the fold — the down-clamp alone
        // never brings it back. Pull the field's foot back under the top
        // chrome so the last lines and the caret are visible again.
        const under = layoutTop + 72 - r.bottom;
        if (under > 0.5) el.scrollTop -= under;
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
    // The field grows a whole line at a time as it's typed into. Two triggers,
    // because either alone has failed: a ResizeObserver on the field fires AFTER
    // layout on the real height change (tracks each line as it appears), and the
    // raw `input` event catches the change even where the observer doesn't land a
    // callback for a programmatic height set. `input` fires BEFORE the autosize
    // reflow, so its immediate pass reads the old height — but run()'s deferred
    // passes re-measure after the reflow, so the caret still ends up placed.
    const ro = new ResizeObserver(() => run());
    const onInput = () => {
      rearm(); // typing is a legitimate mover; freeze again once it settles
      run();
    };
    // a field marked data-room-center anchors its own tail (the today zone owns
    // its scroll) — this generic room stays out of its way entirely.
    const managed = (t: HTMLElement | null) =>
      !!t &&
      (t.tagName === "TEXTAREA" || t.tagName === "INPUT") &&
      !t.hasAttribute("data-room-center");
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (managed(t)) {
        field = t;
        ro.observe(t!);
        // extra late passes to outlast the keyboard's rise (~250ms) and iOS's
        // settle-scroll after it
        run([140, 300, 450]);
        rearm();
      }
    };
    const onFocusOut = () => {
      if (field) ro.unobserve(field);
      unlockSelection();
      field = null;
      thaw();
      clearTimeout(armT);
      clearSettles();
      clearPad();
    };
    const onVvResize = () => { rearm(); run([140, 300]); }; // the keyboard opens/closes
    const onVvScroll = () => run();
    const onWheel = () => rearm();
    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("input", onInput);
    el.addEventListener("scroll", onElScroll, { passive: true });
    document.addEventListener("selectionchange", onDocSelChange);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("wheel", onWheel, { passive: true });
    vv.addEventListener("resize", onVvResize);
    vv.addEventListener("scroll", onVvScroll);
    // A field can be focused BEFORE this effect attaches — the entry editor
    // focuses its textarea and only THEN flips `editing`, which is what enables
    // us, so its focusin already fired into nothing. Adopt the live field now,
    // or the room never engages and the keyboard-covered tail can't be reached.
    const pre = document.activeElement as HTMLElement | null;
    if (pre && el.contains(pre) && managed(pre)) {
      field = pre;
      ro.observe(pre);
      run([140, 300, 450]);
      rearm();
    }
    return () => {
      unlockSelection();
      clearTimeout(selLockTimer);
      document.removeEventListener("selectionchange", onDocSelChange);
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("input", onInput);
      el.removeEventListener("scroll", onElScroll);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("wheel", onWheel);
      clearTimeout(armT);
      vv.removeEventListener("resize", onVvResize);
      vv.removeEventListener("scroll", onVvScroll);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      clearSettles();
      clearPad();
    };
  }, [scrollerRef, enabled]);
}
