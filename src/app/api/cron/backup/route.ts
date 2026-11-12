/**
 * The daily watchdog (vercel.json schedules it; Vercel sends
 * `Authorization: Bearer $CRON_SECRET`). It delivers nothing — the
 * server holds no Drive tokens anymore. It reads the ledger and, for
 * any connected book that has moved past its last delivery for
 * several days, sends one quiet email per silence ("open Snippets to
 * refresh your Drive copy"). Also the tombstone scrubber: content of
 * rows deleted more than 30 days ago is nulled; the rows themselves
 * stay forever — that permanence is what makes resurrection
 * impossible. It also deletes the voice routes' day-old abuse counts
 * (src/server/speech-guard.ts). And the ops storage watchdog: if the
 * database crosses a share of the Neon free-tier cap, it emails the
 * owner (OPS_ALERT_EMAIL) so an upgrade happens before writes are
 * ever refused — never a user's concern, since capture is local-first,
 * but the owner's to act on.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { sendEmail } from "@/server/email";
import { plaintextTokenRows } from "@/server/token-encryption";
import { SPEECH_LIMIT_ROW_TTL_MS } from "@/server/speech-guard";
import { backupEmail, STALE_AFTER_DAYS } from "@/lib/backup-shared";

export const runtime = "nodejs";
export const maxDuration = 300;

const TOMBSTONE_SCRUB_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

// Neon free tier: 0.5 GB storage. Warn the owner well before the wall so
// there's room to upgrade (or prune) in hand. Runs once a day with the
// cron, so "over threshold" self-repeats daily until it's back under —
// appropriate urgency for the owner's own inbox, and no state table to keep.
const STORAGE_CAP_BYTES = 512 * 1024 * 1024;
const STORAGE_ALERT_FRACTION = 0.7;

/**
 * Constant-time check of the Authorization header. Both sides are
 * hashed first so the comparison runs on equal lengths and the time
 * taken says nothing about the secret's length or prefix.
 */
function authorized(header: string | null, secret: string): boolean {
  const digest = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(request.headers.get("authorization"), secret))
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!serverDb)
    return Response.json(
      { error: "accounts are not configured" },
      { status: 503 },
    );

  // hygiene first — one cheap statement
  const scrubBefore = Date.now() - TOMBSTONE_SCRUB_AFTER_MS;
  await serverDb
    .update(schema.snippets)
    .set({ payload: null })
    .where(
      sql`deleted_at is not null and deleted_at < ${scrubBefore} and payload is not null`,
    );

  // the voice routes' abuse counts: a row older than a day is a window
  // long ended. Best-effort: the table appears on first use, so it may
  // not exist yet.
  await serverDb
    .delete(schema.speechRateLimit)
    .where(lt(schema.speechRateLimit.windowStart, Date.now() - SPEECH_LIMIT_ROW_TTL_MS))
    .catch(() => {});

  // stale = connected, the book moved past the ledger, and no delivery
  // has landed for STALE_AFTER_DAYS
  const staleBefore = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 3600 * 1000);
  const stale = await serverDb
    .select({
      userId: schema.backupStatus.userId,
      lastBackedUpSeq: schema.backupStatus.lastBackedUpSeq,
      lastSuccessAt: schema.backupStatus.lastSuccessAt,
      failureNotifiedAt: schema.backupStatus.failureNotifiedAt,
      state: schema.backupStatus.state,
      lastError: schema.backupStatus.lastError,
      email: schema.user.email,
      maxSeq: sql<number>`coalesce((select max(server_seq) from snippets where snippets.user_id = ${schema.backupStatus.userId}), 0)`,
    })
    .from(schema.backupStatus)
    .innerJoin(schema.user, eq(schema.user.id, schema.backupStatus.userId))
    .where(
      and(
        ne(schema.backupStatus.state, "disconnected"),
        or(
          isNull(schema.backupStatus.lastSuccessAt),
          lt(schema.backupStatus.lastSuccessAt, staleBefore),
        ),
      ),
    );

  let notified = 0;
  for (const row of stale) {
    if (Number(row.maxSeq) <= row.lastBackedUpSeq) continue; // book hasn't moved
    if (row.failureNotifiedAt) continue; // one email per silence
    await sendEmail({
      to: row.email,
      ...backupEmail(row, Date.now()),
    }).catch(() => {});
    await serverDb
      .update(schema.backupStatus)
      .set({ failureNotifiedAt: new Date() })
      .where(
        and(
          eq(schema.backupStatus.userId, row.userId),
          eq(schema.backupStatus.provider, "google-drive"),
        ),
      );
    notified += 1;
  }

  // ── ops storage watchdog ────────────────────────────────────────
  // pg_database_size is the logical data size — a close, credential-free
  // proxy for Neon's billed Storage line. Best-effort: a failed check
  // never fails the cron.
  let storageBytes: number | null = null;
  let storageAlerted = false;
  const opsEmail = process.env.OPS_ALERT_EMAIL;
  try {
    const result = await serverDb.execute(
      sql`select pg_database_size(current_database()) as bytes`,
    );
    storageBytes = Number(result.rows[0]?.bytes ?? 0);
    const fraction = storageBytes / STORAGE_CAP_BYTES;
    if (opsEmail && fraction >= STORAGE_ALERT_FRACTION) {
      const pct = Math.round(fraction * 100);
      const usedMb = (storageBytes / (1024 * 1024)).toFixed(0);
      await sendEmail({
        to: opsEmail,
        subject: `Snippets database is at ${pct}% of the Neon free tier`,
        text: [
          `The database is using about ${usedMb} MB of the 512 MB free-tier cap (${pct}%).`,
          "",
          "No one is losing entries — capture is local-first and every book is copied to the writer's own Google Drive — but once the cap is hit, Neon stops accepting new writes, so sync would pause for everyone until there's room.",
          "",
          "Upgrade the Neon plan (or prune) before then. This note repeats daily while over the line.",
        ].join("\n"),
      }).catch(() => {});
      storageAlerted = true;
    }
  } catch {
    // storage check is best-effort; the rest of the cron still ran
  }

  // ── plaintext token watchdog ───────────────────────────────────
  // Every Google token at rest must be encrypted; the CHECK constraint
  // (src/server/token-encryption.ts) refuses any other write. This counts
  // what would slip past a dropped constraint, and reports the count
  // only, never a row.
  let plaintextTokens: number | null = null;
  try {
    plaintextTokens = await plaintextTokenRows(serverDb);
    if (plaintextTokens > 0) {
      console.error(`[token-watchdog] ${plaintextTokens} account rows hold a plaintext token`);
      if (opsEmail)
        await sendEmail({
          to: opsEmail,
          subject: `Snippets: ${plaintextTokens} stored Google tokens are not encrypted`,
          text: [
            `${plaintextTokens} rows in the account table hold a Google token that is not encrypted.`,
            "",
            "Every token should be encrypted at rest, and the account_tokens_encrypted constraint should refuse any other write. Check that the constraint still exists; each new server instance re-encrypts old tokens and re-adds it before its first session lookup. This note repeats daily while any are found.",
          ].join("\n"),
        }).catch(() => {});
    }
  } catch {
    // best-effort, like the storage check
  }

  return Response.json({
    watched: stale.length,
    notified,
    storageBytes,
    storageAlerted,
    plaintextTokens,
  });
}

