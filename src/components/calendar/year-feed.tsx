"use client";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  isAfter,
  isSameDay,
} from "date-fns";
import { motion } from "motion/react";
import { dayKey } from "@/lib/dates";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { useScrollEdges, ScrollTerminus } from "@/components/ui/scroll-terminus";
import {
  indexAt,
  leadOffset,
  ym,
  YEAR_GAP,
  MINI_GAP,
  MINI_DOT,
} from "./shared";
import type { YearFeedHandle } from "./shared";

/* ── the year feed: higher altitude, same physics ───────────────── */

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// How a future day reads in a month mini. A hollow ring (rather than nothing)
// keeps the constellation whole, so a month holding only today doesn't show one
// lonely dot. Flip to "bg-transparent" to hide future days again.
const FUTURE_DOT = "border-[0.5px] border-rule-faint bg-transparent";

interface YearGeom {
  years: number[];
  offsets: number[];
  total: number;
  cols: number;
  miniW: number;
  miniH: number;
  labelH: number;
  blockH: number;
}

function buildYearGeom(
  width: number,
  labelH: number,
  miniLabelH: number,
  years: number[],
): YearGeom {
  const cols = typeof window !== "undefined" && window.innerWidth >= 640 ? 4 : 3;
  const rows = 12 / cols;
  const miniW = (width - (cols - 1) * MINI_GAP) / cols;
  // mini: padding 10 ×2 + label + gap-1.5 + fixed six dot-rows + border 2
  const dots = 6 * MINI_DOT + 5 * 3;
  const miniH = 2 + 20 + miniLabelH + 6 + dots;
  const blockH = labelH + rows * miniH + (rows - 1) * MINI_GAP;
  const offsets: number[] = [];
  let y = 0;
  for (let i = 0; i < years.length; i++) {
    offsets.push(y);
    y += blockH + YEAR_GAP;
  }
  return { years, offsets, total: y - YEAR_GAP + 32, cols, miniW, miniH, labelH, blockH };
}

