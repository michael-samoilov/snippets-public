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
import { db, getMeta, setWriteNotifier, reencryptSweep } from "@/lib/db";
import { bumpClock, incomingWins, type MergeSide } from "@/lib/merge";
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
  needsReseal,
  toWireChange,
  KeyMismatchError,
  LockedError,
  type BackupStatusSummary,
  type PullResponse,
  type PushResponse,
  type StatusResponse,
} from "@/lib/sync-wire";
import { getBookKey, refreshEnrollment, clearLocalKey } from "@/lib/e2e";
import { maybeDeliverBackup } from "@/lib/backup-client";
import type { Snippet } from "@/lib/types";

const PUSH_BATCH = 200;
const MAX_BATCHES_PER_CYCLE = 50;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

// How often to poll while the app is merely OPEN and idle — the safety net
// that catches an edit made on ANOTHER device you happen to have open at the
// same moment. Every real trigger (open, write, tab-focus, back-online) syncs
// at once, so this can be lazy. It is set well past Neon's 5-min scale-to-zero
// window on purpose: a shorter interval re-wakes the database before it can
// nap and keeps a free-tier compute burning ~24/7 for an idle tab. At 15 min
// the compute sleeps ~two-thirds of the time. Do NOT shorten it back toward a
// minute without weighing that compute cost.
const IDLE_POLL_MS = 15 * 60 * 1000;

