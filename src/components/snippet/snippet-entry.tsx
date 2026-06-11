"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  clampable = false,
}: {
  snippet: Snippet;
  stagger?: number;
  showTime?: boolean;
  /** cap long entries at a few lines behind a quiet “more” */
  clampable?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  // does the clamped text actually hide anything? measured async-safely
  useEffect(() => {
    if (!clampable || expanded) return;
    const el = textRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setOverflows(el.scrollHeight > el.clientHeight + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [clampable, expanded]);

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

  const fileUnder = (kind: SnippetKind) => {
    navigator.vibrate?.(6);
    void updateSnippet(snippet.id, { kind, enriched: "manual" });
  };

  return (
    <article
      className="group entry-rise relative py-4 first:pt-3"
      style={{ "--stagger": Math.min(stagger, 8) } as React.CSSProperties}
    >
      {snippet.title && (
        <h3 className="mb-0.5 font-serif text-[1.04rem] font-[560] leading-snug">
          {snippet.title}
        </h3>
      )}

      <p
        ref={textRef}
        className={cn(
          "voice-prose whitespace-pre-wrap",
          isQuote && "hang-quotes italic",
          clampable && !expanded && "line-clamp-6",
        )}
      >
        {snippet.text}
      </p>
      {clampable && (overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="voice-data pressable -ml-1 mt-1 rounded-[4px] px-1 py-0.5 text-ink-soft hover:text-ink"
        >
          {expanded ? "less" : "more…"}
        </button>
      )}

      {attribution && (
        <p className="voice-prose mt-1 text-ink-soft">—&thinsp;{attribution}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {showTime && (
          <span className="voice-data">{clockTime(snippet.capturedAt)}</span>
        )}
        {snippet.kind && (
          <span
            className="voice-label text-[0.78rem]"
            style={{ color: KIND_META[snippet.kind].color }}
          >
            {KIND_META[snippet.kind].label}
          </span>
        )}
        {snippet.tags.map((tag) => (
          <span key={tag} className="voice-data">
            #{tag}
          </span>
        ))}
        <AnimatePresence>
          {snippet.favorite === 1 && (
            <motion.svg
              viewBox="0 0 16 16"
              aria-label="Favorite"
              className="size-3 text-gilt"
              fill="none"
              stroke="currentColor"
              initial={{ scale: 0.3, rotate: -120, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={{ type: "spring", duration: 0.45, bounce: 0.45 }}
            >
              <path
                d="M8 2.6 V13.4 M3.3 5.3 L12.7 10.7 M3.3 10.7 L12.7 5.3"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </motion.svg>
          )}
        </AnimatePresence>
        {snippet.enriched === "pending" && (
          <span className="voice-data animate-pulse italic">filing…</span>
        )}

        <span className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Entry actions"
            className="voice-data pressable -mr-1 rounded-[4px] px-2 py-0.5 text-[0.8rem] tracking-[0.2em] opacity-50 transition-opacity duration-150 hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover:opacity-60"
          >
            ···
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="float origin-(--radix-dropdown-menu-content-transform-origin) border-none font-serif data-[state=closed]:duration-100 data-[state=open]:duration-150"
          >
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              Edit…
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
