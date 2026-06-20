"use client";

/* TEMPORARY dev harness for the schedule submission flow. It renders the REAL
   book — chromeless title row, ledger margin dates, tiles, and a live composer
   on the bare sheet — so it reads exactly as it would in the app, not as a demo
   inside a card. Navigate the 7 flows with ← → (arrows / swipe / chevrons); a
   floating HUD names the active flow and carries the rest as pills. Not linked
   anywhere; removed before the feature ships. The seam it drives
   (`keep-sequence.tsx`) stays. */

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { format, subDays } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { WaxStamp } from "@/components/capture/wax-stamp";
import { StampMark } from "@/components/stamp-mark";
import { ScrollTerminus, useScrollEdges } from "@/components/ui/scroll-terminus";
import {
  ComposerWipe,
  FLOWS,
  KeptCard,
  QUILL_SCALE,
  QUILL_SETS,
  resolveFlow,
  useKeepSequence,
  type FlowId,
  type Grade,
  type QuillSet,
} from "@/components/schedule/keep-sequence";
import { cn } from "@/lib/utils";

// the schedule's tile material (the one sanctioned card), shared verbatim.
const TILE =
  "rounded-[6px] border border-rule-faint bg-paper p-2.5 shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]";
const PROSE = "voice-prose line-clamp-6 whitespace-pre-wrap text-[0.9rem] leading-[1.42]";
const SAMPLE = "Mara taught the dog to ring a bell for the door; now it rings it to be polite.";

const TODAY = new Date();
// a few past days so it reads like the book you scroll, today pinned to the foot
const PAST: { d: Date; entries: string[] }[] = [
  { d: subDays(TODAY, 5), entries: ["The barista drew a fern in the foam and apologised for it being a fern."] },
  {
    d: subDays(TODAY, 3),
    entries: [
      "Dad still calls the remote “the clicker.”",
      "Found a 1998 receipt for film developing tucked in a library book.",
    ],
  },
  { d: subDays(TODAY, 1), entries: ["Overheard: “I’m not superstitious, but I am a little stitious.”"] },
];

const HOMES = ["inline", "foot", "ledge", "corner"] as const;
type Home = (typeof HOMES)[number];

function autosize(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

// ── the canvas seal, as the keep affordance ──────────────────────
function Seal({
  set,
  sealKey,
  armed,
  size = 44,
  onPress,
  label = "Keep this",
  className,
}: {
  set: QuillSet;
  sealKey: number;
  armed: boolean;
  size?: number;
  onPress?: () => void;
  label?: string;
  className?: string;
}) {
  // a small seal is undersampled at the dpr cap, so supersample its backing
  // canvas (as the masthead does); taper for larger seals to spare the paint.
  const superSample = size <= 56 ? 4 : size <= 96 ? 2 : 1;
  const seal = (
    <WaxStamp
      playKey={sealKey}
      size={size}
      glyph={`${set}:quill`}
      iconScale={QUILL_SCALE[set]}
      mode="press"
      still={!armed}
      variant="spring"
      superSample={superSample}
    />
  );
  if (!onPress) return <span className={className}>{seal}</span>;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      onPointerDown={(e) => e.preventDefault()}
      className={cn("relative grid place-items-center rounded-full", className)}
      style={{ width: size, height: size }}
    >
      {seal}
    </button>
  );
}

// a pressable standing entry, in the real ScheduleCards material.
function EntryTile({ text }: { text: string }) {
  return (
    <button type="button" className={cn("pressable isolate block w-full text-left hover:bg-paper-raised", TILE)}>
      <p className={PROSE}>{text}</p>
    </button>
  );
}

// the REAL composer — faithful to BackfillCapture: a tile you type into, its
// paint fading rightward until words stand in it, the seal once there's text.
function Composer({
  value,
  onChange,
  onKeep,
  areaRef,
  placeholder = "Add something from today…",
  seal,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeep?: () => void;
  areaRef?: React.RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
  seal?: React.ReactNode;
}) {
  const inner = useRef<HTMLTextAreaElement>(null);
  const ref = areaRef ?? inner;
  const hasText = value.trim().length > 0;
  return (
    <div className="relative">
      <div className="group relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[6px] border border-rule-faint bg-paper shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] transition-colors duration-150 [-webkit-mask-image:linear-gradient(to_right,black_35%,transparent_92%)] [mask-image:linear-gradient(to_right,black_35%,transparent_92%)] group-focus-within:border-rule"
        />
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-[6px] border border-rule-faint bg-paper shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] transition-opacity duration-150 group-focus-within:border-rule",
            hasText ? "opacity-100" : "opacity-0",
          )}
        />
        <textarea
          ref={ref}
          value={value}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={(e) => {
            if (onKeep && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              onKeep();
            }
          }}
          className="voice-prose relative block w-full resize-none overflow-hidden bg-transparent p-2.5 text-[0.9rem] leading-[1.42] outline-none placeholder:italic placeholder:text-wax/75"
        />
      </div>
      {hasText && seal && <div className="mt-2 flex justify-end pr-px">{seal}</div>}
    </div>
  );
}

