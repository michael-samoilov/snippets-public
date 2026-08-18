import type { Snippet } from "./types";

export interface DayGroup {
  day: string;
  snippets: Snippet[];
}

/**
 * Gather entries under their day key.
 *
 * This lives apart from the hooks so it can be tested: `use-snippets.ts` is a
 * client module that pulls in React and Dexie, neither of which loads under
 * vitest's node environment.
 *
 * Grouping is by KEY, not by adjacency. `day` is stamped in local time when an
 * entry is written (db.ts), while the book is read in `capturedAt` order — so
 * the two orders disagree whenever entries are written under different UTC
 * offsets, and rows sharing a day need not be neighbours. A run-length pass
 * emitted a second group for the same day there, and the caller's
 * `new Map(groups.map(...))` then kept only the last of them: the earlier
 * entries vanished from the book while `countsByDay` still drew their dots.
 */
export function groupByDay(snippets: Snippet[]): DayGroup[] {
  // keyed, not adjacency-based: a day scattered through the list still gets
  // one page. Map keeps insertion order, so a sorted book reads in order and
  // a day sits where it first appears — the contiguous case is unchanged.
  const byDay = new Map<string, Snippet[]>();
  for (const s of snippets) {
    const page = byDay.get(s.day);
    if (page) page.push(s);
    else byDay.set(s.day, [s]);
  }
  return [...byDay].map(([day, rows]) => ({ day, snippets: rows }));
}
