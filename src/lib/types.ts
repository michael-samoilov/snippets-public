export const KINDS = [
  "story",
  "joke",
  "quote",
  "idea",
  "phrase",
  "observation",
] as const;

export type SnippetKind = (typeof KINDS)[number];

export type EnrichState =
  /** waiting for (or retrying) automatic filing */
  | "pending"
  /** filed automatically */
  | "done"
  /** the writer filed it by hand — never overwrite */
  | "manual"
  /** automatic filing unavailable; offer chips */
  | "failed"
  /** filing disabled in settings */
  | "off";

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
  enriched: EnrichState;
  updatedAt: number;
  /** soft delete: set, then purged after 30 days */
  deletedAt?: number;
}

export interface SnippetDraft {
  text: string;
  source: Snippet["source"];
  capturedAt?: number;
}

/** Shape returned by the enrichment endpoint. */
export interface Enrichment {
  title: string;
  kind: SnippetKind;
  tags: string[];
  attribution?: string;
}
