"use client";

/* TEMPORARY dev harness for the schedule submission flow. It renders the REAL
   calendar page against an ISOLATED demo database (a separate Dexie store that
   never touches the real /calendar), so every nav action is genuine — scroll
   today to the top, swipe between altitudes, dive into entries, the dock,
   search. A floating HUD switches the submission flows (← →) and tunes the
   rest. Not linked anywhere; removed before the feature ships. The seam it
   drives (`keep-sequence.tsx`, `keep-flow.tsx`) stays. */

import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { motion } from "motion/react";
import { ulid } from "ulidx";
import CalendarPage from "@/app/calendar/page";
import { createSnippetsDb, resetActiveDb, setActiveDb } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import type { Snippet } from "@/lib/types";
import {
  FLOWS,
  QUILL_SETS,
  resolveFlow,
  type FlowId,
  type Grade,
  type QuillSet,
  type SealPos,
} from "@/components/schedule/keep-sequence";
import { KeepFlowContext, type DeleteLeave, type KeepFlow } from "@/lib/keep-flow";
import { cn } from "@/lib/utils";

// ── the isolated demo dataset ─────────────────────────────────────
const POOL = [
  "The barista drew a fern in the foam and apologised for it being a fern.",
  "Dad still calls the remote “the clicker.”",
  "Overheard: “I’m not superstitious, but I am a little stitious.”",
  "Found a 1998 receipt for film developing tucked in a library book.",
  "Mara taught the dog to ring a bell for the door; now it rings it to be polite.",
  "The man at the bus stop was reading aloud to a pigeon. The pigeon stayed.",
  "Nora called the moon “the night’s nightlight” and went back to sleep.",
  "A whole aisle of the hardware store smelled exactly like my grandfather.",
  "The waiter recommended the soup “if you believe in second chances.”",
  "Someone had chalked “you are here, and that’s enough” on the underpass.",
  "Léo lost his first tooth and asked if he could keep the hole.",
  "The neighbour’s cat watched the washing machine like it was television.",
  "I held the door and a stranger said “you’re a gentleman and a scholar.”",
  "The piano tuner whistled the note he was chasing, then caught it.",
  "Grandma narrated the whole drive like a wildlife documentary.",
  "A kid on the train explained black holes to her exhausted mother, kindly.",
  "The bakery sells “yesterday’s bread, half price, twice as honest.”",
  "Rain started and the entire café exhaled at once.",
  "He named the sourdough starter Gerald and asks after it by name.",
  "The crossing guard high-fives every dog and most of the children.",
  "We argued for ten minutes about whether a hot dog is a sandwich. Joy.",
  "The librarian whispered a recommendation like it was contraband.",
  "Found my old handwriting in a margin: “remember this feeling.” I didn’t.",
  "The toddler applauded the bus for arriving. Honestly, fair.",
  "A busker played to an empty square like it was Carnegie Hall.",
  "The dentist has a fish tank “so something in here is relaxed.”",
  "My coffee order was ready before I finished saying it. We have history.",
  "The streetlight outside flickers in time with nothing, beautifully.",
  "Someone returned my umbrella to the exact bench. Faith restored.",
  "The cashier and I both reached for the same pun. We let it live.",
  "A man watered the public planters at dawn, asking nobody to notice.",
  "The kids built a “time capsule” and buried it in the sandbox for lunch.",
  "The old couple split one coffee and two newspapers, perfectly content.",
  "I caught the train doors with my hand and felt briefly heroic.",
  "The vet called my cat “a strong personality.” She knows.",
  "A snail crossed the whole patio during dinner. We cheered it home.",
  "The receipt said “thank you, come again” and somehow I teared up.",
  "He proposed at the laundromat because “that’s where she laughs most.”",
  "The wind took my hat and a child returned it like a knight.",
  "Two strangers discovered they had the same childhood dog’s name.",
  "The museum guard quietly knew more than every plaque.",
  "My plant grew a new leaf overnight, showing off for no one.",
  "The chess players in the park don’t use a clock; they use patience.",
  "A note in the elevator: “smile, you’re on the way up.”",
];

