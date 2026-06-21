"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  useScrollEdges,
  ScrollTerminusHead,
  ScrollTerminus,
} from "@/components/ui/scroll-terminus";

/**
 * The sheet's main scroll area. The Today page scrolls inside it and so
 * gets the standard terminus at both ends; the calendar fits the sheet
 * (h-full) and scrolls inside its own feeds, which carry their own
 * terminus — so it renders straight through, no wrapper (a wrapper would
 * collapse the calendar's h-full chain).
 */
export function SheetScroll({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const marked = pathname === "/";
  const ref = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // the content grows as the day's entries load AND as the writer types (the
  // capture textarea autosizes); watch its box so the terminus knows the
  // surface became scrollable (the scroller's own size doesn't change, so its
  // ResizeObserver wouldn't fire)
  const [contentH, setContentH] = useState(0);
  useLayoutEffect(() => {
    if (!marked) return;
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [marked]);

  // keyboard-aware: while a field on the page is focused, reserve room below it
  // for the on-screen keyboard (and its accessory/autofill bar) and keep the
  // field's foot above them — otherwise a growing entry's last lines, and the
  // caret, hide behind the keyboard with nothing below to scroll them into view.
  useEffect(() => {
    if (!marked) return;
    const vv = window.visualViewport;
    const el = ref.current;
    const content = contentRef.current;
    if (!vv || !el || !content) return;
    let field: HTMLElement | null = null;
    const sync = () => {
      // visualViewport's height excludes the keyboard AND its accessory bar, so
      // this is exactly the height they cover
      const covered = field
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0;
      content.style.paddingBottom = covered ? `${covered}px` : "";
      if (field && covered) {
        // float the field's foot just above the keyboard (8px of air)
        const over = field.getBoundingClientRect().bottom - (vv.offsetTop + vv.height - 8);
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
      content.style.paddingBottom = "";
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
      content.style.paddingBottom = "";
    };
  }, [marked]);

  // liveHeight: the Today page's own content grows as you type, so "at the
  // bottom" must read the real current height, not a cached (shorter) one
  const edges = useScrollEdges(ref, [marked, contentH], true);

  return (
    <main ref={ref} className={className}>
      {marked ? (
        <>
          <ScrollTerminusHead show={edges.top} />
          <div ref={contentRef}>{children}</div>
          <ScrollTerminus show={edges.bottom} />
        </>
      ) : (
        children
      )}
    </main>
  );
}
