/**
 * Hand the Drive refresh token to the device that owns it, then
 * forget it. After adoption the server holds nothing that can open
 * the user's Drive — tokens transit through /api/backup/refresh but
 * never rest here again. This is half of the "operator cannot read"
 * posture: the other half is entry encryption; this one closes the
 * door where readable backups live.
 */
import { and, eq } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { getSession } from "@/server/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!serverDb)
    return Response.json({ error: "accounts are not configured" }, { status: 503 });
  const session = await getSession(request.headers);
  if (!session) return Response.json({ error: "signed out" }, { status: 401 });

  const [account] = await serverDb
    .select({
      id: schema.account.id,
      refreshToken: schema.account.refreshToken,
      accessToken: schema.account.accessToken,
    })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, session.user.id),
        eq(schema.account.providerId, "google"),
      ),
    );
  if (!account?.refreshToken)
    return Response.json({ error: "no token to adopt" }, { status: 404 });

  const refreshToken = account.refreshToken;

  // the forgetting is the feature
  await serverDb
    .update(schema.account)
    .set({ refreshToken: null, accessToken: null })
    .where(eq(schema.account.id, account.id));

  return Response.json({ refreshToken });
}
