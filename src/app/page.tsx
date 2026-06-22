"use client";

import { format } from "date-fns";
import NumberFlow from "@number-flow/react";
import { Capture } from "@/components/capture/capture";
import { OnThisDay } from "@/components/on-this-day";
import { MotionEntryList } from "@/components/snippet/motion-entry-list";
import { useStats, useTodaySnippets } from "@/hooks/use-snippets";
import { copy } from "@/lib/copy";

export default function TodayPage() {
  const today = useTodaySnippets();
  const stats = useStats();
  const entries = today ? [...today].reverse() : undefined;
  const now = new Date();

  return (
    <div className="page-settle">
      <header className="mb-7 sm:mb-8">
        <p className="voice-label text-ink-faint">{format(now, "EEEE")}</p>
        <h1 className="voice-display ink-bleed mt-0.5 text-[2.5rem] leading-[1.02] sm:text-[2.9rem]">
          {format(now, "MMMM d")}
        </h1>
        {stats && stats.total > 0 && (
          <p className="mt-2.5 font-serif text-[0.92rem] italic text-ink-soft">
            <NumberFlow value={stats.total} /> {copy.today.kept}
            {stats.currentStreak > 1 && (
              <>
                {" "}
                · <NumberFlow value={stats.currentStreak} /> {copy.today.daysRunning}
              </>
            )}
          </p>
        )}
      </header>

      <Capture />

      {stats?.total === 0 && (
        <p className="voice-prose mt-10 max-w-prose italic text-ink-soft">
          {copy.today.empty}
        </p>
      )}

      {entries && entries.length > 0 && (
        <section aria-label={copy.today.keptToday} className="mt-10">
          <h2 className="voice-label border-b border-rule pb-1.5">
            {copy.today.keptToday} · {entries.length}
          </h2>
          <MotionEntryList snippets={entries} />
        </section>
      )}

      <OnThisDay />
    </div>
  );
}
