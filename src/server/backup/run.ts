/**
 * One user's backup, end to end: read the synced book, render the
 * archive formats, deliver to the user's own Drive, and keep the
 * ledger honest. Called from the connect route (first delivery,
 * forced) and the daily cron (only when something changed).
 *
 * Failure discipline — the whole reason this file exists:
 * - every attempt stamps the ledger, success or not;
 * - a revoked grant flips state to "disconnected" (Settings shows
 *   Reconnect); transient trouble becomes "error" and retries
 *   tomorrow;
 * - after three consecutive failures, one quiet email goes to the
 *   writer — once per failure streak, never a drumbeat.
 */
import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { format } from "date-fns";
import { serverDb, schema, type ServerDb } from "@/server/db";
import { auth } from "@/server/auth";
import { sendEmail } from "@/server/email";
import {
  renderArchiveJSON,
  renderMarkdown,
  sortNewestFirst,
} from "@/lib/render-book";
import { PAYLOAD_FORMAT_PLAIN, type SnippetPayload } from "@/lib/sync-wire";
import type { Snippet } from "@/lib/types";
import { DriveTokenRevoked, ensureFolder, upsertFile } from "./drive";

const FAILURES_BEFORE_ALERT = 3;
const CLAIM_WINDOW_MINUTES = 2;
export const PROVIDER = "google-drive";

export type BackupOutcome = "done" | "unchanged" | "claimed-elsewhere" | "failed";

export async function runBackupForUser(
  userId: string,
  options: { force?: boolean } = {},
): Promise<BackupOutcome> {
  if (!serverDb || !auth) throw new Error("accounts are not configured");
  const db = serverDb;

  // claim the run — connect and cron may race; the loser walks away
  const claimed = await db
    .update(schema.backupStatus)
    .set({ lastAttemptAt: new Date() })
    .where(
      and(
        eq(schema.backupStatus.userId, userId),
        eq(schema.backupStatus.provider, PROVIDER),
        sql`(last_attempt_at is null or last_attempt_at < now() - interval '${sql.raw(
          String(CLAIM_WINDOW_MINUTES),
        )} minutes')`,
      ),
    )
    .returning();
  if (claimed.length === 0) return "claimed-elsewhere";
  const status = claimed[0];

  try {
    const rows = await db
      .select()
      .from(schema.snippets)
      .where(eq(schema.snippets.userId, userId));

    const maxSeq = rows.reduce((m, r) => Math.max(m, r.serverSeq), 0);
    if (!options.force && maxSeq <= status.lastBackedUpSeq) return "unchanged";

    // the living book, rendered newest-first like the in-app export
    const book = sortNewestFirst(
      rows
        .filter(
          (r) =>
            r.deletedAt === null &&
            r.payload !== null &&
            r.payloadFormat === PAYLOAD_FORMAT_PLAIN,
        )
        .map((r) => ({
          ...(r.payload as SnippetPayload),
          id: r.id,
          updatedAt: r.updatedAt,
        })) as Snippet[],
    );

    // which year files need re-rendering: years touched since the last
    // delivery; a scrubbed tombstone hides its year, so re-render all
    const changed = rows.filter((r) => r.serverSeq > status.lastBackedUpSeq);
    const unknownYear = changed.some((r) => r.payload === null);
    const presentYears = new Set(book.map((s) => s.day.slice(0, 4)));
    const knownFileYears = new Set(
      Object.keys((status.mdFileIds as Record<string, string> | null) ?? {}),
    );
    const changedYears =
      options.force || unknownYear
        ? new Set([...presentYears, ...knownFileYears])
        : new Set(
            changed
              .map((r) =>
                r.payload
                  ? String((r.payload as SnippetPayload).day ?? "").slice(0, 4)
                  : "",
              )
              .filter((y) => y.length === 4),
          );

    const tokens = await auth.api
      .getAccessToken({ body: { providerId: "google", userId } })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        // a dead refresh token is a revocation, not a transient failure
        if (/invalid_grant|refresh/i.test(message))
          throw new DriveTokenRevoked(message);
        throw error;
      });
    const token = tokens.accessToken;
    if (!token) throw new DriveTokenRevoked("no access token");

    const folderId = await ensureFolder(token, status.driveFolderId);

    const jsonFileId = await upsertFile(token, {
      knownId: status.jsonFileId,
      name: "Snippets archive.json",
      parentId: folderId,
      mimeType: "application/json",
      body: renderArchiveJSON(book, new Date()),
    });

    const mdFileIds = {
      ...((status.mdFileIds as Record<string, string> | null) ?? {}),
    };
    for (const year of [...changedYears].sort()) {
      const yearBook = book.filter((s) => s.day.startsWith(year));
      mdFileIds[year] = await upsertFile(token, {
        knownId: mdFileIds[year] ?? null,
        name: `Snippets ${year}.md`,
        parentId: folderId,
        mimeType: "text/markdown",
        body: renderMarkdown(yearBook, `Snippets ${year}`),
      });
    }

    await db
      .update(schema.backupStatus)
      .set({
        state: "active",
        driveFolderId: folderId,
        jsonFileId,
        mdFileIds,
        lastBackedUpSeq: maxSeq,
        lastSuccessAt: new Date(),
        consecutiveFailures: 0,
        lastError: null,
        failureNotifiedAt: null,
      })
      .where(
        and(
          eq(schema.backupStatus.userId, userId),
          eq(schema.backupStatus.provider, PROVIDER),
        ),
      );
    return "done";
  } catch (error) {
    await recordFailure(db, userId, status, error);
    return "failed";
  }
}

async function recordFailure(
  db: ServerDb,
  userId: string,
  status: typeof schema.backupStatus.$inferSelect,
  error: unknown,
): Promise<void> {
  const revoked = error instanceof DriveTokenRevoked;
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    500,
  );
  const failures = status.consecutiveFailures + 1;

  await db
    .update(schema.backupStatus)
    .set({
      state: revoked ? "disconnected" : "error",
      consecutiveFailures: failures,
      lastError: message,
    })
    .where(
      and(
        eq(schema.backupStatus.userId, userId),
        eq(schema.backupStatus.provider, PROVIDER),
      ),
    );

  // one quiet email per failure streak — the writer hears about it
  // instead of discovering a stale archive months later
  if (failures >= FAILURES_BEFORE_ALERT && !status.failureNotifiedAt) {
    const [account] = await db
      .select({ email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    if (account?.email) {
      const since = status.lastSuccessAt
        ? format(status.lastSuccessAt, "MMMM d")
        : "they were set up";
      await sendEmail({
        to: account.email,
        subject: "Your Snippets backups aren’t going through",
        text: [
          `Backups to your Google Drive haven’t gone through since ${since}.`,
          "",
          "Your entries are safe — on your devices and on the server. Only the Drive copy is stale.",
          "Open Snippets → Settings → Backup to reconnect.",
        ].join("\n"),
      }).catch(() => {
        // the alert failing must never mask the original failure
      });
      await db
        .update(schema.backupStatus)
        .set({ failureNotifiedAt: new Date() })
        .where(
          and(
            eq(schema.backupStatus.userId, userId),
            eq(schema.backupStatus.provider, PROVIDER),
          ),
        );
    }
  }
}