function YearFeedBase({
  handleRef,
  active,
  today,
  years,
  counts,
  onPickMonth,
  onVisible,
}: {
  handleRef: React.MutableRefObject<YearFeedHandle | null>;
  active: boolean;
  today: Date;
  /** the lived years, ascending and ending at today's — gaps of five
      or more dormant years are already folded out of the list */
  years: number[];
  counts: Map<string, number> | undefined;
  onPickMonth: (m: Date) => void;
  onVisible: (y: number) => void;
  /** fully hidden (not this altitude, not in a zoom) — memo skips
      re-renders while frozen, so a book scroll never re-renders the
      invisible glance; it re-renders the moment it's shown again */
  frozen?: boolean;
}) {
  const currentYear = today.getFullYear();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const miniProbeRef = useRef<HTMLSpanElement>(null);
  const [metrics, setMetrics] = useState<{
    w: number;
    h: number;
    labelH: number;
    miniLabelH: number;
  } | null>(null);
  const [scrollY, setScrollY] = useState<number | null>(null);
  const visibleRef = useRef(-1);
  const anchorYearRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const didInit = useRef(false);

  const geom = useMemo(
    () =>
      metrics
        ? buildYearGeom(metrics.w, metrics.labelH, metrics.miniLabelH, years)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics?.w, metrics?.labelH, metrics?.miniLabelH, years],
  );
  const geomRef = useRef<YearGeom | null>(null);
  useLayoutEffect(() => {
    geomRef.current = geom;
  }, [geom]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const labelH = (probeRef.current?.offsetHeight ?? 14) + 6;
      const miniLabelH = miniProbeRef.current?.offsetHeight ?? 13;
      if (w === 0) return;
      setMetrics((prev) =>
        prev &&
        prev.w === w &&
        prev.h === h &&
        prev.labelH === labelH &&
        prev.miniLabelH === miniLabelH
          ? prev
          : { w, h, labelH, miniLabelH },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // same discipline as the month feed: position only after the spacer
  // is real. Re-anchor by YEAR, not index — the list breathes (a
  // transient year folding away, history loading in) and a breath
  // shifts every index
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !geom) return;
    if (!didInit.current) {
      didInit.current = true;
      const idx = geom.offsets.length - 1;
      visibleRef.current = idx;
      anchorYearRef.current = geom.years[idx];
      el.scrollTop = geom.offsets[idx];
    } else if (anchorYearRef.current != null) {
      const a = anchorYearRef.current;
      let idx = geom.years.indexOf(a);
      if (idx < 0) {
        // the year under the camera folded away — stand on the nearest
        idx = geom.years.reduce(
          (p, c, i) => (Math.abs(c - a) < Math.abs(geom.years[p] - a) ? i : p),
          0,
        );
        anchorYearRef.current = geom.years[idx];
      }
      visibleRef.current = idx;
      el.scrollTop = geom.offsets[idx];
    }
  }, [geom]);

  const goTo = useCallback((y: number, smooth: boolean) => {
    const el = scrollerRef.current;
    const g = geomRef.current;
    if (!el || !g) return;
    const idx = g.years.indexOf(y);
    if (idx < 0) return;
    setScrollY(g.offsets[idx]);
    visibleRef.current = -1;
    anchorYearRef.current = y;
    el.scrollTo({ top: g.offsets[idx], behavior: smooth ? "smooth" : "instant" });
  }, [setScrollY]);
  const originFor = useCallback((ymKey: string) => {
    const el = scrollerRef.current;
    const g = geomRef.current;
    if (!el || !g) return null;
    const [yStr, mStr] = ymKey.split("-");
    const yi = g.years.indexOf(Number(yStr));
    if (yi < 0) return null;
    const mi = Number(mStr) - 1;
    const r = Math.floor(mi / g.cols);
    const c = mi % g.cols;
    return {
      x: c * (g.miniW + MINI_GAP) + g.miniW / 2,
      y:
        g.offsets[yi] +
        g.labelH +
        r * (g.miniH + MINI_GAP) +
        g.miniH / 2 -
        el.scrollTop,
      w: g.miniW,
    };
  }, []);
  useLayoutEffect(() => {
    handleRef.current = { goTo, originFor };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, goTo, originFor]);

  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return;
      const top = el.scrollTop;
      setScrollY((prev) =>
        prev === null || Math.abs(prev - top) > (metrics?.h ?? 400) / 3
          ? top
          : prev,
      );
      const vi = indexAt(g.offsets, top + (metrics?.h ?? 400) * 0.35);
      if (vi !== visibleRef.current) {
        visibleRef.current = vi;
        anchorYearRef.current = g.years[vi];
        onVisible(g.years[vi]);
      }
    });
  };

  const viewH = metrics?.h ?? 400;
  // before any scroll has landed, the window hangs on the current year
  const anchorY = scrollY ?? (geom ? geom.offsets[geom.offsets.length - 1] : 0);
  const from = geom ? indexAt(geom.offsets, anchorY - viewH) : 0;
  const to = geom ? indexAt(geom.offsets, anchorY + 2 * viewH) : 0;

  // the window's dot-grids are thousands of spans — memoized as
  // elements so the page's scroll-spy re-renders bail out wholesale
  const blocks = useMemo(
    () =>
      geom
        ? geom.years.slice(from, to + 1).map((y, k) => (
            <div
              key={y}
              data-year={y}
              className="absolute inset-x-0"
              style={{ top: geom.offsets[from + k] }}
            >
              <p className="voice-label mb-1.5 text-[0.82rem] text-ink-soft">{y}</p>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${geom.cols}, minmax(0, 1fr))`,
                  gap: MINI_GAP,
                }}
              >
                {MONTH_LABELS.map((label, m) => {
                  const start = new Date(y, m, 1);
                  const isFutureMonth = isAfter(start, today);
                  const isCurrent = y === currentYear && m === today.getMonth();
                  return (
                    <motion.button
                      key={ym(start)}
                      data-ym={ym(start)}
                      type="button"
                      disabled={isFutureMonth}
                      onClick={() => onPickMonth(start)}
                      whileTap={isFutureMonth ? undefined : { scale: 0.96 }}
                      className={cn(
                        "pressable flex flex-col gap-1.5 rounded-[6px] border border-rule-faint bg-paper p-2.5 text-left",
                        !isFutureMonth &&
                          "shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] hover:bg-paper-raised",
                        isFutureMonth && "opacity-40",
                      )}
                      aria-label={format(start, "MMMM yyyy")}
                    >
                      <span
                        data-flymonth={ym(start)}
                        className={cn(
                          "voice-label text-[0.8rem]",
                          isCurrent ? "text-wax" : "text-ink-soft",
                        )}
                      >
                        {label}
                      </span>
                      <MiniMonth start={start} today={today} counts={counts} />
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))
        : null,
    // currentYear rides on `today`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geom, from, to, today, counts, onPickMonth],
  );

  // the foot marks real content only, never the min-h-full padding tail below it
  const edges = useScrollEdges(
    scrollerRef,
    [years, metrics?.h],
    false,
    geom ? geom.offsets[geom.offsets.length - 1] : undefined,
  );

  return (
    <div
      ref={scrollerRef}
      onScroll={active ? onScroll : undefined}
      className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      style={{ scrollbarWidth: "none" }}
      tabIndex={-1}
    >
      <p
        ref={probeRef}
        aria-hidden="true"
        className="voice-label invisible absolute text-[0.82rem]"
      >
        2026
      </p>
      <span
        ref={miniProbeRef}
        aria-hidden="true"
        className="voice-label invisible absolute text-[0.8rem]"
      >
        Jan
      </span>
      {geom && (
        // same layout-synchronous floor as the month feed
        <div
          className="relative"
          style={{ height: geom.offsets[geom.offsets.length - 1] }}
        >
          {blocks}
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

export const YearFeed = memo(
  YearFeedBase,
  (p, n) => p.frozen === true && n.frozen === true,
);

/** Twelve tiny constellations: a dot per day, ink where something was
 *  kept. Always six rows so every mini is the same height — the zoom's
 *  geometry depends on it. */
function MiniMonth({
  start,
  today,
  counts,
}: {
  start: Date;
  today: Date;
  counts: Map<string, number> | undefined;
}) {
  const weekStart = useSettings().weekStart;
  const days = eachDayOfInterval({ start, end: endOfMonth(start) });
  const leading = leadOffset(start, weekStart);
  const trailing = 42 - leading - days.length;
  return (
    <span className="grid grid-cols-7 gap-[3px]" aria-hidden="true">
      {Array.from({ length: leading }).map((_, i) => (
        <span key={`b${i}`} className="size-[3px]" />
      ))}
      {days.map((date) => {
        const key = dayKey(date);
        const kept = (counts?.get(key) ?? 0) > 0;
        const isToday = isSameDay(date, today);
        const future = isAfter(date, today);
        return (
          <span
            key={key}
            className={cn(
              "size-[3px] rounded-full",
              isToday
                ? "bg-wax"
                : kept
                  ? "bg-ink-soft"
                  : future
                    ? FUTURE_DOT
                    : "bg-rule-faint",
            )}
          />
        );
      })}
      {Array.from({ length: trailing }).map((_, i) => (
        <span key={`a${i}`} className="size-[3px]" />
      ))}
    </span>
  );
}
