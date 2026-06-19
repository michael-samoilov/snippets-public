"use client";

/* TEMPORARY dev harness for the schedule submission flow — comparing how a
   kept snippet is stamped onto its day. Mirrors the /lab/stamp pattern; uses
   the REAL wax-seal engine and the REAL tile/composer materials so anything
   tuned here transfers 1:1 to production. Not linked anywhere; removed before
   the feature ships. The seam it drives (`keep-sequence.tsx`) stays. */

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

const BUILD = "schedule-submit lab · build 1 · flows A–G + bottom zones";

// the schedule's tile material (the one sanctioned card), shared verbatim.
const TILE =
  "rounded-[6px] border border-rule-faint bg-paper p-2.5 shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]";
const PROSE = "voice-prose line-clamp-6 whitespace-pre-wrap text-[0.9rem] leading-[1.42]";

const SEED = [
  "The barista drew a fern in the foam and apologised for it being a fern.",
  "Dad still calls the remote “the clicker.”",
];
const DRAFT = "Mara taught the dog to ring a bell for the door; now it rings it to be polite.";

const today = new Date();

// ── the canvas seal, as the keep affordance ──────────────────────
function Seal({
  set,
  sealKey,
  armed,
  size = 44,
  onPress,
  className,
}: {
  set: QuillSet;
  sealKey: number;
  armed: boolean;
  size?: number;
  onPress?: () => void;
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
      aria-label="Keep this"
      onClick={onPress}
      onPointerDown={(e) => e.preventDefault()}
      className={cn("relative grid place-items-center rounded-full", className)}
      style={{ width: size, height: size }}
    >
      {seal}
    </button>
  );
}

// the margin date + content column of one day, in the real grammar.
function DayGroup({ children }: { children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-[2.1rem_1fr] gap-x-2 border-t border-rule-faint">
      <div className="sticky top-0 self-start pb-3 pt-2 text-center">
        <span className="voice-label block text-[0.62rem] leading-tight text-wax">
          {format(today, "EEE")}
        </span>
        <span className="voice-display block text-[1.15rem] leading-tight text-wax">
          {format(today, "d")}
        </span>
      </div>
      <div className="min-w-0 pb-3 pt-2">{children}</div>
    </section>
  );
}

// the composer, in BackfillCapture's material — words (filled tile) or the
// fading "not yet written" invitation.
function Composer({
  state,
  inkDry,
  dryKey,
  seal,
}: {
  state: "words" | "empty";
  inkDry?: boolean;
  dryKey?: number;
  seal?: React.ReactNode;
}) {
  if (state === "empty") {
    return (
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[6px] border border-rule-faint bg-paper shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] [mask-image:linear-gradient(to_right,black_35%,transparent_92%)] [-webkit-mask-image:linear-gradient(to_right,black_35%,transparent_92%)]"
        />
        <p className="voice-prose relative p-2.5 text-[0.9rem] italic leading-[1.42] text-wax/75">
          Add something from today…
        </p>
      </div>
    );
  }
  return (
    <div className="relative">
      <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0", TILE)} />
      <motion.p
        key={dryKey}
        initial={inkDry ? { filter: "blur(2.5px)", opacity: 0.6 } : false}
        animate={inkDry ? { filter: "blur(0px)", opacity: 1 } : undefined}
        transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
        className="voice-prose relative p-2.5 text-[0.9rem] leading-[1.42]"
      >
        {DRAFT}
      </motion.p>
      {seal && <div className="mt-2 flex justify-end pr-px">{seal}</div>}
    </div>
  );
}

