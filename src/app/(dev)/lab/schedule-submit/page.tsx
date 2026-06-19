"use client";

/* TEMPORARY dev harness for the schedule submission flow — comparing how a
   kept snippet is stamped onto its day. Mirrors the /lab/stamp pattern; uses
   the REAL wax-seal engine and the REAL tile/composer materials AND behaviour
   (type into the composer, tap the seal to keep) so anything tuned here
   transfers 1:1 to production. Not linked anywhere; removed before the feature
   ships. The seam it drives (`keep-sequence.tsx`) stays. */

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { format } from "date-fns";
import { AnimatePresence, motion } from "motion/react";
import { WaxStamp } from "@/components/capture/wax-stamp";
import { StampMark } from "@/components/stamp-mark";
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

const BUILD = "schedule-submit lab · build 2 · live composer (type + keep)";

// the schedule's tile material (the one sanctioned card), shared verbatim.
const TILE =
  "rounded-[6px] border border-rule-faint bg-paper p-2.5 shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]";
const PROSE = "voice-prose line-clamp-6 whitespace-pre-wrap text-[0.9rem] leading-[1.42]";

const SEED = [
  "The barista drew a fern in the foam and apologised for it being a fern.",
  "Dad still calls the remote “the clicker.”",
];
const SAMPLE = "Mara taught the dog to ring a bell for the door; now it rings it to be polite.";

const today = new Date();

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
  const seal = (
    <WaxStamp
      playKey={sealKey}
      size={size}
      glyph={`${set}:quill`}
      iconScale={QUILL_SCALE[set]}
      mode="press"
      still={!armed}
      variant="spring"
    />
  );
  if (!onPress) return <span className={className}>{seal}</span>;
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      // don't steal focus from the field — keep typing straight after
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
    <button
      type="button"
      className={cn(
        "pressable isolate block w-full text-left hover:bg-paper-raised",
        TILE,
      )}
    >
      <p className={PROSE}>{text}</p>
    </button>
  );
}

// the REAL composer: a tile you type into, its paint fading rightward until
// words stand in it, the seal appearing once there's something to keep.
// Faithful to BackfillCapture.
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

// the words held (non-editable) while the seal presses — they've been kept,
// they just haven't landed as a card yet. Flow D dries them first.
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

// the margin date + content column of one day, in the real grammar.
function DayGroup({ children }: { children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[2.1rem_1fr] gap-x-2 border-t border-rule-faint">
      <div className="sticky top-0 self-start pb-3 pt-2 text-center">
        <span className="voice-label block text-[0.62rem] leading-tight text-wax">{format(today, "EEE")}</span>
        <span className="voice-display block text-[1.15rem] leading-tight text-wax">{format(today, "d")}</span>
      </div>
      <div className="min-w-0 pb-3 pt-2">{children}</div>
    </section>
  );
}

