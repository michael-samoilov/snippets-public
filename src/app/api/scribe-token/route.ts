import { speechGuard } from "@/server/speech-guard";

export const runtime = "nodejs";

/**
 * Live voice → text via ElevenLabs Scribe v2 Realtime. The browser
 * streams PCM straight to ElevenLabs over a WebSocket and words come
 * back as they're spoken — this route only guards the key: POST mints
 * a single-use token (15-minute, consumed on connect) so the client
 * can open that socket without ever seeing ELEVENLABS_API_KEY.
 * speechGuard refuses cross-site callers and bursts first. ElevenLabs
 * fixes the token's lifetime, so it has no TTL override to clamp.
 * GET is the availability probe the speech hook reads on page load.
 *
 * Without a key the client falls back to the batch Whisper-dialect
 * proxy (/api/transcribe), then the browser's own speech engine;
 * typing always works.
 */

const BASE = (process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io").replace(/\/$/, "");
const MODEL = process.env.SCRIBE_MODEL ?? "scribe_v2_realtime";

export async function GET() {
  return Response.json({ available: Boolean(process.env.ELEVENLABS_API_KEY) });
}

export async function POST(request: Request) {
  const refused = await speechGuard(request, "token");
  if (refused) return refused;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return Response.json({ error: "transcription_unconfigured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${BASE}/v1/single-use-token/realtime_scribe`, {
      method: "POST",
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const status =
        response.status === 401 || response.status === 403
          ? 503 // misconfigured key reads as "unavailable" to the client
          : 502;
      return Response.json({ error: "token_failed" }, { status });
    }

    const data = (await response.json()) as { token?: unknown };
    if (typeof data.token !== "string") {
      return Response.json({ error: "token_failed" }, { status: 502 });
    }
    return Response.json({
      token: data.token,
      scheme: "query", // Scribe carries the token as a ?token= query param
      model: MODEL,
      // the socket lives wherever the REST base does (wss mirrors https)
      ws: BASE.replace(/^http/, "ws"),
      expiresIn: 15 * 60, // single-use, 15-minute token
    });
  } catch {
    return Response.json({ error: "token_failed" }, { status: 502 });
  }
}
