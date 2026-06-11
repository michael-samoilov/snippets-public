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

export type SpeechStatus = "idle" | "listening" | "denied" | "error";

export interface SpeechSegment {
  id: number;
  text: string;
}

export interface UseSpeech {
  supported: boolean;
  status: SpeechStatus;
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
 */
export function useSpeech(onSettled?: (spoken: string) => void): UseSpeech {
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getRecognizer() !== null,
    () => false,
  );
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [segments, setSegments] = useState<SpeechSegment[]>([]);
  const [interim, setInterim] = useState("");

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const wantedRef = useRef(false);
  const interimRef = useRef("");
  const segmentsRef = useRef<string[]>([]);
  const nextIdRef = useRef(0);
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

  const spinUp = useCallback(() => {
    const Recognizer = getRecognizer();
    if (!Recognizer) return;

    const rec = new Recognizer();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e) => {
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
      if (e.error === "no-speech" || e.error === "aborted") return;
      wantedRef.current = false;
      setStatus(e.error === "not-allowed" ? "denied" : "error");
    };

    rec.onend = () => {
      // A session ended. If the last words never got finalized, keep them.
      if (interimRef.current) {
        pushSegment(interimRef.current);
        interimRef.current = "";
        setInterim("");
      }
      if (wantedRef.current) {
        // the writer is still talking — stitch a new session on
        try {
          rec.start();
        } catch {
          setStatus("idle");
        }
      } else {
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
      }
    };

    recRef.current = rec;
    rec.start();
  }, [pushSegment]);

  const start = useCallback(() => {
    if (wantedRef.current) return;
    wantedRef.current = true;
    setStatus("listening");
    navigator.vibrate?.(40);
    try {
      spinUp();
    } catch {
      setStatus("error");
      wantedRef.current = false;
    }
  }, [spinUp]);

  const stop = useCallback(() => {
    if (!wantedRef.current) return;
    wantedRef.current = false;
    navigator.vibrate?.([25, 40, 25]);
    recRef.current?.stop();
    setStatus("idle");
  }, []);

  const reset = useCallback(() => {
    setSegments([]);
    setInterim("");
    interimRef.current = "";
    segmentsRef.current = [];
    nextIdRef.current = 0;
  }, []);

  return { supported, status, segments, interim, start, stop, reset };
}
