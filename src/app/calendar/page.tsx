"use client";

import {
  Suspense,
  useCallback,
  useEffect,
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
  isBefore,
  isSameDay,
  startOfMonth,
} from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { toast } from "sonner";
import { MotionEntryList } from "@/components/snippet/motion-entry-list";
import { useDayCounts, useDaySnippets, useStats } from "@/hooks/use-snippets";
import { addSnippet } from "@/lib/db";
import { enrichSnippet } from "@/lib/enrich";
import { dayKey, dateFromDayKey, friendlyDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const ringSpring = { type: "spring", stiffness: 380, damping: 30 } as const;
const zoomSpring = { type: "spring", stiffness: 320, damping: 32 } as const;

export default function CalendarPage() {
  return (
    <Suspense>
      <Calendar />
    </Suspense>
  );
}

function Calendar() {
  const params = useSearchParams();
  const pathname = usePathname();
  const initialDay = (() => {
    const d = params.get("d");
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : dayKey();
  })();

  const [view, setView] = useState<"month" | "year">("month");
  const [selected, setSelected] = useState(initialDay);
  const [month, setMonthState] = useState(() =>
    startOfMonth(dateFromDayKey(initialDay)),
  );
  const [year, setYear] = useState(() => month.getFullYear());
  const [direction, setDirection] = useState(0);
  const counts = useDayCounts();
  const stats = useStats();
  const daySnippets = useDaySnippets(selected);

  const today = new Date();
  const currentMonth = startOfMonth(today);
  const monthKey = format(month, "yyyy-MM");
  const atToday = monthKey === format(today, "yyyy-MM") && selected === dayKey();

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

  const step = useCallback(
    (delta: number) => {
      if (view === "month") {
        if (delta > 0 && !isBefore(month, currentMonth)) return false;
        setDirection(delta);
        setMonthState((m) => addMonths(m, delta));
      } else {
        if (delta > 0 && year >= today.getFullYear()) return false;
        setDirection(delta);
        setYear((y) => y + delta);
      }
      return true;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, month, year],
  );

  /* wheel steps months/years — native listener; React's synthetic
     onWheel is passive and can't preventDefault */
  const gridWrapRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;
    let acc = 0;
    let lockedUntil = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now < lockedUntil) return;
      acc += e.deltaY;
      if (Math.abs(acc) > 90) {
        const moved = stepRef.current(acc > 0 ? 1 : -1);
        acc = 0;
        if (moved) lockedUntil = now + 350;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const goToday = () => {
    setDirection(0);
    setMonthState(currentMonth);
    setYear(today.getFullYear());
    setSelected(dayKey());
    setView("month");
    window.history.replaceState(null, "", pathname);
  };

  const openYear = () => {
    setYear(month.getFullYear());
    setDirection(0);
    setView("year");
  };

  const pickMonth = (m: Date) => {
    setDirection(0);
    setMonthState(m);
    setView("month");
  };

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

      {/* title row: month opens the year; the year steps by year */}
      <div className="flex items-baseline justify-between">
        <AnimatePresence mode="wait" initial={false}>
          {view === "month" ? (
            <motion.button
              key={`title-${monthKey}`}
              type="button"
              onClick={openYear}
              aria-label={`Show ${month.getFullYear()} at a glance`}
              initial={{ opacity: 0, x: direction * 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -16 }}
              transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
              className="voice-display pressable rounded-[5px] text-[1.3rem] hover:text-wax"
            >
              <span aria-hidden="true" className="mr-1 text-[1rem] text-ink-faint">‹</span>
              {format(month, "MMMM yyyy")}
            </motion.button>
          ) : (
            <motion.h2
              key={`title-${year}`}
              initial={{ opacity: 0, x: direction * 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -16 }}
              transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
              className="voice-display text-[1.3rem]"
            >
              {year}
            </motion.h2>
          )}
        </AnimatePresence>
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
            onClick={() => step(-1)}
            className="pressable rounded-[5px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft hover:bg-accent hover:text-ink"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={view === "month" ? "Next month" : "Next year"}
            onClick={() => step(1)}
            disabled={
              view === "month"
                ? !isBefore(month, currentMonth)
                : year >= today.getFullYear()
            }
            className="pressable rounded-[5px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft hover:bg-accent hover:text-ink disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      {/* the grid: wheel and vertical swipe travel through time */}
      <div
        ref={gridWrapRef}
        className="mt-3"
        onKeyDown={(e) => {
          if (e.key === "PageUp") {
            e.preventDefault();
            step(-1);
          } else if (e.key === "PageDown") {
            e.preventDefault();
            step(1);
          }
        }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {view === "month" ? (
            <MonthGrid
              key={monthKey}
              month={month}
              today={today}
              direction={direction}
              counts={counts}
              selected={selected}
              onPick={pick}
              onStep={step}
            />
          ) : (
            <YearGrid
              key={`year-${year}`}
              year={year}
              anchorKey={monthKey}
              today={today}
              counts={counts}
              onPickMonth={pickMonth}
              onStep={step}
            />
          )}
        </AnimatePresence>
      </div>

      {view === "month" && (
        <section className="mt-9" aria-label={friendlyDay(selected)}>
          <header className="flex items-baseline justify-between border-b border-rule pb-1.5">
            <AnimatePresence mode="wait" initial={false}>
              <motion.h2
                key={selected}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.13, ease: [0.23, 1, 0.32, 1] }}
                className="voice-display text-[1.12rem]"
              >
                {friendlyDay(selected)}
              </motion.h2>
            </AnimatePresence>
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

/* ── one month, in full ─────────────────────────────────────────── */

function MonthGrid({
  month,
  today,
  direction,
  counts,
  selected,
  onPick,
  onStep,
}: {
  month: Date;
  today: Date;
  direction: number;
  counts: Map<string, number> | undefined;
  selected: string;
  onPick: (key: string) => void;
  onStep: (delta: number) => boolean;
}) {
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const leadingBlanks = getDay(month);
  const trailingBlanks = (7 - ((leadingBlanks + days.length) % 7)) % 7;

  return (
    <motion.div
      layoutId={`cal-${format(month, "yyyy-MM")}`}
      initial={{ opacity: 0, y: direction * 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: direction * -24 }}
      transition={{ ...zoomSpring, opacity: { duration: 0.16 } }}
      onPanEnd={(_, info) => {
        if (
          Math.abs(info.offset.y) > 56 &&
          Math.abs(info.offset.y) > Math.abs(info.offset.x)
        ) {
          onStep(info.offset.y < 0 ? 1 : -1);
        }
      }}
      style={{ touchAction: "none" }}
    >
      <div role="row" className="grid grid-cols-7">
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
      <div
        role="grid"
        aria-label={format(month, "MMMM yyyy")}
        className="grid grid-cols-7 overflow-hidden rounded-[6px] border border-rule-faint bg-rule-faint/40 shadow-[inset_0_1px_3px_rgb(var(--shadow-hue)/0.05)]"
        style={{ gap: "1px" }}
      >
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <span key={`blank-${i}`} className="aspect-square bg-paper" aria-hidden="true" />
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
          <span key={`tail-${i}`} className="aspect-square bg-paper" aria-hidden="true" />
        ))}
      </div>
    </motion.div>
  );
}

