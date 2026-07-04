import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Live self-test of the Scribe v2 Realtime pipeline, runnable where the
 * key already lives (the deployment) — no repo secret, no CLI. Streams
 * the committed speech fixture (public/scribe-sample.wav, 16k mono
 * s16le) through the exact dialect use-speech.ts speaks and reports
 * the transcript + latencies as JSON.
 *
 *   GET /api/scribe-selftest?spend=yes
 *
 * The spend flag is required on purpose: every run costs a few seconds
 * of transcription credit. Remove this route (or gate it) once the
 * pipeline has been proven — it's a diagnostic, not a feature.
 */

const BASE = (process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io").replace(/\/$/, "");
const MODEL = process.env.SCRIBE_MODEL ?? "scribe_v2_realtime";
const RATE = 16000;
const CHUNK_MS = 100; // what the app ships
const EXPECTED = ["fox", "morning"];

const fail = (stage: string, detail: unknown, status = 500) =>
  Response.json({ pass: false, stage, detail }, { status });

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("spend") !== "yes") {
    return Response.json(
      { hint: "this run costs a few seconds of ElevenLabs credit — add ?spend=yes to proceed" },
      { status: 400 },
    );
  }
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail("env", "ELEVENLABS_API_KEY is not set", 503);
  if (typeof WebSocket === "undefined")
    return fail("runtime", "no WebSocket client in this Node runtime");

  /* the fixture, served by this same deployment */
  const wavRes = await fetch(new URL("/scribe-sample.wav", request.nextUrl.origin)).catch(() => null);
  if (!wavRes?.ok) return fail("fixture", `couldn't fetch /scribe-sample.wav (${wavRes?.status})`);
  const wav = Buffer.from(await wavRes.arrayBuffer());
  // minimal RIFF walk — the fixture is known 16k mono s16le
  let pos = 12, data: Buffer | null = null;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    if (id === "data") data = wav.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  if (!data) return fail("fixture", "no data chunk in fixture");

  /* mint — what /api/scribe-token does */
  let t = performance.now();
  const tokenRes = await fetch(`${BASE}/v1/single-use-token/realtime_scribe`, {
    method: "POST",
    headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => ({ ok: false as const, status: 0, text: async () => String(e) }));
  if (!tokenRes.ok)
    return fail("mint", `HTTP ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 200)}`);
  const { token } = (await (tokenRes as Response).json()) as { token?: string };
  if (!token) return fail("mint", "no token in response");
  const mintMs = Math.round(performance.now() - t);

  /* the socket, exactly as the browser opens it */
  const params = new URLSearchParams({
    model_id: MODEL,
    token,
    audio_format: "pcm_16000",
    commit_strategy: "manual",
  });
  t = performance.now();
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/v1/speech-to-text/realtime?${params}`);
  const pcm = data;

  return new Promise<Response>((resolve) => {
    const transcripts: string[] = [];
    const events: string[] = [];
    const timings: Record<string, number> = { mintMs };
    let firstChunkAt = 0;
    let committedAt = 0;
    let done = false;
    const finish = (body: Record<string, unknown>, status = 200) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      resolve(Response.json(body, { status }));
    };
    setTimeout(() => finish({ pass: false, stage: "timeout", events, timings }, 500), 45_000);

    ws.addEventListener("error", () =>
      finish({ pass: false, stage: "socket", detail: "websocket error", events, timings }, 502));
    ws.addEventListener("close", (e) => {
      if (!done)
        finish({ pass: false, stage: "socket", detail: `closed early (${(e as CloseEvent).code})`, events, timings }, 502);
    });
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String((e as MessageEvent).data)) as {
        message_type?: string; text?: string; transcript?: string; error?: string;
      };
      const text = msg.text ?? msg.transcript ?? "";
      if (msg.message_type !== "partial_transcript")
        events.push(`${msg.message_type}${text ? `: ${text}` : ""}${msg.error ? ` (${msg.error})` : ""}`);
      if (msg.message_type === "partial_transcript" && !timings.firstPartialMs && firstChunkAt)
        timings.firstPartialMs = Math.round(performance.now() - firstChunkAt);
      if (msg.message_type === "committed_transcript" || msg.message_type === "committed_transcript_with_timestamps") {
        if (text.trim()) transcripts.push(text);
        if (committedAt) {
          timings.settleMs = Math.round(performance.now() - committedAt);
          const all = transcripts.join(" ");
          const missing = EXPECTED.filter((w) => !all.toLowerCase().includes(w));
          finish({
            pass: all.trim().length > 0 && missing.length === 0,
            transcript: all,
            missing,
            timings,
            events,
          });
        }
      }
    });

    ws.addEventListener("open", async () => {
      timings.connectMs = Math.round(performance.now() - t);
      const bytesPerChunk = (RATE * CHUNK_MS / 1000) * 2;
      for (let off = 0; off < pcm.length && !done; off += bytesPerChunk) {
        const chunk = pcm.subarray(off, off + bytesPerChunk);
        if (off === 0) firstChunkAt = performance.now();
        ws.send(JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: chunk.toString("base64"),
          commit: false,
          sample_rate: RATE,
        }));
        await new Promise((r) => setTimeout(r, CHUNK_MS / 2)); // 2× real-time
      }
      committedAt = performance.now();
      ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", commit: true, sample_rate: RATE }));
    });
  });
}
