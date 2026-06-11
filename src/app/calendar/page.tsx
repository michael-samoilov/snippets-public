"use client";

import { Suspense, useCallback, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isAfter,
  isSameDay,
  startOfMonth,
} from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { MotionEntryList } from "@/components/snippet/motion-entry-list";
import { useDayCounts, useDaySnippets, useStats } from "@/hooks/use-snippets";
import { dayKey, dateFromDayKey, friendlyDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const ringSpring = { type: "spring", stiffness: 380, damping: 30 } as const;

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

  const [selected, setSelected] = useState(initialDay);
  const [month, setMonth] = useState(() =>
    startOfMonth(dateFromDayKey(initialDay)),
  );
  const [direction, setDirection] = useState(0);
  const counts = useDayCounts();
  const stats = useStats();
  const daySnippets = useDaySnippets(selected);

  const today = new Date();
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const leadingBlanks = getDay(month);
  const trailingBlanks = (7 - ((leadingBlanks + days.length) % 7)) % 7;

  const pick = useCallback(
    (key: string) => {
      setSelected(key);
      navigator.vibrate?.(6);
      const isToday = key === dayKey();
      window.history.replaceState(
        null,
        "",
        isToday ? pathname : `${pathname}?d=${key}`,
      );
    },
    [pathname],
  );

  const step = (delta: number) => {
    setDirection(delta);
    setMonth((m) => addMonths(m, delta));
  };

  return (
    <div className="page-settle">
      <header className="mb-6">
        <h1 className="voice-display text-[2.5rem] leading-[1.02] sm:text-[2.9rem]">
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

      <div className="flex items-baseline justify-between">
        <AnimatePresence mode="wait" initial={false}>
          <motion.h2
            key={format(month, "yyyy-MM")}
            initial={{ opacity: 0, x: direction * 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -16 }}
            transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="voice-display text-[1.3rem]"
          >
            {format(month, "MMMM yyyy")}
          </motion.h2>
        </AnimatePresence>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => step(-1)}
            className="pressable rounded-[5px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft hover:bg-accent hover:text-ink"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => step(1)}
            disabled={isAfter(addMonths(month, 1), endOfMonth(today))}
            className="pressable rounded-[5px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft hover:bg-accent hover:text-ink disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      <div role="grid" aria-label={format(month, "MMMM yyyy")} className="mt-3">
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
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={format(month, "yyyy-MM")}
            initial={{ opacity: 0, x: direction * 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction * -24 }}
            transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
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
                  onClick={() => pick(key)}
                  whileTap={isFuture ? undefined : { scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                  aria-label={`${format(date, "MMMM d")}${count ? `, ${count} kept` : ""}`}
                  aria-pressed={isSelected}
                  className={cn(
                    "relative flex aspect-square flex-col items-center justify-center gap-1 bg-paper",
                    !isFuture &&
                      "transition-colors duration-150 hover:bg-paper-raised",
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
          </motion.div>
        </AnimatePresence>
      </div>

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
        {daySnippets && daySnippets.length === 0 && (
          <p className="voice-prose mt-4 italic text-ink-soft">
            Nothing kept this day.
          </p>
        )}
        {daySnippets && daySnippets.length > 0 && (
          <MotionEntryList key={selected} snippets={daySnippets} />
        )}
      </section>
    </div>
  );
}
