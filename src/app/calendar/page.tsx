"use client";

import {
  Fragment,
  Suspense,
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  addDays,
  addMonths,
  format,
  isAfter,
  isSameMonth,
  startOfMonth,
} from "date-fns";
import { AnimatePresence, motion, animate, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { ulid } from "ulidx";
import { letGoToast } from "@/components/delete-toast";
import { WaxStamp as CanvasSeal, type SealControl } from "@/components/capture/wax-stamp";
import { RecordingWash } from "@/components/capture/wash-shaders";
import { PressGlow } from "@/components/capture/press-glow";
import { KEEP_BEATS, useKeepSequence } from "@/components/schedule/keep-sequence";
import { useKeptDraft } from "@/lib/kept-draft";
import {
  groupByDay,
  useAllSnippets,
  useDayCounts,
  useSearch,
} from "@/hooks/use-snippets";
import { useKeyboardRoom } from "@/hooks/use-keyboard-room";
import {
  addSnippet,
  restoreSnippet,
  softDeleteSnippet,
  StorageWriteError,
} from "@/lib/db";
import { dayKey, dateFromDayKey, friendlyDay } from "@/lib/dates";
import { pushUrl, replaceUrl } from "@/lib/history";
import { bookScrolled } from "@/lib/fling-relief";
import { enterRecoveryIfLooping } from "@/lib/crash-recovery";
import { isIOS, isIOSStandalone, useSpeech } from "@/hooks/use-speech";
import { copy } from "@/lib/copy";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { renderInline } from "@/lib/inline-markup";
import type { Snippet } from "@/lib/types";
import { useSettings } from "@/lib/settings";
import { useSession } from "@/lib/auth";
import { useSyncStatus } from "@/lib/sync";
import { PaperButton } from "@/components/paper-button";
import { queryTerms } from "@/lib/search";
import { cn, enterFiles, joinText } from "@/lib/utils";
import {
  weekdays,
  ym,
  autosizeArea,
} from "@/components/calendar/shared";
import type {
  MonthFeedHandle,
  YearFeedHandle,
} from "@/components/calendar/shared";
import {
  MonthSkeleton,
  YearSkeleton,
  TodaySkeleton,
  EntrySkeleton,
  WelcomeSkeleton,
} from "@/components/calendar/skeletons";

const EntryView = dynamic(
  () => import("@/components/calendar/entry-view").then((m) => m.EntryView),
  // a deep-link or cold first open shows the card's skeleton while the chunk
  // loads, rather than a blank layer
  { ssr: false, loading: () => <EntrySkeleton /> },
);
const MarkedPreview = dynamic(
  () => import("@/components/calendar/entry-view").then((m) => m.MarkedPreview),
  { ssr: false, loading: () => null },
);
const MonthFeed = dynamic(
  () => import("@/components/calendar/month-feed").then((m) => m.MonthFeed),
  // a deep-link that lands in the month grid shows its ruled skeleton while the
  // chunk loads, not a blank layer (the layer's invisible during a warm-in)
  { ssr: false, loading: () => <MonthSkeleton /> },
);
const YearFeed = dynamic(
  () => import("@/components/calendar/year-feed").then((m) => m.YearFeed),
  { ssr: false, loading: () => <YearSkeleton /> },
);

/* ── feed geometry: decades of time, computed, never reflowed ──────
   The feeds are virtualized over arithmetic offsets inside one
   fixed-height spacer. Nothing is ever inserted above the reader and
   scrollTop is never written during a gesture — the recording showed
   iOS killing fling momentum the instant the old windowed feed
   compensated scroll positions mid-flight. */

/** The canvas alone reaches into the deep archive — back to January
    1950, far enough for any living writer's earliest pages. The
    glance never volunteers those years; the effort of scrolling there
    scales with the unlikelihood of needing to. */
const ARCHIVE_YEAR = 1950;

/** A typeface snapshot, for the date numbers that fly between altitudes. */
interface FlyFont {
  family: string;
  size: number;
  weight: string;
  style: string;
  variation: string;
  numeric: string;
  /** small-caps live here, not in text-transform — forget it and the
      flyer reads as full-size lowercase mid-flight */
  caps: string;
  transform: string;
  spacing: string;
  shadow: string;
}

function readFont(el: HTMLElement): FlyFont {
  const cs = getComputedStyle(el);
  return {
    family: cs.fontFamily,
    size: parseFloat(cs.fontSize),
    weight: cs.fontWeight,
    style: cs.fontStyle,
    variation: cs.fontVariationSettings,
    numeric: cs.fontVariantNumeric,
    caps: cs.fontVariantCaps,
    transform: cs.textTransform,
    spacing: cs.letterSpacing,
    shadow: cs.textShadow,
  };
}

function readColor(el: HTMLElement): string {
  return getComputedStyle(el).color;
}

/** A detached, absolutely-centred number wearing a given typeface. */
function flyGlyph(text: string, font: FlyFont, color: string): HTMLSpanElement {
  const g = document.createElement("span");
  g.textContent = text;
  g.style.cssText =
    "position:absolute;left:0;top:0;line-height:1;white-space:nowrap;" +
    `transform:translate(-50%,-50%);color:${color};` +
    `font-family:${font.family};font-weight:${font.weight};` +
    `font-style:${font.style};font-variation-settings:${font.variation};` +
    `font-variant-numeric:${font.numeric};font-variant-caps:${font.caps};` +
    `text-transform:${font.transform};letter-spacing:${font.spacing};` +
    `text-shadow:${font.shadow};`;
  return g;
}

// The book's faint days — shown while the real entries are still loading so the
// ledger reads as "settling in" rather than blank. Shared by the SSR Suspense
// fallback AND the in-feed loading state, so the paper stays put continuously
// (no skeleton→blank→book flash) right up until the book lands.
//
// Each day stands in a margin date and a stack of blank entry tiles — the same
// paper-and-hairline material the real cards wear (ScheduleCards), just wordless
// — so the wait pre-echoes the book's shape instead of a bare ruled grid. The
// tile counts are a fixed pattern (never random): SSR and client must paint the
// identical skeleton, and a steady rhythm reads calmer than noise.
// lines-per-tile, per day. About half the tiles run the full six — the real
// card's line-clamp, so a max-height tile — and the rest are shorter, so the
// stack reads as a real week of entries rather than a uniform block.
const LEDGER_SHAPE: number[][] = [
  [6, 2],
  [6],
  [3],
  [6, 1],
  [4],
  [2, 6],
  [6],
  [1],
];

// one blank entry tile: the book-card recipe (bg-paper, hairline, inset top
// highlight) with faint bars where the prose would sit. Each bar rides a line
// box of the real prose rhythm (0.9rem × 1.42 ≈ 20px), so a six-line tile
// stands exactly as tall as a full six-line card; the last line is short, as a
// paragraph's is. The bars shimmer while the book settles in.
function LedgerCard({ lines }: { lines: number }) {
  return (
    <div className="rounded-[6px] border border-rule-faint bg-paper p-2.5 text-[0.9rem] leading-[1.42] shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="flex h-[1.42em] items-center">
          <span
            className="skeleton-shimmer h-[7px] rounded-[2px]"
            style={{
              backgroundColor: "var(--rule-faint)",
              width: i === lines - 1 ? "58%" : "100%",
            }}
          />
        </div>
      ))}
    </div>
  );
}

