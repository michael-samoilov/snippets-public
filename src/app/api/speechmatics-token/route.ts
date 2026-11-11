import { speechGuard, tokenTtlSeconds } from "@/server/speech-guard";

export const runtime = "nodejs";

/**
 * Live voice → text via Speechmatics realtime. The browser opens a
 * WebSocket (EU endpoint by default) carrying a short-lived JWT in the
 * query — the one place a browser can put it — and streams raw PCM.
 * Chosen for its privacy architecture: the realtime service stores
 * neither audio nor transcript (see src/lib/speech-providers.ts).
 *
 * Honest limit vs the multilingual providers: a Speechmatics realtime
 * session transcribes ONE configured language (bilingual packs aside) —
 * set SPEECHMATICS_LANGUAGE; there is no code-switching "multi" mode.
 *
 * POST mints the JWT via the management API; the real key never leaves
 * the server. speechGuard refuses cross-site callers and bursts first.
 * GET is the availability probe.
 */

const MP = (process.env.SPEECHMATICS_MP_URL ?? "https://mp.speechmatics.com").replace(/\/$/, "");
const WS = (process.env.SPEECHMATICS_WS_URL ?? "wss://eu2.rt.speechmatics.com/v2").replace(/\/$/, "");
const LANGUAGE = process.env.SPEECHMATICS_LANGUAGE ?? "en";
/** operating point: "enhanced" is their accuracy tier */
const MODEL = process.env.SPEECHMATICS_OPERATING_POINT ?? "enhanced";
// clamped to 60..600 s (Speechmatics itself floors the JWT ttl at 60 s)
const TTL_SECONDS = tokenTtlSeconds(process.env.SPEECHMATICS_TOKEN_TTL);

export async function GET() {
  return Response.json({ available: Boolean(process.env.SPEECHMATICS_API_KEY) });
}

export async function POST(request: Request) {
  const refused = await speechGuard(request, "token");
  if (refused) return refused;
  const key = process.env.SPEECHMATICS_API_KEY;
  if (!key) {
    return Response.json({ error: "transcription_unconfigured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${MP}/v1/api_keys?type=rt`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        ttl: TTL_SECONDS,
        ...(process.env.SPEECHMATICS_REGION
          ? { region: process.env.SPEECHMATICS_REGION }
          : {}),
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

    const data = (await response.json()) as { key_value?: unknown };
    if (typeof data.key_value !== "string") {
      return Response.json({ error: "token_failed" }, { status: 502 });
    }
    return Response.json({
      token: data.key_value,
      scheme: "query", // browsers can't set WS headers; the JWT rides ?jwt=
      model: MODEL,
      language: LANGUAGE,
      ws: WS,
      expiresIn: TTL_SECONDS,
    });
  } catch {
    return Response.json({ error: "token_failed" }, { status: 502 });
  }
}
