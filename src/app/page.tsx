"use client";

import { Capture } from "@/components/capture/capture";
import { OnThisDay } from "@/components/on-this-day";
import { SnippetEntry } from "@/components/snippet/snippet-entry";
import { useStats, useTodaySnippets } from "@/hooks/use-snippets";
import { longDay } from "@/lib/dates";

export default function TodayPage() {
  const today = useTodaySnippets();
  const stats = useStats();
  const entries = today ? [...today].reverse() : undefined;

  return (
    <>
      <header className="mb-7">
        <h1 className="voice-display text-[1.9rem] leading-tight sm:text-[2.2rem]">
          {longDay(new Date())}
        </h1>
        {stats && stats.total > 0 && (
          <p className="voice-meta mt-1.5">
            {stats.total} kept
            {stats.currentStreak > 1 && <> · {stats.currentStreak} days running</>}
          </p>
        )}
      </header>

      <Capture />

      {stats?.total === 0 && (
        <p className="voice-prose mt-10 max-w-prose italic text-ink-soft">
          Your days are fuller than you think. Catch one true moment before it
          evaporates — a line someone said, a small scene, a joke that landed.
          Two sentences is plenty.
        </p>
      )}

      {entries && entries.length > 0 && (
        <section aria-label="Kept today" className="mt-10">
          <h2 className="voice-meta border-b border-rule pb-2">
            Kept today · {entries.length}
          </h2>
          <ul className="entry-list divide-y divide-rule-faint">
            {entries.map((snippet, i) => (
              <li key={snippet.id}>
                <SnippetEntry snippet={snippet} stagger={i} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <OnThisDay />
    </>
  );
}
