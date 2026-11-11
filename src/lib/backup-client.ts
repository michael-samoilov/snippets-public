"use client";

/**
 * Drive delivery, from the device that holds the words. Runs after a
 * settled sync cycle: render the book (plaintext, from the local
 * decrypted copy — readable files in the writer's own Drive are the
 * entire point), upload in place, report to the ledger. The server
 * participates only as a stateless token exchanger and a ledger; it
 * keeps no token and no plaintext.
 *
 * Freshness contract: at most one writing session stale — entries
 * only change while someone is here, and delivery follows each sync.
 * The watchdog cron emails if the ledger goes quiet while the book
 * moves.
 */
import { db, getMeta, setMeta, deleteMeta, notDeleted } from "@/lib/db";
import { readSyncState } from "@/lib/sync-state";
import { renderArchiveJSON, renderMarkdown, sortNewestFirst } from "@/lib/render-book";
import {
  ensureFolder,
  upsertFile,
  DriveError,
  NetworkError,
  fetchOrNetworkError,
} from "@/lib/drive-client";
import { yearsToUpload } from "@/lib/backup-shared";
import type { BackupStatusSummary } from "@/lib/sync-wire";

const REFRESH_TOKEN_META = "drive:refreshToken";
const ACCESS_TOKEN_META = "drive:accessToken"; // { token, expiresAt }
const FOLDER_META = "drive:folderId";
const FILES_META = "drive:fileIds"; // { json, years: { "2026": id } }
const LAST_DELIVERY_META = "drive:lastDeliveryAt";
const YEAR_HASHES_META = "drive:yearHashes"; // { "2026": sha-256 of the last upload }

const MIN_DELIVERY_GAP_MS = 60 * 60 * 1000; // at most hourly

interface FileIds {
  json: string | null;
  years: Record<string, string>;
}

let delivering = false;
let adoptSettled = false;

/**
 * Adopt the refresh token minted by the connect consent; the server
 * forgets it. Tri-state on purpose: "none" is the server's definitive
 * "another device already adopted it" (a 404), which is worth
 * remembering for the session; "transient" is a network/server hiccup
 * that must NOT latch, or one blip would stop this device delivering
 * until the next full page load.
 */
export async function adoptDriveToken(): Promise<
  "adopted" | "none" | "transient"
> {
  const response = await fetch("/api/backup/adopt", { method: "POST" });
  if (response.status === 404) return "none";
  if (!response.ok) return "transient";
  const data = (await response.json()) as { refreshToken: string };
  await setMeta(REFRESH_TOKEN_META, data.refreshToken);
  await deleteMeta(ACCESS_TOKEN_META);
  return "adopted";
}

/** The token exchange failed; the message is the ledger's canonical line. */
class RefreshError extends Error {}

/** The Snippets session ended mid-delivery; sync says so, not the ledger. */
class SessionEnded extends Error {}

/**
 * The ledger's one line for a failure: the source, then Google's own
 * code where there is one. classifyBackupError (backup-shared) reads
 * it on the server, so Settings and the email name the cause that was
 * observed here and never a guess. Anything that isn't a Google answer
 * or a missing one (NetworkError, typed at the fetch) broke on this
 * device: storage, a bug. It says "error:" and is never blamed on Google.
 */
function failureLine(error: unknown): string {
  if (
    error instanceof DriveError ||
    error instanceof RefreshError ||
    error instanceof NetworkError
  )
    return error.message;
  return error instanceof Error
    ? `error: ${error.name}: ${error.message}`
    : `error: ${String(error)}`;
}

/**
 * Tell the ledger a delivery failed, so every device's Settings can
 * say why (and the watchdog email has company). Content-free: only
 * the failure line travels. Best-effort — a failure to report a
 * failure just leaves the ledger stale, which the staleness check
 * still catches.
 */
async function reportBackupFailure(error: unknown): Promise<void> {
  await fetch("/api/backup/failed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ error: failureLine(error).slice(0, 500) }),
  }).catch(() => {});
}

export async function hasDriveToken(): Promise<boolean> {
  return !!(await getMeta<string>(REFRESH_TOKEN_META));
}

/** The Drive refresh token this device holds, for account deletion to revoke. */
export async function deviceDriveToken(): Promise<string | undefined> {
  return getMeta<string>(REFRESH_TOKEN_META);
}

async function accessToken(): Promise<string> {
  const cached = await getMeta<{ token: string; expiresAt: number }>(
    ACCESS_TOKEN_META,
  );
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const refreshToken = await getMeta<string>(REFRESH_TOKEN_META);
  if (!refreshToken) throw new RefreshError("no refresh token on device");

  const response = await fetchOrNetworkError("/api/backup/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    // SAFETY: all optional and only interpolated; an unexpected body
    // still yields a "refresh <status> -:" line the classifier reads
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      google?: string;
      description?: string;
    };
    // only Google's invalid_grant ends the grant; a 401 for an expired
    // Snippets session must not throw away a token that still works
    if (body.error === "revoked") await deleteMeta(REFRESH_TOKEN_META);
    else if (response.status === 401) throw new SessionEnded();
    throw new RefreshError(
      `refresh ${response.status} ${body.google ?? body.error ?? "-"}: ${body.description ?? ""}`,
    );
  }
  const data = (await response.json()) as {
    accessToken: string;
    expiresIn: number;
  };
  await setMeta(ACCESS_TOKEN_META, {
    token: data.accessToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
  });
  return data.accessToken;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One delivery: folder, per-year Markdown, archive JSON, ledger.
 * `full` rewrites every year (the hourly delivery, which sets a
 * hand-edited or deleted file right again); otherwise only the years
 * whose Markdown changed since their last upload go. Newest year
 * first, so a delivery that iOS cuts short has already landed the
 * year that holds the new entry. Returns the seq it delivered.
 */
