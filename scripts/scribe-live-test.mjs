/**
 * Live-fire test of the ElevenLabs Scribe v2 Realtime protocol — the
 * exact dialect src/hooks/use-speech.ts speaks, against the real API.
 *
 * Mints a single-use token (like /api/scribe-token), opens the same
 * WebSocket the browser opens, streams a WAV as 16kHz PCM in paced
 * chunks (same downsampler math), commits, and asserts real words come
 * back. Runs the session at each configured chunk size and reports
 * latency: token mint, socket connect, and — the number that decides
 * how "instant" the words feel — STEADY-STATE per-word lag: for each
 * word, the wall-clock moment it first appeared in a partial minus the
 * moment it was actually spoken (from ElevenLabs' own word timestamps).
 * Audio is fed at real time, so this isolates model+network lag (it
 * excludes the browser render path and the phone's own network).
 * A mock can only prove we agree with ourselves; this proves we agree
 * with ElevenLabs — and how far behind your voice it runs.
 *
 *   ELEVENLABS_API_KEY=… node scripts/scribe-live-test.mjs <speech.wav> [expected words…]
 *
 * CI: .github/workflows/scribe-live-test.yml generates the WAV with
 * espeak-ng and runs this on demand or on any push touching it.
 */

import { readFileSync } from "node:fs";

const [, , wavPath, ...expectedWords] = process.argv;
const KEY = process.env.ELEVENLABS_API_KEY;
const BASE = (process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io").replace(/\/$/, "");
const MODEL = process.env.SCRIBE_MODEL ?? "scribe_v2_realtime";
const RATE = 16000;
const CHUNK_SIZES_MS = [250, 100, 50]; // old size, shipped size, and smaller still
const expected = expectedWords.length ? expectedWords : ["fox", "morning"];

if (!KEY) die("ELEVENLABS_API_KEY is not set");
if (!wavPath) die("usage: node scripts/scribe-live-test.mjs <speech.wav> [expected words…]");

function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
const ms = (t) => `${Math.round(t)}ms`;

/* ── WAV → Float32 mono ─────────────────────────────────────────── */
function parseWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    die("not a RIFF/WAVE file");
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(pos + 10), rate: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) };
    if (id === "data") data = buf.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) die("missing fmt/data chunk");
  if (fmt.bits !== 16) die(`expected 16-bit PCM, got ${fmt.bits}`);
  const frames = data.length / 2 / fmt.channels;
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2);
    mono[i] = s / fmt.channels / 0x8000;
  }
  return { mono, rate: fmt.rate };
}

/* same block-linear downsampler as use-speech.ts */
function downsampleTo16k(input, inRate) {
  if (inRate === RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
    return out;
  }
  const outLen = Math.floor((input.length * RATE) / inRate);
  const out = new Int16Array(outLen);
  const ratio = inRate / RATE;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const s = input[i0] + (input[i1] - input[i0]) * (pos - i0);
    out[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  }
  return out;
}