// a few long, multi-paragraph entries — to exercise the tile clamp + the
// focused entry's internal scroll
const LONG = [
  `We took the long way home along the canal because Nora wanted to count the boats, and somewhere around boat eleven she decided that each one needed a name and a job. The blue one was called Reginald and he delivered letters that people were afraid to send. The little green one with the chipped paint was Susan, and Susan was retired but still helped on weekends.

By boat nineteen she had built an entire economy, a postal service, a feud between two tugs, and a love story she refused to explain. I kept trying to hurry us along and she kept saying, very seriously, that the boats had waited all day for someone to notice them.

When we finally got home she couldn't remember a single name, which felt like the most honest thing about the whole evening. The boats had been noticed. That was the job. We had done it.`,
  `My grandfather used to say that you could tell everything about a town by how it treated its benches, and I didn't understand him until today, sitting in a square I'd never sat in before. There was a bench with a small brass plaque that just said "for the ones who needed to sit down," no name, no dates, nothing else.

An old man sat at one end feeding crumbs to birds that clearly knew his schedule. A teenager sat at the other end crying into her phone, and neither of them looked at the other, and somehow that not-looking was the kindest thing I saw all week — the bench holding both of them at once, no questions asked.

I thought about how many people that plaque had quietly been right about. I thought about my grandfather, who needed to sit down more than he ever admitted. I sat there until the light went orange and then I needed to sit down too.`,
  `The power went out for three hours tonight and it was, against all odds, the best evening we've had in months. At first there was the usual scramble for candles and the low-grade panic of people who suddenly don't know what to do with their hands.

Then Léo asked if we could "play the dark," which turned out to mean telling stories where the only rule was that each person had to add one impossible thing. There was a whale who ran a hotel. There was a staircase that only went up on Tuesdays. There was, eventually, a grandmother who could fold time like laundry, which is the line that made the whole room go quiet.

When the lights came back everyone groaned. We'd forgotten we were waiting for them. I keep thinking that maybe the things we're always waiting for are the things keeping us from the evening we're actually in.`,
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

/** ~80–120 entries across the last ~5.5 months, deterministic, today blank. */
function generateSeed(): Snippet[] {
  const rand = mulberry32(0x5eed1234);
  const rows: Snippet[] = [];
  const today = new Date();
  let longLeft = LONG.length;
  for (let offset = 1; offset <= 168; offset++) {
    const day = new Date(today);
    day.setDate(day.getDate() - offset);
    day.setHours(0, 0, 0, 0);
    const recent = offset <= 30;
    const prob = recent ? 0.78 : 0.5;
    if (rand() > prob) continue; // natural gaps
    const r = rand();
    const count = r < 0.55 ? 1 : r < 0.82 ? 2 : r < 0.95 ? 3 : r < 0.99 ? 4 : 5;
    for (let i = 0; i < count; i++) {
      const at = new Date(day);
      at.setHours(9 + Math.floor(rand() * 13), Math.floor(rand() * 60), 0, 0);
      const capturedAt = at.getTime();
      const useLong = longLeft > 0 && rand() < 0.05;
      const text = useLong
        ? LONG[LONG.length - longLeft--]
        : POOL[Math.floor(rand() * POOL.length)];
      rows.push({
        id: ulid(capturedAt),
        text,
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
  // useSearchParams (in Lab) needs a Suspense boundary on a static route
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
  // open straight on today's book (the real calendar defaults to the month
  // grid); the flow + composer live in the book
  const hasDay = params.get("d") !== null;
  useEffect(() => {
    if (!hasDay) router.replace(`${pathname}?d=${dayKey()}`);
  }, [hasDay, router, pathname]);
  // an isolated store, pointed-to BEFORE the calendar mounts (so its live
  // queries observe it), reset on unmount so the real /calendar is untouched
  const [labDb] = useState(() => {
    const d = createSnippetsDb("snippets-lab");
    setActiveDb(d);
    return d;
  });
  const [flowId, setFlowId] = useState<FlowId>("A");
  const [grade, setGrade] = useState<Grade>("lush");
  const [quillSet, setQuillSet] = useState<QuillSet>("e");
  const [reduce, setReduce] = useState(false);
  const [keptWord, setKeptWord] = useState(false);
  const [seeded, setSeeded] = useState(false);
  // exploration dials beyond the animation itself: a slow-mo multiplier over
  // every beat (so flows can be told apart), where the seal sits, and how a
  // deleted card leaves
  const [slow, setSlow] = useState(1);
  const [pos, setPos] = useState<SealPos | "auto">("auto");
  const [deleteLeave, setDeleteLeave] = useState<DeleteLeave>("dissolve");

  // seed BEFORE the calendar mounts so it opens on today with the full history
  // above (seeding after mount would scroll an empty book, then grow past it)
  useEffect(() => {
    let alive = true;
    void (async () => {
      if ((await labDb.snippets.count()) === 0) await labDb.snippets.bulkAdd(generateSeed());
      if (alive) setSeeded(true);
    })();
    return () => {
      alive = false;
      resetActiveDb();
    };
  }, [labDb]);

  const seed = () =>
    void (async () => {
      await labDb.snippets.clear();
      await labDb.snippets.bulkAdd(generateSeed());
    })();
  const clear = () => void labDb.snippets.clear();

  const idx = FLOWS.findIndex((f) => f.id === flowId);
  const flow = FLOWS[idx];
  const nav = (dir: 1 | -1) => setFlowId(FLOWS[(idx + dir + FLOWS.length) % FLOWS.length].id);
  const cycle = <T,>(list: readonly T[], cur: T, set: (v: T) => void) =>
    set(list[(list.indexOf(cur) + 1) % list.length]);

  const value: KeepFlow = useMemo(() => {
    const base = resolveFlow(flowId, grade, {
      keptWord,
      ...(pos !== "auto" ? { sealPos: pos } : {}),
    });
    // the slow-mo dial stretches every beat so the press + births are legible
    const spec = {
      ...base,
      pressMs: Math.round(base.pressMs * slow),
      cardMs: Math.round(base.cardMs * slow),
      composeMs: Math.round(base.composeMs * slow),
    };
    return { spec, quillSet, reduce, deleteLeave };
  }, [flowId, grade, keptWord, pos, slow, quillSet, reduce, deleteLeave]);

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

  // hold the calendar until it can open on today's book with the seed in place
  if (!hasDay || !seeded) return null;

  return (
    <KeepFlowContext.Provider value={value}>
      {/* the real calendar, reading the isolated demo store */}
      <CalendarPage />

      {/* the floating HUD */}
      <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex justify-center px-3">
        <div className="float pointer-events-auto flex max-w-full flex-col items-center gap-1.5 rounded-[1.25rem] px-2.5 py-2">
          <div className="flex items-center gap-1">
            <Chevron dir={-1} onClick={() => nav(-1)} />
            <div className="flex min-w-[10.5rem] flex-col items-center px-1">
              <span className="voice-label text-[0.82rem] text-ink">{flow.id} · {flow.name}</span>
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
            <Pill active={grade === "quick"} onClick={() => setGrade(grade === "lush" ? "quick" : "lush")}>{grade}</Pill>
            <Pill onClick={() => cycle(QUILL_SETS, quillSet, setQuillSet)}>quill: {quillSet}</Pill>
            <Pill onClick={() => cycle(["auto", "corner", "centre", "travel"] as const, pos, setPos)}>seal: {pos}</Pill>
            <Pill onClick={() => cycle(["dissolve", "fade", "swipe"] as const, deleteLeave, setDeleteLeave)}>del: {deleteLeave}</Pill>
            <Pill onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? "lamplight" : "paper"}</Pill>
            <Pill active={keptWord} onClick={() => setKeptWord((v) => !v)}>“kept.”</Pill>
            <Pill active={reduce} onClick={() => setReduce((v) => !v)}>reduced</Pill>
            <Pill onClick={seed}>seed</Pill>
            <Pill onClick={clear}>clear</Pill>
          </div>

          {/* slow-mo: stretch every beat so flows are legible / the press is seen */}
          <label className="voice-label flex items-center gap-2 px-1 text-[0.66rem] text-ink-soft">
            <span className="tabular-nums">slow {slow.toFixed(2)}×</span>
            <input
              type="range"
              min={1}
              max={6}
              step={0.25}
              value={slow}
              onChange={(e) => setSlow(parseFloat(e.target.value))}
              aria-label="Slow-motion multiplier"
              className="h-1 w-40 cursor-pointer appearance-none rounded-full bg-rule-faint accent-wax"
            />
            {slow !== 1 && (
              <button type="button" onClick={() => setSlow(1)} className="text-ink-faint hover:text-ink">reset</button>
            )}
          </label>
        </div>
      </div>
    </KeepFlowContext.Provider>
  );
}
