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
import { ensureFolder, upsertFile, DriveTokenRevoked } from "@/lib/drive-client";
import type { BackupStatusSummary } from "@/lib/sync-wire";

const REFRESH_TOKEN_META = "drive:refreshToken";
const ACCESS_TOKEN_META = "drive:accessToken"; // { token, expiresAt }
const FOLDER_META = "drive:folderId";
const FILES_META = "drive:fileIds"; // { json, years: { "2026": id } }
const LAST_DELIVERY_META = "drive:lastDeliveryAt";

const MIN_DELIVERY_GAP_MS = 60 * 60 * 1000; // at most hourly

interface FileIds {
  json: string | null;
  years: Record<string, string>;
}

let delivering = false;

/** Adopt the refresh token minted by the connect consent; the server forgets it. */
export async function adoptDriveToken(): Promise<boolean> {
  const response = await fetch("/api/backup/adopt", { method: "POST" });
  if (!response.ok) return false;
  const data = (await response.json()) as { refreshToken: string };
  await setMeta(REFRESH_TOKEN_META, data.refreshToken);
  await deleteMeta(ACCESS_TOKEN_META);
  return true;
}

export async function hasDriveToken(): Promise<boolean> {
  return !!(await getMeta<string>(REFRESH_TOKEN_META));
}

async function accessToken(): Promise<string> {
  const cached = await getMeta<{ token: string; expiresAt: number }>(
    ACCESS_TOKEN_META,
  );
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const refreshToken = await getMeta<string>(REFRESH_TOKEN_META);
  if (!refreshToken) throw new DriveTokenRevoked("no refresh token on device");

  const response = await fetch("/api/backup/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (response.status === 401) {
    await deleteMeta(REFRESH_TOKEN_META);
    throw new DriveTokenRevoked("grant revoked");
  }
  if (!response.ok) throw new Error(`refresh ${response.status}`);
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

/** The full delivery: folder, archive JSON, per-year Markdown, ledger. */
export async function deliverBackup(): Promise<void> {
  const token = await accessToken();

  const book = sortNewestFirst(
    (await db.snippets.toArray()).filter(notDeleted),
  );
  const folderId = await ensureFolder(
    token,
    (await getMeta<string>(FOLDER_META)) ?? null,
  );
  await setMeta(FOLDER_META, folderId);

  const ids = (await getMeta<FileIds>(FILES_META)) ?? { json: null, years: {} };

  ids.json = await upsertFile(token, {
    knownId: ids.json,
    name: "Snippets archive.json",
    parentId: folderId,
    mimeType: "text/plain",
    body: renderArchiveJSON(book, new Date()),
  });

  const years = new Set([
    ...book.map((s) => s.day.slice(0, 4)).filter((y) => y.length === 4),
    ...Object.keys(ids.years),
  ]);
  for (const year of [...years].sort()) {
    const yearBook = book.filter((s) => s.day.startsWith(year));
    ids.years[year] = await upsertFile(token, {
      knownId: ids.years[year] ?? null,
      name: `Snippets ${year}.md`,
      parentId: folderId,
      mimeType: "text/plain",
      body: renderMarkdown(yearBook, `Snippets ${year}`),
    });
  }
  await setMeta(FILES_META, ids);
  await setMeta(LAST_DELIVERY_META, Date.now());

  // the ledger takes the device's word; the watchdog reads it
  await fetch("/api/backup/delivered", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seq: readSyncState().lastPulledSeq }),
  }).catch(() => {});
}

/**
 * Called after each settled sync cycle. Delivers when connected, the
 * book has moved past the ledger, and the last delivery isn't fresh.
 * Failures surface through the ledger (state stays stale → Settings
 * line + watchdog email), never a dialog.
 */
export async function maybeDeliverBackup(
  backup: BackupStatusSummary | null,
): Promise<void> {
  if (delivering) return;
  if (!backup || backup.state === "disconnected") return;
  if (!(await hasDriveToken())) return;

  const last = (await getMeta<number>(LAST_DELIVERY_META)) ?? 0;
  if (Date.now() - last < MIN_DELIVERY_GAP_MS) return;

  delivering = true;
  try {
    await deliverBackup();
  } catch {
    // the ledger stays stale; Settings and the watchdog carry the news
  } finally {
    delivering = false;
  }
}

/** On disconnect: drop the device-held tokens too. */
export async function forgetDriveTokens(): Promise<void> {
  await deleteMeta(REFRESH_TOKEN_META);
  await deleteMeta(ACCESS_TOKEN_META);
}
