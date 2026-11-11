import { speechGuard, tokenTtlSeconds } from "@/server/speech-guard";

export const runtime = "nodejs";

/**
 * Live voice → text via Deepgram Nova-3 streaming. The browser streams
 * PCM straight to Deepgram over a WebSocket and words come back as
 * they're spoken — measured ~2x lower latency than Scribe, first word
 * and steady. This route only guards the key: POST mints a short-lived
 * JWT (Deepgram's /v1/auth/grant) so the client opens that socket with
 * a bearer token instead of the raw key. speechGuard refuses cross-site
 * callers and bursts first. GET is the availability probe.
 *
 * `language=multi` (Nova-3) accepts any supported language and switches
 * mid-sentence without configuration. Model/language overridable via
 * DEEPGRAM_MODEL / DEEPGRAM_LANGUAGE.
 */

const REST = (process.env.DEEPGRAM_REST_URL ?? "https://api.deepgram.com").replace(/\/$/, "");
const WS = (process.env.DEEPGRAM_WS_URL ?? "wss://api.deepgram.com").replace(/\/$/, "");
const MODEL = process.env.DEEPGRAM_MODEL ?? "nova-3";
const LANGUAGE = process.env.DEEPGRAM_LANGUAGE ?? "multi";
// long enough to pre-mint and keep a take's socket warm; the client
// refreshes well before this lapses. Clamped to 60..600 s.
const TTL_SECONDS = tokenTtlSeconds(process.env.DEEPGRAM_TOKEN_TTL);

export async function GET() {
  return Response.json({ available: Boolean(process.env.DEEPGRAM_API_KEY) });
}

export async function POST(request: Request) {
  const refused = await speechGuard(request, "token");
  if (refused) return refused;
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return Response.json({ error: "transcription_unconfigured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${REST}/v1/auth/grant`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: TTL_SECONDS }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const status =
        response.status === 401 || response.status === 403
          ? 503 // misconfigured key reads as "unavailable" to the client
          : 502;
      return Response.json({ error: "token_failed" }, { status });
    }

    const data = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string") {
      return Response.json({ error: "token_failed" }, { status: 502 });
    }
    return Response.json({
      token: data.access_token,
      scheme: "bearer", // Deepgram JWTs ride the "bearer" WebSocket subprotocol
      model: MODEL,
      language: LANGUAGE,
      ws: WS,
      expiresIn: typeof data.expires_in === "number" ? data.expires_in : TTL_SECONDS,
    });
  } catch {
    return Response.json({ error: "token_failed" }, { status: 502 });
  }
}
