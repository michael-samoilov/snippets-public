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
import { usePathname, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  addMonths,
  format,
  isAfter,
  isSameMonth,
  startOfMonth,
} from "date-fns";
import { AnimatePresence, motion, animate, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { ulid } from "ulidx";
import { WaxStamp as CanvasSeal, type SealControl } from "@/components/capture/wax-stamp";
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
} from "@/lib/db";
import { enrichSnippet } from "@/lib/enrich";
import { dayKey, dateFromDayKey, friendlyDay } from "@/lib/dates";
import { copy } from "@/lib/copy";
import type { Snippet } from "@/lib/types";
import { useSettings } from "@/lib/settings";
import { queryTerms } from "@/lib/search";
import { cn } from "@/lib/utils";
import {
  weekdays,
  ym,
  autosizeArea,
} from "@/components/calendar/shared";
import type {
  MonthFeedHandle,
  YearFeedHandle,
} from "@/components/calendar/shared";

const EntryView = dynamic(
  () => import("@/components/calendar/entry-view").then((m) => m.EntryView),
  { ssr: false, loading: () => null },
);
const MarkedPreview = dynamic(
  () => import("@/components/calendar/entry-view").then((m) => m.MarkedPreview),
  { ssr: false, loading: () => null },
);
const MonthFeed = dynamic(
  () => import("@/components/calendar/month-feed").then((m) => m.MonthFeed),
  { ssr: false, loading: () => null },
);
const YearFeed = dynamic(
  () => import("@/components/calendar/year-feed").then((m) => m.YearFeed),
  { ssr: false, loading: () => null },
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

// The book's faint ruled rows — shown while the real entries are still loading
// so the ledger reads as "settling in" rather than blank. Shared by the SSR
// Suspense fallback AND the in-feed loading state, so the paper stays put
// continuously (no skeleton→blank→book flash) right up until the book lands.
function LedgerRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className="grid grid-cols-[2.1rem_1fr] gap-x-2 border-t border-rule-faint pb-2.5 pt-2.5"
        >
          <div />
          <div className="h-14" />
        </div>
      ))}
    </>
  );
}

// A calm placeholder painted on the SERVER (the Suspense fallback is SSR'd), so
// the ledger frame shows the instant the HTML lands instead of a blank sheet.
function CalendarSkeleton() {
  return (
    <div className="page-settle flex h-full min-h-0 flex-col" aria-hidden="true">
      <div className="sticky top-0 z-30">
        <div className="flex items-center justify-between">
          <div
            className="my-1 h-8 w-36 rounded-[5px] opacity-60"
            style={{ background: "var(--rule-faint)" }}
          />
          <div className="size-9" />
        </div>
      </div>
      <div className="relative -mt-px min-h-0 flex-1 overflow-hidden">
        <LedgerRows />
      </div>
    </div>
  );
}

