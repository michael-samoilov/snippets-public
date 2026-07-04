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

/* ── one full session (chunk size × commit strategy) ────────────── */
async function runSession(pcm, { chunkMs, commit }) {
  const audioMs = (pcm.length / RATE) * 1000;
  const label = `[${commit}·${chunkMs}ms]`;
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
    commit_strategy: commit,
  });
  t = performance.now();
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/v1/speech-to-text/realtime?${params}`);

  return new Promise((resolve) => {
    const committedParts = []; // finalized text, in order
    const timeline = []; // {ms, words, kind} every time the shown text grows
    const wordSeenMs = []; // ms a word at global index first appeared on "screen"
    let committedWordCount = 0; // words locked in by commits so far
    let firstChunkAt = 0;
    let audioDoneAt = 0;
    let done = false;
    let settleTimer = null;

    // "shown text" = everything committed so far + the live partial. Mark the
    // first-seen time of every newly-revealed word position, from partials AND
    // progressive (VAD) commits alike — that's what the eye actually sees.
    const reveal = (kind, extraPartialWords) => {
      const now = performance.now() - firstChunkAt;
      const shown = committedWordCount + extraPartialWords;
      for (let i = wordSeenMs.length; i < shown; i++) wordSeenMs[i] = now;
      timeline.push({ ms: Math.round(now), words: shown, kind });
    };

    const finish = (ok, why) => {
      if (done) return;
      done = true;
      clearTimeout(settleTimer);
      try { ws.close(); } catch {}
      if (!ok) die(`${label} ${why}`);
      resolve({ label, commit, chunkMs, transcript: committedParts.join(" ").trim(), timings, timeline, wordSeenMs, audioMs });
    };
    const guard = setTimeout(() => finish(false, "timed out after 90s"), 90_000);
    // finish once commits go quiet (VAD emits several; manual just one)
    const scheduleSettle = (ms) => { clearTimeout(settleTimer); settleTimer = setTimeout(() => { clearTimeout(guard); finish(true); }, ms); };

    ws.addEventListener("error", () => finish(false, "websocket error"));
    ws.addEventListener("close", (e) => { if (!done) finish(false, `websocket closed early (code ${e.code})`); });
    ws.addEventListener("message", (e) => {
      const data = JSON.parse(e.data);
      const text = (data.text ?? data.transcript ?? "").trim();
      if (data.message_type === "partial_transcript") {
        if (!timings.firstPartial && firstChunkAt) timings.firstPartial = performance.now() - firstChunkAt;
        reveal("partial", text ? text.split(/\s+/).length : 0);
        return;
      }
      if (data.message_type === "committed_transcript" || data.message_type === "committed_transcript_with_timestamps") {
        if (text) {
          committedParts.push(text);
          committedWordCount += text.split(/\s+/).length;
          if (!timings.firstCommit && firstChunkAt) timings.firstCommit = performance.now() - firstChunkAt;
          if (audioDoneAt && !timings.settle) timings.settle = performance.now() - audioDoneAt;
          reveal("commit", 0);
        }
        scheduleSettle(1200); // wait a touch for further VAD commits
        return;
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
        await new Promise((r) => setTimeout(r, chunkMs)); // real-time pacing
      }
      audioDoneAt = performance.now();
      // flush the tail either way (VAD finalizes any uncommitted remainder too)
      ws.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", commit: true, sample_rate: RATE }));
      scheduleSettle(4000);
    });
  });
}

/* Estimated per-word lag without server timestamps: real-time paced input
   means a word spoken at audio-second s left the mic at wall-clock ≈ s. We
   don't know each word's exact spoken time, so approximate it by spreading
   the words evenly across the audio duration — good enough to COMPARE two
   strategies on the same audio. lag(i) = seen(i) − evenly-spaced spoken(i). */
function estimatedLag(wordSeenMs, audioMs) {
  const w = wordSeenMs.length;
  if (!w) return null;
  const lags = [];
  for (let i = 0; i < w; i++) {
    const spoken = ((i + 0.5) / w) * audioMs;
    lags.push(wordSeenMs[i] - spoken);
  }
  const sorted = [...lags].sort((a, b) => a - b);
  return {
    count: w,
    median: sorted[Math.floor(w / 2)],
    avg: lags.reduce((s, x) => s + x, 0) / w,
    min: sorted[0],
    max: sorted[w - 1],
  };
}

/* a compact glance at how the text built up over the take */
function sparkline(timeline, audioMs) {
  // one bucket per ~half-second of audio; show the word count shown by then
  const buckets = Math.max(1, Math.ceil(audioMs / 500));
  const at = new Array(buckets).fill(0);
  for (const e of timeline) {
    const b = Math.min(buckets - 1, Math.floor(e.ms / 500));
    at[b] = Math.max(at[b], e.words);
  }
  for (let i = 1; i < buckets; i++) at[i] = Math.max(at[i], at[i - 1]);
  return at.join(" ");
}

/* ── main ───────────────────────────────────────────────────────── */
const { mono, rate } = parseWav(readFileSync(wavPath));
const pcm = downsampleTo16k(mono, rate);
console.log(`audio: ${wavPath} @${rate}Hz → ${(pcm.length / RATE).toFixed(1)}s @16k\n`);

// The question is no longer chunk size (proven flat) — it's how fast
// ElevenLabs emits PARTIALS mid-stream, i.e. the model's own live-caption
// latency. Fixed 100ms chunks; manual vs vad only to show commit strategy
// doesn't change the mid-sentence cadence.
const RUNS = [
  { chunkMs: 100, commit: "manual" },
  { chunkMs: 100, commit: "vad" },
];

const results = [];
for (const cfg of RUNS) {
  const r = await runSession(pcm, cfg);
  results.push(r);
  console.log(`${r.label} transcript: ${JSON.stringify(r.transcript)}`);
  console.log(`${r.label} build-up (words shown per ½s of audio): ${sparkline(r.timeline, r.audioMs)}\n`);
}

console.log("── setup latency ───────────────────────────────");
for (const r of results) {
  const tt = r.timings;
  console.log(`${r.label.padEnd(16)} · mint ${ms(tt.mint)} · connect ${ms(tt.connect)} · tail-settle ${ms(tt.settle ?? NaN)}`);
}

console.log("\n── live-caption latency (the felt delay) ───────");
console.log("   first-word = speech→first text on screen; per-word lag estimated");
console.log("   by even word spacing (comparable across runs on the same audio).");
for (const r of results) {
  const lag = estimatedLag(r.wordSeenMs, r.audioMs);
  const first = r.timings.firstPartial ?? r.timings.firstCommit;
  if (!lag) { console.log(`${r.label.padEnd(16)} · no words seen`); continue; }
  console.log(
    `${r.label.padEnd(16)} · first-word ${ms(first ?? NaN)} · median-lag ${ms(lag.median)}` +
    ` · avg ${ms(lag.avg)} · max ${ms(lag.max)} · updates=${r.timeline.length}`,
  );
}

for (const r of results) {
  const lower = r.transcript.toLowerCase();
  const missing = expected.filter((w) => !lower.includes(w.toLowerCase()));
  if (!r.transcript.trim()) die(`${r.label} empty transcript`);
  if (missing.length) die(`${r.label} transcript missing: ${missing.join(", ")}`);
}
console.log(`\nPASS: all ${results.length} sessions transcribed ${expected.join(", ")}`);
process.exit(0);
