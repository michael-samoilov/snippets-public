import Dexie, { type Table } from "dexie";
import { ulid } from "ulidx";
import type { Snippet, SnippetDraft } from "@/lib/types";
import { dayKey } from "@/lib/dates";
import { copy } from "@/lib/copy";
import { bumpClock } from "@/lib/merge";
import { currentDbName, syncAdopted } from "@/lib/sync-state";

/** device-local key/value row (the book key, Drive tokens, delivery marks) */
export interface MetaRow {
  key: string;
  value: unknown;
}

class SnippetsDB extends Dexie {
  snippets!: Table<Snippet, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = currentDbName()) {
    super(name);
    this.version(1).stores({
      // id is the primary key; the rest are query indexes
      snippets: "id, day, capturedAt, kind, favorite, enriched, *tags",
    });
    // v2 adds sync dirty-tracking; marking every existing row dirty IS
    // the initial upload — first sign-in pushes the whole book
    this.version(2)
      .stores({
        snippets: "id, day, capturedAt, kind, favorite, enriched, *tags, _dirty",
      })
      .upgrade((tx) =>
        tx
          .table("snippets")
          .toCollection()
          .modify((s: Snippet) => {
            s._dirty = 1;
          }),
      );
    // v3 adds the meta table: the unwrapped book key rests here as a
    // structured-clonable, NON-extractable CryptoKey, alongside the
    // device-held Drive tokens (tokens transit the server, never rest)
    this.version(3).stores({
      snippets: "id, day, capturedAt, kind, favorite, enriched, *tags, _dirty",
      meta: "key",
    });
    // v4 retires automatic filing: drop the `enriched` index and clear the
    // field from every row. Sync merges by plain last-write-wins now.
    this.version(4)
      .stores({
        snippets: "id, day, capturedAt, kind, favorite, *tags, _dirty",
        meta: "key",
      })
      .upgrade((tx) =>
        tx
          .table("snippets")
          .toCollection()
          .modify((s: Snippet & { enriched?: unknown }) => {
            delete s.enriched;
          }),
      );
  }
}

export const db = new SnippetsDB();

/**
 * DEV-SEED writes (lib/dev-seed's only door into the table). They live HERE so
 * db.ts stays the single write choke point, and they carry the structural
 * guard the seeder itself cannot enforce: a sync-adopted book is NEVER touched
 * — a raw clear() on one would vanish rows without tombstones (see CLAUDE.md's
 * erase-all rule). Seed rows arrive pre-shaped with _dirty: 0 (local-only,
 * invisible to sync by construction).
 */
export async function devReplaceSeedRows(
  rows: Snippet[],
  clearFirst: boolean,
): Promise<void> {
  if (syncAdopted())
    throw new Error("dev-seed refused: this book is sync-adopted");
  if (clearFirst) await db.snippets.clear();
  if (rows.length) await db.snippets.bulkPut(rows);
}

const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function notDeleted(s: Snippet): boolean {
  return s.deletedAt === undefined;
}

/**
 * The sync engine registers here to hear about local writes (it
 * debounces and pushes). db.ts stays the single write choke point;
 * sync stays an optional layer on top.
 */
let writeNotifier: (() => void) | null = null;
export function setWriteNotifier(fn: (() => void) | null): void {
  writeNotifier = fn;
}
function notifyWrite(): void {
  writeNotifier?.();
}

// ── writes ──────────────────────────────────────────────────────

/**
 * A keep that didn't take, told apart by cause so the surface can say
 * the right thing: a full disk is actionable ("clear some space"); a
 * generic failure is "try again".
 */
export class StorageWriteError extends Error {
  readonly full: boolean;
  constructor(full: boolean, cause: unknown) {
    super(full ? "storage full" : "storage write failed", { cause });
    this.name = "StorageWriteError";
    this.full = full;
  }
}

function classifyWriteError(error: unknown): StorageWriteError {
  const name = (error as { name?: string })?.name ?? "";
  // Dexie wraps the engine's error; the original sits on `inner`
  const inner = (error as { inner?: { name?: string } })?.inner?.name ?? "";
  const full = /quota/i.test(name) || /quota/i.test(inner);
  return new StorageWriteError(full, error);
}

export async function addSnippet(draft: SnippetDraft): Promise<Snippet> {
  const now = Date.now();
  const capturedAt = draft.capturedAt ?? now;
  const snippet: Snippet = {
    // mint the id from creation time, not capturedAt: a backfilled entry then
    // sorts to the foot of its (past) day's stack rather than into the middle
    id: draft.id ?? ulid(now),
    text: draft.text.trim(),
    kind: null,
    tags: [],
    capturedAt,
    day: dayKey(new Date(capturedAt)),
    source: draft.source,
    favorite: 0,
    updatedAt: now,
    _dirty: 1,
  };
  try {
    await db.snippets.add(snippet);
    // the vocab-app lesson: a write that reports success must be readable
    // back, or the failure surfaces now — never discovered months later
    const readBack = await db.snippets.get(snippet.id);
    if (!readBack) throw new Error("entry did not persist");
  } catch (error) {
    throw classifyWriteError(error);
  }
  notifyWrite();
  return snippet;
}

