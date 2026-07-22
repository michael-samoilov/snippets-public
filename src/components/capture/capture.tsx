"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { addSnippet, StorageWriteError } from "@/lib/db";
import { promptForDate } from "@/lib/kinds";
import {
  isIOSStandalone,
  useSpeech,
  type SpeechSegment,
} from "@/hooks/use-speech";
import { StampMark } from "@/components/stamp-mark";
import { WaxStamp } from "@/components/capture/wax-stamp";
import { copy } from "@/lib/copy";
import { cn, enterFiles, joinText } from "@/lib/utils";
import { useContainedField } from "@/hooks/use-contained-field";

function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * The day's page. Speak or type; either way the words set themselves
 * on paper — spoken phrases arrive word by word, like ink drying.
 * Nothing is asked of you at the moment of capture.
 */
export function Capture() {
  const [text, setText] = useState("");
  const [voiceUsed, setVoiceUsed] = useState(false);
  const [stampCount, setStampCount] = useState(0);
  const [stampVisible, setStampVisible] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // contained like every writing box in the app: capped to the visible area
  // above the keyboard (less the keep seal below), scrolling its own words
  useContainedField(textareaRef, true, 96);
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prompt = promptForDate(new Date());

  const speech = useSpeech((spoken) => {
    setText((prev) => joinText(prev, spoken));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  });

  // grow to fit whatever the field shows, from any source (typing or a batch
  // transcript set all at once) — a layout effect runs after React commits
  // the value, so scrollHeight is current and a rAF can't measure it stale.
  // Contained by useContainedField above: it grows to the cap, then scrolls.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (el) autosize(el);
  }, [text]);

  const listening = speech.status === "listening";
  const transcribing = speech.status === "transcribing";
  // the streaming engines put words down live; batch records, then sets them
  const liveWords =
    speech.engine !== "batch" &&
    (listening || speech.segments.length > 0 || speech.interim.length > 0);
  const recordingQuietly = speech.engine === "batch" && listening;

  // voice must never fail silently — every failure says what happened
  useEffect(() => {
    if (!speech.failure) return;
    const f = copy.capture.voiceFailures;
    const m: { title: string; description: string } =
      speech.failure === "service"
        ? {
            title: f.service.title,
            description: isIOSStandalone()
              ? f.service.descriptionInstalledIOS
              : f.service.descriptionOtherwise,
          }
        : f[speech.failure];
    toast(m.title, { description: m.description });
  }, [speech.failure]);

  useEffect(() => {
    return () => {
      if (stampTimer.current) clearTimeout(stampTimer.current);
    };
  }, []);

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
    if (!trimmed || listening || transcribing) return;
    setText("");
    const el = textareaRef.current;
    if (el) {
      el.value = "";
      autosize(el);
    }
    // a tick on press, then a firmer thud timed to the wax landing (~300ms)
    navigator.vibrate?.([6, 294, 14]);
    // the confirmation stamps beside the action, not in a toast
    setStampCount((n) => n + 1);
    setStampVisible(true);
    if (stampTimer.current) clearTimeout(stampTimer.current);
    stampTimer.current = setTimeout(() => setStampVisible(false), 1300);

    try {
      await addSnippet({
        text: trimmed,
        source: voiceUsed ? "voice" : "typed",
      });
      setVoiceUsed(false);
    } catch (error) {
      // the keep did not take — un-stamp, put the words back, say why
      setStampVisible(false);
      setText(trimmed);
      if (el) {
        el.value = trimmed;
        autosize(el);
      }
      toast(
        error instanceof StorageWriteError && error.full
          ? copy.data.storageFull
          : copy.data.keepFailed,
      );
    }
  }, [text, listening, transcribing, voiceUsed]);

  const hasText = text.trim().length > 0;

  return (
    <section aria-label={copy.capture.sectionLabel}>
      {/* the writing surface, and the seal a keep presses onto it */}
      <div className="relative">
      {liveWords ? (
        <div
          aria-live="polite"
          className="voice-prose min-h-[5.75rem] whitespace-pre-wrap pt-1 text-[1.125rem]"
        >
          {text && <span>{joinText(text, "")} </span>}
          {speech.segments.map((seg) => (
            <Segment key={seg.id} segment={seg} />
          ))}
          {speech.interim && (
            <span className="ink-interim">{speech.interim}</span>
          )}
          {listening && <span className="caret-blink" aria-hidden="true" />}
          {listening &&
            !text &&
            speech.segments.length === 0 &&
            !speech.interim && (
              <span className="italic text-ink-faint">{copy.capture.listeningPlaceholder}</span>
            )}
        </div>
      ) : recordingQuietly || transcribing ? (
        <div
          aria-live="polite"
          className="voice-prose flex min-h-[5.75rem] items-center gap-4 pt-1 text-[1.125rem]"
        >
          {text && (
            <span className="whitespace-pre-wrap">{joinText(text, "")}</span>
          )}
          {recordingQuietly ? (
            <>
              <InkBars getLevel={speech.getLevel} />
              <span className="caret-blink" aria-hidden="true" />
            </>
          ) : (
            <span className="italic text-ink-faint">{copy.capture.settingWords}</span>
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
            // Desktop: Enter files, Shift+Enter is a newline. Touch: Enter is
            // always a newline (no Shift+Enter there) and the seal files.
            if (enterFiles(e)) {
              e.preventDefault();
              void keep();
            }
          }}
          className="voice-prose min-h-[5.75rem] w-full resize-none overflow-y-auto overscroll-contain bg-transparent pt-1 text-[1.125rem] outline-none placeholder:italic placeholder:text-ink-faint focus:placeholder:text-ink-faint/60"
        />
      )}

      {/* the keep seals the page: the same wax, caught mid-press */}
      <AnimatePresence>
        {stampVisible && (
          <motion.div
            key={stampCount}
            aria-hidden="true"
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
          >
            <WaxStamp playKey={stampCount} size={96} variant="spring" />
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {/* controls */}
      <div className="mt-4 flex items-center gap-4 border-t border-rule-faint pt-4">
        {speech.supported && (
          <Seal
            listening={listening}
            busy={transcribing}
            onToggle={toggleListening}
          />
        )}

        <div className="relative flex-1 self-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={
                listening
                  ? "listening"
                  : transcribing
                    ? "transcribing"
                    : stampVisible
                      ? `stamp-${stampCount}`
                      : "hint"
              }
              initial={{ opacity: 0, filter: "blur(2px)" }}
              animate={{ opacity: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(2px)" }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              className="font-serif text-[0.92rem] italic text-ink-faint"
            >
              {listening ? (
                <span className="not-italic text-wax">
                  {copy.capture.listeningHint}
                </span>
              ) : transcribing ? (
                <span className="text-ink-soft">{copy.capture.aMoment}</span>
              ) : stampVisible ? (
                <span
                  className="stamp-in inline-flex items-center gap-1.5 not-italic text-wax"
                  role="status"
                >
                  <StampMark /> {copy.keep.stampedToday}
                </span>
              ) : !speech.resolved || speech.supported ? (
                copy.capture.hint
              ) : (
                copy.capture.noVoiceHint
              )}
            </motion.p>
          </AnimatePresence>
        </div>

        <button
          type="button"
          onClick={() => void keep()}
          disabled={!hasText || listening || transcribing}
          className={cn(
            "rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper",
            "bg-[linear-gradient(to_bottom,rgb(255_255_255/0.1),transparent_60%)] bg-ink",
            "shadow-[inset_0_1px_0_rgb(255_255_255/0.12),0_1px_2px_rgb(var(--shadow-hue)/0.25),0_3px_6px_-2px_rgb(var(--shadow-hue)/0.3)]",
            "transition-[opacity,transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
            "active:translate-y-px active:scale-[0.98] active:shadow-[inset_0_1px_2px_rgb(0_0_0/0.25)]",
            "disabled:pointer-events-none",
            hasText && !listening && !transcribing ? "opacity-100" : "opacity-0",
          )}
        >
          {copy.capture.keep}
        </button>
      </div>
    </section>
  );
}

/**
 * Ink before words: a small live waveform in wax while Aqua records.
 * Heights are driven straight from the analyser each frame — React
 * stays out of the render loop. Fast attack, slow decay, like breath.
 */
function InkBars({ getLevel }: { getLevel: () => number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bars = Array.from(el.children) as HTMLElement[];
    const phases = bars.map((_, i) => i * 0.9);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let smoothed = 0;
    let raf = 0;
    const tick = (t: number) => {
      const target = getLevel();
      smoothed += (target - smoothed) * (target > smoothed ? 0.5 : 0.12);
      bars.forEach((bar, i) => {
        const wobble = reduceMotion
          ? 1
          : 0.62 + 0.38 * Math.sin(t / 170 + phases[i]);
        bar.style.height = `${4 + smoothed * 26 * wobble}px`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getLevel]);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="flex h-8 items-center gap-[3px]"
    >
      {Array.from({ length: 7 }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-wax"
          style={{ height: 4 }}
        />
      ))}
    </div>
  );
}

/** A finalized phrase arrives word by word, each blurring into focus. */
function Segment({ segment }: { segment: SpeechSegment }) {
  const words = segment.text.split(/\s+/);
  return (
    <span>
      {words.map((word, i) => (
        <span
          key={`${segment.id}-${i}`}
          className="word-arrive"
          style={{ animationDelay: `${Math.min(i, 18) * 26}ms` }}
        >
          {word}{" "}
        </span>
      ))}
    </span>
  );
}

/**
 * The wax seal. A real material: lit from the upper left, a grooved
 * rim, sitting proud of the paper. Pressing it depresses it; while
 * listening it breathes.
 */
function Seal({
  listening,
  busy = false,
  onToggle,
}: {
  listening: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  return (
    <span className="relative inline-grid place-items-center">
      {listening && (
        <>
          <span
            aria-hidden="true"
            className="seal-ring absolute inset-0 rounded-full bg-wax"
          />
          <span
            aria-hidden="true"
            className="seal-ring seal-ring-late absolute inset-0 rounded-full bg-wax"
          />
        </>
      )}
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={listening}
        aria-busy={busy}
        aria-label={
          busy
            ? copy.capture.seal.busy
            : listening
              ? copy.capture.seal.stop
              : copy.capture.seal.speak
        }
        className={cn(
          "relative grid size-16 shrink-0 place-items-center rounded-full text-paper-raised sm:size-14",
          "bg-[radial-gradient(circle_at_32%_28%,var(--wax-bright)_0%,var(--wax)_48%,var(--wax-deep)_100%)]",
          "shadow-[inset_0_1.5px_2px_rgb(255_255_255/0.3),inset_0_-3px_5px_rgb(0_0_0/0.3),0_1px_2px_rgb(var(--shadow-hue)/0.3),0_5px_12px_-2px_var(--wax-shadow)]",
          "transition-[transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "active:scale-[0.93] active:shadow-[inset_0_2px_5px_rgb(0_0_0/0.4),0_1px_2px_rgb(var(--shadow-hue)/0.25)]",
          listening && "seal-breathe",
          busy && "animate-pulse opacity-80",
        )}
      >
        {/* the grooved rim of the seal */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[5px] rounded-full border border-black/25 shadow-[inset_0_1px_1px_rgb(255_255_255/0.18)]"
        />
        <span className="relative grid place-items-center [grid-template-areas:'icon']">
          <AnimatePresence initial={false}>
            <motion.span
              key={listening ? "stop" : "mic"}
              initial={{ opacity: 0, scale: 0.7, filter: "blur(2px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.7, filter: "blur(2px)" }}
              transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
              className="[grid-area:icon]"
            >
              {listening ? <StopGlyph /> : <MicGlyph />}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>
    </span>
  );
}

function MicGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 drop-shadow-[0_1px_1px_rgb(0_0_0/0.3)]" fill="none" stroke="currentColor" aria-hidden="true">
      <rect x="7.4" y="2.6" width="5.2" height="9.2" rx="2.6" fill="currentColor" stroke="none" />
      <path d="M4.6 9.8 a5.4 5.4 0 0 0 10.8 0" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M10 15.2 V17.6" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function StopGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="size-5 drop-shadow-[0_1px_1px_rgb(0_0_0/0.3)]" aria-hidden="true">
      <rect x="5.8" y="5.8" width="8.4" height="8.4" rx="1.6" fill="currentColor" />
    </svg>
  );
}

/** A tiny wax mark for the "Kept." stamp. */