function LedgerRows() {
  return (
    <>
      {LEDGER_SHAPE.map((tiles, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="grid grid-cols-[2.1rem_1fr] gap-x-2 border-t border-rule-faint pb-2.5 pt-2.5"
        >
          {/* the margin date: a small weekday bar over a taller day-number bar */}
          <div className="flex flex-col items-center gap-1.5 pt-[3.5px]">
            <div
              className="skeleton-shimmer h-1.5 w-5 rounded-[2px] opacity-70"
              style={{ backgroundColor: "var(--rule-faint)" }}
            />
            <div
              className="skeleton-shimmer h-3 w-4 rounded-[2px]"
              style={{ backgroundColor: "var(--rule-faint)" }}
            />
          </div>
          {/* the day's entry tiles — same gap as the real ScheduleCards list */}
          <div className="flex flex-col gap-1">
            {tiles.map((lines, j) => (
              <LedgerCard key={j} lines={lines} />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

type SkeletonView =
  | "auto"
  | "today"
  | "schedule"
  | "month"
  | "year"
  | "entry"
  | "welcome";

// A calm placeholder painted on the SERVER (the Suspense fallback is SSR'd), so
// the frame shows the instant the HTML lands instead of a blank sheet. The
// static shell defaults to "auto" — the today zone AND the welcome intro, one
// hidden, with a pre-paint script (layout.tsx → data-first-run) picking the
// empty-book welcome before the first frame so it never flashes the today shell.
// A deep-link into the year glance or month grid picks up its own skeleton once
// the feed mounts (the dynamic-import loading state above), and ?skeldebug can
// hold any single one.
function CalendarSkeleton({ view = "auto" }: { view?: SkeletonView }) {
  return (
    <div className="page-settle flex h-full min-h-0 flex-col" aria-hidden="true">
      <div className="sticky top-0 z-30">
        {/* the title's line box IS the header's height in the app (the search
            glass sits absolute, never growing the row). Reproduce it with an
            invisible date in the same voice, so the header — and the hairline
            below it — stand at exactly the app's height, at every width. */}
        <div className="relative flex items-center voice-display text-(length:--date-head)">
          <span className="invisible" aria-hidden="true">
            July
          </span>
          <span
            // the month grid shimmers as one left→right wave; its title joins
            // that same sweep at zero delay, leading with the first column
            className={cn(
              view === "month" ? "skeleton-shimmer-wave" : "skeleton-shimmer",
              "absolute inset-y-[16%] left-0 w-36 rounded-[5px] opacity-60",
            )}
            style={{ backgroundColor: "var(--rule-faint)" }}
          />
        </div>
      </div>
      {/* the weekday rail and its hairline — the scroll area's top terminus,
          sitting beneath the header exactly as in the app (collapsed to the bare
          rule everywhere but the month grid). Carrying it here means the today
          zone lands at its final height, with nothing to shift when the real
          layout arrives. */}
      <div
        className={cn(
          "mt-5 grid border-b border-rule-faint",
          view === "month" ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            className={cn("grid grid-cols-7", view === "month" ? "opacity-100" : "opacity-0")}
            aria-hidden="true"
          >
            {Array.from({ length: 7 }).map((_, i) => (
              <span key={i} className="flex justify-center pb-2">
                <span
                  className="skeleton-shimmer h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: "var(--rule-faint)" }}
                />
              </span>
            ))}
          </div>
        </div>
      </div>
      {/* -mt-px only where a top border must ride onto the rail (the book's
          first day rule, the month grid's first week) — as the app's scroller
          does. The today zone and the rest have no such rule and must not be
          pulled up, or they'd land a pixel high. */}
      <div
        className={cn(
          "relative min-h-0 flex-1 overflow-hidden",
          (view === "schedule" || view === "month") && "-mt-px",
        )}
      >
        {view === "year" ? (
          <YearSkeleton />
        ) : view === "month" ? (
          <MonthSkeleton />
        ) : view === "schedule" ? (
          <LedgerRows />
        ) : view === "entry" ? (
          <EntrySkeleton />
        ) : view === "welcome" ? (
          <WelcomeSkeleton />
        ) : view === "today" ? (
          <TodaySkeleton />
        ) : (
          // auto (the SSR fallback): carry both bodies and let the pre-paint
          // data-first-run flag pick the empty-book welcome, else the today zone
          <>
            <div className="skeleton-filled-only h-full">
              <TodaySkeleton />
            </div>
            <div className="skeleton-empty-only h-full">
              <WelcomeSkeleton />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Dev-only: ?skeldebug holds a pageload skeleton on screen so its look can be
// inspected and tuned (it normally flashes by in the Suspense gap). Add a value
// to choose the view — ?skeldebug=today (default) / schedule / month / year /
// entry / welcome / auto (the real fallback, which lets the data-first-run flag
// pick). A quiet pill — same recipe as the perf A/B pill — so it's clear you're
// parked in the held view, not stuck loading.
function SkeletonDebug() {
  const held = useSearchParams().get("skeldebug");
  const view: SkeletonView =
    held === "year" ||
    held === "month" ||
    held === "schedule" ||
    held === "entry" ||
    held === "welcome" ||
    held === "auto"
      ? held
      : "today";
  return (
    <>
      <CalendarSkeleton view={view} />
      <div className="float fixed bottom-3 left-3 z-50 rounded-full px-2.5 py-1">
        <span className="voice-label text-[0.72rem] text-ink-soft">
          {view} skeleton — held
        </span>
      </div>
    </>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarSkeleton />}>
      <CalendarGate />
    </Suspense>
  );
}

// ?skeldebug parks on the held skeleton (SkeletonDebug). It has to gate here,
// BEFORE Calendar mounts — Calendar's mount effects rewrite the URL to ?d=…, and
// since useSearchParams is reactive that would drop the param and swap the real
// calendar in. Keeping Calendar unmounted means its effects never run, so the
// skeleton stays put to be stared at.
function CalendarGate() {
  const params = useSearchParams();
  if (params.has("skeldebug")) return <SkeletonDebug />;
  return <Calendar />;
}

type View = "year" | "month" | "schedule" | "entry";
/** altitude order: a zoom to a deeper view dives in, shallower pulls back */
const DEPTH: Record<View, number> = { year: 0, month: 1, schedule: 2, entry: 3 };

interface ScheduleFeedHandle {
  goTo: (day: string, smooth?: boolean) => void;
}

/**
 * The calendar is a camera over time. Month view and year view are two
 * altitudes of the same world: switching views zooms the whole field
 * about the active month's own slot while the layers crossfade — and
 * within a view, time is one continuous virtualized feed with native
 * momentum that nothing is allowed to interrupt.
 */
function Calendar() {
  const params = useSearchParams();
  const pathname = usePathname();
  // Did we just reload into a crash loop? A deep-linked day rebuilds the whole
  // book from that day forward — the heaviest render — so if THAT is what's
  // killing the page, honoring the same `?d=` on every reload loops forever
  // ("A problem repeatedly occurred"). In recovery we ignore the deep link,
  // open the light recent-days window, and skip mounting the rest of the book
  // (see the fullBook effect) — a cheap load that survives and clears the
  // loop. Read once at mount; SSR and the very first client render are never
  // in recovery, so there's no hydration skew.
  const [recovery] = useState(() =>
    typeof window === "undefined"
      ? false
      : enterRecoveryIfLooping(Date.now()),
  );
  const deepLink = !recovery;
  const initialDay = (() => {
    const d = deepLink ? params.get("d") : null;
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : dayKey();
  })();
  // a bare ?y=YYYY (no ?d/?e) opens straight to the year glance
  const initialYear = (() => {
    if (!deepLink) return null;
    const y = params.get("y");
    return !params.get("d") && !params.get("e") && y && /^\d{4}$/.test(y)
      ? Number(y)
      : null;
  })();

  // The book is the app's home: with no deep link, land in today's schedule
  // (the fill zone at its foot is the capture surface) rather than the month
  // grid — which is a zoom-out away. A valid ?d= still opens straight to its
  // day, and ?d=…&e= straight to an entry.
  const [view, setView] = useState<View>(() => {
    if (initialYear != null) return "year";
    const d = deepLink ? params.get("d") : null;
    const validDay = !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
    return validDay && params.get("e") ? "entry" : "schedule";
  });
  /** during a zoom both layers render; the camera moves `from` → `to` */
  const [zoom, setZoom] = useState<null | {
    from: View;
    to: View;
    anchor: string;
  }>(null);
  // all four altitudes are kept mounted so a zoom always has both layers
  // to fly between — but mounting all four on the first paint (the book
  // builds every row) stalls the arrival and starves the dock's ink
  // animation, so the move into the page reads as a skip. Mount only the
  // altitude we land on; warm the rest in once the thread is free (and
  // at once if a zoom needs them sooner).
  //
  // `warm` is a LEVEL, not a flag: the off-screen altitudes mount ONE PER FRAME
  // (level 1 → month, 2 → entry, 3 → year). Mounting all three in a single
  // commit was a ~150ms+ main-thread block that, landing right after a fast
  // reopen's page had settled, blanked it to the bare desk for a beat before it
  // repainted. Staggered + inside startTransition, no one commit blocks long
  // enough to drop a frame. A zoom still forces all layers at once (runZoom).
  const [warm, setWarm] = useState(0);
  const [selected, setSelected] = useState(initialDay);
  /** what the title shows — follows the feeds' scroll */
  const [visibleMonth, setVisibleMonth] = useState(() => {
    if (initialYear != null) {
      const now = dateFromDayKey(dayKey());
      return startOfMonth(
        new Date(initialYear, initialYear === now.getFullYear() ? now.getMonth() : 0, 1),
      );
    }
    return startOfMonth(dateFromDayKey(initialDay));
  });
  const [visibleYear, setVisibleYear] = useState(() => visibleMonth.getFullYear());

  // Perf A/B (temporary): flatten the book cards' ink/layers to test whether the
  // mix-blend compositing is what causes scroll input-lag and the pinch-zoom
  // crash on low-power iPhones. Toggled by a pill shown with ?perfdebug; the
  // choice rides a data attribute on <html> that globals.css keys off. Read once
  // in the initializer (client-only render under Suspense — no hydration skew).
  const [perfFlat, setPerfFlat] = useState(
    () => typeof window !== "undefined" && localStorage.getItem("perfFlat") === "1",
  );
  const [perfDebug] = useState(() => {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).has("perfdebug")) {
      try { localStorage.setItem("perfDebug", "1"); } catch {}
      return true;
    }
    return localStorage.getItem("perfDebug") === "1";
  });
  useEffect(() => {
    if (perfFlat) document.documentElement.dataset.perfFlat = "1";
    else delete document.documentElement.dataset.perfFlat;
  }, [perfFlat]);
  const togglePerf = useCallback(() => {
    setPerfFlat((v) => {
      const next = !v;
      try { localStorage.setItem("perfFlat", next ? "1" : "0"); } catch {}
      return next;
    });
  }, []);

  const counts = useDayCounts();
  const all = useAllSnippets();
  const reduceMotion = useReducedMotion();
  // a deletion closes the entry by dissolving the card in place, not the
  // shared-element shrink back to its (vanishing) book slot — this flag marks
  // the next close as a deletion so it plays the dissolve.
  const deleteCloseRef = useRef(false);

  /** the entry the camera has dived into */
  const [focusedId, setFocusedId] = useState<string | null>(() =>
    params.get("e"),
  );
  // the snippet being deleted is held here so the closing card keeps showing its
  // words through the leave animation (rather than flashing the "Let go." stub
  // the instant the soft-delete drops it from the live query)
  const [deletingSnippet, setDeletingSnippet] = useState<Snippet | null>(null);
  const focused = useMemo(
    () =>
      focusedId && all
        ? (all.find((s) => s.id === focusedId) ?? deletingSnippet)
        : deletingSnippet,
    [all, focusedId, deletingSnippet],
  );

  const todayStamp = dayKey();
  // one Date for the whole day: the feeds memoize their heavy windows
  // against it, and a fresh identity every render would bust them all
  const today = useMemo(() => dateFromDayKey(todayStamp), [todayStamp]);
  const currentMonth = startOfMonth(today);
  const atToday =
    (view === "month" &&
      isSameMonth(visibleMonth, today) &&
      selected === dayKey()) ||
    (view === "schedule" && selected === dayKey());

  const stageRef = useRef<HTMLDivElement>(null);
  const monthLayerRef = useRef<HTMLDivElement>(null);
  const yearLayerRef = useRef<HTMLDivElement>(null);
  const scheduleLayerRef = useRef<HTMLDivElement>(null);
  const entryLayerRef = useRef<HTMLDivElement>(null);
  const monthFeedRef = useRef<MonthFeedHandle | null>(null);
  const yearFeedRef = useRef<YearFeedHandle | null>(null);
  const scheduleFeedRef = useRef<ScheduleFeedHandle | null>(null);
  const zooming = useRef(false);
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { weekStart } = useSettings();
  useEffect(() => {
    return () => {
      if (urlTimer.current) clearTimeout(urlTimer.current);
    };
  }, []);

  // live mirrors for the popstate handler
  const viewRef = useRef(view);
  const selectedRef = useRef(selected);
  const focusedIdRef = useRef(focusedId);
  const visibleMonthRef = useRef(visibleMonth);
  useEffect(() => {
    viewRef.current = view;
    selectedRef.current = selected;
    focusedIdRef.current = focusedId;
    visibleMonthRef.current = visibleMonth;
  });
  // The day the book is currently on, written SYNCHRONOUSLY (unlike `selected`,
  // which the scroll spy sets inside a startTransition, so it — and selectedRef —
  // lag a beat). Climbing out of the book reads this so a browser-back fired
  // right after a scroll lands on the day actually on screen, not the previous
  // one, and so there's no stale-then-correct re-animation.
  const liveDayRef = useRef(selected);
  // true only for the brief window between an app back-affordance calling
  // history.back() and the popstate it triggers — so the handler can tell an
  // app-initiated back (header/dock: play the dive) from the browser's own
  // native back gesture (snap straight to the altitude, no dive).
  const appNavRef = useRef(false);
  const appBack = useCallback(() => {
    appNavRef.current = true;
    window.history.back();
  }, []);

  // every dive is a real history entry, so the browser's own back —
  // the iOS edge swipe included — pops one altitude instead of leaving
  // the page. Arriving deep, synthesize the stack beneath so back
  // always has a floor.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    // in recovery we disown the (crashing) deep link entirely — floor on
    // today, as if opened fresh, so the reloaded URL is the light one
    const d = recovery ? null : sp.get("d");
    const e = recovery ? null : sp.get("e");
    const y = recovery ? null : sp.get("y");
    if (d) {
      replaceUrl(pathname);
      pushUrl(`${pathname}?d=${d}`);
      if (e) pushUrl(`${pathname}?d=${d}&e=${e}`);
    } else if (y && /^\d{4}$/.test(y)) {
      // arrived at the year glance: floor it on the month canvas, then the year,
      // so Back drops to the month rather than walking off the page
      replaceUrl(pathname);
      pushUrl(`${pathname}?y=${y}`);
    } else {
      // No deep link: the book (schedule) is home, but the grid is still "a
      // zoom-out away" — so synthesize the month floor beneath it here too.
      // Without this the title's ‹ and the back gesture call history.back()
      // with no calendar entry below and walk off the page entirely.
      replaceUrl(pathname);
      pushUrl(`${pathname}?d=${initialDay}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // bring the off-screen altitudes in just after the arrival settles —
  // past the dock's ink glide (a ~250ms spring), so their build (the
  // book's rows) lands off the transition and the ink never skips. A
  // fixed beat, not requestIdleCallback: idle can fall mid-animation on
  // a fast device, which is exactly when we must not mount. Then step the
  // level up one altitude per frame (not all at once — see `warm` above).
  useEffect(() => {
    let raf = 0;
    const id = setTimeout(() => {
      let n = 1;
      const bump = () => {
        startTransition(() => setWarm((w) => Math.max(w, n)));
        if (n++ < 3) raf = requestAnimationFrame(bump);
      };
      bump();
    }, 350);
    return () => {
      clearTimeout(id);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* ── the zoom: one camera move between altitudes ──────────────── */

  const runZoom = useCallback((from: View, to: View, anchor: string) => {
    if (zooming.current) return;
    setWarm(3); // a camera move needs every layer mounted now
    zooming.current = true;
    setZoom({ from, to, anchor });
    setView(to);
  }, []);

  /** tapping a day dives the camera into it: the book opens there */
  const pick = useCallback(
    (key: string) => {
      liveDayRef.current = key;
      setSelected(key);
      navigator.vibrate?.(6);
      if (urlTimer.current) clearTimeout(urlTimer.current);
      pushUrl(`${pathname}?d=${key}`);
      scheduleFeedRef.current?.goTo(key); // open the page behind the zoom
      runZoom("month", "schedule", key);
    },
    [pathname, runZoom],
  );

  /** the reader's place in the book drives selection, title, and URL.
      These follow the scroll but needn't block it — a transition lets
      the fling paint while React reconciles the title/ring off the
      critical path, so the start of a scroll stays smooth. */
  const onScheduleDay = useCallback(
    (key: string) => {
      liveDayRef.current = key; // synchronous — the climb reads this, not deferred state
      startTransition(() => {
        setSelected(key);
        const m = startOfMonth(dateFromDayKey(key));
        setVisibleMonth((prev) => (isSameMonth(prev, m) ? prev : m));
        setVisibleYear(m.getFullYear());
      });
      if (urlTimer.current) clearTimeout(urlTimer.current);
      urlTimer.current = setTimeout(() => {
        replaceUrl(`${pathname}?d=${key}`);
      }, 250);
    },
    [pathname],
  );

  useLayoutEffect(() => {
    if (!zoom) return;
    const stage = stageRef.current;
    const layers: Record<View, HTMLDivElement | null> = {
      year: yearLayerRef.current,
      month: monthLayerRef.current,
      schedule: scheduleLayerRef.current,
      entry: entryLayerRef.current,
    };
    const outgoing = layers[zoom.from];
    const incoming = layers[zoom.to];
    if (!stage || !outgoing || !incoming) {
      setZoom(null);
      zooming.current = false;
      return;
    }

    // the previous finish left the departed layer inline-hidden
    for (const el of Object.values(layers)) if (el) el.style.visibility = "";

    let flyerBox: HTMLDivElement | null = null;
    const hiddenNumbers: HTMLElement[] = [];
    const willChanged: HTMLElement[] = [];
    const entryCard = entryLayerRef.current?.querySelector<HTMLElement>(
      "[data-entry-card]",
    );
    const entryContent = entryLayerRef.current?.querySelector<HTMLElement>(
      "[data-entry-card-content]",
    );
    // the foot row (stamp + trash) shouldn't ride the whole zoom — it
    // fades fast at the very start and is gone for the rest of the move
    const entryFoot = entryLayerRef.current?.querySelector<HTMLElement>(
      "[data-entry-foot]",
    );

    const finish = () => {
      // keep the departed layer hidden across the gap between these
      // inline clears and the commit that restores its `invisible`
      // class — a paint in that gap flashed the old view at full scale
      outgoing.style.visibility = "hidden";
      for (const el of Object.values(layers)) {
        if (!el) continue;
        el.style.transform = "";
        el.style.opacity = "";
      }
      if (entryCard) {
        entryCard.style.transform = "";
        entryCard.style.opacity = "";
        entryCard.style.borderRadius = "";
        entryCard
          .querySelectorAll("[data-stand-in]")
          .forEach((el) => el.remove());
      }
      if (entryContent) {
        entryContent.style.opacity = "";
        entryContent.style.transform = "";
      }
      if (entryFoot) entryFoot.style.opacity = "";
      for (const el of willChanged) el.style.willChange = "";
      deleteCloseRef.current = false;
      setDeletingSnippet(null);
      setZoom(null);
      zooming.current = false;
      // Hand the stand-ins back to the real elements ONE FRAME LATER — after the
      // setZoom(null) commit has restored the real book (its layer opacity clears
      // to full). Revealing the real cell and removing the stand-in together, on
      // the next frame, overlaps them for the swap instead of leaving a one-frame
      // gap where the date blinks out.
      if (flyerBox || hiddenNumbers.length) {
        const fb = flyerBox;
        const reals = hiddenNumbers;
        requestAnimationFrame(() => {
          for (const el of reals) el.style.visibility = "";
          fb?.remove();
        });
      }
    };

    if (reduceMotion) {
      // finish on rejection too: an animation cancelled mid-flight (a
      // navigation during a selection gesture, say) must never leave
      // the zooming latch stuck and the app deaf
      void animate(outgoing, { opacity: [1, 0] }, { duration: 0.12 }).then(finish, finish);
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const spring = { type: "spring", stiffness: 320, damping: 34 } as const;
    const deeper = DEPTH[zoom.to] > DEPTH[zoom.from];
    const moves: Promise<unknown>[] = [];

    // the painted box of an element's text, not its line box — block
    // boxes carry leading the glyphs don't, and the difference reads as
    // a flyer landing low, then skipping into place
    const textRect = (el: HTMLElement) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      return r.width > 0 ? r : el.getBoundingClientRect();
    };
    const ensureFlyerBox = () => {
      if (flyerBox) return flyerBox;
      flyerBox = document.createElement("div");
      // its own composited layer (translateZ) at a high z so a flyer always sits
      // above the layers it travels over — including the entry card's own
      // will-change layer, which on iOS can otherwise paint above a plain
      // z-indexed sibling
      flyerBox.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:45;transform:translateZ(0);";
      stage.appendChild(flyerBox);
      return flyerBox;
    };

    // book⇄entry is not a camera scale but a shared element: the tapped
    // tile expands to fill the stage (and shrinks back), the same paper
    // card the whole way. The schedule fades under it; the full content
    // fades in as it opens.
    if (zoom.from === "entry" || zoom.to === "entry") {
      // a deletion: dissolve the card where it stands (or a plain quick fade)
      // while the book fades up behind it — no shrink back to the slot the
      // entry is leaving. The struck tile collapses in the book on its own.
      if (zoom.from === "entry" && deleteCloseRef.current) {
        const schedEl = layers.schedule!;
        const cardEl = entryCard ?? incoming;
        layers.entry!.style.opacity = "1";
        schedEl.style.opacity = "0";
        cardEl.style.willChange = "transform, opacity";
        willChanged.push(cardEl);
        // dissolve the card in place — fade while it sinks a few pixels
        const dur = 0.32;
        moves.push(
          animate(cardEl, { opacity: [1, 0], y: [0, 14] }, { duration: dur, ease: [0.4, 0, 1, 1] }).finished,
          animate(schedEl, { opacity: [0, 1] }, { duration: dur * 0.8, ease: [0.23, 1, 0.32, 1] }).finished,
        );
        void Promise.all(moves).then(finish, finish);
        return;
      }
      const tile = scheduleLayerRef.current?.querySelector<HTMLElement>(
        `[data-entry="${CSS.escape(zoom.anchor)}"]`,
      );
      if (entryCard && entryContent && tile) {
        const t = tile.getBoundingClientRect();
        const c = entryCard.getBoundingClientRect();
        // the card's box mapped onto the tile's exact box (origin 0,0)
        const ox = t.left - c.left;
        const oy = t.top - c.top;
        const osx = t.width / c.width;
        const osy = t.height / c.height;
        const schedEl = layers.schedule!;
        layers.entry!.style.opacity = "1";
        let standIn: HTMLElement | null = null;
        if (deeper) {
          // opening, the card's blank paper covers the tile's spot
          tile.style.visibility = "hidden";
          hiddenNumbers.push(tile);
        } else {
          // closing mirrors the open: a beat of blank, then the words
          // re-rendered in their FINAL configuration — the tile's own
          // layout — which the shrinking card carries into place. The
          // stand-in wears the tile's exact classes and inner measure,
          // so the landing is pixel-identical to the real tile beneath.
          const tileP = tile.querySelector("p");
          if (tileP) {
            standIn = document.createElement("div");
            standIn.appendChild(tileP.cloneNode(true));
            standIn.setAttribute("aria-hidden", "true");
            standIn.setAttribute("data-stand-in", "");
            standIn.style.cssText =
              `position:absolute;left:0;top:0;width:${t.width - 2}px;` +
              "padding:10px;box-sizing:border-box;transform-origin:0 0;" +
              "pointer-events:none;opacity:0;";
            entryCard.appendChild(standIn);
          }
        }
        // closing: the day's sticky margin number belongs to the book we're
        // returning to, but it lives in the schedule layer that fades up from
        // nothing — so it would pop in only as the card lands. Lift it into a
        // still stand-in over the fading book (the flyer box at full opacity),
        // pinned to its final sticky slot, with the real number hidden until the
        // finish — so the date is already in its correct place from the first
        // frame while the card shrinks home.
        if (!deeper) {
          const day = tile.closest<HTMLElement>("[data-day]")?.dataset.day;
          const dateEl = day
            ? scheduleLayerRef.current?.querySelector<HTMLElement>(
                `[data-flydate="${CSS.escape(day)}"]`,
              )
            : null;
          // the whole margin cell (weekday + number), so the stand-in reads
          // "Sun 21" exactly, with its real type and colour
          const cell = dateEl?.closest<HTMLElement>(".book-margin-date") ?? dateEl;
          if (day && dateEl && cell) {
            // entry⇄schedule no longer freezes the dates (see diveFreeze), so the
            // cell is already in its true sticky slot — measure it directly. (The
            // schedule still fades in from nothing, which is why we lift the date
            // into a full-opacity stand-in on top rather than let it fade up.)
            const c = cell.getBoundingClientRect();
            const clone = cell.cloneNode(true) as HTMLElement;
            clone.style.position = "absolute";
            clone.style.margin = "0";
            clone.style.left = `${c.left - stageRect.left}px`;
            clone.style.top = `${c.top - stageRect.top}px`;
            clone.style.width = `${c.width}px`;
            clone.style.opacity = "1";
            clone.style.visibility = "visible";
            ensureFlyerBox().appendChild(clone);
            // hide the real cell (the whole sticky margin block) until the finish,
            // so the only date on screen is the stand-in held over the fading book
            cell.style.visibility = "hidden";
            hiddenNumbers.push(cell);
          }
        }
        // promote both moving surfaces to their own GPU layers: scaling
        // a paper-textured, mix-blended card is murderously expensive to
        // re-raster each frame on the CPU; cached layers make it cheap
        entryCard.style.willChange = "transform, opacity";
        entryContent.style.willChange = "transform, opacity";
        schedEl.style.willChange = "opacity";
        willChanged.push(entryCard, entryContent, schedEl);
        if (entryFoot) {
          entryFoot.style.willChange = "opacity";
          willChanged.push(entryFoot);
        }
        // a hand-rolled rAF drives the whole shared-element move off one
        // eased value (Motion's numeric animate was being cancelled after
        // a single frame here, alone among the transitions)
        const lerp = (a: number, bb: number, k: number) => a + (bb - a) * k;
        entryContent.style.transformOrigin = "0 0";
        const apply = (open: number) => {
          // open: 0 = sitting on the tile, 1 = filling the stage
          const sx = lerp(osx, 1, open);
          const sy = lerp(osy, 1, open);
          entryCard.style.transform = `translate(${lerp(ox, 0, open)}px, ${lerp(
            oy,
            0,
            open,
          )}px) scale(${sx}, ${sy})`;
          if (deeper) {
            // opening: the content holds its natural size against the
            // growing box (a window opening over the words) while the
            // full text fades in
            entryContent.style.transform = `scale(${1 / sx}, ${1 / sy})`;
            entryContent.style.opacity = `${Math.min(1, Math.max(0, (open - 0.2) / 0.6))}`;
          } else {
            // closing: the entry text bows out in the first beat (the
            // flash), and the tile-configured stand-in takes the stage,
            // width-locked to the card at a uniform scale so its right
            // edge can never clip and it lands at exactly natural size
            entryContent.style.opacity = `${Math.min(1, Math.max(0, (open - 0.85) / 0.15))}`;
            if (standIn) {
              const u = (c.width - 2) / (t.width - 2);
              standIn.style.transform = `scale(${u}, ${(u * sx) / sy})`;
              standIn.style.opacity = `${Math.min(1, Math.max(0, (0.85 - open) / 0.12))}`;
            }
            // the card's radius eases to the tile's so the landing swap
            // has no corner pop
            entryCard.style.borderRadius = `${6 + 4 * open}px`;
          }
          schedEl.style.opacity = `${1 - open}`;
          if (entryFoot)
            entryFoot.style.opacity = `${Math.min(1, Math.max(0, (open - 0.85) / 0.15))}`;
        };
        apply(deeper ? 0 : 1);
        const DUR = 440;
        const start = performance.now();
        moves.push(
          new Promise<void>((resolve) => {
            const loop = (now: number) => {
              const k = Math.min(1, (now - start) / DUR);
              const e = 1 - Math.pow(1 - k, 3); // easeOutCubic — a clean open
              apply(deeper ? e : 1 - e);
              if (k < 1) requestAnimationFrame(loop);
              else resolve();
            };
            requestAnimationFrame(loop);
          }),
        );
        void Promise.all(moves).then(finish, finish);
        return;
      }
      // missing nodes — fall through to a plain crossfade
      incoming.style.opacity = "0";
      moves.push(
        animate(outgoing, { opacity: [1, 0] }, { duration: 0.16 }).finished,
        animate(incoming, { opacity: [0, 1] }, { duration: 0.16 }).finished,
      );
      void Promise.all(moves).then(finish, finish);
      return;
    }

    // hold the arriving layer dark until the animation's first tick owns it
    incoming.style.opacity = "0";

    // where the chosen slot sits. Year⇄month is a literal camera move
    // (the mini becomes the canvas), so it uses the true slot ratio;
    // month⇄book keeps the grammar with a tamed factor — the literal
    // cell-to-stage ratio (~7×) is violent.
    let o: { x: number; y: number; w: number } | null = null;
    let factor: number;
    if (zoom.from === "year" || zoom.to === "year") {
      o = yearFeedRef.current?.originFor(zoom.anchor) ?? null;
      factor = o ? stageRect.width / o.w : 3.2;
    } else {
      o = monthFeedRef.current?.originFor(zoom.anchor) ?? null;
      factor = 2.4;
    }
    const origin = o
      ? `${(o.x / stageRect.width) * 100}% ${(o.y / stageRect.height) * 100}%`
      : "50% 30%";
    outgoing.style.transformOrigin = origin;
    incoming.style.transformOrigin = origin;

    moves.push(
      // diving: the departing view blows up past its slot; pulling back:
      // it shrinks toward it — and the arriving view does the inverse
      animate(
        outgoing,
        { scale: [1, deeper ? factor : 1 / factor], opacity: [1, 0] },
        { scale: spring, opacity: { duration: 0.18, ease: "easeOut" } },
      ).finished,
      animate(
        incoming,
        { scale: [deeper ? 1 / factor : factor, 1], opacity: [0, 1] },
        { scale: spring, opacity: { duration: 0.16, ease: "easeOut" } },
      ).finished,
    );

    // shared-element flight: a date standing in both altitudes travels
    // from its grid cell to its ledger slot (and back) instead of
    // crossfading — the originals hide while their double is in the air
    const dayPair =
      (zoom.from === "month" && zoom.to === "schedule") ||
      (zoom.from === "schedule" && zoom.to === "month");
    if (dayPair) {
      const collect = (root: HTMLElement) => {
        const found = new Map<string, HTMLElement>();
        for (const el of root.querySelectorAll<HTMLElement>("[data-flydate]")) {
          const r = el.getBoundingClientRect();
          const y = r.top - stageRect.top;
          if (y > -r.height && y < stageRect.height)
            found.set(el.dataset.flydate!, el);
        }
        return found;
      };
      const fromEls = collect(outgoing);
      const toEls = collect(incoming);
      // pulling back, only the day the reader stood on travels — the
      // other visible dates belong to the page being closed
      if (zoom.from === "schedule") {
        for (const day of [...fromEls.keys()])
          if (day !== zoom.anchor) fromEls.delete(day);
      }
      const box = ensureFlyerBox();
      for (const [day, fromEl] of fromEls) {
        const toEl = toEls.get(day);
        if (!toEl) continue;
        const a = textRect(fromEl);
        const b = textRect(toEl);
        const ax = a.left + a.width / 2 - stageRect.left;
        const ay = a.top + a.height / 2 - stageRect.top;
        const bx = b.left + b.width / 2 - stageRect.left;
        const by = b.top + b.height / 2 - stageRect.top;
        const fromFont = readFont(fromEl);
        const toFont = readFont(toEl);
        const num = String(Number(day.slice(8)));
        const color = day === dayKey() ? "var(--wax)" : "var(--ink)";

        // two glyphs overlaid — the departing typeface and the arriving
        // one — crossfading through a hair of blur. Position, size, and
        // the crossfade all ride one spring value, so the type changes
        // exactly when the number reaches the middle of its flight,
        // not when it lands
        const point = document.createElement("span");
        point.dataset.fly = day;
        point.style.cssText =
          `position:absolute;left:0;top:0;width:0;height:0;transform:translate(${ax}px,${ay}px);`;
        const gFrom = flyGlyph(num, fromFont, color);
        const gTo = flyGlyph(num, toFont, color);
        gFrom.style.fontSize = `${fromFont.size}px`;
        gTo.style.fontSize = `${fromFont.size}px`;
        gTo.style.opacity = "0";
        point.append(gFrom, gTo);
        box.appendChild(point);
        fromEl.style.visibility = "hidden";
        toEl.style.visibility = "hidden";
        hiddenNumbers.push(fromEl, toEl);
        moves.push(
          animate(0, 1, {
            type: "spring",
            stiffness: 320,
            damping: 34,
            onUpdate: (t) => {
              point.style.transform = `translate(${ax + (bx - ax) * t}px,${
                ay + (by - ay) * t
              }px)`;
              const fs = fromFont.size + (toFont.size - fromFont.size) * t;
              gFrom.style.fontSize = `${fs}px`;
              gTo.style.fontSize = `${fs}px`;
              // crossover centred on t=0.5 — the flight's midpoint, so
              // the swap is never seen sitting at the origin or the
              // destination (no blur: the flight is too quick to read one)
              const k = Math.min(1, Math.max(0, (t - 0.4) / 0.2));
              gFrom.style.opacity = `${1 - k}`;
              gTo.style.opacity = `${k}`;
            },
          }).finished,
        );
      }
    }

    // the month's abbreviation morphs between its year-view mini label
    // and its hand-over label over the first of the month — one small
    // caps tag flying and resizing across the camera move
    const monthPair =
      (zoom.from === "year" && zoom.to === "month") ||
      (zoom.from === "month" && zoom.to === "year");
    if (monthPair) {
      const fromEl = outgoing.querySelector<HTMLElement>(
        `[data-flymonth="${CSS.escape(zoom.anchor)}"]`,
      );
      const toEl = incoming.querySelector<HTMLElement>(
        `[data-flymonth="${CSS.escape(zoom.anchor)}"]`,
      );
      if (fromEl && toEl) {
        const a = textRect(fromEl);
        const b = textRect(toEl);
        const ax = a.left + a.width / 2 - stageRect.left;
        const ay = a.top + a.height / 2 - stageRect.top;
        const bx = b.left + b.width / 2 - stageRect.left;
        const by = b.top + b.height / 2 - stageRect.top;
        const fromFont = readFont(fromEl);
        const toFont = readFont(toEl);
        const box = ensureFlyerBox();
        const point = document.createElement("span");
        point.dataset.flymonthFly = zoom.anchor;
        point.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;transform:translate(${ax}px,${ay}px);`;
        // same voice in both places, so one glyph that only travels and
        // resizes — colour copied so the current month keeps its wax
        const glyph = flyGlyph(fromEl.textContent ?? "", fromFont, readColor(fromEl));
        glyph.style.fontSize = `${fromFont.size}px`;
        point.appendChild(glyph);
        box.appendChild(point);
        fromEl.style.visibility = "hidden";
        toEl.style.visibility = "hidden";
        hiddenNumbers.push(fromEl, toEl);
        moves.push(
          animate(0, 1, {
            type: "spring",
            stiffness: 320,
            damping: 34,
            onUpdate: (t) => {
              point.style.transform = `translate(${ax + (bx - ax) * t}px,${
                ay + (by - ay) * t
              }px)`;
              glyph.style.fontSize = `${fromFont.size + (toFont.size - fromFont.size) * t}px`;
            },
          }).finished,
        );
      }
    }

    void Promise.all(moves).then(finish, finish);
  }, [zoom, reduceMotion]);

  // month ⇄ year camera moves (history-free). `openYear` adds the pushState and
  // the popstate handler replays these on a browser back/forward — bringing the
  // year glance to parity with the book and entry, which already ride history.
  const climbToYear = useCallback(
    (y: number) => {
      setVisibleYear(y);
      yearFeedRef.current?.goTo(y, false); // stand on the year before measuring
      runZoom("month", "year", ym(startOfMonth(visibleMonthRef.current)));
    },
    [runZoom],
  );
  const descendFromYear = useCallback(() => {
    const m = startOfMonth(visibleMonthRef.current);
    setVisibleMonth(m);
    monthFeedRef.current?.goTo(m, false);
    runZoom("year", "month", ym(m));
  }, [runZoom]);

  const openYear = () => {
    const y = visibleMonth.getFullYear();
    pushUrl(`${pathname}?y=${y}`);
    climbToYear(y);
  };

  const pickMonth = useCallback(
    (m: Date) => {
      setVisibleMonth(m);
      monthFeedRef.current?.goTo(m, false); // land exactly, behind the zoom
      runZoom("year", "month", ym(m));
    },
    [runZoom],
  );

  // "Calendar" in the dock, pressed while already on the page, climbs the
  // camera back to the canvas (month) altitude from wherever it is. The
  // glance drops straight down; the book and entry sit on real history
  // entries, so we walk back up through them (the entry's zoom only goes
  // entry⇄book, so the climb home from an entry takes two pops — the
  // effect below continues it once each zoom settles).
  const homeward = useRef(false);
  const goToCanvas = useCallback(() => {
    if (zooming.current) return;
    const cur = viewRef.current;
    if (cur === "month") return; // already the canvas
    // year sits one history entry above month (openYear pushed `?y=`), so a
    // single pop drops to the canvas — popstate runs the descendFromYear zoom
    if (cur === "year") {
      appBack();
      return;
    }
    homeward.current = true;
    appBack();
  }, [appBack]);

  useEffect(() => {
    const onHome = () => goToCanvas();
    window.addEventListener("calendar:home", onHome);
    return () => window.removeEventListener("calendar:home", onHome);
  }, [goToCanvas]);

  useEffect(() => {
    if (!homeward.current || zoom) return; // let each zoom settle first
    if (view === "month") homeward.current = false; // arrived
    else if (view === "schedule") appBack(); // book → canvas (an app climb: dives)
  }, [view, zoom, appBack]);

  /* climbing out happens through the history stack: UI back affordances
     call history.back(), and the popstate handler runs the zoom — so the
     browser's own back gesture and ours are the same action */

  const descendFromSchedule = useCallback(() => {
    // already climbed out (e.g. a deferred popstate retry firing late) — don't
    // re-run the book→canvas zoom, which would flash the departed book back in
    if (viewRef.current !== "schedule") return;
    // stand the canvas on the day actually on screen (liveDayRef, written
    // synchronously) before pulling back — selectedRef can still be a scroll
    // behind, which lands the canvas on the wrong month and then corrects
    const day = liveDayRef.current;
    const m = startOfMonth(dateFromDayKey(day));
    setVisibleMonth(m);
    setVisibleYear(m.getFullYear());
    monthFeedRef.current?.goTo(m, false);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    runZoom("schedule", "month", day);
  }, [runZoom]);

  // Back-out alternatives to the dive (behind ?backdebug). A browser back-swipe
  // on iOS plays its OWN native page-transition first, so the app's dive then
  // runs on top — the book reappears and re-shrinks after you've already left
  // it. These skip the dive and just present the canvas instead.

  // A browser-native back is snapped, not dived: the layer we land on just
  // appears. But the dive we're skipping left that layer inline-hidden (runZoom's
  // finish keeps a departed layer hidden until its class returns), so wake it or
  // it comes back blank; the class then drives visibility from here on.
  const wakeLayer = (el: HTMLDivElement | null) => {
    if (!el) return;
    el.style.visibility = "";
    el.style.transform = "";
    el.style.opacity = "";
  };

  // snap out of the book to the canvas, on the day last read — no dive
  const snapToMonthFromSchedule = useCallback(() => {
    if (viewRef.current !== "schedule") return;
    if (urlTimer.current) clearTimeout(urlTimer.current);
    wakeLayer(monthLayerRef.current);
    const day = liveDayRef.current;
    const m = startOfMonth(dateFromDayKey(day));
    setVisibleMonth(m);
    setVisibleYear(m.getFullYear());
    setSelected(day);
    monthFeedRef.current?.goTo(m, false);
    setView("month");
  }, []);

  // snap down from the year glance to the canvas — no dive
  const snapToMonthFromYear = useCallback(() => {
    if (viewRef.current !== "year") return;
    wakeLayer(monthLayerRef.current);
    const m = startOfMonth(visibleMonthRef.current);
    setVisibleMonth(m);
    monthFeedRef.current?.goTo(m, false);
    setView("month");
  }, []);

  // snap up from the canvas to the year glance — no dive
  const snapToYear = useCallback((y: number) => {
    if (viewRef.current !== "month") return;
    wakeLayer(yearLayerRef.current);
    setVisibleYear(y);
    yearFeedRef.current?.goTo(y, false);
    setView("year");
  }, []);

  const descendFromEntry = useCallback(() => {
    runZoom("entry", "schedule", focusedIdRef.current ?? "");
  }, [runZoom]);

  useEffect(() => {
    const onPop = () => {
      if (zooming.current) {
        // a camera move is mid-flight; settle, then honor the pop
        setTimeout(onPop, 240);
        return;
      }
      const sp = new URLSearchParams(window.location.search);
      const target: View = sp.get("e")
        ? "entry"
        : sp.get("d")
          ? "schedule"
          : sp.get("y")
            ? "year"
            : "month";
      const cur = viewRef.current;
      if (target === cur) return;
      // an app affordance (header/dock) set this before calling history.back();
      // a bare browser/native back leaves it false. App backs keep the dive;
      // native backs snap straight to the altitude (the browser already played
      // its own page transition — a dive on top re-shows the view you just left).
      const viaApp = appNavRef.current;
      appNavRef.current = false;
      if (DEPTH[target] < DEPTH[cur]) {
        // climbing to a higher altitude (the camera pulls out / up)
        if (cur === "entry") descendFromEntry();
        else if (cur === "schedule") {
          if (viaApp) descendFromSchedule();
          else snapToMonthFromSchedule();
        } else if (cur === "month" && target === "year") {
          const y = Number(sp.get("y"));
          if (viaApp) climbToYear(y);
          else snapToYear(y);
        }
      } else {
        // the forward gesture re-dives (camera pushes in / down)
        const d = sp.get("d");
        const e = sp.get("e");
        if (cur === "year") {
          // backing out of the year glance lands on the month floor
          if (viaApp) descendFromYear();
          else snapToMonthFromYear();
        } else if (cur === "month" && d) {
          liveDayRef.current = d;
          setSelected(d);
          scheduleFeedRef.current?.goTo(d);
          runZoom("month", "schedule", d);
        } else if (cur === "schedule" && e) {
          setFocusedId(e);
          runZoom("schedule", "entry", e);
        }
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [
    descendFromEntry,
    descendFromSchedule,
    snapToMonthFromSchedule,
    climbToYear,
    snapToYear,
    descendFromYear,
    snapToMonthFromYear,
    runZoom,
  ]);

  const closeSchedule = () => appBack();

  /** pressing a card dives the camera one altitude further, into it */
  const openEntry = useCallback(
    (id: string) => {
      navigator.vibrate?.(6);
      setFocusedId(id);
      // stand the header on the entry's own day so the month + year in
      // it hold still while the weekday and date wipe in
      const s = all?.find((x) => x.id === id);
      if (s) {
        liveDayRef.current = s.day;
        setSelected(s.day);
        const m = startOfMonth(dateFromDayKey(s.day));
        setVisibleMonth(m);
        setVisibleYear(m.getFullYear());
      }
      pushUrl(`${pathname}?d=${s?.day ?? selectedRef.current}&e=${id}`);
      runZoom("schedule", "entry", id);
    },
    [all, pathname, runZoom],
  );

  const closeEntry = () => appBack();

  // letting an entry go: mark the close as a deletion (so the zoom dissolves
  // the card rather than shrinking it back to a slot that's about to vanish),
  // soft-delete, then close over the struck line with an undo toast.
  const letGo = useCallback(
    async (snippet: Snippet) => {
      deleteCloseRef.current = true; // the next close is a deletion → dissolve
      setDeletingSnippet(snippet); // hold the words through the leave animation
      await softDeleteSnippet(snippet.id);
      appBack();
      letGoToast(() => void restoreSnippet(snippet.id));
    },
    [appBack],
  );

  /* ── the back swipe: a left-to-right flick climbs one altitude ────
     Trigger-on-release (the camera zoom is the transition) and touch/
     pen only, so a desktop text-selection drag can never misfire. */
  const swipe = useRef<{ x: number; y: number; t: number; ok: boolean } | null>(null);
  /** standing selected text owns the gestures: dragging its handles
      must never read as a back-swipe (navigating mid-selection left
      iOS holding handles over a view that no longer existed) */
  const selectionStands = () => {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed;
  };
  const armSwipe = (e: React.PointerEvent, ignoreInteractive: boolean) => {
    if (e.pointerType === "mouse") return;
    if (selectionStands()) return;
    const onControl = (e.target as HTMLElement).closest(
      "button, a, textarea, input, select",
    );
    swipe.current = {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      ok: !(ignoreInteractive && onControl),
    };
  };
  const settleSwipe = (e: React.PointerEvent, back: () => void) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !s.ok || selectionStands()) return;
    const dx = e.clientX - s.x;
    const dy = Math.abs(e.clientY - s.y);
    // rightward within a 45° cone, and a flick rather than a wander —
    // thumbs arc, so the cone is generous; truly vertical drags are
    // already claimed by the scroller before release anyway
    if (dx >= 56 && dx >= dy && performance.now() - s.t <= 700) back();
  };

  /** move the book to a day: selection, title, URL, scroll */
  const jumpTo = (key: string, smooth = false) => {
    liveDayRef.current = key;
    setSelected(key);
    const m = startOfMonth(dateFromDayKey(key));
    setVisibleMonth(m);
    setVisibleYear(m.getFullYear());
    if (urlTimer.current) clearTimeout(urlTimer.current);
    replaceUrl(`${pathname}?d=${key}`);
    scheduleFeedRef.current?.goTo(key, smooth);
  };

  /** the glance shows the lived years: the first entry's through
      today's (last week's on an empty book — early January still
      wants to backfill December). Dormant years between kept ones
      stand as empty blocks; a gap of five or more folds away, so old
      and new pages sit a scroll apart. The year the camera is over is
      always included — climbing out of 1980 needs a 1980 to land in —
      but without permanence: move the camera on, and it folds away */
  const anchorYear = visibleMonth.getFullYear();
  const glanceYearsRaw = useMemo(() => {
    const now = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);
    const nowYear = now.getFullYear();
    const kept = new Set([nowYear, lastWeek.getFullYear()]);
    for (const s of all ?? []) {
      const y = Number(s.day.slice(0, 4));
      if (y >= 1 && y <= nowYear) kept.add(y);
    }
    const years: number[] = [];
    let gap: number[] = [];
    for (let y = Math.min(...kept); y <= nowYear; y++) {
      if (kept.has(y)) {
        if (gap.length < 5) years.push(...gap);
        years.push(y);
        gap = [];
      } else {
        gap.push(y);
      }
    }
    if (anchorYear <= nowYear && !years.includes(anchorYear)) {
      years.push(anchorYear);
      years.sort((a, b) => a - b);
    }
    return years;
  }, [all, anchorYear]);
  // identity-stable through a string key: the camera crossing year
  // lines inside the lived span recomputes the same list, and that
  // must not rebuild the glance's geometry
  const glanceYearsKey = glanceYearsRaw.join(",");
  const glanceYears = useMemo(
    () => glanceYearsKey.split(",").map(Number),
    [glanceYearsKey],
  );
  // the canvas is the deep archive: back to January 1950, or the first
  // entry's year should an import reach further — so every month the
  // glance can name, the canvas can show
  const archiveYear = Math.min(ARCHIVE_YEAR, glanceYears[0]);
  const monthSpan = Math.max(
    1,
    (today.getFullYear() - archiveYear) * 12 + today.getMonth() + 1,
  );

  /** days that exist in the book, for stepping it by months */
  const keptDays = useMemo(() => {
    const days = new Set(counts ? [...counts.keys()] : []);
    days.add(dayKey());
    return [...days].sort();
  }, [counts]);

  const scheduleTarget = (delta: number): string | undefined => {
    const cur = ym(visibleMonth);
    return delta > 0
      ? keptDays.find((d) => d.slice(0, 7) > cur)
      : [...keptDays].reverse().find((d) => d.slice(0, 7) < cur);
  };

  const goToday = () => {
    liveDayRef.current = dayKey();
    setSelected(dayKey());
    if (view === "entry") {
      // pop to the book (the handler runs the zoom), then turn it
      appBack();
      jumpTo(dayKey());
      return;
    }
    if (view === "schedule") {
      // a quick smooth scroll to today, the way the month/year feeds glide
      jumpTo(dayKey(), true);
      return;
    }
    replaceUrl(pathname);
    if (view === "year" && !zoom) {
      pickMonth(currentMonth);
    } else {
      setVisibleMonth(currentMonth);
      monthFeedRef.current?.goTo(currentMonth, true);
    }
  };

  const stepFeed = (delta: number) => {
    if (view === "entry") return;
    if (view === "schedule") {
      const target = scheduleTarget(delta);
      if (target) jumpTo(target);
    } else if (view === "month") {
      const next = startOfMonth(addMonths(visibleMonth, delta));
      if (isAfter(next, currentMonth) || next.getFullYear() < archiveYear)
        return;
      setVisibleMonth(next);
      monthFeedRef.current?.goTo(next, true);
    } else {
      // step through the lived years — a folded gap is a single step
      const i = glanceYears.indexOf(visibleYear);
      const next = glanceYears[i + delta];
      if (i < 0 || next === undefined) return;
      setVisibleYear(next);
      yearFeedRef.current?.goTo(next, true);
    }
  };

  // Quick capture (the `c` key): land in today's book and put the pen in the
  // writer's hand, from wherever the camera is. Polls for the today-zone field
  // to mount (behind the zoom) and focuses it — a hardware-keyboard gesture,
  // so no on-screen-keyboard concern.
  const focusCaptureField = (frames = 90) => {
    const ta = document.querySelector<HTMLTextAreaElement>("textarea[data-room-center]");
    const a = document.activeElement;
    // keep trying until focus actually TAKES: a .focus() during the dive zoom
    // (the schedule layer still mid-transition / not yet visible) is silently
    // ignored, so one attempt isn't enough. Only claim focus from nothing (the
    // body) — never yank it off a field the writer chose in the meantime.
    if (ta && a !== ta && (a === document.body || a === null)) {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    if (frames > 0 && document.activeElement !== ta) {
      requestAnimationFrame(() => focusCaptureField(frames - 1));
    }
  };
  const quickCapture = () => {
    const t = dayKey();
    const cur = viewRef.current;
    if (cur === "schedule") jumpTo(t, true);
    else if (cur === "month") pick(t);
    else if (cur === "entry") { appBack(); setTimeout(() => jumpTo(t, true), 260); }
    else if (cur === "year") { descendFromYear(); setTimeout(() => pick(t), 300); }
    focusCaptureField();
  };

  // Date-grid keyboard navigation (WAI-ARIA date-picker pattern), attached to
  // the month layer so it hears whichever day button holds focus. Arrows step
  // a day (←→) or a week (↑↓); Home/End snap to the week's ends; PageUp/Down
  // step a month; Shift+PageUp/Down step a year. Focus follows to the target
  // day — stepping the feed first when the target's month isn't yet rendered
  // (the feed is virtualized), so nav flows across month boundaries seamlessly.
  const focusDayKey = (key: string, tries = 12) => {
    const btn = monthLayerRef.current?.querySelector<HTMLButtonElement>(
      `button[data-day-key="${key}"]`,
    );
    if (btn) {
      if (btn.disabled) return; // future day — nothing to land on
      btn.tabIndex = 0; // becomes the roving tab stop
      btn.focus();
      return;
    }
    if (tries <= 0) return;
    // the target's month isn't rendered — glide the feed to it, then retry
    monthFeedRef.current?.goTo(startOfMonth(dateFromDayKey(key)), false);
    requestAnimationFrame(() => focusDayKey(key, tries - 1));
  };
  const onDayGridKey = (e: React.KeyboardEvent) => {
    const el = document.activeElement as HTMLElement | null;
    const from = el?.getAttribute("data-day-key");
    if (!from) return; // focus isn't on a day cell
    const d = dateFromDayKey(from);
    let target: Date | null = null;
    switch (e.key) {
      case "ArrowLeft": target = addDays(d, -1); break;
      case "ArrowRight": target = addDays(d, 1); break;
      case "ArrowUp": target = addDays(d, -7); break;
      case "ArrowDown": target = addDays(d, 7); break;
      case "Home": target = addDays(d, -((d.getDay() - weekStart + 7) % 7)); break;
      case "End": target = addDays(d, 6 - ((d.getDay() - weekStart + 7) % 7)); break;
      case "PageUp": target = addMonths(d, e.shiftKey ? -12 : -1); break;
      case "PageDown": target = addMonths(d, e.shiftKey ? 12 : 1); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation(); // don't also trigger the stage's PageUp/Down feed step
    if (isAfter(startOfMonth(target), startOfMonth(today))) return; // no future months
    if (isAfter(target, today)) target = today; // clamp a future day to today
    el?.setAttribute("tabindex", "-1"); // hand the roving tab stop to the target
    focusDayKey(dayKey(target));
  };

  /* ── the header search: a pill that borrows the whole title row ──
     The title slides off left, the buttons off right; Clear hands the
     row back, reversing the same moves. While a query stands, the
     stage shows the book filtered to it. */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // the `?` keyboard cheat-sheet
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // the bar IS the glass's circle, grown to the row: its geometry
  // animates between the circle's measured box and the full row
  const titleRowRef = useRef<HTMLDivElement>(null);
  const glassRef = useRef<HTMLButtonElement>(null);
  const [pillBox, setPillBox] = useState<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null>(null);
  // the contraction is a visible move: the bar stays opaque while it
  // retracts into the circle, and only then hands the spot back
  const [pillClosing, setPillClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);
  // the index is built on first open, not on every visit — the command
  // menu already keeps one for the whole app
  const hits = useSearch(query, searching ? all : undefined);
  // engage the filtered view only once there's a usable (≥2-char) term, so a
  // lone "(" or a single letter doesn't swap the calendar for a result list
  const searchActive = searching && queryTerms(query).length > 0;
  const searchGroups = useMemo(() => {
    if (!searchActive) return [];
    // the book reads upward through time; the filtered book too
    const sorted = [...hits].sort((a, b) =>
      a.day === b.day ? a.capturedAt - b.capturedAt : a.day < b.day ? -1 : 1,
    );
    return groupByDay(sorted);
  }, [searchActive, hits]);
  // the latest match is the likeliest one: the filtered book opens at
  // its last page, like the book itself
  const searchScrollRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = searchScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [searchGroups]);

  /** where the glass circle stands right now, in the row's space —
      visibility:hidden keeps layout, so this measures mid-search too */
  const glassBox = () => {
    const row = titleRowRef.current;
    const g = glassRef.current;
    if (!row || !g) return null;
    const r = row.getBoundingClientRect();
    const b = g.getBoundingClientRect();
    return {
      left: b.left - r.left,
      right: r.right - b.right,
      top: b.top - r.top,
      bottom: r.bottom - b.bottom,
    };
  };
  const openSearch = () => {
    // focus synchronously, inside the gesture — iOS won't raise the
    // keyboard for a focus that arrives by timer
    searchInputRef.current?.focus();
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPillClosing(false);
    setPillBox(glassBox()); // seat the bar on the circle (untransitioned
    // at rest), and only once the seat has painted, let it grow
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setSearching(true)),
    );
  };
  const closeSearch = () => {
    setPillBox(glassBox()); // retract both sides back into the circle…
    setSearching(false);
    setQuery("");
    setPillClosing(true);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      // …and only once it lands, hand the spot back to the glass
      setPillClosing(false);
    }, 200);
  };

  // ── App-wide keyboard shortcuts ─────────────────────────────────────────
  // A single window listener, reading the latest handlers from a ref so it
  // subscribes once. Never hijacks typing (fields, the ⌘K command input);
  // ⌘/Ctrl/Alt combos pass straight through to the browser and the command
  // menu. Discoverable via `?`. The vocabulary:
  //   Esc      climb one altitude (entry→book→canvas→glance)
  //   /        open search        ·  t  jump to today  ·  c/n quick-capture
  //   j / k    step the feed forward / back (a month, a screen)
  //   g then m/y/t   go to canvas / glance / today   ·  ?  this cheat sheet
  const kbRef = useRef({
    view, searching, shortcutsOpen,
    appBack, goToday, openYear, goToCanvas, openSearch, closeSearch,
    quickCapture, stepFeed, setShortcutsOpen,
  });
  // refresh the handler snapshot after each commit (never during render); this
  // deliberately runs every render, so no dependency array
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    kbRef.current = {
      view, searching, shortcutsOpen,
      appBack, goToday, openYear, goToCanvas, openSearch, closeSearch,
      quickCapture, stepFeed, setShortcutsOpen,
    };
  });
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      );
    };
    let gAt = 0; // when `g` was last pressed, for the go-to prefix
    const onKey = (e: KeyboardEvent) => {
      const h = kbRef.current;
      if (e.metaKey || e.ctrlKey || e.altKey) return; // ⌘K etc. belong to others
      // the cheat sheet, once open, owns the keys: Esc or ? closes it
      if (h.shortcutsOpen) {
        if (e.key === "Escape" || e.key === "?") {
          e.preventDefault();
          h.setShortcutsOpen(false);
        }
        return;
      }
      if (isTyping()) return; // a field is focused — leave every key to it
      if (e.key === "?") { e.preventDefault(); h.setShortcutsOpen(true); return; }
      // the go-to prefix: `g` then a target within 1.2s
      const now = performance.now();
      if (gAt && now - gAt < 1200) {
        gAt = 0;
        if (e.key === "t") { e.preventDefault(); h.goToday(); return; }
        if (e.key === "m") { e.preventDefault(); h.goToCanvas(); return; }
        if (e.key === "y") { e.preventDefault(); if (h.view === "month") h.openYear(); return; }
      }
      switch (e.key) {
        case "Escape":
          if (h.view === "entry" || h.view === "schedule" || h.view === "year") {
            e.preventDefault();
            h.appBack();
          }
          break;
        case "/": e.preventDefault(); h.openSearch(); break;
        case "t": e.preventDefault(); h.goToday(); break;
        case "c": case "n": e.preventDefault(); h.quickCapture(); break;
        case "j": e.preventDefault(); h.stepFeed(1); break;
        case "k": e.preventDefault(); h.stepFeed(-1); break;
        case "g": gAt = now; break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** a found page opens in the book itself — straight there, from any
      altitude, never through the canvas */
  const jumpFromSearch = (day: string) => {
    const from = viewRef.current;
    closeSearch();
    if (from === "schedule") {
      jumpTo(day);
      return;
    }
    if (from === "month") {
      pick(day);
      return;
    }
    // from the glance the camera dives into the day's month-mini and
    // arrives directly at the book — the same dive as pick, one
    // altitude steeper
    liveDayRef.current = day;
    setSelected(day);
    navigator.vibrate?.(6);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    pushUrl(`${pathname}?d=${day}`);
    scheduleFeedRef.current?.goTo(day);
    runZoom("year", "schedule", day);
  };

  /** a found card opens straight into its own page — the entry view —
      with its book page synthesized beneath, so the card dives open from
      that page and backing out climbs entry → book → canvas */
  const openEntryFromSearch = (s: Snippet) => {
    closeSearch();
    if (urlTimer.current) clearTimeout(urlTimer.current);
    replaceUrl(pathname);
    pushUrl(`${pathname}?d=${s.day}`);
    scheduleFeedRef.current?.goTo(s.day); // the page behind the dive
    openEntry(s.id); // sets the entry, pushes ?d&e, zooms the book → card
  };

  // while the filtered book stands in the stage, the altitudes wait
  // beneath, hidden
  const showMonthLayer =
    !searchActive && (view === "month" || zoom?.from === "month");
  const showYearLayer =
    !searchActive && (view === "year" || zoom?.from === "year");
  const showScheduleLayer =
    !searchActive && (view === "schedule" || zoom?.from === "schedule");
  const showEntryLayer =
    !searchActive && (view === "entry" || zoom?.from === "entry");

  return (
    // NO page-settle here — the SSR Suspense fallback (CalendarSkeleton) already
    // wears it and plays the ONE entrance. This root mounts when Suspense swaps
    // the (already faded-in) skeleton for the real page, and a page-settle here
    // would restart the keyframe from opacity:0 on that fresh mount — a blank
    // frame that fades back in, reading as the book flashing out and returning a
    // beat after it first appeared. The swap is a seamless continuation instead:
    // the settled skeleton becomes the settled page with no second fade.
    <div className="flex h-full min-h-0 flex-col">
      {/* the current altitude, spoken to assistive tech after every zoom/jump.
          An h1 (not a p): the visible title is a click-to-climb BUTTON, not a
          heading, so without this the whole app had no h1 at all — nothing
          for VoiceOver's heading rotor to land on. sr-only, so no visual
          change; doubling as the live region costs nothing extra. */}
      <h1 aria-live="polite" className="sr-only">
        {view === "year"
          ? `Year ${visibleYear}`
          : view === "month"
            ? format(visibleMonth, "MMMM yyyy")
            : view === "schedule"
              ? friendlyDay(selected)
              : "Entry"}
      </h1>
      {/* the `?` keyboard cheat sheet */}
      <KeyboardShortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {/* perf A/B pill (temporary; shown with ?perfdebug) — flip the book cards'
          ink between blended and flat to test scroll/zoom jank on-device */}
      {perfDebug && (
        <div className="float fixed bottom-3 left-3 z-50 flex items-center rounded-full p-0.5">
          <button
            type="button"
            onClick={togglePerf}
            aria-pressed={perfFlat}
            className={cn(
              "voice-label pressable rounded-full px-2.5 py-1 text-[0.72rem]",
              perfFlat ? "bg-wax/15 text-wax" : "text-ink-soft",
            )}
          >
            {perfFlat ? "flat ink" : "blend ink"}
          </button>
        </div>
      )}
      {/* title row: the title always climbs one altitude; it follows
          whichever feed is scrolling beneath it, and stays pinned when
          the page itself has to scroll. No painted background — a flat
          fill over the textured sheet reads as a white band */}
      <div className="sticky top-0 z-30">
      <div ref={titleRowRef} className="relative flex items-center justify-between">
        {/* the title yields the row to the search, sliding off left —
            a wrapper carries the move because .pressable owns the
            button's transition property */}
        <div
          className={cn(
            "min-w-0 transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)]",
            searching && "pointer-events-none -translate-x-[115%] opacity-0",
          )}
          aria-hidden={searching}
        >
        {view === "year" ? (
          <h2 className="voice-display text-(length:--date-head)">{visibleYear}</h2>
        ) : (
          <button
            type="button"
            data-cal-title
            onClick={
              view === "month"
                ? openYear
                : view === "schedule"
                  ? closeSchedule
                  : closeEntry
            }
            aria-label={
              view === "month"
                ? copy.calendar.backToGlance(visibleMonth.getFullYear())
                : view === "schedule"
                  ? copy.calendar.backToGrid(format(visibleMonth, "MMMM yyyy"))
                  : copy.calendar.backToDays
            }
            className="voice-display pressable whitespace-nowrap rounded-[5px] text-left text-(length:--date-head) hover:text-wax"
          >
            {/* the genuine Fraunces guillemet, extracted from the font
                at the title's exact instance (wght 560, SOFT 0, WONK 1)
                and inlined as drawn ink — same typeface as the date,
                but through the SVG pipeline, since the text glyph
                rendered zero-width on iOS no matter how it was sized */}
            <svg
              aria-hidden="true"
              viewBox="0 0 580.5 770.7"
              className="mr-1.5 inline-block h-[0.58em] w-auto -translate-y-[0.08em] text-ink-faint"
              fill="currentColor"
            >
              <path d="M2.5 361.7Q9.2 341.0 29.6 323.6Q50.0 306.3 93.9 280.9Q194.1 222.2 270.3 175.3Q346.5 128.4 404.2 89.6Q461.8 50.7 505.6 17.8Q526.6 4.1 545.6 0.8Q564.5 -2.5 573.8 7.3Q584.0 18.1 578.7 33.0Q573.3 47.9 557.4 66.6Q528.7 98.6 492.7 135.8Q456.7 172.9 412.8 215.7Q369.0 258.5 316.2 308.1Q263.3 357.6 200.6 414.5L209.2 350.7Q254.5 428.8 286.1 494.0Q317.6 559.3 339.9 613.0Q362.2 666.7 378.3 711.2Q384.8 727.5 382.6 742.0Q380.5 756.4 367.8 764.6Q353.6 773.3 339.9 769.5Q326.2 765.8 313.8 751.2Q286.3 712.3 249.6 665.8Q212.9 619.3 162.8 564.8Q112.7 510.4 43.4 448.7Q14.2 421.7 5.3 402.8Q-3.6 383.8 2.5 361.7Z" />
            </svg>
            {/* the header climbs to the full date in the entry view: the
                weekday and day-of-month wipe in from their own spots
                while the month and year hold still */}
            <WipeWord open={view === "entry"}>
              {format(dateFromDayKey(selected), "EEEE")},{" "}
            </WipeWord>
            {format(visibleMonth, "MMMM")}
            <WipeWord open={view === "entry"}>
              {" "}
              {format(dateFromDayKey(selected), "d")},
            </WipeWord>{" "}
            {format(visibleMonth, "yyyy")}
          </button>
        )}
        </div>
        {/* the navigation controls have no business in a single entry —
            they fade out and yield their width so the full date never
            wraps. The glass stands apart: searching, it grows into the
            bar while the rest of the cluster slides off right */}
        <div
          className={cn(
            "flex shrink-0 items-center transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)]",
            view === "entry" && "pointer-events-none w-0 overflow-hidden opacity-0",
          )}
          aria-hidden={view === "entry"}
        >
          <button
            ref={glassRef}
            type="button"
            onClick={openSearch}
            aria-label={copy.search.entriesLabel}
            aria-expanded={searching}
            className={cn(
              // the cards' material, drawn into a circle as tall as
              // the grown bar — the same coin the avatar is struck
              // from. Centered on the title text (the full-height
              // negative margins keep its box out of the row's layout,
              // so the frame below never moves)
              "pressable -my-[15px] grid h-[30px] w-[30px] shrink-0 place-items-center self-center rounded-full border border-rule-faint bg-paper text-ink-soft shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] hover:bg-paper-raised hover:text-ink",
              (searching || pillClosing) && "invisible",
            )}
          >
            {/* a hand-drawn glass, in the dock strokes' own line */}
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="size-[1rem]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <circle cx="8.8" cy="8.6" r="5.3" />
              <path d="M12.8 12.8 17 17.2" />
            </svg>
          </button>
          <div
            className={cn(
              "flex items-center transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)]",
              searching && "pointer-events-none translate-x-[115%] opacity-0",
            )}
            aria-hidden={searching}
          >
            {/* standing on today, the button wipes away to the right
                and yields its width — the glass slides over to the
                corner; scroll away and it returns the same way */}
            <div
              className={cn(
                "grid transition-[grid-template-columns] duration-[var(--dur-base)] ease-[var(--ease-out)]",
                atToday ? "grid-cols-[0fr]" : "grid-cols-[1fr]",
              )}
              aria-hidden={atToday}
            >
              <div
                className={cn(
                  "flex min-w-0 overflow-hidden transition-[transform,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)]",
                  atToday && "pointer-events-none translate-x-4 opacity-0",
                )}
              >
                <button
                  type="button"
                  onClick={goToday}
                  disabled={atToday || view === "entry"}
                  className="voice-label pressable ml-1 mr-1.5 rounded-[5px] px-2 py-1 leading-none text-wax hover:bg-accent"
                >
                  Today
                </button>
              </div>
            </div>
          </div>
        </div>
        {/* the search bar IS the glass's circle, grown: its box
            animates between the circle's measured spot and the whole
            row. From the first frame of the retraction its content is
            the glass again — riding the bar's center home — and the
            landing swap is atomic: at that instant the contracted bar
            and the coin are the same pixels */}
        <div
          className={cn(
            "absolute z-10",
            // at rest there is no transition: the seat before a growth
            // and the landing swap after a retraction are both instant
            // (and the resting bar stays focusable for the gesture's
            // synchronous focus — visibility:hidden would refuse it)
            searching || pillClosing
              ? "transition-[left,right,top,bottom,opacity] duration-[var(--dur-base)] ease-[var(--ease-out)] opacity-100"
              : "transition-none opacity-0",
            !searching && "pointer-events-none",
          )}
          style={
            searching
              ? { left: 0, right: 0, top: 0, bottom: 0 }
              : (pillBox ?? { left: "100%", right: 0, top: 0, bottom: 0 })
          }
          aria-hidden={!searching}
        >
          <div className="relative flex h-full items-center overflow-hidden rounded-full border border-rule-faint bg-paper pl-4 pr-1.5 shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] transition-colors duration-150 focus-within:border-rule">
            {/* the glass, centered, for the trip back */}
            <span
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 grid place-items-center text-ink-soft",
                searching
                  ? "opacity-0 transition-opacity duration-[var(--dur-fast)]"
                  : "opacity-100",
              )}
            >
              <svg
                viewBox="0 0 20 20"
                className="size-[1rem]"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <circle cx="8.8" cy="8.6" r="5.3" />
                <path d="M12.8 12.8 17 17.2" />
              </svg>
            </span>
            {/* words and Clear leave the moment the retraction begins */}
            <span
              className={cn(
                "flex min-w-0 flex-1 items-center",
                searching
                  ? "opacity-100 transition-opacity duration-[var(--dur-fast)]"
                  : "opacity-0",
              )}
            >
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeSearch();
                  else if (e.key === "Enter" && searchGroups.length)
                    jumpFromSearch(searchGroups[searchGroups.length - 1].day);
                }}
                onBlur={() => {
                  // dismissing the keyboard over an empty bar dismisses
                  // the bar; standing words keep it open
                  if (searching && !query.trim()) closeSearch();
                }}
                placeholder={copy.search.schedule}
                aria-label={copy.search.entriesLabel}
                tabIndex={searching ? 0 : -1}
                className="voice-prose min-w-0 flex-1 bg-transparent text-[0.95rem] outline-none placeholder:italic placeholder:text-ink-faint"
              />
              <button
                type="button"
                onClick={closeSearch}
                tabIndex={searching ? 0 : -1}
                className="voice-label pressable shrink-0 rounded-full px-2.5 py-1 text-[0.72rem] text-ink-faint hover:bg-accent hover:text-ink"
              >
                Clear
              </button>
            </span>
          </div>
        </div>
      </div>
      </div>

      {/* the weekday rail exists only at the month altitude; elsewhere
          it folds shut so content sits flush under the title, and its
          hairline — the line where the scroll area terminates — rides
          along to sit beneath the month header */}
      <div
        className={cn(
          "mt-5 grid border-b border-rule-faint transition-[grid-template-rows] duration-[var(--dur-slow)] ease-[var(--ease-out)]",
          view === "month" && !searchActive
            ? "grid-rows-[1fr]"
            : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            role="row"
            className={cn(
              "grid grid-cols-7 transition-opacity duration-150",
              view === "month" && !searchActive ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={view !== "month" || searchActive}
          >
            {weekdays(weekStart).map((d, i) => (
              <span
                key={`${d}${i}`}
                role="columnheader"
                className="voice-label pb-2 text-center text-[0.78rem] text-ink-faint"
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* the stage: one fixed frame for every altitude. It fills the
          column, and its terminating hairline sits the same distance
          from the sheet's bottom as the header stands from its top —
          and never moves between views */}
      <div
        ref={stageRef}
        className={cn(
          // every feed now carries its own scroll terminus (the standard
          // foot hairline), so the frame's own line is retired — the
          // border stays transparent to hold the 1px the layout expects
          // -mx-2: the stage borrows the shell's 8px bleed lane (main is
          // already -mx-2/px-2, overflow hidden) so the today zone's press
          // bloom and the cards' seat shadows have room before the clip;
          // every layer below pads the 8px back, so nothing lays out wider
          "relative -mx-2 min-h-0 flex-1 overflow-hidden border-b border-transparent",
        )}
        onKeyDown={(e) => {
          if (e.key === "PageUp") {
            e.preventDefault();
            stepFeed(-1);
          } else if (e.key === "PageDown") {
            e.preventDefault();
            stepFeed(1);
          }
        }}
      >
        <div
          ref={monthLayerRef}
          data-layer="month"
          onKeyDown={onDayGridKey}
          // a swipe begun on the canvas itself (the blank cells and
          // label rows between months, never a day) climbs to the year
          onPointerDown={(e) => armSwipe(e, true)}
          onPointerUp={(e) => settleSwipe(e, openYear)}
          onPointerCancel={() => (swipe.current = null)}
          className={cn(
            "absolute inset-0 px-2 [touch-action:pan-y]",
            !showMonthLayer && "invisible",
            (zoom || !showMonthLayer) && "pointer-events-none",
          )}
        >
          {(view === "month" || warm >= 1) && (
            <MonthFeed
              handleRef={monthFeedRef}
              active={view === "month" && !zoom}
              frozen={!showMonthLayer}
              today={today}
              span={monthSpan}
              counts={counts}
              selected={selected}
              onPick={pick}
              onVisible={(m) => {
                setVisibleMonth(m);
                setVisibleYear(m.getFullYear());
              }}
            />
          )}
        </div>
        <div
          ref={yearLayerRef}
          data-layer="year"
          className={cn(
            "absolute inset-0",
            !showYearLayer && "invisible",
            (zoom || !showYearLayer) && "pointer-events-none",
          )}
        >
          {(view === "year" || warm >= 3) && (
            <YearFeed
              handleRef={yearFeedRef}
              active={view === "year" && !zoom}
              frozen={!showYearLayer}
              today={today}
              years={glanceYears}
              counts={counts}
              onPickMonth={(m) => {
                // picking a month leaves the glance for the canvas — drop the
                // `?y=` so the URL reflects the month (no stale year param)
                replaceUrl(pathname);
                pickMonth(m);
              }}
              onVisible={setVisibleYear}
            />
          )}
        </div>
        <div
          ref={scheduleLayerRef}
          data-layer="schedule"
          // pan-y keeps iOS from claiming horizontal touches, so the
          // back swipe's release always arrives; tiles and composers
          // don't arm it — a swipe must begin on the page itself
          onPointerDown={(e) => armSwipe(e, true)}
          onPointerUp={(e) => settleSwipe(e, closeSchedule)}
          onPointerCancel={() => (swipe.current = null)}
          className={cn(
            "absolute inset-0 px-2 [touch-action:pan-y]",
            !showScheduleLayer && "invisible",
            (zoom || !showScheduleLayer) && "pointer-events-none",
          )}
        >
          {(view === "schedule" || warm >= 1) && (
            <ScheduleFeed
              handleRef={scheduleFeedRef}
              active={view === "schedule" && !zoom}
              // un-stick the margin dates ONLY while the book is being scaled as
              // a rigid block (month/year⇄schedule). An entry⇄schedule move just
              // fades the book — no scale — so the dates must stay sticky there,
              // or the focused day's number jumps from its pinned slot to its
              // section top for the length of the card animation.
              diveFreeze={
                !!zoom &&
                zoom.from !== "entry" &&
                zoom.to !== "entry" &&
                (zoom.from === "schedule" || zoom.to === "schedule")
              }
              today={today}
              selected={selected}
              all={all}
              recovery={recovery}
              onVisible={onScheduleDay}
              onOpen={openEntry}
            />
          )}
        </div>
        <div
          ref={entryLayerRef}
          data-layer="entry"
          onPointerDown={(e) => armSwipe(e, false)}
          onPointerUp={(e) => settleSwipe(e, closeEntry)}
          onPointerCancel={() => (swipe.current = null)}
          className={cn(
            // pt-2 mirrors the schedule card's gap below its date rule,
            // so the expanded card keeps that same breath under the title
            // pb-1.5: the card's bloom grows ~4px past its box from a center
            // origin, and the stage clips at its bottom edge — the bottom
            // breathing room mirrors what pt-2 already gives the top
            "absolute inset-0 px-2 pb-1.5 pt-2 [touch-action:pan-y]",
            !showEntryLayer && "invisible",
            (zoom || !showEntryLayer) && "pointer-events-none",
          )}
        >
          {(view === "entry" || warm >= 2) && <EntryView snippet={focused} onLetGo={letGo} />}
          {/* the leave animation is driven by the zoom effect on the card box */}
        </div>
        {/* the filtered book: while a query stands, the stage shows the
            schedule of matching pages — same ledger, same tiles, only
            the days that answer. Pressing one opens that page in the
            book itself. No animation: it re-renders with every keystroke */}
        {searchActive && (
          <div
            ref={searchScrollRef}
            data-layer="search"
            className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain px-2 [scrollbar-width:none]"
            tabIndex={-1}
          >
            {searchGroups.length === 0 ? (
              <p className="voice-prose pt-10 text-center text-[0.92rem] italic text-ink-faint">
                Nothing kept matches.
              </p>
            ) : (
              searchGroups.map((g, i) => {
                const d = dateFromDayKey(g.day);
                const newMonth =
                  i === 0 ||
                  searchGroups[i - 1].day.slice(0, 7) !== g.day.slice(0, 7);
                const isToday = g.day === dayKey();
                return (
                  <Fragment key={g.day}>
                    {newMonth && (
                      <p
                        className={cn(
                          "voice-label px-1 pb-1.5 pt-5 text-[0.82rem]",
                          isSameMonth(d, today) ? "text-wax" : "text-ink-soft",
                        )}
                      >
                        {format(d, "MMMM yyyy")}
                      </p>
                    )}
                    <section
                      data-found={g.day}
                      aria-label={friendlyDay(g.day)}
                      className="grid grid-cols-[2.1rem_1fr] gap-x-2 border-t border-rule-faint"
                    >
                      <div className="self-start pb-3 pt-2 text-center">
                        <span
                          className={cn(
                            "voice-label block text-[0.62rem] leading-tight",
                            isToday ? "text-wax" : "text-ink-faint",
                          )}
                        >
                          {format(d, "EEE")}
                        </span>
                        <span
                          className={cn(
                            "voice-display block text-[1.15rem] leading-tight tabular-nums",
                            isToday && "text-wax",
                          )}
                        >
                          {format(d, "d")}
                        </span>
                      </div>
                      <ul className="flex min-w-0 flex-col gap-1 pb-3 pt-2">
                        {g.snippets.map((s) => (
                          <li key={s.id}>
                            <div className="transition-transform duration-[500ms] ease-[var(--ease-bloom)]">
                            <button
                              type="button"
                              onClick={() => openEntryFromSearch(s)}
                              // isolate: bake the marked ink's blend so the
                              // filtered book scrolls without re-blending
                              className={cn(
                                "pressable-lit isolate block w-full rounded-[6px] border [border-color:var(--card-seat-border)] bg-paper p-2.5 text-left",
                                "[box-shadow:var(--card-seat)] hover:bg-paper-raised",
                              )}
                            >
                              <PressGlow grow="parent" growWhileFocused={false} className="rounded-[6px]" />
                              {/* relative: the marked words stay ink ON the light */}
                              <div className="relative">
                                <MarkedPreview
                                  text={s.text}
                                  query={query}
                                  isQuote={s.kind === "quote"}
                                />
                              </div>
                            </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </Fragment>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── the schedule: the book of kept days ────────────────────────── */

// The book's empty/filled state, cached from the last resolved query so the
// NEXT load can pick its skeleton synchronously (which one to hold isn't
// knowable until the IndexedDB query returns — but the answer rarely changes
// between loads, and a stale guess self-corrects the instant the book lands).
const BOOK_EMPTY_KEY = "snippets:book-empty";

// Dev-only, in ?skeldebug's spirit: ?lockdebug forces the locked letter (the
// real state needs an enrolled account and a keyless device — unreachable in
// a sandbox), ?lockdebug=214 fakes the waiting count. Read at module load,
// before the calendar's mount effects rewrite the URL to ?d=…. Like skeldebug
// it never reaches the production domain — src/proxy.ts strips both params
// there, the same lockdown that 404s /lab.
const LOCK_DEBUG: number | null = (() => {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("lockdebug");
  return v === null ? null : Number(v) || 0;
})();

/**
 * The deepest altitude is the book itself: every day that holds
 * something, stacked in time, the dates standing in the margin like a
 * ledger. Today is always present even when blank; days between simply
 * don't exist — except the page the reader explicitly opened
 * (`probe`), which offers its composer.
 */
function ScheduleFeedBase({
  handleRef,
  active,
  diveFreeze,
  today,
  selected,
  all,
  recovery,
  onVisible,
  onOpen,
}: {
  handleRef: React.MutableRefObject<ScheduleFeedHandle | null>;
  active: boolean;
  diveFreeze: boolean;
  today: Date;
  selected: string;
  all: Snippet[] | undefined;
  // a crash-loop recovery load: keep the book light (recent days only), never
  // auto-mount the full history — see the fullBook effect
  recovery: boolean;
  onVisible: (day: string) => void;
  onOpen: (id: string) => void;
}) {
  const todayKey = dayKey(today);
  const yesterdayKey = useMemo(() => {
    const d = dateFromDayKey(todayKey);
    d.setDate(d.getDate() - 1);
    return dayKey(d);
  }, [todayKey]);
  /** the day the book was opened to — keeps its composer row mounted
      and never moves with the reader's scroll */
  const [probe, setProbe] = useState<string | null>(selected);
  // First paint renders only a screenful of days; the rest of the history
  // mounts a frame later, off the critical path — so opening the book costs a
  // constant ~screenful no matter how many years it holds. Opening at the foot
  // (today), the window is the most recent days; a deep-link to an old day
  // windows AROUND that day instead. The deep-link case used to render the
  // whole ledger synchronously "so its row exists to land on" — but after a
  // memory crash iOS reloads the crashed ?d= URL, so that full build landed
  // exactly on the device that had just proven it couldn't afford it, and one
  // crash became "A problem repeatedly occurred". The windowed target row
  // exists to land on all the same.
  const [fullBook, setFullBook] = useState(false);
  // a pending kept draft for today means a keep JUST happened (it's cleared once
  // the live row lands) — the only time today's date should wipe in (never on a
  // page refresh)
  const todayJustKept = !!useKeptDraft()?.drafts[todayKey];
  const scrollerRef = useRef<HTMLDivElement>(null);
  // keep a focused composer/editor clear of the keyboard and its floating pills
  useKeyboardRoom(scrollerRef, active);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const spyRef = useRef<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const didInit = useRef(false);
  // a Today scroll owns the header while it animates: the days it passes must
  // not each claim the title (which flashes the Today button back in)
  const progTargetRef = useRef<number | null>(null);
  const progTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // a land-on-today scroll re-asserts the bottom a couple times while the zone's
  // flex height settles after a fresh mount; these are its (cancellable) timers
  const todaySettleRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // holds the foot against post-landing layout breath (see scrollToRow)
  const todayRORef = useRef<{ disconnect: () => void } | null>(null);
  // the reader has grabbed the scroll themselves — a still-pending land-on-today
  // re-pin (settle timers, or the full-book mount) must then stand down so it
  // can't yank them back to the foot after they've started scrolling
  const tookOverRef = useRef(false);
  // true while a Today scroll is gliding to the foot: the days it passes must not
  // claim the header (which would flicker the Today button back in mid-flight)
  const landingTodayRef = useRef(false);
  // the rows' geometry, read ONCE per layout and cached — the scroll
  // spy then finds the stacked day from scrollTop alone, never reading
  // ~90 rows' offsets on the scroll path (that first read forced the
  // whole document's first layout — the stall on the opening scroll)
  const rowGeomRef = useRef<
    Array<{ day: string; top: number; bottom: number; headH: number }>
  >([]);
  const measureRows = useCallback(() => {
    const geom: Array<{ day: string; top: number; bottom: number; headH: number }> =
      [];
    for (const [day, row] of rowRefs.current) {
      const headH =
        (row.firstElementChild as HTMLElement | null)?.offsetHeight ?? 48;
      const top = row.offsetTop;
      geom.push({ day, top, bottom: top + row.offsetHeight, headH });
    }
    geom.sort((a, b) => a.top - b.top);
    rowGeomRef.current = geom;
  }, []);

  const rows = useMemo(() => {
    if (!all) return null;
    const groups = groupByDay([...all].reverse()); // oldest → newest
    // within a day, order by id (a ULID minted at creation) so the newest-kept
    // entry always sits at the FOOT of its day's stack. Existing rows carry
    // id = ulid(capturedAt), so for them this is identical to time order; a
    // backfilled entry (captured at noon of a past day, but minted now) lands
    // last instead of in the middle.
    const byId = (a: Snippet, b: Snippet) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const map = new Map(groups.map((g) => [g.day, [...g.snippets].sort(byId)]));
    const days = new Set(map.keys());
    // today always earns its page. In zone mode its section stays invisible
    // until it holds an entry (so the kept card can wipe into an already-mounted
    // list, and nothing remounts mid-animation); the big date lives in the zone.
    days.add(todayKey);
    // yesterday earns a page so a memory from it can still be caught — carrying
    // its own "add something from yesterday" invite when it's empty (below).
    // Only once the book holds something, though: a brand-new user (nothing
    // captured anywhere yet) opens to today's zone alone, nothing to review
    // above it until they've kept their first thing.
    if (all.length > 0 && !map.has(yesterdayKey)) {
      days.add(yesterdayKey);
    }
    if (probe) days.add(probe);
    return [...days].sort().map((day) => ({
      day,
      snippets: map.get(day) ?? ([] as Snippet[]),
    }));
  }, [all, probe, todayKey, yesterdayKey]);

  // the rows actually rendered on first paint: FIRST_PAINT_DAYS around the
  // landing day (the tail when landing on today, a centered slice for a
  // deep-link into history) until the full book mounts a frame later
  const FIRST_PAINT_DAYS = 35;
  const windowRows = useMemo(() => {
    if (!rows) return rows;
    if (fullBook || rows.length <= FIRST_PAINT_DAYS) return rows;
    if (selected === todayKey) return rows.slice(-FIRST_PAINT_DAYS);
    const i = rows.findIndex((r) => r.day === selected);
    if (i < 0) return rows;
    const start = Math.max(0, i - Math.floor(FIRST_PAINT_DAYS / 2));
    return rows.slice(start, start + FIRST_PAINT_DAYS);
  }, [rows, fullBook, selected, todayKey]);
  // whether the window reaches the ledger's tail — only then does the today
  // zone belong at its foot; a mid-history window must not seat today's
  // composer under some past June for its one frame of life
  const windowTail =
    !rows ||
    !windowRows ||
    windowRows[windowRows.length - 1]?.day === rows[rows.length - 1]?.day;

  const scrollToRow = useCallback((day: string, smooth = false) => {
    const el = scrollerRef.current;
    const row = rowRefs.current.get(day);
    if (!el) return false;
    // any new scroll cancels a still-pending land-on-today re-assert/hold; this
    // is a deliberate (programmatic) landing, so we own the scroll again until
    // the reader next grabs it
    todaySettleRef.current.forEach(clearTimeout);
    todaySettleRef.current = [];
    todayRORef.current?.disconnect();
    todayRORef.current = null;
    tookOverRef.current = false;
    if (day !== todayKey) landingTodayRef.current = false;
    // "today" lives at the very foot (its fill zone fills the tail) — land on
    // the bottom so the zone is shown, not the top of today's row (and when the
    // zone stands in for a blank today there's no today row to land on anyway)
    if (day === todayKey) {
      spyRef.current = day;
      progTargetRef.current = null;
      // hold the header on today the whole way down (cleared on arrival / by the
      // backup timer), so passing days don't flicker the Today button back in
      landingTodayRef.current = true;
      // Land Today WITHOUT reading scrollHeight/clientHeight. Those are unstable
      // through a month→schedule dive — the tapped day's composer is still mounted
      // above, the zoom is animating, and on iOS the toolbars reflow the viewport
      // a beat later — so a foot computed from them lands off by a constant (it's
      // why this misfired only on the first Today press after a dive, never after
      // a refresh or back-from-entry, where the layout is already at rest). Pin the
      // today section's rule to the scroller's TOP instead: a relative measure
      // between two elements, immune to those transients. The zone (flex-1, in a
      // min-h-full wrapper) fills exactly the viewport below the rule, so
      // rule-at-top IS the resting foot. A today WITH entries seats no empty zone,
      // so it lands at the literal foot.
      const footDelta = () => {
        const s = scrollerRef.current;
        if (!s) return null;
        const sec = rowRefs.current.get(todayKey);
        // a re-render (live data arriving, rows remounting) unmaps the
        // section ref for a beat. The literal-foot fallback sits 6px off the
        // rule-pin stance, so a pass landing in that window wrote the OTHER
        // stance and the page flip-flopped as it set — skip instead; the
        // next pass reads the settled truth. Literal foot is only ever the
        // right answer for a today that truly has entries.
        if (!sec) return null;
        if (!sec.querySelector("[data-entry]"))
          return sec.getBoundingClientRect().top - s.getBoundingClientRect().top;
        return s.scrollHeight - s.clientHeight - s.scrollTop;
      };
      // ABSOLUTE writes only, never scrollBy: iOS's async scrolling applies a
      // relative scrollBy a second time after the JS-visible update, so every
      // relative write overshot by its own delta a beat later (the refresh
      // wobble). An absolute target is idempotent under that double-application.
      const pinFoot = (behavior: ScrollBehavior) => {
        const s = scrollerRef.current;
        if (!s) return;
        const d = footDelta();
        if (d != null && Math.abs(d) > 1) s.scrollTo({ top: s.scrollTop + d, behavior });
      };
      // a micro-correction may only fire against a STILL layout: the same
      // delta observed on two consecutive frames. iOS settles its toolbars
      // ~1.5s after a load, and a correction measured mid-transient wrote a
      // 6px "fix" onto an already-correct page — which the next pass then
      // pulled back: a visible wobble as the page set. Mid-flight reads skip;
      // the next scheduled pass retries against the settled truth.
      const settleFoot = () => {
        if (tookOverRef.current) return;
        // a focused field hands the scroll to the keyboard pin (anchorTail /
        // keyboard-room) — and the late passes below live long enough to
        // overlap a composer focus. Same bail reseat takes: stand down rather
        // than yank the risen page back to the foot.
        if (document.activeElement?.tagName === "TEXTAREA") return;
        const d1 = footDelta();
        if (d1 == null || Math.abs(d1) <= 1) return;
        requestAnimationFrame(() => {
          if (tookOverRef.current) return;
          const d2 = footDelta();
          if (d2 == null || Math.abs(d2) <= 1) return;
          if (Math.abs(d2 - d1) > 1) return; // layout in motion — not a settle moment
          const s2 = scrollerRef.current;
          if (!s2) return;
          s2.scrollTo({ top: s2.scrollTop + d2, behavior: "instant" }); // absolute (see pinFoot)
        });
      };
      // ONE smooth glide — never re-commanded mid-flight (overlapping smooth
      // scrolls are what made this stutter). For the press, wait a frame first so
      // the probe→today re-render has unmounted the tapped day's composer above us;
      // gliding before that would land short by its height. (A toolbar reflow needs
      // no chasing: it's viewport-relative, so it never moves the rule relative to
      // the top.)
      if (smooth) {
        requestAnimationFrame(() => pinFoot("smooth"));
      } else {
        pinFoot("instant");
      }
      todaySettleRef.current.push(
        setTimeout(() => { landingTodayRef.current = false; }, 700),
        // INSTANT micro-corrections, only AFTER the glide has settled (never during
        // — that's the stutter): snap out any residual once the layout is still.
        // No-ops unless something shifted the rule, so normally invisible — and
        // skipped entirely if the reader has started scrolling (don't yank them).
        setTimeout(settleFoot, 560),
        setTimeout(settleFoot, 920),
        // a pass skipped for a mid-flight layout retries here, well after the
        // toolbars have settled
        setTimeout(settleFoot, 1400),
        // …except on a COLD navigation (new tab — worst with the URL-bar
        // keyboard still up, but reproduced without it), where iOS re-sizes
        // the layout viewport ~1.5–2s in, AFTER every pass above has fired —
        // and the landing stayed pinned to the pre-settle foot. Two late
        // passes reach past that settle; guarded like the rest, so on a page
        // that's already right they read once and no-op.
        setTimeout(settleFoot, 2200),
        setTimeout(settleFoot, 3400),
      );
      // The content keeps BREATHING after the landing — live rows arriving,
      // enrichment chips, font swaps each nudge the heights above the foot —
      // and iOS has no scroll anchoring to absorb that, so the page visibly
      // shifts and a timer-based correction lands up to half a second LATER:
      // that lag is the refresh wobble (on-device tracing showed the flips
      // with NO anchor writes at all — pure layout breath + late settles).
      // A ResizeObserver fires post-layout, PRE-PAINT: re-seating the foot in
      // its callback corrects in the same frame as the disturbance, which is
      // invisible. Lives only through the settle window; a reader's takeover
      // or a focused field (the keyboard pin owns the scroll then) stands it
      // down.
      const sEl = scrollerRef.current;
      let reseatTrail: ReturnType<typeof setTimeout> | undefined;
      const reseat = (entries?: ResizeObserverEntry[]) => {
        if (tookOverRef.current) return;
        if (document.activeElement?.tagName === "TEXTAREA") return; // keyboard pin owns it
        // the SCROLLER itself resizing is the viewport moving — iOS dismissing
        // the URL-bar keyboard, the chrome settling after a cold navigation —
        // and mid-transition its scrollHeight/clientHeight aren't a consistent
        // pair, so an instant pin here committed a wrong foot that then STUCK
        // (bottom- or top-clipped, by the sample's sign). Viewport moves take
        // the guarded path instead: settleFoot skips while the layout is in
        // motion (it would also jump-cut a still-gliding Today press), and one
        // trailing retry lands after the transition. Children resizing against
        // a still viewport is content breath — that keeps the same-frame
        // instant pin, because deferring THAT by even a frame is the visible
        // wobble this observer exists to kill. (The MutationObserver calls
        // with no entries and stays on the instant path.)
        if (entries?.some((e) => e.target === sEl)) {
          settleFoot();
          clearTimeout(reseatTrail);
          reseatTrail = setTimeout(settleFoot, 180);
          todaySettleRef.current.push(reseatTrail);
          return;
        }
        pinFoot("instant");
      };
      const ro = new ResizeObserver(reseat);
      const observeKids = () => {
        ro.disconnect();
        if (!sEl) return;
        // the scroller ITSELF too: a pure viewport change resizes no child
        // while the zone is content-governed (keyboard-short viewports) —
        // watching only the children slept through exactly the moment the
        // foot moved. (measureRows and ZoneFootRule already observe this
        // element; observers don't contend.)
        ro.observe(sEl);
        [...sEl.children].forEach((c) => ro.observe(c));
      };
      observeKids();
      // a re-render can REPLACE children outright (escaping the RO's
      // subscriptions): the MutationObserver both re-seats on DOM churn and
      // re-points the RO at the current children. Both fire before paint.
      const mo = new MutationObserver(() => { reseat(); observeKids(); });
      if (sEl) mo.observe(sEl, { childList: true, subtree: true, characterData: true });
      const holder = { disconnect: () => { ro.disconnect(); mo.disconnect(); } };
      todayRORef.current = holder;
      todaySettleRef.current.push(
        setTimeout(() => {
          holder.disconnect();
          if (todayRORef.current === holder) todayRORef.current = null;
        }, 5000),
      );
      return true;
    }
    if (!row) return false;
    spyRef.current = day; // the landing must not re-announce itself
    if (smooth) {
      // hold the header on the destination while the scroll animates, so the
      // days it passes don't flip `selected` and flash the Today button back in
      progTargetRef.current = row.offsetTop;
      if (progTimerRef.current) clearTimeout(progTimerRef.current);
      progTimerRef.current = setTimeout(() => {
        progTargetRef.current = null;
      }, 800);
    } else {
      progTargetRef.current = null;
    }
    el.scrollTo({ top: row.offsetTop, behavior: smooth ? "smooth" : "instant" });
    if (!smooth) {
      // a dive lands here against a layout that's still settling — the opened
      // day's composer (probe) mounts a render later, and late rows/data shift the
      // days above it — which nudges the page a row AFTER it has appeared, reading
      // as a small scroll into place. Re-pin the date's top across that window,
      // INSTANT so the page is simply held put rather than animated. offsetTop is
      // re-read each time, so it tracks the row wherever the reflow moves it.
      const pin = () => {
        // the reader grabbing the scroll stands the pin down outright — a
        // small drift is indistinguishable from the start of their swipe,
        // and writing scrollTop under a live gesture kills its momentum
        if (tookOverRef.current) return;
        const s = scrollerRef.current;
        const r = rowRefs.current.get(day);
        if (!s || !r) return;
        const drift = Math.abs(s.scrollTop - r.offsetTop);
        // only a reflow-sized nudge (a row or two) — leave a real flick alone, so
        // a reader who scrolls the instant they land isn't yanked back
        if (drift > 1 && drift < 120)
          s.scrollTo({ top: r.offsetTop, behavior: "instant" });
      };
      todaySettleRef.current.push(
        setTimeout(pin, 60),
        setTimeout(pin, 180),
        setTimeout(pin, 340),
      );
    }
    return true;
  }, [todayKey]);

  // After a keep, pan up from the today zone so the new card can be watched
  // wiping into the schedule. Land on today's date — unless today's stack is so
  // tall the fresh card (at its foot) would fall below the fold, in which case
  // land just high enough that the whole card shows.
  const scrollToNewEntry = useCallback((id: string) => {
    const sc = scrollerRef.current;
    if (!sc) return;
    tookOverRef.current = false; // a keep owns the scroll (pan up to the new card)
    const doScroll = () => {
      const card = sc.querySelector<HTMLElement>(`[data-entry="${CSS.escape(id)}"]`);
      const row = rowRefs.current.get(todayKey);
      if (!card || !row) return;
      const scTop = sc.getBoundingClientRect().top;
      const viewportH = sc.clientHeight;
      const rowTop = sc.scrollTop + (row.getBoundingClientRect().top - scTop);
      const cardBottom = sc.scrollTop + (card.getBoundingClientRect().bottom - scTop);
      const GAP = 16;
      const target =
        cardBottom - rowTop <= viewportH - GAP
          // today's date flush to the very top: its border-t lands on the
          // scroller's top edge, which (via the wrapper's -mt-px) coincides with
          // the header's bottom rule — the two hairlines become one
          ? Math.max(0, rowTop)
          : Math.max(0, cardBottom - viewportH + GAP); // just enough to show the card
      // hold the header on today through the animated scroll (don't let the days
      // it passes flash the Today button)
      spyRef.current = todayKey;
      progTargetRef.current = target;
      if (progTimerRef.current) clearTimeout(progTimerRef.current);
      progTimerRef.current = setTimeout(() => { progTargetRef.current = null; }, 1200);
      sc.scrollTo({ top: target, behavior: "smooth" });
    };
    // scroll as the card wipes in (a frame on, so its box has mounted), then
    // re-assert once the live query has reshuffled the rows above today — the
    // first-ever entry adds yesterday's page, which would otherwise shift the
    // target after the fact and leave today sitting a little below the top
    requestAnimationFrame(doScroll);
    setTimeout(doScroll, 450);
  }, [scrollerRef, todayKey, rowRefs, spyRef, progTargetRef, progTimerRef]);

  const goTo = useCallback(
    (day: string, smooth = false) => {
      setProbe(day);
      // land now so the camera zooms onto the right page, then settle once
      // the probe (and any row churn) has committed. A smooth scroll (pressing
      // "today") must NOT be yanked instant by that settle — and today is
      // always in the rows, so it needs no settle pass.
      scrollToRow(day, smooth);
      pendingRef.current = smooth ? null : day;
    },
    [scrollToRow],
  );
  useLayoutEffect(() => {
    handleRef.current = { goTo };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, goTo]);

  // position once the rows are real; afterwards, settle pendings
  useLayoutEffect(() => {
    if (!rows) return;
    // cache the rows' geometry now (this is the layout pass that would
    // otherwise be forced by the first scroll) and keep it fresh as the
    // viewport resizes
    measureRows();
    if (!didInit.current) {
      didInit.current = true;
      scrollToRow(selected);
      pendingRef.current = null;
    } else if (pendingRef.current) {
      // one settle only — a stale pending must never replay a jump
      scrollToRow(pendingRef.current);
      pendingRef.current = null;
    }
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measureRows);
    ro.observe(el);
    return () => ro.disconnect();
    // `selected` only seeds the very first position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, scrollToRow, measureRows]);

  // once the first (windowed) paint is on screen, mount the rest of the history
  // off the critical path — a frame later, as a low-priority transition. In
  // recovery we DON'T: mounting the whole book is the suspected crash, and a
  // reload loop only breaks if the recovered load stays light. The recent-days
  // window is enough to read and to capture; a later, loop-free reopen returns
  // to the full book.
  useEffect(() => {
    if (fullBook || !rows || recovery) return;
    const id = requestAnimationFrame(() =>
      startTransition(() => setFullBook(true)),
    );
    return () => cancelAnimationFrame(id);
  }, [fullBook, rows, recovery]);

  // the rest of the history mounts ABOVE the landing day, growing the scroll
  // height; with overflow-anchor off that would shove the page off-screen, so
  // re-pin to the day the book landed on in the same commit (a layout effect,
  // before paint — no visible jump). spyRef holds that day (the landing wrote
  // it); `selected` only seeds it. Stands down if the reader has already
  // grabbed the scroll, so the mount doesn't yank them.
  useLayoutEffect(() => {
    if (!fullBook || tookOverRef.current) return;
    measureRows();
    scrollToRow(spyRef.current ?? selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullBook]);

  // the moment the reader scrolls/touches the book themselves, stand down any
  // pending land-on-today re-pin (settle timers + the full-book mount) so it
  // can't reset them to the foot mid-scroll
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onUser = () => { tookOverRef.current = true; };
    el.addEventListener("wheel", onUser, { passive: true });
    el.addEventListener("touchstart", onUser, { passive: true });
    el.addEventListener("pointerdown", onUser, { passive: true });
    return () => {
      el.removeEventListener("wheel", onUser);
      el.removeEventListener("touchstart", onUser);
      el.removeEventListener("pointerdown", onUser);
    };
  }, []);

  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollerRef.current;
      if (!el) return;
      const top = el.scrollTop;
      // fling relief reads every sample — a fast fling sheds the book's
      // grace layers (see lib/fling-relief) so iOS can raster the tiles
      // it demands without being jetsam-killed for the allocation spike
      bookScrolled(top);
      if (progTargetRef.current !== null) {
        // a Today scroll is animating to its target — let it run, but don't let
        // the days it passes claim the header (that flashes the Today button)
        if (Math.abs(top - progTargetRef.current) < 4) {
          progTargetRef.current = null;
          if (progTimerRef.current) clearTimeout(progTimerRef.current);
        }
        return;
      }
      // the very foot IS today's zone (today's own section collapses when empty,
      // so it never reads as the topmost stacked day) — at the bottom the reader
      // is on today, and the Today button should collapse. A Today scroll also
      // stays on today the whole way down. Either way, hold today.
      const atBottom = top >= el.scrollHeight - el.clientHeight - 4;
      if (atBottom) landingTodayRef.current = false; // arrived
      let cur: string | null;
      if (atBottom || landingTodayRef.current) {
        cur = todayKey;
      } else {
        // the reader's day is the topmost whose margin date is still
        // fully stacked — a row whose tail merely peeks under the rail
        // has already handed over (its date has slid off the pin).
        // Computed from cached geometry, so the scroll path reads only
        // scrollTop, never the rows' offsets
        cur = null;
        for (const g of rowGeomRef.current) {
          if (g.bottom >= top + g.headH) {
            cur = g.day; // geometry is sorted by top; the first match wins
            break;
          }
        }
      }
      if (cur && cur !== spyRef.current) {
        spyRef.current = cur;
        onVisible(cur);
      }
    });
  };

  const rowRef = (day: string) => (el: HTMLElement | null) => {
    if (el) rowRefs.current.set(day, el);
    else rowRefs.current.delete(day);
  };

  // the book holds nothing yet — the today zone opens with a warmer first
  // invitation (and there's no yesterday to review above it)
  const bookEmpty = (all?.length ?? 0) === 0;
  // remember whether the book was empty, so the next load's skeleton can hold
  // the welcome intro rather than the composer without waiting on the query
  useEffect(() => {
    if (all === undefined) return; // still loading — bookEmpty isn't real yet
    try {
      localStorage.setItem(BOOK_EMPTY_KEY, bookEmpty ? "1" : "0");
    } catch {}
  }, [all, bookEmpty]);
  // read once at mount (client-only): last-known empty state, to choose the
  // loading skeleton before this query resolves
  const [bookEmptyHint] = useState(
    () => typeof window !== "undefined" && localStorage.getItem(BOOK_EMPTY_KEY) === "1",
  );

  // hundreds of day sections — memoized as elements, so the scroll
  // spy's selection churn (a page re-render per day crossed) bails
  // out of the whole book instead of reconciling it
  const body = useMemo(
    () =>
      windowRows?.map((row, i) => {
        const d = dateFromDayKey(row.day);
        const newMonth =
          i === 0 || windowRows[i - 1].day.slice(0, 7) !== row.day.slice(0, 7);
        const isToday = row.day === todayKey;
        // today always invites; yesterday invites while it's still empty;
        // and the page you opened keeps its composer
        const showComposer =
          isToday ||
          row.day === probe ||
          (row.day === yesterdayKey && row.snippets.length === 0);
        const last = i === windowRows.length - 1;
        // in zone mode today's own section stays invisible until it holds an
        // entry — its date lives in the zone, and the kept card wipes into this
        // (already-mounted) list. Its ScheduleCards stays rendered so the
        // AnimatePresence is live to animate that card in.
        const hideToday = isToday && row.snippets.length === 0;
        const pageRow = (
          <section
            ref={rowRef(row.day)}
            data-day={row.day}
            aria-label={friendlyDay(row.day)}
            className={cn(
              "grid grid-cols-[2.1rem_1fr] gap-x-2",
              // every day rules off from the one above. Today's empty section
              // collapses to nothing but KEEPS the rule (once the book holds
              // anything) — so a hairline still marks where the prior days end
              // and today's zone begins; only the first-ever, empty book has none.
              (!hideToday || !bookEmpty) && "border-t border-rule-faint",
            )}
          >
                {/* the date stands in the margin and holds its ground
                    while its day's entries scroll past. Empty today drops the
                    padding too, so its section collapses to the bare rule and
                    the zone below fills the viewport right up to it. */}
                <div className={cn(
                  "book-margin-date sticky top-0 self-start text-center",
                  // today's section cedes its bottom padding to the zone below
                  // (the zone owns the whole 26px gap — see TodayZoneFill), so
                  // the full breath is visible when the book rests at its foot
                  !hideToday && (isToday ? "pt-2.5" : "pb-2.5 pt-2.5"),
                )}>
                  {!hideToday && (() => {
                    const dateInner = (
                      // py-[3.5px] sizes the block to exactly a single-line
                      // card's height (42.5px: its 35.4px of text + 7.1px), so
                      // the date reads centre-aligned beside a one-line entry —
                      // and a single-line day has zero sticky travel, killing
                      // the tiny header-crawl while scrolling past it
                      <div className="py-[3.5px]">
                        <span
                          className={cn(
                            "voice-label block text-[0.62rem] leading-tight",
                            isToday ? "text-wax" : "text-ink-faint",
                          )}
                        >
                          {format(d, "EEE")}
                        </span>
                        <span
                          data-flydate={row.day}
                          className={cn(
                            "voice-display block text-[1.15rem] leading-tight tabular-nums",
                            isToday && "text-wax",
                          )}
                        >
                          {format(d, "d")}
                        </span>
                      </div>
                    );
                    // today's date sticky-header populates as the first entry
                    // arrives — wipe it in from the left to lead the kept card,
                    // but ONLY on a fresh keep (todayJustKept), never on a page
                    // refresh; fast (the first fifth of the sweep) so date+card
                    // read as one sweep across the row
                    return isToday ? (
                      <motion.div
                        initial={todayJustKept ? { opacity: 0, clipPath: "inset(-50% 100% -50% -10%)" } : false}
                        animate={{ opacity: 1, clipPath: "inset(-50% -10% -50% -10%)" }}
                        transition={{ duration: 0.1, ease: "easeInOut" }}
                      >
                        {dateInner}
                      </motion.div>
                    ) : (
                      dateInner
                    );
                  })()}
                </div>
                <div className={cn("min-w-0", !hideToday && (isToday ? "pt-2.5" : "pb-2.5 pt-2.5"))}>
                  <ScheduleCards snippets={row.snippets} day={row.day} onOpen={onOpen} still={!active} />
                  {showComposer && (
                    <BackfillCapture
                      key={row.day}
                      day={row.day}
                      follows={row.snippets.length > 0}
                    />
                  )}
                </div>
          </section>
        );
        return (
          <Fragment key={row.day}>
            {newMonth && !hideToday && (
              <p
                className={cn(
                  "voice-label px-1 pb-1.5 pt-5 text-[0.82rem]",
                  isSameMonth(d, today) ? "text-wax" : "text-ink-soft",
                )}
              >
                {format(d, "MMMM yyyy")}
              </p>
            )}
            {last && windowTail ? (
              // pageRow and the zone are siblings under the scroller (no wrapper),
              // so the zone's own min-h-full resolves against the scroller — it's
              // always a full viewport tall regardless of what today holds above
              // it, never shrunk to share the fold with today's entries. (It also
              // still guarantees a viewport of room below the final row, so a
              // shrinking row can't dip scrollHeight and clamp the reader.)
              <Fragment>
                {pageRow}
                {/* the zone always carries today's big date — even once today
                    also owns a page above — so the composer always names its day */}
                <TodayZoneFill
                  day={todayKey}
                  firstEver={bookEmpty}
                  hasEntry={row.snippets.length > 0}
                  onKept={scrollToNewEntry}
                  className="min-h-full"
                />
              </Fragment>
            ) : (
              pageRow
            )}
          </Fragment>
        );
      }),
    [windowRows, windowTail, probe, todayKey, yesterdayKey, onOpen, today, todayJustKept, bookEmpty, scrollToNewEntry, active],
  );

  return (
    // -mt-px: the topmost day's border-t rides up onto the header's bottom rule,
    // so when today lifts to the top the two hairlines coincide instead of
    // doubling a pixel apart. The foot rule is a sibling of the scroller (not a
    // child), pinned to its bottom edge — so it can never scroll with the
    // content or cache a stale position as the zone grows under it.
    <div className="relative -mt-px h-full">
      <div
        ref={scrollerRef}
        data-book-scroller=""
        onScroll={active ? onScroll : undefined}
        // while the book is SCALED as a rigid block (month/year⇄schedule) un-stick
        // the margin dates (see globals.css), or they'd stay pinned while the cards
        // scale under them. Not during an entry⇄schedule move, which only fades the
        // book — there the dates must stay sticky so the focused day's number holds
        // its pinned slot instead of jumping to its section top.
        data-dive-freeze={diveFreeze || undefined}
        // overflow-x hidden: the book never scrolls sideways. With only
        // overflow-y set, the x-axis COMPUTES to auto (spec), and the today
        // zone's press bloom — a couple of px of transform ink past the
        // content edge — was enough for iOS to unlock the whole horizontal
        // pan axis and rubber-band the page sideways. The bloom itself has
        // ~14px of gutter to swell into, so nothing visibly clips.
        className="relative -mx-2 h-full overflow-y-auto overflow-x-hidden overscroll-contain px-2 [overflow-anchor:none]"
        style={{ scrollbarWidth: "none" }}
        tabIndex={-1}
      >
        {/* until the live query returns, `body` is undefined — hold a skeleton
            so the wait reads as a continuous "settling in", never a blank gap
            that then pops. Landing on today opens onto the compose zone (the
            book's foot fills the viewport), so hold that; a deep-link into any
            other day lands among its entries, so hold the ruled book instead. */}
        {body ??
          (selected !== todayKey ? (
            <LedgerRows />
          ) : bookEmptyHint ? (
            // an empty book opens today onto the welcome intro, not the composer
            <WelcomeSkeleton />
          ) : (
            <TodaySkeleton />
          ))}
      </div>
      {/* the foot rule (clips marker) — grey over the days, blue across the
          zone's straight sides, and ceding to the zone's own rounded bottom in
          the corner range */}
      <ZoneFootRule scrollerRef={scrollerRef} />
    </div>
  );
}

/**
 * A day's entries, each a paper tile in the same material as the year
 * view's minis — text only, no clutter; everything else lives one
 * altitude deeper. Pressing a tile dives the camera into it.
 */
function ScheduleCards({
  snippets,
  day,
  onOpen,
  still,
}: {
  snippets: Snippet[];
  day: string;
  onOpen: (id: string) => void;
  // the feed is mid-transition (a dive in/out): suppress the cards' FLIP so a
  // scroll-and-rerender doesn't animate them across the great distance they
  // moved — they should simply be in their final place when the page arrives
  still: boolean;
}) {
  // entries already on the page at mount don't animate — only changes do
  const [presentAtMount] = useState(() => new Set(snippets.map((s) => s.id)));
  // a kept entry WIPES in from the left — a pure left→right clip reveal (no
  // float). The margin date wipes just before it, so the two read as one uniform
  // sweep across the row's width: the date takes the first fifth, the card the
  // rest (it waits out the date with a delay).
  // negative top/bottom/left insets from the start, and a negative right at
  // rest: the wipe still reveals left-to-right, but the clip-path motion
  // leaves STANDING on the li afterwards sits well outside the card's seat
  // shadow instead of guillotining it at the border box
  const sweepBirth = {
    initial: { opacity: 0, clipPath: "inset(-50% 100% -50% -10%)" },
    animate: { opacity: 1, clipPath: "inset(-50% -10% -50% -10%)" },
    transition: { duration: 0.4, delay: 0.1, ease: "easeInOut" as const },
  };

  // the optimistic just-kept card: render it in its final slot the instant the
  // seal is pressed so the typed words never blink out waiting for the live
  // query; when the real row lands (same id) it takes over seamlessly (same key
  // → same element, no re-animation) and the draft is cleared.
  const draftStore = useKeptDraft();
  const draft = draftStore?.drafts[day];
  const draftPending = draft != null && !snippets.some((s) => s.id === draft.id);
  useEffect(() => {
    if (draft && snippets.some((s) => s.id === draft.id)) draftStore?.clear(day);
  }, [draft, snippets, day, draftStore]);
  const items = draftPending ? [...snippets, draft] : snippets;

  return (
    <ul className="flex flex-col gap-1">
      <AnimatePresence initial={false}>
        {items.map((s) => {
          const isDraft = draftPending && s.id === draft!.id;
          return (
          <motion.li
            key={s.id}
            // the freshly-kept card wipes in via clip only — no FLIP position
            // float; cards already present keep their layout spring as the stack
            // reshuffles around them — but never during a dive (`still`), when a
            // scroll-driven position change would otherwise animate as a slide
            layout={isDraft || still ? false : "position"}
            initial={presentAtMount.has(s.id) ? false : sweepBirth.initial}
            animate={sweepBirth.animate}
            // a deleted card is gone at once (its leave animation plays on the
            // focused card up in the entry view) — so the book behind is already
            // at its final state, never showing the struck card collapse
            exit={{ opacity: 0, height: 0, overflow: "hidden", transition: { duration: 0 } }}
            transition={sweepBirth.transition}
          >
            {/* the bloom wrapper: the FLIP owns the li's transform and the
                open zoom measures (then hides) the button, so the bloom
                lives between them on a box nothing else animates */}
            <div className="transition-transform duration-[500ms] ease-[var(--ease-bloom)]">
            <button
              type="button"
              data-entry={s.id}
              onClick={() => onOpen(s.id)}
              // isolate: the card's ink multiplies into its own opaque
              // paper (the texture is occluded), so the blend is constant
              // — isolating it lets the browser bake it once and translate
              // on scroll instead of re-blending the prose every frame
              // against the fixed sheet (the book's scroll-start jank).
              // pressable-lit: colors transition, but no :active dip — the
              // press answers with the glow's light and bloom instead
              className={cn(
                "book-card pressable-lit isolate block w-full rounded-[6px] border [border-color:var(--card-seat-border)] bg-paper p-2.5 text-left",
                "[box-shadow:var(--card-seat)] hover:bg-paper-raised",
              )}
            >
              <PressGlow grow="parent" growWhileFocused={false} className="rounded-[6px]" />
              <p
                className={cn(
                  "book-card-prose voice-prose relative line-clamp-6 whitespace-pre-wrap text-[0.9rem] leading-[1.42]",
                  s.kind === "quote" && "hang-quotes italic",
                )}
              >
                {s.text}
              </p>
            </button>
            </div>
          </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
const ScheduleFeed = memo(
  ScheduleFeedBase,
  // `selected` only seeds the book's first position (the spy drives it
  // thereafter), so a change to it alone — every day the reader scrolls
  // past — needn't re-render the whole book; the title alone re-renders
  (p, n) =>
    p.handleRef === n.handleRef &&
    p.active === n.active &&
    p.diveFreeze === n.diveFreeze &&
    p.today === n.today &&
    p.all === n.all &&
    p.recovery === n.recovery &&
    p.onVisible === n.onVisible &&
    p.onOpen === n.onOpen,
);

/* the scroll terminus (the foot hairline + `useScrollEdges`) lives in
   components/ui/scroll-terminus now — shared with the Today page, which
   marks both ends. */

/**
 * A word that wipes open from its own slot in a line of text — used to
 * extend a month header into a full date without disturbing the words
 * that stay. Animated grid column (0fr→1fr) reveals the clipped text.
 */
function WipeWord({ open, children }: { open: boolean; children: React.ReactNode }) {
  return (
    <span
      aria-hidden={!open}
      data-wipe={open ? "open" : "closed"}
      className={cn(
        // lengthened past --dur-slow (the calc keeps it collapsing under
        // reduced motion) so the wipe is followable rather than a blink
        "inline-grid align-baseline transition-[grid-template-columns,opacity] duration-[calc(var(--dur-slow)*1.6)] ease-[var(--ease-out)]",
        open ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
      )}
    >
      <span className="overflow-hidden whitespace-pre">{children}</span>
    </span>
  );
}

/* ── adding to a day: today at its own moment, the past at noon ──── */

// The keep is orchestrated by the keep-sequence engine with the canvas quill
// seal. Today's capture lives in the big fill zone, so today's inline composer
// steps aside — but other days keep theirs (yesterday's "add something from
// yesterday" invite, or any page you opened to backfill).
function BackfillCapture(props: { day: string; follows?: boolean }) {
  if (props.day === dayKey()) return null;
  return <FlowBackfillCapture {...props} />;
}

/* A past day's composer. The seal rests as the white-icon dome and plays its
   full press → linger → exit lifecycle on click; during the press the date
   shows ONLY the stamp. The card is then born (ScheduleCards wipes it in), and
   finally the empty composer wipes back in from the left as a single revealed
   line (slow). */
function FlowBackfillCapture({
  day,
  follows = false,
}: {
  day: string;
  follows?: boolean;
}) {
  const reduce = useReducedMotion() ?? false;
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const seq = useKeepSequence(KEEP_BEATS, reduce);
  const draftStore = useKeptDraft();
  // the thumb-down dip (the seal's `pressed` feedback before release)
  const [pressedDown, setPressedDown] = useState(false);
  const isToday = day === dayKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = day === dayKey(yesterday);

  // refocus once the composer has wiped back, to keep typing
  useEffect(() => {
    if (seq.phase !== "composing") return;
    const t = setTimeout(() => areaRef.current?.focus(), Math.max(80, KEEP_BEATS.composeMs * 0.7));
    return () => clearTimeout(t);
  }, [seq.phase]);

  const keep = () => {
    const trimmed = text.trim();
    if (!trimmed || seq.phase !== "idle") return;
    const at = dateFromDayKey(day);
    at.setHours(12, 0, 0, 0);
    const capturedAt = isToday ? Date.now() : at.getTime();
    // the id is minted NOW (creation order), even for a backfill whose
    // capturedAt sits in the past — so the entry sorts to the foot of its day
    const id = ulid();
    // render the kept card optimistically in its final slot AT ONCE, so the
    // typed words stay put instead of blinking out until the live query lands;
    // the real row (same id) takes over seamlessly
    draftStore?.set({
      id,
      text: trimmed,
      kind: null,
      tags: [],
      capturedAt,
      day,
      source: "typed",
      favorite: 0,
      updatedAt: capturedAt,
    });
    void addSnippet({ id, text: trimmed, source: "typed", capturedAt })
      .catch((error: unknown) => {
        // the keep did not take — withdraw the optimistic card, put the
        // words back, say why. Never a silent loss.
        draftStore?.clear(day);
        setText(trimmed);
        if (areaRef.current) {
          areaRef.current.value = trimmed;
          autosizeArea(areaRef.current);
        }
        toast(
          error instanceof StorageWriteError && error.full
            ? copy.data.storageFull
            : copy.data.keepFailed,
        );
      });
    setText("");
    if (areaRef.current) {
      areaRef.current.value = "";
      autosizeArea(areaRef.current);
    }
    navigator.vibrate?.(8);
    // reduced motion: the card is already filed; skip the press theatre
    if (reduce) return;
    seq.start();
  };

  const hasText = text.trim().length > 0;
  const pressing = seq.phase === "pressing" || seq.phase === "carding";
  const composerOpen = seq.phase === "idle" || seq.phase === "composing";
  // the seal shows at rest (typed) and through the press; it's gone once the
  // empty composer wipes back in. Reduced motion files instantly, no theatre.
  const showSeal = hasText || (pressing && !reduce);
  const placeholder = isToday
    ? copy.backfill.today
    : isYesterday
      ? copy.backfill.yesterday
      : copy.backfill.other;

  return (
    // also the composer's bloom target (PressGlow grow="parent"): the bloom
    // rides this wrapper so the card's own box (clip-wipe, masks) stays
    // untransformed — one shared press physics with the zone and the tiles
    <div className={cn("relative transition-transform duration-[500ms] ease-[var(--ease-bloom)]", follows && "mt-1")}>
      {/* the composer — present at rest and after a keep, GONE during the press
          so today shows only the stamp. Its return wipes in from the left as a
          single already-laid-out line (clip-path reveal — no re-wrapping), slow
          on purpose (a once-or-twice-a-day beat). */}
      {composerOpen && (
        <motion.div
          initial={seq.phase === "composing" ? { clipPath: "inset(-50% 100% -50% -10%)" } : false}
          animate={{ clipPath: "inset(-50% -10% -50% -10%)" }}
          transition={{ duration: KEEP_BEATS.composeMs / 1000, ease: [0.23, 1, 0.32, 1] }}
          // no press dip here anymore: the card answers with the press
          // glow's light and bloom (one shared physics with the today zone,
          // the tiles, and the opened entry) — a dip scaling down against
          // the bloom scaling up was a visible fight
          className="group relative"
        >
          {/* the ghost's seat is a drop-shadow on this unmasked parent: the
              face's fade mask clips outer box-shadows entirely, and filter
              runs before mask on one element — so the shadow lives a level
              up and dissolves with the ghost */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 [filter:var(--card-seat-drop)]">
            <span className="absolute inset-0 rounded-[6px] border border-rule-faint bg-paper shadow-[inset_0_1px_0_var(--press-highlight)] transition-colors duration-150 [-webkit-mask-image:linear-gradient(to_right,black_35%,transparent_92%)] [mask-image:linear-gradient(to_right,black_35%,transparent_92%)] group-focus-within:border-rule group-hover:bg-paper-raised" />
          </span>
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[6px] border bg-paper [box-shadow:var(--card-seat)] transition-[opacity,background-color] duration-150",
              "border-rule-faint group-focus-within:border-rule group-hover:bg-paper-raised",
              text.length > 0 ? "opacity-100" : "opacity-0",
            )}
          />
          {/* light under the finger, above the card's paint, under its words */}
          <PressGlow grow="parent" className="rounded-[6px]" />
          <textarea
            ref={areaRef}
            value={text}
            rows={1}
            placeholder={placeholder}
            aria-label={copy.backfill.ariaAddTo(friendlyDay(day))}
            onChange={(e) => {
              setText(e.target.value);
              autosizeArea(e.target);
            }}
            onKeyDown={(e) => {
              // Desktop: Enter files, Shift+Enter is a newline. Touch: Enter is
              // always a newline (no Shift+Enter there) and the seal files.
              if (enterFiles(e)) {
                e.preventDefault();
                keep();
              }
            }}
            className={cn(
              // CONTAINED at the card's own six-line rhythm (the preview's
              // clamp): past that the words scroll INSIDE the box. This is
              // what keeps caret walks (the spacebar trackpad) in the card —
              // WebKit auto-scrolls the nearest scrollable, and with the
              // textarea scrollable that's the textarea, not the whole book
              // sailing off into other days. overscroll-contain stops the
              // internal scroll from chaining out at its edges.
              "voice-prose relative block max-h-[143px] w-full resize-none overflow-y-auto overscroll-contain bg-transparent p-2.5 text-[0.9rem] leading-[1.42] outline-none placeholder:italic",
              isToday ? "placeholder:text-wax/75" : "placeholder:text-ink-faint",
            )}
          />
        </motion.div>
      )}

      {/* the seal — rests as the white-icon dome: a thumb-down dip, then the
          full press → linger → exit lifecycle on release (the seal plays it; we
          just unmount once it has exited). The card is already in place above
          it; the seal presses at the corner and swells away. */}
      {showSeal && (
        <div className="mt-2 flex justify-end pr-px">
          <button
            type="button"
            aria-label={copy.keep.label}
            onClick={keep}
            onPointerDown={(e) => {
              e.preventDefault(); // keep the textarea's focus
              setPressedDown(true);
            }}
            onPointerUp={() => setPressedDown(false)}
            onPointerLeave={() => setPressedDown(false)}
            className="relative grid place-items-center rounded-full"
            style={{ width: 56, height: 56 }}
          >
            <CanvasSeal
              playKey={seq.sealKey}
              size={56}
              glyph="e:quill"
              iconScale={0.36}
              mode="tap"
              pressed={pressedDown}
              // the canvas press runs ~1150ms; linger fills the rest of pressMs,
              // and the exit plays across cardMs — so the whole lifecycle lands
              // exactly when the seal unmounts (composing)
              lingerMs={Math.max(0, KEEP_BEATS.pressMs - 1150)}
              exitMs={KEEP_BEATS.cardMs}
              exit="grow"
              variant="spring"
              ease="front"
              bounce={1.5}
              rotate={30}
              superSample={4}
              ignoreReducedMotion
            />
          </button>
        </div>
      )}
    </div>
  );
}

/* The scroll terminus for the today-zone book. One hairline pinned at the foot
   of the scroll viewport (where content clips) — it never moves. Imperative
   (its own rAF scroll read) so it doesn't re-render the feed.
    • over the days (zone entirely below the fold) → the plain grey rule;
    • over the zone → a BLUE line whose length tracks the zone's outline at the
      clip point: full width across the straight sides, and INSET along the
      circular curve while the clip point is within a rounded corner (top or
      bottom), so it never extends past the border;
    • scrolled fully to the bottom → hidden (the zone's rounded bottom shows). */
const ZONE_CORNER = 16; // matches the zone box's rounded-2xl radius
// the rounded rect's horizontal inset `t`px from a corner's edge (0 at the very
// edge → the straight top/bottom segment is inset by R; R away → full width)
const cornerInset = (t: number) =>
  t <= 0 ? ZONE_CORNER : t >= ZONE_CORNER ? 0 : ZONE_CORNER - Math.sqrt(ZONE_CORNER * ZONE_CORNER - (ZONE_CORNER - t) * (ZONE_CORNER - t));
function ZoneFootRule({ scrollerRef }: { scrollerRef: React.RefObject<HTMLDivElement | null> }) {
  const lineRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sc = scrollerRef.current;
    const line = lineRef.current;
    if (!sc || !line) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const vpBottom = sc.getBoundingClientRect().bottom;
      const box = sc.querySelector<HTMLElement>("[data-today-zone-box]");
      const busy = box?.getAttribute("data-zone-busy") === "1";
      let show = false;
      let blue = false;
      let inset = 0;
      if (box && !busy) {
        const r = box.getBoundingClientRect();
        if (r.bottom <= vpBottom) {
          // the zone's OWN bottom border has reached the fold and is the visible
          // edge now. Because the zone is the last thing in the book, this is
          // true only scrolled flush to the very bottom — so the rule hands off
          // exactly there, never a few pixels early (which left the foot bare
          // until the border scrolled in), and never doubled onto the border
          // (which read darker than the rest of the outline).
          show = false;
        } else if (r.top > vpBottom) {
          // the zone is still entirely below the fold → grey terminus over the days
          show = true;
          blue = false;
        } else {
          // the zone's body crosses the clip line → blue edge at the clip,
          // tracking whichever rounded corner the clip point is passing through
          show = true;
          blue = true;
          const distTop = vpBottom - r.top;     // clip point's depth below the zone's top
          const distBottom = r.bottom - vpBottom; // real bottom's depth below the clip point
          if (distTop < ZONE_CORNER) inset = cornerInset(distTop);
          else if (distBottom < ZONE_CORNER) inset = cornerInset(distBottom);
        }
      }
      line.style.opacity = show ? "1" : "0";
      line.style.left = `${inset}px`;
      line.style.right = `${inset}px`;
      // colour is set INSTANTLY (no transition) so it never lags blue→grey when
      // the clip point leaves the zone
      line.style.borderTopColor = blue
        ? "color-mix(in srgb, var(--wax) 45%, transparent)"
        : "var(--rule-faint)";
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    sc.addEventListener("scroll", onScroll, { passive: true });
    // recompute on scroll AND on any size change of the scroller or the zone box
    // — the box grows as lines are typed without a scroll or a scroller resize,
    // so observing it is what keeps the rule from caching a stale edge
    const ro = new ResizeObserver(onScroll);
    ro.observe(sc);
    let observedBox: Element | null = null;
    const trackBox = () => {
      // the box is replaced on each keep (a new generation), so re-point the
      // observer whenever the live one changes
      const box = sc.querySelector("[data-today-zone-box]");
      if (box === observedBox) return;
      if (observedBox) ro.unobserve(observedBox);
      if (box) ro.observe(box);
      observedBox = box;
    };
    const mo = new MutationObserver(trackBox);
    mo.observe(sc, { childList: true, subtree: true });
    trackBox();
    update();
    return () => {
      sc.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollerRef]);
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-[6] h-px">
      <div
        ref={lineRef}
        className="absolute bottom-0 border-t transition-opacity duration-200"
        style={{ opacity: 0, left: 0, right: 0, borderTopColor: "var(--rule-faint)" }}
      />
    </div>
  );
}

/* The today zone: a big "add to today" panel, housing the large pre-stamp wax
   button inside a hairline blue outline. It's always a full viewport tall (its
   own min-h-full, measured against the scroller) — the same size whether today
   is blank or already holds entries above it — and grows past that with the
   words as they're typed. This is the app's capture surface. */
function TodayZoneFill({
  day,
  firstEver = false,
  hasEntry = false,
  onKept,
  className,
}: {
  day: string;
  /** nothing has ever been saved — a warmer first invitation */
  firstEver?: boolean;
  /** today already holds an entry — invite another */
  hasEntry?: boolean;
  /** the kept entry's id, once filed — so the book can pan to it wiping in */
  onKept?: (id: string) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [playKey, setPlayKey] = useState(0);
  // the seal's press is driven imperatively (see onPointerDown) so it rotates in
  // the touch's own frame; no React state stands between the tap and the motion
  const sealCtl = useRef<SealControl | null>(null);
  // pointer bookkeeping for the seal button. A touch pointer is implicitly
  // captured on pointerdown, so pointerup (and the synthetic click) fire on the
  // button even when the finger lifts off it — we can't trust the event target.
  // overSeal tracks whether the pointer is within the button's box (from move
  // geometry); keeping is a synchronous mirror of "a keep is running" (React
  // state is stale inside these back-to-back handlers); pointerHandled swallows
  // the trailing synthetic click so it doesn't double-fire the pointer path.
  const sealDown = useRef(false); // a pointer is currently pressing the seal
  const overSeal = useRef(false); // …and is within the button's box
  const keeping = useRef(false);
  const pointerHandled = useRef(false);
  const inSeal = (e: ReactPointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  // holds the seal pressed-down (rotated) from the tap through the lead, so the
  // press animation LIFTS OFF from that same press — no un-rotate-then-replay
  const [holdDown, setHoldDown] = useState(false);
  // a generation counter: bumping it brings a fresh empty zone in (wipes down)
  const [gen, setGen] = useState(0);
  // the keep sequence:
  //  pressing → (sweep) exiting → filling → idle   |   (morph) → idle
  const [phase, setPhase] = useState<"idle" | "pressing" | "exiting" | "filling">("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const draft = useKeptDraft();
  const router = useRouter();
  // The locked letter's inputs — it shows only on POSITIVE evidence of the
  // exact state it addresses, never on assumption: a live signed-in session
  // (a stale store after sign-out must not strand the letter pointing at an
  // unlock form that no longer renders), the locked state (enrolled account,
  // no key on this device), and a KNOWN server count exceeding what's
  // visible locally (counts are fetched even while locked — see sync.ts —
  // and retried each visible minute, so an unknown count only delays the
  // letter, while "nothing actually hidden" stays quiet: there's nothing to
  // recover, and Settings still names the paused sync).
  const { status: sessionStatus } = useSession();
  const sync = useSyncStatus();
  const hiddenBehindLock =
    sessionStatus === "signed-in" &&
    sync.locked &&
    sync.serverCount !== null &&
    sync.serverCount > (sync.localCount ?? 0);
  // NOT gated on the book being empty: keeping an entry while locked must
  // not dismiss the letter — it stands until the device actually unlocks
  const lockedLetter = hiddenBehindLock || LOCK_DEBUG !== null;
  const lockedCount =
    LOCK_DEBUG !== null
      ? LOCK_DEBUG || null
      : sync.serverCount !== null && (sync.localCount ?? 0) === 0
        ? sync.serverCount
        : null;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const d = dateFromDayKey(day);
  const frozen = phase !== "idle";
  useEffect(() => clearTimers, []);

  // Tail anchoring. The zone's composition is fixed BY LAYOUT, identical at
  // rest and while writing, so nothing ever has to move: the date sits a fixed
  // clearance under the zone's top, the seal rests the mirrored clearance above
  // the scroll terminus, and the ruled field sits centred between them — a
  // flex-1 slack above the field soaks half the spare height, and a spacer
  // below it (sized ONCE at rest to match) holds the other half rigid. As the
  // entry grows it consumes the flexible slack above — the field's top climbs,
  // its foot and the seal stay put — and once the words outgrow the zone, the
  // zone grows while the book scroller stays pinned to its foot (max-scroll
  // grows 1:1, so the caret line holds still and older lines climb past the
  // top, where the page scrolls to read them). No bottom padding, no space
  // below the zone, no keyboard detection — the stance clears the keyboard's
  // floating accessory band by construction.
  // (The generic keyboard-room hook ignores this field — see use-keyboard-room.)
  const anchorTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const topSlackRef = useRef<HTMLDivElement>(null);
  const restSpacerRef = useRef<HTMLDivElement>(null);
  // extra scrollable area while the keyboard is up (a sibling BELOW the zone,
  // never scroller padding — padding shrinks the scroller's content box, which
  // is what the zone's min-h-full resolves against). Without it the region the
  // keyboard covers is unreachable: the book is already at max scroll, so the
  // caret line can't be pulled up above the keyboard by hand. Sized on focus,
  // cleared on blur.
  const kbSpacerRef = useRef<HTMLDivElement>(null);
  const lastFocusAt = useRef(0); // when the field last GAINED focus (see the zone tap)
  const baseVh = useRef(0); // vv height with no keyboard (running max)
  const scrollerOf = () =>
    btnRef.current?.closest<HTMLElement>("[data-book-scroller]") ?? null;
  // Keyboard geometry under THREE viewport models: (a) innerHeight stays full
  // and vv shrinks, (b) both shrink (layout resize), (c) NEITHER shrinks — the
  // device only PANS (vv.offsetTop) and the heights are useless. (c) is real
  // (observed on iPhone Safari): there the pan itself is the signal — our
  // composition rests at the book's foot, so a keyboard always forces a pan —
  // and the keyboard's height is estimated at ~45% of the screen (worst case
  // the seal sits a little higher than needed; the -72 band margin absorbs
  // small under-estimates).
  const kbGeom = () => {
    const vv = window.visualViewport;
    if (!vv) return { kb: 0, visBottom: window.innerHeight, visTop: 0 };
    baseVh.current = Math.max(baseVh.current, vv.height);
    // The visual viewport's offset in LAYOUT coordinates — the frame client
    // rects live in. NOT vv.offsetTop: iOS reports that document-relative
    // (identical to pageTop), so with the document scrolled it double-counts
    // and a "visible bottom" computed from it lands under the keyboard
    // (observed on-device: offsetTop 198 == pageTop 198 == scrollY 198, true
    // layout offset 0). pageTop minus the document scroll IS the layout
    // offset, by definition, on every engine.
    const doc = document.scrollingElement?.scrollTop ?? window.scrollY ?? 0;
    const layoutTop = vv.pageTop - doc;
    const visBottom = layoutTop + vv.height;
    const measured = Math.max(
      window.innerHeight - vv.height - layoutTop,
      baseVh.current - vv.height,
    );
    if (measured >= 60) return { kb: measured, visBottom, visTop: layoutTop };
    // The pan comes in two disguises — a visual-viewport pan or iOS scrolling
    // the document itself (overflow-hidden shell notwithstanding); pageTop
    // covers both.
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    const pan = Math.max(vv.pageTop, doc);
    if (coarse && pan > 40) {
      const est = Math.round(Math.max(window.innerHeight, baseVh.current) * 0.45);
      return { kb: est, visBottom: visBottom - est, visTop: layoutTop };
    }
    return { kb: 0, visBottom, visTop: layoutTop };
  };
  // Where the CARET's line ends in the frame (client-coords bottom). Textareas
  // expose no caret geometry, so mirror the text up to the caret into a hidden
  // div with the same font, line grid, width and wrapping — its height IS the
  // caret line's offset within the field.
  const caretMirror = useRef<HTMLDivElement | null>(null);
  const caretClientBottom = () => {
    const area = areaRef.current;
    if (!area || document.activeElement !== area) return null;
    let m = caretMirror.current;
    if (!m) {
      m = document.createElement("div");
      m.style.cssText =
        "position:fixed;top:-9999px;left:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;";
      document.body.appendChild(m);
      caretMirror.current = m;
    }
    const cs = getComputedStyle(area);
    // longhands, not the `font` shorthand — Safari's computed shorthand is
    // empty, and a default-font mirror wraps differently and measures wrong
    m.style.fontFamily = cs.fontFamily;
    m.style.fontSize = cs.fontSize;
    m.style.fontWeight = cs.fontWeight;
    m.style.fontStyle = cs.fontStyle;
    m.style.lineHeight = cs.lineHeight;
    m.style.letterSpacing = cs.letterSpacing;
    m.style.width = `${area.clientWidth}px`;
    const upToCaret = area.value.slice(0, area.selectionStart ?? area.value.length);
    // a trailing newline (or nothing at all) renders zero-height — pad the
    // caret's empty line so it still counts
    m.textContent = upToCaret === "" || upToCaret.endsWith("\n") ? upToCaret + "​" : upToCaret;
    return area.getBoundingClientRect().top + Math.max(m.offsetHeight, 20);
  };
  const anchorTail = () => {
    const sc = scrollerOf();
    const btn = btnRef.current;
    if (!sc || !btn) return;
    const { kb, visBottom, visTop } = kbGeom();
    const spcr = kbSpacerRef.current?.offsetHeight ?? 0;
    if (kb < 60) {
      // no keyboard: rest at the zone's foot — the spacer below (if any
      // remains mid-collapse) is reachable room, not part of the stance
      sc.scrollTop = sc.scrollHeight - sc.clientHeight - spcr;
      walkRef.current.sanctioned = sc.scrollTop;
      return;
    }
    // Keyboard up: pin against what's actually VISIBLE, not a layout
    // position — iOS picks its pan from wherever the page sat at focus, so a
    // fixed layout stance can land under the keyboard and every re-pin would
    // hold it there. visBottom is read LIVE each pass. Only a hair of air is
    // subtracted: ruler-calibrated on device, visualViewport.height already
    // ends ABOVE the keyboard's floating accessory band (vis 337 vs the pills
    // at r333 with the keyboard at r404), so a band allowance here would
    // double-count and park the seal too high.
    const target = visBottom - 16;
    const sealB = btn.getBoundingClientRect().bottom;
    // …but the pin serves the WRITER: if the caret sits on an early line of a
    // long entry (re-focused by tapping its top), the seal stance would strand
    // the caret above the fold. Predict where the caret line lands under the
    // seal pin; if it would be out of view, centre the caret line in the
    // visible window instead. Typing at the end keeps the seal stance — there
    // the caret rides just above the seal, always in view.
    const sealDelta = sealB - target;
    const caretB = caretClientBottom();
    // Trim the reach spacer to the stance: the seal pin is the DEEPEST scroll
    // anyone needs, so size the spacer to put max-scroll a hair beyond it —
    // seeded at the whole keyboard inset, it let the book scroll far into
    // blank paper below the zone. Runs on every pass, so it re-grows when a
    // clamped pin needs more room and re-trims as the words come and go.
    const trimSpacer = () => {
      const sp = kbSpacerRef.current;
      if (!sp || sp.offsetHeight <= 0) return;
      const stPin = sc.scrollTop + (btn.getBoundingClientRect().bottom - target);
      const bare = sc.scrollHeight - sp.offsetHeight - sc.clientHeight;
      const h = Math.max(0, Math.round(stPin + 24 - bare));
      if (Math.abs(h - sp.offsetHeight) > 1) sp.style.height = `${h}px`;
    };
    if (caretB != null && caretB - sealDelta < visTop + 8) {
      const mid = (visTop + visBottom) / 2 + 10;
      sc.scrollTop += caretB - mid;
      walkRef.current.sanctioned = sc.scrollTop;
      trimSpacer();
      return;
    }
    sc.scrollTop += sealDelta;
    walkRef.current.sanctioned = sc.scrollTop;
    trimSpacer();
  };
  // A caret MOVE (a tap, the loupe, iOS's spacebar trackpad) is NOT an
  // anchoring moment. A normal textbox scrolls only when the caret would
  // leave view — and scrolling mid-gesture is what broke the native text
  // interactions (multi-tap escalation counts taps on STATIONARY text; the
  // trackpad fights any scroll under it). So caret moves get this instead of
  // anchorTail: act only on a collapsed caret that strayed OUT of the visible
  // window, and then only nudge it just inside the near edge.
  const revealCaret = () => {
    const sc = scrollerOf();
    if (!sc) return;
    const { kb, visBottom, visTop } = kbGeom();
    if (kb < 60) return; // no keyboard, nothing to keep clear of
    const area = areaRef.current;
    if (!area || area.selectionStart !== area.selectionEnd) return; // selecting
    const caretB = caretClientBottom();
    if (caretB == null) return;
    const lo = visTop + 8;
    const hi = visBottom - 24;
    if (caretB >= lo && caretB <= hi) return; // already in view: hands off
    const tgt = caretB < lo ? visTop + 28 : hi;
    sc.scrollTop += caretB - tgt;
    walkRef.current.sanctioned = sc.scrollTop; // this follow is ours
  };
  const sizeKbSpacer = () => {
    const sp = kbSpacerRef.current;
    if (!sp) return;
    // room below the zone so the visual pin can lift the tail clear of the
    // keyboard; collapses on dismissal even while focused (the vv listeners
    // re-run this — on pan-only devices dismissal shows up as the pan
    // returning to zero). SEEDED at the full keyboard inset only so the
    // first pin can reach; the pin pass immediately TRIMS it so the stance
    // is the deepest scroll (see anchorTail) — left at a full keyboard of
    // reach, the book scrolled far into blank paper below the zone.
    const { kb } = kbGeom();
    if (kb < 60) {
      sp.style.height = "";
      return;
    }
    if (!sp.style.height) sp.style.height = `${kb}px`;
  };
  // Centre the empty field: split the spare height evenly between the flexible
  // slack above it and the rigid spacer below it. Idempotent (the total is
  // conserved), sized only while the field is at rest — once writing begins the
  // spacer is frozen so growth spends the top slack alone and the caret line
  // never moves.
  const centerField = () => {
    const s1 = topSlackRef.current, s2 = restSpacerRef.current, area = areaRef.current;
    if (!s1 || !s2 || !area) return;
    if (area.scrollHeight > 61) return; // 3 rest lines = 60px; already writing
    const spare = s1.offsetHeight + (parseFloat(s2.style.height) || 0);
    s2.style.height = `${Math.max(0, spare / 2)}px`;
  };
  useLayoutEffect(centerField, [gen, day]);
  const clearAnchorTimers = () => { anchorTimers.current.forEach(clearTimeout); anchorTimers.current = []; };
  // FOCUS: re-pin across the keyboard's rise (~300ms), in case the browser's
  // own focus-scroll nudges the book off its foot.
  const vvListenerRef = useRef<(() => void) | null>(null);
  const selChangeRef = useRef<(() => void) | null>(null);
  const scScrollRef = useRef<(() => void) | null>(null);
  const touchCancelRef = useRef<(() => void) | null>(null);
  const touchUpRef = useRef<(() => void) | null>(null);
  const touchActiveRef = useRef(false);
  // A CARET WALK (iOS's spacebar trackpad, arrow keys): selectionchange events
  // stream with NO touch on the page — the finger is on the keyboard. WebKit
  // natively auto-scrolls to FOLLOW the walking caret (that's a normal textbox
  // and must flow untouched), but it doesn't know the caret stops at the
  // field's first line: push past the top and it keeps scrolling the BOOK into
  // history. The tell: legitimate follow always keeps the caret in view.
  // During a walk, a foreign scroll that leaves the caret OUT of the window —
  // or keeps digging when the caret is already at position 0 — is the
  // auto-scroller overshooting and is snapped back to the walk's leading edge.
  // `sanctioned` is the scrollTop of our own last write (so our pin/reveal
  // scrolls are never mistaken for foreign ones); `prevSt` gives each scroll
  // event its direction. A real finger on the page dissolves the walk.
  const walkRef = useRef({ until: 0, sanctioned: -1, prevSt: -1, prevSel: -1 });
  // the walk SESSION: true from the first caret move of a walk until an event
  // that proves the gesture ended (page touch, typing, blur, app switch,
  // keyboard resize). Unlike walk.until it survives pauses — the trackpad
  // finger can hover motionless for seconds and the anchor must stay silent.
  const walkSessionRef = useRef(false);
  const lastInputRef = useRef(0); // when the field last received a keystroke
  // a live selection-handle drag: set to a short deadline on each selectionchange
  // that extends a selection under a finger, so the scroll clamp knows to keep
  // the drag inside the entry (see onScScroll). Collapsed carets never set it —
  // typing, taps, and caret walks are untouched.
  const selDragRef = useRef(0);
  const vvEndListenerRef = useRef<(() => void) | null>(null);
  const anchorPass = () => { sizeKbSpacer(); anchorTail(); };
  const scheduleAnchor = () => {
    centerField(); // a viewport change while resting re-centres before writing
    anchorPass();
    requestAnimationFrame(anchorPass);
    clearAnchorTimers();
    // Re-pin across the keyboard's rise AND well past it: iOS runs its own
    // caret-reveal scroll after the keyboard fully settles — later than the
    // rise-end visualViewport resize — and whoever writes last wins. Every
    // pass converges on the same visual target, so repeats are invisible;
    // the long tail just makes sure ours is the final word.
    anchorTimers.current = [80, 200, 360, 600, 900, 1300].map((ms) =>
      setTimeout(anchorPass, ms),
    );
    // …but never against the reader: the moment a finger lands on the page,
    // the remaining passes stand down (typing re-arms its own short re-pin)
    if (!touchCancelRef.current) {
      const standDown = () => { touchActiveRef.current = true; walkRef.current.until = 0; walkSessionRef.current = false; clearAnchorTimers(); };
      const touchUp = () => { touchActiveRef.current = false; };
      touchCancelRef.current = standDown;
      touchUpRef.current = touchUp;
      window.addEventListener("touchstart", standDown, { passive: true });
      window.addEventListener("touchend", touchUp, { passive: true });
      window.addEventListener("touchcancel", touchUp, { passive: true });
      window.addEventListener("wheel", standDown, { passive: true });
    }
    // Track the viewport while focused — 'resize' where heights change, and
    // 'scroll' for PAN-ONLY devices whose heights never move (there the pan is
    // the only keyboard signal: rise, dismissal, and the re-pan when returning
    // from an app switch all arrive here). Guarded so a pinch (scale > 1) or
    // an active finger is never fought. Returning from the app switcher also
    // lands via window focus / visibilitychange, where iOS may restore the
    // scroll into the reach region with no viewport event at all.
    if (!vvListenerRef.current && window.visualViewport) {
      // Two classes of viewport event, split by what they mean for a caret
      // walk. The trackpad is a SESSION: it survives pauses (the finger can
      // hover motionless for seconds), so suppressing re-anchors only within
      // 600ms of the last caret move wasn't enough — a pause let the walk
      // lapse, the next little iOS pan fired a full anchor pass, and the
      // book yanked to the seal stance mid-gesture. The session ends only on
      // events that PROVE the gesture is over: a finger on the page, typing,
      // blur, an app switch, or the keyboard actually changing size.
      const onViewportEnd = () => {
        // resize / window focus / visibilitychange: keyboard geometry moved
        // or we're returning from elsewhere — the walk (if any) is over and
        // the stance must re-assert (dismissal collapse, app-switch re-seat)
        const vv = window.visualViewport;
        if (vv && vv.scale > 1.01) return;
        if (touchActiveRef.current) return;
        walkSessionRef.current = false;
        anchorPass();
      };
      const onViewportPan = () => {
        // vv/document scroll: iOS pans — during a walk session the WALK owns
        // the view and these must not re-anchor (that was the mid-glide
        // back-and-forth); outside one, re-pin against the live pan
        const vv = window.visualViewport;
        if (vv && vv.scale > 1.01) return;
        if (touchActiveRef.current) return;
        if (walkSessionRef.current && kbGeom().kb >= 60) return;
        anchorPass();
      };
      vvListenerRef.current = onViewportPan;
      vvEndListenerRef.current = onViewportEnd;
      window.visualViewport.addEventListener("resize", onViewportEnd);
      window.visualViewport.addEventListener("scroll", onViewportPan);
      // iOS's document-scroll flavour of the keyboard pan (window scroll
      // events don't bubble from inner scrollers, so this hears ONLY the
      // document — i.e. only iOS's own keyboard avoidance)
      window.addEventListener("scroll", onViewportPan);
      window.addEventListener("focus", onViewportEnd);
      document.addEventListener("visibilitychange", onViewportEnd);
    }
    // Follow the CARET, not just the viewport: iOS places a tapped caret on
    // its own schedule, and a tap that moves the caret in an ALREADY-focused
    // field fires no focus and no input — this is the only event that hears
    // it. The response is the gentle revealCaret (never the anchoring pass —
    // scrolling on every caret move broke multi-tap selection and the
    // spacebar trackpad), deferred and finger-guarded: mid-drag (loupe) the
    // passes sit out; the last selectionchange of a drag lands its later
    // passes after the lift.
    if (!selChangeRef.current) {
      const onSelChange = () => {
        const area = areaRef.current;
        if (document.activeElement !== area) return;
        // The initial focus places the caret, firing selectionchange — but
        // that is NOT a trackpad walk. iOS then runs its own caret-reveal
        // scroll, re-firing selectionchange after each move; letting the walk
        // follower / late reveal engage in that window made them fight the
        // focus choreography's seal pin, and iOS's re-fires turned the fight
        // into a self-driving upward drift (~50px a beat). The pin already
        // seats the caret on focus (its caret branch), so the walk machinery
        // simply stands down until the focus has settled.
        if (performance.now() - lastFocusAt.current < 900) return;
        // a non-collapsed selection moving on its own (not a keystroke) = an iOS
        // handle drag. Arm the scroll clamp (onScScroll) so WebKit's own
        // auto-scroll — which, with this field un-scrollable, lands on the book
        // feed — can reveal the entry's earlier lines but can't drag on into
        // earlier days. No touch guard: iOS doesn't reliably deliver page touch
        // events under a selection handle. The clamp keeps its own window alive
        // as the feed scrolls, so it can't lapse when the selection stops
        // changing (handle parked at line 1) while iOS keeps scrolling.
        // Collapsed carets fall through to the walk logic below.
        if (
          area &&
          area.selectionStart !== area.selectionEnd &&
          performance.now() - lastInputRef.current > 300
        ) {
          selDragRef.current = performance.now() + 400;
        }
        // a collapsed-caret move with no finger on the page = a caret walk;
        // open (or extend) the walk window the scroll clamp acts within
        if (area && area.selectionStart === area.selectionEnd && !touchActiveRef.current) {
          const now = performance.now();
          const sc = scrollerOf();
          if (sc && now > walkRef.current.until) walkRef.current.sanctioned = sc.scrollTop;
          walkRef.current.until = now + 600;
          // only a caret that moved WITHOUT typing opens a session — a
          // keystroke's own selectionchange is the keys talking, not the
          // trackpad, and typing must leave the pan re-anchors armed
          if (now - lastInputRef.current > 300) walkSessionRef.current = true;
          // DOWNWARD follow is ours alone, and it must be immediate: WebKit
          // follows a walking caret upward natively but walks it down only to
          // the last visible line and stops — its auto-scroll never engages
          // downward in an inner scroller, and the late reveal can't help
          // because a caret parked at the bottom edge is still "in view". As
          // the caret enters the bottom band, step the book to open the next
          // lines; each further line re-steps, so holding the cursor low
          // scrolls the entry down. Typing never lands here — the pin keeps
          // the caret a whole seal above the keyboard.
          //
          // STRICTLY for an ADVANCING caret: a direction-blind step trapped
          // upward drags that started low — each upward move still inside the
          // band stepped the book down, iOS re-snapped the caret to the later
          // line under the (still low) cursor, and the drag was undone as
          // fast as it was made. Selection decreasing = walking up: the view
          // holds still and the caret climbs out freely.
          if (sc) {
            const sel = area.selectionStart ?? 0;
            const advancing = sel > walkRef.current.prevSel;
            walkRef.current.prevSel = sel;
            const { kb, visBottom } = kbGeom();
            if (kb >= 60 && advancing) {
              const caretB = caretClientBottom();
              if (caretB != null && caretB > visBottom - 44) {
                sc.scrollTop += caretB - (visBottom - 84);
                walkRef.current.sanctioned = sc.scrollTop;
              }
            }
          }
        }
        // The reveal is a LATE rescue, never a live follower. WebKit follows
        // a walking caret natively and smoothly; an immediate reveal raced it
        // and double-scrolled — the view hopped in steps while the trackpad
        // moved. Each selectionchange resets these timers, so mid-walk the
        // reveal never fires at all: it runs only once the caret has settled,
        // and only if WebKit left it stranded out of view. Its OWN timer pool:
        // clearing the anchor timers here silently killed the focus
        // choreography (a tap's caret placement fires selectionchange right
        // after focus) — the pin never ran and the reach spacer never seeded.
        revealTimers.current.forEach(clearTimeout);
        revealTimers.current = [450, 900].map((ms) =>
          setTimeout(() => { if (!touchActiveRef.current) revealCaret(); }, ms),
        );
      };
      selChangeRef.current = onSelChange;
      document.addEventListener("selectionchange", onSelChange);
    }
    // The walk's scroll clamp (see walkRef). Native follow flows through
    // untouched — only overshoot is corrected, back to the walk's leading
    // edge. Our own correction updates `sanctioned`, so its scroll event
    // no-ops on arrival.
    if (!scScrollRef.current) {
      const sc = scrollerOf();
      if (sc) {
        const onScScroll = () => {
          const walk = walkRef.current;
          const st = sc.scrollTop;
          const d = walk.prevSt < 0 ? 0 : st - walk.prevSt;
          walk.prevSt = st;
          // Selection-handle drag containment (see selDragRef). This field is
          // un-scrollable by design, so WebKit's selection auto-scroll lands on
          // the book feed and can haul it up past today into earlier days. While
          // a drag is live, if the today zone's top has slipped below the
          // scroller's top, earlier days are showing — pull the feed back so the
          // drag reveals the entry and halts at its head. A selection drag
          // carries no fling momentum, so this write can't kill one, and it's
          // scoped to the drag window; every other scroll falls straight through.
          const areaEl = areaRef.current;
          if (
            performance.now() < selDragRef.current &&
            areaEl &&
            areaEl.selectionStart !== areaEl.selectionEnd
          ) {
            // keep the window alive as long as the feed is being auto-scrolled
            // under a live selection — iOS scrolls on past the last
            // selectionchange (handle parked at line 1), and a lapsed window
            // there is exactly what let the overshoot through.
            selDragRef.current = performance.now() + 400;
            const zone = areaEl.closest<HTMLElement>("[data-today-zone]");
            if (zone) {
              const over = zone.getBoundingClientRect().top - sc.getBoundingClientRect().top;
              if (over > 0.5) {
                sc.scrollTop = st + over;
                walk.sanctioned = sc.scrollTop;
                walk.prevSt = sc.scrollTop;
              }
            }
            return;
          }
          if (touchActiveRef.current) return;
          if (Math.abs(st - walk.sanctioned) < 2) return; // our own write settling
          if (performance.now() > walk.until) return;
          const { kb, visBottom, visTop } = kbGeom();
          if (kb < 60) return;
          const area = areaRef.current;
          if (!area || area.selectionStart !== area.selectionEnd) return;
          const caretB = caretClientBottom();
          if (caretB == null) return;
          const lo = visTop + 8;
          const hi = visBottom - 24;
          const atStart = (area.selectionStart ?? 0) === 0 && area.value.length > 0;
          // legitimacy is judged against the FULL window (WebKit parks a
          // walking caret right at the keyboard top, a hair below our hi —
          // that must not read as "left behind"); hi stays the pull-back
          // target so corrections land clear of the accessory pills
          if (caretB >= lo && caretB <= visBottom) {
            // in view = legitimate follow — EXCEPT digging into history with
            // the caret already at the very start: nothing left to reveal,
            // hold line 1 at the top edge
            if (!(atStart && d < 0 && caretB > lo + 40)) return;
            sc.scrollTop += caretB - (lo + 20);
          } else {
            // the caret was left behind: bring it back to the walk's leading
            // edge (scrolling up leads with the top edge, down with the bottom)
            sc.scrollTop += caretB - (d < 0 ? lo + 20 : hi - 20);
          }
          walk.sanctioned = sc.scrollTop;
          walk.prevSt = sc.scrollTop;
          walk.until = performance.now() + 600; // it's still pushing: hold the line
        };
        scScrollRef.current = onScScroll;
        sc.addEventListener("scroll", onScScroll, { passive: true });
      }
    }
  };
  const releaseTail = () => {
    clearAnchorTimers();
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current = [];
    // the extra reach below the zone exists only while writing
    if (kbSpacerRef.current) kbSpacerRef.current.style.height = "";
    if (vvListenerRef.current && window.visualViewport) {
      window.visualViewport.removeEventListener("scroll", vvListenerRef.current);
      window.removeEventListener("scroll", vvListenerRef.current);
      vvListenerRef.current = null;
    }
    if (vvEndListenerRef.current && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", vvEndListenerRef.current);
      window.removeEventListener("focus", vvEndListenerRef.current);
      document.removeEventListener("visibilitychange", vvEndListenerRef.current);
      vvEndListenerRef.current = null;
    }
    if (selChangeRef.current) {
      document.removeEventListener("selectionchange", selChangeRef.current);
      selChangeRef.current = null;
    }
    if (scScrollRef.current) {
      scrollerOf()?.removeEventListener("scroll", scScrollRef.current);
      scScrollRef.current = null;
    }
    walkRef.current.until = 0;
    walkSessionRef.current = false;
    if (touchCancelRef.current) {
      window.removeEventListener("touchstart", touchCancelRef.current);
      window.removeEventListener("wheel", touchCancelRef.current);
      touchCancelRef.current = null;
    }
    if (touchUpRef.current) {
      window.removeEventListener("touchend", touchUpRef.current);
      window.removeEventListener("touchcancel", touchUpRef.current);
      touchUpRef.current = null;
    }
    touchActiveRef.current = false;
  };
  useEffect(
    () => () => {
      releaseTail();
      caretMirror.current?.remove();
      caretMirror.current = null;
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // The zone's tap-to-write (see the zone box below). Driven from pointerup
  // with our own tap detection, NOT click: iOS's text-interaction gesture can
  // swallow the click for a caret tap on a focused field — exactly the state
  // that needs rescuing. click stays attached as the desktop/fallback path,
  // deduped by time.
  const zoneTapRef = useRef({ x: 0, y: 0, t: 0, id: -1, handledAt: 0 });
  const engageZoneTap = (t: HTMLElement) => {
    if (frozen) return;
    // a tap that means a control — the seal, the letters' links, the locked
    // letter's Settings button — is never also a bid for the keyboard
    if (t.closest("button, a")) return;
    const area = areaRef.current;
    if (!area) return;
    const onField = t.closest("textarea") === area;
    const focused = document.activeElement === area;
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    // never cycle a FRESH focus: on a first engaging tap the focus lands at
    // pointerdown and the keyboard is still rising at tap's end, so kb reads
    // 0 — only a focus predating this gesture means the keyboard was truly
    // dismissed underneath it (iOS's dismiss pill keeps focus, kills the
    // keyboard, and then no tap can summon it back without a REAL focus)
    const stale = performance.now() - lastFocusAt.current > 700;
    const mustCycle = focused && coarse && stale && kbGeom().kb < 60;
    if (onField && !mustCycle) return; // the field's own tap already works
    if (mustCycle) {
      // WebKit settles keyboard visibility once per turn: a same-task
      // blur→focus nets to "nothing changed" and the keyboard stays down.
      // Blur now; refocus in a NEW task (still inside the tap's transient
      // activation, so the keyboard may rise). A words tap keeps the caret
      // the tap placed; a paper tap resumes writing at the end.
      area.blur();
      window.setTimeout(() => {
        area.focus();
        const s = onField ? (area.selectionStart ?? area.value.length) : area.value.length;
        const e2 = onField ? (area.selectionEnd ?? s) : s;
        area.setSelectionRange(s, e2);
      }, 60);
      return;
    }
    // synchronously (the proven keyboard-riser) AND once more a beat later:
    // the browser's own blur-on-tap-outside lands LATER in this same gesture
    // (mousedown follows pointerup) and would undo a focus set only here
    const toEnd = () => {
      area.focus();
      const end = area.value.length;
      area.setSelectionRange(end, end);
    };
    toEnd();
    window.setTimeout(toEnd, 80);
  };

  // Voice: the seal is the microphone. Spoken words merge after whatever's
  // already written; the field grows and the tail re-pins in the same frame
  // (a state-driven value change bypasses onChange, so both are done by hand).
  // Unmounting mid-take (changing altitude, opening an entry) aborts the
  // recorder and drops the audio — accepted for now.
  const voiceUsed = useRef(false);
  // true from the moment a take begins through its settling and the entry it
  // leaves behind — so the seal, when the take stops, morphs the stop square
  // straight into the quill (never flashing the mic on the way) and stays in
  // one carousel lane the whole time. Reset when the composer returns to blank
  // rest (kept, cleared, or an empty take), which brings the mic back.
  const [afterVoice, setAfterVoice] = useState(false);
  const speech = useSpeech((spoken) => {
    voiceUsed.current = true;
    setText((prev) => joinText(prev, spoken));
    // growth + anchoring happen in the shownText layout effect below (after
    // React commits the new value — a rAF here raced the commit and, for the
    // batch engine's single all-at-once set, measured the STALE 3-line height
    // and left the field a 3-line scroll window). Here we only take focus so
    // the caret sits at the end and the keyboard can be summoned to keep on.
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus(); // onFocus runs the full re-pin choreography
      el.setSelectionRange(el.value.length, el.value.length);
    });
  });
  const listening = speech.status === "listening";
  const transcribing = speech.status === "transcribing";
  // the streaming engines (scribe, web) put words on the rules as they come;
  // the batch engine records quietly and sets them all at once after the stop.
  // Kept through `transcribing` so the words don't blink out while the last
  // segment settles.
  const liveSpoken =
    listening || transcribing
      ? [...speech.segments.map((s) => s.text), speech.interim]
          .filter(Boolean)
          .join(" ")
      : "";
  const shownText = liveSpoken ? joinText(text, liveSpoken) : text;
  // The field GROWS to fit whatever it shows — the one place that is true for
  // EVERY source of words (typing, streaming voice, a batch transcript set
  // all at once). A layout effect keyed on the displayed value runs after
  // React commits it and before paint, so scrollHeight is always current: no
  // engine and no timing can leave the words in a fixed 3-line scroll window.
  // Voice also re-anchors (its growth can outrun the keyboard stance); typing
  // already anchored in onChange, so this stays out of its way.
  const wasVoicing = useRef(false);
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    autosizeArea(el);
    const voicing = !!liveSpoken || transcribing;
    if (voicing || wasVoicing.current) {
      lastInputRef.current = performance.now();
      walkSessionRef.current = false;
      anchorPass();
    }
    wasVoicing.current = voicing;
  }, [shownText, liveSpoken, transcribing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Safety net for the seal's press pose. The press rotates the seal
  // imperatively (pushdown ramp), and the pointer-up release is a double-rAF
  // that, on tap-to-start, races the glyph re-bake speech.start() triggers
  // (mic→stop). When that release is lost, the stop square stays frozen at
  // the ~30° press angle for the whole take. A running take means the finger
  // is up, so the seal must never hold the press then — release it. (A keep
  // sets holdDown and is guarded out, so its lift-off choreography is intact.)
  useEffect(() => {
    if ((listening || transcribing) && !holdDown) sealCtl.current?.press(false);
  }, [listening, transcribing, holdDown]);

  // voice must never fail silently — every failure says what happened, and
  // the words must match reality: a "service" failure blames the browser
  // only when it's the browser's own engine that refused; a network
  // transcriber refusing (bad key, quota, unconfigured) is on our side.
  useEffect(() => {
    if (!speech.failure) return;
    const f = copy.capture.voiceFailures;
    let m: { title: string; description: string };
    if (speech.failure === "service") {
      if (speech.engine === "web") {
        // the browser's built-in dictation refused — the one real browser
        // fault. On iOS all browsers are WebKit, so never suggest switching.
        m = {
          title: f.service.title,
          description: isIOSStandalone()
            ? f.service.descriptionInstalledIOS
            : isIOS()
              ? f.service.descriptionIOSBrowser
              : f.service.descriptionOtherwise,
        };
      } else {
        // Deepgram/Scribe/batch refused — not the browser
        m = f.serviceRemote;
      }
    } else {
      m = f[speech.failure];
    }
    toast(m.title, { description: m.description });
  }, [speech.failure]);

  // the quill appears only once there's a real character typed (not on focus),
  // and stays through the keep
  const hasText = text.length > 0;
  // which glyph the seal wears + presses: the mic holds through a whole take
  // (listening and settling), then cross-slides to the quill with the words
  const quill = (hasText || frozen) && !listening && !transcribing;
  // a voice take fell back to blank rest (kept, cleared, or nothing said):
  // drop the voice lane so the mic returns. Adjusted during render (React's
  // sanctioned escape hatch, no effect) — and the has-text handoff is React-
  // batched with the status flip, so this never trips mid-settle.
  if (afterVoice && !listening && !transcribing && !hasText) setAfterVoice(false);
  // the seal's face and carousel lane. During and after a voice take the seal
  // stays in the mic lane wearing stop→quill (an in-place morph); typing
  // cross-slides mic→quill in its own lane. `voiceFace` shows the quill the
  // instant a take stops, so the mic never flashes while the words settle.
  const voiceFace = afterVoice && !listening;
  const sealGlyph = listening ? "stop" : quill || voiceFace ? "e:quill" : "c:mic";
  const sealLane = quill && !afterVoice ? "quill" : "mic";
  const sealIconScale = listening ? 0.44 : quill || voiceFace ? 0.36 : 0.46;

  // press timeline (sequential): lead (dismiss keyboard + scroll), play the
  // press, hold the settled seal a beat, then the keep animation in order.
  const LEAD_MS = 380;
  const HOLD_MS = 1450;
  const EXIT_MS = 560;  // sweep step 1: the zone slides off right
  const ENTRY_MS = 560; // sweep step 2: the entry wipes into the schedule

  const submit = () => {
    if (transcribing) return; // the words are settling — a beat, not a state to act in
    if (listening) {
      speech.stop(); // tap again → stop the take
      return;
    }
    if (!hasText) {
      // mic: begin the entry by speaking — or, where voice isn't offered
      // (or the probe hasn't resolved yet), by writing
      if (speech.resolved && speech.supported) {
        setAfterVoice(true); // this seal stays in the voice lane until blank rest
        speech.start();
      } else areaRef.current?.focus();
      return;
    }
    if (phase !== "idle") return; // a keep is already running (idempotent)
    keeping.current = true; // synchronous mirror for the pointer handlers
    const t = text.trim();
    const capturedAt = Date.now();
    const id = ulid(); // creation-order id (today: same as capturedAt)
    const file = () => {
      const source = voiceUsed.current ? "voice" : "typed";
      draft?.set({
        id, text: t, kind: null, tags: [], capturedAt, day,
        source, favorite: 0, updatedAt: capturedAt,
      });
      void addSnippet({ id, text: t, source, capturedAt })
        .catch((error: unknown) => {
          // the keep did not take — withdraw the optimistic card, put the
          // words back, say why. Never a silent loss.
          draft?.clear(day);
          setText(t);
          toast(
            error instanceof StorageWriteError && error.full
              ? copy.data.storageFull
              : copy.data.keepFailed,
          );
        });
    };
    // freeze the words; hold the seal pressed-down through the lead; dismiss the
    // keyboard and bring the seal fully into view
    setPhase("pressing");
    setHoldDown(true);
    areaRef.current?.blur();
    requestAnimationFrame(() =>
      btnRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    clearTimers();
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    // release the held press exactly as the lift-off plays — the press
    // animation continues from the user's press, no un-rotate
    at(LEAD_MS, () => { setHoldDown(false); setPlayKey((k) => k + 1); navigator.vibrate?.(8); });
    // sweep — three beats, IN ORDER:
    at(LEAD_MS + HOLD_MS, () => setPhase("exiting"));                       // 1 zone slides off right
    at(LEAD_MS + HOLD_MS + EXIT_MS, () => { file(); setPhase("filling"); onKept?.(id); }); // 2 entry wipes in; pan up to watch it
    at(LEAD_MS + HOLD_MS + EXIT_MS + ENTRY_MS, () => {                       // 3 fresh zone fades in
      setText(""); setPhase("idle"); setGen((g) => g + 1); keeping.current = false;
      voiceUsed.current = false;
      releaseTail();
    });
  };

  // the zone's hairline blue outline (wax = recording) — it deepens while
  // the microphone is on, anchoring the wash to the frame it seeps from.
  // transform rides the same transition (slower, per the glow's bloom):
  // the press glow writes scale onto this box but never its transition
  const frame = cn(
    "border transition-[border-color,transform] [transition-duration:240ms,500ms] [transition-timing-function:var(--ease-out),var(--ease-bloom)]",
    listening ? "border-wax/70" : "border-wax/45",
  );

  return (
    <>
    {/* each generation is one element: the old zone slides off the right while a
        fresh one fades + floats in to take its place. */}
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={gen}
        // the containment boundary for a selection-handle drag: nothing above
        // this element is today — a drag that reaches here has revealed the
        // whole entry and must not haul the feed on into earlier days
        data-today-zone=""
        // the zone sits in the book's standard frame: its top gap matches the
        // side gutter (px-5) and the chin below it, so the content reads with one
        // even ~20px margin on every side. first-ever keeps just a hair (nothing
        // above it to breathe from).
        className={cn(
          "relative flex w-full flex-col",
          firstEver ? "pt-1 mb-[3px]" : hasEntry ? "pt-[20px]" : "pt-[19px] mb-[3px]",
          className,
        )}
        // the fresh zone fades in with a small float down (no full slide-from-top
        // that would sweep over the entries above it)
        initial={gen === 0 ? false : { y: -12, opacity: 0 }}
        // once slid off the right it STAYS off (through `filling`) so it never
        // animates back in before the gen bump removes it; y pinned to 0 so it
        // travels straight right, not up-and-right.
        animate={
          phase === "exiting" || phase === "filling"
            ? { x: "112%", y: 0, opacity: 0 }
            : { x: 0, y: 0, opacity: 1 }
        }
        // the visible slide is the `animate` above, so removal is instant
        exit={{ opacity: 0, transition: { duration: 0 } }}
        transition={{ duration: EXIT_MS / 1000, ease: "easeInOut" }}
      >
        <div
          data-today-zone-box
          // while keeping (sliding/fading) the foot rule steps aside so it
          // doesn't read a moving box
          data-zone-busy={phase !== "idle" ? "1" : undefined}
          className={cn(
            // flex-1 with a firm floor (min-h): the box fills the blank tail when
            // there's little to show AND grows with the words as they're typed,
            // so its outline always wraps the text — never a fixed-height panel
            // the text spills out the bottom of. The box's OWN rounded border is
            // the outline; the flat foot cap covers the straight region.
            "relative flex min-h-[22rem] w-full flex-1 flex-col rounded-2xl cursor-text",
            frame,
          )}
          // The WHOLE paper takes the pen, not just the field: the textarea is
          // only as tall as its words (60px at rest) while the zone around it
          // is far taller, so a tap that misses the rules by a hair — above,
          // below, in the margins — landed on nothing and the keyboard never
          // rose. A click here (never fired for a scroll gesture, and carrying
          // the user activation iOS needs to open the keyboard) hands the tap
          // to the field, caret at the end — "continue writing".
          //
          // The trap inside: iOS's dismiss pill hides the keyboard but KEEPS
          // the field focused (seen on-device: `focus TEXTAREA` with the
          // keyboard down). Then focus() is a no-op and even a caret tap on
          // the words summons nothing — no focus event, no keyboard. The
          // engage handler (see engageZoneTap) forces a real focus with a
          // blur → next-task refocus. Driven from POINTERUP with our own tap
          // detection because iOS can swallow the click for caret taps.
          onPointerDown={(e) => {
            zoneTapRef.current = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, handledAt: zoneTapRef.current.handledAt };
          }}
          onPointerUp={(e) => {
            const d = zoneTapRef.current;
            if (e.pointerId !== d.id) return;
            const now = performance.now();
            if (now - d.t > 600) return; // a hold, not a tap
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 12) return; // a drag/scroll
            d.handledAt = now;
            engageZoneTap(e.target as HTMLElement);
          }}
          onClick={(e) => {
            // fallback (desktop, browsers without pointer events on taps);
            // skipped when the pointerup path just ran
            if (performance.now() - zoneTapRef.current.handledAt < 800) return;
            engageZoneTap(e.target as HTMLElement);
          }}
        >
          {/* the wax wash — recording's colour seeping inward from the frame.
              Mounted for the whole take so the shaders warm up while the mic
              is being armed, but held at opacity 0 (invisible — never paints
              before the writer approves the microphone) until speech.live, so
              the reveal is a true fade of already-painted layers, not a pop.
              Fades back out on stop. */}
          <AnimatePresence>
            {listening && (
              <motion.div
                key="wash-fill"
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-[inherit]"
                initial={{ opacity: 0 }}
                animate={{ opacity: speech.live ? 1 : 0 }}
                exit={{ opacity: 0 }}
                // a gentle ease-in-out, not the snappy UI ease — the light
                // should seep in and ebb out, not flick
                transition={{ duration: 0.42, ease: [0.42, 0, 0.58, 1] }}
              >
                <RecordingWash corner={ZONE_CORNER} />
              </motion.div>
            )}
          </AnimatePresence>
          {/* the press glow — light pools under a touch anywhere on the
              paper and follows the finger; above the wash, under the words.
              NOT while a letter is on the sheet (the first-ever introduction
              or the locked letter): a newcomer is reading, scrolling, and
              finding their feet — light chasing the finger over the words
              is exactly the distraction those beats can't afford. It
              returns the moment the letter retires. */}
          {!((lockedLetter || firstEver) && text.trim().length === 0) && <PressGlow grow />}
          {/* horizontal inset is a PROPORTION of the sheet width (not a fixed
              px), so the ruled field and the intro keep the same visual margin
              from a narrow phone up to the wide desk — the ruled paper and the
              intro both fill this padded column (w-full), which is what keeps
              their left/right edges aligned. `relative`: the words are ink ON
              the glow's light, so the column paints after it */}
          <div className="relative flex flex-1 flex-col items-center gap-4 px-[8%] py-6 text-center">
          {/* today's date, in the Today-page voice — mt-[83px] + py-6 (24px)
              seats it 107px under the zone's top. That's 11px more than the
              seal's box clearance below, on purpose: the wax is painted high in
              its canvas (room for lobes + drop shadow), leaving ~27px of
              invisible canvas under the visible seal — the split-the-difference
              offsets here and on the button equalize the gaps the EYE sees
              (~110px above the date, ~110px below the wax). */}
          <div className="mt-[83px] leading-none">
            <p className="voice-label text-[0.72rem] text-ink-faint">{format(d, "EEEE")}</p>
            <h2 className="voice-display mt-1 text-[2rem] leading-none text-ink">{format(d, "MMMM d")}</h2>
          </div>
          {/* the letters on the sheet: prose, retiring itself the instant the
              writer starts (law 8 — nothing modal near capture). The locked
              letter (a returning writer whose entries wait sealed on the
              server) outranks the first-ever introduction — a locked device's
              local book is empty too, and greeting that writer as a newcomer
              is the exact confusion this letter exists to prevent. */}
          <AnimatePresence mode="wait">
            {lockedLetter && text.trim().length === 0 ? (
              <motion.div
                key="locked-letter"
                // the locked state is only known once the first sync cycle
                // answers, a beat after load — so the letter always enters by
                // fading in, never popping
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.18 } }}
                transition={{ duration: 0.24, ease: "easeOut" }}
                className="w-full space-y-3 text-left"
              >
                {copy.todayZone.locked.body(lockedCount).map((para, i) => (
                  <p
                    key={i}
                    className="voice-prose text-[0.92rem] leading-[1.5] text-ink-soft"
                  >
                    {renderInline(para, `locked-${i}`)}
                  </p>
                ))}
                <div className="flex justify-center pt-1">
                  <PaperButton
                    onClick={() =>
                      router.push("/settings?tab=account&unlock=1")
                    }
                  >
                    {copy.todayZone.locked.action}
                  </PaperButton>
                </div>
              </motion.div>
            ) : firstEver && text.trim().length === 0 ? (
              <motion.div
                key="intro"
                initial={false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.18 } }}
                className="w-full space-y-3 text-left"
              >
                {copy.intro.body.map((para, i) => (
                  <p
                    key={i}
                    className="voice-prose text-[0.92rem] leading-[1.5] text-ink-soft"
                  >
                    {renderInline(para, `intro-${i}`)}
                  </p>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
          {/* the flexible half of the field's centring slack (see centerField);
              the entry grows into this, top first, so its foot never moves */}
          <div ref={topSlackRef} className="w-px flex-1" aria-hidden />

          {/* the ruled "paper" — the clickable entry. It fills the padded
              column (the wrapper's px-[8%] sets the proportional side margin),
              so it and the intro share the same left/right edges at every width.
              (This trades away the old fixed-px width that matched the schedule
              card's 6-rule wrap exactly — margins-scale-with-the-sheet won.) */}
          <div className="relative w-full min-w-[14rem]">
            <textarea
              ref={areaRef}
              value={shownText}
              rows={3}
              // read-only through a voice take: the field is the transcript's
              // page while words arrive (typing mid-take would bake the live
              // words into state and double them when the take settles)
              readOnly={frozen || listening || transcribing}
              // this field anchors its own tail (see anchorTail); the generic
              // keyboard-room hook skips fields marked data-room-center
              data-room-center=""
              // grow the field, then re-anchor: once synchronously, and again
              // just behind the browser's own caret-reveal scroll (rAF + a
              // beat), which otherwise lands after us and drags the stance
              // down. All passes converge on the same fixed visual target, so
              // the repeats can't bounce — unlike the old layout-moving passes.
              onChange={(e) => {
                setText(e.target.value);
                autosizeArea(e.target);
                // typing ends any trackpad walk session (the finger is on the
                // keys) and marks the moment, so this keystroke's own
                // selectionchange doesn't reopen one
                lastInputRef.current = performance.now();
                walkSessionRef.current = false;
                // full passes (spacer + pin), not bare anchorTail: growth can
                // need MORE reach, and if a selectionchange wiped the focus
                // choreography this is what seeds the spacer at all
                anchorPass();
                requestAnimationFrame(anchorPass);
                clearAnchorTimers();
                anchorTimers.current = [setTimeout(anchorPass, 120)];
              }}
              onFocus={() => { lastFocusAt.current = performance.now(); scheduleAnchor(); }}
              onBlur={releaseTail}
              onKeyDown={(e) => { if (enterFiles(e)) { e.preventDefault(); submit(); } }}
              placeholder={
                listening
                  ? copy.capture.listeningPlaceholder
                  : transcribing
                    ? copy.capture.settingWords
                    : firstEver && !lockedLetter
                      // a locked device's book is empty too, but its writer is
                      // no newcomer — the first-ever invitation would jar
                      // against the letter's "welcome back"
                      ? copy.todayZone.placeholderFirstEver
                      : hasEntry
                        ? copy.todayZone.placeholderHasEntry
                        : copy.todayZone.placeholder
              }
              aria-label={copy.todayZone.ariaWriteFor(format(d, "MMMM d"))}
              // 0.9rem: the SAME type as the schedule card's preview, at the
              // same width — so the wrapping here is character-for-character
              // the wrapping there, and N rules filled = N preview lines.
              className="voice-prose relative block w-full resize-none overflow-hidden bg-transparent p-0 text-left text-[0.9rem] outline-none placeholder:italic placeholder:text-ink-faint"
              // The ruled paper lives ON the textarea (background-attachment:
              // local, so the rules always track the words exactly). The rule
              // sits just below the baseline — standard characters rest ON the
              // line, only descenders dip across — and the period is a whole
              // PIXEL (20px ≈ the card preview's 0.9rem × 1.42 = 20.45px
              // rhythm) matched exactly by the line-height: a fractional
              // line-height lets WebKit snap line boxes to device pixels while
              // the gradient stays fractional, so text drifts off its rules
              // over dozens of lines.
              style={{
                lineHeight: "20px",
                minHeight: "60px",
                backgroundImage:
                  "repeating-linear-gradient(to bottom, transparent 0, transparent 19px, var(--rule-faint) 19px, var(--rule-faint) 20px)",
                backgroundPositionY: "-4px",
                backgroundAttachment: "local",
              }}
            />
          </div>

          {/* the rigid half of the field's centring slack — sized once at rest
              (see centerField) and frozen through the writing, so the field's
              foot keeps this exact distance from the seal for the whole entry */}
          <div ref={restSpacerRef} className="-mt-4 w-px shrink-0" aria-hidden />

          {/* the wax button — mic at rest, quill once typing starts; the whole
              button cross-slides (left↔right carousel) on the swap. press it to
              submit (plays the corner·swell keep) */}
          <button
            ref={btnRef}
            type="button"
            aria-label={
              transcribing
                ? copy.capture.seal.busy
                : listening
                  ? copy.capture.seal.stop
                  : hasText
                    ? copy.todayZone.keepEntry
                    : copy.todayZone.speakEntry
            }
            aria-pressed={listening}
            aria-busy={transcribing}
            // press the seal imperatively on pointerdown (rotates in this very
            // frame — no state round-trip). Dragging off the button lifts the
            // seal back up (release there cancels); dragging back on presses it
            // again. Release ON the button keeps (hands the pressed pose to
            // holdDown, no un-rotate); release OFF cancels. onClick covers
            // keyboard activation only — the trailing synthetic click from a
            // pointer is swallowed so it can't re-fire the pointer path.
            onClick={() => {
              if (pointerHandled.current) { pointerHandled.current = false; return; }
              submit();
            }}
            disabled={frozen}
            onPointerDown={(e) => {
              e.preventDefault();
              sealDown.current = true;
              overSeal.current = true;
              sealCtl.current?.press(true);
            }}
            onPointerMove={(e) => {
              if (!sealDown.current || keeping.current) return;
              const inside = inSeal(e);
              if (inside !== overSeal.current) { overSeal.current = inside; sealCtl.current?.press(inside); }
            }}
            onPointerUp={(e) => {
              if (!sealDown.current || keeping.current) return;
              sealDown.current = false;
              pointerHandled.current = true;
              const inside = inSeal(e);
              overSeal.current = false;
              // released on the button: act (submit keeps, or starts/stops a
              // voice take). Released off: cancel — ease the seal back, no
              // submit. The press is handed to holdDown only when a keep
              // actually began. A mic toggle releases two frames later: the
              // glyph re-bakes (mic ⇄ stop) while the seal is still at the
              // pressed pose, so the rise comes up already wearing the new
              // face and grows into it — one continuous path, no mid-air swap.
              if (inside) submit();
              if (!inside) {
                sealCtl.current?.press(false);
              } else if (!keeping.current) {
                const ctl = sealCtl.current;
                requestAnimationFrame(() => requestAnimationFrame(() => ctl?.press(false)));
              }
            }}
            onPointerCancel={() => {
              if (keeping.current) return;
              sealDown.current = false;
              overSeal.current = false;
              sealCtl.current?.press(false);
            }}
            onPointerLeave={(e) => {
              // a reliable lift for mouse (no implicit capture); harmless for touch
              if (!sealDown.current || keeping.current || !overSeal.current) return;
              overSeal.current = false;
              if (!inSeal(e)) sealCtl.current?.press(false);
            }}
            // mb-[58px]: with the zone's own foot (py-6 = 24px + 3px chin) this
            // rests the seal's BOX 85px above the scroll terminus — the visible
            // wax ~112px, clear of the keyboard's floating accessory band while
            // writing (iOS parks the page bottom at the keyboard top), and the
            // same stance at rest. See the date's mt note: the pair equalizes
            // the perceived gaps around the composition.
            className="relative mb-[58px] grid place-items-center rounded-full"
            style={{ width: 128, height: 128 }}
          >
            {/* the seal swells and wears the stop square while listening, then
                morphs the stop straight into the quill when the take ends —
                both in place, one lane (see sealLane). The carousel slide is
                reserved for the mic↔quill typing swap. The glyph re-bakes
                instantly: state flips are frequent, they don't get animated. */}
            <motion.div
              className="absolute inset-0"
              animate={{ scale: listening ? 1.14 : 1 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            >
            <AnimatePresence initial={false}>
              <motion.span
                key={sealLane}
                className="absolute inset-0 grid place-items-center"
                initial={{ x: "70%", opacity: 0 }}
                animate={{ x: "0%", opacity: 1 }}
                exit={{ x: "-70%", opacity: 0 }}
                // slower than the usual ≤260ms UI ceiling on purpose: this is
                // the ONE moment the seal's identity changes from mic to
                // quill, seen once per entry — a snappy 200ms swap read as a
                // flicker and writers didn't register the button had changed
                // (so they kept hunting for how to submit). The extra beat
                // makes the slide itself legible as "the mic became a quill".
                transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
              >
                <CanvasSeal
                  playKey={playKey}
                  size={128}
                  glyph={sealGlyph}
                  // the stop reads bigger than the mic on purpose: with the
                  // 1.14 swell it lands ~0.50 of the seal — an unmissable exit
                  iconScale={sealIconScale}
                  mode="tap"
                  controlRef={sealCtl}
                  pressed={holdDown}
                  variant="spring"
                  ease="front"
                  bounce={1.5}
                  rotate={30}
                  puck={1}
                  cloud={0.5}
                  speckle={0}
                  lingerMs={1000}
                  exitMs={200}
                  exit="grow"
                  ignoreReducedMotion
                />
              </motion.span>
            </AnimatePresence>
            </motion.div>
          </button>
          {/* placeholders aren't announced — voice the take's state aloud */}
          <span className="sr-only" role="status">
            {listening
              ? copy.capture.listeningPlaceholder
              : transcribing
                ? copy.capture.settingWords
                : ""}
          </span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
    {/* keyboard reach: extra scrollable room below the zone while writing, so
        the thumb can pull the caret line up above the keyboard (see
        sizeKbSpacer). A SIBLING of the min-h-full row on purpose — scroller
        padding would shrink the content box the row's height resolves against. */}
    <div ref={kbSpacerRef} aria-hidden className="w-px" />
    </>
  );
}
