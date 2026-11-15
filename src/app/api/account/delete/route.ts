/**
 * Account deletion — the real thing, not a soft promise. Deleting the
 * user row cascades through every table that references it (sessions,
 * OAuth accounts, synced snippets and their tombstones, the backup
 * ledger), so "removed entirely" in the privacy page is literally
 * true, immediately.
 *
 * Order matters: revoke the Google grant first (so no orphaned token
 * lingers on the user's Google security page), capture the sign-out's
 * cookie-clearing headers second, delete last. Device copies are
 * untouched — they belong to the writer, and the client returns the
 * book to local-only on its own.
 *
 * The server rarely holds a Google token to revoke: a sign-in stores
 * none, and the Drive grant rests here only until a device adopts it
 * (src/server/oauth-tokens.ts). So the deleting device sends the Drive
 * refresh token it holds, if any. Revoking any one token ends the whole
 * grant (Google revokes every token of that user for this app), so one
 * device's token is enough.
 */
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { serverDb, schema } from "@/server/db";
import { auth, getSession, readStoredToken } from "@/server/auth";
import { isCrossSite } from "@/server/same-origin";

export const runtime = "nodejs";

const bodySchema = z.object({
  driveToken: z.string().min(10).max(1024).optional(),
});

export async function POST(request: Request) {
  if (isCrossSite(request.headers))
    return Response.json({ error: "cross_site" }, { status: 403 });
  if (!serverDb || !auth)
    return Response.json(
      { error: "accounts are not configured" },
      { status: 503 },
    );
  const session = await getSession(request.headers);
  if (!session)
    return Response.json({ error: "signed out" }, { status: 401 });
  const userId = session.user.id;
  // an older client sends no body; a malformed one is ignored, never a
  // reason to keep the account
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  const deviceToken = body.success ? body.data.driveToken : undefined;

  // best-effort: hand Google back its grant so the connection doesn't
  // outlive the account in the user's Google security settings
  try {
    const accounts = await serverDb
      .select({
        refreshToken: schema.account.refreshToken,
        accessToken: schema.account.accessToken,
      })
      .from(schema.account)
      .where(
        and(
          eq(schema.account.userId, userId),
          eq(schema.account.providerId, "google"),
        ),
      );
    const stored = await Promise.all(
      accounts
        .map((a) => a.refreshToken ?? a.accessToken)
        .filter((token): token is string => !!token)
        .map((token) => readStoredToken(token)),
    );
    const readable = stored.filter((token): token is string => token !== null);
    const tokens = deviceToken ? [deviceToken, ...readable] : readable;
    await Promise.allSettled(
      tokens.map((token) =>
        fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `token=${encodeURIComponent(token)}`,
        }),
      ),
    );
  } catch {
    // revocation is a courtesy; deletion proceeds regardless
  }

  // sign out first so the response can clear the session cookies
  const signOutResponse = await auth.api
    .signOut({ headers: request.headers, asResponse: true })
    .catch(() => null);

  // the deletion itself — one row; the schema's cascades do the rest
  await serverDb.delete(schema.user).where(eq(schema.user.id, userId));

  const response = Response.json({ ok: true });
  const setCookie = signOutResponse?.headers.get("set-cookie");
  if (setCookie) response.headers.set("set-cookie", setCookie);
  return response;
}
