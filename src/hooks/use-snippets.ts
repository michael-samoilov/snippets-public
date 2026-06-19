"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
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
import { normalize, queryTerms, searchableText } from "@/lib/search";
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
 * Client-side full-text FILTER. Each entry's searchable text is
 * normalized once when the collection changes (instant at personal
 * scale); keystrokes only test substrings against it. The filter and
 * the highlighter share one notion of a match — see src/lib/search.ts.
 */
export function useSearch(query: string, snippets: Snippet[] | undefined): Snippet[] {
  const index = useMemo(
    () => snippets?.map((s) => ({ s, hay: normalize(searchableText(s)) })) ?? null,
    [snippets],
  );

  return useMemo(() => {
    if (!snippets) return [];
    const terms = queryTerms(query);
    if (!terms.length || !index) return snippets;
    return index
      .filter(({ hay }) => terms.every((t) => hay.includes(t)))
      .map(({ s }) => s);
  }, [query, snippets, index]);
}
