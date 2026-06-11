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
 *  (Aqua transcription is unaffected; it's plain audio + fetch.) */
export function isIOSStandalone(): boolean {
  return isIOS() && (navigator as { standalone?: boolean }).standalone === true;
}

/* ── Aqua availability: probed once per page load ──────────────────── */

let aquaProbe: Promise<boolean> | null = null;
function aquaAvailable(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!aquaProbe) {
    aquaProbe = fetch("/api/transcribe", {
      method: "GET",
      signal: AbortSignal.timeout(4000),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ available?: boolean }>) : { available: false }))
      .then((d) => d.available === true)
      .catch(() => false);
  }
  return aquaProbe;
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

/* ── public surface ────────────────────────────────────────────────── */

export type SpeechEngineKind = "aqua" | "web";

export type SpeechStatus =
  | "idle"
  | "listening"
  /** recording finished; Aqua is setting the words (~half a second) */
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
  /** finalized phrases (web engine) — ink that has dried */
  segments: SpeechSegment[];
  /** the phrase still forming (web engine) — ink that hasn't */
  interim: string;
  /** live input level 0..1 (aqua engine) for the waveform */
  getLevel: () => number;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const MAX_RECORDING_MS = 5 * 60_000;

/**
 * One hook, two engines. When the server has an Aqua Voice key, Avalon
 * transcribes recordings — the writer's preferred transcriber, and it
 * works in every browser that can record audio. Otherwise the browser's
 * own speech engine streams words live. Every failure surfaces with a
 * reason — voice must never die silently.
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

  /* aqua engine state */
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const aqua = (await aquaAvailable()) && hasRecorder();
      if (!alive) return;
      setEngine(aqua ? "aqua" : getRecognizer() ? "web" : null);
      setResolved(true);
    })();
    return () => {
      alive = false;
      wantedRef.current = false;
      recRef.current?.abort();
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

  /* ── aqua engine ──────────────────────────────────────────────── */

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

  const startAqua = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!wantedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return; // the writer changed their mind while we asked
      }
      streamRef.current = stream;

      // a small ear on the signal, for the waveform
      try {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (Ctx) {
          const ctx = new Ctx();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          audioCtxRef.current = ctx;
          analyserRef.current = analyser;
          levelDataRef.current = new Uint8Array(analyser.frequencyBinCount);
        }
      } catch {
        // no meter is no tragedy
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
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") fail("denied");
      else if (name === "NotFoundError" || name === "OverconstrainedError")
        fail("no-mic");
      else fail("unknown");
    }
  }, [fail, transcribe]);

  const failureSnapshotRef = useRef<SpeechFailure | null>(null);
  useEffect(() => {
    failureSnapshotRef.current = failure;
  }, [failure]);
  const failureSnapshot = () => failureSnapshotRef.current;

  /* ── web engine (browser's own, streams words live) ───────────── */

  const pushSegment = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    segmentsRef.current.push(trimmed);
    setSegments((prev) => [...prev, { id: nextIdRef.current++, text: trimmed }]);
  }, []);

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
    if (engine === "aqua") {
      void startAqua();
    } else {
      try {
        startWeb();
      } catch {
        fail("unknown");
      }
    }
  }, [engine, startAqua, startWeb, fail]);

  const stop = useCallback(() => {
    if (!wantedRef.current) return;
    wantedRef.current = false;
    navigator.vibrate?.([25, 40, 25]);
    if (engine === "aqua") {
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
  }, [engine, settleWeb]);

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
