"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { KindMark } from "@/components/kind-mark";
import { KindChips } from "@/components/snippet/kind-chips";
import { SnippetEditor } from "@/components/snippet/snippet-editor";
import {
  restoreSnippet,
  softDeleteSnippet,
  toggleFavorite,
  updateSnippet,
} from "@/lib/db";
import { clockTime } from "@/lib/dates";
import { KIND_META } from "@/lib/kinds";
import type { Snippet, SnippetKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SnippetEntry({
  snippet,
  stagger = 0,
  showTime = true,
}: {
  snippet: Snippet;
  stagger?: number;
  showTime?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const isQuote = snippet.kind === "quote";
  // don't repeat an attribution the text already ends with
  const attribution =
    snippet.attribution &&
    !snippet.text.trimEnd().endsWith(snippet.attribution)
      ? snippet.attribution
      : null;

  const letGo = async () => {
    await softDeleteSnippet(snippet.id);
    toast("Let go.", {
      action: {
        label: "Undo",
        onClick: () => void restoreSnippet(snippet.id),
      },
    });
  };

  const fileUnder = (kind: SnippetKind) =>
    void updateSnippet(snippet.id, { kind, enriched: "manual" });

  return (
    <article
      className="group entry-rise relative py-4 first:pt-2"
      style={{ "--stagger": Math.min(stagger, 8) } as React.CSSProperties}
    >
      {/* the mark hangs in the margin, left of the rule */}
      <span className="absolute -left-10 top-[1.3rem] hidden sm:block">
        <KindMark kind={snippet.kind} />
      </span>

      {snippet.title && (
        <h3 className="mb-0.5 font-serif text-[1.04rem] font-[560] leading-snug">
          {snippet.title}
        </h3>
      )}

      <p
        className={cn(
          "voice-prose whitespace-pre-wrap",
          isQuote && "hang-quotes italic",
        )}
      >
        {snippet.text}
      </p>

      {attribution && (
        <p className="voice-prose mt-1 text-ink-soft">
          —&thinsp;{attribution}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="sm:hidden">
          <KindMark kind={snippet.kind} className="size-3.5" />
        </span>
        {showTime && (
          <span className="voice-meta">{clockTime(snippet.capturedAt)}</span>
        )}
        {snippet.kind && (
          <span
            className="voice-meta"
            style={{ color: KIND_META[snippet.kind].color }}
          >
            {KIND_META[snippet.kind].label}
          </span>
        )}
        {snippet.tags.map((tag) => (
          <span key={tag} className="voice-meta normal-case">
            #{tag}
          </span>
        ))}
        {snippet.favorite === 1 && (
          <svg
            viewBox="0 0 16 16"
            aria-label="Favorite"
            className="size-3 text-gilt"
            fill="none"
            stroke="currentColor"
          >
            <path
              d="M8 2.6 V13.4 M3.3 5.3 L12.7 10.7 M3.3 10.7 L12.7 5.3"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        )}
        {snippet.enriched === "pending" && (
          <span className="voice-meta animate-pulse">filing…</span>
        )}

        <span className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Entry actions"
            className="voice-meta -mr-1 rounded-[3px] px-2 py-0.5 tracking-[0.2em] opacity-40 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-70 data-[state=open]:opacity-100"
          >
            ···
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="font-serif">
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void toggleFavorite(snippet.id)}>
              {snippet.favorite ? "Unfavorite" : "Favorite"}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => void letGo()}
            >
              Let go
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {snippet.kind === null && snippet.enriched !== "pending" && (
        <KindChips onPick={fileUnder} />
      )}

      <SnippetEditor
        snippet={snippet}
        open={editing}
        onOpenChange={setEditing}
      />
    </article>
  );
}
