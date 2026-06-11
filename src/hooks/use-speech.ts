"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/* Web Speech API types are absent from lib.dom — declare what we use. */
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

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) ||
    // iPadOS reports as MacIntel with touch
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Installed to the home screen on iOS — a context where the speech
 *  service is often blocked even though the API object exists. */
export function isIOSStandalone(): boolean {
  return (
    isIOS() &&
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export type SpeechStatus = "idle" | "listening" | "denied" | "error";

/** Why listening failed — so the UI can say something useful. */
export type SpeechFailure =
  | "denied" // mic permission refused
  | "no-mic" // no audio capture device
  | "network" // engine's speech service unreachable
  | "service" // engine refused service (e.g. iOS installed-app context)
  | "unknown";

export interface SpeechSegment {
  id: number;
  text: string;
}

export interface UseSpeech {
  supported: boolean;
  status: SpeechStatus;
  failure: SpeechFailure | null;
  /** finalized phrases, in order — ink that has dried */
  segments: SpeechSegment[];
  /** the phrase still forming — ink that hasn't */
  interim: string;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const noopSubscribe = () => () => {};

/**
 * Listening sessions on mobile end themselves after pauses; while the
 * writer still wants to talk, we quietly start a new session and stitch
 * the segments together. When the session fully settles after stop(),
 * the complete transcript is delivered once via `onSettled`.
 *
 * Every failure surfaces with a reason — voice must never die silently.
 */
export function useSpeech(onSettled?: (spoken: string) => void): UseSpeech {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getRecognizer() !== null,
    () => false,
  );
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [failure, setFailure] = useState<SpeechFailure | null>(null);
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [interim, setInterim] = useState("");

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantedRef = useRef(false);
  const interimRef = useRef("");
  const segmentsRef = useRef<string[]>([]);
  const nextIdRef = useRef(0);
  const startedAtRef = useRef(0);
  const rapidEndsRef = useRef(0);
  const gotResultRef = useRef(false);
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });

  useEffect(() => {
    return () => {
      wantedRef.current = false;
      recRef.current?.abort();
    };
  }, []);

  const pushSegment = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    segmentsRef.current.push(trimmed);
    setSegments((prev) => [...prev, { id: nextIdRef.current++, text: trimmed }]);
  }, []);

  const fail = useCallback((kind: SpeechFailure) => {
    wantedRef.current = false;
    setFailure(kind);
    setStatus(kind === "denied" ? "denied" : "error");
  }, []);

  const settle = useCallback(() => {
    setStatus((s) => (s === "listening" ? "idle" : s));
    const spoken = segmentsRef.current.join(" ").trim();
    if (spoken) {
      // hand the transcript over and clear the slate
      segmentsRef.current = [];
      nextIdRef.current = 0;
      setSegments([]);
      setInterim("");
      onSettledRef.current?.(spoken);
    }
  }, []);

  const spinUp = useCallback(() => {
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
        settle();
        return;
      }
      // Circuit breaker: sessions that die instantly without ever
      // producing a result mean the service is refusing us (common in
      // iOS installed-app contexts). Don't spin forever — say so.
      const lifetime = Date.now() - startedAtRef.current;
      if (lifetime < 500 && !gotResultRef.current) {
        rapidEndsRef.current += 1;
        if (rapidEndsRef.current >= 2) {
          fail("service");
          settle();
          return;
        }
      }
      // the writer is still talking — stitch a new session on
      try {
        startedAtRef.current = Date.now();
        rec.start();
      } catch {
        fail("unknown");
        settle();
      }
    };

    recRef.current = rec;
    startedAtRef.current = Date.now();
    rec.start();
  }, [pushSegment, fail, settle]);

  const start = useCallback(() => {
    if (wantedRef.current) return;
    wantedRef.current = true;
    rapidEndsRef.current = 0;
    gotResultRef.current = false;
    setFailure(null);
    setStatus("listening");
    navigator.vibrate?.(40);
    try {
      spinUp();
    } catch {
      fail("unknown");
    }
  }, [spinUp, fail]);

  const stop = useCallback(() => {
    if (!wantedRef.current) return;
    wantedRef.current = false;
    navigator.vibrate?.([25, 40, 25]);
    setStatus("idle");
    try {
      recRef.current?.stop();
    } catch {
      // session already gone — settle with whatever we have
      settle();
    }
  }, [settle]);

  const reset = useCallback(() => {
    setSegments([]);
    setInterim("");
    interimRef.current = "";
    segmentsRef.current = [];
    nextIdRef.current = 0;
  }, []);

  return { supported, status, failure, segments, interim, start, stop, reset };
}
