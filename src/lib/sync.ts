"use client";

/**
 * The client sync engine — a small sequential state machine layered
 * on top of the device's own copy, per the constitution: capture
 * never waits on it, and the app is whole without it.
 *
 * One cycle, always in this order, never concurrent (a Web Lock keeps
 * it to one tab):
 *
 *   push  — send dirty rows; on ack, clear `_dirty` only if the row
 *           hasn't been edited mid-flight (compare-and-clear — the
 *           no-lost-writes core). A push the server's copy beats
 *           returns that copy, and we adopt it: the server's verdict
 *           is final.
 *   pull  — walk the change feed from the stored cursor. Clean rows
 *           mirror the server verbatim; dirty rows contest via the
 *           shared merge and, if they win locally, stay dirty to be
 *           arbitrated at their own push.
 *   count — refresh the trust numbers (device count vs server count).
 *
 * Every failure lands in a visible status — never a silent stall.
 */
import { useSyncExternalStore } from "react";
import { db, setWriteNotifier, reencryptSweep } from "@/lib/db";
import { incomingWins, type MergeSide } from "@/lib/merge";
import {
  clearSyncState,
  currentDbName,
  dbNameForUser,
  readSyncState,
  setDbPointer,
  writeSyncState,
} from "@/lib/sync-state";
import {
  fromWireRow,
  toWireChange,
  LockedError,
  type BackupStatusSummary,
  type PullResponse,
  type PushResponse,
  type StatusResponse,
} from "@/lib/sync-wire";
import {
  getBookKey,
  refreshEnrollment,
  clearLocalKey,
  deleteServerKeys,
} from "@/lib/e2e";
import { maybeDeliverBackup } from "@/lib/backup-client";
import type { Snippet } from "@/lib/types";

const PUSH_BATCH = 200;
const MAX_BATCHES_PER_CYCLE = 50;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface SyncStatus {
  phase: "idle" | "syncing" | "offline" | "error";
  lastSyncedAt: number | null;
  pendingCount: number;
  localCount: number | null;
  serverCount: number | null;
  /** this device's clock disagrees with the server's by > 5 minutes */
  skewed: boolean;
  /** the Drive backup ledger, as of the last status fetch */
  backup: BackupStatusSummary | null;
  /** the account is end-to-end encrypted and this device holds no key */
  locked: boolean;
}

// ── status store (useSyncExternalStore, as settings.ts does) ────

let status: SyncStatus = {
  phase: "idle",
  lastSyncedAt: readInitialSyncedAt(),
  pendingCount: 0,
  localCount: null,
  serverCount: null,
  skewed: false,
  backup: null,
  locked: false,
};
const listeners = new Set<() => void>();

function readInitialSyncedAt(): number | null {
  if (typeof window === "undefined") return null;
  return readSyncState().lastSyncedAt ?? null;
}

function setStatus(changes: Partial<SyncStatus>): void {
  status = { ...status, ...changes };
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SERVER_SNAPSHOT: SyncStatus = {
  phase: "idle",
  lastSyncedAt: null,
  pendingCount: 0,
  localCount: null,
  serverCount: null,
  skewed: false,
  backup: null,
  locked: false,
};

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => SERVER_SNAPSHOT,
  );
}

// ── account binding ─────────────────────────────────────────────

/**
 * Attach this device's book to the signed-in account. The first
 * account to sign in adopts the local book (its rows are already
 * dirty, so the first cycle uploads the whole thing and union-merges
 * with whatever the server holds). A *different* account gets its own
 * database — books are never merged across accounts — which requires
 * a reload, since the Dexie handle is a module-level singleton.
 */
export function ensureBinding(userId: string): void {
  const name = currentDbName();
  const state = readSyncState(name);
  if (state.ownerUserId === userId) return;

  if (!state.ownerUserId) {
    writeSyncState({ ownerUserId: userId, lastPulledSeq: 0 }, name);
    return;
  }

  const target = dbNameForUser(userId);
  if (readSyncState(target).ownerUserId !== userId) {
    writeSyncState({ ownerUserId: userId, lastPulledSeq: 0 }, target);
  }
  setDbPointer(target);
  window.location.reload();
}

// ── the engine ──────────────────────────────────────────────────

let running = false;
let queued = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

class SignedOut extends Error {}

export function requestSync(): void {
  if (typeof navigator === "undefined") return;
  if (!readSyncState().ownerUserId) return; // unadopted — nothing to do
  if (!navigator.onLine) {
    setStatus({ phase: "offline" });
    return;
  }
  if (running) {
    queued = true;
    return;
  }
  running = true;
  void navigator.locks
    .request(
      `snippets-sync:${currentDbName()}`,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) return; // another tab carries it
        await runCycle();
      },
    )
    .finally(() => {
      running = false;
      if (queued) {
        queued = false;
        requestSync();
      }
    });
}

