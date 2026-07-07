/**
 * Disconnect Drive backup — stop the daily delivery without revoking the
 * Google grant. Revoking the token would also de-authorize Google
 * sign-in (same OAuth grant), so this is a soft disconnect: the ledger
 * flips to 'disconnected' (the cron skips this user), the folder/file
 * ids and last-backed-up cursor stay, so reconnecting later resumes in
 * place. A hard revoke, if the user wants one, is a click in their own
 * Google account permissions.
 */
import { and, eq } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { getSession } from "@/server/auth";
import { PROVIDER } from "@/server/backup/run";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!serverDb)
    return Response.json(
      { error: "accounts are not configured" },
      { status: 503 },
    );
  const session = await getSession(request.headers);
  if (!session)
    return Response.json({ error: "signed out" }, { status: 401 });

  await serverDb
    .update(schema.backupStatus)
    .set({ state: "disconnected" })
    .where(
      and(
        eq(schema.backupStatus.userId, session.user.id),
        eq(schema.backupStatus.provider, PROVIDER),
      ),
    );

  return Response.json({ ok: true });
}
