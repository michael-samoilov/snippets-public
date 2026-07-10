/**
 * The device reports a failed Drive delivery, so the ledger — and with
 * it Settings on every device — can say "Backups haven't gone through
 * since…" instead of resting on a stale calm line. The next successful
 * delivery (/api/backup/delivered) resets the state to active. A
 * deliberately disconnected ledger is left alone: "off" outranks
 * "failing".
 */
import { z } from "zod";
import { and, eq, ne, sql } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { getSession } from "@/server/auth";
import { PROVIDER } from "@/lib/backup-shared";

export const runtime = "nodejs";

const bodySchema = z.object({ error: z.string().min(1).max(500) });

export async function POST(request: Request) {
  if (!serverDb)
    return Response.json(
      { error: "accounts are not configured" },
      { status: 503 },
    );
  const session = await getSession(request.headers);
  if (!session) return Response.json({ error: "signed out" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "malformed" }, { status: 400 });

  await serverDb
    .update(schema.backupStatus)
    .set({
      state: "error",
      lastError: parsed.data.error,
      lastAttemptAt: new Date(),
      consecutiveFailures: sql`${schema.backupStatus.consecutiveFailures} + 1`,
    })
    .where(
      and(
        eq(schema.backupStatus.userId, session.user.id),
        eq(schema.backupStatus.provider, PROVIDER),
        ne(schema.backupStatus.state, "disconnected"),
      ),
    );
  return Response.json({ ok: true });
}
