/**
 * One quiet endpoint feeding both trust surfaces in Settings: the
 * entry-count integrity line (server count vs device count) and the
 * backup freshness line ("Last delivered to your Drive…").
 */
import { and, eq, sql } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { getSession } from "@/server/auth";
import type { StatusResponse } from "@/lib/sync-wire";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!serverDb)
    return Response.json(
      { error: "accounts are not configured" },
      { status: 503 },
    );
  const session = await getSession(request.headers);
  if (!session)
    return Response.json({ error: "signed out" }, { status: 401 });

  const userId = session.user.id;

  const [counts] = await serverDb
    .select({
      entryCount: sql<number>`count(*) filter (where deleted_at is null)`,
      maxSeq: sql<number>`coalesce(max(server_seq), 0)`,
    })
    .from(schema.snippets)
    .where(eq(schema.snippets.userId, userId));

  const [backup] = await serverDb
    .select()
    .from(schema.backupStatus)
    .where(
      and(
        eq(schema.backupStatus.userId, userId),
        eq(schema.backupStatus.provider, "google-drive"),
      ),
    );

  const response: StatusResponse = {
    entryCount: Number(counts?.entryCount ?? 0),
    maxSeq: Number(counts?.maxSeq ?? 0),
    backup: backup
      ? {
          state: backup.state as "active" | "disconnected" | "error",
          lastSuccessAt: backup.lastSuccessAt?.toISOString() ?? null,
          consecutiveFailures: backup.consecutiveFailures,
          // the book has entries the ledger hasn't seen delivered — the
          // client pairs this with staleness to show "failing" even when
          // the delivering device vanished and can't report anything
          behind: Number(counts?.maxSeq ?? 0) > backup.lastBackedUpSeq,
        }
      : null,
  };
  return Response.json(response);
}
