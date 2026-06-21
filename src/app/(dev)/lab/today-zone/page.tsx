"use client";

/* TEMPORARY dev harness exploring a consolidated, simplified "today" entry place
   living in the blank desk area at the bottom of the book AND calendar views.
   It DUPLICATES the real calendar (isolated demo store, like schedule-submit)
   and OVERLAYS the today-zone — the per-day inline composer steps aside
   (ConsolidatedTodayContext) so the zone is the single place to add to today.
   A HUD switches the zone treatments to compare. Not linked in production. */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { MotionConfig, motion } from "motion/react";
import { ulid } from "ulidx";
import CalendarPage from "@/app/calendar/page";
import { WaxStamp } from "@/components/capture/wax-stamp";
import { addSnippet, createSnippetsDb, resetActiveDb, setActiveDb } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import type { Snippet } from "@/lib/types";
import { resolveFlow } from "@/components/schedule/keep-sequence";
import {
  ConsolidatedTodayContext,
  KeepFlowContext,
  KeptDraftContext,
  useKeptDraft,
  type KeepFlow,
  type KeptDraftStore,
} from "@/lib/keep-flow";
import { cn } from "@/lib/utils";

const BUILD = "build 2026-06-20e · today-zone overlay · corner·swell keep";

// ── a compact isolated demo dataset so the book + calendar look lived-in ──
const POOL = [
  "The barista drew a fern in the foam and apologised for it being a fern.",
  "Dad still calls the remote “the clicker.”",
  "Found a 1998 receipt for film developing tucked in a library book.",
  "The man at the bus stop was reading aloud to a pigeon. The pigeon stayed.",
  "Nora called the moon “the night’s nightlight” and went back to sleep.",
  "A whole aisle of the hardware store smelled exactly like my grandfather.",
  "Someone had chalked “you are here, and that’s enough” on the underpass.",
  "Léo lost his first tooth and asked if he could keep the hole.",
  "The piano tuner whistled the note he was chasing, then caught it.",
  "A kid on the train explained black holes to her exhausted mother, kindly.",
  "Rain started and the entire café exhaled at once.",
  "The crossing guard high-fives every dog and most of the children.",
  "We argued for ten minutes about whether a hot dog is a sandwich. Joy.",
  "The toddler applauded the bus for arriving. Honestly, fair.",
  "My coffee order was ready before I finished saying it. We have history.",
  "Someone returned my umbrella to the exact bench. Faith restored.",
  "A man watered the public planters at dawn, asking nobody to notice.",
  "The old couple split one coffee and two newspapers, perfectly content.",
  "The vet called my cat “a strong personality.” She knows.",
  "A snail crossed the whole patio during dinner. We cheered it home.",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ~50 entries across the last ~4 months; today starts blank. */
function generateSeed(): Snippet[] {
  const rand = mulberry32(0x70da2);
  const rows: Snippet[] = [];
  const today = new Date();
  for (let offset = 1; offset <= 120; offset++) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    if (rand() > (offset <= 28 ? 0.7 : 0.42)) continue;
    const count = rand() < 0.7 ? 1 : rand() < 0.92 ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const at = new Date(day);
      at.setHours(9 + Math.floor(rand() * 12), Math.floor(rand() * 60), 0, 0);
      const capturedAt = at.getTime();
      rows.push({
        id: ulid(capturedAt),
        text: POOL[Math.floor(rand() * POOL.length)],
        kind: null,
        tags: [],
        capturedAt,
        day: dayKey(at),
        source: "typed",
        favorite: 0,
        enriched: "done",
        updatedAt: capturedAt,
      });
    }
  }
  return rows;
}

// ── the today-zone (the thing being explored) ─────────────────────
type Treatment = "ledge" | "card" | "line" | "seal";
const TREATMENTS: { id: Treatment; name: string; desc: string }[] = [
  { id: "ledge", name: "Desk ledge", desc: "A recessed tray along the foot — the inkwell at the desk's edge. A one-line field, the seal at its end." },
  { id: "card", name: "Floating card", desc: "A single raised tile hovering over the blank desk — one focused “today” card, lifted off the page." },
  { id: "line", name: "Prompt line", desc: "The lightest touch: one ruled line on the bare desk, an italic prompt, the seal at the end." },
  { id: "seal", name: "Resting seal", desc: "Just the wax seal at rest on the blotter with a quiet word — press it (or the line) to add today." },
];

function Seal({ playKey, onKeep }: { playKey: number; onKeep: () => void }) {
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      aria-label="Keep this"
      onClick={onKeep}
      onPointerDown={(e) => { e.preventDefault(); setDown(true); }}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      className="relative grid shrink-0 place-items-center rounded-full"
      style={{ width: 52, height: 52 }}
    >
      <WaxStamp
        playKey={playKey}
        size={52}
        glyph="e:quill"
        iconScale={0.36}
        mode="tap"
        pressed={down}
        lingerMs={550}
        exitMs={420}
        exit="grow"
        variant="spring"
        ease="front"
        bounce={1.5}
        rotate={30}
        superSample={4}
        ignoreReducedMotion
      />
    </button>
  );
}