/* ── one full session at a given chunk size ─────────────────────── */
async function runSession(pcm, chunkMs) {
  const label = `[${chunkMs}ms chunks]`;
  const timings = {};
  let t = performance.now();

  const tokenRes = await fetch(`${BASE}/v1/single-use-token/realtime_scribe`, {
    method: "POST",
    headers: { "xi-api-key": KEY },
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => die(`${label} token mint threw: ${e.message}`));
  if (!tokenRes.ok) die(`${label} token mint HTTP ${tokenRes.status}: ${(await tokenRes.text()).slice(0, 200)}`);
  const { token } = await tokenRes.json();
  if (typeof token !== "string") die(`${label} token mint returned no token`);
  timings.mint = performance.now() - t;

  const params = new URLSearchParams({
    model_id: MODEL,
    token,
    audio_format: "pcm_16000",
    commit_strategy: "manual",
    include_timestamps: "true", // word-level times, to score per-word lag
  });
  t = performance.now();
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/v1/speech-to-text/realtime?${params}`);

  return new Promise((resolve) => {
    const transcripts = [];
    let done = false;
    let firstChunkAt = 0;
    let committedAt = 0;
    // wordSeenMs[i] = wall-clock ms (since first chunk) a word first
    // appeared at position i in a partial. wordStamps = the committed
    // words with their spoken start times, for the lag subtraction.
    const wordSeenMs = [];
    let wordStamps = [];
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      if (!ok) die(`${label} ${why}`);
      resolve({ transcript: transcripts.join(" "), timings, wordSeenMs, wordStamps });
    };
    const guard = setTimeout(() => finish(false, "timed out after 90s"), 90_000);

    ws.addEventListener("error", () => finish(false, "websocket error"));
    ws.addEventListener("close", (e) => { if (!done) finish(false, `websocket closed early (code ${e.code})`); });
    ws.addEventListener("message", (e) => {
      const data = JSON.parse(e.data);
      const text = data.text ?? data.transcript ?? "";
      if (data.message_type === "partial_transcript") {
        const now = performance.now() - firstChunkAt;
        if (!timings.firstPartial && firstChunkAt) timings.firstPartial = now;
        // record the arrival of each newly-revealed word position (partials
        // only grow in the steady state; a shrink just doesn't backfill)
        const n = text.trim() ? text.trim().split(/\s+/).length : 0;
        for (let i = wordSeenMs.length; i < n; i++) wordSeenMs[i] = now;
        return;
      }
      console.log(`${label} ← ${data.message_type}${text ? `: ${JSON.stringify(text)}` : ""}${data.error ? ` error=${data.error}` : ""}`);
      if (data.message_type === "committed_transcript" || data.message_type === "committed_transcript_with_timestamps") {
        if (text.trim()) transcripts.push(text);
        if (Array.isArray(data.words)) wordStamps = data.words;
        if (committedAt) {
          timings.settle = performance.now() - committedAt;
          clearTimeout(guard);
          finish(true);
        }
      }
      if (/error|exceeded|throttled|overflow|exhausted|unaccepted|limited/.test(data.message_type ?? "") &&
          data.message_type !== "session_time_limit_exceeded") {
        finish(false, `server error: ${data.message_type} ${data.error ?? ""}`);
      }
    });

    ws.addEventListener("open", async () => {
      timings.connect = performance.now() - t;
      const chunkSamples = Math.round((RATE * chunkMs) / 1000);
      for (let off = 0; off < pcm.length && !done; off += chunkSamples) {
        const chunk = pcm.subarray(off, off + chunkSamples);
        if (off === 0) firstChunkAt = performance.now();
        ws.send(JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("base64"),
          commit: false,
          sample_rate: RATE,
        }));
        // real-time pacing — honest lag numbers need honestly-timed input
        await new Promise((r) => setTimeout(r, chunkMs));
      }
      committedAt = performance.now();
      ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", commit: true, sample_rate: RATE }));
    });
  });
}

/* per-word lag = when the word first showed − when it was spoken.
   Real-time paced input means wall-clock ms ≈ audio position ms, so
   subtracting the word's spoken start time yields the lag the writer
   feels for that word. Returns a summary over all matched words. */
function perWordLag(wordSeenMs, wordStamps) {
  const startMs = (w) =>
    ((w.start ?? w.start_time ?? w.startTime ?? w.time ?? 0) *
      // stamps may already be ms; assume seconds if small
      (typeof w.start === "number" && w.start < 1000 ? 1000 : 1));
  const lags = [];
  const n = Math.min(wordSeenMs.length, wordStamps.length);
  for (let i = 0; i < n; i++) {
    const spoken = startMs(wordStamps[i]);
    const seen = wordSeenMs[i];
    if (Number.isFinite(spoken) && Number.isFinite(seen)) lags.push(seen - spoken);
  }
  if (!lags.length) return null;
  const sorted = [...lags].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const avg = lags.reduce((s, x) => s + x, 0) / lags.length;
  return { count: lags.length, median, avg, min: sorted[0], max: sorted[sorted.length - 1] };
}

/* ── main ───────────────────────────────────────────────────────── */
const { mono, rate } = parseWav(readFileSync(wavPath));
const pcm = downsampleTo16k(mono, rate);
console.log(`audio: ${wavPath} @${rate}Hz → ${(pcm.length / RATE).toFixed(1)}s @16k\n`);

const results = [];
for (const chunkMs of CHUNK_SIZES_MS) {
  const r = await runSession(pcm, chunkMs);
  results.push({ chunkMs, ...r });
  console.log(`[${chunkMs}ms chunks] transcript: ${JSON.stringify(r.transcript)}\n`);
}

console.log("── setup latency ───────────────────────────────");
for (const r of results) {
  const tt = r.timings;
  console.log(
    `${String(r.chunkMs).padStart(4)}ms chunks · mint ${ms(tt.mint)} · connect ${ms(tt.connect)}` +
    ` · commit→settled ${ms(tt.settle)}`,
  );
}

console.log("\n── steady-state per-word lag (the felt delay) ──");
console.log("   (words behind your voice; excludes browser render + your own network)");
for (const r of results) {
  const lag = perWordLag(r.wordSeenMs, r.wordStamps);
  if (!lag) {
    console.log(`${String(r.chunkMs).padStart(4)}ms chunks · no word timestamps returned`);
    continue;
  }
  console.log(
    `${String(r.chunkMs).padStart(4)}ms chunks · median ${ms(lag.median)} · avg ${ms(lag.avg)}` +
    ` · min ${ms(lag.min)} · max ${ms(lag.max)} · first-word ${ms(r.timings.firstPartial ?? NaN)} · n=${lag.count}`,
  );
}

for (const r of results) {
  const lower = r.transcript.toLowerCase();
  const missing = expected.filter((w) => !lower.includes(w.toLowerCase()));
  if (!r.transcript.trim()) die(`[${r.chunkMs}ms chunks] empty transcript`);
  if (missing.length) die(`[${r.chunkMs}ms chunks] transcript missing: ${missing.join(", ")}`);
}
console.log(`\nPASS: all ${results.length} sessions transcribed ${expected.join(", ")}`);
process.exit(0);
