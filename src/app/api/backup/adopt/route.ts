/**
 * Hand the Drive refresh token to the device that owns it, then
 * forget it. After adoption the server holds nothing that can open
 * the user's Drive — tokens transit through /api/backup/refresh but
 * never rest here again. This is half of the "operator cannot read"
 * posture: the other half is entry encryption; this one closes the
 * door where readable backups live. Until adoption the token rests
 * encrypted (`encryptOAuthTokens`); only the Drive link writes one
 * (src/server/oauth-tokens.ts).
 */
import { and, eq } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { auth, getSession, readStoredToken } from "@/server/auth";
import { hashRefreshToken } from "@/server/drive-grant";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!serverDb || !auth)
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

  const refreshToken = await readStoredToken(account.refreshToken);

  // bind the token to this account (only its hash rests), then forget
  // the token itself — the forgetting is the feature
  await serverDb.transaction(async (tx) => {
    await tx
      .insert(schema.driveGrant)
      .values({ tokenHash: hashRefreshToken(refreshToken), userId: session.user.id })
      .onConflictDoNothing();
    await tx
      .update(schema.account)
      .set({ refreshToken: null, accessToken: null })
      .where(eq(schema.account.id, account.id));
  });

  return Response.json({ refreshToken });
}