function TodayZone({ treatment }: { treatment: Treatment }) {
  const [text, setText] = useState("");
  const [playKey, setPlayKey] = useState(0);
  const draft = useKeptDraft();

  const keep = () => {
    const t = text.trim();
    if (!t) return;
    const capturedAt = Date.now();
    const id = ulid(capturedAt);
    draft?.set({
      id, text: t, kind: null, tags: [], capturedAt, day: dayKey(),
      source: "typed", favorite: 0, enriched: "pending", updatedAt: capturedAt,
    });
    void addSnippet({ id, text: t, source: "typed", capturedAt });
    setText("");
    setPlayKey((k) => k + 1);
    navigator.vibrate?.(8);
  };

  const field = (placeholder: string, extra?: string) => (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); keep(); } }}
      placeholder={placeholder}
      aria-label="Add to today"
      className={cn(
        "voice-prose min-w-0 flex-1 bg-transparent text-[0.95rem] outline-none placeholder:italic placeholder:text-wax/70",
        extra,
      )}
    />
  );

  // each treatment sits in the blank desk at the foot of the view
  if (treatment === "ledge") {
    return (
      <div className="border-t border-rule bg-paper-recessed shadow-[inset_0_1px_0_var(--press-highlight)]">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-2.5">
          <span className="voice-label shrink-0 text-[0.66rem] text-wax">Today</span>
          {field("Add something from today…")}
          <Seal playKey={playKey} onKeep={keep} />
        </div>
      </div>
    );
  }

  if (treatment === "card") {
    return (
      <div className="px-4 pb-4">
        <div className="float mx-auto flex max-w-xl items-center gap-2 rounded-[10px] border border-rule-faint bg-paper px-3 py-2">
          {field("Add something from today…")}
          <Seal playKey={playKey} onKeep={keep} />
        </div>
      </div>
    );
  }

  if (treatment === "line") {
    return (
      <div className="px-5 pb-5">
        <div className="mx-auto flex max-w-xl items-end gap-2 border-b border-rule pb-1">
          <span className="voice-display shrink-0 pb-0.5 text-[0.95rem] text-wax">Today —</span>
          {field("what happened?", "pb-0.5")}
          <Seal playKey={playKey} onKeep={keep} />
        </div>
      </div>
    );
  }

  // "seal": the stamp resting on the blotter, a quiet word beside it
  return (
    <div className="flex items-center justify-end gap-3 px-5 pb-5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); keep(); } }}
        placeholder="Add to today…"
        aria-label="Add to today"
        className="voice-prose w-48 bg-transparent text-right text-[0.92rem] italic outline-none placeholder:text-ink-faint"
      />
      <Seal playKey={playKey} onKeep={keep} />
    </div>
  );
}

// ── the lab shell ─────────────────────────────────────────────────
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

export default function TodayZoneLab() {
  return <Lab />;
}

function Lab() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  // open on the month grid (no ?d) so the calendar context shows immediately;
  // tapping today dives into the book (pushing history, so climbing back works)
  const [labDb] = useState(() => {
    const d = createSnippetsDb("snippets-todayzone");
    setActiveDb(d);
    return d;
  });
  const [seeded, setSeeded] = useState(false);
  const [treatment, setTreatment] = useState<Treatment>("ledge");
  const [consolidated, setConsolidated] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, Snippet>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      if ((await labDb.snippets.count()) === 0) await labDb.snippets.bulkAdd(generateSeed());
      if (alive) setSeeded(true);
    })();
    return () => { alive = false; resetActiveDb(); };
  }, [labDb]);

  const draftStore: KeptDraftStore = useMemo(
    () => ({
      drafts,
      set: (s) => setDrafts((d) => ({ ...d, [s.day]: s })),
      clear: (day) => setDrafts((d) => { const n = { ...d }; delete n[day]; return n; }),
    }),
    [drafts],
  );
  // the chosen keep: flow A — corner · swell
  const flow: KeepFlow = useMemo(
    () => ({ spec: resolveFlow("A", "lush"), quillSet: "e", reduce: false }),
    [],
  );

  const seed = () => void (async () => { await labDb.snippets.clear(); await labDb.snippets.bulkAdd(generateSeed()); })();
  const clear = () => void labDb.snippets.clear();

  if (!seeded) return null;
  const cur = TREATMENTS.find((t) => t.id === treatment)!;

  return (
    <KeepFlowContext.Provider value={flow}>
      <KeptDraftContext.Provider value={draftStore}>
        <ConsolidatedTodayContext.Provider value={consolidated}>
          <MotionConfig reducedMotion="never">
            <CalendarPage />

            {/* the today-zone overlay, in the blank desk at the foot */}
            {consolidated && (
              <motion.div
                key={treatment}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
                className="pointer-events-none fixed inset-x-0 bottom-0 z-40"
              >
                <div className="pointer-events-auto">
                  <TodayZone treatment={treatment} />
                </div>
              </motion.div>
            )}

            {/* the HUD */}
            <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-3">
              <div className="float pointer-events-auto flex max-w-full flex-col items-center gap-1.5 rounded-[1.25rem] px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-center gap-1">
                  {TREATMENTS.map((t) => (
                    <Pill key={t.id} active={treatment === t.id} onClick={() => setTreatment(t.id)}>{t.name}</Pill>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1">
                  <Pill active={consolidated} onClick={() => setConsolidated((v) => !v)}>zone {consolidated ? "on" : "off"}</Pill>
                  <Pill onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? "lamplight" : "paper"}</Pill>
                  <Pill onClick={seed}>seed</Pill>
                  <Pill onClick={clear}>clear</Pill>
                  <Link href="/lab/schedule-submit" className="voice-label rounded-full bg-paper-recessed px-2.5 py-1 text-[0.7rem] leading-none text-ink-soft hover:text-ink">keep lab ↗</Link>
                </div>
                <p className="voice-prose max-w-[22rem] text-center text-[0.7rem] leading-snug text-ink-soft">{cur.desc}</p>
                <span className="voice-data text-[0.6rem] text-ink-faint">{BUILD}</span>
              </div>
            </div>
          </MotionConfig>
        </ConsolidatedTodayContext.Provider>
      </KeptDraftContext.Provider>
    </KeepFlowContext.Provider>
  );
}
