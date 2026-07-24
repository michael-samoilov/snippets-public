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
    // A focused pinned composer holds the book at frozenSt EVERY FRAME, not just
    // reactively on scroll events. On-device the book scroller — not the outer
    // <main>, which the clip stops — is what iOS reveal-scrolls to chase the
    // caret (owner diagnostic: book fired 65 scroll events during one drag). A
    // `scroll`-event snap-back fires only AFTER iOS has painted the moved frame,
    // so it loses the tug-of-war and the page visibly jumps; a rAF loop resets
    // scrollTop BEFORE each paint, so the reveal never shows. The textarea keeps
    // scrolling its own words (its scrollTop is independent), so the caret still
    // reveals — inside the card, which is the whole point. overflow:clip can't do
    // this job here: it zeroes the book's scroll offset (tested), losing the
    // composer's position. The loop runs only while a pinned composer is focused.
    // Hold the pinned book at frozenSt, and TRANSFER whatever iOS reveal-scrolled
    // it by into the TEXTAREA's own scroll — scroll its words by the same delta —
    // so the caret is revealed INSIDE the card, iOS is satisfied, and it stops
    // scrolling the book. A plain reset (no transfer) starves the textarea's reveal
    // (the caret won't scroll into view on the first drag) and leaves the book
    // firing scroll events that strand a card's press-bloom. The textarea clamps at
    // its own ends, so a caret already at the field's top/bottom just leaves the
    // book held, nothing more to reveal. Runs from BOTH the rAF (before paint) and
    // the scroll event (whichever sees the reveal first does the transfer once).
    const holdBook = () => {
      if (frozenSt == null) return;
      const d = el.scrollTop - frozenSt;
      if (Math.abs(d) <= 0.5) return;
      const f = field;
      if (f && f.hasAttribute("data-room-pin") && "scrollTop" in f) {
        (f as HTMLTextAreaElement).scrollTop += d;
      }
      el.scrollTop = frozenSt;
    };
    let pinRaf = 0;
    const pinTick = () => {
      pinRaf = 0;
      if (!pinFocused) return;
      holdBook();
      pinRaf = requestAnimationFrame(pinTick);
    };
    const startPinLoop = () => { if (!pinRaf) pinRaf = requestAnimationFrame(pinTick); };
    const stopPinLoop = () => { if (pinRaf) { cancelAnimationFrame(pinRaf); pinRaf = 0; } };
    // A focused pinned composer holds its centred target for the WHOLE focus, so
    // thaw must not null it (overflow:hidden alone can't stop a programmatic
    // caret-reveal — only snapping back to a still-set frozenSt does). correct()
    // keeps that target fresh as the box grows / the keyboard rises.
    const thaw = () => { if (!pinFocused) frozenSt = null; };
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
        if (field && document.activeElement === field && !touchDown) {
          // a pinned composer freezes to its COMPUTED centred target (correct()
          // writes it), never to wherever the book happens to sit; every other
          // field holds the position it settled at
          if (field.hasAttribute("data-room-pin")) correct();
          else frozenSt = el.scrollTop;
        }
      };
      armT = setTimeout(arm, 900);
    };
    // While a pinned composer is focused the book is held unscrollable outright
    // (pinFocused, below), so a touch can neither thaw its freeze nor re-arm it —
    // the hold, not the arm lifecycle, keeps it put. Every other touch thaws and
    // re-arms as before.
    const onTouchStart = () => { touchDown = true; if (!pinFocused) thaw(); clearTimeout(armT); };
    const onTouchEnd = () => { touchDown = false; if (!pinFocused) rearm(); };

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
    // Both the range-selection hold and the pinned-composer hold (below) make the
    // outer book unscrollable the same way — overflow:hidden, with frozenSt as
    // the snap fallback for engines that still scroll a hidden box. Refcounted
    // over the two owners so releasing one never lifts the other's lock.
    let selLocked = false;
    let pinFocused = false;
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
      if (!overflowHeld || selLocked || pinFocused) return; // the other owner still holds
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

    // The pinned composer's contract: while it is focused the book NEVER scrolls
    // — its own box scrolls the words, and correct() keeps the card in the visible
    // band. Dragging the caret to the box's top/bottom edge makes WebKit
    // reveal-scroll the nearest SCROLLABLE ANCESTOR to chase the caret, flinging
    // the page around (owner videos). Making just this scroller overflow:hidden
    // is not enough: WebKit walks PAST a hidden scroller to the next scrollable
    // one — the schedule sits in TWO nested scrollers (the book + the sheet's
    // <main>), so locking only the book handed the reveal to <main> and the whole
    // page scrolled instead (owner video, 2026-07-23, third pass). So lock the
    // WHOLE ancestor chain: with every scrollable ancestor overflow:hidden, WebKit
    // has nothing left to escalate to (the app root is position:fixed) and reveals
    // the caret inside the textarea alone. correct() still positions the card via
    // programmatic scrollTop (which works under overflow:hidden); frozenSt
    // snap-back stays as a fallback. No drag detection — the book is simply held.
    const lockedAncestors: { node: HTMLElement; prev: string }[] = [];
    const lockAncestors = () => {
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const oy = getComputedStyle(node).overflowY;
        // lock even a not-yet-scrollable ancestor: the keyboard shrinks the
        // viewport a beat later and it becomes scrollable then
        if (oy === "auto" || oy === "scroll") {
          lockedAncestors.push({ node, prev: node.style.overflow });
          // overflow:CLIP, not hidden: a `hidden` element is still a scroll
          // container that iOS's caret-reveal (scrollRectToVisible) can move —
          // `clip` is NOT a scroll container at all, so the reveal skips it. The
          // outer scrollers never need programmatic scrolling (only the inner
          // book does, via correct(), so it stays `hidden`), so clipping them is
          // safe and should leave iOS nothing to reveal-scroll (owner-device
          // diagnosis, 2026-07-23). Set BOTH axes via the shorthand: a mixed
          // `overflow-x:hidden; overflow-y:clip` normalizes back to hidden.
          node.style.overflow = "clip";
        }
        node = node.parentElement;
      }
    };
    const unlockAncestors = () => {
      for (const a of lockedAncestors) a.node.style.overflow = a.prev;
      lockedAncestors.length = 0;
    };
    const holdPinFocus = () => {
      if (pinFocused) return;
      pinFocused = true;
      holdOverflow();
      lockAncestors();
      startPinLoop();
      el.setAttribute("data-pin-held", String(lockedAncestors.length)); // diagnostic signal
    };
    const releasePinFocus = () => {
      if (!pinFocused) return;
      pinFocused = false;
      stopPinLoop();
      unlockAncestors();
      releaseOverflow();
      el.removeAttribute("data-pin-held");
    };
    const onDocSelChange = () => {
      if (!coarse || !field || document.activeElement !== field) return;
      const f = field as HTMLTextAreaElement;
      if (typeof f.selectionStart !== "number") return;
      if (f.selectionStart !== f.selectionEnd) lockForSelection();
      else unlockSelection();
    };

    const onElScroll = () => {
      const st = el.scrollTop;
      if (pinFocused && frozenSt != null) {
        // a focused pinned composer: the book holds still, full stop — the reveal
        // is transferred into the textarea (holdBook) rather than fought, so the
        // caret still scrolls into view inside the card
        holdBook();
        lastElMoveAt = performance.now();
        return;
      }
      if (selLocked && frozenSt != null) {
        // a range-selection handle drag: the book holds still, full stop —
        // touchDown doesn't exempt it (any programmatic reveal is snapped back)
        if (Math.abs(st - frozenSt) > 0.5) el.scrollTop = frozenSt;
        lastElMoveAt = performance.now();
        return;
      }
      lastElMoveAt = performance.now();
      // A pinned composer must hold even mid-fling. Its freeze gets thawed by a
      // stray touch (onTouchStart), and while the book is still coasting arm()
      // refuses to re-commit — it waits for a stillness a momentum fling never
      // reaches — so frozenSt stays null, the clamp below is skipped, and the
      // composer coasts off-screen (the "slides out of view while typing" case,
      // confirmed on-device: a long run of scroll events with froz=null). Re-
      // assert its centred target right here, on every scroll, independent of the
      // arm lifecycle, so a coasting fling is stopped on its first frame. A real
      // finger scroll (touchDown) still passes through untouched.
      if (
        frozenSt == null &&
        !touchDown &&
        field &&
        field.hasAttribute("data-room-pin") &&
        document.activeElement === field
      ) {
        correct(); // recompute the centred target, snap to it, re-freeze
        return;
      }
      if (frozenSt == null || touchDown) return;
      if (Math.abs(st - frozenSt) > 0.5) el.scrollTop = frozenSt; // absolute: idempotent
    };

    const correct = () => {
      if (selLocked) return; // a handle drag owns the view outright
      const isPinned = !!field && field.hasAttribute("data-room-pin");
      // a walk owns the view; the box reveals its own caret — EXCEPT a pinned
      // composer, whose book must never follow the caret at all: for it, correct()
      // re-asserts the centred anchor on every pass instead of standing down.
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
      // so the book need not follow the caret at all: anchor the card in the
      // visible band and FREEZE to that computed target. Because the target is
      // recomputed (not captured), onElScroll snaps any stray reveal straight back
      // to it — the hold self-heals no matter when the walk begins.
      if (isPinned) {
        // FOOT-ANCHORED, always: the card is capped at the six-line box (max-h),
        // so its foot sits just above the keyboard band and the whole card stays
        // on screen. The height no longer changes at the six→seven-line boundary
        // (past six the box scrolls its own words), so keeping ONE formula means
        // the card does not JUMP when it becomes scrollable — the earlier code
        // switched to a centred target exactly there, and the card leapt up (owner
        // video, 2026-07-23). Clamp the head below the scroller's own visible top
        // (below the calendar header) so a small screen never tucks it up there.
        const ceil = el.getBoundingClientRect().top + 8;
        const desiredTop = Math.max(ceil, bandTop - r.height);
        const delta = r.top - desiredTop;
        if (Math.abs(delta) > 0.5) el.scrollTop += delta;
        frozenSt = el.scrollTop; // hold the anchored target; drift snaps back
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
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (managed(t)) {
        field = t;
        ro.observe(t!);
        // a pinned composer holds the book unscrollable for its whole focus
        if (t!.hasAttribute("data-room-pin")) holdPinFocus();
        // extra late passes to outlast the keyboard's rise (~250ms) and iOS's
        // settle-scroll after it
        run([140, 300, 450]);
        rearm();
      }
    };
    const onFocusOut = () => {
      if (field) ro.unobserve(field);
      releasePinFocus();
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
      if (pre.hasAttribute("data-room-pin")) holdPinFocus();
      run([140, 300, 450]);
      rearm();
    }
    return () => {
      selLocked = false;
      pinFocused = false;
      stopPinLoop();
      unlockAncestors(); // restore any locked outer scrollers
      releaseOverflow(); // restore overflow whichever owner held it
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
