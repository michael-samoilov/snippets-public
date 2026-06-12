"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import MiniSearch from "minisearch";
import {
  allSnippetsNewestFirst,
  computeStats,
  countsByDay,
  onThisDay,
  snippetsForDay,
  type MemoryGroup,
  type Stats,
} from "@/lib/db";
import { dayKey } from "@/lib/dates";
import type { Snippet } from "@/lib/types";

export function useTodaySnippets(): Snippet[] | undefined {
  const today = dayKey();
  return useLiveQuery(() => snippetsForDay(today), [today]);
}

export function useDaySnippets(day: string): Snippet[] | undefined {
  return useLiveQuery(() => snippetsForDay(day), [day]);
}

export function useAllSnippets(): Snippet[] | undefined {
  return useLiveQuery(() => allSnippetsNewestFirst(), []);
}

export function useDayCounts(): Map<string, number> | undefined {
  return useLiveQuery(() => countsByDay(), []);
}

export function useStats(): Stats | undefined {
  return useLiveQuery(() => computeStats(), []);
}

export function useOnThisDay(): MemoryGroup[] | undefined {
  return useLiveQuery(() => onThisDay(), [dayKey()]);
}

/** Group a newest-first list by day key, preserving order. */
export function groupByDay(snippets: Snippet[]): { day: string; snippets: Snippet[] }[] {
  const groups: { day: string; snippets: Snippet[] }[] = [];
  for (const s of snippets) {
    const last = groups[groups.length - 1];
    if (last && last.day === s.day) last.snippets.push(s);
    else groups.push({ day: s.day, snippets: [s] });
  }
  return groups;
}

/**
 * Client-side full-text search. The index rebuilds when the collection
 * changes — at personal-collection scale this is instantaneous.
 */
export function useSearch(query: string, snippets: Snippet[] | undefined): Snippet[] {
  const index = useMemo(() => {
    if (!snippets) return null;
    const mini = new MiniSearch<Snippet>({
      fields: ["title", "text", "tagText", "attribution"],
      storeFields: [],
      extractField: (doc, field) =>
        field === "tagText" ? doc.tags.join(" ") : String(doc[field as keyof Snippet] ?? ""),
      searchOptions: {
        boost: { title: 2, tagText: 1.5 },
        // prefix only, no fuzz: search is a FILTER — every entry shown
        // must literally contain what was typed (prefix covers the
        // word still being typed; fuzzy let "poop" surface "poo")
        prefix: true,
      },
    });
    mini.addAll(snippets);
    return mini;
  }, [snippets]);

  return useMemo(() => {
    if (!snippets) return [];
    const q = query.trim();
    if (!q) return snippets;
    if (!index) return [];
    const ids = new Set(index.search(q).map((r) => r.id as string));
    return snippets.filter((s) => ids.has(s.id));
  }, [query, snippets, index]);
}
