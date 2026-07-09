/**
 * The device reports a completed Drive delivery and the ledger takes
 * its word — it's the user's own ledger about the user's own folder.
 * The watchdog cron reads this to decide when to send the "your
 * backups have gone quiet" email.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { getSession } from "@/server/auth";
import { PROVIDER } from "@/lib/backup-shared";

export const runtime = "nodejs";

const bodySchema = z.object({ seq: z.number().int().min(0) });

export async function POST(request: Request) {
  if (!serverDb)
    return Response.json({ error: "accounts are not configured" }, { status: 503 });
  const session = await getSession(request.headers);
  if (!session) return Response.json({ error: "signed out" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "malformed" }, { status: 400 });

  await serverDb
    .update(schema.backupStatus)
    .set({
      state: "active",
      lastBackedUpSeq: parsed.data.seq,
      lastSuccessAt: new Date(),
      lastAttemptAt: new Date(),
      consecutiveFailures: 0,
      lastError: null,
      failureNotifiedAt: null,
    })
    .where(
      and(
        eq(schema.backupStatus.userId, session.user.id),
        eq(schema.backupStatus.provider, PROVIDER),
      ),
    );
  return Response.json({ ok: true });
}
