"use client";

/* TEMPORARY dev harness exploring a consolidated "today" entry place that FILLS
   the blank desk at the foot of the book — a wax-outlined panel housing the
   large pre-stamp wax button, prompting an entry for today. It DUPLICATES the
   real calendar (isolated demo store) and injects the fill zone into today's
   slot (TodayZoneContext); the per-day inline composer steps aside. A HUD
   switches riffs to compare. Not linked in production. */

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTheme } from "next-themes";
import { MotionConfig } from "motion/react";
import { ulid } from "ulidx";
import CalendarPage from "@/app/calendar/page";
import { createSnippetsDb, resetActiveDb, setActiveDb } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import type { Snippet } from "@/lib/types";
import { resolveFlow } from "@/components/schedule/keep-sequence";
import {
  KeepFlowContext,
  KeptDraftContext,
  TodayZoneContext,
  type KeepFlow,
  type KeptDraftStore,
} from "@/lib/keep-flow";
import { cn } from "@/lib/utils";

const BUILD = "build 2026-06-20f · today-zone FILL · big pre-stamp seal";

const RIFFS: { id: string; name: string; desc: string }[] = [
  { id: "dashed", name: "Dashed", desc: "A wax-blue dashed outline fills the empty tail — a friendly “drop your day here” frame." },
  { id: "outline", name: "Outline", desc: "A thin solid wax outline, nothing filled — quieter than the dashed frame." },
  { id: "fill", name: "Recessed", desc: "A filled panel sunk into the desk (recessed paper + lit top edge) — part of the furniture." },
  { id: "wash", name: "Wax wash", desc: "No border; a faint wax wash pooling in the empty space, the seal floating in it." },
  { id: "mic", name: "Voice-first", desc: "Dashed frame, but the big button wears the microphone — speak or type today’s entry." },
];

// ── compact isolated demo dataset (today starts blank) ──
const POOL = [
  "The barista drew a fern in the foam and apologised for it being a fern.",
  "Dad still calls the remote “the clicker.”",
  "Found a 1998 receipt for film developing tucked in a library book.",
  "The man at the bus stop was reading aloud to a pigeon. The pigeon stayed.",
  "A whole aisle of the hardware store smelled exactly like my grandfather.",
  "Léo lost his first tooth and asked if he could keep the hole.",
  "A kid on the train explained black holes to her exhausted mother, kindly.",
  "Rain started and the entire café exhaled at once.",
  "We argued for ten minutes about whether a hot dog is a sandwich. Joy.",
  "My coffee order was ready before I finished saying it. We have history.",
  "Someone returned my umbrella to the exact bench. Faith restored.",
  "The old couple split one coffee and two newspapers, perfectly content.",
  "A snail crossed the whole patio during dinner. We cheered it home.",
  "The vet called my cat “a strong personality.” She knows.",
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

function generateSeed(): Snippet[] {
  const rand = mulberry32(0x70da2);
  const rows: Snippet[] = [];
  const today = new Date();
  for (let offset = 1; offset <= 110; offset++) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    if (rand() > (offset <= 26 ? 0.66 : 0.4)) continue;
    const count = rand() < 0.72 ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const at = new Date(day);
      at.setHours(9 + Math.floor(rand() * 12), Math.floor(rand() * 60), 0, 0);
      const capturedAt = at.getTime();
      rows.push({
        id: ulid(capturedAt),
        text: POOL[Math.floor(rand() * POOL.length)],
        kind: null, tags: [], capturedAt, day: dayKey(at),
        source: "typed", favorite: 0, enriched: "done", updatedAt: capturedAt,
      });
    }
  }
  return rows;
}

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
  return (
    <Suspense>
      <Lab />
    </Suspense>
  );
}

function Lab() {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // open straight on today's book so the fill zone is front and centre
  const hasDay = params.get("d") !== null;
  useEffect(() => {
    if (!hasDay) router.replace(`${pathname}?d=${dayKey()}`);
  }, [hasDay, router, pathname]);

  const [labDb] = useState(() => {
    const d = createSnippetsDb("snippets-todayzone");
    setActiveDb(d);
    return d;
  });
  const [seeded, setSeeded] = useState(false);
  const [riff, setRiff] = useState("dashed");
  const [zoneOn, setZoneOn] = useState(true);
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
  const flow: KeepFlow = useMemo(
    () => ({ spec: resolveFlow("A", "lush"), quillSet: "e", reduce: false }),
    [],
  );

  const seed = () => void (async () => { await labDb.snippets.clear(); await labDb.snippets.bulkAdd(generateSeed()); })();
  const clear = () => void labDb.snippets.clear();

  if (!hasDay || !seeded) return null;
  const cur = RIFFS.find((r) => r.id === riff)!;

  return (
    <KeepFlowContext.Provider value={flow}>
      <KeptDraftContext.Provider value={draftStore}>
        <TodayZoneContext.Provider value={zoneOn ? riff : null}>
          <MotionConfig reducedMotion="never">
            <CalendarPage />

            <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-3">
              <div className="float pointer-events-auto flex max-w-full flex-col items-center gap-1.5 rounded-[1.25rem] px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-center gap-1">
                  {RIFFS.map((r) => (
                    <Pill key={r.id} active={zoneOn && riff === r.id} onClick={() => { setRiff(r.id); setZoneOn(true); }}>{r.name}</Pill>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1">
                  <Pill active={zoneOn} onClick={() => setZoneOn((v) => !v)}>zone {zoneOn ? "on" : "off"}</Pill>
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
        </TodayZoneContext.Provider>
      </KeptDraftContext.Provider>
    </KeepFlowContext.Provider>
  );
}
