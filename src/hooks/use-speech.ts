"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ── Web Speech API types are absent from lib.dom — declare what we use ── */
interface SRAlternative {
  transcript: string;
}
interface SRResult {
  isFinal: boolean;
  0: SRAlternative;
  length: number;
}
interface SRResultList {
  length: number;
  [index: number]: SRResult;
}
interface SREvent {
  resultIndex: number;
  results: SRResultList;
}
interface SRErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRConstructor = new () => SpeechRecognitionLike;

function getRecognizer(): SRConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRConstructor;
    webkitSpeechRecognition?: SRConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function hasRecorder(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** The scribe engine needs a live PCM tap, not just a recorder. */
function canStream(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof WebSocket !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    (typeof AudioContext !== "undefined" ||
      "webkitAudioContext" in window)
  );
}

function getAudioContext(): AudioContext | null {
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  try {
    return Ctx ? new Ctx() : null;
  } catch {
    return null;
  }
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS reports as MacIntel with touch
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Installed to the home screen on iOS — a context where the built-in
 *  speech service is often blocked even though the API object exists.
 *  (The server engines are unaffected; they're plain audio + network.) */
export function isIOSStandalone(): boolean {
  return isIOS() && (navigator as { standalone?: boolean }).standalone === true;
}

/* ── engine availability: each probed once per page load ───────────── */

function probe(url: string): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return fetch(url, { method: "GET", signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? (r.json() as Promise<{ available?: boolean }>) : { available: false }))
    .then((d) => d.available === true)
    .catch(() => false);
}

/* ── opt-in voice diagnostics ────────────────────────────────────────
   A silent provider fallback is the failure mode to fear: voice "works"
   but never via the engine you think. Turn on a running commentary of
   which provider granted, whether a fallback fired, and what the socket
   heard — with `localStorage['snippets:voice-debug'] = '1'` (or a
   `?voicedebug` query param), so it can be flipped on the live
   deployment, not just in dev. Off by default; zero cost when off. */
function voiceDebugOn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.localStorage?.getItem("snippets:voice-debug") === "1" ||
      new URLSearchParams(window.location.search).has("voicedebug")
    );
  } catch {
    return false;
  }
}
function vlog(...args: unknown[]): void {
  if (voiceDebugOn()) console.info("%c[voice]", "color:#2f6df6;font-weight:600", ...args);
}

/* streaming-provider availability, probed once each per page load */
const probes = new Map<string, Promise<boolean>>();
function providerAvailable(tokenPath: string): Promise<boolean> {
  let p = probes.get(tokenPath);
  if (!p) {
    p = probe(tokenPath);
    probes.set(tokenPath, p);
  }
  return p;
}

/* ── the warm grant ─────────────────────────────────────────────────
   A token is minted ahead of time — on page load, and again after each
   take — so the tap opens the socket immediately instead of waiting out
   a serverless round-trip. Each provider's token has its own lifetime
   (Scribe 15min, Deepgram ~5min), so freshness follows `expiresIn`. A
   stale or missing grant falls back to minting inline. */

interface Grant {
  token: string;
  scheme?: "query" | "bearer" | "token";
  model: string;
  ws: string;
  language?: string;
  expiresIn?: number; // seconds
}

let grantBox: (Grant & { at: number; path: string }) | null = null;
let grantInflight: Promise<void> | null = null;

function mintGrant(tokenPath: string): Promise<Grant | null> {
  return fetch(tokenPath, { method: "POST", signal: AbortSignal.timeout(10_000) })
    .then(async (r) => {
      if (!r.ok) return null;
      const g = (await r.json()) as Grant;
      return g.token && g.model && g.ws ? g : null;
    })
    .catch(() => null);
}

function refillGrant(tokenPath: string): void {
  if (grantInflight || typeof window === "undefined") return;
  grantInflight = mintGrant(tokenPath)
    .then((g) => {
      if (g) grantBox = { ...g, at: Date.now(), path: tokenPath };
    })
    .finally(() => {
      grantInflight = null;
    });
}

/** Take the warm grant if it's fresh and for this provider (consuming
 *  it), and start warming the next. Null means mint inline. */
