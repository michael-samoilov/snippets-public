"use client";

import { useLayoutEffect, useRef, useState } from "react";
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
  // the content grows as the day's entries load; watch its box so the
  // terminus knows the surface became scrollable (the scroller's own
  // size doesn't change, so its ResizeObserver wouldn't fire)
  const [contentH, setContentH] = useState(0);
  useLayoutEffect(() => {
    if (!marked) return;
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [marked]);
  const edges = useScrollEdges(ref, [marked, contentH]);

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
