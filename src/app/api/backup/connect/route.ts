/**
 * Finalizes the Drive grant. The client returns here after
 * `linkSocial` with the drive.file scope; we verify the scope was
 * actually granted (the consent screen lets people untick it) and
 * seed the ledger. Delivery itself happens on the device — the
 * client adopts the refresh token next (/api/backup/adopt, after
 * which the server keeps no way into anyone's Drive) and runs the
 * first delivery itself.
 */
import { and, eq } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { getSession } from "@/server/auth";
import { DRIVE_SCOPE, PROVIDER } from "@/lib/backup-shared";

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
  const userId = session.user.id;

  const accounts = await serverDb
    .select({ scope: schema.account.scope })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, "google"),
      ),
    );
  const granted = accounts.some((a) =>
    (a.scope ?? "").split(/[\s,]+/).includes(DRIVE_SCOPE),
  );
  if (!granted)
    return Response.json({ error: "drive scope not granted" }, { status: 409 });

  await serverDb
    .insert(schema.backupStatus)
    .values({ userId, provider: PROVIDER, state: "active" })
    .onConflictDoUpdate({
      target: [schema.backupStatus.userId, schema.backupStatus.provider],
      set: { state: "active", consecutiveFailures: 0, lastError: null },
    });

  return Response.json({ ok: true });
}
