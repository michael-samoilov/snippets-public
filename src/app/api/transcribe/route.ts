import { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * Voice → text through a thin, key-guarding proxy that speaks the
 * OpenAI Whisper transcription dialect (multipart `file` + `model`,
 * Bearer auth, `{ text }` back). The default upstream is Aqua Voice's
 * Avalon, the writer's preferred transcriber — but any Whisper-
 * compatible provider drops in via TRANSCRIBE_BASE_URL +
 * TRANSCRIBE_MODEL + TRANSCRIBE_API_KEY alone (recipes in README.md).
 * The AQUA_* names remain honored as aliases. Without a key the client
 * falls back to the browser's own speech engine; typing always works.
 *
 * Base and model default to the values verified live against Aqua in CI
 * (scripts/aqua-live-test.mjs): api.aquavoice.com/api/v1 + "avalon-v1.5",
 * which returned an accurate, verbatim transcript. Both stay overridable
 * (the older api.aqua.sh/v1 + "avalon-1" also appears in the wild).
 * Aqua's API is upload-only: it exposes no live-audio socket and no SSE
 * output streaming, so this proxy is the whole integration — words settle
 * on stop, not as you speak.
 */

const BASE = (
  process.env.TRANSCRIBE_BASE_URL ??
  process.env.AQUA_BASE_URL ??
  "https://api.aquavoice.com/api/v1"
).replace(/\/$/, "");
const MODEL = process.env.TRANSCRIBE_MODEL ?? process.env.AQUA_MODEL ?? "avalon-v1.5";
const MAX_BYTES = 25 * 1024 * 1024;

const apiKey = () => process.env.TRANSCRIBE_API_KEY ?? process.env.AQUA_API_KEY;

export async function GET() {
  return Response.json({ available: Boolean(apiKey()) });
}

export async function POST(request: NextRequest) {
  const key = apiKey();
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
