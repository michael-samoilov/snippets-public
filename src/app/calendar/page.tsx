"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isAfter,
  isSameDay,
  isSameMonth,
  startOfMonth,
} from "date-fns";
import { motion, animate, useReducedMotion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { toast } from "sonner";
import { MotionEntryList } from "@/components/snippet/motion-entry-list";
import { useDayCounts, useDaySnippets, useStats } from "@/hooks/use-snippets";
import { addSnippet } from "@/lib/db";
import { enrichSnippet } from "@/lib/enrich";
import { dayKey, dateFromDayKey, friendlyDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const ringSpring = { type: "spring", stiffness: 380, damping: 30 } as const;
const ym = (d: Date) => format(d, "yyyy-MM");

/* ── feed geometry: ten years of time, computed, never reflowed ────
   The feeds are virtualized over arithmetic offsets inside one
   fixed-height spacer. Nothing is ever inserted above the reader and
   scrollTop is never written during a gesture — the recording showed
   iOS killing fling momentum the instant the old windowed feed
   compensated scroll positions mid-flight. */

const RANGE_MONTHS = 120;
const RANGE_YEARS = 10;
const YEAR_GAP = 24; // between year blocks
const MINI_GAP = 8; // gap-2 between minis
const MINI_DOT = 3;

function monthRows(m: Date): number {
  return Math.ceil((getDay(m) + endOfMonth(m).getDate()) / 7);
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

interface MonthGeom {
  months: Date[];
  /** top of each month's label row */
  offsets: number[];
  /** scroll position at which each month takes the title — the moment
      the previous month's final row-line slips under the weekday rail */
  switchY: number[];
  total: number;
  cell: number;
  labelRowH: number;
}

function buildMonthGeom(
  width: number,
  labelRowH: number,
  currentMonth: Date,
): MonthGeom {
  const cell = width / 7;
  const months: Date[] = [];
  const offsets: number[] = [];
  const switchY: number[] = [];
  let y = 0;
  for (let i = RANGE_MONTHS - 1; i >= 0; i--) {
    const m = startOfMonth(addMonths(currentMonth, -i));
    months.push(m);
    offsets.push(y);
    switchY.push(y === 0 ? 0 : y - cell);
    y += labelRowH + monthRows(m) * cell;
  }
  return { months, offsets, switchY, total: y + 24, cell, labelRowH };
}

/** last index whose offset is at or before y */
function indexAt(offsets: number[], y: number): number {
  let lo = 0,
    hi = offsets.length - 1,
    ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= y) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

export default function CalendarPage() {
  return (
    <Suspense>
      <Calendar />
    </Suspense>
  );
}

interface MonthFeedHandle {
  goTo: (m: Date, smooth: boolean) => void;
}
interface YearFeedHandle {
  goTo: (y: number, smooth: boolean) => void;
  /** center + width of a month's mini, relative to the layer viewport */
  originFor: (ymKey: string) => { x: number; y: number; w: number } | null;
}

/**
 * The calendar is a camera over time. Month view and year view are two
 * altitudes of the same world: switching views zooms the whole field
 * about the active month's own slot while the layers crossfade — and
 * within a view, time is one continuous virtualized feed with native
 * momentum that nothing is allowed to interrupt.
 */
function Calendar() {
  const params = useSearchParams();
  const pathname = usePathname();
  const initialDay = (() => {
    const d = params.get("d");
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : dayKey();
  })();

  const [view, setView] = useState<"month" | "year">("month");
  /** during a zoom both layers render; `out` is the departing view */
  const [zoom, setZoom] = useState<null | { out: "month" | "year"; ym: string }>(null);
  const [selected, setSelected] = useState(initialDay);
  /** what the title shows — follows the feeds' scroll */
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(dateFromDayKey(initialDay)),
  );
  const [visibleYear, setVisibleYear] = useState(() => visibleMonth.getFullYear());

  const counts = useDayCounts();
  const stats = useStats();
  const daySnippets = useDaySnippets(selected);
  const reduceMotion = useReducedMotion();

  const today = new Date();
  const currentMonth = startOfMonth(today);
  const atToday =
    view === "month" &&
    isSameMonth(visibleMonth, today) &&
    selected === dayKey();

  const stageRef = useRef<HTMLDivElement>(null);
  const monthLayerRef = useRef<HTMLDivElement>(null);
  const yearLayerRef = useRef<HTMLDivElement>(null);
  const monthFeedRef = useRef<MonthFeedHandle | null>(null);
  const yearFeedRef = useRef<YearFeedHandle | null>(null);
  const zooming = useRef(false);

  const pick = useCallback(
    (key: string) => {
      setSelected(key);
      navigator.vibrate?.(6);
      window.history.replaceState(
        null,
        "",
        key === dayKey() ? pathname : `${pathname}?d=${key}`,
      );
    },
    [pathname],
  );

  /* ── the zoom: one camera move between altitudes ──────────────── */

  const runZoom = useCallback((out: "month" | "year", anchor: string) => {
    if (zooming.current) return;
    zooming.current = true;
    setZoom({ out, ym: anchor });
    setView(out === "month" ? "year" : "month");
  }, []);

  useLayoutEffect(() => {
    if (!zoom) return;
    const stage = stageRef.current;
    const monthLayer = monthLayerRef.current;
    const yearLayer = yearLayerRef.current;
    if (!stage || !monthLayer || !yearLayer) {
      setZoom(null);
      zooming.current = false;
      return;
    }

    const outgoing = zoom.out === "month" ? monthLayer : yearLayer;
    const incoming = zoom.out === "month" ? yearLayer : monthLayer;
    // the previous finish left the departed layer inline-hidden
    monthLayer.style.visibility = "";
    yearLayer.style.visibility = "";

    const finish = () => {
      // keep the departed layer hidden across the gap between these
      // inline clears and the commit that restores its `invisible`
      // class — a paint in that gap flashed the old view at full scale
      outgoing.style.visibility = "hidden";
      monthLayer.style.transform = "";
      yearLayer.style.transform = "";
      monthLayer.style.opacity = "";
      yearLayer.style.opacity = "";
      setZoom(null);
      zooming.current = false;
    };

    if (reduceMotion) {
      void animate(outgoing, { opacity: [1, 0] }, { duration: 0.12 }).then(finish);
      return;
    }

    // hold the arriving layer dark until the animation's first tick owns it
    incoming.style.opacity = "0";

    // where the active month's mini sits — pure geometry, no DOM query
    const o = yearFeedRef.current?.originFor(zoom.ym);
    const stageRect = stage.getBoundingClientRect();
    const factor = o ? stageRect.width / o.w : 3.2;
    const origin = o
      ? `${(o.x / stageRect.width) * 100}% ${(o.y / stageRect.height) * 100}%`
      : "50% 30%";
    monthLayer.style.transformOrigin = origin;
    yearLayer.style.transformOrigin = origin;

    const spring = { type: "spring", stiffness: 320, damping: 34 } as const;
    const moves: Promise<unknown>[] = [];
    if (zoom.out === "month") {
      // camera pulls back: the month shrinks toward its slot,
      // the (blown-up) year settles to rest
      moves.push(
        animate(
          monthLayer,
          { scale: [1, 1 / factor], opacity: [1, 0] },
          { scale: spring, opacity: { duration: 0.18, ease: "easeOut" } },
        ).finished,
        animate(
          yearLayer,
          { scale: [factor, 1], opacity: [0, 1] },
          { scale: spring, opacity: { duration: 0.16, ease: "easeOut" } },
        ).finished,
      );
    } else {
      // camera dives in: the year blows up past its slot,
      // the month resolves out of it
      moves.push(
        animate(
          yearLayer,
          { scale: [1, factor], opacity: [1, 0] },
          { scale: spring, opacity: { duration: 0.18, ease: "easeOut" } },
        ).finished,
        animate(
          monthLayer,
          { scale: [1 / factor, 1], opacity: [0, 1] },
          { scale: spring, opacity: { duration: 0.16, ease: "easeOut" } },
        ).finished,
      );
    }
    void Promise.all(moves).then(finish);
  }, [zoom, reduceMotion]);

  const openYear = () => {
    const y = visibleMonth.getFullYear();
    setVisibleYear(y);
    yearFeedRef.current?.goTo(y, false); // stand on the year before measuring
    runZoom("month", ym(visibleMonth));
  };

  const pickMonth = (m: Date) => {
    setVisibleMonth(m);
    monthFeedRef.current?.goTo(m, false); // land exactly, behind the zoom
    runZoom("year", ym(m));
  };

  const goToday = () => {
    setSelected(dayKey());
    window.history.replaceState(null, "", pathname);
    if (view === "year" && !zoom) {
      pickMonth(currentMonth);
    } else {
      setVisibleMonth(currentMonth);
      monthFeedRef.current?.goTo(currentMonth, true);
    }
  };

  const stepFeed = (delta: number) => {
    if (view === "month") {
      const next = startOfMonth(addMonths(visibleMonth, delta));
      if (isAfter(next, currentMonth)) return;
      setVisibleMonth(next);
      monthFeedRef.current?.goTo(next, true);
    } else {
      const next = visibleYear + delta;
      if (next > today.getFullYear() || next <= today.getFullYear() - RANGE_YEARS)
        return;
      setVisibleYear(next);
      yearFeedRef.current?.goTo(next, true);
    }
  };

  const showMonthLayer = view === "month" || zoom?.out === "month";
  const showYearLayer = view === "year" || zoom?.out === "year";

  return (
    <div className="page-settle">
      <header className="mb-6">
        <h1 className="voice-display ink-bleed text-[2.5rem] leading-[1.02] sm:text-[2.9rem]">
          Calendar
        </h1>
        {stats && stats.daysWithEntries > 0 && (
          <p className="mt-2.5 font-serif text-[0.92rem] italic text-ink-soft">
            collected on <NumberFlow value={stats.daysWithEntries} />{" "}
            {stats.daysWithEntries === 1 ? "day" : "days"}
            {stats.longestStreak > 1 && (
              <>
                {" "}
                · longest run <NumberFlow value={stats.longestStreak} />
              </>
            )}
          </p>
        )}
      </header>

      {/* title row: the month opens the year; the title follows the scroll */}
      <div className="flex items-baseline justify-between">
        {view === "month" ? (
          <button
            type="button"
            onClick={openYear}
            aria-label={`Show ${visibleMonth.getFullYear()} at a glance`}
            className="voice-display pressable rounded-[5px] text-[1.3rem] hover:text-wax"
          >
            <span aria-hidden="true" className="mr-1 text-[1rem] text-ink-faint">
              ‹
            </span>
            {format(visibleMonth, "MMMM yyyy")}
          </button>
        ) : (
          <h2 className="voice-display text-[1.3rem]">{visibleYear}</h2>
        )}
        <div className="flex items-baseline gap-1">
          {/* always in the row — appearing must never reflow the page */}
          <button
            type="button"
            onClick={goToday}
            disabled={atToday}
            aria-hidden={atToday}
            className={cn(
              "voice-label pressable mr-2 rounded-[5px] px-2 py-1 leading-none text-wax hover:bg-accent",
              atToday && "opacity-0",
            )}
          >
            Today
          </button>
          <button
            type="button"
            aria-label={view === "month" ? "Previous month" : "Previous year"}
            onClick={() => stepFeed(-1)}
            className="pressable rounded-[5px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft hover:bg-accent hover:text-ink"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={view === "month" ? "Next month" : "Next year"}
            onClick={() => stepFeed(1)}
            disabled={
              view === "month"
                ? isSameMonth(visibleMonth, currentMonth)
                : visibleYear >= today.getFullYear()
            }
            className="pressable rounded-[5px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft hover:bg-accent hover:text-ink disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      {/* weekday rail stays pinned above the feed */}
      <div
        role="row"
        className={cn(
          "mt-3 grid grid-cols-7 border-b border-rule-faint transition-opacity duration-150",
          view === "month" ? "opacity-100" : "opacity-0",
        )}
        aria-hidden={view !== "month"}
      >
        {WEEKDAYS.map((d, i) => (
          <span
            key={`${d}${i}`}
            role="columnheader"
            className="voice-label pb-2 text-center text-[0.78rem] text-ink-faint"
          >
            {d}
          </span>
        ))}
      </div>

      {/* the stage: both altitudes live here; the camera moves between */}
      <div
        ref={stageRef}
        className="relative h-[23rem] overflow-hidden sm:h-[26rem]"
        onKeyDown={(e) => {
          if (e.key === "PageUp") {
            e.preventDefault();
            stepFeed(-1);
          } else if (e.key === "PageDown") {
            e.preventDefault();
            stepFeed(1);
          }
        }}
      >
        <div
          ref={monthLayerRef}
          className={cn(
            "absolute inset-0",
            !showMonthLayer && "invisible",
            (zoom || !showMonthLayer) && "pointer-events-none",
          )}
        >
          <MonthFeed
            handleRef={monthFeedRef}
            active={view === "month" && !zoom}
            today={today}
            counts={counts}
            selected={selected}
            onPick={pick}
            onVisible={(m) => {
              setVisibleMonth(m);
              setVisibleYear(m.getFullYear());
            }}
          />
        </div>
        <div
          ref={yearLayerRef}
          className={cn(
            "absolute inset-0",
            !showYearLayer && "invisible",
            (zoom || !showYearLayer) && "pointer-events-none",
          )}
        >
          <YearFeed
            handleRef={yearFeedRef}
            active={view === "year" && !zoom}
            today={today}
            counts={counts}
            onPickMonth={pickMonth}
            onVisible={setVisibleYear}
          />
        </div>
      </div>

      {view === "month" && (
        <section className="mt-8" aria-label={friendlyDay(selected)}>
          <header className="flex items-baseline justify-between border-b border-rule pb-1.5">
            <h2 className="voice-display text-[1.12rem]">
              {friendlyDay(selected)}
            </h2>
            {daySnippets && daySnippets.length > 0 && (
              <span className="voice-data">{daySnippets.length}</span>
            )}
          </header>
          {/* always mounted: flapping the list in and out of the tree
              raced Motion's presence bookkeeping into duplicate DOM */}
          <MotionEntryList snippets={daySnippets ?? []} />
          {daySnippets && daySnippets.length === 0 && (
            <p className="voice-prose mt-4 italic text-ink-soft">
              Nothing kept this day.
            </p>
          )}
          {selected !== dayKey() && (
            <BackfillCapture key={selected} day={selected} />
          )}
        </section>
      )}
    </div>
  );
}

/* ── the month feed ─────────────────────────────────────────────── */

function MonthFeed({
  handleRef,
  active,
  today,
  counts,
  selected,
  onPick,
  onVisible,
}: {
  handleRef: React.MutableRefObject<MonthFeedHandle | null>;
  active: boolean;
  today: Date;
  counts: Map<string, number> | undefined;
  selected: string;
  onPick: (key: string) => void;
  onVisible: (m: Date) => void;
}) {
  const currentMonth = startOfMonth(today);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const [metrics, setMetrics] = useState<{ w: number; h: number; labelH: number } | null>(null);
  const [scrollY, setScrollY] = useState<number | null>(null);
  const visibleIdxRef = useRef(-1);
  const rafRef = useRef(0);
  const didInit = useRef(false);

  const geom = useMemo(
    () =>
      metrics
        ? buildMonthGeom(metrics.w, metrics.labelH + 8, currentMonth)
        : null,
    // geometry depends on width + label height only (currentMonth is
    // stable) — a viewport-height blip must not rebuild it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics?.w, metrics?.labelH],
  );
  const geomRef = useRef<MonthGeom | null>(null);
  useLayoutEffect(() => {
    geomRef.current = geom;
  }, [geom]);

  const indexOfMonth = useCallback(
    (m: Date) => {
      const diff = monthsBetween(m, currentMonth);
      return Math.min(RANGE_MONTHS - 1, Math.max(0, RANGE_MONTHS - 1 - diff));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // measure once + on resize; ResizeObserver callbacks are async-safe
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const labelH = (probeRef.current?.offsetHeight ?? 14) + 6; // + mb-1.5
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
      el.scrollTop = geom.offsets[idx];
    } else if (visibleIdxRef.current >= 0) {
      el.scrollTop = geom.offsets[visibleIdxRef.current];
    }
    // `selected` only seeds the very first position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, indexOfMonth]);

  const goTo = useCallback(
    (m: Date, smooth: boolean) => {
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return;
      const top = g.offsets[indexOfMonth(startOfMonth(m))];
      setScrollY(top); // window renders the destination immediately
      visibleIdxRef.current = -1;
      el.scrollTo({ top, behavior: smooth ? "smooth" : "instant" });
    },
    [indexOfMonth, setScrollY],
  );
  useLayoutEffect(() => {
    handleRef.current = { goTo };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, goTo]);

  const onScroll = () => {
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
      const vi = indexAt(g.switchY, top);
      if (vi !== visibleIdxRef.current) {
        visibleIdxRef.current = vi;
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
      y:
        geom.offsets[mi] +
        geom.labelRowH +
        Math.floor(idx / 7) * geom.cell +
        3,
    };
  })();

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
        June 2026
      </p>
      {geom && (
        // floored one viewport past the last offset so the current month
        // can stand flush at the top like any other — otherwise the
        // browser clamps the landing and the feed stops short of it
        <div
          className="relative"
          style={{
            height: Math.max(
              geom.total,
              geom.offsets[geom.offsets.length - 1] + viewH,
            ),
          }}
        >
          {ring && (
            <motion.span
              aria-hidden="true"
              initial={false}
              animate={{ x: ring.x, y: ring.y }}
              transition={ringSpring}
              className="pointer-events-none absolute left-0 top-0 z-10 rounded-[5px] border-[1.5px] border-wax bg-wax/5 shadow-[inset_0_1px_2px_rgb(var(--shadow-hue)/0.06)]"
              style={{ width: geom.cell - 6, height: geom.cell - 6 }}
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
                selected={selected}
                onPick={onPick}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthBlock({
  month,
  cell,
  labelRowH,
  today,
  counts,
  selected,
  onPick,
}: {
  month: Date;
  cell: number;
  labelRowH: number;
  today: Date;
  counts: Map<string, number> | undefined;
  selected: string;
  onPick: (key: string) => void;
}) {
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const leadingBlanks = getDay(month);
  const trailingBlanks = (7 - ((leadingBlanks + days.length) % 7)) % 7;
  const isCurrent = isSameMonth(month, today);

  return (
    <div>
      {/* the hand-over row: only the month's name, standing over its
          first day — the rule beneath it is that day's own top edge */}
      <div className="relative" style={{ height: labelRowH }}>
        <span
          className={cn(
            "voice-label absolute bottom-1 text-center text-[0.82rem]",
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
              whileTap={isFuture ? undefined : { scale: 0.9 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              aria-label={`${format(date, "MMMM d")}${count ? `, ${count} kept` : ""}`}
              aria-pressed={key === selected}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center gap-1 border-t border-rule-faint",
                !isFuture && "transition-colors duration-150 hover:bg-paper-raised",
                isFuture && "text-ink-faint/40",
              )}
            >
              <span
                className={cn(
                  "relative font-mono text-[0.78rem] tabular-nums",
                  isToday && "font-semibold text-wax",
                )}
              >
                {format(date, "d")}
              </span>
              {count > 0 && (
                <span className="relative flex gap-[3px]" aria-hidden="true">
                  {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
                    <span
                      key={i}
                      className="size-[3.5px] rounded-full bg-ink-soft shadow-[0_0.5px_0.5px_rgb(var(--shadow-hue)/0.4)]"
                    />
                  ))}
                </span>
              )}
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
}

/* ── the year feed: higher altitude, same physics ───────────────── */

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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
  currentYear: number,
): YearGeom {
  const cols = typeof window !== "undefined" && window.innerWidth >= 640 ? 4 : 3;
  const rows = 12 / cols;
  const miniW = (width - (cols - 1) * MINI_GAP) / cols;
  // mini: padding 10 ×2 + label + gap-1.5 + fixed six dot-rows + border 2
  const dots = 6 * MINI_DOT + 5 * 3;
  const miniH = 2 + 20 + miniLabelH + 6 + dots;
  const blockH = labelH + rows * miniH + (rows - 1) * MINI_GAP;
  const years: number[] = [];
  const offsets: number[] = [];
  let y = 0;
  for (let i = RANGE_YEARS - 1; i >= 0; i--) {
    years.push(currentYear - i);
    offsets.push(y);
    y += blockH + YEAR_GAP;
  }
  return { years, offsets, total: y - YEAR_GAP + 32, cols, miniW, miniH, labelH, blockH };
}

function YearFeed({
  handleRef,
  active,
  today,
  counts,
  onPickMonth,
  onVisible,
}: {
  handleRef: React.MutableRefObject<YearFeedHandle | null>;
  active: boolean;
  today: Date;
  counts: Map<string, number> | undefined;
  onPickMonth: (m: Date) => void;
  onVisible: (y: number) => void;
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
  const rafRef = useRef(0);
  const didInit = useRef(false);

  const geom = useMemo(
    () =>
      metrics
        ? buildYearGeom(metrics.w, metrics.labelH, metrics.miniLabelH, currentYear)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics?.w, metrics?.labelH, metrics?.miniLabelH],
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
  // is real; re-anchor the visible year when geometry truly changes
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !geom) return;
    if (!didInit.current) {
      didInit.current = true;
      const idx = geom.offsets.length - 1;
      visibleRef.current = idx;
      el.scrollTop = geom.offsets[idx];
    } else if (visibleRef.current >= 0) {
      el.scrollTop = geom.offsets[visibleRef.current];
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
        onVisible(g.years[vi]);
      }
    });
  };

  const viewH = metrics?.h ?? 400;
  // before any scroll has landed, the window hangs on the current year
  const anchorY = scrollY ?? (geom ? geom.offsets[geom.offsets.length - 1] : 0);
  const from = geom ? indexAt(geom.offsets, anchorY - viewH) : 0;
  const to = geom ? indexAt(geom.offsets, anchorY + 2 * viewH) : 0;

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
        <div
          className="relative"
          style={{
            height: Math.max(
              geom.total,
              geom.offsets[geom.offsets.length - 1] + viewH,
            ),
          }}
        >
          {geom.years.slice(from, to + 1).map((y, k) => (
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
          ))}
        </div>
      )}
    </div>
  );
}

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
  const days = eachDayOfInterval({ start, end: endOfMonth(start) });
  const leading = getDay(start);
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
                    ? "bg-transparent"
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

/* ── adding to a day that has already passed ────────────────────── */

function BackfillCapture({ day }: { day: string }) {
  const [text, setText] = useState("");
  const [stamped, setStamped] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // remounted per day via key, so state starts fresh; only clean the timer
  useEffect(() => {
    return () => {
      if (stampTimer.current) clearTimeout(stampTimer.current);
    };
  }, []);

  const keep = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    const el = areaRef.current;
    if (el) {
      el.value = "";
      autosizeArea(el);
    }
    navigator.vibrate?.(8);
    setStamped(true);
    if (stampTimer.current) clearTimeout(stampTimer.current);
    stampTimer.current = setTimeout(() => setStamped(false), 1600);
    const at = dateFromDayKey(day);
    at.setHours(12, 0, 0, 0); // noon: clear of DST edges
    try {
      const snippet = await addSnippet({
        text: trimmed,
        source: "typed",
        capturedAt: at.getTime(),
      });
      void enrichSnippet(snippet);
    } catch {
      toast("That didn’t take — try again.");
    }
  };

  return (
    <div className="mt-5 border-t border-rule-faint pt-4">
      <div className="flex items-end gap-3">
        <textarea
          ref={areaRef}
          value={text}
          rows={1}
          placeholder="Add something you remember from this day…"
          aria-label={`Add an entry to ${friendlyDay(day)}`}
          onChange={(e) => {
            setText(e.target.value);
            autosizeArea(e.target);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void keep();
            }
          }}
          className="voice-prose min-h-[2.2rem] flex-1 resize-none overflow-hidden border-b border-rule bg-transparent pb-1 text-[1rem] outline-none transition-colors duration-150 placeholder:italic placeholder:text-ink-faint focus:border-ink-soft"
        />
        <button
          type="button"
          onClick={() => void keep()}
          disabled={!text.trim()}
          className={cn(
            "rounded-[5px] bg-paper-raised px-3 py-1.5 font-serif text-[0.9rem] text-ink",
            "shadow-[inset_0_1px_0_var(--press-highlight),0_0_0_1px_rgb(var(--shadow-hue)/0.1),0_1px_2px_rgb(var(--shadow-hue)/0.1)]",
            "transition-[opacity,transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            "active:translate-y-px active:scale-[0.97] active:shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)]",
            text.trim() ? "opacity-100" : "opacity-0",
          )}
        >
          Keep
        </button>
      </div>
      {stamped && (
        <p
          role="status"
          className="stamp-in mt-2 font-serif text-[0.85rem] not-italic text-wax"
        >
          Kept to {friendlyDay(day).toLowerCase()}.
        </p>
      )}
    </div>
  );
}

function autosizeArea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
