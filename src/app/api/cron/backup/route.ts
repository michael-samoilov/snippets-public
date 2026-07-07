/**
 * The daily delivery round (vercel.json schedules it; Vercel sends
 * `Authorization: Bearer $CRON_SECRET`). Users whose books changed
 * since their last delivery are served oldest-attempt-first; the loop
 * stops near the duration ceiling and tomorrow's run picks up where
 * it left off — round-robin fairness, no user starves.
 *
 * Also the tombstone scrubber: content of rows deleted more than 30
 * days ago is nulled. The row itself — id, clocks, seq — stays
 * forever; forever-tombstones are what make resurrection impossible.
 */
import { ne, sql } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { PROVIDER, runBackupForUser } from "@/server/backup/run";

export const runtime = "nodejs";
export const maxDuration = 300;

const TIME_BUDGET_MS = 240_000;
const TOMBSTONE_SCRUB_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!serverDb)
    return Response.json(
      { error: "accounts are not configured" },
      { status: 503 },
    );

  const started = Date.now();

  // hygiene first — it's one cheap statement
  const scrubBefore = Date.now() - TOMBSTONE_SCRUB_AFTER_MS;
  await serverDb
    .update(schema.snippets)
    .set({ payload: null })
    .where(
      sql`deleted_at is not null and deleted_at < ${scrubBefore} and payload is not null`,
    );

  // who needs a delivery: connected, and the book moved past the ledger
  const candidates = await serverDb
    .select({
      userId: schema.backupStatus.userId,
      lastBackedUpSeq: schema.backupStatus.lastBackedUpSeq,
      maxSeq: sql<number>`coalesce((select max(server_seq) from snippets where snippets.user_id = ${schema.backupStatus.userId}), 0)`,
    })
    .from(schema.backupStatus)
    .where(ne(schema.backupStatus.state, "disconnected"))
    .orderBy(sql`last_attempt_at asc nulls first`);

  const due = candidates.filter((c) => Number(c.maxSeq) > c.lastBackedUpSeq);

  let done = 0;
  let failed = 0;
  let deferred = 0;
  for (const candidate of due) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      deferred = due.length - done - failed;
      break;
    }
    const outcome = await runBackupForUser(candidate.userId).catch(
      () => "failed" as const,
    );
    if (outcome === "failed") failed += 1;
    else done += 1;
  }

  return Response.json({ due: due.length, done, failed, deferred });
}
