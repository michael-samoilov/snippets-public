"use client";

/* ── on-device scroll diagnostic (temporary; remove after the composer
   caret-drag / seventh-line-jump is fixed) ──────────────────────────────

   Headless Chromium can't reproduce iOS Safari's caret-reveal scroll, so this
   overlay reports, live on the device, WHICH scroller iOS actually moves during
   a caret drag or when the box becomes scrollable — the book scroller, the
   sheet's <main>, the window, or a visual-viewport pan — and whether the
   composer's scroll locks are even applied. Enable with `?kbdebug=1` in the URL.

   Reads:
   • book / main / win  — scrollTop + how many scroll events fired (x N) + the
     element's live computed overflow-y (so we can see if the lock is on).
   • vv — visualViewport offsetTop/height + how many vv-scroll events fired
     (a rising vv count with flat book/main/win means iOS is PANNING the visual
     viewport, which no overflow rule can stop).
   • pin — the book scroller's data-pin-held (number of ancestors locked), so we
     know holdPinFocus actually ran. */

import { useEffect, useState } from "react";

export function KbdScrollDebug() {
  const [on] = useState(
    () => typeof location !== "undefined" && /(?:\?|&)kbdebug=1/.test(location.search),
  );
  const [txt, setTxt] = useState("kbdebug: waiting…");

  useEffect(() => {
    if (!on) return;
    const vv = window.visualViewport;
    const counts = { book: 0, main: 0, win: 0, vv: 0 };
    const oy = (el: HTMLElement | null) => (el ? getComputedStyle(el).overflowY : "-");
    const find = () => ({
      book: document.querySelector<HTMLElement>("[data-book-scroller]"),
      main: document.querySelector<HTMLElement>("main"),
    });

    const render = () => {
      const { book, main } = find();
      setTxt(
        [
          `book ${book ? Math.round(book.scrollTop) : "-"}  x${counts.book}  oy:${oy(book)}`,
          `main ${main ? Math.round(main.scrollTop) : "-"}  x${counts.main}  oy:${oy(main)}`,
          `win  ${Math.round(window.scrollY)}  x${counts.win}`,
          `vv   top:${vv ? vv.offsetTop.toFixed(1) : "-"}  h:${vv ? Math.round(vv.height) : "-"}  x${counts.vv}`,
          `pin  ${book?.getAttribute("data-pin-held") ?? "off"}`,
        ].join("\n"),
      );
    };

    const onBook = () => { counts.book++; render(); };
    const onMain = () => { counts.main++; render(); };
    const onWin = () => { counts.win++; render(); };
    const onVv = () => { counts.vv++; render(); };

    // the book scroller mounts/unmounts with the calendar view; (re)wire on an
    // interval so the listeners always sit on the live element
    let book: HTMLElement | null = null;
    let main: HTMLElement | null = null;
    const wire = () => {
      const f = find();
      if (f.book !== book) {
        book?.removeEventListener("scroll", onBook);
        book = f.book;
        book?.addEventListener("scroll", onBook, { passive: true });
      }
      if (f.main !== main) {
        main?.removeEventListener("scroll", onMain);
        main = f.main;
        main?.addEventListener("scroll", onMain, { passive: true });
      }
      render();
    };
    const iv = setInterval(wire, 500);
    wire();
    window.addEventListener("scroll", onWin, { passive: true });
    vv?.addEventListener("scroll", onVv);
    vv?.addEventListener("resize", render);

    return () => {
      clearInterval(iv);
      book?.removeEventListener("scroll", onBook);
      main?.removeEventListener("scroll", onMain);
      window.removeEventListener("scroll", onWin);
      vv?.removeEventListener("scroll", onVv);
      vv?.removeEventListener("resize", render);
    };
  }, [on]);

  if (!on) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 99999,
        background: "rgba(0,0,0,0.82)",
        color: "#3f6",
        font: "11px/1.35 ui-monospace, monospace",
        padding: "6px 8px",
        whiteSpace: "pre",
        pointerEvents: "none",
        borderBottomRightRadius: 6,
      }}
    >
      {txt}
    </div>
  );
}
