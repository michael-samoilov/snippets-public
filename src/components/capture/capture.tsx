"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { addSnippet } from "@/lib/db";
import { enrichSnippet } from "@/lib/enrich";
import { promptForDate } from "@/lib/kinds";
import { useSpeech } from "@/hooks/use-speech";
import { cn } from "@/lib/utils";

function joinText(a: string, b: string): string {
  if (!a.trim()) return b;
  if (!b.trim()) return a;
  return `${a.replace(/\s+$/, "")} ${b}`;
}

/**
 * The day's page. Speak or type; either way the words set themselves
 * on paper. Nothing is asked of you at the moment of capture — filing
 * happens afterwards, quietly.
 */
export function Capture() {
  const speech = useSpeech();
  const [text, setText] = useState("");
  const [voiceUsed, setVoiceUsed] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prompt = promptForDate(new Date());

  const listening = speech.status === "listening";
  const transcriptVisible =
    listening || speech.segments.length > 0 || speech.interim.length > 0;

  // After a session ends, fold the finalized transcript into the text.
  useEffect(() => {
    if (listening || speech.segments.length === 0) return;
    const spoken = speech.segments.map((s) => s.text).join(" ");
    setText((prev) => joinText(prev, spoken));
    speech.reset();
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
        autosize(el);
      }
    });
  }, [listening, speech.segments, speech]);

  useEffect(() => {
    if (speech.status === "denied") {
      toast("The microphone was declined.", {
        description: "Re-allow it in your browser's site settings to speak your snippets.",
      });
    }
  }, [speech.status]);

  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  const toggleListening = useCallback(() => {
    if (listening) {
      speech.stop();
    } else {
      setVoiceUsed(true);
      speech.start();
    }
  }, [listening, speech]);

  const keep = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || listening) return;
    setText("");
    const el = textareaRef.current;
    if (el) {
      el.value = "";
      autosize(el);
    }
    const snippet = await addSnippet({
      text: trimmed,
      source: voiceUsed ? "voice" : "typed",
    });
    setVoiceUsed(false);
    toast("Kept.");
    void enrichSnippet(snippet);
  }, [text, listening, voiceUsed]);

  const hasText = text.trim().length > 0;

  return (
    <section aria-label="Capture a snippet">
      {/* the writing surface */}
      {transcriptVisible ? (
        <div
          aria-live="polite"
          className="voice-prose min-h-[7.5rem] whitespace-pre-wrap pt-1"
        >
          {text && <span>{joinText(text, "")} </span>}
          {speech.segments.map((seg) => (
            <span key={seg.id} className="word-arrive">
              {seg.text}{" "}
            </span>
          ))}
          {speech.interim && (
            <span className="ink-interim">{speech.interim}</span>
          )}
          {listening && <span className="caret-blink" aria-hidden="true" />}
          {listening &&
            !text &&
            speech.segments.length === 0 &&
            !speech.interim && (
              <span className="italic text-ink-faint">Listening…</span>
            )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={text}
          rows={3}
          placeholder={prompt}
          aria-label={prompt}
          onChange={(e) => {
            setText(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void keep();
            }
          }}
          className="voice-prose min-h-[7.5rem] w-full resize-none overflow-hidden bg-transparent pt-1 outline-none placeholder:italic placeholder:text-ink-faint focus:placeholder:text-ink-faint/60"
        />
      )}

      {/* controls */}
      <div className="mt-4 flex items-center gap-4 border-t border-rule-faint pt-4">
        {speech.supported && (
          <button
            type="button"
            onClick={toggleListening}
            aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Speak a snippet"}
            className={cn(
              "relative grid size-14 shrink-0 place-items-center rounded-full text-paper-raised",
              "bg-wax transition-[background-color,transform] duration-150 hover:bg-wax-deep active:scale-95",
            )}
          >
            {listening && (
              <>
                <span aria-hidden="true" className="seal-ring absolute inset-0 rounded-full bg-wax" />
                <span aria-hidden="true" className="seal-ring seal-ring-late absolute inset-0 rounded-full bg-wax" />
              </>
            )}
            <span className="relative">
              {listening ? <StopGlyph /> : <MicGlyph />}
            </span>
          </button>
        )}

        <p className="voice-meta flex-1 normal-case tracking-normal">
          {listening ? (
            <span className="text-wax">Listening — tap the seal to stop</span>
          ) : speech.supported ? (
            "Speak it or write it"
          ) : (
            "Voice capture needs Chrome, Safari, or Edge — writing works everywhere"
          )}
        </p>

        <button
          type="button"
          onClick={() => void keep()}
          disabled={!hasText || listening}
          className={cn(
            "rounded-[3px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper transition-all duration-150",
            "hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none",
            hasText && !listening ? "opacity-100" : "opacity-0",
          )}
        >
          Keep
        </button>
      </div>
    </section>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="7.4" y="2.6" width="5.2" height="9.2" rx="2.6" fill="currentColor" stroke="none" />
      <path d="M4.6 9.8 a5.4 5.4 0 0 0 10.8 0" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 15.2 V17.6" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
      <rect x="5.8" y="5.8" width="8.4" height="8.4" rx="1.6" fill="currentColor" />
    </svg>
  );
}