function takeGrant(tokenPath: string): Grant | null {
  const g = grantBox;
  grantBox = null;
  refillGrant(tokenPath);
  if (!g || g.path !== tokenPath) return null;
  const freshMs = Math.max(0, (g.expiresIn ?? 300) * 1000 - 15_000); // 15s safety
  return Date.now() - g.at < freshMs ? g : null;
}

let batchProbe: Promise<boolean> | null = null;
function batchAvailable(): Promise<boolean> {
  if (!batchProbe) batchProbe = probe("/api/transcribe");
  return batchProbe;
}

function pickMime(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "";
}

/* ── scribe PCM plumbing ────────────────────────────────────────────
   An AudioWorklet taps the mic's Float32 frames; the main thread
   downsamples each ~quarter-second block to 16 kHz Int16 and ships it
   base64 over the socket. Block-independent linear resampling — the
   boundary discontinuity is far below what speech models notice. */

const SCRIBE_RATE = 16000;

let pcmTapUrl: string | null = null;
function getPcmTapUrl(): string {
  if (!pcmTapUrl) {
    pcmTapUrl = URL.createObjectURL(
      new Blob(
        [
          `class PcmTap extends AudioWorkletProcessor {
            process(inputs) {
              const ch = inputs[0] && inputs[0][0];
              if (ch) this.port.postMessage(ch.slice(0));
              return true;
            }
          }
          registerProcessor("pcm-tap", PcmTap);`,
        ],
        { type: "application/javascript" },
      ),
    );
  }
  return pcmTapUrl;
}

function downsampleTo16k(input: Float32Array, inRate: number): Int16Array {
  if (inRate === SCRIBE_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++)
      out[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
    return out;
  }
  const outLen = Math.floor((input.length * SCRIBE_RATE) / inRate);
  const out = new Int16Array(outLen);
  const ratio = inRate / SCRIBE_RATE;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const s = input[i0] + (input[i1] - input[i0]) * (pos - i0);
    out[i] = Math.max(-1, Math.min(1, s)) * 0x7fff;
  }
  return out;
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  const STRIDE = 0x8000;
  for (let i = 0; i < bytes.length; i += STRIDE)
    bin += String.fromCharCode(...bytes.subarray(i, i + STRIDE));
  return btoa(bin);
}

/* ── streaming providers ────────────────────────────────────────────
   Each provider differs only in five spots: how the socket is opened,
   how a PCM block is sent, how a message parses, how the stream is
   flushed at the end, and whether a normal close means "done". Add a
   provider by adding an adapter and listing its name in
   NEXT_PUBLIC_SPEECH_PROVIDERS — everything else is shared. */

/** a normalized event out of a provider's wire message */
type StreamEvent =
  | { kind: "partial"; text: string } // in-progress phrase
  | { kind: "final"; text: string } // a locked-in phrase
  | { kind: "limit" } // hard stop (e.g. time cap) — settle now
  | { kind: "end" } // soft end (e.g. empty take) — settle if stopping
  | { kind: "fail"; reason: SpeechFailure }
  | { kind: "ignore" };

interface StreamAdapter {
  name: "scribe" | "deepgram";
  tokenPath: string;
  /** open the socket from a fresh grant */
  socket: (g: Grant) => WebSocket;
  /** encode + send one 16 kHz Int16 PCM block */
  send: (ws: WebSocket, pcm: Int16Array) => void;
  /** parse a raw server message into a normalized event */
  parse: (raw: string) => StreamEvent;
  /** signal end-of-audio so the provider flushes its finals */
  finalize: (ws: WebSocket) => void;
  /** a normal (1000/1001) close is success, not a dropped connection */
  doneOnClose: boolean;
}

/* ElevenLabs Scribe v2 Realtime — token in the query, base64-JSON audio,
   `message_type`/`text` messages, an empty-audio commit to flush. */
