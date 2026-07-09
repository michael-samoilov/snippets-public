/**
 * Sync bookkeeping that must be readable synchronously and without
 * React — db.ts consults it (purge gating), sync.ts owns it, and the
 * boot path reads the database pointer before Dexie opens.
 *
 * Keys:
 * - `snippets:dbName` — which Dexie database this device shows.
 *   The default book ("snippets") belongs to whoever adopted it first;
 *   any other account signing in on the same device gets its own
 *   isolated database. Books are never merged across accounts.
 * - `snippets:sync:<dbName>` — `{ ownerUserId, lastPulledSeq,
 *   lastSyncedAt }` for that book.
 */

const DB_POINTER_KEY = "snippets:dbName";
export const DEFAULT_DB_NAME = "snippets";

export interface SyncState {
  /** the account this book belongs to; unset = local-only, unadopted */
  ownerUserId?: string;
  /** the pull cursor — highest serverSeq applied */
  lastPulledSeq: number;
  /** epoch ms of the last completed sync cycle */
  lastSyncedAt?: number;
}

const EMPTY: SyncState = { lastPulledSeq: 0 };

export function currentDbName(): string {
  if (typeof window === "undefined") return DEFAULT_DB_NAME;
  try {
    return window.localStorage.getItem(DB_POINTER_KEY) ?? DEFAULT_DB_NAME;
  } catch {
    return DEFAULT_DB_NAME;
  }
}

export function setDbPointer(name: string): void {
  window.localStorage.setItem(DB_POINTER_KEY, name);
}

export function dbNameForUser(userId: string): string {
  // the default book keeps its original name for its adopter; other
  // accounts get a database of their own
  const defaultState = readSyncState(DEFAULT_DB_NAME);
  if (defaultState.ownerUserId === userId) return DEFAULT_DB_NAME;
  if (!defaultState.ownerUserId && currentDbName() === DEFAULT_DB_NAME)
    return DEFAULT_DB_NAME; // unadopted — this sign-in adopts it
  return `snippets:u_${userId}`;
}

function stateKey(dbName: string): string {
  return `snippets:sync:${dbName}`;
}

export function readSyncState(dbName = currentDbName()): SyncState {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(stateKey(dbName));
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<SyncState>;
    return {
      ownerUserId:
        typeof parsed.ownerUserId === "string" ? parsed.ownerUserId : undefined,
      lastPulledSeq:
        typeof parsed.lastPulledSeq === "number" ? parsed.lastPulledSeq : 0,
      lastSyncedAt:
        typeof parsed.lastSyncedAt === "number" ? parsed.lastSyncedAt : undefined,
    };
  } catch {
    return EMPTY;
  }
}

export function writeSyncState(
  changes: Partial<SyncState>,
  dbName = currentDbName(),
): SyncState {
  const next = { ...readSyncState(dbName), ...changes };
  try {
    window.localStorage.setItem(stateKey(dbName), JSON.stringify(next));
  } catch {
    // storage unavailable — sync will re-derive; never fatal
  }
  return next;
}

/** Forget a book's account binding and cursor — it returns to local-only. */
export function clearSyncState(dbName = currentDbName()): void {
  try {
    window.localStorage.removeItem(stateKey(dbName));
  } catch {
    // storage unavailable — nothing to clear
  }
}

/**
 * Whether this book belongs to an account. Purge consults this: a
 * synced book only hard-deletes tombstones the server has acknowledged
 * (`_dirty` cleared); an unsynced book purges as it always has.
 */
export function syncAdopted(): boolean {
  return !!readSyncState().ownerUserId;
}
