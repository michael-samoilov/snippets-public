import { speechGuard, tokenTtlSeconds } from "@/server/speech-guard";

export const runtime = "nodejs";

/**
 * Live voice → text via Soniox realtime streaming. The browser opens a
 * WebSocket to Soniox and sends raw PCM; words come back as they're
 * spoken, with native mid-sentence code-switching (no language config
 * needed). Chosen for its privacy defaults: audio is processed in
 * memory, never stored, never used for training — see
 * src/lib/speech-providers.ts, whose retention line the privacy page
 * prints.
 *
 * This route only guards the key: POST mints a short-lived temporary
 * API key (Soniox's /v1/auth/temporary-api-key) which the client sends
 * inside the socket's first config message — the real key never leaves
 * the server. speechGuard refuses cross-site callers and bursts first.
 * GET is the availability probe.
 */

const REST = (process.env.SONIOX_REST_URL ?? "https://api.soniox.com").replace(/\/$/, "");
const WS = (process.env.SONIOX_WS_URL ?? "wss://stt-rt.soniox.com").replace(/\/$/, "");
const MODEL = process.env.SONIOX_MODEL ?? "stt-rt-v5";
/** optional comma-separated ISO language hints (biases, never a hard limit) */
const LANGUAGE = process.env.SONIOX_LANGUAGE_HINTS ?? "";
// long enough to pre-mint and keep a take's socket warm; the client
// refreshes well before this lapses. Clamped to 60..600 s.
const TTL_SECONDS = tokenTtlSeconds(process.env.SONIOX_TOKEN_TTL);

export async function GET() {
  return Response.json({ available: Boolean(process.env.SONIOX_API_KEY) });
}

export async function POST(request: Request) {
  const refused = await speechGuard(request, "token");
  if (refused) return refused;
  const key = process.env.SONIOX_API_KEY;
  if (!key) {
    return Response.json({ error: "transcription_unconfigured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${REST}/v1/auth/temporary-api-key`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        usage_type: "transcribe_websocket",
        expires_in_seconds: TTL_SECONDS,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const status =
        response.status === 401 || response.status === 403
          ? 503 // misconfigured key reads as "unavailable" to the client
          : 502;
      return Response.json({ error: "token_failed" }, { status });
    }

    const data = (await response.json()) as { api_key?: unknown };
    if (typeof data.api_key !== "string") {
      return Response.json({ error: "token_failed" }, { status: 502 });
    }
    return Response.json({
      token: data.api_key,
      model: MODEL,
      ...(LANGUAGE ? { language: LANGUAGE } : {}),
      ws: WS,
      expiresIn: TTL_SECONDS,
    });
  } catch {
    return Response.json({ error: "token_failed" }, { status: 502 });
  }
}
