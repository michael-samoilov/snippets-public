"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
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

export default function CalendarPage() {
  return (
    <Suspense>
      <Calendar />
    </Suspense>
  );
}

/**
 * The calendar is a camera over time. Month view and year view are two
 * altitudes of the same world: switching views zooms the whole field —
 * the year layer scales about the active month's own slot while the
 * layers crossfade — and within a view, time is one continuous feed you
 * scroll through with real momentum, the way a calendar should feel.
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
  /** the month the title shows — follows the feed's scroll */
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(dateFromDayKey(initialDay)),
  );
  const [visibleYear, setVisibleYear] = useState(() => visibleMonth.getFullYear());
  /** set to ask a feed to scroll somewhere; cleared when honored */
  const [monthTarget, setMonthTarget] = useState<Date | null>(null);
  const [yearTarget, setYearTarget] = useState<number | null>(null);

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

    const finish = () => {
      monthLayer.style.transform = "";
      yearLayer.style.transform = "";
      monthLayer.style.opacity = "";
      yearLayer.style.opacity = "";
      setZoom(null);
      zooming.current = false;
    };

    if (reduceMotion) {
      const outgoing = zoom.out === "month" ? monthLayer : yearLayer;
      void animate(outgoing, { opacity: [1, 0] }, { duration: 0.12 }).then(finish);
      return;
    }

    // where the active month lives inside the year layer
    const mini = yearLayer.querySelector<HTMLElement>(`[data-ym="${zoom.ym}"]`);
    const stageRect = stage.getBoundingClientRect();
    const miniRect = mini?.getBoundingClientRect();
    const factor = miniRect ? stageRect.width / miniRect.width : 3.2;
    const origin = miniRect
      ? `${(((miniRect.left + miniRect.right) / 2 - stageRect.left) / stageRect.width) * 100}% ${
          (((miniRect.top + miniRect.bottom) / 2 - stageRect.top) / stageRect.height) * 100
        }%`
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
    setYearTarget(visibleMonth.getFullYear());
    setVisibleYear(visibleMonth.getFullYear());
    runZoom("month", ym(visibleMonth));
  };

  const pickMonth = (m: Date) => {
    setMonthTarget(m);
    setVisibleMonth(m);
    runZoom("year", ym(m));
  };

  const goToday = () => {
    setSelected(dayKey());
    window.history.replaceState(null, "", pathname);
    if (view === "year" && !zoom) {
      pickMonth(currentMonth);
    } else {
      setMonthTarget(currentMonth);
      setVisibleMonth(currentMonth);
    }
  };

  const stepFeed = (delta: number) => {
    if (view === "month") {
      const next = addMonths(visibleMonth, delta);
      if (isAfter(startOfMonth(next), currentMonth)) return;
      setMonthTarget(next);
    } else {
      const next = visibleYear + delta;
      if (next > today.getFullYear()) return;
      setYearTarget(next);
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
          {!atToday && (
            <button
              type="button"
              onClick={goToday}
              className="voice-label pressable mr-2 rounded-[5px] px-2 py-1 text-wax hover:bg-accent"
            >
              Today
            </button>
          )}
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
          "mt-3 grid grid-cols-7 transition-opacity duration-150",
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
            active={view === "month" && !zoom}
            today={today}
            counts={counts}
            selected={selected}
            onPick={pick}
            target={monthTarget}
            onTargetDone={() => setMonthTarget(null)}
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
            active={view === "year" && !zoom}
            today={today}
            counts={counts}
            onPickMonth={pickMonth}
            target={yearTarget}
            onTargetDone={() => setYearTarget(null)}
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

/* ── the month feed: time as one continuous scroll ──────────────── */

function monthsWindow(center: Date, currentMonth: Date): Date[] {
  const out: Date[] = [];
  for (let i = -2; i <= 2; i++) {
    const m = startOfMonth(addMonths(center, i));
    if (!isAfter(m, currentMonth)) out.push(m);
  }
  return out;
}

function MonthFeed({
  active,
  today,
  counts,
  selected,
  onPick,
  target,
  onTargetDone,
  onVisible,
}: {
  active: boolean;
  today: Date;
  counts: Map<string, number> | undefined;
  selected: string;
  onPick: (key: string) => void;
  target: Date | null;
  onTargetDone: () => void;
  onVisible: (m: Date) => void;
}) {
  const currentMonth = startOfMonth(today);
  const [center, setCenter] = useState(() =>
    startOfMonth(dateFromDayKey(selected)),
  );
  const months = monthsWindow(center, currentMonth);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const settling = useRef(false);
  const didInit = useRef(false);

  const scrollToMonth = useCallback((m: Date, smooth: boolean) => {
    const el = scrollerRef.current;
    if (!el) return;
    const block = el.querySelector<HTMLElement>(`[data-month="${ym(m)}"]`);
    if (!block) return;
    settling.current = smooth;
    el.scrollTo({ top: block.offsetTop, behavior: smooth ? "smooth" : "instant" });
    if (smooth) setTimeout(() => (settling.current = false), 650);
  }, []);

  // first paint: stand on the selected month
  useLayoutEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    scrollToMonth(center, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // honor navigation requests (chevrons, Today, zoom-in)
  useEffect(() => {
    if (!target) return;
    const t = startOfMonth(target);
    const present = months.some((m) => ym(m) === ym(t));
    if (!present) {
      requestAnimationFrame(() => {
        setCenter(t);
        requestAnimationFrame(() => {
          scrollToMonth(t, false);
          onTargetDone();
        });
      });
      return;
    }
    scrollToMonth(t, true);
    onTargetDone();
  }, [target, months, scrollToMonth, onTargetDone]);

  // when re-centering prepends content above the reader,
  // compensate scrollTop exactly so their eyes never move
  const pendingRecenter = useRef<{ prevHeight: number; prevTop: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pendingRecenter.current) return;
    const { prevHeight, prevTop } = pendingRecenter.current;
    pendingRecenter.current = null;
    const delta = el.scrollHeight - prevHeight;
    if (delta > 0 && el.scrollTop <= prevTop) {
      el.scrollTop = prevTop + delta;
    }
  });

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || settling.current) return;
    const blocks = Array.from(el.querySelectorAll<HTMLElement>("[data-month]"));
    if (blocks.length === 0) return;
    const probe = el.scrollTop + el.clientHeight * 0.35;
    let cur = blocks[0];
    for (const b of blocks) if (b.offsetTop <= probe) cur = b;
    const visible = startOfMonth(dateFromDayKey(`${cur.dataset.month}-01`));
    onVisible(visible);
    if (ym(visible) !== ym(center)) {
      pendingRecenter.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
      setCenter(visible);
    }
  };

  return (
    <div
      ref={scrollerRef}
      onScroll={active ? onScroll : undefined}
      className="h-full overflow-y-auto overscroll-contain"
      style={{ scrollbarWidth: "none" }}
      tabIndex={-1}
    >
      <div className="flex flex-col gap-4 pb-8">
        {months.map((m) => (
          <MonthBlock
            key={ym(m)}
            month={m}
            today={today}
            counts={counts}
            selected={selected}
            onPick={onPick}
          />
        ))}
      </div>
    </div>
  );
}

