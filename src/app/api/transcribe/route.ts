import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Voice → text via Aqua Voice's Avalon model, the writer's preferred
 * transcriber. Avalon mirrors the OpenAI Whisper API (multipart `file`
 * + `model`, Bearer auth, `{ text }` back), so this is a thin, key-
 * guarding proxy. Without AQUA_API_KEY the client falls back to the
 * browser's own speech engine; typing always works.
 *
 * Base and model are configurable because both appear in the wild:
 * docs say api.aqua.sh/v1 + "avalon-1"; some integrations use
 * api.aquavoice.com/api/v1 + "avalon-v1-en".
 */

const BASE = (process.env.AQUA_BASE_URL ?? "https://api.aqua.sh/v1").replace(/\/$/, "");
const MODEL = process.env.AQUA_MODEL ?? "avalon-1";
const MAX_BYTES = 25 * 1024 * 1024;

export async function GET() {
  return Response.json({ available: Boolean(process.env.AQUA_API_KEY) });
}

export async function POST(request: NextRequest) {
  const key = process.env.AQUA_API_KEY;
  if (!key) {
    return Response.json({ error: "transcription_unconfigured" }, { status: 503 });
  }

  let audio: Blob | null = null;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (file instanceof Blob) audio = file;
  } catch {
    // fall through to the error below
  }
  if (!audio || audio.size === 0) {
    return Response.json({ error: "no_audio" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return Response.json({ error: "audio_too_long" }, { status: 413 });
  }

  const ext = audio.type.includes("mp4")
    ? "mp4"
    : audio.type.includes("ogg")
      ? "ogg"
      : audio.type.includes("wav")
        ? "wav"
        : "webm";

  const upstream = new FormData();
  upstream.append("file", audio, `capture.${ext}`);
  upstream.append("model", MODEL);
  upstream.append("response_format", "json");

  try {
    const response = await fetch(`${BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: upstream,
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      const status =
        response.status === 401 || response.status === 403
          ? 503 // misconfigured key reads as "unavailable" to the client
          : response.status === 413
            ? 413
            : 502;
      return Response.json({ error: "transcription_failed" }, { status });
    }

    const data = (await response.json()) as { text?: unknown };
    if (typeof data.text !== "string") {
      return Response.json({ error: "transcription_failed" }, { status: 502 });
    }
    return Response.json({ text: data.text });
  } catch {
    return Response.json({ error: "transcription_failed" }, { status: 502 });
  }
}
