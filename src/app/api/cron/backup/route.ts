/**
 * The daily watchdog (vercel.json schedules it; Vercel sends
 * `Authorization: Bearer $CRON_SECRET`). It delivers nothing — the
 * server holds no Drive tokens anymore. It reads the ledger and, for
 * any connected book that has moved past its last delivery for
 * several days, sends one quiet email per silence ("open Snippets to
 * refresh your Drive copy"). Also the tombstone scrubber: content of
 * rows deleted more than 30 days ago is nulled; the rows themselves
 * stay forever — that permanence is what makes resurrection
 * impossible.
 */
import { and, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { format } from "date-fns";
import { serverDb, schema } from "@/server/db";
import { sendEmail } from "@/server/email";

export const runtime = "nodejs";
export const maxDuration = 300;

const TOMBSTONE_SCRUB_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const STALE_AFTER_DAYS = 3;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
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

  // stale = connected, the book moved past the ledger, and no delivery
  // has landed for STALE_AFTER_DAYS
  const staleBefore = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 3600 * 1000);
  const stale = await serverDb
    .select({
      userId: schema.backupStatus.userId,
      lastBackedUpSeq: schema.backupStatus.lastBackedUpSeq,
      lastSuccessAt: schema.backupStatus.lastSuccessAt,
      failureNotifiedAt: schema.backupStatus.failureNotifiedAt,
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
    const since = row.lastSuccessAt
      ? format(row.lastSuccessAt, "MMMM d")
      : "it was connected";
    await sendEmail({
      to: row.email,
      subject: "Your Snippets Drive copy is falling behind",
      text: [
        `Your book has new entries, but nothing has been delivered to your Google Drive since ${since}.`,
        "",
        "Deliveries run from your own devices — open Snippets on one where you've connected Google Drive and the copy refreshes itself.",
        "Any signed-in device can deliver: open Settings → Backup on the device you use and tap “Back up from this device too.”",
      ].join("\n"),
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

  return Response.json({ watched: stale.length, notified });
}