const scribeAdapter: StreamAdapter = {
  name: "scribe",
  tokenPath: "/api/scribe-token",
  socket: (g) => {
    const params = new URLSearchParams({
      model_id: g.model,
      token: g.token,
      audio_format: "pcm_16000",
      commit_strategy: "manual",
    });
    return new WebSocket(`${g.ws}/v1/speech-to-text/realtime?${params}`);
  },
  send: (ws, pcm) =>
    ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: int16ToBase64(pcm),
        commit: false,
        sample_rate: SCRIBE_RATE,
      }),
    ),
  parse: (raw) => {
    let m: { message_type?: string; text?: string; transcript?: string };
    try {
      m = JSON.parse(raw);
    } catch {
      return { kind: "ignore" };
    }
    const text = (m.text ?? m.transcript ?? "").trim();
    switch (m.message_type) {
      case "partial_transcript":
        return { kind: "partial", text };
      case "committed_transcript":
      case "committed_transcript_with_timestamps":
        return { kind: "final", text };
      case "session_time_limit_exceeded":
        return { kind: "limit" };
      case "insufficient_audio_activity":
        return { kind: "end" };
      case "auth_error":
      case "quota_exceeded":
      case "unaccepted_terms":
      case "rate_limited":
      case "resource_exhausted":
        return { kind: "fail", reason: "service" };
      case "transcriber_error":
      case "error":
        return { kind: "fail", reason: "transcribe" };
      default:
        return { kind: "ignore" };
    }
  },
  finalize: (ws) =>
    ws.send(
      JSON.stringify({
        message_type: "input_audio_chunk",
        audio_base_64: "",
        commit: true,
        sample_rate: SCRIBE_RATE,
      }),
    ),
  doneOnClose: false,
};

/* Deepgram Nova-3 — bearer-token subprotocol, raw binary PCM, `Results`
   messages with is_final, CloseStream to flush; closes 1000 when done. */
const deepgramAdapter: StreamAdapter = {
  name: "deepgram",
  tokenPath: "/api/deepgram-token",
  socket: (g) => {
    const params = new URLSearchParams({
      model: g.model,
      language: g.language ?? "multi",
      encoding: "linear16",
      sample_rate: String(SCRIBE_RATE),
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      // opt out of Deepgram's Model Improvement Partnership: without this,
      // pay-as-you-go audio may be retained and used to train their models —
      // the privacy page's "the audio is not kept" depends on this param
      mip_opt_out: "true",
    });
    return new WebSocket(`${g.ws}/v1/listen?${params}`, ["bearer", g.token]);
  },
  send: (ws, pcm) => ws.send(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)),
  parse: (raw) => {
    let m: {
      type?: string;
      is_final?: boolean;
      channel?: { alternatives?: { transcript?: string }[] };
    };
    try {
      m = JSON.parse(raw);
    } catch {
      return { kind: "ignore" };
    }
    if (m.type !== "Results") return { kind: "ignore" };
    const text = (m.channel?.alternatives?.[0]?.transcript ?? "").trim();
    return m.is_final ? { kind: "final", text } : { kind: "partial", text };
  },
  finalize: (ws) => ws.send(JSON.stringify({ type: "CloseStream" })),
  doneOnClose: true,
};

const STREAM_ADAPTERS: Record<string, StreamAdapter> = {
  scribe: scribeAdapter,
  deepgram: deepgramAdapter,
};

/** A batch token in the provider order selects the upload proxy
 *  (/api/transcribe → Aqua Avalon by default). Aqua rides the proxy, not
 *  a live socket: it mints no browser-safe ephemeral token, so a direct
 *  WebSocket would have to carry the raw API key. The proxy keeps the key
 *  server-side. Words land on stop, not as you speak. */
const BATCH_ALIASES = new Set(["aqua", "batch"]);

/** The configured engine order: streaming provider names (deepgram,
 *  scribe) and/or a batch token (aqua/batch). First available wins;
 *  the rest are automatic backups. Set NEXT_PUBLIC_SPEECH_PROVIDERS
 *  (e.g. "aqua,deepgram,scribe" to benchmark Avalon first) and redeploy —
 *  no code change. */
const CONFIGURED_ORDER = (
  process.env.NEXT_PUBLIC_SPEECH_PROVIDERS ?? "deepgram,scribe"
)
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s in STREAM_ADAPTERS || BATCH_ALIASES.has(s));

/** streaming providers only, in order — for the warm grant + runtime fallback */
const PROVIDER_ORDER = CONFIGURED_ORDER.filter((s) => s in STREAM_ADAPTERS);

/* ── public surface ────────────────────────────────────────────────── */

export type SpeechEngineKind = "scribe" | "deepgram" | "batch" | "web";

export type SpeechStatus =
  | "idle"
  | "listening"
  /** recording finished; the transcriber is setting the words */
  | "transcribing"
  | "denied"
  | "error";

