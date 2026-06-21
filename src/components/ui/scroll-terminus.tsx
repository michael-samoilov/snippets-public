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
  liveHeight = false,
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
    // liveHeight: a surface whose OWN content grows as you type (the Today
    // page's textarea) reads its scroll height live too, so "at the bottom"
    // tracks the real, current bottom instead of a cached, shorter one. A long
    // virtual feed leaves it cached (the read there can force a full layout).
    const scrollH = liveHeight ? el.scrollHeight : scrollHRef.current;
    const can = scrollH > clientH + 1;
    const top = el.scrollTop > 1;
    const bottom = can && el.scrollTop + clientH < scrollH - 1;
    setEdges((p) => (p.top === top && p.bottom === bottom ? p : { top, bottom }));
  }, [ref, liveHeight]);
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
    overscroll rubber-band reveals only the bare sheet. (The entry card's
    softer fade lives in calendar's EntryBody, as an overlay just outside
    its scroller, so the scroller's sub-pixel clip can't leak a sliver of
    the next line beneath the rule.) */
export function ScrollTerminus({
  show,
  tone = "faint",
  inset = 0,
}: {
  show: boolean;
  /** the hairline colour — the plain rule, or the blue zone outline. */
  tone?: "faint" | "wax";
  /** pull the line in from each edge (px) so it meets the zone's rounded
      corners instead of running the full scroll width — reads as the zone's
      own bottom edge. */
  inset?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none sticky bottom-0 z-[6] -mt-px h-px"
    >
      <div
        className={cn(
          "absolute bottom-0 border-t transition-opacity duration-200",
          tone === "wax" ? "border-wax/55" : "border-rule-faint",
          show ? "opacity-100" : "opacity-0",
        )}
        style={{ left: inset, right: inset }}
      />
    </div>
  );
}
