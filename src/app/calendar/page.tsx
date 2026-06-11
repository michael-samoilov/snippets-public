"use client";

import { useState } from "react";
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
import { SnippetEntry } from "@/components/snippet/snippet-entry";
import { useDayCounts, useDaySnippets, useStats } from "@/hooks/use-snippets";
import { dayKey, friendlyDay } from "@/lib/dates";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function CalendarPage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState(() => dayKey());
  const counts = useDayCounts();
  const stats = useStats();
  const daySnippets = useDaySnippets(selected);

  const today = new Date();
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const leadingBlanks = getDay(month);

  return (
    <>
      <header className="mb-6">
        <h1 className="voice-display text-[1.9rem] leading-tight sm:text-[2.2rem]">
          Calendar
        </h1>
        {stats && stats.daysWithEntries > 0 && (
          <p className="voice-meta mt-1.5">
            Collected on {stats.daysWithEntries}{" "}
            {stats.daysWithEntries === 1 ? "day" : "days"}
            {stats.longestStreak > 1 && <> · longest run {stats.longestStreak}</>}
          </p>
        )}
      </header>

      <div className="flex items-baseline justify-between">
        <h2 className="voice-display text-[1.25rem]">
          {format(month, "MMMM yyyy")}
        </h2>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="rounded-[3px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft transition-colors duration-150 hover:bg-accent hover:text-ink"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            disabled={isAfter(addMonths(month, 1), endOfMonth(today))}
            className="rounded-[3px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft transition-colors duration-150 hover:bg-accent hover:text-ink disabled:opacity-30"
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
              className="voice-meta pb-2 text-center"
            >
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l border-t border-rule-faint">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <span
              key={`blank-${i}`}
              className="aspect-square border-b border-r border-rule-faint"
              aria-hidden="true"
            />
          ))}
          {days.map((date) => {
            const key = dayKey(date);
            const count = counts?.get(key) ?? 0;
            const isToday = isSameDay(date, today);
            const isFuture = isAfter(date, today);
            const isSelected = key === selected;
            return (
              <button
                key={key}
                type="button"
                disabled={isFuture}
                onClick={() => setSelected(key)}
                aria-label={`${format(date, "MMMM d")}${count ? `, ${count} kept` : ""}`}
                aria-pressed={isSelected}
                className={cn(
                  "relative flex aspect-square flex-col items-center justify-center gap-1 border-b border-r border-rule-faint transition-colors duration-150",
                  !isFuture && "hover:bg-accent",
                  isSelected && "bg-accent",
                  isFuture && "text-ink-faint/50",
                )}
              >
                <span
                  className={cn(
                    "font-mono text-[0.78rem]",
                    isToday &&
                      "grid size-6 place-items-center rounded-full text-wax outline outline-1 outline-wax/60",
                  )}
                >
                  {format(date, "d")}
                </span>
                {count > 0 && (
                  <span className="flex gap-[3px]" aria-hidden="true">
                    {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
                      <span
                        key={i}
                        className="size-[3.5px] rounded-full bg-ink-soft"
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <section className="mt-9" aria-label={friendlyDay(selected)}>
        <header className="flex items-baseline justify-between border-b border-rule pb-1.5">
          <h2 className="voice-display text-[1.12rem]">{friendlyDay(selected)}</h2>
          {daySnippets && daySnippets.length > 0 && (
            <span className="voice-meta">{daySnippets.length}</span>
          )}
        </header>
        {daySnippets && daySnippets.length === 0 && (
          <p className="voice-prose mt-4 italic text-ink-soft">
            Nothing kept this day.
          </p>
        )}
        <ul className="entry-list divide-y divide-rule-faint">
          {daySnippets?.map((snippet, i) => (
            <li key={snippet.id}>
              <SnippetEntry snippet={snippet} stagger={i} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
