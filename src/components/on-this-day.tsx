"use client";

import { useOnThisDay } from "@/hooks/use-snippets";
import { SnippetEntry } from "@/components/snippet/snippet-entry";
import { copy } from "@/lib/copy";

/**
 * Memories resurface quietly: the same date in earlier years, and the
 * same day last month. Absent entirely when there's nothing to show.
 */
export function OnThisDay() {
  const groups = useOnThisDay();
  if (!groups || groups.length === 0) return null;

  return (
    <section aria-label={copy.memories.heading} className="mt-12">
      <h2 className="voice-label border-b border-rule pb-1.5">{copy.memories.heading}</h2>
      {groups.map((group) => (
        <div key={group.label} className="mt-4">
          <h3 className="voice-display text-[1.05rem] italic text-ink-soft">
            {group.label}
          </h3>
          <ul className="entry-list divide-y divide-rule-faint">
            {group.snippets.map((s, i) => (
              <li key={s.id}>
                <SnippetEntry snippet={s} stagger={i} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