// the words held (non-editable) while the seal presses. Flow D dries them.
function HeldWords({ text, inkDry, dryKey }: { text: string; inkDry?: boolean; dryKey?: number }) {
  return (
    <div className="relative">
      <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0", TILE)} />
      <motion.p
        key={dryKey}
        initial={inkDry ? { filter: "blur(2.5px)", opacity: 0.6 } : false}
        animate={inkDry ? { filter: "blur(0px)", opacity: 1 } : undefined}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="voice-prose relative whitespace-pre-wrap p-2.5 text-[0.9rem] leading-[1.42]"
      >
        {text}
      </motion.p>
    </div>
  );
}

// a day's margin date + content, in the real ledger grammar.
function DaySection({ date, isToday, children }: { date: Date; isToday?: boolean; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[2.1rem_1fr] gap-x-2 border-t border-rule-faint">
      <div className="sticky top-0 self-start pb-3 pt-2 text-center">
        <span className={cn("voice-label block text-[0.62rem] leading-tight", isToday ? "text-wax" : "text-ink-faint")}>
          {format(date, "EEE")}
        </span>
        <span className={cn("voice-display block text-[1.15rem] leading-tight", isToday && "text-wax")}>
          {format(date, "d")}
        </span>
      </div>
      <div className="min-w-0 pb-3 pt-2">{children}</div>
    </section>
  );
}