async function runCycle(): Promise<void> {
  setStatus({ phase: "syncing" });
  try {
    // The on-device book key — not the server — decides whether we
    // encrypt. If this device holds a key, every wire write is sealed,
    // full stop: a server that reports "not enrolled" (by fault or by
    // malice) can never coax a plaintext upload out of a sealed book.
    const key = await getBookKey();
    if (key) {
      setStatus({ locked: false });
      await pushAll(key);
      await pullAll(key);
    } else {
      // No key on this device. Either an enrolled account missing its
      // key (→ locked, pause loudly; Settings shows the unlock), a
      // plaintext account (→ sync in the clear), or we can't tell. When
      // we can't tell, we refuse to guess: a plaintext push to what
      // might be a sealed account would leak, so retry rather than risk
      // it. Capture is never blocked either way.
      const enrolled = await refreshEnrollment();
      if (enrolled === "unknown")
        throw new Error("enrollment unconfirmed — refusing a plaintext push");
      if (enrolled) {
        setStatus({ phase: "idle", locked: true });
        return;
      }
      setStatus({ locked: false });
      await pushAll(undefined);
      await pullAll(undefined);
    }
    await refreshCounts();
    const now = Date.now();
    writeSyncState({ lastSyncedAt: now });
    retryAttempt = 0;
    setStatus({ phase: "idle", lastSyncedAt: now });
    // the book is settled on the server — a fresh copy can go to Drive
    void maybeDeliverBackup(status.backup);
  } catch (error) {
    if (error instanceof SignedOut) {
      // session gone (expired, signed out elsewhere) — not an error state
      setStatus({ phase: "idle" });
      return;
    }
    if (error instanceof LockedError) {
      setStatus({ phase: "idle", locked: true });
      return;
    }
    setStatus({
      phase:
        typeof navigator !== "undefined" && !navigator.onLine
          ? "offline"
          : "error",
    });
    scheduleRetry();
  }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  const delay = Math.min(5_000 * 2 ** retryAttempt, 5 * 60_000);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    requestSync();
  }, delay);
}