// ── one live, playable day of a flow ─────────────────────────────
function FlowDemo({
  flowId,
  grade,
  quillSet,
  reduce,
  keptWord,
  demoSignal,
}: {
  flowId: FlowId;
  grade: Grade;
  quillSet: QuillSet;
  reduce: boolean;
  keptWord: boolean;
  demoSignal: number;
}) {
  const spec = resolveFlow(flowId, grade, { keptWord });
  const seq = useKeepSequence(spec, reduce);
  const [seeds] = useState(() => new Set(SEED.map((_, i) => `s${i}`)));
  const [cards, setCards] = useState(() => SEED.map((t, i) => ({ id: `s${i}`, text: t })));
  const [text, setText] = useState("");
  const [held, setHeld] = useState<string | null>(null);
  const queued = useRef<{ id: string; text: string } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // the press resolves → the kept card is born into the day
  useEffect(() => {
    if (seq.phase !== "carding" || !queued.current) return;
    const card = queued.current;
    queued.current = null;
    setCards((c) => [...c, card]);
    setHeld(null);
  }, [seq.phase]);

  // the composer wipes back in → refocus so the next thought can be typed
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

  // the "Demo keep" button fills a sample and keeps it, for a no-typing compare
  useEffect(() => {
    if (!demoSignal || seq.phase !== "idle") return;
    setText(SAMPLE);
    requestAnimationFrame(() => areaRef.current?.focus());
    const t = setTimeout(() => keepWith(SAMPLE), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoSignal]);

  const composerOpen = seq.phase === "idle" || seq.phase === "composing";
  const recoil = spec.recoil && seq.phase === "carding" && !reduce;
  const centre = spec.sealPos !== "corner";

  return (
    <div className="relative">
      <DayGroup>
        <motion.ul
          className="flex flex-col gap-1"
          animate={recoil ? { y: [0, 2.5, 0] } : { y: 0 }}
          transition={{ duration: 0.34, ease: [0.23, 1, 0.32, 1] }}
        >
          <AnimatePresence initial={false}>
            {cards.map((s) => (
              <li key={s.id}>
                {seeds.has(s.id) ? (
                  <EntryTile text={s.text} />
                ) : (
                  <KeptCard text={s.text} spec={spec} reduce={reduce} />
                )}
              </li>
            ))}
          </AnimatePresence>
        </motion.ul>

        {/* the composer slot: the held words while the seal presses, the live
            composer wiping back in after */}
        <div className="relative mt-1">
          {seq.phase === "pressing" && held != null && (
            <HeldWords text={held} inkDry={spec.inkDry} dryKey={seq.sealKey} />
          )}
          <ComposerWipe active={composerOpen} style={spec.composerReturn}>
            <Composer
              value={text}
              onChange={setText}
              onKeep={doKeep}
              areaRef={areaRef}
              seal={<Seal set={quillSet} sealKey={seq.sealKey} armed={seq.armed} onPress={doKeep} />}
            />
          </ComposerWipe>
        </div>

        {spec.keptWord && (seq.phase === "carding" || seq.phase === "composing") && (
          <p className="stamp-in mt-1 inline-flex items-center gap-1.5 px-2.5 font-serif text-[0.85rem] not-italic text-wax">
            <StampMark /> Kept.
          </p>
        )}
      </DayGroup>

      {/* the centred / travelling seal plays over the day during the press */}
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

// ── the bottom "today zone" prototypes (also live) ───────────────
const ZONES = [
  { id: "B1", name: "Pinned composer foot", blurb: "The today composer sticks at the feed's foot; kept cards file upward above it. (Home for flow E.)" },
  { id: "B2", name: "Desk-ledge tray", blurb: "Below the last tile, a faint recessed ledge holds the composer + a resting seal — the inkwell at the desk's edge." },
  { id: "B3", name: "Resting seal in the corner", blurb: "A settled wax seal parked bottom-right on the desk; pressing it stamps today. A real stamp on the blotter." },
  { id: "B4", name: "Below the last month", blurb: "In the month/year altitudes, the empty whitespace below the last month carries a quiet add-to-today seal." },
] as const;
type ZoneId = (typeof ZONES)[number]["id"];

// a small live keep for the zones: type → tap the seal → the card files in.
function useZoneKeep(initial: string[]) {
  const [cards, setCards] = useState(() => initial.map((t, i) => ({ id: `z${i}`, text: t })));
  const [text, setText] = useState("");
  const [sealKey, setSealKey] = useState(0);
  const keep = () => {
    const t = text.trim();
    if (!t) return;
    setCards((c) => [...c, { id: `zk-${Date.now()}`, text: t }]);
    setText("");
    setSealKey((k) => k + 1);
    navigator.vibrate?.(8);
  };
  return { cards, text, setText, keep, sealKey };
}

function ZoneMock({ zone, quillSet }: { zone: ZoneId; quillSet: QuillSet }) {
  const z = useZoneKeep(zone === "B1" ? [...SEED, "Found a 1998 receipt for film developing in a library book."] : [SEED[0]]);
  const sealFor = (size = 44) => (
    <Seal set={quillSet} sealKey={z.sealKey} armed={z.sealKey > 0} size={size} onPress={z.keep} />
  );

  if (zone === "B1") {
    return (
      <div className="flex h-80 flex-col overflow-hidden rounded-[10px] border border-rule-faint bg-paper">
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          <AnimatePresence initial={false}>
            {z.cards.map((c) => (
              <motion.div
                key={c.id}
                layout="position"
                initial={c.id.startsWith("zk") ? { opacity: 0, y: 10 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", duration: 0.5, bounce: 0.16 }}
              >
                <EntryTile text={c.text} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="border-t border-rule-faint p-3">
          <Composer value={z.text} onChange={z.setText} onKeep={z.keep} seal={sealFor()} />
        </div>
      </div>
    );
  }
  if (zone === "B2") {
    return (
      <div className="rounded-[10px] border border-rule-faint bg-paper p-3">
        <div className="mb-3 space-y-1">
          <AnimatePresence initial={false}>
            {z.cards.map((c) => (
              <motion.div key={c.id} layout="position" initial={c.id.startsWith("zk") ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.5, bounce: 0.16 }}>
                <EntryTile text={c.text} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        <div className="rounded-[8px] border border-rule-faint bg-paper-recessed p-2 shadow-[inset_0_1px_0_var(--press-highlight)]">
          <Composer value={z.text} onChange={z.setText} onKeep={z.keep} seal={sealFor()} />
        </div>
      </div>
    );
  }
  if (zone === "B3") {
    return (
      <div className="relative h-72 overflow-hidden rounded-[10px] border border-rule-faint bg-paper p-3">
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {z.cards.map((c) => (
              <motion.div key={c.id} layout="position" initial={c.id.startsWith("zk") ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.5, bounce: 0.16 }}>
                <EntryTile text={c.text} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        {/* a quick line to stamp; the seal rests on the desk in the corner */}
        <div className="absolute inset-x-3 bottom-3 flex items-end gap-2">
          <div className="flex-1">
            <Composer value={z.text} onChange={z.setText} onKeep={z.keep} />
          </div>
          <div className="shrink-0 drop-shadow-[0_4px_10px_rgb(var(--shadow-hue)/0.3)]">{sealFor(60)}</div>
        </div>
      </div>
    );
  }
  // B4 — a faux month canvas with the zone below the last row
  return (
    <div className="rounded-[10px] border border-rule-faint bg-paper p-4">
      <p className="voice-label mb-2 text-[0.82rem] text-wax">June 2026</p>
      <div className="grid grid-cols-7 gap-px">
        {Array.from({ length: 21 }).map((_, i) => (
          <div key={i} className="aspect-square border-t border-rule-faint text-center">
            <span className="voice-data text-ink-faint">{i + 1}</span>
          </div>
        ))}
      </div>
      <div className="mt-6 flex items-center justify-center gap-3 py-4">
        {sealFor(48)}
        <span className="voice-label text-[0.82rem] text-ink-faint">add to today</span>
      </div>
    </div>
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
  const [zone, setZone] = useState<ZoneId>("B1");
  const [runKey, setRunKey] = useState(0);
  const [demoSignal, setDemoSignal] = useState(0);

  const flow = FLOWS.find((f) => f.id === flowId)!;
  const chip = (active: boolean) =>
    `rounded-[6px] px-3 py-1.5 font-serif text-[0.9rem] ${active ? "bg-wax text-paper" : "bg-paper text-ink border border-rule-faint"}`;

  const reset = () => setRunKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-5 pb-16">
      <h1 className="voice-label">schedule-submit lab</h1>
      <span className="inline-block self-start rounded bg-wax px-2 py-1 font-mono text-[0.72rem] text-paper">{BUILD}</span>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setTheme(dark ? "light" : "dark")} className={chip(false)}>
          {dark ? "Lamplight" : "Paper"}
        </button>
        <button type="button" onClick={() => setGrade(grade === "lush" ? "quick" : "lush")} className={chip(grade === "quick")}>
          {grade}
        </button>
        <button type="button" onClick={() => setReduce((v) => !v)} className={chip(reduce)}>
          reduced motion {reduce ? "on" : "off"}
        </button>
        <button type="button" onClick={() => setKeptWord((v) => !v)} className={chip(keptWord)}>
          “Kept.” {keptWord ? "on" : "off"}
        </button>
        <span className="voice-label ml-2 text-ink-faint">quill</span>
        {QUILL_SETS.map((s) => (
          <button key={s} type="button" onClick={() => setQuillSet(s)} className={chip(quillSet === s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {FLOWS.map((f) => (
          <button key={f.id} type="button" onClick={() => { setFlowId(f.id); reset(); }} className={chip(flowId === f.id)}>
            {f.id} · {f.name}
          </button>
        ))}
      </div>
      <p className="voice-prose -mt-2 max-w-[40rem] text-[0.92rem] italic text-ink-soft">{flow.blurb}</p>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setDemoSignal((d) => d + 1)} className="rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper">
          Demo keep
        </button>
        <button type="button" onClick={reset} className={chip(false)}>
          reset
        </button>
        <span className="voice-data text-ink-faint">type in the composer, then tap the seal</span>
      </div>

      <div className="rounded-[10px] border border-rule-faint bg-paper p-5 sm:p-8">
        <FlowDemo key={runKey} flowId={flowId} grade={grade} quillSet={quillSet} reduce={reduce} keptWord={keptWord} demoSignal={demoSignal} />
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <h2 className="voice-label text-ink-soft">bottom “today zone” prototypes</h2>
        <div className="flex flex-wrap items-center gap-2">
          {ZONES.map((z) => (
            <button key={z.id} type="button" onClick={() => setZone(z.id)} className={chip(zone === z.id)}>
              {z.id} · {z.name}
            </button>
          ))}
        </div>
        <p className="voice-prose max-w-[40rem] text-[0.92rem] italic text-ink-soft">{ZONES.find((z) => z.id === zone)!.blurb}</p>
        <ZoneMock key={zone} zone={zone} quillSet={quillSet} />
      </div>
    </div>
  );
}
