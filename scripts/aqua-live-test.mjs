/**
 * Live probe of Aqua's Avalon API — how far does its OpenAI-compatibility
 * actually go? Runs the real handshakes in CI (AQUA_API_KEY secret) where
 * the network exists, because the app can't reach Aqua from the build
 * sandbox. This is how we learn the protocol for real instead of guessing.
 *
 *   A. file transcription — POST /audio/transcriptions (the documented
 *      "swap Whisper for Avalon" path). Confirms base URL, model, key.
 *   B. streamed output    — the same call with stream:true → SSE deltas?
 *   C. REALTIME WEBSOCKET — actually try to OPEN a socket at the OpenAI
 *      realtime shapes (wss .../realtime?intent=transcription), authed by
 *      the key via subprotocol (OpenAI's browser flow) AND by ?query, then
 *      speak audio and watch for transcription deltas. A 404 on a token
 *      endpoint does NOT prove the socket is absent — this is the real test.
 *   D. discovery          — GET /models and the realtime token endpoints,
 *      to see what actually exists.
 *
 *   AQUA_API_KEY=… node scripts/aqua-live-test.mjs <audio.wav> [expected…]
 *
 * CI runs it on demand only, from a workflow that holds the key. Spends a
 * little transcription credit. A diagnostic, not a shipped feature.
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
const wsBase = BASE.replace(/^http/, "ws");
const host = new URL(BASE).host;

/* ── the fixture as base64 pcm16 (for the realtime attempts) ── */
function wavPcmBase64() {
  const wav = readFileSync(audioPath);
  let pos = 12, data = null;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    if (id === "data") data = wav.subarray(pos + 8, pos + 8 + size);
    pos += 8 + size + (size % 2);
  }
  return (data ?? Buffer.alloc(0)).toString("base64");
}
const PCM_B64 = wavPcmBase64();

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
      method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form,
    });
  } catch (e) { return { ok: false, detail: `request failed: ${e.message ?? e}` }; }
  const ms = Math.round(performance.now() - t);
  const ctype = res.headers.get("content-type") || "";
  const body = await res.text();
  if (!res.ok) return { ok: false, ms, detail: `HTTP ${res.status} — ${body.slice(0, 300)}` };
  if (stream) {
    const sse = ctype.includes("event-stream");
    const deltas = [...body.matchAll(/"delta"\s*:\s*"([^"]*)"/g)].map((m) => m[1]);
    return { ok: true, ms, sse, chunks: deltas.length, ctype, sample: body.slice(0, 200) };
  }
  let text = "";
  try { text = JSON.parse(body).text ?? ""; } catch { text = body.slice(0, 200); }
  return { ok: true, ms, text };
}

async function getJson(path) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
    return { status: res.status, body: (await res.text()).slice(0, 500) };
  } catch (e) { return { status: 0, body: String(e) }; }
}

async function probeToken(path, payload) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: (await res.text()).slice(0, 250) };
  } catch (e) { return { status: 0, body: String(e) }; }
}

/* ── C: actually try to OPEN a realtime websocket ── */
function wsAttempt(url, auth) {
  return new Promise((resolve) => {
    const events = [];
    let ws, done = false, opened = false;
    const finish = (outcome, detail = "") => {
      if (done) return; done = true;
      try { ws?.close(); } catch {}
      resolve({ url: url.replace(KEY, "<key>"), auth, opened, outcome, detail, events: events.slice(0, 4) });
    };
    const to = setTimeout(() => finish(opened ? "opened-no-transcript" : "timeout"), 6000);
    try {
      ws = auth === "subprotocol"
        ? new WebSocket(url, ["realtime", "openai-insecure-api-key." + KEY, "openai-beta.realtime-v1"])
        : new WebSocket(url);
    } catch (e) { clearTimeout(to); return finish("ctor-threw", String(e).slice(0, 120)); }
    ws.addEventListener("open", () => {
      opened = true;
      try {
        ws.send(JSON.stringify({ type: "session.update", session: { type: "transcription",
          audio: { input: { format: { type: "audio/pcm", rate: 16000 },
          transcription: { model: MODEL } } } } }));
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: PCM_B64 }));
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      } catch {}
    });
    ws.addEventListener("message", (e) => {
      const s = String(e.data).slice(0, 160);
      events.push(s);
      if (/transcription|transcript|delta/i.test(s)) { clearTimeout(to); return finish("TRANSCRIPT", s); }
      if (events.length >= 4) { clearTimeout(to); finish("opened-messages"); }
    });
    ws.addEventListener("error", (e) => { clearTimeout(to); finish(opened ? "opened-then-error" : "connect-error", (e.message || "").slice(0, 120)); });
    ws.addEventListener("close", (e) => { clearTimeout(to); finish(opened ? `closed-${e.code}` : `refused-${e.code}`, (e.reason || "").slice(0, 120)); });
  });
}

