/**
 * Stateless token exchange: the device sends the refresh token it
 * holds, the server attaches the client secret (which browsers must
 * never carry), Google answers, and nothing is stored. A compromised
 * server could log what passes through — that is the web's honest
 * ceiling — but a well-behaved one keeps no capability at rest.
 */
import { z } from "zod";
import { getSession } from "@/server/auth";

export const runtime = "nodejs";

const bodySchema = z.object({ refreshToken: z.string().min(10).max(1024) });

export async function POST(request: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    return Response.json({ error: "google is not configured" }, { status: 503 });
  const session = await getSession(request.headers);
  if (!session) return Response.json({ error: "signed out" }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "malformed" }, { status: 400 });

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