export async function updateSnippet(
  id: string,
  changes: Partial<Omit<Snippet, "id">>,
): Promise<void> {
  await db.transaction("rw", db.snippets, async () => {
    const current = await db.snippets.get(id);
    if (!current) return;
    await db.snippets.update(id, {
      ...changes,
      updatedAt: bumpClock(current.updatedAt),
      _dirty: 1,
    });
  });
  notifyWrite();
}

export async function softDeleteSnippet(id: string): Promise<void> {
  await db.transaction("rw", db.snippets, async () => {
    const current = await db.snippets.get(id);
    if (!current) return;
    await db.snippets.update(id, {
      deletedAt: Date.now(),
      updatedAt: bumpClock(current.updatedAt),
      _dirty: 1,
    });
  });
  notifyWrite();
}

export async function restoreSnippet(id: string): Promise<void> {
  await db.snippets
    .where("id")
    .equals(id)
    .modify((s) => {
      delete s.deletedAt;
      s.updatedAt = bumpClock(s.updatedAt);
      s._dirty = 1;
    });
  notifyWrite();
}

export async function toggleFavorite(id: string): Promise<void> {
  await db.transaction("rw", db.snippets, async () => {
    const s = await db.snippets.get(id);
    if (!s) return;
    await db.snippets.update(id, {
      favorite: s.favorite ? 0 : 1,
      updatedAt: bumpClock(s.updatedAt),
      _dirty: 1,
    });
  });
  notifyWrite();
}

/**
 * Restore from an export file. Existing entries with the same id are
 * overwritten; everything lands dirty so the next sync offers it to
 * the server — which arbitrates by each row's own clock, so restoring
 * an old file can never clobber newer synced work elsewhere.
 */
export async function importSnippets(rows: Snippet[]): Promise<number> {
  const stamped = rows.map((r) => {
    // older archives carry the retired `enriched` field — drop it on the way in
    const { enriched, ...rest } = r as Snippet & { enriched?: unknown };
    void enriched;
    return { ...rest, _dirty: 1 as const };
  });
  await db.snippets.bulkPut(stamped);
  notifyWrite();
  return stamped.length;
}

/**
 * Let everything go. On an unsynced book this clears the table, as it
 * always has. On a synced book it must soft-delete instead: erase is a
 * user action that propagates to every device as tombstones — a bare
 * local clear() would just resurrect the book on the next pull.
 */
export async function eraseAll(): Promise<void> {
  if (!syncAdopted()) {
    await db.snippets.clear();
    return;
  }
  const now = Date.now();
  await db.snippets.toCollection().modify((s) => {
    if (s.deletedAt === undefined) s.deletedAt = now;
    s.updatedAt = bumpClock(s.updatedAt);
    s._dirty = 1;
  });
  notifyWrite();
}

// ── device meta ─────────────────────────────────────────────────

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deleteMeta(key: string): Promise<void> {
  await db.meta.delete(key);
}

/**
 * The re-encryption sweep, run once when end-to-end encryption is
 * turned on: every row goes dirty AND gets a fresh clock, so the next
 * push re-writes the whole book to the server in the encrypted format
 * (an unchanged clock would no-op against the server's idempotence).
 */
export async function reencryptSweep(): Promise<void> {
  await db.snippets.toCollection().modify((s) => {
    s._dirty = 1;
    s.updatedAt = bumpClock(s.updatedAt);
  });
  notifyWrite();
}

/**
 * Housekeeping: permanently remove long-deleted entries. On a synced
 * book, only rows the server has acknowledged (`_dirty` cleared) may
 * go — a tombstone the server hasn't heard about yet must survive to
 * be delivered, or the entry would resurrect from another device.
 */
export async function purgeOldDeleted(): Promise<void> {
  const cutoff = Date.now() - PURGE_AFTER_MS;
  const adopted = syncAdopted();
  await db.snippets
    .filter(
      (s) =>
        s.deletedAt !== undefined &&
        s.deletedAt < cutoff &&
        (!adopted || s._dirty !== 1),
    )
    .delete();
}

// ── reads ───────────────────────────────────────────────────────

export async function snippetsForDay(day: string): Promise<Snippet[]> {
  // order by id (a ULID minted at creation) so newly-kept entries fall to the
  // foot of the day; for existing rows id-order matches capturedAt-order
  const rows = await db.snippets.where("day").equals(day).sortBy("id");
  return rows.filter(notDeleted);
}

export async function allSnippetsNewestFirst(): Promise<Snippet[]> {
  const rows = await db.snippets.orderBy("capturedAt").reverse().toArray();
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
      label: yearsAgo === 1 ? copy.memories.oneYearAgo : copy.memories.yearsAgo(yearsAgo),
    });
  }
  const monthAgo = new Date(today);
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  if (monthAgo.getDate() === today.getDate()) {
    candidates.push({ day: dayKey(monthAgo), label: copy.memories.oneMonthAgo });
  }

  for (const { day, label } of candidates) {
    const snippets = await snippetsForDay(day);
    if (snippets.length) groups.push({ label, snippets });
  }
  return groups;
}
