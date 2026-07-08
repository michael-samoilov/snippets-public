export const KINDS = [
  "story",
  "joke",
  "quote",
  "idea",
  "phrase",
  "observation",
] as const;

export type SnippetKind = (typeof KINDS)[number];

export interface Snippet {
  /** ULID — lexicographically time-sortable */
  id: string;
  /** the words, verbatim */
  text: string;
  /** a short title, auto-suggested or hand-written */
  title?: string;
  kind: SnippetKind | null;
  tags: string[];
  /** for quotes: who said it */
  attribution?: string;
  /** epoch ms of the moment of capture */
  capturedAt: number;
  /** local-timezone day key, "YYYY-MM-DD" — the calendar's truth */
  day: string;
  source: "voice" | "typed";
  /** 0 | 1 — IndexedDB cannot index booleans */
  favorite: 0 | 1;
  updatedAt: number;
  /** soft delete: set, then purged after 30 days */
  deletedAt?: number;
  /**
   * 0 | 1 (IndexedDB can't index booleans) — set on every local write,
   * cleared when the server acknowledges the row. Local bookkeeping
   * only: stripped from exports and from sync payloads.
   */
  _dirty?: 0 | 1;
}

export interface SnippetDraft {
  text: string;
  source: Snippet["source"];
  capturedAt?: number;
  /** pre-set id so an optimistic card and its DB row can share identity. */
  id?: string;
}
