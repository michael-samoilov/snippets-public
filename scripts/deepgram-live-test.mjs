/**
 * Live-fire latency test of Deepgram Nova-3 streaming — the head-to-head
 * against ElevenLabs Scribe (scripts/scribe-live-test.mjs), on the same
 * audio, reporting the same metrics: first-word time, steady per-word
 * lag, and a build-up sparkline. The question is whether Deepgram is
 * materially faster MID-SENTENCE (ElevenLabs sits ~2s to first word,
 * ~450ms steady).
 *
 * Protocol (verified against @deepgram/sdk, not memory):
 *   wss://api.deepgram.com/v1/listen?<params>
 *   auth  — WebSocket subprotocols ["token", <API_KEY>]
 *   audio — raw binary linear16 PCM frames (NOT base64 JSON)
 *   result— { type:"Results", is_final, channel.alternatives[0].transcript }
 *   close — send { "type":"CloseStream" } to flush finals, then it closes
 *
 *   DEEPGRAM_API_KEY=… node scripts/deepgram-live-test.mjs <speech.wav> [expected…]
 *
 * CI: .github/workflows/deepgram-live-test.yml. Spends a few seconds of
 * Deepgram credit per run; a diagnostic, not a shipped feature.
 */

import { readFileSync } from "node:fs";

const [, , wavPath, ...expectedWords] = process.argv;
const KEY = process.env.DEEPGRAM_API_KEY;
const BASE = (process.env.DEEPGRAM_BASE_URL ?? "wss://api.deepgram.com").replace(/\/$/, "");
const MODEL = process.env.DEEPGRAM_MODEL ?? "nova-3";
const RATE = 16000;
const expected = expectedWords.length ? expectedWords : ["fox", "morning"];

if (!KEY) die("DEEPGRAM_API_KEY is not set");
if (!wavPath) die("usage: node scripts/deepgram-live-test.mjs <speech.wav> [expected…]");

function die(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }
const ms = (t) => `${Math.round(t)}ms`;

/* ── WAV → Float32 mono (same as the scribe harness) ─────────────── */
function parseWav(buf) {
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") die("not a RIFF/WAVE file");
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
    const p = i * ratio, i0 = Math.floor(p), i1 = Math.min(i0 + 1, input.length - 1);
    const s = input[i0] + (input[i1] - input[i0]) * (p - i0);
    out[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  }
  return out;
}

function estimatedLag(wordSeenMs, audioMs) {
  const w = wordSeenMs.length;
  if (!w) return null;
  const lags = [];
  for (let i = 0; i < w; i++) lags.push(wordSeenMs[i] - ((i + 0.5) / w) * audioMs);
  const sorted = [...lags].sort((a, b) => a - b);
  return { count: w, median: sorted[Math.floor(w / 2)], avg: lags.reduce((s, x) => s + x, 0) / w, min: sorted[0], max: sorted[w - 1] };
}
function sparkline(timeline, audioMs) {
  const buckets = Math.max(1, Math.ceil(audioMs / 500));
  const at = new Array(buckets).fill(0);
  for (const e of timeline) at[Math.min(buckets - 1, Math.floor(e.ms / 500))] = Math.max(at[Math.min(buckets - 1, Math.floor(e.ms / 500))], e.words);
  for (let i = 1; i < buckets; i++) at[i] = Math.max(at[i], at[i - 1]);
  return at.join(" ");
}