// ── one playable run of a flow ───────────────────────────────────
function FlowDemo({
  flowId,
  grade,
  quillSet,
  reduce,
  keptWord,
  autostart,
}: {
  flowId: FlowId;
  grade: Grade;
  quillSet: QuillSet;
  reduce: boolean;
  keptWord: boolean;
  autostart: number;
}) {
  const spec = resolveFlow(flowId, grade, { keptWord });
  const seq = useKeepSequence(spec, reduce);
  const [kept, setKept] = useState(false);
  const [extra, setExtra] = useState<{ id: string; text: string }[]>([]);
  const queued = useRef<{ id: string; text: string } | null>(null);

  // when the press resolves, the kept card is born into the day. Read the
  // ref ONCE here, not inside the updater — a functional updater can re-run,
  // and a nulled ref would push an empty card and crash the render.
  useEffect(() => {
    if (seq.phase !== "carding" || !queued.current) return;
    const card = queued.current;
    queued.current = null;
    setExtra((e) => [...e, card]);
  }, [seq.phase]);

  const doKeep = () => {
    if (kept) return;
    queued.current = { id: `k-${Date.now()}`, text: DRAFT };
    setKept(true);
    seq.start();
  };

  // autostart on (re)mount when the Replay button bumps the key+flag
  useEffect(() => {
    if (!autostart) return;
    const t = setTimeout(doKeep, 420);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showWords = !kept || seq.phase === "pressing";
  const showEmpty = seq.phase === "composing" || (seq.phase === "idle" && kept);
  const recoil = spec.recoil && seq.phase === "carding" && !reduce;
  const centreSeal = spec.sealPos !== "corner";

  const cornerSeal = (
    <Seal
      set={quillSet}
      sealKey={seq.sealKey}
      armed={seq.armed}
      onPress={doKeep}
      className={cn(centreSeal && (seq.phase === "pressing" || seq.phase === "carding") && "opacity-0")}
    />
  );

  return (
    <div className="relative">
      <DayGroup>
        {/* the standing entries */}
        <motion.ul
          className="flex flex-col gap-1"
          animate={recoil ? { y: [0, 2.5, 0] } : { y: 0 }}
          transition={{ duration: 0.34, ease: [0.23, 1, 0.32, 1] }}
        >
          {SEED.map((t, i) => (
            <li key={i}>
              <div className={cn("isolate block w-full text-left", TILE)}>
                <p className={PROSE}>{t}</p>
              </div>
            </li>
          ))}
          {/* the kept card, born by the flow */}
          <AnimatePresence initial={false}>
            {extra.map((s) => (
              <li key={s.id}>
                <KeptCard text={s.text} spec={spec} reduce={reduce} />
              </li>
            ))}
          </AnimatePresence>
        </motion.ul>

        {/* the composer slot: words during the press, empty wiping in after */}
        <div className="relative mt-1">
          {showWords && (
            <Composer
              state="words"
              inkDry={spec.inkDry}
              dryKey={seq.sealKey}
              seal={!centreSeal ? cornerSeal : undefined}
            />
          )}
          <ComposerWipe active={showEmpty} style={spec.composerReturn}>
            <Composer state="empty" />
          </ComposerWipe>
        </div>

        {/* the typeset confirmation, when a flow keeps the word */}
        {spec.keptWord && (seq.phase === "carding" || seq.phase === "composing") && (
          <p className="stamp-in mt-1 inline-flex items-center gap-1.5 px-2.5 font-serif text-[0.85rem] not-italic text-wax">
            <StampMark /> Kept.
          </p>
        )}
      </DayGroup>

      {/* the centred / travelling seal plays over the day during the press */}
      {centreSeal && (seq.phase === "pressing" || seq.phase === "carding") && (
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

      {/* a quiet trigger when the corner seal is hidden by the flow */}
      {centreSeal && (
        <div className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={doKeep}
            className="rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper"
          >
            Keep
          </button>
        </div>
      )}
    </div>
  );
}

// ── the bottom "today zone" prototypes ───────────────────────────
const ZONES = [
  { id: "B1", name: "Pinned composer foot", blurb: "The today composer sticks at the feed's foot; kept cards file upward above it. (Home for flow E.)" },
  { id: "B2", name: "Desk-ledge tray", blurb: "Below the last tile, a faint recessed ledge holds the composer + a resting seal — the inkwell at the desk's edge." },
  { id: "B3", name: "Resting seal in the corner", blurb: "A settled wax seal parked bottom-right on the desk; pressing it stamps today. A real stamp on the blotter." },
  { id: "B4", name: "Below the last month", blurb: "In the month/year altitudes, the empty whitespace below the last month carries a quiet add-to-today seal." },
] as const;
type ZoneId = (typeof ZONES)[number]["id"];

function ZoneMock({ zone, quillSet }: { zone: ZoneId; quillSet: QuillSet }) {
  const restingSeal = <Seal set={quillSet} sealKey={0} armed={false} size={44} />;
  if (zone === "B1") {
    return (
      <div className="flex h-72 flex-col overflow-hidden rounded-[10px] border border-rule-faint bg-paper">
        <div className="flex-1 space-y-1 overflow-y-auto p-3">
          {[...SEED, "Found a 1998 receipt for film developing in a library book."].map((t, i) => (
            <div key={i} className={cn("text-left", TILE)}>
              <p className={PROSE}>{t}</p>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-rule-faint px-3 py-2.5">
          <p className="voice-prose flex-1 text-[0.9rem] italic text-wax/75">Add something from today…</p>
          {restingSeal}
        </div>
      </div>
    );
  }
  if (zone === "B2") {
    return (
      <div className="rounded-[10px] border border-rule-faint bg-paper p-3">
        <div className={cn("mb-3 text-left", TILE)}>
          <p className={PROSE}>{SEED[0]}</p>
        </div>
        <div className="flex items-center gap-2 rounded-[8px] border border-rule-faint bg-paper-recessed px-3 py-2.5 shadow-[inset_0_1px_0_var(--press-highlight)]">
          <p className="voice-prose flex-1 text-[0.9rem] italic text-wax/75">Add something from today…</p>
          {restingSeal}
        </div>
      </div>
    );
  }
  if (zone === "B3") {
    return (
      <div className="relative h-64 overflow-hidden rounded-[10px] border border-rule-faint bg-paper p-3">
        <div className={cn("text-left", TILE)}>
          <p className={PROSE}>{SEED[1]}</p>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-desk/60 to-transparent" />
        <div className="absolute bottom-4 right-4 drop-shadow-[0_4px_10px_rgb(var(--shadow-hue)/0.3)]">
          <Seal set={quillSet} sealKey={0} armed={false} size={60} />
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
      <div className="mt-6 flex items-center justify-center gap-3 rounded-[8px] py-4">
        {restingSeal}
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
  const [autostart, setAutostart] = useState(0);

  const flow = FLOWS.find((f) => f.id === flowId)!;
  const chip = (active: boolean) =>
    `rounded-[6px] px-3 py-1.5 font-serif text-[0.9rem] ${active ? "bg-wax text-paper" : "bg-paper text-ink border border-rule-faint"}`;

  const reset = () => setRunKey((k) => k + 1);
  const replay = () => {
    setAutostart((a) => a + 1);
    setRunKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col gap-5 pb-16">
      <h1 className="voice-label">schedule-submit lab</h1>
      <span className="inline-block self-start rounded bg-wax px-2 py-1 font-mono text-[0.72rem] text-paper">
        {BUILD}
      </span>

      {/* global controls */}
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

      {/* flow picker */}
      <div className="flex flex-wrap items-center gap-2">
        {FLOWS.map((f) => (
          <button key={f.id} type="button" onClick={() => { setFlowId(f.id); reset(); }} className={chip(flowId === f.id)}>
            {f.id} · {f.name}
          </button>
        ))}
      </div>
      <p className="voice-prose -mt-2 max-w-[40rem] text-[0.92rem] italic text-ink-soft">{flow.blurb}</p>

      <div className="flex items-center gap-3">
        <button type="button" onClick={replay} className="rounded-[5px] bg-ink px-5 py-2 font-serif text-[0.95rem] text-paper">
          Replay
        </button>
        <button type="button" onClick={reset} className={chip(false)}>
          reset
        </button>
        <span className="voice-data text-ink-faint">tap the seal to keep</span>
      </div>

      {/* the stage */}
      <div className="rounded-[10px] border border-rule-faint bg-paper p-5 sm:p-8">
        <FlowDemo
          key={runKey}
          flowId={flowId}
          grade={grade}
          quillSet={quillSet}
          reduce={reduce}
          keptWord={keptWord}
          autostart={autostart}
        />
      </div>

      {/* bottom "today zone" prototypes */}
      <div className="mt-6 flex flex-col gap-3">
        <h2 className="voice-label text-ink-soft">bottom “today zone” prototypes</h2>
        <div className="flex flex-wrap items-center gap-2">
          {ZONES.map((z) => (
            <button key={z.id} type="button" onClick={() => setZone(z.id)} className={chip(zone === z.id)}>
              {z.id} · {z.name}
            </button>
          ))}
        </div>
        <p className="voice-prose max-w-[40rem] text-[0.92rem] italic text-ink-soft">
          {ZONES.find((z) => z.id === zone)!.blurb}
        </p>
        <ZoneMock zone={zone} quillSet={quillSet} />
      </div>
    </div>
  );
}
