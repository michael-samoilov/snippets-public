/**
 * Stateless token exchange: the device sends the refresh token it
 * holds, the server attaches the client secret (which browsers must
 * never carry), Google answers, and no token is stored. A compromised
 * server could log what passes through — that is the web's honest
 * ceiling — but a well-behaved one keeps no capability at rest.
 *
 * A token is exchanged only for the account it is bound to
 * (src/server/drive-grant.ts): the binding holds the token's SHA-256,
 * never the token.
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getSession } from "@/server/auth";
import { serverDb, schema } from "@/server/db";
import {
  driveGrantTableReady,
  grantVerdict,
  hashRefreshToken,
} from "@/server/drive-grant";

export const runtime = "nodejs";

const bodySchema = z.object({ refreshToken: z.string().min(10).max(1024) });

export async function POST(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    return Response.json({ error: "google is not configured" }, { status: 503 });
  if (!serverDb)
    return Response.json({ error: "accounts are not configured" }, { status: 503 });
  const session = await getSession(request.headers);
  if (!session) return Response.json({ error: "signed out" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "malformed" }, { status: 400 });

  await driveGrantTableReady(serverDb);
  const tokenHash = hashRefreshToken(parsed.data.refreshToken);
  const [binding] = await serverDb
    .select({ userId: schema.driveGrant.userId })
    .from(schema.driveGrant)
    .where(eq(schema.driveGrant.tokenHash, tokenHash));
  const verdict = grantVerdict(
    binding ? binding.userId : undefined,
    session.user.id,
    Date.now(),
  );
  if (verdict === "refuse")
    // the same shape as Google's refusal: the device drops the token and
    // Settings offers Reconnect, which mints and binds a fresh grant
    return Response.json(
      {
        error: "revoked",
        google: "unbound_grant",
        description: "This Drive connection is not bound to this account.",
      },
      { status: 401 },
    );
  if (verdict === "claim")
    await serverDb
      .insert(schema.driveGrant)
      .values({ tokenHash, userId: session.user.id })
      .onConflictDoNothing();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: parsed.data.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    const revoked = data.error === "invalid_grant";
    // Google's own code and words travel back so the device can report
    // the true cause (invalid_grant vs invalid_client, …); no token does
    return Response.json(
      {
        error: revoked ? "revoked" : "refresh failed",
        google: data.error ?? `http ${response.status}`,
        description: (data.error_description ?? "").slice(0, 200),
      },
      { status: revoked ? 401 : 502 },
    );
  }
  return Response.json({
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? 3600,
  });
}