/* ── one streaming session at a given language setting ──────────── */
async function runSession(pcm, { chunkMs, language }) {
  const audioMs = (pcm.length / RATE) * 1000;
  const label = `[nova-3·${language}·${chunkMs}ms]`;
  const timings = {};
  const params = new URLSearchParams({
    model: MODEL,
    language,               // "multi" = code-switching; or a code like "en"
    encoding: "linear16",
    sample_rate: String(RATE),
    channels: "1",
    interim_results: "true", // the whole point — live partials
    smart_format: "true",
  });
  const t = performance.now();
  // auth rides the WebSocket subprotocols: ["token", <API_KEY>]
  const ws = new WebSocket(`${BASE}/v1/listen?${params}`, ["token", KEY]);

  return new Promise((resolve) => {
    const finals = [];
    const timeline = [];
    const wordSeenMs = [];
    let committedWordCount = 0;
    let firstChunkAt = 0;
    let audioDoneAt = 0;
    let done = false;
    let settleTimer = null;

    const reveal = (extraPartialWords) => {
      const now = performance.now() - firstChunkAt;
      const shown = committedWordCount + extraPartialWords;
      for (let i = wordSeenMs.length; i < shown; i++) wordSeenMs[i] = now;
      timeline.push({ ms: Math.round(now), words: shown });
    };
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      clearTimeout(settleTimer);
      try { ws.close(); } catch {}
      if (!ok) die(`${label} ${why}`);
      resolve({ label, language, transcript: finals.join(" ").replace(/\s+/g, " ").trim(), timings, timeline, wordSeenMs, audioMs });
    };
    const guard = setTimeout(() => finish(false, "timed out after 90s"), 90_000);
    const scheduleSettle = (wait) => { clearTimeout(settleTimer); settleTimer = setTimeout(() => { clearTimeout(guard); finish(true); }, wait); };

    ws.addEventListener("error", (e) => finish(false, `websocket error ${e.message ?? ""}`));
    ws.addEventListener("close", (e) => { if (!done) finish(false, `closed early (code ${e.code})`); });
    ws.addEventListener("message", (e) => {
      let data;
      try { data = JSON.parse(typeof e.data === "string" ? e.data : e.data.toString()); } catch { return; }
      if (data.type !== "Results") return;
      const text = (data.channel?.alternatives?.[0]?.transcript ?? "").trim();
      const nWords = text ? text.split(/\s+/).length : 0;
      if (text && !timings.firstWord && firstChunkAt) timings.firstWord = performance.now() - firstChunkAt;
      if (data.is_final) {
        if (text) { finals.push(text); committedWordCount += nWords; }
        reveal(0);
        // Only settle AFTER all audio is sent. During streaming, a
        // sentence-final pause emits is_final too — settling on that would
        // close the socket mid-take (the first-sentence-only cutoff bug).
        if (audioDoneAt) {
          if (!timings.settle) timings.settle = performance.now() - audioDoneAt;
          scheduleSettle(1200);
        }
      } else {
        reveal(nWords); // interim: current segment's live words
      }
    });

    ws.addEventListener("open", async () => {
      timings.connect = performance.now() - t;
      const chunkSamples = Math.round((RATE * chunkMs) / 1000);
      for (let off = 0; off < pcm.length && !done; off += chunkSamples) {
        const chunk = pcm.subarray(off, off + chunkSamples);
        if (off === 0) firstChunkAt = performance.now();
        // raw binary PCM — Deepgram wants bytes, not base64 JSON
        ws.send(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        await new Promise((r) => setTimeout(r, chunkMs)); // real-time pacing
      }
      audioDoneAt = performance.now();
      ws.send(JSON.stringify({ type: "CloseStream" })); // flush finals + close
      scheduleSettle(4000);
    });
  });
}

/* ── main ───────────────────────────────────────────────────────── */
const { mono, rate } = parseWav(readFileSync(wavPath));
const pcm = downsampleTo16k(mono, rate);
console.log(`audio: ${wavPath} @${rate}Hz → ${(pcm.length / RATE).toFixed(1)}s @16k\n`);

const RUNS = [
  { chunkMs: 100, language: "multi" }, // the setting we'd ship (code-switching)
  { chunkMs: 100, language: "en" },    // reference: does multi cost latency?
];

const results = [];
for (const cfg of RUNS) {
  const r = await runSession(pcm, cfg);
  results.push(r);
  console.log(`${r.label} transcript: ${JSON.stringify(r.transcript)}`);
  console.log(`${r.label} build-up (words per ½s of audio): ${sparkline(r.timeline, r.audioMs)}\n`);
}

console.log("── live-caption latency (compare to Scribe: first-word ~2013ms, median-lag ~436ms) ──");
for (const r of results) {
  const lag = estimatedLag(r.wordSeenMs, r.audioMs);
  if (!lag) { console.log(`${r.label} · no words seen`); continue; }
  console.log(
    `${r.label.padEnd(22)} · connect ${ms(r.timings.connect)} · first-word ${ms(r.timings.firstWord ?? NaN)}` +
    ` · median-lag ${ms(lag.median)} · avg ${ms(lag.avg)} · max ${ms(lag.max)} · updates=${r.timeline.length}`,
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
