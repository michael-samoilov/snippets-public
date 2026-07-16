"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isAfter,
  isSameDay,
  isSameMonth,
  startOfMonth,
} from "date-fns";
import { motion, useMotionValue, animate } from "motion/react";
import { dayKey, dateFromDayKey } from "@/lib/dates";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useScrollEdges, ScrollTerminus } from "@/components/ui/scroll-terminus";
import { MonthSkeleton } from "./skeletons";
import {
  buildMonthGeom,
  indexAt,
  leadOffset,
  settleBottom,
  monthsBetween,
  ym,
  ringSpringFor,
} from "./shared";
import type { MonthGeom, MonthFeedHandle } from "./shared";

/* ── the month feed ─────────────────────────────────────────────── */

function MonthFeedBase({
  handleRef,
  activeRef,
  today,
  span,
  counts,
  selected,
  onPick,
  onPickHint,
  onVisible,
}: {
  handleRef: React.MutableRefObject<MonthFeedHandle | null>;
  /** interactivity gate, read at event time — a REF so the zoom's start/finish
      commits (which flip it) never re-render this whole feed (that re-render +
      its layout was the dive/rise's front-loaded stall) */
  activeRef: RefObject<boolean>;
  today: Date;
  /** how many months the canvas reaches back (shared with the glance) */
  span: number;
  counts: Map<string, number> | undefined;
  selected: string;
  onPick: (key: string) => void;
  /** fired on pointerdown of a day cell — the tap's ~100ms dwell is free time
      to stage the dive's destination (scroll + warm the book) before onPick */
  onPickHint?: (key: string) => void;
  onVisible: (m: Date) => void;
  /** fully hidden (not this altitude, not in a zoom) — memo skips
      re-renders while frozen, so a book scroll never re-renders the
      invisible canvas; it re-renders the moment it's shown again */
  frozen?: boolean;
}) {
  const currentMonth = startOfMonth(today);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const [metrics, setMetrics] = useState<{ w: number; h: number; labelH: number } | null>(null);
  const [scrollY, setScrollY] = useState<number | null>(null);
  const visibleIdxRef = useRef(-1);
  const anchorMonthRef = useRef<Date | null>(null);
  const rafRef = useRef(0);
  const didInit = useRef(false);
  // a programmatic smooth scroll (Today, stepping) owns the title: the
  // press already chose the destination, so the months scrolled PAST
  // must not each claim the header and flicker against it
  const progTargetRef = useRef<number | null>(null);
  const progTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekStart = useSettings().weekStart;
  const geom = useMemo(
    () =>
      // the hand-over row is barely taller than its text: the label's
      // line box plus 4px of air above and 4px down to the rule
      metrics
        ? buildMonthGeom(metrics.w, metrics.labelH + 8, currentMonth, span, weekStart)
        : null,
    // geometry depends on width, label height, the span, and the week
    // start (a Monday start can add a row to some months); currentMonth is
    // stable, and a viewport-height blip must not rebuild it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics?.w, metrics?.labelH, span, weekStart],
  );
  const geomRef = useRef<MonthGeom | null>(null);
  useLayoutEffect(() => {
    geomRef.current = geom;
  }, [geom]);

  const indexOfMonth = useCallback(
    (m: Date) => {
      const diff = monthsBetween(m, currentMonth);
      return Math.min(span - 1, Math.max(0, span - 1 - diff));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [span],
  );

  // measure once + on resize; ResizeObserver callbacks are async-safe
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const labelH = probeRef.current?.offsetHeight ?? 14;
      if (w === 0) return;
      setMetrics((prev) =>
        prev && prev.w === w && prev.h === h && prev.labelH === labelH
          ? prev
          : { w, h, labelH },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // position the camera only once the spacer is in the DOM — a scrollTop
  // written any earlier clamps to 0 and the feed opens ten years back.
  // Re-runs (geometry rebuilt by a real resize) re-anchor the month the
  // reader was on so the new offsets don't drift them through time.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !geom) return;
    if (!didInit.current) {
      didInit.current = true;
      const idx = indexOfMonth(startOfMonth(dateFromDayKey(selected)));
      // seed the anchor too: fonts/scrollbars can rebuild geometry before
      // the first scroll event lands, and that rebuild must re-anchor
      visibleIdxRef.current = idx;
      anchorMonthRef.current = geom.months[idx];
      if (idx === geom.offsets.length - 1 && spacerRef.current)
        settleBottom(el, spacerRef.current);
      else el.scrollTop = geom.offsets[idx];
    } else if (anchorMonthRef.current) {
      // re-anchor by MONTH, not index: a span change (history loading
      // in) prepends months and shifts every index
      const idx = indexOfMonth(anchorMonthRef.current);
      visibleIdxRef.current = idx;
      if (idx === geom.offsets.length - 1 && spacerRef.current)
        settleBottom(el, spacerRef.current);
      else el.scrollTop = geom.offsets[idx];
    }
    // `selected` only seeds the very first position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, indexOfMonth]);

  const goTo = useCallback(
    (m: Date, smooth: boolean) => {
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return;
      const idx = indexOfMonth(startOfMonth(m));
      const top = g.offsets[idx];
      setScrollY(top); // window renders the destination immediately
      anchorMonthRef.current = g.months[idx];
      if (smooth) {
        // hold the title on the destination until the scroll lands
        visibleIdxRef.current = idx;
        progTargetRef.current = top;
        if (progTimerRef.current) clearTimeout(progTimerRef.current);
        progTimerRef.current = setTimeout(() => {
          progTargetRef.current = null;
        }, 800);
        el.scrollTo({ top, behavior: "smooth" });
      } else {
        visibleIdxRef.current = -1;
        if (idx === g.offsets.length - 1 && spacerRef.current)
          settleBottom(el, spacerRef.current);
        else el.scrollTo({ top, behavior: "instant" });
      }
    },
    [indexOfMonth, setScrollY],
  );
  const originFor = useCallback(
    (day: string) => {
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return null;
      const d = dateFromDayKey(day);
      const mi = indexOfMonth(startOfMonth(d));
      const m = g.months[mi];
      if (!m || !isSameMonth(d, m)) return null;
      const idx = getDay(m) + d.getDate() - 1;
      return {
        x: (idx % 7) * g.cell + g.cell / 2,
        y:
          g.offsets[mi] +
          g.labelRowH +
          Math.floor(idx / 7) * g.cell +
          g.cell / 2 -
          el.scrollTop,
        w: g.cell,
      };
    },
    [indexOfMonth],
  );
  useLayoutEffect(() => {
    handleRef.current = { goTo, originFor };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, goTo, originFor]);

  const onScroll = () => {
    if (!activeRef.current) return; // inactive altitude — same as the old detached listener
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return;
      const top = el.scrollTop;
      // re-render the window only when the reader has moved meaningfully
      setScrollY((prev) =>
        prev === null || Math.abs(prev - top) > (metrics?.h ?? 400) / 3
          ? top
          : prev,
      );
      if (progTargetRef.current !== null) {
        // a Today/step scroll is animating to its target — let it run
        // the window, but don't let the passed months touch the title
        if (Math.abs(top - progTargetRef.current) < 4) {
          progTargetRef.current = null;
          if (progTimerRef.current) clearTimeout(progTimerRef.current);
        }
        return;
      }
      const vi = indexAt(g.switchY, top);
      if (vi !== visibleIdxRef.current) {
        visibleIdxRef.current = vi;
        anchorMonthRef.current = g.months[vi];
        onVisible(g.months[vi]);
      }
    });
  };

  const viewH = metrics?.h ?? 400;
  // until the first scroll lands, the window hangs on the selected month
  const anchorY =
    scrollY ??
    (geom
      ? geom.offsets[indexOfMonth(startOfMonth(dateFromDayKey(selected)))]
      : 0);
  const from = geom ? indexAt(geom.offsets, anchorY - viewH) : 0;
  const to = geom ? indexAt(geom.offsets, anchorY + 2 * viewH) : 0;

  // the ring lives on the canvas itself, outside every month block: it
  // can spring across month boundaries and never remounts with the
  // render window
  const ring = (() => {
    if (!geom) return null;
    const d = dateFromDayKey(selected);
    const mi = indexOfMonth(startOfMonth(d));
    const m = geom.months[mi];
    if (!m || !isSameMonth(d, m)) return null;
    const idx = getDay(m) + d.getDate() - 1;
    return {
      x: (idx % 7) * geom.cell + 3,
      // the top rule lives inside the cell's first pixel while the
      // bottom rule belongs to the row below — centred between the
      // visible lines sits 0.5px lower than centred in the box
      y:
        geom.offsets[mi] +
        geom.labelRowH +
        Math.floor(idx / 7) * geom.cell +
        3.5,
    };
  })();

  // Drive the ring with motion values so its spring can be firmed per-move: a
  // spring overshoots a fixed fraction of the distance, so a long jump lurches
  // whole cells past the target. Animate imperatively from where the ring
  // actually is (mid-flight included) to where it's headed, choosing a damping
  // that caps the overshoot at one cell. First appearance jumps into place (no
  // slide from a stale spot), matching the old initial={false}.
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const ringSeen = useRef(false);
  useLayoutEffect(() => {
    if (!ring || !geom) {
      ringSeen.current = false;
      return;
    }
    if (!ringSeen.current) {
      rx.set(ring.x);
      ry.set(ring.y);
      ringSeen.current = true;
      return;
    }
    const dist = Math.hypot(ring.x - rx.get(), ring.y - ry.get());
    const t = ringSpringFor(dist, geom.cell);
    const cx = animate(rx, ring.x, t);
    const cy = animate(ry, ring.y, t);
    return () => {
      cx.stop();
      cy.stop();
    };
    // depend on the ring's coordinates + cell only; the ring/geom objects change
    // identity every render and would restart the spring on each one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring?.x, ring?.y, geom?.cell, rx, ry]);

  // the foot marks real content only, never the min-h-full padding tail below it
  const edges = useScrollEdges(
    scrollerRef,
    [span, metrics?.h],
    false,
    geom ? geom.offsets[geom.offsets.length - 1] : undefined,
  );

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      style={{ scrollbarWidth: "none" }}
      tabIndex={-1}
    >
      <p
        ref={probeRef}
        aria-hidden="true"
        className="voice-label invisible absolute text-[0.82rem]"
      >
        June 2026
      </p>
      {/* the measurement gap: geometry needs a layout pass before the grid can
          be placed — hold the ruled skeleton so the layer never flashes blank */}
      {!geom && <MonthSkeleton />}
      {geom && (
        // the floor is laid out, not measured: blocks live in a px-high
        // container up to the last offset, and a min-h-full tail keeps
        // one viewport of room below it IN THE SAME LAYOUT PASS as any
        // stage resize — a mid-zoom rail collapse can no longer clamp
        // the scroller and drift the flights' landing targets
        <div
          ref={spacerRef}
          className="relative"
          style={{ height: geom.offsets[geom.offsets.length - 1] }}
        >
          {ring && (
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 z-10 rounded-[5px] border-[1.5px] border-wax bg-wax/5 shadow-[inset_0_1px_2px_rgb(var(--shadow-hue)/0.06)]"
              style={{ x: rx, y: ry, width: geom.cell - 6, height: geom.cell - 6 }}
            />
          )}
          {geom.months.slice(from, to + 1).map((m, k) => (
            <div
              key={ym(m)}
              data-month={ym(m)}
              className="absolute inset-x-0"
              style={{ top: geom.offsets[from + k] }}
            >
              <MonthBlock
                month={m}
                cell={geom.cell}
                labelRowH={geom.labelRowH}
                today={today}
                counts={counts}
                // scoped to its own month, so the book's scroll spy
                // (selection churning day by day) re-renders at most
                // the two blocks that actually change
                selected={
                  isSameMonth(dateFromDayKey(selected), m) ? selected : ""
                }
                onPick={onPick}
                onPickHint={onPickHint}
              />
            </div>
          ))}
        </div>
      )}
      {geom && (
        <div
          aria-hidden="true"
          className="min-h-full"
          style={{
            height: geom.total - geom.offsets[geom.offsets.length - 1],
          }}
        />
      )}
      <ScrollTerminus show={edges.bottom} />
    </div>
  );
}
export const MonthFeed = memo(
  MonthFeedBase,
  (p, n) => p.frozen === true && n.frozen === true,
);

const MonthBlock = memo(function MonthBlock({
  month,
  cell,
  labelRowH,
  today,
  counts,
  selected,
  onPick,
  onPickHint,
}: {
  month: Date;
  cell: number;
  labelRowH: number;
  today: Date;
  counts: Map<string, number> | undefined;
  /** the selected day when it lives in this month, else "" */
  selected: string;
  onPick: (key: string) => void;
  onPickHint?: (key: string) => void;
}) {
  const weekStart = useSettings().weekStart;
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const leadingBlanks = leadOffset(month, weekStart);
  const trailingBlanks = (7 - ((leadingBlanks + days.length) % 7)) % 7;
  const isCurrent = isSameMonth(month, today);

  return (
    <div>
      {/* the hand-over row: only the month's name, standing over its
          first day — the rule beneath it is that day's own top edge */}
      <div className="relative" style={{ height: labelRowH }}>
        <span
          data-flymonth={ym(month)}
          // bottom-[3.25px], not bottom-1: the small-caps have no
          // descenders, so they ride high in the line box; the nudge
          // optically centres the lettering between the rail and the
          // rule rather than centring its (taller) line box
          className={cn(
            "voice-label absolute bottom-[3.25px] text-center text-[0.82rem]",
            isCurrent ? "text-wax" : "text-ink-soft",
          )}
          style={{ left: leadingBlanks * cell, width: cell }}
        >
          {format(month, "MMM")}
        </span>
      </div>
      <div
        role="grid"
        aria-label={format(month, "MMMM yyyy")}
        className="grid grid-cols-7"
      >
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <span key={`b${i}`} className="aspect-square" aria-hidden="true" />
        ))}
        {days.map((date) => {
          const key = dayKey(date);
          const count = counts?.get(key) ?? 0;
          const isToday = isSameDay(date, today);
          const isFuture = isAfter(date, today);
          return (
            <motion.button
              key={key}
              type="button"
              disabled={isFuture}
              onClick={() => onPick(key)}
              onPointerDown={isFuture ? undefined : () => onPickHint?.(key)}
              whileTap={isFuture ? undefined : "pressed"}
              aria-label={`${format(date, "MMMM d")}${count ? `, ${count} kept` : ""}`}
              aria-pressed={key === selected}
              // the date grid follows the WAI-ARIA pattern: ONE tab stop (the
              // selected day), then arrows roam (handled on the month layer).
              // data-day-key lets that handler find any day across months.
              data-day-key={key}
              tabIndex={key === selected ? 0 : -1}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center gap-1 border-t border-rule-faint",
                !isFuture && "transition-colors duration-150 hover:bg-paper-raised",
                isFuture && "text-ink-faint/40",
              )}
            >
              {/* only the content presses — scaling the whole cell would shrink
                  its top border and sever it from the week's continuous rule */}
              <motion.span
                variants={{ pressed: { scale: 0.9 } }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="flex flex-col items-center gap-1"
              >
                <span
                  data-flydate={key}
                  className={cn(
                    "relative font-mono text-[0.78rem] tabular-nums",
                    isToday && "font-semibold text-wax",
                  )}
                >
                  {format(date, "d")}
                </span>
                {/* the dot strip is always reserved so numbers sit at the
                    same height whether or not a day has entries yet */}
                <span className="relative flex h-[3.5px] gap-[3px]" aria-hidden="true">
                  {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
                    <span
                      key={i}
                      className="size-[3.5px] rounded-full bg-ink-soft shadow-[0_0.5px_0.5px_rgb(var(--shadow-hue)/0.4)]"
                    />
                  ))}
                </span>
              </motion.span>
            </motion.button>
          );
        })}
        {/* blanks carry no rule, before or after the days: a month's
            lines start at its first day and stop at its last, and the
            voids interlock with the neighbouring label rows */}
        {Array.from({ length: trailingBlanks }).map((_, i) => (
          <span key={`t${i}`} className="aspect-square" aria-hidden="true" />
        ))}
      </div>
    </div>
  );
});