// ── the live book: past days + today, with the flow on today's composer ──
function BookStage({
  flowId,
  grade,
  quillSet,
  reduce,
  keptWord,
  home,
  demoRef,
  onNav,
}: {
  flowId: FlowId;
  grade: Grade;
  quillSet: QuillSet;
  reduce: boolean;
  keptWord: boolean;
  home: Home;
  demoRef: React.RefObject<(() => void) | null>;
  onNav: (dir: 1 | -1) => void;
}) {
  const spec = resolveFlow(flowId, grade, { keptWord });
  const seq = useKeepSequence(spec, reduce);
  const [cards, setCards] = useState<{ id: string; text: string }[]>([]);
  const [text, setText] = useState("");
  const [held, setHeld] = useState<string | null>(null);
  const queued = useRef<{ id: string; text: string } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(scroller, [cards.length, home]);

  useEffect(() => {
    if (seq.phase !== "carding" || !queued.current) return;
    const card = queued.current;
    queued.current = null;
    setCards((c) => [...c, card]);
    setHeld(null);
  }, [seq.phase]);

  useEffect(() => {
    if (seq.phase !== "composing") return;
    const t = setTimeout(() => areaRef.current?.focus(), Math.max(40, spec.composeMs * 0.5));
    return () => clearTimeout(t);
  }, [seq.phase, spec.composeMs]);

  const keepWith = (trimmed: string) => {
    if (!trimmed || seq.phase !== "idle") return;
    queued.current = { id: `k-${Date.now()}`, text: trimmed };
    setHeld(trimmed);
    setText("");
    if (areaRef.current) {
      areaRef.current.value = "";
      autosize(areaRef.current);
    }
    navigator.vibrate?.(8);
    seq.start();
  };
  const doKeep = () => keepWith(text.trim());

  // the HUD's "demo" pill: fill a sample, show it, then keep — a no-typing
  // compare. Driven through a ref so it's an event, not a setState-in-effect.
  const runDemo = () => {
    if (seq.phase !== "idle") return;
    setText(SAMPLE);
    requestAnimationFrame(() => areaRef.current?.focus());
    setTimeout(() => keepWith(SAMPLE), 600);
  };
  useEffect(() => {
    demoRef.current = runDemo;
  });

  const composerOpen = seq.phase === "idle" || seq.phase === "composing";
  const recoil = spec.recoil && seq.phase === "carding" && !reduce;
  const centre = spec.sealPos !== "corner";

  const composerBlock = (withSeal: boolean) => (
    <div className="relative">
      {seq.phase === "pressing" && held != null && (
        <HeldWords text={held} inkDry={spec.inkDry} dryKey={seq.sealKey} />
      )}
      <ComposerWipe active={composerOpen} style={spec.composerReturn}>
        <Composer
          value={text}
          onChange={setText}
          onKeep={doKeep}
          areaRef={areaRef}
          seal={withSeal ? <Seal set={quillSet} sealKey={seq.sealKey} armed={seq.armed} onPress={doKeep} /> : undefined}
        />
      </ComposerWipe>
    </div>
  );

  // ── horizontal flick → step a flow (the calendar's swipe recipe) ──
  const swipe = useRef<{ x: number; y: number; t: number; ok: boolean } | null>(null);
  const armSwipe = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    const onControl = (e.target as HTMLElement).closest("button, a, textarea, input");
    swipe.current = { x: e.clientX, y: e.clientY, t: performance.now(), ok: !onControl };
  };
  const settleSwipe = (e: React.PointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !s.ok) return;
    const dx = e.clientX - s.x;
    const dy = Math.abs(e.clientY - s.y);
    if (Math.abs(dx) >= 56 && Math.abs(dx) >= dy && performance.now() - s.t <= 700) {
      onNav(dx < 0 ? 1 : -1);
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* the chromeless title row — the page's first line, like the book */}
      <div className="relative flex items-center justify-between pb-2">
        <span className="voice-display whitespace-nowrap text-(length:--date-head)">
          <svg aria-hidden="true" viewBox="0 0 12 20" className="mr-1.5 inline-block h-[0.85em] w-auto align-[-0.05em]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 3 L4 10 L9 17" />
          </svg>
          {format(TODAY, "MMMM yyyy")}
        </span>
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-full border border-rule-faint bg-paper text-ink-soft shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]"
        >
          <svg viewBox="0 0 20 20" className="size-[1.05rem]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="8.6" cy="8.6" r="5" />
            <path d="M12.4 12.4 L16.5 16.5" />
          </svg>
        </span>
      </div>

      {/* the book scroller — exactly the real container */}
      <div
        ref={scroller}
        className="relative -mt-px h-full overflow-y-auto overscroll-contain [overflow-anchor:none] [touch-action:pan-y]"
        style={{ scrollbarWidth: "none" }}
        onPointerDown={armSwipe}
        onPointerUp={settleSwipe}
        onPointerCancel={() => (swipe.current = null)}
        tabIndex={-1}
      >
        {/* the book sticks to its foot — today + composer rest at the bottom,
            past days stack above, bare desk above the oldest shown day */}
        <div className="flex min-h-full flex-col justify-end">
          {/* month hand-over label */}
          <p className="voice-label px-1 pb-1.5 pt-2 text-[0.82rem] text-wax">{format(TODAY, "MMMM yyyy")}</p>

          {PAST.map((row, i) => (
            <DaySection key={i} date={row.d}>
              <ul className="flex flex-col gap-1">
                {row.entries.map((t, j) => (
                  <li key={j}>
                    <EntryTile text={t} />
                  </li>
                ))}
              </ul>
            </DaySection>
          ))}

          {/* today */}
          <DaySection date={TODAY} isToday>
            <motion.ul
              className="flex flex-col gap-1"
              animate={recoil ? { y: [0, 2.5, 0] } : { y: 0 }}
              transition={{ duration: 0.34, ease: [0.23, 1, 0.32, 1] }}
            >
              <AnimatePresence initial={false}>
                {cards.map((s) => (
                  <li key={s.id}>
                    <KeptCard text={s.text} spec={spec} reduce={reduce} />
                  </li>
                ))}
              </AnimatePresence>
            </motion.ul>

            {(home === "inline" || home === "corner") && (
              <div className="mt-1">{composerBlock(home === "inline")}</div>
            )}

            {spec.keptWord && (seq.phase === "carding" || seq.phase === "composing") && (
              <p className="stamp-in mt-1 inline-flex items-center gap-1.5 px-2.5 font-serif text-[0.85rem] not-italic text-wax">
                <StampMark /> Kept.
              </p>
            )}
          </DaySection>

          {/* desk-ledge tray (home: ledge) */}
          {home === "ledge" && (
            <div className="ml-[calc(2.1rem+0.5rem)] mt-2 rounded-[8px] border border-rule-faint bg-paper-recessed p-2 shadow-[inset_0_1px_0_var(--press-highlight)]">
              {composerBlock(true)}
            </div>
          )}

          {/* pinned-foot composer (home: foot) */}
          {home === "foot" && (
            <div className="sticky bottom-0 z-10 -mx-2 mt-1 border-t border-rule-faint bg-paper px-2 pb-1 pt-2">
              {composerBlock(true)}
            </div>
          )}

          {/* resting corner seal (home: corner) */}
          {home === "corner" && (
            <div className="pointer-events-none sticky bottom-0 z-10 flex justify-end pb-4 pr-1">
              <div className="pointer-events-auto drop-shadow-[0_4px_10px_rgb(var(--shadow-hue)/0.3)]">
                <Seal set={quillSet} sealKey={seq.sealKey} armed={seq.armed} onPress={doKeep} size={56} />
              </div>
            </div>
          )}
        </div>

        <ScrollTerminus show={edges.bottom} />
      </div>

      {/* the centred / travelling seal plays over the book during the press */}
      {centre && (seq.phase === "pressing" || seq.phase === "carding") && (
        <motion.div
          key={seq.sealKey}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 grid place-items-center"
          initial={spec.sealPos === "travel" ? { x: 80, y: 70, scale: 0.6, opacity: 0 } : { opacity: 0 }}
          animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
          transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}
        >
          <Seal set={quillSet} sealKey={seq.sealKey} armed size={92} />
        </motion.div>
      )}
    </div>
  );
}

