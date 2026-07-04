import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Live self-test of the Deepgram Nova-3 streaming pipeline, runnable
 * where the key already lives (the deployment) — no repo secret, no CLI.
 * It answers the one question that matters when voice fails on Deepgram:
 * does the key actually grant a token, and does the socket transcribe?
 *
 *   GET /api/deepgram-selftest            → mint-only (free): reports
 *                                           whether /v1/auth/grant works
 *   GET /api/deepgram-selftest?spend=yes  → also streams the speech
 *                                           fixture and reports the
 *                                           transcript + latencies
 *
 * The mint-only default is free — it's the fast way to tell a bad/missing
 * key (503) or a not-yet-deployed env var apart from a working provider.
 * The spend flag costs a few seconds of transcription credit. Remove this
 * route (or gate it) once the pipeline is proven — it's a diagnostic.
 */

const REST = (process.env.DEEPGRAM_REST_URL ?? "https://api.deepgram.com").replace(/\/$/, "");
const WS = (process.env.DEEPGRAM_WS_URL ?? "wss://api.deepgram.com").replace(/\/$/, "");
const MODEL = process.env.DEEPGRAM_MODEL ?? "nova-3";
const LANGUAGE = process.env.DEEPGRAM_LANGUAGE ?? "multi";
const RATE = 16000;
const CHUNK_MS = 100; // what the app ships
const EXPECTED = ["fox", "morning"];

const fail = (stage: string, detail: unknown, status = 500) =>
  Response.json({ pass: false, stage, detail }, { status });

export async function GET(request: NextRequest) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return fail("env", "DEEPGRAM_API_KEY is not set", 503);

  /* mint — exactly what /api/deepgram-token does */
  let t = performance.now();
  const grantRes = await fetch(`${REST}/v1/auth/grant`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 60 }),
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => ({ ok: false as const, status: 0, text: async () => String(e) }));
  if (!grantRes.ok)
    return fail("mint", `HTTP ${grantRes.status}: ${(await grantRes.text()).slice(0, 200)}`, 502);
  const { access_token: token } = (await (grantRes as Response).json()) as {
    access_token?: string;
  };
  if (!token) return fail("mint", "no access_token in grant response", 502);
  const mintMs = Math.round(performance.now() - t);

  // mint-only: the free, fast answer to "is the key good and deployed?"
  if (request.nextUrl.searchParams.get("spend") !== "yes") {
    return Response.json({
      pass: true,
      stage: "mint",
      hint: "key grants a token — add ?spend=yes to also stream the fixture through the socket",
      timings: { mintMs },
    });
  }

  if (typeof WebSocket === "undefined")
    return fail("runtime", "no WebSocket client in this Node runtime");

  /* the fixture, served by this same deployment (16k mono s16le) */
  const wavRes = await fetch(new URL("/scribe-sample.wav", request.nextUrl.origin)).catch(() => null);
  if (!wavRes?.ok) return fail("fixture", `couldn't fetch /scribe-sample.wav (${wavRes?.status})`);
  const wav = Buffer.from(await wavRes.arrayBuffer());
  let pos = 12, data: Buffer | null = null;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    if (id === "data") data = wav.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  if (!data) return fail("fixture", "no data chunk in fixture");
  const pcm = data;

  /* the socket, exactly as the browser opens it: bearer subprotocol */
  const params = new URLSearchParams({
    model: MODEL,
    language: LANGUAGE,
    encoding: "linear16",
    sample_rate: String(RATE),
    channels: "1",
    interim_results: "true",
    smart_format: "true",
  });
  t = performance.now();
  const ws = new WebSocket(`${WS}/v1/listen?${params}`, ["bearer", token]);

  return new Promise<Response>((resolve) => {
    const transcripts: string[] = [];
    const events: string[] = [];
    const timings: Record<string, number> = { mintMs };
    let firstChunkAt = 0;
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
      // a normal close (1000) after CloseStream is how Deepgram signals done
      const code = (e as CloseEvent).code;
      if (done) return;
      if (code === 1000 || code === 1001) {
        const all = transcripts.join(" ");
        const missing = EXPECTED.filter((w) => !all.toLowerCase().includes(w));
        finish({ pass: all.trim().length > 0 && missing.length === 0, transcript: all, missing, timings, events });
      } else {
        finish({ pass: false, stage: "socket", detail: `closed early (${code})`, events, timings }, 502);
      }
    });
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(String((e as MessageEvent).data)) as {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: { transcript?: string }[] };
      };
      if (msg.type !== "Results") {
        if (msg.type) events.push(msg.type);
        return;
      }
      const text = (msg.channel?.alternatives?.[0]?.transcript ?? "").trim();
      if (msg.is_final && !timings.firstFinalMs && firstChunkAt)
        timings.firstFinalMs = Math.round(performance.now() - firstChunkAt);
      if (msg.is_final && text) transcripts.push(text);
    });

    ws.addEventListener("open", async () => {
      timings.connectMs = Math.round(performance.now() - t);
      const bytesPerChunk = (RATE * CHUNK_MS / 1000) * 2;
      for (let off = 0; off < pcm.length && !done; off += bytesPerChunk) {
        const chunk = pcm.subarray(off, off + bytesPerChunk);
        if (off === 0) firstChunkAt = performance.now();
        ws.send(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        await new Promise((r) => setTimeout(r, CHUNK_MS / 2)); // 2× real-time
      }
      ws.send(JSON.stringify({ type: "CloseStream" })); // flush finals, then close 1000
    });
  });
}