/* ── run ── */
console.log(`Aqua probe · base=${BASE} · ws=${wsBase} · model=${MODEL}\n`);

console.log("── A. file transcription (documented 'swap Whisper for Avalon') ──");
const a = await transcribe(false);
if (a.ok) {
  const miss = expected.filter((w) => !(a.text || "").toLowerCase().includes(w.toLowerCase()));
  console.log(`${mark(true)} ${a.ms}ms · text: ${JSON.stringify(a.text)}`);
  if (expected.length) console.log(`   expected words: ${mark(miss.length === 0)}${miss.length ? ` (missing ${miss.join(", ")})` : ""}`);
} else console.log(`${mark(false)} ${a.detail}`);

console.log("\n── B. streamed output (stream:true → SSE deltas?) ──");
const b = await transcribe(true);
console.log(b.ok
  ? `${mark(true)} ${b.ms}ms · SSE=${b.sse} · delta chunks=${b.chunks} · content-type=${b.ctype}`
  : `${mark(false)} ${b.detail}`);

console.log("\n── D. discovery (what exists?) ──");
const models = await getJson("/models");
console.log(`GET /models → HTTP ${models.status}\n   ${models.body}`);
for (const [p, body] of [
  ["/realtime/client_secrets", { session: { type: "transcription" } }],
  ["/realtime/sessions", { model: MODEL }],
]) {
  const r = await probeToken(p, body);
  console.log(`POST ${p} → HTTP ${r.status}${r.status !== 404 ? "  " + r.body : ""}`);
}

console.log("\n── C. realtime WEBSOCKET — actually opening sockets ──");
const urls = [
  `${wsBase}/realtime?intent=transcription`,
  `${wsBase}/realtime`,
  `wss://${host}/v1/realtime?intent=transcription`,
  `wss://${host}/realtime?intent=transcription`,
];
let anyOpened = false, anyTranscript = false;
for (const url of urls) {
  for (const auth of ["subprotocol", "query"]) {
    const target = auth === "query" ? `${url}${url.includes("?") ? "&" : "?"}api_key=${KEY}` : url;
    const r = await wsAttempt(target, auth);
    anyOpened = anyOpened || r.opened;
    anyTranscript = anyTranscript || r.outcome === "TRANSCRIPT";
    console.log(`${r.opened ? "OPENED" : "  —   "} [${auth}] ${r.url} → ${r.outcome}${r.detail ? " :: " + r.detail : ""}`);
    if (r.events.length) console.log(`        first msgs: ${r.events.join(" | ")}`);
  }
}

console.log("\n── verdict ──");
console.log(`  A file transcription:   ${a.ok ? "works" : "broken — " + a.detail}`);
console.log(`  B streamed output:      ${b.ok ? (b.sse ? "SSE deltas" : "one JSON blob, no SSE") : "no"}`);
console.log(`  C realtime websocket:   ${anyTranscript ? "LIVE TRANSCRIPT — a socket works!" : anyOpened ? "a socket OPENED but gave no transcript (needs protocol tuning)" : "no socket opened at any tried URL"}`);
