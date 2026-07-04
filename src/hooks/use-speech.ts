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

function isIOS(): boolean {
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

let scribeProbe: Promise<boolean> | null = null;
function scribeAvailable(): Promise<boolean> {
  if (!scribeProbe) scribeProbe = probe("/api/scribe-token");
  return scribeProbe;
}

/* ── the warm grant ─────────────────────────────────────────────────
   Scribe tokens are single-use and live 15 minutes, so one is minted
   ahead of time — on page load, and again after each take — and the
   tap opens the socket immediately instead of waiting out a serverless
   round-trip. A stale or missing grant falls back to minting inline. */

interface ScribeGrant {
  token: string;
  model: string;
  ws: string;
  at: number;
}
const GRANT_FRESH_MS = 10 * 60_000; // well inside the token's 15 minutes

let grantBox: ScribeGrant | null = null;
let grantInflight: Promise<void> | null = null;

function mintGrant(): Promise<ScribeGrant | null> {
  return fetch("/api/scribe-token", {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  })
    .then(async (r) => {
      if (!r.ok) return null;
      const g = (await r.json()) as { token?: string; model?: string; ws?: string };
      return g.token && g.model && g.ws
        ? { token: g.token, model: g.model, ws: g.ws, at: Date.now() }
        : null;
    })
    .catch(() => null);
}

function refillGrant(): void {
  if (grantInflight || typeof window === "undefined") return;
  grantInflight = mintGrant()
    .then((g) => {
      if (g) grantBox = g;
    })
    .finally(() => {
      grantInflight = null;
    });
}

/** Take the warm grant if it's fresh (consuming it), and start warming
 *  the next one either way. Null means mint inline. */
function takeGrant(): ScribeGrant | null {
  const g = grantBox;
  grantBox = null;
  refillGrant();
  return g && Date.now() - g.at < GRANT_FRESH_MS ? g : null;
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

/** Server messages we act on (ElevenLabs realtime STT dialect).
 *  The wire field is `text` (per the generated AsyncAPI types) — the
 *  SDK docs' `transcript` is tolerated in case the dialect drifts. */
interface ScribeMessage {
  message_type?: string;
  text?: string;
  transcript?: string;
}
const transcriptOf = (m: ScribeMessage): string => m.text ?? m.transcript ?? "";

/* ── public surface ────────────────────────────────────────────────── */

export type SpeechEngineKind = "scribe" | "batch" | "web";

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

  /* scribe engine state */
  const wsRef = useRef<WebSocket | null>(null);
  const flushRef = useRef<((commit: boolean) => void) | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const watchdogRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [scribe, batch] = await Promise.all([
        scribeAvailable(),
        batchAvailable(),
      ]);
      if (!alive) return;
      const chosen =
        scribe && canStream()
          ? "scribe"
          : batch && hasRecorder()
            ? "batch"
            : getRecognizer()
              ? "web"
              : null;
      setEngine(chosen);
      setResolved(true);
      if (chosen === "scribe") refillGrant(); // the first take starts warm
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

  /* ── scribe engine (ElevenLabs realtime, streams words live) ──── */

  const settleScribe = useCallback(() => {
    watchdogRef.current?.();
    watchdogRef.current = null;
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    // words the server never committed are still words — keep them
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
    if (spoken) {
      navigator.vibrate?.(8);
      deliver(spoken);
    }
  }, [pushSegment, deliver]);

  const startScribe = useCallback(async () => {
    // warm path: a pre-minted grant skips the token round-trip entirely;
    // cold path (first seconds of a page, or a stale grant) mints inline,
    // overlapped with the mic permission ask
    const warm = takeGrant();
    const tokenPromise = warm
      ? null
      : fetch("/api/scribe-token", {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        }).catch(() => null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      mapMicError(err);
      return;
    }
    let grant: { token: string; model: string; ws: string } | null = warm;
    if (!grant) {
      const response = await tokenPromise!;
      if (!wantedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return; // the writer changed their mind while we asked
      }
      if (!response || !response.ok) {
        stream.getTracks().forEach((t) => t.stop());
        fail(response?.status === 503 ? "service" : "network");
        return;
      }
      const minted = (await response.json().catch(() => null)) as {
        token?: string;
        model?: string;
        ws?: string;
      } | null;
      if (minted?.token && minted.model && minted.ws) grant = { token: minted.token, model: minted.model, ws: minted.ws };
    }
    if (!grant || !wantedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      if (wantedRef.current) fail("service");
      return;
    }

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

    const params = new URLSearchParams({
      model_id: grant.model,
      token: grant.token,
      audio_format: "pcm_16000",
      commit_strategy: "manual",
    });
    const ws = new WebSocket(
      `${grant.ws}/v1/speech-to-text/realtime?${params.toString()}`,
    );
    wsRef.current = ws;

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
    const flush = (commit: boolean) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const all = new Float32Array(bufferedLen);
      let offset = 0;
      for (const c of buffered) {
        all.set(c, offset);
        offset += c.length;
      }
      buffered = [];
      bufferedLen = 0;
      ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: int16ToBase64(downsampleTo16k(all, ctx.sampleRate)),
          commit,
          sample_rate: SCRIBE_RATE,
        }),
      );
    };
    flushRef.current = flush;
    let framesSeen = false;
    tap.port.onmessage = (e) => {
      framesSeen = true;
      const chunk = e.data as Float32Array;
      buffered.push(chunk);
      bufferedLen += chunk.length;
      if (bufferedLen >= flushAt) flush(false);
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
      settleScribe();
    }, 3000);
    const stopWatchdog = () => {
      clearTimeout(nudge);
      clearTimeout(giveUp);
    };
    watchdogRef.current = stopWatchdog;

    ws.onmessage = (e) => {
      let data: ScribeMessage;
      try {
        data = JSON.parse(e.data as string) as ScribeMessage;
      } catch {
        return;
      }
      switch (data.message_type) {
        case "partial_transcript": {
          const text = transcriptOf(data);
          interimRef.current = text;
          setInterim(text);
          break;
        }
        case "committed_transcript":
        case "committed_transcript_with_timestamps": {
          const text = transcriptOf(data);
          if (text.trim()) pushSegment(text);
          interimRef.current = "";
          setInterim("");
          // stopping — this commit is the flush we were waiting for
          if (!wantedRef.current) settleScribe();
          break;
        }
        case "session_time_limit_exceeded":
          wantedRef.current = false;
          settleScribe();
          break;
        case "insufficient_audio_activity":
          // benign: an empty take was committed — settle whatever exists
          if (!wantedRef.current) settleScribe();
          break;
        case "auth_error":
        case "quota_exceeded":
        case "unaccepted_terms":
        case "rate_limited":
        case "resource_exhausted":
          fail("service");
          settleScribe();
          break;
        case "transcriber_error":
        case "error":
          fail("transcribe");
          settleScribe();
          break;
        // session_started, commit_throttled, input_error, queue_overflow,
        // chunk_size_exceeded: nothing useful to do mid-take
      }
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return; // we closed it ourselves
      // the service dropped: keep whatever was heard, and say why.
      // (fail() runs first so settle's status reset leaves the error standing)
      fail(wantedRef.current ? "network" : "transcribe");
      settleScribe();
    };

    maxTimerRef.current = setTimeout(() => {
      // hard cap: stop and settle what we have
      if (!wantedRef.current) return;
      wantedRef.current = false;
      flush(true);
      setStatus("transcribing");
      settleTimerRef.current = setTimeout(settleScribe, 4000);
    }, MAX_RECORDING_MS);
  }, [attachMeter, fail, mapMicError, pushSegment, settleScribe]);

  const stopScribe = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // a socket that exists but never opened is a failure to report, not
      // a quiet nothing. (No socket at all = the writer cancelled before
      // the take was even granted — that one stays silent.)
      if (ws && segmentsRef.current.length === 0 && !interimRef.current.trim()) {
        fail("network");
      }
      settleScribe();
      return;
    }
    setStatus("transcribing");
    flushRef.current?.(true); // remaining audio rides out with the commit
    // the mic light goes off now; the socket only waits for words
    streamRef.current?.getTracks().forEach((t) => t.stop());
    settleTimerRef.current = setTimeout(settleScribe, 4000); // never hang
  }, [settleScribe, fail]);

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
    setStatus("listening");
    navigator.vibrate?.(40);
    if (engine === "scribe") {
      void startScribe();
    } else if (engine === "batch") {
      void startBatch();
    } else {
      try {
        startWeb();
      } catch {
        fail("unknown");
      }
    }
  }, [engine, startScribe, startBatch, startWeb, fail]);

  const stop = useCallback(() => {
    if (!wantedRef.current) return;
    wantedRef.current = false;
    navigator.vibrate?.([25, 40, 25]);
    if (engine === "scribe") {
      stopScribe();
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
  }, [engine, stopScribe, settleWeb]);

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
    segments,
    interim,
    getLevel,
    start,
    stop,
    reset,
  };
}
