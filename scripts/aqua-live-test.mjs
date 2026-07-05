/**
 * Live probe of Aqua's Avalon API — how far does its OpenAI-compatibility
 * actually go? Answers three questions in ONE run, against the real key
 * (AQUA_API_KEY secret) where the network exists. The app can't reach Aqua
 * from the build sandbox, so this is how we learn the protocol for real
 * instead of guessing:
 *
 *   A. file transcription — POST /audio/transcriptions (the documented
 *      "swap Whisper for Avalon" path). Confirms base URL, model, key.
 *   B. streamed output    — the same call with stream:true → does Aqua
 *      stream the transcript text back as OpenAI-style SSE deltas?
 *   C. realtime / ephemeral token — POST the OpenAI-realtime session
 *      endpoints → is there a browser-safe short-lived token, i.e. is TRUE
 *      live (words-as-you-speak) streaming even possible without leaking
 *      the raw key?
 *
 * A✅ = the batch engine works. B✅ = we can stream text out on stop.
 * C✅ = we can build live in-browser streaming like Deepgram/Scribe.
 *
 *   AQUA_API_KEY=… node scripts/aqua-live-test.mjs <audio.wav> [expected…]
 *
 * CI: .github/workflows/aqua-live-test.yml. Spends a little transcription
 * credit (tests A + B). A diagnostic, not a shipped feature.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [, , audioPath, ...expected] = process.argv;
const KEY = process.env.AQUA_API_KEY;
const BASE = (process.env.AQUA_BASE_URL ?? "https://api.aquavoice.com/api/v1").replace(/\/$/, "");
const MODEL = process.env.AQUA_MODEL ?? "avalon-v1.5";

if (!KEY) { console.error("FAIL: AQUA_API_KEY is not set"); process.exit(1); }
if (!audioPath) { console.error("usage: aqua-live-test.mjs <audio> [expected…]"); process.exit(1); }

const mark = (b) => (b ? "PASS ✅" : "FAIL ❌");

/* ── A / B: OpenAI-compatible file transcription (optionally streamed) ── */
async function transcribe(stream) {
  const buf = readFileSync(audioPath);
  const form = new FormData();
  form.append("model", MODEL);
  form.append("file", new Blob([buf]), basename(audioPath));
  if (stream) form.append("stream", "true");
  const t = performance.now();
  let res;
  try {
    res = await fetch(`${BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}` },
      body: form,
    });
  } catch (e) {
    return { ok: false, detail: `request failed: ${e.message ?? e}` };
  }
  const ms = Math.round(performance.now() - t);
  const ctype = res.headers.get("content-type") || "";
  const body = await res.text();
  if (!res.ok) return { ok: false, ms, detail: `HTTP ${res.status} — ${body.slice(0, 300)}` };
  if (stream) {
    const sse = ctype.includes("event-stream");
    const deltas = [...body.matchAll(/"delta"\s*:\s*"([^"]*)"/g)].map((m) => m[1]);
    return { ok: true, ms, sse, chunks: deltas.length, ctype, sample: body.slice(0, 220) };
  }
  let text = "";
  try { text = JSON.parse(body).text ?? ""; } catch { text = body.slice(0, 220); }
  return { ok: true, ms, text };
}

/* ── C: does an OpenAI-realtime-style ephemeral-token endpoint exist? ── */
async function probeToken(path, payload) {
  const t = performance.now();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { status: 0, ms: 0, body: `request failed: ${e.message ?? e}` };
  }
  const ms = Math.round(performance.now() - t);
  return { status: res.status, ms, body: (await res.text()).slice(0, 300) };
}

/* ── run ── */
console.log(`Aqua probe · base=${BASE} · model=${MODEL} · audio=${audioPath}\n`);

console.log("── A. file transcription (documented 'swap Whisper for Avalon') ──");
const a = await transcribe(false);
if (a.ok) {
  const lower = (a.text || "").toLowerCase();
  const missing = expected.filter((w) => !lower.includes(w.toLowerCase()));
  console.log(`${mark(true)} ${a.ms}ms · text: ${JSON.stringify(a.text)}`);
  if (expected.length)
    console.log(`   expected words: ${mark(missing.length === 0)}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
} else {
  console.log(`${mark(false)} ${a.detail}`);
}

console.log("\n── B. streamed output (stream:true → SSE deltas?) ──");
const b = await transcribe(true);
if (b.ok)
  console.log(`${mark(true)} ${b.ms}ms · looks-like-SSE=${b.sse} · delta chunks=${b.chunks} · content-type=${b.ctype}\n   sample: ${JSON.stringify(b.sample)}`);
else console.log(`${mark(false)} ${b.detail}`);

console.log("\n── C. ephemeral token for browser-live (OpenAI-realtime shape?) ──");
const tokenCandidates = [
  ["/realtime/client_secrets", { session: { type: "transcription" } }],
  ["/realtime/sessions", { model: MODEL }],
  ["/realtime/transcription_sessions", { model: MODEL, input_audio_format: "pcm16" }],
];
let ephemeralFound = false;
for (const [path, payload] of tokenCandidates) {
  const r = await probeToken(path, payload);
  const hit = r.status >= 200 && r.status < 300;
  ephemeralFound = ephemeralFound || hit;
  console.log(`${mark(hit)} POST ${path} → HTTP ${r.status} (${r.ms}ms)`);
  if (r.status !== 404 && r.status !== 0) console.log(`   ${r.body}`);
}

console.log("\n── verdict ──");
console.log(`  A (batch upload):     ${a.ok ? "works" : "broken — " + a.detail}`);
console.log(`  B (streamed output):  ${b.ok ? (b.sse ? "SSE deltas" : "returned, not SSE") : "no"}`);
console.log(`  C (browser-live):     ${ephemeralFound ? "ephemeral token exists — TRUE live is possible" : "no ephemeral token found — live needs a server relay"}`);
