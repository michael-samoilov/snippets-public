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
    // (A spacebar-trackpad walk delivers no touch to the page — the finger is
    // on the native keyboard — so touchDown stays false and this freeze is
    // what stands against it.)
    // Coarse pointers only — a desktop scrollbar drag must never be fought.
    const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    let frozenSt: number | null = null;
    let touchDown = false;
    let lastElMoveAt = 0; // the scroller's last movement (any cause)
    let armT: ReturnType<typeof setTimeout> | undefined;
    // What the freeze deliberately does NOT do is chase the caret. Dragging it
    // to the TOP of a scrolled inner box to pull the hidden lines above into view
    // is a standing iOS/WebKit limitation (WebKit #138201): the caret can't land
    // on off-screen text, so WebKit's reveal never fires and iOS emits no scroll
    // to redirect (owner overlay, confirmed: "during the drag up nothing moves").
    // Chasing it — a rAF that reset the book every frame, and redirecting iOS's
    // reveal into the field — was tried across many passes and is all removed as
    // dead: there is nothing to fight. The hidden lines are reached by
    // finger-scrolling the card, which works natively.
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
        // hold wherever the reader left the book — including with the field
        // scrolled away. Re-anchoring here instead (which a pinned composer
        // used to do) is what made a deliberate scroll spring back.
        if (field && document.activeElement === field && !touchDown) {
          frozenSt = el.scrollTop;
        }
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
    // selection collapses or the field blurs — and ONLY then. It used to
    // also lift after 700ms of quiet, but each lift/relock flips the
    // scroller's overflow, and iOS dismisses the Cut/Copy/Paste callout on
    // any such layout change: tapping a standing selection re-locked (menu
    // died as it opened), and the quiet-unlock killed it moments later.
    // While the selection stands, the lock simply holds — every word the
    // writer could want is inside the contained box, and any tap outside
    // collapses the selection and frees the scroller.
    // The range-selection hold is now the ONLY thing that makes the outer book
    // unscrollable, and only for as long as a selection stands. A second owner
    // — a pinned composer, held for its whole focus — was removed: see the
    // scroll contract above onElScroll.
    let selLocked = false;
    let savedOverflowY = "";
    let overflowHeld = false;
    const holdOverflow = () => {
      if (!overflowHeld) {
        overflowHeld = true;
        savedOverflowY = el.style.overflowY;
        el.style.overflowY = "hidden"; // scrollbar already hidden → nothing shifts
      }
      if (frozenSt == null) frozenSt = el.scrollTop; // the snap fallback's target
    };
    const releaseOverflow = () => {
      if (!overflowHeld || selLocked) return;
      overflowHeld = false;
      el.style.overflowY = savedOverflowY;
    };
    const unlockSelection = () => {
      if (!selLocked) return;
      selLocked = false;
      releaseOverflow();
      rearm();
    };
    const lockForSelection = () => {
      if (selLocked) return; // already held — no writes, the callout lives
      selLocked = true;
      holdOverflow();
    };

    const onDocSelChange = () => {
      if (!coarse || !field || document.activeElement !== field) return;
      const f = field as HTMLTextAreaElement;
      if (typeof f.selectionStart !== "number") return;
      if (f.selectionStart !== f.selectionEnd) lockForSelection();
      else unlockSelection();
    };

    // THE SCROLL CONTRACT while a field is being written in: the reader may
    // scroll the book freely, and may scroll the field itself right off the
    // screen. correct() brings it back the moment they WRITE again (input, a
    // reflow, the keyboard changing height) — and at no other moment.
    //
    // It used to be the opposite: a pinned composer held the book overflow:hidden
    // for its whole focus and correct() re-anchored the card on every stray
    // scroll, including every visualViewport scroll. That is what put the caret
    // outside its own card (owner recording, 2026-07-31, measured frame by frame:
    // the card held still to the pixel while the caret climbed ~100px up the page
    // and came to rest between two OTHER cards). The mechanism: with the book
    // unscrollable, iOS spends the drag panning the visual viewport instead;
    // correct() answered each pan by scrolling the book the opposite way, so the
    // card stayed put on screen while its real scroll offset moved — and iOS
    // draws the caret from the real offset. Cancelling the reader's scroll is
    // what desynchronised the two. So the app no longer cancels it.
    const onElScroll = () => {
      const st = el.scrollTop;
      if (selLocked && frozenSt != null) {
        // a range-selection handle drag: the book holds still, full stop —
        // touchDown doesn't exempt it (any programmatic reveal is snapped back)
        if (Math.abs(st - frozenSt) > 0.5) el.scrollTop = frozenSt;
        lastElMoveAt = performance.now();
        return;
      }
      lastElMoveAt = performance.now();
      if (frozenSt == null || touchDown) return;
      if (Math.abs(st - frozenSt) > 0.5) el.scrollTop = frozenSt; // absolute: idempotent
    };

    const correct = () => {
      if (selLocked) return; // a handle drag owns the view outright
      const isPinned = !!field && field.hasAttribute("data-room-pin");
      // a walk owns the view; the box reveals its own caret — EXCEPT a pinned
      // composer, which must be able to come BACK from wherever the reader
      // scrolled it, and a freeze is exactly the state it will be in when they
      // start typing again. So it runs through the freeze rather than standing
      // down (and re-targets it below instead of fighting onElScroll).
      if (frozenSt != null && !isPinned) return;
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
      // A contained composer (data-room-pin) reveals its own caret inside its box,
      // so the book need not follow the caret at all: it only has to make sure
      // the card is READABLE — fully between the scroller's visible top and the
      // keyboard band — at the moments the reader is actually writing.
      if (isPinned) {
        // FOOT-ANCHORED: the card is capped at the six-line box (max-h), so its
        // foot sits just above the keyboard band and the whole card stays on
        // screen. The height no longer changes at the six→seven-line boundary
        // (past six the box scrolls its own words), so keeping ONE formula means
        // the card does not JUMP when it becomes scrollable — the earlier code
        // switched to a centred target exactly there, and the card leapt up (owner
        // video, 2026-07-23). Clamp the head below the scroller's own visible top
        // (below the calendar header) so a small screen never tucks it up there.
        const ceil = el.getBoundingClientRect().top + 8;
        // …but a card already whole and clear of the keyboard is LEFT ALONE. The
        // reader is allowed to scroll it anywhere in that band and keep typing
        // there; pulling it back to the exact anchor on every keystroke would
        // undo a scroll they meant.
        if (r.top >= ceil - 0.5 && r.bottom <= bandTop + 0.5) return;
        const desiredTop = Math.max(ceil, bandTop - r.height);
        const delta = r.top - desiredTop;
        if (Math.abs(delta) > 0.5) el.scrollTop += delta;
        // re-target an EXISTING freeze (never create one): the reader's own
        // resting position is arm()'s to capture, not ours.
        if (frozenSt != null) frozenSt = el.scrollTop;
        return;
      }
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
    // The book lazy-renders: a day section outside the warm band is
    // `content-visibility: hidden`, and a hidden subtree is NOT focusable — so
    // scrolling the field's own day out of the band makes the engine blur it
    // (measured: activeElement drops to <body> in the same frame the row loses
    // [data-warm]; on iOS the keyboard falls with it). Since the reader may now
    // scroll the field clean off the screen and go on typing, its day is kept
    // rendered for exactly as long as it holds focus.
    let writingRow: HTMLElement | null = null;
    const holdRow = (t: HTMLElement) => {
      writingRow = t.closest("[data-day]");
      writingRow?.setAttribute("data-writing", "");
    };
    const releaseRow = () => {
      writingRow?.removeAttribute("data-writing");
      writingRow = null;
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (managed(t)) {
        field = t;
        ro.observe(t!);
        holdRow(t!);
        // extra late passes to outlast the keyboard's rise (~250ms) and iOS's
        // settle-scroll after it
        run([140, 300, 450]);
        rearm();
      }
    };
    const onFocusOut = () => {
      if (field) ro.unobserve(field);
      releaseRow();
      unlockSelection();
      field = null;
      thaw();
      clearTimeout(armT);
      clearSettles();
      clearPad();
    };
    const onVvResize = () => { rearm(); run([140, 300]); }; // the keyboard opens/closes
    // A visual-viewport SCROLL is iOS panning its window over the page — not the
    // reader writing. For a contained composer, answering it by scrolling the
    // book the other way is exactly the caret-drift engine described above, so
    // it is left alone; a plain field still gets pulled back above the band.
    const onVvScroll = () => {
      if (field?.hasAttribute("data-room-pin")) return;
      run();
    };
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
      holdRow(pre);
      run([140, 300, 450]);
      rearm();
    }
    return () => {
      selLocked = false;
      releaseOverflow();
      releaseRow();
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