// ── the floating HUD ──────────────────────────────────────────────
const underlineSpring = { type: "spring", stiffness: 480, damping: 40 } as const;

function Pill({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "voice-label rounded-full px-2.5 py-1 text-[0.7rem] leading-none transition-colors",
        active ? "bg-wax text-paper" : "bg-paper-recessed text-ink-soft hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function Chevron({ dir, onClick }: { dir: 1 | -1; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={dir === 1 ? "Next flow" : "Previous flow"}
      onClick={onClick}
      className="pressable grid size-8 shrink-0 place-items-center rounded-full text-ink-soft hover:text-ink"
    >
      <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {dir === 1 ? <path d="M7.5 4 L13.5 10 L7.5 16" /> : <path d="M12.5 4 L6.5 10 L12.5 16" />}
      </svg>
    </button>
  );
}

export default function ScheduleSubmitLab() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const [flowId, setFlowId] = useState<FlowId>("A");
  const [grade, setGrade] = useState<Grade>("lush");
  const [quillSet, setQuillSet] = useState<QuillSet>("e");
  const [reduce, setReduce] = useState(false);
  const [keptWord, setKeptWord] = useState(false);
  const [home, setHome] = useState<Home>("inline");
  const demoRef = useRef<(() => void) | null>(null);

  const idx = FLOWS.findIndex((f) => f.id === flowId);
  const flow = FLOWS[idx];

  const nav = (dir: 1 | -1) => setFlowId(FLOWS[(idx + dir + FLOWS.length) % FLOWS.length].id);
  const cycle = <T,>(list: readonly T[], cur: T, set: (v: T) => void) =>
    set(list[(list.indexOf(cur) + 1) % list.length]);

  // ← → step the flow, unless the caret is in the composer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); nav(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); nav(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  return (
    <div className="relative h-full min-h-0">
      {/* the live, app-faithful book; remounts per flow/home so it's ready to keep */}
      <BookStage
        key={`${flowId}-${home}`}
        flowId={flowId}
        grade={grade}
        quillSet={quillSet}
        reduce={reduce}
        keptWord={keptWord}
        home={home}
        demoRef={demoRef}
        onNav={nav}
      />

      {/* the floating HUD: the active flow + the rest as pills */}
      <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-3">
        <div className="float pointer-events-auto flex max-w-full flex-col items-center gap-1.5 rounded-[1.25rem] px-2.5 py-2">
          <div className="flex items-center gap-1">
            <Chevron dir={-1} onClick={() => nav(-1)} />
            <div className="flex min-w-[10.5rem] flex-col items-center px-1">
              <span className="voice-label text-[0.82rem] text-ink">
                {flow.id} · {flow.name}
              </span>
              <div className="mt-1 flex items-center gap-1">
                {FLOWS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-label={`${f.id} · ${f.name}`}
                    onClick={() => setFlowId(f.id)}
                    className="relative grid h-3 w-3 place-items-center"
                  >
                    <span className="size-1.5 rounded-full bg-rule" />
                    {f.id === flowId && (
                      <motion.span layoutId="flow-dot" transition={underlineSpring} className="absolute inset-0 rounded-full bg-wax" />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <Chevron dir={1} onClick={() => nav(1)} />
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1">
            <Pill active={home !== "inline"} onClick={() => cycle(HOMES, home, setHome)}>home: {home}</Pill>
            <Pill active={grade === "quick"} onClick={() => setGrade(grade === "lush" ? "quick" : "lush")}>{grade}</Pill>
            <Pill onClick={() => cycle(QUILL_SETS, quillSet, setQuillSet)}>quill: {quillSet}</Pill>
            <Pill onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? "lamplight" : "paper"}</Pill>
            <Pill active={keptWord} onClick={() => setKeptWord((v) => !v)}>“kept.”</Pill>
            <Pill active={reduce} onClick={() => setReduce((v) => !v)}>reduced</Pill>
            <Pill onClick={() => demoRef.current?.()}>demo ▸</Pill>
          </div>
        </div>
      </div>
    </div>
  );
}