/** Why voice failed — so the UI can say something useful. */
export type SpeechFailure =
  | "denied" // mic permission refused
  | "no-mic" // no audio capture device
  | "network" // engine's speech service unreachable
  | "service" // engine refused service (e.g. iOS installed-app context)
  | "transcribe" // recording made it, transcription didn't
  | "too-long" // recording exceeded the limit
  | "unknown";

export interface SpeechSegment {
  id: number;
  text: string;
}

export interface UseSpeech {
  /** false until the engine probe resolves */
  resolved: boolean;
  supported: boolean;
  engine: SpeechEngineKind | null;
  status: SpeechStatus;
  failure: SpeechFailure | null;
  /** true once the mic is actually capturing — the recording wash reveals
   *  on this, so nothing paints before the writer approves the microphone */
  live: boolean;
  /** finalized phrases (streaming engines) — ink that has dried */
  segments: SpeechSegment[];
  /** the phrase still forming (streaming engines) — ink that hasn't */
  interim: string;
  /** live input level 0..1 (server engines) for the waveform */
  getLevel: () => number;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const MAX_RECORDING_MS = 5 * 60_000;

/**
 * One hook, three engines, best first. With an ElevenLabs key the
 * browser streams PCM straight to Scribe v2 Realtime and the words
 * arrive as they're spoken. With a Whisper-dialect key the recording
 * uploads on stop and the words settle a beat later. Otherwise the
 * browser's own speech engine streams words live. Every failure
 * surfaces with a reason — voice must never die silently.
 */
export function useSpeech(onSettled?: (spoken: string) => void): UseSpeech {
  const [resolved, setResolved] = useState(false);
  const [engine, setEngine] = useState<SpeechEngineKind | null>(null);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [failure, setFailure] = useState<SpeechFailure | null>(null);
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [interim, setInterim] = useState("");
  // true once the mic is actually capturing (getUserMedia resolved, or the
  // web recognizer started) — the recording wash reveals on this, so it
  // never paints before the writer approves the microphone
  const [live, setLive] = useState(false);

  const wantedRef = useRef(false);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });

  /* web engine state */
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const interimRef = useRef("");
  const segmentsRef = useRef<string[]>([]);
  const nextIdRef = useRef(0);
  const startedAtRef = useRef(0);
  const rapidEndsRef = useRef(0);
  const gotResultRef = useRef(false);

  /* mic plumbing shared by the server engines */
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* streaming engine state */
  const adapterRef = useRef<StreamAdapter | null>(null);
  // every configured streaming provider, in preference order — the first
  // is the default, the rest are runtime backups a failed grant falls to
  const availableStreamsRef = useRef<StreamAdapter[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const flushRef = useRef<(() => void) | null>(null); // flush buffered audio
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      // collect every configured streaming provider in preference order:
      // the first is the default, the rest are runtime backups the tap
      // falls to if the default won't grant a token. Fall back to the
      // batch proxy, then the browser's own engine, if none are configured.
      const available: StreamAdapter[] = [];
      if (canStream()) {
        const checks = await Promise.all(
          PROVIDER_ORDER.map((name) =>
            providerAvailable(STREAM_ADAPTERS[name].tokenPath).then(
              (ok) => [name, ok] as const,
            ),
          ),
        );
        for (const [name, ok] of checks)
          if (ok) available.push(STREAM_ADAPTERS[name]);
      }
      availableStreamsRef.current = available;

      // Walk the configured order: the first available streaming provider
      // wins; a batch token (aqua/batch) selects the upload proxy if it's
      // configured. This lets "aqua,deepgram,scribe" force Avalon even when
      // the streaming providers are also live — for accuracy benchmarking.
      let picked: StreamAdapter | null = null;
      let chosen: SpeechEngineKind | null = null;
      for (const token of CONFIGURED_ORDER) {
        const adapter = STREAM_ADAPTERS[token];
        if (adapter) {
          if (available.includes(adapter)) { picked = adapter; chosen = adapter.name; break; }
        } else if (hasRecorder() && (await batchAvailable())) {
          chosen = "batch"; // a batch token whose proxy is configured
          break;
        }
      }
      // nothing configured was available → the batch proxy, then the browser
      if (!chosen) {
        if (hasRecorder() && (await batchAvailable())) chosen = "batch";
        else if (getRecognizer()) chosen = "web";
      }
      if (!alive) return;
      adapterRef.current = picked;
      vlog(
        "engine:",
        chosen,
        "· streaming providers available:",
        available.length ? available.map((a) => a.name).join(", ") : "none",
      );
      setEngine(chosen);
      setResolved(true);
      if (picked) refillGrant(picked.tokenPath); // the first take starts warm
    })();
    return () => {
      alive = false;
      wantedRef.current = false;
      recRef.current?.abort();
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      releaseRecording();
    };

  }, []);

  const fail = useCallback((kind: SpeechFailure) => {
    wantedRef.current = false;
    setLive(false);
    setFailure(kind);
    setStatus(kind === "denied" ? "denied" : "error");
  }, []);

  const deliver = useCallback((spoken: string) => {
    const text = spoken.trim();
    if (text) onSettledRef.current?.(text);
  }, []);

  /* ── shared mic plumbing ──────────────────────────────────────── */

  function releaseRecording() {
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    recorderRef.current = null;
    flushRef.current = null;
  }

  const getLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    const data = levelDataRef.current;
    if (!analyser || !data) return 0;
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    return Math.min(1, sum / data.length / 120);
  }, []);

  /** A small ear on the signal, for the waveform. No meter is no tragedy. */
  const attachMeter = useCallback((ctx: AudioContext, source: MediaStreamAudioSourceNode) => {
    try {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      levelDataRef.current = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      // listening still works
    }
  }, []);

  const mapMicError = useCallback(
    (err: unknown) => {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") fail("denied");
      else if (name === "NotFoundError" || name === "OverconstrainedError")
        fail("no-mic");
      else fail("unknown");
    },
    [fail],
  );

  /* ── segments (streaming engines share these) ─────────────────── */

  const pushSegment = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    segmentsRef.current.push(trimmed);
    setSegments((prev) => [...prev, { id: nextIdRef.current++, text: trimmed }]);
  }, []);

  /* ── streaming engines (scribe, deepgram) — words arrive live ─── */

  const settleStream = useCallback(() => {
    setLive(false);
    watchdogRef.current?.();
    watchdogRef.current = null;
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    // words the server never finalized are still words — keep them
    if (interimRef.current.trim()) pushSegment(interimRef.current);
    interimRef.current = "";
    setInterim("");
    const ws = wsRef.current;
    wsRef.current = null;
    ws?.close();
    releaseRecording();
    setStatus((s) => (s === "listening" || s === "transcribing" ? "idle" : s));
    const spoken = segmentsRef.current.join(" ").trim();
    segmentsRef.current = [];
    nextIdRef.current = 0;
    setSegments([]);
    vlog(
      `${adapterRef.current?.name ?? "stream"}: settled`,
      spoken ? `"${spoken}"` : "(nothing heard)",
    );
    if (spoken) {
      navigator.vibrate?.(8);
      deliver(spoken);
    }
  }, [pushSegment, deliver]);

  /** Try each available streaming provider in order until one grants a
   *  token. The default may answer warm (pre-minted on load / after the
   *  last take); backups mint inline. Null means none would grant one. */
  async function acquireGrant(): Promise<{ adapter: StreamAdapter; grant: Grant } | null> {
    const adapters = availableStreamsRef.current;
    for (let i = 0; i < adapters.length; i++) {
      const adapter = adapters[i];
      // only the default is ever kept warm; consuming it also warms the next
      const warm = i === 0 ? takeGrant(adapter.tokenPath) : null;
      if (warm) {
        vlog(`grant: ${adapter.name} (warm token)`);
        return { adapter, grant: warm };
      }
      const minted = await mintGrant(adapter.tokenPath);
      if (minted) {
        vlog(
          i === 0
            ? `grant: ${adapter.name} (cold mint)`
            : `grant: FELL BACK to ${adapter.name} after ${adapters[0].name} refused a token`,
        );
        return { adapter, grant: minted };
      }
      vlog(
        `grant: ${adapter.name} refused a token — ` +
          (i + 1 < adapters.length ? `trying ${adapters[i + 1].name}` : "no providers left"),
      );
      if (!wantedRef.current) return null; // writer cancelled mid-acquire
    }
    return null;
  }

  const startStream = useCallback(
    async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
      } catch (err) {
        mapMicError(err);
        return;
      }
      if (!wantedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return; // the writer changed their mind while we asked
      }
      setLive(true); // mic is capturing — the recording wash may reveal

      // Acquire a grant, trying each configured provider in preference
      // order. The default may answer from a warm, pre-minted token; a
      // backup mints inline. A provider whose token fails at tap time —
      // bad key, quota, region — falls through to the next, so a
      // configured backup actually takes over instead of the take dying.
      const acquired = await acquireGrant();
      if (!wantedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (!acquired) {
        // no streaming provider would grant a token — the speech service
        // couldn't be reached, not "this browser refuses recognition"
        stream.getTracks().forEach((t) => t.stop());
        fail("network");
        return;
      }
      const { adapter, grant } = acquired;
      adapterRef.current = adapter; // stop()/onclose read the live adapter
      setEngine(adapter.name); // keep the reported engine honest after a fallback
      vlog(`serving via ${adapter.name}`);

      // The context is created AFTER the mic is live, on purpose: iOS
      // switches the hardware audio route when capture starts, and a
      // context created before the switch can sit suspended — or feed the
      // worklet pure silence — with no error anywhere. An active capture
      // session also exempts resume() from the autoplay gesture rules.
      const ctx = getAudioContext();
      if (!ctx) {
        stream.getTracks().forEach((t) => t.stop());
        fail("unknown");
        return;
      }
      streamRef.current = stream;
      audioCtxRef.current = ctx;
      await ctx.resume().catch(() => {});

      try {
        await ctx.audioWorklet.addModule(getPcmTapUrl());
      } catch {
        releaseRecording();
        fail("unknown");
        return;
      }
      if (!wantedRef.current) {
        releaseRecording();
        return;
      }

      const ws = adapter.socket(grant);
      wsRef.current = ws;
      const openedAt = Date.now();
      ws.onopen = () => vlog(`${adapter.name}: socket open`);

      const source = ctx.createMediaStreamSource(stream);
      attachMeter(ctx, source);
      const tap = new AudioWorkletNode(ctx, "pcm-tap", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      source.connect(tap);

      // ship ~a tenth of a second of speech per message — every word waits
      // out one buffer before it can appear, so the buffer stays small
      let buffered: Float32Array[] = [];
      let bufferedLen = 0;
      const flushAt = Math.round(ctx.sampleRate / 10);
      const flush = () => {
        if (ws.readyState !== WebSocket.OPEN || bufferedLen === 0) return;
        const all = new Float32Array(bufferedLen);
        let offset = 0;
        for (const c of buffered) {
          all.set(c, offset);
          offset += c.length;
        }
        buffered = [];
        bufferedLen = 0;
        adapter.send(ws, downsampleTo16k(all, ctx.sampleRate));
      };
      flushRef.current = flush;
      let framesSeen = false;
      tap.port.onmessage = (e) => {
        framesSeen = true;
        const chunk = e.data as Float32Array;
        buffered.push(chunk);
        bufferedLen += chunk.length;
        if (bufferedLen >= flushAt) flush();
      };

      // Silence watchdog. If the worklet has produced nothing, the context
      // is stuck (iOS's route change can suspend it under our feet): first
      // nudge it awake, and if it stays mute, say so — a take must never
      // end as a quiet nothing when the microphone was on.
      const nudge = setTimeout(() => {
        if (!framesSeen) void ctx.resume().catch(() => {});
      }, 1000);
      const giveUp = setTimeout(() => {
        if (framesSeen || !wantedRef.current) return;
        wantedRef.current = false;
        fail("unknown");
        settleStream();
      }, 3000);
      watchdogRef.current = () => {
        clearTimeout(nudge);
        clearTimeout(giveUp);
      };

      let heardFirst = false;
      const noteFirst = (text: string) => {
        if (heardFirst || !text) return;
        heardFirst = true;
        vlog(`${adapter.name}: first words after ${Date.now() - openedAt}ms — "${text}"`);
      };
      ws.onmessage = (e) => {
        const ev = adapter.parse(e.data as string);
        switch (ev.kind) {
          case "partial":
            noteFirst(ev.text);
            interimRef.current = ev.text;
            setInterim(ev.text);
            break;
          case "final":
            noteFirst(ev.text);
            if (ev.text) pushSegment(ev.text);
            interimRef.current = "";
            setInterim("");
            // for providers that don't close on their own (scribe), the
            // final that lands after a stop is the flush we were waiting on
            if (!wantedRef.current && !adapter.doneOnClose) settleStream();
            break;
          case "limit":
            wantedRef.current = false;
            settleStream();
            break;
          case "end":
            if (!wantedRef.current) settleStream();
            break;
          case "fail":
            fail(ev.reason);
            settleStream();
            break;
          case "ignore":
            break;
        }
      };
      ws.onclose = (e) => {
        if (wsRef.current !== ws) return; // we closed it ourselves
        // a normal close after finalize is success for providers that end
        // that way (deepgram); otherwise the service dropped — keep what
        // was heard and say why (fail() before settle so the error stands)
        const normal = e.code === 1000 || e.code === 1001;
        if (adapter.doneOnClose && normal) {
          settleStream();
        } else {
          fail(wantedRef.current ? "network" : "transcribe");
          settleStream();
        }
      };

      maxTimerRef.current = setTimeout(() => {
        // hard cap: stop and settle what we have
        if (!wantedRef.current) return;
        wantedRef.current = false;
        flush();
        adapter.finalize(ws);
        setStatus("transcribing");
        settleTimerRef.current = setTimeout(settleStream, 4000);
      }, MAX_RECORDING_MS);
    },
    [attachMeter, fail, mapMicError, pushSegment, settleStream],
  );

  const stopStream = useCallback(() => {
    const ws = wsRef.current;
    const adapter = adapterRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !adapter) {
      // a socket that exists but never opened is a failure to report, not
      // a quiet nothing. (No socket at all = the writer cancelled before
      // the take was even granted — that one stays silent.)
      if (ws && segmentsRef.current.length === 0 && !interimRef.current.trim()) {
        fail("network");
      }
      settleStream();
      return;
    }
    setStatus("transcribing");
    flushRef.current?.(); // send the last buffered audio…
    adapter.finalize(ws); // …then tell the provider to flush its finals
    // the mic light goes off now; the socket only waits for words
    streamRef.current?.getTracks().forEach((t) => t.stop());
    settleTimerRef.current = setTimeout(settleStream, 4000); // never hang
  }, [settleStream, fail]);

  /* ── batch engine (records, uploads on stop) ──────────────────── */

  const transcribe = useCallback(
    async (blob: Blob) => {
      setStatus("transcribing");
      const post = async () => {
        const form = new FormData();
        form.append("file", blob);
        return fetch("/api/transcribe", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(60_000),
        });
      };
      try {
        let response = await post();
        if (response.status >= 500) response = await post(); // one retry
        if (response.status === 413) {
          fail("too-long");
          return;
        }
        if (response.status === 503) {
          fail("service");
          return;
        }
        if (!response.ok) {
          fail("transcribe");
          return;
        }
        const data = (await response.json()) as { text?: unknown };
        if (typeof data.text !== "string") {
          fail("transcribe");
          return;
        }
        setStatus("idle");
        navigator.vibrate?.(8);
        deliver(data.text);
      } catch {
        fail("transcribe");
      }
    },
    [fail, deliver],
  );

  const startBatch = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!wantedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return; // the writer changed their mind while we asked
      }
      setLive(true); // recording — the wash may reveal
      streamRef.current = stream;

      const ctx = getAudioContext();
      if (ctx) {
        audioCtxRef.current = ctx;
        attachMeter(ctx, ctx.createMediaStreamSource(stream));
      }

      const mime = pickMime();
      mimeRef.current = mime || "audio/webm";
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = () => fail("unknown");
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        chunksRef.current = [];
        releaseRecording();
        if (blob.size > 0 && !failureSnapshot()) void transcribe(blob);
        else setStatus((s) => (s === "listening" ? "idle" : s));
      };
      recorderRef.current = recorder;
      recorder.start();
      maxTimerRef.current = setTimeout(() => {
        // hard cap: stop and transcribe what we have
        wantedRef.current = false;
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      }, MAX_RECORDING_MS);
    } catch (err) {
      mapMicError(err);
    }
  }, [attachMeter, fail, mapMicError, transcribe]);

  const failureSnapshotRef = useRef<SpeechFailure | null>(null);
  useEffect(() => {
    failureSnapshotRef.current = failure;
  }, [failure]);
  const failureSnapshot = () => failureSnapshotRef.current;

  /* ── web engine (browser's own, streams words live) ───────────── */

  const settleWeb = useCallback(() => {
    setLive(false);
    setStatus((s) => (s === "listening" ? "idle" : s));
    const spoken = segmentsRef.current.join(" ").trim();
    if (spoken) {
      segmentsRef.current = [];
      nextIdRef.current = 0;
      setSegments([]);
      setInterim("");
      deliver(spoken);
    }
  }, [deliver]);

  const startWeb = useCallback(() => {
    const Recognizer = getRecognizer();
    if (!Recognizer) return;

    const rec = new Recognizer();
    rec.lang = navigator.language || "en-US";
    // iOS WebKit is unreliable in continuous mode; short sessions
    // stitched by the restart loop behave far better there.
    rec.continuous = !isIOS();
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => setLive(true); // recognition running — the wash reveals

    rec.onresult = (e) => {
      gotResultRef.current = true;
      rapidEndsRef.current = 0;
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          pushSegment(result[0].transcript);
          interimRef.current = "";
        } else {
          interimText += result[0].transcript;
        }
      }
      if (interimText) interimRef.current = interimText;
      setInterim(interimText);
    };

    rec.onerror = (e) => {
      switch (e.error) {
        case "no-speech":
        case "aborted":
          return; // benign; onend handles the rest
        case "not-allowed":
          fail("denied");
          return;
        case "service-not-allowed":
          fail("service");
          return;
        case "audio-capture":
          fail("no-mic");
          return;
        case "network":
          fail("network");
          return;
        default:
          fail("unknown");
      }
    };

    rec.onend = () => {
      // A session ended. If the last words never got finalized, keep them.
      if (interimRef.current) {
        pushSegment(interimRef.current);
        interimRef.current = "";
        setInterim("");
      }
      if (!wantedRef.current) {
        settleWeb();
        return;
      }
      // Circuit breaker: sessions that die instantly without ever
      // producing a result mean the service is refusing us.
      const lifetime = Date.now() - startedAtRef.current;
      if (lifetime < 500 && !gotResultRef.current) {
        rapidEndsRef.current += 1;
        if (rapidEndsRef.current >= 2) {
          fail("service");
          settleWeb();
          return;
        }
      }
      // the writer is still talking — stitch a new session on
      try {
        startedAtRef.current = Date.now();
        rec.start();
      } catch {
        fail("unknown");
        settleWeb();
      }
    };

    recRef.current = rec;
    startedAtRef.current = Date.now();
    rec.start();
  }, [pushSegment, fail, settleWeb]);

  /* ── shared controls ──────────────────────────────────────────── */

  const start = useCallback(() => {
    if (wantedRef.current || !engine) return;
    wantedRef.current = true;
    rapidEndsRef.current = 0;
    gotResultRef.current = false;
    setFailure(null);
    failureSnapshotRef.current = null;
    setLive(false); // stays dark until the mic actually starts capturing
    setStatus("listening");
    navigator.vibrate?.(40);
    if (engine === "scribe" || engine === "deepgram") {
      void startStream();
    } else if (engine === "batch") {
      void startBatch();
    } else {
      try {
        startWeb();
      } catch {
        fail("unknown");
      }
    }
  }, [engine, startStream, startBatch, startWeb, fail]);

  const stop = useCallback(() => {
    if (!wantedRef.current) return;
    wantedRef.current = false;
    navigator.vibrate?.([25, 40, 25]);
    if (engine === "scribe" || engine === "deepgram") {
      stopStream();
      return;
    }
    if (engine === "batch") {
      const recorder = recorderRef.current;
      if (recorder && recorder.state === "recording") {
        recorder.stop(); // onstop → transcribe
      } else {
        releaseRecording();
        setStatus("idle");
      }
      return;
    }
    setStatus("idle");
    try {
      recRef.current?.stop();
    } catch {
      settleWeb();
    }
  }, [engine, stopStream, settleWeb]);

  const reset = useCallback(() => {
    setSegments([]);
    setInterim("");
    interimRef.current = "";
    segmentsRef.current = [];
    nextIdRef.current = 0;
  }, []);

  return {
    resolved,
    supported: engine !== null,
    engine,
    status,
    failure,
    live,
    segments,
    interim,
    getLevel,
    start,
    stop,
    reset,
  };
}