// Dev-only: ?skeldebug holds the pageload skeleton on screen so its look can be
// inspected and tuned (it normally flashes by in the Suspense gap). The real
// skeleton verbatim, plus a quiet pill — same recipe as the perf A/B pill — so
// it's clear you're parked in the held view, not stuck loading.
function SkeletonDebug() {
  return (
    <>
      <CalendarSkeleton />
      <div className="float fixed bottom-3 left-3 z-50 rounded-full px-2.5 py-1">
        <span className="voice-label text-[0.72rem] text-ink-soft">
          skeleton — held
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
  const initialDay = (() => {
    const d = params.get("d");
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : dayKey();
  })();
  // a bare ?y=YYYY (no ?d/?e) opens straight to the year glance
  const initialYear = (() => {
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
    const d = params.get("d");
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
  const [warm, setWarm] = useState(false);
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
    const d = sp.get("d");
    const e = sp.get("e");
    const y = sp.get("y");
    if (d) {
      window.history.replaceState(null, "", pathname);
      window.history.pushState(null, "", `${pathname}?d=${d}`);
      if (e) window.history.pushState(null, "", `${pathname}?d=${d}&e=${e}`);
    } else if (y && /^\d{4}$/.test(y)) {
      // arrived at the year glance: floor it on the month canvas, then the year,
      // so Back drops to the month rather than walking off the page
      window.history.replaceState(null, "", pathname);
      window.history.pushState(null, "", `${pathname}?y=${y}`);
    } else {
      // No deep link: the book (schedule) is home, but the grid is still "a
      // zoom-out away" — so synthesize the month floor beneath it here too.
      // Without this the title's ‹ and the back gesture call history.back()
      // with no calendar entry below and walk off the page entirely.
      window.history.replaceState(null, "", pathname);
      window.history.pushState(null, "", `${pathname}?d=${initialDay}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // bring the off-screen altitudes in just after the arrival settles —
  // past the dock's ink glide (a ~250ms spring), so their build (the
  // book's rows) lands off the transition and the ink never skips. A
  // fixed beat, not requestIdleCallback: idle can fall mid-animation on
  // a fast device, which is exactly when we must not mount.
  useEffect(() => {
    const id = setTimeout(() => setWarm(true), 350);
    return () => clearTimeout(id);
  }, []);

  /* ── the zoom: one camera move between altitudes ──────────────── */

  const runZoom = useCallback((from: View, to: View, anchor: string) => {
    if (zooming.current) return;
    setWarm(true); // a camera move needs both layers mounted now
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
      window.history.pushState(null, "", `${pathname}?d=${key}`);
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
        window.history.replaceState(null, "", `${pathname}?d=${key}`);
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
    window.history.pushState(null, "", `${pathname}?y=${y}`);
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
      window.history.pushState(
        null,
        "",
        `${pathname}?d=${s?.day ?? selectedRef.current}&e=${id}`,
      );
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
      toast(copy.deleteEntry.toast, {
        action: { label: copy.deleteEntry.undo, onClick: () => void restoreSnippet(snippet.id) },
      });
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
    window.history.replaceState(null, "", `${pathname}?d=${key}`);
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
    window.history.replaceState(null, "", pathname);
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

  /* ── the header search: a pill that borrows the whole title row ──
     The title slides off left, the buttons off right; Clear hands the
     row back, reversing the same moves. While a query stands, the
     stage shows the book filtered to it. */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
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
    window.history.pushState(null, "", `${pathname}?d=${day}`);
    scheduleFeedRef.current?.goTo(day);
    runZoom("year", "schedule", day);
  };

  /** a found card opens straight into its own page — the entry view —
      with its book page synthesized beneath, so the card dives open from
      that page and backing out climbs entry → book → canvas */
  const openEntryFromSearch = (s: Snippet) => {
    closeSearch();
    if (urlTimer.current) clearTimeout(urlTimer.current);
    window.history.replaceState(null, "", pathname);
    window.history.pushState(null, "", `${pathname}?d=${s.day}`);
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
    <div className="page-settle flex h-full min-h-0 flex-col">
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
          "mt-3 grid border-b border-rule-faint transition-[grid-template-rows] duration-[var(--dur-slow)] ease-[var(--ease-out)]",
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
          "relative min-h-0 flex-1 overflow-hidden border-b border-transparent",
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
          // a swipe begun on the canvas itself (the blank cells and
          // label rows between months, never a day) climbs to the year
          onPointerDown={(e) => armSwipe(e, true)}
          onPointerUp={(e) => settleSwipe(e, openYear)}
          onPointerCancel={() => (swipe.current = null)}
          className={cn(
            "absolute inset-0 [touch-action:pan-y]",
            !showMonthLayer && "invisible",
            (zoom || !showMonthLayer) && "pointer-events-none",
          )}
        >
          {(view === "month" || warm) && (
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
          {(view === "year" || warm) && (
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
                window.history.replaceState(null, "", pathname);
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
            "absolute inset-0 [touch-action:pan-y]",
            !showScheduleLayer && "invisible",
            (zoom || !showScheduleLayer) && "pointer-events-none",
          )}
        >
          {(view === "schedule" || warm) && (
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
            "absolute inset-0 pt-2 [touch-action:pan-y]",
            !showEntryLayer && "invisible",
            (zoom || !showEntryLayer) && "pointer-events-none",
          )}
        >
          {(view === "entry" || warm) && <EntryView snippet={focused} onLetGo={letGo} />}
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
            className="absolute inset-0 overflow-y-auto overscroll-contain [scrollbar-width:none]"
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
                            <button
                              type="button"
                              onClick={() => openEntryFromSearch(s)}
                              // isolate: bake the marked ink's blend so the
                              // filtered book scrolls without re-blending
                              className={cn(
                                "pressable isolate block w-full rounded-[6px] border border-rule-faint bg-paper p-2.5 text-left",
                                "shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] hover:bg-paper-raised",
                              )}
                            >
                              <MarkedPreview
                                text={s.text}
                                query={query}
                                isQuote={s.kind === "quote"}
                              />
                            </button>
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
  onVisible,
  onOpen,
}: {
  handleRef: React.MutableRefObject<ScheduleFeedHandle | null>;
  active: boolean;
  diveFreeze: boolean;
  today: Date;
  selected: string;
  all: Snippet[] | undefined;
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
  // First paint renders only a screenful of recent days; the rest of the history
  // mounts a frame later, off the critical path — so opening the book costs a
  // constant ~screenful no matter how many years it holds. The book opens at the
  // foot (today), so the recent days ARE what's on screen. Skipped for a deep-link
  // to an old day, which must render in full to be scrolled to.
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

  // the rows actually rendered on first paint: only the most recent FIRST_PAINT_DAYS
  // (the book opens at the foot/today, so these are what's visible) until the full
  // book mounts a frame later. A deep-link to a past day renders the whole ledger
  // so its row exists to land on.
  const FIRST_PAINT_DAYS = 35;
  const windowRows = useMemo(() => {
    if (!rows) return rows;
    if (fullBook || selected !== todayKey || rows.length <= FIRST_PAINT_DAYS)
      return rows;
    return rows.slice(-FIRST_PAINT_DAYS);
  }, [rows, fullBook, selected, todayKey]);

  const scrollToRow = useCallback((day: string, smooth = false) => {
    const el = scrollerRef.current;
    const row = rowRefs.current.get(day);
    if (!el) return false;
    // any new scroll cancels a still-pending land-on-today re-assert/hold; this
    // is a deliberate (programmatic) landing, so we own the scroll again until
    // the reader next grabs it
    todaySettleRef.current.forEach(clearTimeout);
    todaySettleRef.current = [];
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
      const pinFoot = (behavior: ScrollBehavior) => {
        const s = scrollerRef.current;
        if (!s) return;
        const sec = rowRefs.current.get(todayKey);
        if (sec && !sec.querySelector("[data-entry]")) {
          const delta =
            sec.getBoundingClientRect().top - s.getBoundingClientRect().top;
          if (Math.abs(delta) > 1) s.scrollBy({ top: delta, behavior });
        } else if (Math.abs(s.scrollTop - (s.scrollHeight - s.clientHeight)) > 1) {
          s.scrollTo({ top: s.scrollHeight, behavior });
        }
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
        setTimeout(() => { if (!tookOverRef.current) pinFoot("instant"); }, 560),
        setTimeout(() => { if (!tookOverRef.current) pinFoot("instant"); }, 920),
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
  // off the critical path — a frame later, as a low-priority transition
  useEffect(() => {
    if (fullBook || !rows) return;
    const id = requestAnimationFrame(() =>
      startTransition(() => setFullBook(true)),
    );
    return () => cancelAnimationFrame(id);
  }, [fullBook, rows]);

  // the rest of the history mounts ABOVE today, growing the scroll height; with
  // overflow-anchor off that would shove today off-screen, so re-pin to the foot
  // in the same commit (a layout effect, before paint — no visible jump). Skip if
  // the reader has already grabbed the scroll, so the mount doesn't yank them.
  useLayoutEffect(() => {
    if (!fullBook || selected !== todayKey || tookOverRef.current) return;
    measureRows();
    scrollToRow(todayKey);
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
                <div className={cn("book-margin-date sticky top-0 self-start text-center", !hideToday && "pb-2.5 pt-2.5")}>
                  {!hideToday && (() => {
                    const dateInner = (
                      <>
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
                      </>
                    );
                    // today's date sticky-header populates as the first entry
                    // arrives — wipe it in from the left to lead the kept card,
                    // but ONLY on a fresh keep (todayJustKept), never on a page
                    // refresh; fast (the first fifth of the sweep) so date+card
                    // read as one sweep across the row
                    return isToday ? (
                      <motion.div
                        initial={todayJustKept ? { opacity: 0, clipPath: "inset(0 100% 0 0)" } : false}
                        animate={{ opacity: 1, clipPath: "inset(0 0% 0 0)" }}
                        transition={{ duration: 0.1, ease: "easeInOut" }}
                      >
                        {dateInner}
                      </motion.div>
                    ) : (
                      dateInner
                    );
                  })()}
                </div>
                <div className={cn("min-w-0", !hideToday && "pb-2.5 pt-2.5")}>
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
            {last ? (
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
    [windowRows, probe, todayKey, yesterdayKey, onOpen, today, todayJustKept, bookEmpty, scrollToNewEntry, active],
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
        className="relative h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
        style={{ scrollbarWidth: "none" }}
        tabIndex={-1}
      >
        {/* until the live query returns, `body` is undefined — keep the ruled
            paper showing (same rows as the SSR skeleton) so the wait reads as a
            continuous "settling in", never a blank gap that then pops */}
        {body ?? <LedgerRows />}
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
  const sweepBirth = {
    initial: { opacity: 0, clipPath: "inset(0 100% 0 0)" },
    animate: { opacity: 1, clipPath: "inset(0 0% 0 0)" },
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
            <button
              type="button"
              data-entry={s.id}
              onClick={() => onOpen(s.id)}
              // isolate: the card's ink multiplies into its own opaque
              // paper (the texture is occluded), so the blend is constant
              // — isolating it lets the browser bake it once and translate
              // on scroll instead of re-blending the prose every frame
              // against the fixed sheet (the book's scroll-start jank)
              className={cn(
                "book-card pressable isolate block w-full rounded-[6px] border border-rule-faint bg-paper p-2.5 text-left",
                "shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] hover:bg-paper-raised",
              )}
            >
              <p
                className={cn(
                  "book-card-prose voice-prose line-clamp-6 whitespace-pre-wrap text-[0.9rem] leading-[1.42]",
                  s.kind === "quote" && "hang-quotes italic",
                )}
              >
                {s.text}
              </p>
            </button>
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
      enriched: "pending",
      updatedAt: capturedAt,
    });
    void addSnippet({ id, text: trimmed, source: "typed", capturedAt }).then(enrichSnippet);
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
    <div className={cn("relative", follows && "mt-1")}>
      {/* the composer — present at rest and after a keep, GONE during the press
          so today shows only the stamp. Its return wipes in from the left as a
          single already-laid-out line (clip-path reveal — no re-wrapping), slow
          on purpose (a once-or-twice-a-day beat). */}
      {composerOpen && (
        <motion.div
          initial={seq.phase === "composing" ? { clipPath: "inset(0 100% 0 0)" } : false}
          animate={{ clipPath: "inset(0 0 0 0)" }}
          transition={{ duration: KEEP_BEATS.composeMs / 1000, ease: [0.23, 1, 0.32, 1] }}
          className="group relative"
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-[6px] border border-rule-faint bg-paper shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] transition-colors duration-150 [-webkit-mask-image:linear-gradient(to_right,black_35%,transparent_92%)] [mask-image:linear-gradient(to_right,black_35%,transparent_92%)] group-focus-within:border-rule"
          />
          <span
            aria-hidden="true"
            className={cn(
              "pointer-events-none absolute inset-0 rounded-[6px] border bg-paper shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] transition-opacity duration-150",
              "border-rule-faint group-focus-within:border-rule",
              text.length > 0 ? "opacity-100" : "opacity-0",
            )}
          />
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
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                keep();
              }
            }}
            className={cn(
              "voice-prose relative block w-full resize-none overflow-hidden bg-transparent p-2.5 text-[0.9rem] leading-[1.42] outline-none placeholder:italic",
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
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const d = dateFromDayKey(day);
  const frozen = phase !== "idle";
  // the quill appears only once there's a real character typed (not on focus),
  // and stays through the keep
  const hasText = text.length > 0;
  const quill = hasText || frozen; // which glyph the seal wears + presses
  useEffect(() => clearTimers, []);

  // Tail anchoring: as the entry grows, the seal button and the last line must
  // appear to STAY PUT while the text extends UPWARD — older lines climb past
  // the top, the whole entry stays readable on the page, and nothing is ever
  // added below the zone. Two mechanisms:
  //  1. While the zone still has centring slack, the field's growth is MIRRORED
  //     as empty space below the seal (the tail spacer): +G above, +G below, so
  //     the centred block's midpoint — the seal and the last line — stays put.
  //  2. When the mirror reaches the zone's rest size, the SPACER freezes at the
  //     rest bottom-slack (so below the seal always looks exactly like rest) and
  //     the zone grows with the words — while the book scroller stays pinned to
  //     its foot. Max-scroll grows 1:1 with the zone, so the pin always lands:
  //     the zone bottom, seal, and caret line hold still and the growth has
  //     nowhere to go but up. No bottom padding, no space below the zone, ever.
  // (The generic keyboard-room hook ignores this field — see use-keyboard-room.)
  const REST_FIELD = 81; // 3 lines at 27px — the resting height, before growth
  const zoneRestH = useRef<number | null>(null);
  const spacerMax = useRef<number | null>(null); // the rest bottom-slack, learned at first overflow
  const tailSpacerRef = useRef<HTMLDivElement>(null);
  const anchorTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const scrollerOf = () =>
    btnRef.current?.closest<HTMLElement>("[data-book-scroller]") ?? null;
  const anchorTail = () => {
    const btn = btnRef.current, area = areaRef.current, sp = tailSpacerRef.current;
    if (!btn || !area || !sp) return;
    const box = btn.closest<HTMLElement>("[data-today-zone-box]");
    const g = Math.max(0, area.offsetHeight - REST_FIELD); // how far the field grew
    if (g === 0) {
      // at rest (≤3 lines): nothing to mirror; remember the zone's rest size so
      // we can tell the moment the mirror reaches it, and re-learn the slack
      sp.style.height = "";
      spacerMax.current = null;
      if (box) zoneRestH.current = box.getBoundingClientRect().height;
      return;
    }
    sp.style.height = `${spacerMax.current != null ? Math.min(g, spacerMax.current) : g}px`;
    if (spacerMax.current == null && box && zoneRestH.current != null) {
      const over = box.getBoundingClientRect().height - zoneRestH.current;
      if (over > 0) {
        // the mirror just reached the zone's rest size — freeze the spacer at
        // the exact remaining slack (the overflow splits evenly between the
        // field and its mirror, hence over/2), so the gap under the seal stays
        // precisely the rest gap from here on
        spacerMax.current = Math.max(0, g - over / 2);
        sp.style.height = `${spacerMax.current}px`;
      }
    }
    // pin the book to its foot: any further growth then extends UPWARD (the
    // zone bottom, seal, and caret line stay put; older lines climb past the
    // top, where the page scrolls to read them)
    const sc = scrollerOf();
    if (sc) sc.scrollTop = sc.scrollHeight - sc.clientHeight;
  };
  const clearAnchorTimers = () => { anchorTimers.current.forEach(clearTimeout); anchorTimers.current = []; };
  // FOCUS: re-run across the keyboard's rise (~300ms) — the passes only size the
  // spacer against the settled layout.
  const scheduleAnchor = () => {
    anchorTail();
    requestAnimationFrame(anchorTail);
    clearAnchorTimers();
    anchorTimers.current = [80, 200, 360].map((ms) => setTimeout(anchorTail, ms));
  };
  const releaseTail = () => {
    clearAnchorTimers();
    // at rest the entry reads as normal paper: drop the spacer so the words fill
    // the zone naturally. NOT during a keep — the lead blurs the field
    // mid-animation and the zone must hold its shape through the sweep (the
    // fresh generation mounts clean anyway).
    if (!keeping.current && tailSpacerRef.current) tailSpacerRef.current.style.height = "";
  };
  useEffect(() => releaseTail, []); // eslint-disable-line react-hooks/exhaustive-deps

  // press timeline (sequential): lead (dismiss keyboard + scroll), play the
  // press, hold the settled seal a beat, then the keep animation in order.
  const LEAD_MS = 380;
  const HOLD_MS = 1450;
  const EXIT_MS = 560;  // sweep step 1: the zone slides off right
  const ENTRY_MS = 560; // sweep step 2: the entry wipes into the schedule

  const submit = () => {
    if (!hasText) {
      areaRef.current?.focus(); // mic: begin the entry (voice capture is a TODO)
      return;
    }
    if (phase !== "idle") return; // a keep is already running (idempotent)
    keeping.current = true; // synchronous mirror for the pointer handlers
    const t = text.trim();
    const capturedAt = Date.now();
    const id = ulid(); // creation-order id (today: same as capturedAt)
    const file = () => {
      draft?.set({
        id, text: t, kind: null, tags: [], capturedAt, day,
        source: "typed", favorite: 0, enriched: "pending", updatedAt: capturedAt,
      });
      void addSnippet({ id, text: t, source: "typed", capturedAt }).then(enrichSnippet);
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
      releaseTail();
    });
  };

  // the zone's hairline blue outline (wax = recording)
  const frame = "border border-wax/45";

  return (
    // each generation is one element: the old zone slides off the right while a
    // fresh one fades + floats in to take its place.
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={gen}
        // when a rule sits above the zone (today empty, prior days present), set
        // the gap from the rule to the zone's top edge equal to the "chin" — the
        // space below the scroller, from its bottom down to the sheet's bottom
        // (~26px). The 1px short is the rule's own hairline sitting in that gap.
        // Otherwise no rule, so just a hair of breathing room above and the tuned
        // sliver below (keeps the foot rule's border handoff crisp at rest).
        className={cn(
          "relative flex w-full flex-col",
          !hasEntry && !firstEver ? "pt-[25px] mb-[3px]" : "pt-1 mb-[3px]",
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
            "relative flex min-h-[22rem] w-full flex-1 flex-col rounded-2xl",
            frame,
          )}
        >
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-6 text-center">
          {/* today's date, in the Today-page voice */}
          <div className="leading-none">
            <p className="voice-label text-[0.72rem] text-ink-faint">{format(d, "EEEE")}</p>
            <h2 className="voice-display mt-1 text-[2rem] leading-none text-ink">{format(d, "MMMM d")}</h2>
          </div>

          {/* the ruled "paper" — the clickable entry; 4/5 wide so the prompt
              sits on one line */}
          <div className="relative w-4/5 min-w-[14rem] max-w-2xl">
            <textarea
              ref={areaRef}
              value={text}
              rows={3}
              readOnly={frozen}
              // this field anchors its own tail (see anchorTail); the generic
              // keyboard-room hook skips fields marked data-room-center
              data-room-center=""
              // grow the field, then re-anchor ONCE, synchronously in this same
              // turn — deferred passes each moved layout across several painted
              // frames, which read as the viewport bouncing before settling
              onChange={(e) => { setText(e.target.value); autosizeArea(e.target); anchorTail(); }}
              onFocus={scheduleAnchor}
              onBlur={releaseTail}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(); } }}
              placeholder={
                firstEver
                  ? copy.todayZone.placeholderFirstEver
                  : hasEntry
                    ? copy.todayZone.placeholderHasEntry
                    : copy.todayZone.placeholder
              }
              aria-label={copy.todayZone.ariaWriteFor(format(d, "MMMM d"))}
              className="voice-prose relative block w-full resize-none overflow-hidden bg-transparent p-0 text-left text-[0.95rem] outline-none placeholder:italic placeholder:text-ink-faint"
              // The ruled paper lives ON the textarea (background-attachment:
              // local, so the rules always track the words exactly). The rule
              // sits just below the baseline — standard characters rest ON the
              // line, only descenders dip across — and the period is a whole
              // PIXEL (27px) matched exactly by the line-height: fractional
              // values (1.7rem = 27.2px) let WebKit snap line boxes to device
              // pixels while the gradient stayed fractional, so text drifted
              // off its rules over dozens of lines.
              style={{
                lineHeight: "27px",
                minHeight: "81px",
                backgroundImage:
                  "repeating-linear-gradient(to bottom, transparent 0, transparent 26px, var(--rule-faint) 26px, var(--rule-faint) 27px)",
                backgroundPositionY: "-6px",
                backgroundAttachment: "local",
              }}
            />
          </div>

          {/* the wax button — mic at rest, quill once typing starts; the whole
              button cross-slides (left↔right carousel) on the swap. press it to
              submit (plays the corner·swell keep) */}
          <button
            ref={btnRef}
            type="button"
            aria-label={hasText ? copy.todayZone.keepEntry : copy.todayZone.speakEntry}
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
              // released on the button: keep it (submit hands the press to
              // holdDown) or, with no text, focus to begin. Released off: cancel
              // — ease the seal back, no submit.
              if (inside) submit();
              if (!inside || !hasText) sealCtl.current?.press(false);
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
            className="relative grid place-items-center rounded-full"
            style={{ width: 128, height: 128 }}
          >
            <AnimatePresence initial={false}>
              <motion.span
                key={quill ? "quill" : "mic"}
                className="absolute inset-0 grid place-items-center"
                initial={{ x: "70%", opacity: 0 }}
                animate={{ x: "0%", opacity: 1 }}
                exit={{ x: "-70%", opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              >
                <CanvasSeal
                  playKey={playKey}
                  size={128}
                  glyph={quill ? "e:quill" : "c:mic"}
                  iconScale={quill ? 0.36 : 0.46}
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
          </button>

          {/* tail spacer: mirrors the field's growth below the seal so the
              centred composition's midpoint (and thus the seal + last line)
              stays put as the entry grows — see anchorTail. -mt-4 cancels the
              column gap so at rest (height 0) it adds nothing and the empty
              composition is unchanged. */}
          <div ref={tailSpacerRef} aria-hidden className="-mt-4 w-px shrink-0" />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
