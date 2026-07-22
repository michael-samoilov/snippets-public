"use client";

import type { Snippet } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * An entry is its words — nothing else is displayed. Title, kind,
 * tags, time, and source live in the data (they feed search and the
 * future) but never on the page.
 */
export function SnippetEntry({
  snippet,
  stagger = 0,
  dense = false,
  compact = false,
}: {
  snippet: Snippet;
  stagger?: number;
  /** standalone (the focused card): drop the list padding + entrance, tighten leading */
  dense?: boolean;
  /** a long entry that has to scroll: render at the schedule-preview size, not full prose */
  compact?: boolean;
}) {
  const isQuote = snippet.kind === "quote";
  // don't repeat an attribution the text already ends with
  const attribution =
    snippet.attribution &&
    !snippet.text.trimEnd().endsWith(snippet.attribution)
      ? snippet.attribution
      : null;

  return (
    <article
      className={cn("group relative", dense ? "" : "entry-rise py-4 first:pt-3")}
      style={{ "--stagger": Math.min(stagger, 8) } as React.CSSProperties}
    >
      <p
        className={cn(
          "voice-prose whitespace-pre-wrap",
          isQuote && "hang-quotes italic",
          compact ? "text-[0.94rem] leading-[1.42]" : dense && "leading-[1.5]",
        )}
      >
        {snippet.text}
      </p>

      {attribution && (
        <p className="voice-prose mt-1 text-ink-soft">—&thinsp;{attribution}</p>
      )}
    </article>
  );
}