/* ── the year at a glance ───────────────────────────────────────── */

function YearGrid({
  year,
  anchorKey,
  today,
  counts,
  onPickMonth,
  onStep,
}: {
  year: number;
  anchorKey: string;
  today: Date;
  counts: Map<string, number> | undefined;
  onPickMonth: (m: Date) => void;
  onStep: (delta: number) => boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onPanEnd={(_, info) => {
        if (
          Math.abs(info.offset.y) > 56 &&
          Math.abs(info.offset.y) > Math.abs(info.offset.x)
        ) {
          onStep(info.offset.y < 0 ? 1 : -1);
        }
      }}
      style={{ touchAction: "none" }}
      className="grid grid-cols-3 gap-2 sm:grid-cols-4"
    >
      {MONTH_LABELS.map((label, m) => {
        const start = new Date(year, m, 1);
        const ym = format(start, "yyyy-MM");
        const isFutureMonth = isAfter(start, today);
        const isCurrent =
          year === today.getFullYear() && m === today.getMonth();
        return (
          <motion.button
            key={ym}
            type="button"
            layoutId={ym === anchorKey ? `cal-${ym}` : undefined}
            transition={zoomSpring}
            disabled={isFutureMonth}
            onClick={() => onPickMonth(start)}
            whileTap={isFutureMonth ? undefined : { scale: 0.96 }}
            className={cn(
              "pressable flex flex-col gap-1.5 rounded-[6px] border border-rule-faint bg-paper p-2.5 text-left",
              !isFutureMonth &&
                "shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] hover:bg-paper-raised",
              isFutureMonth && "opacity-40",
            )}
            aria-label={`${format(start, "MMMM yyyy")}`}
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
    </motion.div>
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