async function pushAll(key?: CryptoKey): Promise<void> {
  for (let batch = 0; batch < MAX_BATCHES_PER_CYCLE; batch++) {
    const dirty = await db.snippets
      .where("_dirty")
      .equals(1)
      .limit(PUSH_BATCH)
      .toArray();
    if (dirty.length === 0) return;

    const changes = await Promise.all(dirty.map((s) => toWireChange(s, key)));
    const response = await fetch("/api/sync/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    if (response.status === 401) throw new SignedOut();
    if (!response.ok) throw new Error(`push ${response.status}`);
    const data = (await response.json()) as PushResponse;

    setStatus({
      skewed: Math.abs(data.serverNow - Date.now()) > CLOCK_SKEW_MS,
    });

    // decrypt superseded rows BEFORE the transaction — Dexie
    // transactions die on any foreign await (crypto included)
    const adopted = new Map<string, Snippet>();
    for (const result of data.results) {
      if (result.outcome === "superseded")
        adopted.set(result.id, await fromWireRow(result.row, key));
    }

    const pushed = new Map(dirty.map((s) => [s.id, s]));
    let progressed = false;
    await db.transaction("rw", db.snippets, async () => {
      for (const result of data.results) {
        const sent = pushed.get(result.id);
        if (!sent) continue;
        const current = await db.snippets.get(result.id);
        // edited mid-flight — the newer edit stays dirty for next cycle
        if (!current || current.updatedAt !== sent.updatedAt) continue;
        progressed = true;
        if (result.outcome === "applied") {
          await db.snippets.update(result.id, { _dirty: 0 });
        } else {
          // the server's copy won; adopt it
          const row = adopted.get(result.id);
          if (row) await db.snippets.put(row);
        }
      }
    });

    if (!progressed && dirty.length === PUSH_BATCH) {
      // nothing cleared and a full batch remains — don't spin
      throw new Error("push made no progress");
    }
    if (dirty.length < PUSH_BATCH) return;
  }
}

async function pullAll(key?: CryptoKey): Promise<void> {
  for (;;) {
    const cursor = readSyncState().lastPulledSeq;
    const response = await fetch(
      `/api/sync/pull?cursor=${cursor}&limit=500`,
    );
    if (response.status === 401) throw new SignedOut();
    if (!response.ok) throw new Error(`pull ${response.status}`);
    const data = (await response.json()) as PullResponse;

    if (data.rows.length) {
      // decode (and decrypt) BEFORE the transaction — Dexie transactions
      // die on any foreign await, crypto included
      const prepared = await Promise.all(
        data.rows.map(async (row) => ({
          row,
          snippet: await fromWireRow(row, key),
        })),
      );
      await db.transaction("rw", db.snippets, async () => {
        for (const { row, snippet } of prepared) {
          const local = await db.snippets.get(row.id);
          if (!local || local._dirty !== 1) {
            // clean rows mirror the server verbatim
            await db.snippets.put(snippet);
            continue;
          }
          const localSide: MergeSide = {
            updatedAt: local.updatedAt,
            deletedAt: local.deletedAt ?? null,
            enriched: local.enriched,
          };
          const incomingSide: MergeSide = {
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
            enriched: snippet.enriched,
          };
          if (incomingWins(localSide, incomingSide)) {
            await db.snippets.put(snippet);
          }
          // else: the dirty local row stays; its own push will settle it
        }
      });
      // cursor advances only after the batch's transaction commits
      writeSyncState({ lastPulledSeq: data.nextCursor });
    }

    if (!data.hasMore) return;
  }
}

async function refreshCounts(): Promise<void> {
  const [pendingCount, localCount] = await Promise.all([
    db.snippets.where("_dirty").equals(1).count(),
    db.snippets.filter((s: Snippet) => s.deletedAt === undefined).count(),
  ]);

  const response = await fetch("/api/sync/status");
  if (response.status === 401) throw new SignedOut();
  if (!response.ok) throw new Error(`status ${response.status}`);
  const data = (await response.json()) as StatusResponse;

  setStatus({
    pendingCount,
    localCount,
    serverCount: data.entryCount,
    backup: data.backup,
  });
}

/**
 * The out-of-step escape hatch: rewind the cursor and re-walk the
 * whole feed. Pull-apply and push are idempotent under the merge, so
 * a full reconcile is always safe.
 */
export async function reconcile(): Promise<void> {
  writeSyncState({ lastPulledSeq: 0 });
  requestSync();
}

/**
 * Turn off end-to-end encryption. Order is chosen so an interruption
 * can never strand sealed rows the server has no key for:
 *   1. pull the whole book down WITH the key (every row now plaintext
 *      on this device — encryption only ever lived at the wire);
 *   2. mark it all dirty + bump, and push it back as PLAINTEXT (a
 *      no-key push writes format 1), overwriting every sealed server row;
 *   3. only then drop the server's wrapped keys, and finally
 *   4. forget the on-device key.
 * If the tab dies between 2 and 3, the keys still exist and the book
 * is already plaintext — re-running is a safe no-op. Requires the key
 * to be present (you must be unlocked to read your own book).
 */
export async function disableEncryption(): Promise<void> {
  const key = await getBookKey();
  if (!key) throw new LockedError();
  await navigator.locks.request(
    `snippets-sync:${currentDbName()}`,
    async () => {
      setStatus({ phase: "syncing" });
      writeSyncState({ lastPulledSeq: 0 }); // re-walk the whole feed
      await pullAll(key); // decrypt every server row into local plaintext
      await reencryptSweep(); // all dirty, fresh clocks
      await pushAll(undefined); // re-push as plaintext, overwriting seals
      await deleteServerKeys();
      await clearLocalKey();
      setStatus({ phase: "idle", locked: false });
    },
  );
  requestSync();
}

/**
 * After account deletion: the book returns to local-only. Forget the
 * binding and cursor, and mark every row dirty again — the subtle but
 * essential half. Rows the old account had synced sit clean; without
 * re-dirtying them, a future sign-in (even the same person signing up
 * afresh) would upload only what changed since, and quietly strand
 * the rest of the book off the server.
 */
export async function releaseBinding(): Promise<void> {
  clearSyncState();
  await db.snippets.toCollection().modify((s) => {
    s._dirty = 1;
  });
  setStatus({
    phase: "idle",
    lastSyncedAt: null,
    serverCount: null,
    backup: null,
    skewed: false,
  });
}

// ── triggers ────────────────────────────────────────────────────

let writeDebounce: ReturnType<typeof setTimeout> | null = null;

function onLocalWrite(): void {
  // the pending count moves the instant something is written…
  void db.snippets
    .where("_dirty")
    .equals(1)
    .count()
    .then((pendingCount) => setStatus({ pendingCount }))
    .catch(() => {});
  // …the network follows a beat later
  if (writeDebounce) clearTimeout(writeDebounce);
  writeDebounce = setTimeout(() => {
    writeDebounce = null;
    requestSync();
  }, 3_000);
}

/**
 * Wire the engine to a signed-in session. Returns the teardown.
 * Called from the providers' SyncManager whenever the session lands.
 */
export function startSync(userId: string): () => void {
  ensureBinding(userId); // may reload on account switch
  setWriteNotifier(onLocalWrite);
  requestSync();

  const onOnline = () => requestSync();
  const onVisible = () => {
    if (document.visibilityState === "visible") requestSync();
  };
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  const tick = window.setInterval(() => {
    if (document.visibilityState === "visible") requestSync();
  }, 60_000);

  return () => {
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(tick);
    setWriteNotifier(null);
    if (writeDebounce) {
      clearTimeout(writeDebounce);
      writeDebounce = null;
    }
  };
}
