import Dexie, { type Table } from "dexie";
import { ulid } from "ulidx";
import type { Snippet, SnippetDraft, SnippetKind } from "@/lib/types";
import { dayKey } from "@/lib/dates";

class SnippetsDB extends Dexie {
  snippets!: Table<Snippet, string>;

  constructor() {
    super("snippets");
    this.version(1).stores({
      // id is the primary key; the rest are query indexes
      snippets: "id, day, capturedAt, kind, favorite, enriched, *tags",
    });
  }
}

export const db = new SnippetsDB();

const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function notDeleted(s: Snippet): boolean {
  return s.deletedAt === undefined;
}

// ── writes ──────────────────────────────────────────────────────

export async function addSnippet(draft: SnippetDraft): Promise<Snippet> {
  const now = Date.now();
  const capturedAt = draft.capturedAt ?? now;
  const snippet: Snippet = {
    id: ulid(capturedAt),
    text: draft.text.trim(),
    kind: null,
    tags: [],
    capturedAt,
    day: dayKey(new Date(capturedAt)),
    source: draft.source,
    favorite: 0,
    enriched: "pending",
    updatedAt: now,
  };
  await db.snippets.add(snippet);
  return snippet;
}

export async function updateSnippet(
  id: string,
  changes: Partial<Omit<Snippet, "id">>,
): Promise<void> {
  await db.snippets.update(id, { ...changes, updatedAt: Date.now() });
}

/** Apply enrichment results only onto fields the writer hasn't touched. */
export async function applyEnrichment(
  id: string,
  enrichment: { title?: string; kind?: SnippetKind; tags?: string[]; attribution?: string },
): Promise<void> {
  await db.transaction("rw", db.snippets, async () => {
    const current = await db.snippets.get(id);
    if (!current || current.deletedAt) return;
    // The writer beat us to it — their filing wins.
    if (current.enriched === "manual") return;
    await db.snippets.update(id, {
      title: current.title ?? enrichment.title,
      kind: current.kind ?? enrichment.kind ?? null,
      tags: current.tags.length ? current.tags : (enrichment.tags ?? []),
      attribution: current.attribution ?? enrichment.attribution,
      enriched: "done",
      updatedAt: Date.now(),
    });
  });
}

export async function markEnrichment(
  id: string,
  state: Snippet["enriched"],
): Promise<void> {
  const current = await db.snippets.get(id);
  if (!current || current.enriched === "manual") return;
  await db.snippets.update(id, { enriched: state });
}

export async function softDeleteSnippet(id: string): Promise<void> {
  await db.snippets.update(id, { deletedAt: Date.now() });
}

export async function restoreSnippet(id: string): Promise<void> {
  await db.snippets
    .where("id")
    .equals(id)
    .modify((s) => {
      delete s.deletedAt;
      s.updatedAt = Date.now();
    });
}

export async function toggleFavorite(id: string): Promise<void> {
  const s = await db.snippets.get(id);
  if (!s) return;
  await db.snippets.update(id, { favorite: s.favorite ? 0 : 1 });
}

/** Housekeeping: permanently remove long-deleted entries. */
export async function purgeOldDeleted(): Promise<void> {
  const cutoff = Date.now() - PURGE_AFTER_MS;
  await db.snippets
    .filter((s) => s.deletedAt !== undefined && s.deletedAt < cutoff)
    .delete();
}

// ── reads ───────────────────────────────────────────────────────

export async function snippetsForDay(day: string): Promise<Snippet[]> {
  const rows = await db.snippets.where("day").equals(day).sortBy("capturedAt");
  return rows.filter(notDeleted);
}

export async function allSnippetsNewestFirst(): Promise<Snippet[]> {
  const rows = await db.snippets.orderBy("capturedAt").reverse().toArray();
  return rows.filter(notDeleted);
}

export async function pendingEnrichment(): Promise<Snippet[]> {
  const rows = await db.snippets.where("enriched").equals("pending").toArray();
  return rows.filter(notDeleted);
}

/** day -> count, for the ledger's ink dots */
export async function countsByDay(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  await db.snippets.each((s) => {
    if (!notDeleted(s)) return;
    counts.set(s.day, (counts.get(s.day) ?? 0) + 1);
  });
  return counts;
}

export interface Stats {
  total: number;
  daysWithEntries: number;
  currentStreak: number;
  longestStreak: number;
}

export async function computeStats(): Promise<Stats> {
  const counts = await countsByDay();
  const days = [...counts.keys()].sort();
  let longest = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const d of days) {
    const date = new Date(`${d}T12:00:00`);
    run =
      prev && date.getTime() - prev.getTime() <= 36 * 60 * 60 * 1000
        ? run + 1
        : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  // current streak: walk backwards from today; today not yet written
  // doesn't break it (the day isn't over).
  let current = 0;
  const cursor = new Date();
  if (!counts.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (counts.has(dayKey(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  let total = 0;
  for (const n of counts.values()) total += n;
  return {
    total,
    daysWithEntries: days.length,
    currentStreak: current,
    longestStreak: longest,
  };
}

export interface MemoryGroup {
  /** e.g. "One year ago" / "Last month" */
  label: string;
  snippets: Snippet[];
}

/**
 * "On this day": same calendar date in earlier years, plus the same
 * day-of-month one month ago. Quietly absent when there's nothing.
 */
export async function onThisDay(today = new Date()): Promise<MemoryGroup[]> {
  const groups: MemoryGroup[] = [];
  const mmdd = dayKey(today).slice(5);

  const candidates: { day: string; label: string }[] = [];
  for (let yearsAgo = 1; yearsAgo <= 10; yearsAgo++) {
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - yearsAgo);
    const key = dayKey(d);
    if (key.slice(5) !== mmdd) continue; // Feb 29 drift
    candidates.push({
      day: key,
      label: yearsAgo === 1 ? "One year ago" : `${yearsAgo} years ago`,
    });
  }
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  if (monthAgo.getDate() === today.getDate()) {
    candidates.push({ day: dayKey(monthAgo), label: "One month ago" });
  }

  for (const { day, label } of candidates) {
    const snippets = await snippetsForDay(day);
    if (snippets.length) groups.push({ label, snippets });
  }
  return groups;
}