export async function deliverBackup(full: boolean): Promise<number> {
  const token = await accessToken();

  // the seq BEFORE the snapshot: every row up to it is in the book read
  // next. Read after the uploads, it once covered entries saved during
  // the delivery, so the ledger called them delivered when they weren't
  const seq = readSyncState().lastPulledSeq;
  const book = sortNewestFirst(
    (await db.snippets.toArray()).filter(notDeleted),
  );
  const knownFolder = (await getMeta<string>(FOLDER_META)) ?? null;
  const folderId = await ensureFolder(token, knownFolder);
  await setMeta(FOLDER_META, folderId);
  // a new folder holds none of the old files: every year goes
  const rewriteAll = full || folderId !== knownFolder;

  const ids = (await getMeta<FileIds>(FILES_META)) ?? { json: null, years: {} };
  const uploaded = (await getMeta<Record<string, string>>(YEAR_HASHES_META)) ?? {};

  const years = new Set([
    ...book.map((s) => s.day.slice(0, 4)).filter((y) => y.length === 4),
    ...Object.keys(ids.years),
  ]);
  const markdown = new Map(
    [...years].map((year) => [
      year,
      renderMarkdown(
        book.filter((s) => s.day.startsWith(year)),
        `Snippets ${year}`,
      ),
    ]),
  );
  const hashes: Record<string, string> = {};
  for (const [year, body] of markdown) hashes[year] = await sha256(body);
  // a year without a known file id has to go, whatever its hash says
  const known = Object.fromEntries(
    Object.entries(uploaded).filter(([year]) => ids.years[year]),
  );

  for (const year of yearsToUpload(hashes, known, rewriteAll)) {
    ids.years[year] = await upsertFile(token, {
      knownId: ids.years[year] ?? null,
      name: `Snippets ${year}.md`,
      parentId: folderId,
      mimeType: "text/plain",
      body: markdown.get(year) ?? "",
    });
    uploaded[year] = hashes[year];
    // saved per file: a delivery cut short keeps what it did land
    await setMeta(FILES_META, ids);
    await setMeta(YEAR_HASHES_META, uploaded);
  }

  ids.json = await upsertFile(token, {
    knownId: ids.json,
    name: "Snippets archive.json",
    parentId: folderId,
    mimeType: "text/plain",
    body: renderArchiveJSON(book, new Date()),
  });
  await setMeta(FILES_META, ids);
  await setMeta(LAST_DELIVERY_META, Date.now());

  // the ledger takes the device's word; the watchdog reads it
  await fetch("/api/backup/delivered", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seq }),
  }).catch(() => {});
  return seq;
}

/**
 * Called after each settled sync cycle. Delivers when connected and
 * either the book has moved past the ledger or the last delivery is
 * over an hour old (that hourly one rewrites every file, which is what
 * sets a hand-edited Drive file right again). Failures surface through
 * the ledger (Settings line + watchdog email), never a dialog. The
 * outcome tells the sync engine whether the ledger changed under
 * Settings, and "outrun" whether newer entries arrived mid-delivery
 * and need a delivery of their own.
 */
export async function maybeDeliverBackup(
  backup: BackupStatusSummary | null,
): Promise<"delivered" | "outrun" | "failed" | "skipped"> {
  if (delivering) return "skipped";
  if (!backup || backup.state === "disconnected") return "skipped";
  if (!(await hasDriveToken())) {
    // a device connected before delivery moved client-side (or a fresh
    // one) adopts the server-held token once; if the server has none to
    // give — already adopted on another device — this device won't
    // deliver until the writer adds it (Settings → "Back up from this
    // device too" mints it a grant of its own; every added device delivers)
    if (adoptSettled) return "skipped";
    const adoption = await adoptDriveToken().catch(
      () => "transient" as const,
    );
    if (adoption === "none") {
      adoptSettled = true; // definitive — stop asking this session
      return "skipped";
    }
    if (adoption !== "adopted") return "skipped"; // transient — ask again next cycle
  }

  // New entries never wait out the hourly gap. They used to: an entry
  // saved within the hour after a delivery stayed out of Drive until
  // the next session, so a few days away read as "Backup failing" and
  // sent the watchdog email for a working backup (2026-10-17 → 10-20).
  const last = (await getMeta<number>(LAST_DELIVERY_META)) ?? 0;
  const full = Date.now() - last >= MIN_DELIVERY_GAP_MS;
  if (!backup.behind && !full) return "skipped";

  delivering = true;
  try {
    const seq = await deliverBackup(full).catch(async (error: unknown) => {
      if (!(error instanceof DriveError && error.status === 401)) throw error;
      // Drive stopped honoring the cached access token. One fresh
      // exchange settles whether the grant itself is gone (invalid_grant)
      // before the ledger is told so
      await deleteMeta(ACCESS_TOKEN_META);
      return deliverBackup(full);
    });
    // a sync that pulled newer rows while this delivery ran skipped its
    // own (delivering was set); they go in a delivery of their own
    return readSyncState().lastPulledSeq > seq ? "outrun" : "delivered";
  } catch (error) {
    // the session ended: sync says "Signed out", and the ledger can't
    // be written without a session anyway
    if (error instanceof SessionEnded) return "skipped";
    // the ledger hears why, so Settings (on every device) and the
    // watchdog email can name the cause instead of a stale calm line
    await reportBackupFailure(error);
    return "failed";
  } finally {
    delivering = false;
  }
}

/** On disconnect: drop the device-held tokens too. */
export async function forgetDriveTokens(): Promise<void> {
  await deleteMeta(REFRESH_TOKEN_META);
  await deleteMeta(ACCESS_TOKEN_META);
}
