"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  useScrollEdges,
  ScrollTerminusHead,
  ScrollTerminus,
} from "@/components/ui/scroll-terminus";
import { useKeyboardRoom } from "@/hooks/use-keyboard-room";

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

  // keep the capture field (and a growing entry's last lines) clear of the
  // keyboard and its floating accessory band
  useKeyboardRoom(ref, marked);

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
