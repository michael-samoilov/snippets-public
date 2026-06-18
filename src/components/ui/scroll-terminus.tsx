"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type DependencyList,
  type RefObject,
} from "react";
import { cn } from "@/lib/utils";

/* ── the scroll terminus ──────────────────────────────────────────
   The one standard treatment for a scrollable container's ends. A
   hairline marks an edge while content lies clipped past it, and clears
   once that end is in view (or everything already fit), so a line is
   shown only when there's more to reach. `useScrollEdges` watches the
   container; the sticky pieces drop in as the first/last children of
   the scroller itself. */

export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
  deps: DependencyList = [],
): { top: boolean; bottom: boolean } {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  // the scroll content's height changes only on resize or a content
  // change (the deps), so it's cached — that keeps the heavy read
  // (scrollHeight, which can force a layout of a long feed) off the
  // scroll path
  const scrollHRef = useRef(0);
  const rafRef = useRef(0);
  const compute = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // clientHeight is read live — it's a cheap box read, the same kind
    // as the scrollTop just below. iOS grows the scroller as the address
    // bar hides on the way down, *after* the cache was taken; a stale
    // height would leave the foot lit at the very bottom (and only clear
    // on overscroll), so the viewport height must be current here.
    const clientH = el.clientHeight;
    const scrollH = scrollHRef.current;
    const can = scrollH > clientH + 1;
    const top = el.scrollTop > 1;
    const bottom = can && el.scrollTop + clientH < scrollH - 1;
    setEdges((p) => (p.top === top && p.bottom === bottom ? p : { top, bottom }));
  }, [ref]);
  const refresh = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    scrollHRef.current = el.scrollHeight;
    compute();
  }, [compute, ref]);
  // scroll only reads scrollTop, and only once per frame — never a
  // synchronous layout read or setState on the scroll event itself, so
  // the first touch of a fling can't stall
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      compute();
    });
  }, [compute]);
  useLayoutEffect(() => {
    refresh();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(refresh);
    ro.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, onScroll, ...deps]);
  return edges;
}

/** The head hairline — first child of the scroller: a line pinned at the
    top while content lies clipped above, cleared at the very top. The
    mirror of the foot, for surfaces that mark both ends (the Today
    page). */
export function ScrollTerminusHead({ show }: { show: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none sticky top-0 z-[6] -mb-px h-px"
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 border-b border-rule-faint transition-opacity duration-200",
          show ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/** The foot hairline — last child of the scroller: pinned at the very
    foot while more content lies below, cleared once the last of it is in
    view. It sits on the bottom edge with nothing beneath, so an
    overscroll rubber-band reveals only the bare sheet.

    `fade` is the entry card's treatment — its long words want a gentler
    hand-off than the bare rule. It adds a soft dissolve just above the
    line, and a 1px paper cap just below it that seals the scroller's
    fractional sub-pixel bottom (so no sliver of the next line peeks
    under the rule). The cap is exactly 1px — any taller and the
    absolutely-positioned box would add enough scroll overflow to make a
    short entry think it scrolls. Both are safe only there: the card is
    plain paper, so an overscroll reveals paper on paper; over the
    textured sheet a fade reads as a band and the cap would flash. */
export function ScrollTerminus({
  show,
  fade = false,
}: {
  show: boolean;
  fade?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none sticky bottom-0 z-[6] -mt-px h-px",
        // the fade variant (the entry card) rides a hair lower so no seam of
        // the next line shows below the rule at the scroller's sub-pixel edge
        fade && "translate-y-px",
      )}
    >
      {fade && (
        <>
          <div
            className={cn(
              "absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-paper to-transparent transition-opacity duration-200",
              show ? "opacity-100" : "opacity-0",
            )}
          />
          <div
            className={cn(
              "absolute inset-x-0 top-full h-px bg-paper transition-opacity duration-200",
              show ? "opacity-100" : "opacity-0",
            )}
          />
        </>
      )}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 border-t border-rule-faint transition-opacity duration-200",
          show ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