function MonthBlock({
  month,
  today,
  counts,
  selected,
  onPick,
}: {
  month: Date;
  today: Date;
  counts: Map<string, number> | undefined;
  selected: string;
  onPick: (key: string) => void;
}) {
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const leadingBlanks = getDay(month);
  const trailingBlanks = (7 - ((leadingBlanks + days.length) % 7)) % 7;

  return (
    <div data-month={ym(month)}>
      <p className="voice-label mb-1.5 text-[0.82rem] text-ink-soft">
        {format(month, "MMMM yyyy")}
      </p>
      <div
        role="grid"
        aria-label={format(month, "MMMM yyyy")}
        className="grid grid-cols-7 overflow-hidden rounded-[6px] border border-rule-faint bg-rule-faint/40 shadow-[inset_0_1px_3px_rgb(var(--shadow-hue)/0.05)]"
        style={{ gap: "1px" }}
      >
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <span key={`b${i}`} className="aspect-square bg-paper" aria-hidden="true" />
        ))}
        {days.map((date) => {
          const key = dayKey(date);
          const count = counts?.get(key) ?? 0;
          const isToday = isSameDay(date, today);
          const isFuture = isAfter(date, today);
          const isSelected = key === selected;
          return (
            <motion.button
              key={key}
              type="button"
              disabled={isFuture}
              onClick={() => onPick(key)}
              whileTap={isFuture ? undefined : { scale: 0.9 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              aria-label={`${format(date, "MMMM d")}${count ? `, ${count} kept` : ""}`}
              aria-pressed={isSelected}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center gap-1 bg-paper",
                !isFuture && "transition-colors duration-150 hover:bg-paper-raised",
                isFuture && "text-ink-faint/40",
              )}
            >
              {isSelected && (
                <motion.span
                  layoutId="day-ring"
                  aria-hidden="true"
                  transition={ringSpring}
                  // z-10 so the ring glides OVER neighboring tiles in
                  // both directions — cells later in DOM order would
                  // otherwise paint above a ring flying backwards
                  className="absolute inset-[3px] z-10 rounded-[5px] border-[1.5px] border-wax bg-wax/5 shadow-[inset_0_1px_2px_rgb(var(--shadow-hue)/0.06)]"
                />
              )}
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
        {Array.from({ length: trailingBlanks }).map((_, i) => (
          <span key={`t${i}`} className="aspect-square bg-paper" aria-hidden="true" />
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

function YearFeed({
  active,
  today,
  counts,
  onPickMonth,
  target,
  onTargetDone,
  onVisible,
}: {
  active: boolean;
  today: Date;
  counts: Map<string, number> | undefined;
  onPickMonth: (m: Date) => void;
  target: number | null;
  onTargetDone: () => void;
  onVisible: (y: number) => void;
}) {
  const currentYear = today.getFullYear();
  const [center, setCenter] = useState(currentYear);
  const years = [center - 1, center, center + 1].filter((y) => y <= currentYear);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const settling = useRef(false);
  const didInit = useRef(false);

  const scrollToYear = useCallback((y: number, smooth: boolean) => {
    const el = scrollerRef.current;
    if (!el) return;
    const block = el.querySelector<HTMLElement>(`[data-year="${y}"]`);
    if (!block) return;
    settling.current = smooth;
    el.scrollTo({ top: block.offsetTop, behavior: smooth ? "smooth" : "instant" });
    if (smooth) setTimeout(() => (settling.current = false), 650);
  }, []);

  useLayoutEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    scrollToYear(center, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (target === null) return;
    if (!years.includes(target)) {
      requestAnimationFrame(() => {
        setCenter(target);
        requestAnimationFrame(() => {
          scrollToYear(target, false);
          onTargetDone();
        });
      });
      return;
    }
    scrollToYear(target, true);
    onTargetDone();
  }, [target, years, scrollToYear, onTargetDone]);

  const pendingRecenter = useRef<{ prevHeight: number; prevTop: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pendingRecenter.current) return;
    const { prevHeight, prevTop } = pendingRecenter.current;
    pendingRecenter.current = null;
    const delta = el.scrollHeight - prevHeight;
    if (delta > 0 && el.scrollTop <= prevTop) {
      el.scrollTop = prevTop + delta;
    }
  });

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el || settling.current) return;
    const blocks = Array.from(el.querySelectorAll<HTMLElement>("[data-year]"));
    if (blocks.length === 0) return;
    const probe = el.scrollTop + el.clientHeight * 0.35;
    let cur = blocks[0];
    for (const b of blocks) if (b.offsetTop <= probe) cur = b;
    const y = Number(cur.dataset.year);
    onVisible(y);
    if (y !== center) {
      pendingRecenter.current = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
      setCenter(y);
    }
  };

  return (
    <div
      ref={scrollerRef}
      onScroll={active ? onScroll : undefined}
      className="h-full overflow-y-auto overscroll-contain"
      style={{ scrollbarWidth: "none" }}
      tabIndex={-1}
    >
      <div className="flex flex-col gap-6 pb-8">
        {years.map((y) => (
          <div key={y} data-year={y}>
            <p className="voice-label mb-1.5 text-[0.82rem] text-ink-soft">{y}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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
    </div>
  );
}

/** Twelve tiny constellations: a dot per day, ink where something was kept. */
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