export interface SyncStatus {
  phase: "idle" | "syncing" | "offline" | "error" | "signedOut";
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
  /** signed in but not yet enrolled in encryption — sync waits (never
      pushes) until a passphrase is set; capture is unaffected */
  needsSetup: boolean;
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
  needsSetup: false,
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
  needsSetup: false,
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

/** The server refused a push because the account isn't enrolled in
    encryption (a stale client pushing plaintext gets this too). Not a
    transient snag — retrying identically can never succeed. */
class EncryptionRequired extends Error {}

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
    // The on-device book key — not the server — decides whether the
    // book moves at all. Encryption is required: without a key on this
    // device there is NO push and NO pull, only a loud pause. The
    // plaintext code path does not exist (pushAll/pullAll take the key
    // as a required argument), so no server answer — by fault or by
    // malice — can coax a plaintext upload out of this client.
    const key = await getBookKey();
    if (key) {
      setStatus({ locked: false, needsSetup: false });
      await maybeAadSweep();
      await pushAll(key);
      await pullAll(key);
    } else {
      // No key on this device. Either an enrolled account missing its
      // key (→ locked; Settings shows the unlock), an account that has
      // never set a passphrase (→ needsSetup; the welcome step and
      // Settings both lead to enrollment), or we can't tell — and then
      // we refuse to guess and retry later. All three pause the book;
      // none of them block capture.
      const enrolled = await refreshEnrollment();
      if (enrolled === "unknown")
        throw new Error("enrollment unconfirmed — the book stays paused");
      // the calendar's letters say how much waits behind the pause —
      // the status endpoint needs no key, so the counts are safe to
      // fetch even though the book itself must not move
      setStatus({
        phase: "idle",
        locked: enrolled === true,
        needsSetup: enrolled === false,
      });
      try {
        await refreshCounts();
      } catch {}
      return;
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
      // session gone (expired, signed out elsewhere) — say so, or pending
      // writes would pile up under an unexplained count. locked is a claim
      // about the signed-in account; without a session it can't be verified,
      // and the surfaces it drives (the calendar's locked letter, the
      // Settings unlock form) have nowhere to lead — so it clears here
      setStatus({ phase: "signedOut", locked: false, needsSetup: false });
      return;
    }
    if (error instanceof LockedError) {
      setStatus({ phase: "idle", locked: true });
      return;
    }
    if (error instanceof KeyMismatchError) {
      // this device's key no longer opens the account (re-sealed under a
      // new key elsewhere, or a format-3 envelope whose cleartext fields
      // were tampered with). The key here only guards the wire — local
      // entries are stored plainly — so dropping it is safe, and it turns
      // a permanent "retrying…" wedge into the locked state, whose unlock
      // form takes the CURRENT passphrase.
      await clearLocalKey().catch(() => {});
      setStatus({ phase: "idle", locked: true });
      return;
    }
    if (error instanceof EncryptionRequired) {
      // the server refused the push pending enrollment — surface the
      // needs-setup pause and do NOT schedule a retry: an identical
      // retry can never succeed, only enrollment can.
      setStatus({ phase: "idle", needsSetup: true });
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

/**
 * One-time per-device sweep to the AAD-bound format: re-dirty + re-clock
 * the whole book so its next pushes re-seal every row as format 3. Runs
 * once per database (meta flag), and reencryptSweep sets the same flag
 * itself — so a fresh enrollment never sweeps twice. On a brand-new
 * device the book is still empty when this runs (flag set on nothing),
 * and the pull rule below re-seals older rows as they arrive instead.
 */
async function maybeAadSweep(): Promise<void> {
  if (await getMeta<number>("e2e:aadSweepDone")) return;
  await reencryptSweep();
}

async function pushAll(key: CryptoKey): Promise<void> {
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
    if (response.status === 409) throw new EncryptionRequired();
    if (!response.ok) throw new Error(`push ${response.status}`);
    const data = (await response.json()) as PushResponse;

    setStatus({
      skewed: Math.abs(data.serverNow - Date.now()) > CLOCK_SKEW_MS,
    });

    // decrypt superseded rows BEFORE the transaction — Dexie
    // transactions die on any foreign await (crypto included). The same
    // re-seal rule as the pull applier rides the adoption: a winning
    // server row still in an older format adopts DIRTY with a fresh
    // clock, so its own next push re-seals it as format 3 — otherwise
    // this third apply-branch would let a plaintext row rest on the
    // server forever, exactly as the pull loop's contested branch did.
    const adopted = new Map<string, Snippet>();
    for (const result of data.results) {
      if (result.outcome !== "superseded") continue;
      const snippet = await fromWireRow(result.row, key);
      adopted.set(
        result.id,
        needsReseal(result.row)
          ? { ...snippet, _dirty: 1, updatedAt: bumpClock(snippet.updatedAt) }
          : snippet,
      );
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

async function pullAll(key: CryptoKey): Promise<void> {
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
          // One decision: a clean local row has no claim, so the incoming
          // row takes the slot; a dirty one contests via the shared merge.
          // A dirty row that loses keeps waiting for its own push.
          const localSide: MergeSide | null =
            local && local._dirty === 1
              ? { updatedAt: local.updatedAt, deletedAt: local.deletedAt ?? null }
              : null;
          const incomingSide: MergeSide = {
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          };
          if (localSide && !incomingWins(localSide, incomingSide)) continue;
          // One apply: a row still resting on the server in an older format
          // (plaintext 1 or AAD-less 2) stores dirty with a fresh clock, so
          // its own next push re-seals it as format 3. Content is unchanged,
          // so the bump is LWW-safe, and the rule is idempotent — the
          // re-pushed row arrives back as format 3 and rests clean. The rule
          // rides the row, not the branch: it used to live on the clean
          // branch only, so a dirty local row that LOST to a legacy server
          // row adopted it clean — and a plaintext row could rest on the
          // server forever on a device that believed it had converged.
          await db.snippets.put(
            needsReseal(row)
              ? {
                  ...snippet,
                  _dirty: 1,
                  updatedAt: bumpClock(snippet.updatedAt),
                }
              : snippet,
          );
        }
      });
      // cursor advances only after the batch's transaction commits
      writeSyncState({ lastPulledSeq: data.nextCursor });
    }

    if (!data.hasMore) break;
  }

  // rows re-dirtied by the re-seal rule wait for a push, and this cycle's
  // push already ran — queue one more cycle so the book converges on
  // format 3 now rather than at the next natural trigger
  if (await db.snippets.where("_dirty").equals(1).count()) requestSync();
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

// `disableEncryption` used to live here. It was deleted deliberately —
// encryption is required, and a supported path that re-pushes the book
// as plaintext would contradict both the server (which refuses format 1)
// and the privacy page (whose "we cannot read your entries" depends on
// no such path existing). Don't reintroduce it.

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
    locked: false,
    needsSetup: false,
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
  }, IDLE_POLL_MS);

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
