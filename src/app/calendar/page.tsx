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
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isAfter,
  isSameDay,
  isSameMonth,
  startOfMonth,
} from "date-fns";
import { AnimatePresence, motion, animate, useReducedMotion } from "motion/react";
import { highlight as drawHighlight } from "@highlighters/core";
import { toast } from "sonner";
import { SnippetEntry } from "@/components/snippet/snippet-entry";
import { ulid } from "ulidx";
import { WaxStamp as CanvasSeal } from "@/components/capture/wax-stamp";
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
  updateSnippet,
} from "@/lib/db";
import { enrichSnippet } from "@/lib/enrich";
import { dayKey, dateFromDayKey, friendlyDay } from "@/lib/dates";
import { copy } from "@/lib/copy";
import type { Snippet } from "@/lib/types";
import { useSettings } from "@/lib/settings";
import { allOccurrences, queryTerms } from "@/lib/search";
import { cn } from "@/lib/utils";
import {
  useScrollEdges,
  ScrollTerminus,
} from "@/components/ui/scroll-terminus";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]; // Sunday-first labels
/** the weekday labels rotated to the chosen first day of the week. */
function weekdays(weekStart: 0 | 1): string[] {
  return weekStart === 1 ? [...WEEKDAYS.slice(1), WEEKDAYS[0]] : WEEKDAYS;
}
/** columns (0–6) from the week's first day to `date`'s own weekday. */
function leadOffset(date: Date, weekStart: 0 | 1): number {
  return (getDay(date) - weekStart + 7) % 7;
}
const ringSpring = { type: "spring", stiffness: 380, damping: 30 } as const;
const ym = (d: Date) => format(d, "yyyy-MM");

/* ── feed geometry: decades of time, computed, never reflowed ──────
   The feeds are virtualized over arithmetic offsets inside one
   fixed-height spacer. Nothing is ever inserted above the reader and
   scrollTop is never written during a gesture — the recording showed
   iOS killing fling momentum the instant the old windowed feed
   compensated scroll positions mid-flight. */

const YEAR_GAP = 24; // between year blocks
const MINI_GAP = 8; // gap-2 between minis
const MINI_DOT = 3;

/** The canvas alone reaches into the deep archive — back to January
    1950, far enough for any living writer's earliest pages. The
    glance never volunteers those years; the effort of scrolling there
    scales with the unlikelihood of needing to. */
const ARCHIVE_YEAR = 1950;

function monthRows(m: Date, weekStart: 0 | 1): number {
  return Math.ceil((leadOffset(m, weekStart) + endOfMonth(m).getDate()) / 7);
}

/** Stand a scroller on its true bottom. The archive spacer is a
    quarter-million pixels tall and the engine shaves a fraction off a
    box that size, so the geometric bottom sits just past the real one.
    A write there is honored until the next rendering update — forced
    reflows don't re-clamp it — then snaps back a whole pixel, under a
    flight that already measured its landing. The spacer's rendered
    height IS readable synchronously, so stand on its painted pixel:
    a position the engine never takes back. */
function settleBottom(scroller: HTMLElement, spacer: HTMLElement) {
  scroller.scrollTop = Math.floor(spacer.getBoundingClientRect().height);
}

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

interface MonthGeom {
  months: Date[];
  /** top of each month's label row */
  offsets: number[];
  /** scroll position at which each month takes the title — the moment
      the previous month's final row-line fully overlaps the hairline
      under the weekday rail */
  switchY: number[];
  total: number;
  cell: number;
  labelRowH: number;
}

function buildMonthGeom(
  width: number,
  labelRowH: number,
  currentMonth: Date,
  span: number,
  weekStart: 0 | 1,
): MonthGeom {
  const cell = width / 7;
  const months: Date[] = [];
  const offsets: number[] = [];
  const switchY: number[] = [];
  let y = 0;
  for (let i = span - 1; i >= 0; i--) {
    const m = startOfMonth(addMonths(currentMonth, -i));
    months.push(m);
    offsets.push(y);
    // +1: at y − cell the row's top rule merely touches the rail's
    // hairline from below; the two 1px lines coincide one pixel later
    switchY.push(y === 0 ? 0 : y - cell + 1);
    y += labelRowH + monthRows(m, weekStart) * cell;
  }
  return { months, offsets, switchY, total: y + 24, cell, labelRowH };
}

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

/** last index whose offset is at or before y */
function indexAt(offsets: number[], y: number): number {
  let lo = 0,
    hi = offsets.length - 1,
    ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= y) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

// A calm placeholder painted on the SERVER (the Suspense fallback is SSR'd),
// so the ledger's frame and rules show the instant the HTML lands instead of a
// blank sheet — the real book (client-only, behind useSearchParams) settles onto
// it a beat later. No spinner; just the ruled paper waiting.
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
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="grid grid-cols-[2.1rem_1fr] gap-x-2 border-t border-rule-faint pb-2.5 pt-2.5"
          >
            <div />
            <div className="h-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<CalendarSkeleton />}>
      <Calendar />
    </Suspense>
  );
}

type View = "year" | "month" | "schedule" | "entry";
/** altitude order: a zoom to a deeper view dives in, shallower pulls back */
const DEPTH: Record<View, number> = { year: 0, month: 1, schedule: 2, entry: 3 };

interface MonthFeedHandle {
  goTo: (m: Date, smooth: boolean) => void;
  /** center + width of a day's cell, relative to the layer viewport */
  originFor: (day: string) => { x: number; y: number; w: number } | null;
}
interface ScheduleFeedHandle {
  goTo: (day: string, smooth?: boolean) => void;
}
interface YearFeedHandle {
  goTo: (y: number, smooth: boolean) => void;
  /** center + width of a month's mini, relative to the layer viewport */
  originFor: (ymKey: string) => { x: number; y: number; w: number } | null;
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

  // The book is the app's home: with no deep link, land in today's schedule
  // (the fill zone at its foot is the capture surface) rather than the month
  // grid — which is a zoom-out away. A valid ?d= still opens straight to its
  // day, and ?d=…&e= straight to an entry.
  const [view, setView] = useState<View>(() => {
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
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(dateFromDayKey(initialDay)),
  );
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

  // every dive is a real history entry, so the browser's own back —
  // the iOS edge swipe included — pops one altitude instead of leaving
  // the page. Arriving deep, synthesize the stack beneath so back
  // always has a floor.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const d = sp.get("d");
    const e = sp.get("e");
    if (d) {
      window.history.replaceState(null, "", pathname);
      window.history.pushState(null, "", `${pathname}?d=${d}`);
      if (e) window.history.pushState(null, "", `${pathname}?d=${d}&e=${e}`);
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
      flyerBox?.remove();
      for (const el of hiddenNumbers) el.style.visibility = "";
      deleteCloseRef.current = false;
      setDeletingSnippet(null);
      setZoom(null);
      zooming.current = false;
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
      flyerBox.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:30;";
      stage.appendChild(flyerBox);
      return flyerBox;
    };

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

  const openYear = () => {
    const y = visibleMonth.getFullYear();
    setVisibleYear(y);
    yearFeedRef.current?.goTo(y, false); // stand on the year before measuring
    runZoom("month", "year", ym(visibleMonth));
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
    if (cur === "year") {
      pickMonth(startOfMonth(visibleMonthRef.current));
      return;
    }
    homeward.current = true;
    window.history.back();
  }, [pickMonth]);

  useEffect(() => {
    const onHome = () => goToCanvas();
    window.addEventListener("calendar:home", onHome);
    return () => window.removeEventListener("calendar:home", onHome);
  }, [goToCanvas]);

  useEffect(() => {
    if (!homeward.current || zoom) return; // let each zoom settle first
    if (view === "month") homeward.current = false; // arrived
    else if (view === "schedule") window.history.back(); // book → canvas
  }, [view, zoom]);

  /* climbing out happens through the history stack: UI back affordances
     call history.back(), and the popstate handler runs the zoom — so the
     browser's own back gesture and ours are the same action */

  const descendFromSchedule = useCallback(() => {
    // stand the canvas on the month being read before pulling back
    const m = startOfMonth(dateFromDayKey(selectedRef.current));
    setVisibleMonth(m);
    setVisibleYear(m.getFullYear());
    monthFeedRef.current?.goTo(m, false);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    runZoom("schedule", "month", selectedRef.current);
  }, [runZoom]);

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
          : "month";
      const cur = viewRef.current;
      if (target === cur) return;
      if (DEPTH[target] < DEPTH[cur]) {
        if (cur === "entry") descendFromEntry();
        else if (cur === "schedule") descendFromSchedule();
      } else {
        // the forward gesture re-dives
        const d = sp.get("d");
        const e = sp.get("e");
        if (cur === "month" && d) {
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
  }, [descendFromEntry, descendFromSchedule, runZoom]);

  const closeSchedule = () => window.history.back();

  /** pressing a card dives the camera one altitude further, into it */
  const openEntry = useCallback(
    (id: string) => {
      navigator.vibrate?.(6);
      setFocusedId(id);
      // stand the header on the entry's own day so the month + year in
      // it hold still while the weekday and date wipe in
      const s = all?.find((x) => x.id === id);
      if (s) {
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

  const closeEntry = () => window.history.back();

  // letting an entry go: mark the close as a deletion (so the zoom dissolves
  // the card rather than shrinking it back to a slot that's about to vanish),
  // soft-delete, then close over the struck line with an undo toast.
  const letGo = useCallback(
    async (snippet: Snippet) => {
      deleteCloseRef.current = true; // the next close is a deletion → dissolve
      setDeletingSnippet(snippet); // hold the words through the leave animation
      await softDeleteSnippet(snippet.id);
      window.history.back();
      toast(copy.deleteEntry.toast, {
        action: { label: copy.deleteEntry.undo, onClick: () => void restoreSnippet(snippet.id) },
      });
    },
    [],
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
    setSelected(dayKey());
    if (view === "entry") {
      // pop to the book (the handler runs the zoom), then turn it
      window.history.back();
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
              onPickMonth={pickMonth}
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

/* ── the month feed ─────────────────────────────────────────────── */

function MonthFeedBase({
  handleRef,
  active,
  today,
  span,
  counts,
  selected,
  onPick,
  onVisible,
}: {
  handleRef: React.MutableRefObject<MonthFeedHandle | null>;
  active: boolean;
  today: Date;
  /** how many months the canvas reaches back (shared with the glance) */
  span: number;
  counts: Map<string, number> | undefined;
  selected: string;
  onPick: (key: string) => void;
  onVisible: (m: Date) => void;
  /** fully hidden (not this altitude, not in a zoom) — memo skips
      re-renders while frozen, so a book scroll never re-renders the
      invisible canvas; it re-renders the moment it's shown again */
  frozen?: boolean;
}) {
  const currentMonth = startOfMonth(today);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const [metrics, setMetrics] = useState<{ w: number; h: number; labelH: number } | null>(null);
  const [scrollY, setScrollY] = useState<number | null>(null);
  const visibleIdxRef = useRef(-1);
  const anchorMonthRef = useRef<Date | null>(null);
  const rafRef = useRef(0);
  const didInit = useRef(false);
  // a programmatic smooth scroll (Today, stepping) owns the title: the
  // press already chose the destination, so the months scrolled PAST
  // must not each claim the header and flicker against it
  const progTargetRef = useRef<number | null>(null);
  const progTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const weekStart = useSettings().weekStart;
  const geom = useMemo(
    () =>
      // the hand-over row is barely taller than its text: the label's
      // line box plus 4px of air above and 4px down to the rule
      metrics
        ? buildMonthGeom(metrics.w, metrics.labelH + 8, currentMonth, span, weekStart)
        : null,
    // geometry depends on width, label height, the span, and the week
    // start (a Monday start can add a row to some months); currentMonth is
    // stable, and a viewport-height blip must not rebuild it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics?.w, metrics?.labelH, span, weekStart],
  );
  const geomRef = useRef<MonthGeom | null>(null);
  useLayoutEffect(() => {
    geomRef.current = geom;
  }, [geom]);

  const indexOfMonth = useCallback(
    (m: Date) => {
      const diff = monthsBetween(m, currentMonth);
      return Math.min(span - 1, Math.max(0, span - 1 - diff));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [span],
  );

  // measure once + on resize; ResizeObserver callbacks are async-safe
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const labelH = probeRef.current?.offsetHeight ?? 14;
      if (w === 0) return;
      setMetrics((prev) =>
        prev && prev.w === w && prev.h === h && prev.labelH === labelH
          ? prev
          : { w, h, labelH },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // position the camera only once the spacer is in the DOM — a scrollTop
  // written any earlier clamps to 0 and the feed opens ten years back.
  // Re-runs (geometry rebuilt by a real resize) re-anchor the month the
  // reader was on so the new offsets don't drift them through time.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !geom) return;
    if (!didInit.current) {
      didInit.current = true;
      const idx = indexOfMonth(startOfMonth(dateFromDayKey(selected)));
      // seed the anchor too: fonts/scrollbars can rebuild geometry before
      // the first scroll event lands, and that rebuild must re-anchor
      visibleIdxRef.current = idx;
      anchorMonthRef.current = geom.months[idx];
      if (idx === geom.offsets.length - 1 && spacerRef.current)
        settleBottom(el, spacerRef.current);
      else el.scrollTop = geom.offsets[idx];
    } else if (anchorMonthRef.current) {
      // re-anchor by MONTH, not index: a span change (history loading
      // in) prepends months and shifts every index
      const idx = indexOfMonth(anchorMonthRef.current);
      visibleIdxRef.current = idx;
      if (idx === geom.offsets.length - 1 && spacerRef.current)
        settleBottom(el, spacerRef.current);
      else el.scrollTop = geom.offsets[idx];
    }
    // `selected` only seeds the very first position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, indexOfMonth]);

  const goTo = useCallback(
    (m: Date, smooth: boolean) => {
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return;
      const idx = indexOfMonth(startOfMonth(m));
      const top = g.offsets[idx];
      setScrollY(top); // window renders the destination immediately
      anchorMonthRef.current = g.months[idx];
      if (smooth) {
        // hold the title on the destination until the scroll lands
        visibleIdxRef.current = idx;
        progTargetRef.current = top;
        if (progTimerRef.current) clearTimeout(progTimerRef.current);
        progTimerRef.current = setTimeout(() => {
          progTargetRef.current = null;
        }, 800);
        el.scrollTo({ top, behavior: "smooth" });
      } else {
        visibleIdxRef.current = -1;
        if (idx === g.offsets.length - 1 && spacerRef.current)
          settleBottom(el, spacerRef.current);
        else el.scrollTo({ top, behavior: "instant" });
      }
    },
    [indexOfMonth, setScrollY],
  );
  const originFor = useCallback(
    (day: string) => {
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return null;
      const d = dateFromDayKey(day);
      const mi = indexOfMonth(startOfMonth(d));
      const m = g.months[mi];
      if (!m || !isSameMonth(d, m)) return null;
      const idx = getDay(m) + d.getDate() - 1;
      return {
        x: (idx % 7) * g.cell + g.cell / 2,
        y:
          g.offsets[mi] +
          g.labelRowH +
          Math.floor(idx / 7) * g.cell +
          g.cell / 2 -
          el.scrollTop,
        w: g.cell,
      };
    },
    [indexOfMonth],
  );
  useLayoutEffect(() => {
    handleRef.current = { goTo, originFor };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, goTo, originFor]);

  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return;
      const top = el.scrollTop;
      // re-render the window only when the reader has moved meaningfully
      setScrollY((prev) =>
        prev === null || Math.abs(prev - top) > (metrics?.h ?? 400) / 3
          ? top
          : prev,
      );
      if (progTargetRef.current !== null) {
        // a Today/step scroll is animating to its target — let it run
        // the window, but don't let the passed months touch the title
        if (Math.abs(top - progTargetRef.current) < 4) {
          progTargetRef.current = null;
          if (progTimerRef.current) clearTimeout(progTimerRef.current);
        }
        return;
      }
      const vi = indexAt(g.switchY, top);
      if (vi !== visibleIdxRef.current) {
        visibleIdxRef.current = vi;
        anchorMonthRef.current = g.months[vi];
        onVisible(g.months[vi]);
      }
    });
  };

  const viewH = metrics?.h ?? 400;
  // until the first scroll lands, the window hangs on the selected month
  const anchorY =
    scrollY ??
    (geom
      ? geom.offsets[indexOfMonth(startOfMonth(dateFromDayKey(selected)))]
      : 0);
  const from = geom ? indexAt(geom.offsets, anchorY - viewH) : 0;
  const to = geom ? indexAt(geom.offsets, anchorY + 2 * viewH) : 0;

  // the ring lives on the canvas itself, outside every month block: it
  // can spring across month boundaries and never remounts with the
  // render window
  const ring = (() => {
    if (!geom) return null;
    const d = dateFromDayKey(selected);
    const mi = indexOfMonth(startOfMonth(d));
    const m = geom.months[mi];
    if (!m || !isSameMonth(d, m)) return null;
    const idx = getDay(m) + d.getDate() - 1;
    return {
      x: (idx % 7) * geom.cell + 3,
      // the top rule lives inside the cell's first pixel while the
      // bottom rule belongs to the row below — centred between the
      // visible lines sits 0.5px lower than centred in the box
      y:
        geom.offsets[mi] +
        geom.labelRowH +
        Math.floor(idx / 7) * geom.cell +
        3.5,
    };
  })();

  const edges = useScrollEdges(scrollerRef, [span, metrics?.h]);

  return (
    <div
      ref={scrollerRef}
      onScroll={active ? onScroll : undefined}
      className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      style={{ scrollbarWidth: "none" }}
      tabIndex={-1}
    >
      <p
        ref={probeRef}
        aria-hidden="true"
        className="voice-label invisible absolute text-[0.82rem]"
      >
        June 2026
      </p>
      {geom && (
        // the floor is laid out, not measured: blocks live in a px-high
        // container up to the last offset, and a min-h-full tail keeps
        // one viewport of room below it IN THE SAME LAYOUT PASS as any
        // stage resize — a mid-zoom rail collapse can no longer clamp
        // the scroller and drift the flights' landing targets
        <div
          ref={spacerRef}
          className="relative"
          style={{ height: geom.offsets[geom.offsets.length - 1] }}
        >
          {ring && (
            <motion.span
              aria-hidden="true"
              initial={false}
              animate={{ x: ring.x, y: ring.y }}
              transition={ringSpring}
              className="pointer-events-none absolute left-0 top-0 z-10 rounded-[5px] border-[1.5px] border-wax bg-wax/5 shadow-[inset_0_1px_2px_rgb(var(--shadow-hue)/0.06)]"
              style={{ width: geom.cell - 6, height: geom.cell - 6 }}
            />
          )}
          {geom.months.slice(from, to + 1).map((m, k) => (
            <div
              key={ym(m)}
              data-month={ym(m)}
              className="absolute inset-x-0"
              style={{ top: geom.offsets[from + k] }}
            >
              <MonthBlock
                month={m}
                cell={geom.cell}
                labelRowH={geom.labelRowH}
                today={today}
                counts={counts}
                // scoped to its own month, so the book's scroll spy
                // (selection churning day by day) re-renders at most
                // the two blocks that actually change
                selected={
                  isSameMonth(dateFromDayKey(selected), m) ? selected : ""
                }
                onPick={onPick}
              />
            </div>
          ))}
        </div>
      )}
      {geom && (
        <div
          aria-hidden="true"
          className="min-h-full"
          style={{
            height: geom.total - geom.offsets[geom.offsets.length - 1],
          }}
        />
      )}
      <ScrollTerminus show={edges.bottom} />
    </div>
  );
}
const MonthFeed = memo(
  MonthFeedBase,
  (p, n) => p.frozen === true && n.frozen === true,
);

const MonthBlock = memo(function MonthBlock({
  month,
  cell,
  labelRowH,
  today,
  counts,
  selected,
  onPick,
}: {
  month: Date;
  cell: number;
  labelRowH: number;
  today: Date;
  counts: Map<string, number> | undefined;
  /** the selected day when it lives in this month, else "" */
  selected: string;
  onPick: (key: string) => void;
}) {
  const weekStart = useSettings().weekStart;
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const leadingBlanks = leadOffset(month, weekStart);
  const trailingBlanks = (7 - ((leadingBlanks + days.length) % 7)) % 7;
  const isCurrent = isSameMonth(month, today);

  return (
    <div>
      {/* the hand-over row: only the month's name, standing over its
          first day — the rule beneath it is that day's own top edge */}
      <div className="relative" style={{ height: labelRowH }}>
        <span
          data-flymonth={ym(month)}
          // bottom-[3.25px], not bottom-1: the small-caps have no
          // descenders, so they ride high in the line box; the nudge
          // optically centres the lettering between the rail and the
          // rule rather than centring its (taller) line box
          className={cn(
            "voice-label absolute bottom-[3.25px] text-center text-[0.82rem]",
            isCurrent ? "text-wax" : "text-ink-soft",
          )}
          style={{ left: leadingBlanks * cell, width: cell }}
        >
          {format(month, "MMM")}
        </span>
      </div>
      <div
        role="grid"
        aria-label={format(month, "MMMM yyyy")}
        className="grid grid-cols-7"
      >
        {Array.from({ length: leadingBlanks }).map((_, i) => (
          <span key={`b${i}`} className="aspect-square" aria-hidden="true" />
        ))}
        {days.map((date) => {
          const key = dayKey(date);
          const count = counts?.get(key) ?? 0;
          const isToday = isSameDay(date, today);
          const isFuture = isAfter(date, today);
          return (
            <motion.button
              key={key}
              type="button"
              disabled={isFuture}
              onClick={() => onPick(key)}
              whileTap={isFuture ? undefined : "pressed"}
              aria-label={`${format(date, "MMMM d")}${count ? `, ${count} kept` : ""}`}
              aria-pressed={key === selected}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center gap-1 border-t border-rule-faint",
                !isFuture && "transition-colors duration-150 hover:bg-paper-raised",
                isFuture && "text-ink-faint/40",
              )}
            >
              {/* only the content presses — scaling the whole cell would shrink
                  its top border and sever it from the week's continuous rule */}
              <motion.span
                variants={{ pressed: { scale: 0.9 } }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className="flex flex-col items-center gap-1"
              >
                <span
                  data-flydate={key}
                  className={cn(
                    "relative font-mono text-[0.78rem] tabular-nums",
                    isToday && "font-semibold text-wax",
                  )}
                >
                  {format(date, "d")}
                </span>
                {/* the dot strip is always reserved so numbers sit at the
                    same height whether or not a day has entries yet */}
                <span className="relative flex h-[3.5px] gap-[3px]" aria-hidden="true">
                  {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
                    <span
                      key={i}
                      className="size-[3.5px] rounded-full bg-ink-soft shadow-[0_0.5px_0.5px_rgb(var(--shadow-hue)/0.4)]"
                    />
                  ))}
                </span>
              </motion.span>
            </motion.button>
          );
        })}
        {/* blanks carry no rule, before or after the days: a month's
            lines start at its first day and stop at its last, and the
            voids interlock with the neighbouring label rows */}
        {Array.from({ length: trailingBlanks }).map((_, i) => (
          <span key={`t${i}`} className="aspect-square" aria-hidden="true" />
        ))}
      </div>
    </div>
  );
});

/* ── the year feed: higher altitude, same physics ───────────────── */

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

interface YearGeom {
  years: number[];
  offsets: number[];
  total: number;
  cols: number;
  miniW: number;
  miniH: number;
  labelH: number;
  blockH: number;
}

function buildYearGeom(
  width: number,
  labelH: number,
  miniLabelH: number,
  years: number[],
): YearGeom {
  const cols = typeof window !== "undefined" && window.innerWidth >= 640 ? 4 : 3;
  const rows = 12 / cols;
  const miniW = (width - (cols - 1) * MINI_GAP) / cols;
  // mini: padding 10 ×2 + label + gap-1.5 + fixed six dot-rows + border 2
  const dots = 6 * MINI_DOT + 5 * 3;
  const miniH = 2 + 20 + miniLabelH + 6 + dots;
  const blockH = labelH + rows * miniH + (rows - 1) * MINI_GAP;
  const offsets: number[] = [];
  let y = 0;
  for (let i = 0; i < years.length; i++) {
    offsets.push(y);
    y += blockH + YEAR_GAP;
  }
  return { years, offsets, total: y - YEAR_GAP + 32, cols, miniW, miniH, labelH, blockH };
}

function YearFeedBase({
  handleRef,
  active,
  today,
  years,
  counts,
  onPickMonth,
  onVisible,
}: {
  handleRef: React.MutableRefObject<YearFeedHandle | null>;
  active: boolean;
  today: Date;
  /** the lived years, ascending and ending at today's — gaps of five
      or more dormant years are already folded out of the list */
  years: number[];
  counts: Map<string, number> | undefined;
  onPickMonth: (m: Date) => void;
  onVisible: (y: number) => void;
  /** fully hidden (not this altitude, not in a zoom) — memo skips
      re-renders while frozen, so a book scroll never re-renders the
      invisible glance; it re-renders the moment it's shown again */
  frozen?: boolean;
}) {
  const currentYear = today.getFullYear();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const miniProbeRef = useRef<HTMLSpanElement>(null);
  const [metrics, setMetrics] = useState<{
    w: number;
    h: number;
    labelH: number;
    miniLabelH: number;
  } | null>(null);
  const [scrollY, setScrollY] = useState<number | null>(null);
  const visibleRef = useRef(-1);
  const anchorYearRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const didInit = useRef(false);

  const geom = useMemo(
    () =>
      metrics
        ? buildYearGeom(metrics.w, metrics.labelH, metrics.miniLabelH, years)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics?.w, metrics?.labelH, metrics?.miniLabelH, years],
  );
  const geomRef = useRef<YearGeom | null>(null);
  useLayoutEffect(() => {
    geomRef.current = geom;
  }, [geom]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      const labelH = (probeRef.current?.offsetHeight ?? 14) + 6;
      const miniLabelH = miniProbeRef.current?.offsetHeight ?? 13;
      if (w === 0) return;
      setMetrics((prev) =>
        prev &&
        prev.w === w &&
        prev.h === h &&
        prev.labelH === labelH &&
        prev.miniLabelH === miniLabelH
          ? prev
          : { w, h, labelH, miniLabelH },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // same discipline as the month feed: position only after the spacer
  // is real. Re-anchor by YEAR, not index — the list breathes (a
  // transient year folding away, history loading in) and a breath
  // shifts every index
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !geom) return;
    if (!didInit.current) {
      didInit.current = true;
      const idx = geom.offsets.length - 1;
      visibleRef.current = idx;
      anchorYearRef.current = geom.years[idx];
      el.scrollTop = geom.offsets[idx];
    } else if (anchorYearRef.current != null) {
      const a = anchorYearRef.current;
      let idx = geom.years.indexOf(a);
      if (idx < 0) {
        // the year under the camera folded away — stand on the nearest
        idx = geom.years.reduce(
          (p, c, i) => (Math.abs(c - a) < Math.abs(geom.years[p] - a) ? i : p),
          0,
        );
        anchorYearRef.current = geom.years[idx];
      }
      visibleRef.current = idx;
      el.scrollTop = geom.offsets[idx];
    }
  }, [geom]);

  const goTo = useCallback((y: number, smooth: boolean) => {
    const el = scrollerRef.current;
    const g = geomRef.current;
    if (!el || !g) return;
    const idx = g.years.indexOf(y);
    if (idx < 0) return;
    setScrollY(g.offsets[idx]);
    visibleRef.current = -1;
    anchorYearRef.current = y;
    el.scrollTo({ top: g.offsets[idx], behavior: smooth ? "smooth" : "instant" });
  }, [setScrollY]);
  const originFor = useCallback((ymKey: string) => {
    const el = scrollerRef.current;
    const g = geomRef.current;
    if (!el || !g) return null;
    const [yStr, mStr] = ymKey.split("-");
    const yi = g.years.indexOf(Number(yStr));
    if (yi < 0) return null;
    const mi = Number(mStr) - 1;
    const r = Math.floor(mi / g.cols);
    const c = mi % g.cols;
    return {
      x: c * (g.miniW + MINI_GAP) + g.miniW / 2,
      y:
        g.offsets[yi] +
        g.labelH +
        r * (g.miniH + MINI_GAP) +
        g.miniH / 2 -
        el.scrollTop,
      w: g.miniW,
    };
  }, []);
  useLayoutEffect(() => {
    handleRef.current = { goTo, originFor };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, goTo, originFor]);

  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return;
      const top = el.scrollTop;
      setScrollY((prev) =>
        prev === null || Math.abs(prev - top) > (metrics?.h ?? 400) / 3
          ? top
          : prev,
      );
      const vi = indexAt(g.offsets, top + (metrics?.h ?? 400) * 0.35);
      if (vi !== visibleRef.current) {
        visibleRef.current = vi;
        anchorYearRef.current = g.years[vi];
        onVisible(g.years[vi]);
      }
    });
  };

  const viewH = metrics?.h ?? 400;
  // before any scroll has landed, the window hangs on the current year
  const anchorY = scrollY ?? (geom ? geom.offsets[geom.offsets.length - 1] : 0);
  const from = geom ? indexAt(geom.offsets, anchorY - viewH) : 0;
  const to = geom ? indexAt(geom.offsets, anchorY + 2 * viewH) : 0;

  // the window's dot-grids are thousands of spans — memoized as
  // elements so the page's scroll-spy re-renders bail out wholesale
  const blocks = useMemo(
    () =>
      geom
        ? geom.years.slice(from, to + 1).map((y, k) => (
            <div
              key={y}
              data-year={y}
              className="absolute inset-x-0"
              style={{ top: geom.offsets[from + k] }}
            >
              <p className="voice-label mb-1.5 text-[0.82rem] text-ink-soft">{y}</p>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${geom.cols}, minmax(0, 1fr))`,
                  gap: MINI_GAP,
                }}
              >
                {MONTH_LABELS.map((label, m) => {
                  const start = new Date(y, m, 1);
                  const isFutureMonth = isAfter(start, today);
                  const isCurrent = y === currentYear && m === today.getMonth();
                  return (
                    <motion.button
                      key={ym(start)}
                      data-ym={ym(start)}
                      type="button"
                      disabled={isFutureMonth}
                      onClick={() => onPickMonth(start)}
                      whileTap={isFutureMonth ? undefined : { scale: 0.96 }}
                      className={cn(
                        "pressable flex flex-col gap-1.5 rounded-[6px] border border-rule-faint bg-paper p-2.5 text-left",
                        !isFutureMonth &&
                          "shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] hover:bg-paper-raised",
                        isFutureMonth && "opacity-40",
                      )}
                      aria-label={format(start, "MMMM yyyy")}
                    >
                      <span
                        data-flymonth={ym(start)}
                        className={cn(
                          "voice-label text-[0.8rem]",
                          isCurrent ? "text-wax" : "text-ink-soft",
                        )}
                      >
                        {label}
                      </span>
                      <MiniMonth start={start} today={today} counts={counts} />
                    </motion.button>
                  );
                })}
              </div>
            </div>
          ))
        : null,
    // currentYear rides on `today`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geom, from, to, today, counts, onPickMonth],
  );

  const edges = useScrollEdges(scrollerRef, [years, metrics?.h]);

  return (
    <div
      ref={scrollerRef}
      onScroll={active ? onScroll : undefined}
      className="h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      style={{ scrollbarWidth: "none" }}
      tabIndex={-1}
    >
      <p
        ref={probeRef}
        aria-hidden="true"
        className="voice-label invisible absolute text-[0.82rem]"
      >
        2026
      </p>
      <span
        ref={miniProbeRef}
        aria-hidden="true"
        className="voice-label invisible absolute text-[0.8rem]"
      >
        Jan
      </span>
      {geom && (
        // same layout-synchronous floor as the month feed
        <div
          className="relative"
          style={{ height: geom.offsets[geom.offsets.length - 1] }}
        >
          {blocks}
        </div>
      )}
      {geom && (
        <div
          aria-hidden="true"
          className="min-h-full"
          style={{
            height: geom.total - geom.offsets[geom.offsets.length - 1],
          }}
        />
      )}
      <ScrollTerminus show={edges.bottom} />
    </div>
  );
}

const YearFeed = memo(
  YearFeedBase,
  (p, n) => p.frozen === true && n.frozen === true,
);

/** Twelve tiny constellations: a dot per day, ink where something was
 *  kept. Always six rows so every mini is the same height — the zoom's
 *  geometry depends on it. */
function MiniMonth({
  start,
  today,
  counts,
}: {
  start: Date;
  today: Date;
  counts: Map<string, number> | undefined;
}) {
  const weekStart = useSettings().weekStart;
  const days = eachDayOfInterval({ start, end: endOfMonth(start) });
  const leading = leadOffset(start, weekStart);
  const trailing = 42 - leading - days.length;
  return (
    <span className="grid grid-cols-7 gap-[3px]" aria-hidden="true">
      {Array.from({ length: leading }).map((_, i) => (
        <span key={`b${i}`} className="size-[3px]" />
      ))}
      {days.map((date) => {
        const key = dayKey(date);
        const kept = (counts?.get(key) ?? 0) > 0;
        const isToday = isSameDay(date, today);
        const future = isAfter(date, today);
        return (
          <span
            key={key}
            className={cn(
              "size-[3px] rounded-full",
              isToday
                ? "bg-wax"
                : kept
                  ? "bg-ink-soft"
                  : future
                    ? "bg-transparent"
                    : "bg-rule-faint",
            )}
          />
        );
      })}
      {Array.from({ length: trailing }).map((_, i) => (
        <span key={`a${i}`} className="size-[3px]" />
      ))}
    </span>
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
  today,
  selected,
  all,
  onVisible,
  onOpen,
}: {
  handleRef: React.MutableRefObject<ScheduleFeedHandle | null>;
  active: boolean;
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

  const scrollToRow = useCallback((day: string, smooth = false) => {
    const el = scrollerRef.current;
    const row = rowRefs.current.get(day);
    if (!el) return false;
    // any new scroll cancels a still-pending land-on-today re-assert/hold
    todaySettleRef.current.forEach(clearTimeout);
    todaySettleRef.current = [];
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
        // No-ops unless something shifted the rule, so normally invisible.
        setTimeout(() => pinFoot("instant"), 560),
        setTimeout(() => pinFoot("instant"), 920),
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
      rows?.map((row, i) => {
        const d = dateFromDayKey(row.day);
        const newMonth =
          i === 0 || rows[i - 1].day.slice(0, 7) !== row.day.slice(0, 7);
        const isToday = row.day === todayKey;
        // today always invites; yesterday invites while it's still empty;
        // and the page you opened keeps its composer
        const showComposer =
          isToday ||
          row.day === probe ||
          (row.day === yesterdayKey && row.snippets.length === 0);
        const last = i === rows.length - 1;
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
              // min-height pins one viewport of room below the final
              // row's top — in the same layout pass as any content
              // change, so shrinking rows can never dip scrollHeight
              // and clamp the reader off their page
              <div className="relative flex min-h-full flex-col">
                {pageRow}
                {/* the zone always carries today's big date — even once today
                    also owns a page above — so the composer always names its day */}
                <TodayZoneFill
                  day={todayKey}
                  firstEver={bookEmpty}
                  hasEntry={row.snippets.length > 0}
                  onKept={scrollToNewEntry}
                  className="flex-1"
                />
              </div>
            ) : (
              pageRow
            )}
          </Fragment>
        );
      }),
    [rows, probe, todayKey, yesterdayKey, onOpen, today, todayJustKept, bookEmpty, scrollToNewEntry, active],
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
        onScroll={active ? onScroll : undefined}
        // while the camera is moving (the feed is inactive) un-stick the margin
        // dates (see globals.css) so the whole page scales as one rigid block —
        // otherwise the sticky dates stay pinned while the cards scale under them
        data-dive-freeze={!active || undefined}
        className="relative h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
        style={{ scrollbarWidth: "none" }}
        tabIndex={-1}
      >
        {body}
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
    p.today === n.today &&
    p.all === n.all &&
    p.onVisible === n.onVisible &&
    p.onOpen === n.onOpen,
);

/* the scroll terminus (the foot hairline + `useScrollEdges`) lives in
   components/ui/scroll-terminus now — shared with the Today page, which
   marks both ends. */

/* ── the focused entry: one card, the whole stage ────────────────── */

function EntryViewBase({
  snippet,
  onLetGo,
}: {
  snippet: Snippet | null;
  onLetGo: (snippet: Snippet) => void | Promise<void>;
}) {
  // one tile, grown to fill the stage — the same paper material as the
  // schedule card it expanded from, so the FLIP reads as that very card
  // opening. The zoom drives [data-entry-card]'s box and fades the
  // content in; the date now lives in the header, so no header here.
  return (
    // max-h, not h: a short entry's card reaches only as far as its
    // words; only a long one fills the stage and scrolls inside, with
    // the card's own bottom rule marking where the scroll terminates
    <div
      data-entry-card
      className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-rule-faint bg-paper shadow-[0_1px_3px_rgb(var(--shadow-hue)/0.08)]"
      style={{ transformOrigin: "0 0" }}
    >
      {snippet ? (
        <EntryBody key={snippet.id} snippet={snippet} onLetGo={onLetGo} />
      ) : (
        <div data-entry-card-content className="px-4 pb-4 pt-3">
          <p className="voice-prose italic text-ink-soft">{copy.deleteEntry.toast}</p>
        </div>
      )}
      {/* the card's lit top edge, kept ABOVE the scrolling ink: the ink
          multiplies into the paper, so left below it the words would
          darken the highlight away as they pass — the depth cue must
          read at every scroll position */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] shadow-[inset_0_1px_0_var(--press-highlight)]"
      />
    </div>
  );
}
// the focused entry is null while the reader is in the book, so this
// skips the scroll-spy's re-renders — only a real change of entry
// (or focus) brings it back
const EntryView = memo(EntryViewBase);

/**
 * The entry's words. Pressing them opens them for rewriting in place —
 * the words themselves become the field — and a wax quill stamp at the
 * foot confirms (the same as dismissing the keyboard). A quiet ember
 * trash, across from it, lets the entry go.
 */
function EntryBody({
  snippet,
  onLetGo,
}: {
  snippet: Snippet;
  onLetGo: (snippet: Snippet) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(snippet.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // while rewriting, keep the field and the entry's last lines clear of the
  // keyboard and its floating pills
  useKeyboardRoom(contentRef, editing);
  // a long entry that overflows the card reads at the schedule-preview size
  // (smaller) rather than full prose. We can't trust the live scroll edges
  // for this: as the card opens it FLIPs from a small tile up to the full
  // stage, so mid-flight a short entry momentarily overflows and would
  // latch compact on. Instead wait for the card height to settle (steady
  // for a few frames), then measure once — same +1 threshold the foot fade
  // uses, so a short entry that fits gets neither the small text nor the fade.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (editing) return;
    const el = contentRef.current;
    if (!el) return;
    let raf = 0;
    let last = -1;
    let stable = 0;
    let frames = 0;
    const tick = () => {
      frames += 1;
      const h = el.clientHeight;
      if (h === last) stable += 1;
      else {
        stable = 0;
        last = h;
      }
      if (stable >= 3 || frames > 90) {
        setCompact(el.scrollHeight > el.clientHeight + 1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snippet.text, editing]);
  // the foot terminus shows while more words lie below, and clears at the last
  // line (or if they all fit). compact is a dep because shrinking the font
  // changes the scroll height WITHOUT resizing the scroller, which the
  // ResizeObserver alone misses — leaving the terminus lit at the very bottom.
  const edges = useScrollEdges(contentRef, [editing, draft, compact]);

  const save = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== snippet.text) {
      try {
        await updateSnippet(snippet.id, { text: trimmed });
      } catch {
        toast(copy.data.keepFailed);
      }
    }
  };
  const startEdit = () => {
    if (editing) return;
    setDraft(snippet.text);
    // focus synchronously, inside the tap — iOS won't raise the
    // keyboard for a focus that arrives by timer
    const el = areaRef.current;
    if (el) {
      el.value = snippet.text;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    setEditing(true);
    requestAnimationFrame(() => {
      if (areaRef.current) autosizeArea(areaRef.current);
    });
  };
  const stopEdit = () => {
    void save();
    setEditing(false);
    areaRef.current?.blur(); // confirming is dismissing the keyboard
  };
  // iOS dismisses the keyboard (chevron-down) WITHOUT blurring the
  // field, so onBlur never fires and the quill would linger. Watch the
  // visual viewport: once the keyboard has been up and then grows back,
  // the writer has put the keyboard away — end the edit.
  const stopEditRef = useRef(stopEdit);
  useEffect(() => {
    stopEditRef.current = stopEdit;
  });
  useEffect(() => {
    if (!editing) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let keyboardWasUp = false;
    const onResize = () => {
      const covered = window.innerHeight - vv.height;
      if (covered > 120) keyboardWasUp = true;
      else if (keyboardWasUp) stopEditRef.current();
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [editing]);
  // the parent owns the deletion (it marks the close as a dissolve, soft-deletes,
  // and raises the undo toast) so the camera knows not to shrink back to the slot
  const letGo = () => void onLetGo(snippet);

  return (
    <>
      <div
        ref={contentRef}
        data-entry-card-content
        // pressing the words opens them — a focusable div, NOT a
        // role=button, so the global selection lock doesn't apply and a
        // long-press can still select and copy. overflow-x hidden +
        // wrap-anywhere keep a long token from scrolling sideways
        tabIndex={editing ? -1 : 0}
        onClick={editing ? undefined : startEdit}
        onKeyDown={(e) => {
          if (editing) {
            if (e.key === "Escape") stopEdit();
          } else if (e.key === "Enter") {
            e.preventDefault();
            startEdit();
          }
        }}
        aria-label={editing ? undefined : copy.entry.rewrite}
        // flex-initial (basis auto), NOT flex-1 (basis 0): the card is
        // max-h, so a short entry must size to its words and show them
        // all; only a long one shrinks to fill the stage and scrolls.
        // No bottom padding, so the terminus hairline rides the true
        // bottom edge and the words clip cleanly beneath it.
        className="relative min-h-0 flex-initial overflow-y-auto overflow-x-hidden overscroll-contain px-4 pt-3 [overflow-anchor:none] [overflow-wrap:anywhere]"
        style={{ scrollbarWidth: "none" }}
      >
        {!editing && <SnippetEntry snippet={snippet} dense compact={compact} />}
        {/* the field is always mounted (a hidden one can't take the
            gesture's synchronous focus); writing, it wears the exact
            metrics of the words it replaces */}
        <textarea
          ref={areaRef}
          value={draft}
          rows={1}
          onChange={(e) => {
            setDraft(e.target.value);
            autosizeArea(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") stopEdit();
          }}
          onBlur={() => {
            if (editing) stopEdit();
          }}
          aria-label={copy.entry.words}
          tabIndex={editing ? 0 : -1}
          className={cn(
            // block (not the textarea's default inline-block) so it
            // sits in no baseline line-box — its height then matches the
            // prose it replaces exactly, and edit-toggling never resizes
            // the card around the text
            "voice-prose block resize-none overflow-hidden whitespace-pre-wrap bg-transparent outline-none [overflow-wrap:anywhere]",
            compact ? "text-[0.9rem] leading-[1.42]" : "leading-[1.5]",
            // hidden: inset-x-4 (not left-4 + w-full) so its box can't
            // poke past the right padding and force a sideways scroll
            editing
              ? "w-full"
              : "pointer-events-none absolute inset-x-4 top-3 h-px opacity-0",
          )}
        />
      </div>
      <div
        data-entry-foot
        // pressing the foot's empty band edits too — not only the words
        onClick={editing ? undefined : startEdit}
        className="relative shrink-0"
      >
        {/* the scroll terminus — a soft fade + hairline marking that the words
            run on below. It sits just ABOVE the foot (OUTSIDE the scroller), so
            the scroller's sub-pixel clip can't leak a sliver of the next line
            beneath the rule; it clears once the last line is in view. Paper on
            paper, so an overscroll never flashes it. */}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-full z-[6] h-8 transition-opacity duration-200",
            // hidden while rewriting: as the field autosizes and the keyboard
            // room scrolls to follow the caret, the foot crosses the bottom
            // threshold every keystroke — which would flicker the hairline. The
            // caret is kept in view by useKeyboardRoom, so the marker isn't
            // needed mid-edit anyway.
            edges.bottom && !editing ? "opacity-100" : "opacity-0",
          )}
        >
          {/* the soft fade, dissolving to solid paper just above the rule */}
          <div className="absolute inset-x-0 top-0 bottom-[2px] bg-gradient-to-t from-paper to-transparent" />
          {/* an opaque paper band straddling the scroller's bottom edge — a
              couple px above the rule, down a few px into the foot — so no
              sliver of the next line can leak under the rule (WebKit clips a
              hair low). It's outside the scroller, so it adds no scroll
              overflow; and it shows only WITH the fade, so the last line is
              never covered once it's fully in view. */}
          <div className="absolute inset-x-0 bottom-[-4px] h-[6px] bg-paper" />
          {/* the rule itself is inset to the words' own margins (the scroller's
              px-4), not spanning the whole card */}
          <div className="absolute inset-x-4 bottom-0 border-t border-rule-faint" />
        </div>
        <div
          // constant padding: the foot never changes the card's height
          // as the terminus comes and goes (it sets the gap from the
          // words/hairline down to the trash mark)
          className="flex items-center justify-end px-3 pb-3 pt-2.5"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // not a press-to-edit
              void letGo();
            }}
            aria-label={copy.entry.letGo}
            className="pressable grid size-[34px] place-items-center rounded-full text-ember hover:bg-ember/10"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="size-[1.05rem]"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3.8 5.6h12.4M8 5.4V3.6h4v1.8M5.4 5.8l.9 10a1.6 1.6 0 0 0 1.6 1.4h4.2a1.6 1.6 0 0 0 1.6-1.4l.9-10" />
              <path d="M8.3 8.6v5.6M11.7 8.6v5.6" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
}


/* ── the found words, marked ──────────────────────────────────────
   A search tile shows its match under a real highlighter, and if the
   match lives past the six-line clamp, the preview re-windows so it
   shows — leading with EARLIER context (a story builds forward, so
   the lines before the match explain it; the lines after follow
   anyway in whatever clamp room remains). */

/* queryTerms + allOccurrences live in src/lib/search.ts, shared with the filter
   (useSearch), so the words a tile marks and the reason it was filtered in are
   always the same match. */

const PREVIEW_LINES = 6;

/** The tile's words, found terms under the marker. The preview is a
    true six-line window onto the entry, MEASURED at the tile's real
    wrap, not estimated from a character budget:
    - if the first match already shows in the first six lines, the
      window stays at the top and only the occurrences ON those lines
      are marked — matches further down are neither shown nor drawn;
    - otherwise the window slides down a whole line at a time until the
      match is inside it (kept a line off the bottom for slack), the
      cut lines replaced by a leading ellipsis.
    The highlighter mounts inside the clipped window, so a band for an
    off-window match can never float free of its text. */
function MarkedPreview({
  text,
  query,
  isQuote,
}: {
  text: string;
  query: string;
  isQuote: boolean;
}) {
  const terms = useMemo(() => queryTerms(query), [query]);
  const occ = useMemo(
    () => (terms.length ? allOccurrences(text, terms) : []),
    [text, terms],
  );
  const wrapRef = useRef<HTMLDivElement>(null);
  const pRef = useRef<HTMLParagraphElement>(null);
  const [layout, setLayout] = useState<null | {
    key: string;
    slice: number;
    lead: boolean;
    marks: Array<[number, number]>;
  }>(null);
  const key = `${text} ${query}`;

  // measure the real wrap from the full-text render, then window it
  useLayoutEffect(() => {
    if (!occ.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (layout) setLayout(null);
      return;
    }
    if (layout && layout.key === key) return; // already settled for this key
    const p = pRef.current;
    const node = p?.firstChild; // the measuring pass renders one text node
    if (!p || !node) return;
    const cs = getComputedStyle(p);
    let lh = parseFloat(cs.lineHeight);
    if (!lh || Number.isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.42;
    const len = text.length;
    const topAt = (off: number) => {
      const r = document.createRange();
      r.setStart(node, Math.min(off, len));
      r.setEnd(node, Math.min(off + 1, len));
      const rects = r.getClientRects();
      return (rects.length ? rects[0] : r.getBoundingClientRect()).top;
    };
    const base = topAt(0);
    const lineOf = (off: number) => Math.round((topAt(off) - base) / lh);

    const firstLine = lineOf(occ[0][0]);
    let slice = 0;
    let lead = false;
    if (firstLine > PREVIEW_LINES - 1) {
      // slide down so the first match rests a line off the bottom — the
      // slack absorbs the leading ellipsis's own reflow of line one
      const target = Math.max(0, firstLine - (PREVIEW_LINES - 2));
      let lo = 0;
      let hi = len;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (lineOf(mid) >= target) hi = mid;
        else lo = mid + 1;
      }
      while (lo < len && /\s/.test(text[lo])) lo++;
      slice = lo;
      lead = true;
    }
    const floor = slice ? lineOf(slice) : 0;
    const marks: Array<[number, number]> = [];
    for (const [s, e] of occ) {
      if (s < slice) continue; // above the window — cut away
      if (lineOf(s) > floor + PREVIEW_LINES - 1) continue; // below it — unmarked
      marks.push([s - slice, e - slice]);
    }
    setLayout({ key, slice, lead, marks });
  }, [key, occ, layout, text]);

  // the lines rewrap only when the width changes — re-measure then
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === w) return;
      w = el.clientWidth;
      setLayout(null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const measured = layout !== null && layout.key === key;
  let body: React.ReactNode;
  if (!occ.length) {
    body = text;
  } else if (!measured) {
    body = text; // the measuring pass: full text, a single text node
  } else {
    const sliced = text.slice(layout.slice);
    const nodes: React.ReactNode[] = layout.lead ? ["… "] : [];
    let cur = 0;
    layout.marks.forEach(([s, e], i) => {
      if (s > cur) nodes.push(sliced.slice(cur, s));
      nodes.push(<RoughMark key={i}>{sliced.slice(s, e)}</RoughMark>);
      cur = e;
    });
    if (cur < sliced.length) nodes.push(sliced.slice(cur));
    body = nodes;
  }

  return (
    <div
      ref={wrapRef}
      data-mark-clip
      className="relative overflow-hidden"
      style={{ maxHeight: `calc(0.9rem * 1.42 * ${PREVIEW_LINES})` }}
    >
      <p
        ref={pRef}
        className={cn(
          "voice-prose whitespace-pre-wrap text-[0.9rem] leading-[1.42]",
          // once windowed, clamp to the 6-line view so the last visible line
          // gets a trailing "…" (the measuring pass renders the full text, so
          // it must stay unclamped for the line maths to be right)
          (measured || !occ.length) && "line-clamp-6",
          isQuote && "hang-quotes italic",
        )}
      >
        {body}
      </p>
    </div>
  );
}

/** One found phrase under a drawn highlighter (@highlighters/core):
    wet ink with frayed edges, one band per wrapped line, the bands
    joined across the wrap. Its overlay mounts in the nearest
    positioned ancestor and reflows itself on layout shifts; the ink
    is the marker token, resolved here at draw time. */
function RoughMark({ children }: { children: string }) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const color =
      getComputedStyle(el).getPropertyValue("--marker").trim() || "#e8c558";
    const h = drawHighlight(
      el,
      {
        color,
        opacity: 0.8,
        // the owner's hand: a fine nib at a slight slant, generous wet
        // flow with full streak lanes, soft capillary fray, round caps
        // on gently wavering rails — and the parameter that matters
        // most, touchdown/lift pooling, at full
        tip: {
          type: "fine",
          angle: 5,
          overshoot: 2,
          overshootJitter: 0,
          angleJitter: 0,
        },
        ink: {
          flow: 0.8,
          feathering: 0.5,
          streakiness: 1,
          dryout: 0,
          flowFade: 0.5,
          startEndBuildup: 1,
        },
        edge: {
          waviness: 1,
          frequency: 40,
          cap: "round",
          radius: 6,
        },
        paper: { absorbency: 0.1 },
        animation: { draw: true, duration: 380 },
      },
      // mount the band inside the clipped preview window: element
      // targets default their overlay to document.body (which would
      // stand still while the filtered book scrolls), and the clip box
      // shears off any band that strays past the six visible lines
      (el.closest("[data-mark-clip]") as HTMLElement | null) ??
        el.closest("button") ??
        undefined,
    );
    return () => h.remove();
  }, [children]);
  return (
    <mark ref={ref} className="snippet-mark">
      {children}
    </mark>
  );
}

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

/* The today zone: a big "add to today" panel that FILLS the blank tail of
   today's page (flex-1 within the min-h-full), housing the large pre-stamp wax
   button inside a hairline blue outline. It shrinks as today fills with entries
   above it. This is the app's capture surface. */
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
  const [down, setDown] = useState(false);
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
      setText(""); setPhase("idle"); setGen((g) => g + 1);
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
            {/* the rules are a pure underlay BEHIND the field — they never sit on
                the textarea's own box, so the caret, selection, and native text
                handling all render exactly as a plain field would */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                // rule just below the baseline so standard characters rest ON the
                // line and only descenders dip across it, like real ruled paper
                backgroundImage:
                  "repeating-linear-gradient(to bottom, transparent 0, transparent calc(1.7rem - 1px), var(--rule-faint) calc(1.7rem - 1px), var(--rule-faint) 1.7rem)",
                backgroundPositionY: "-0.4rem",
              }}
            />
            <textarea
              ref={areaRef}
              value={text}
              rows={3}
              readOnly={frozen}
              // keep the line being written centred above the keyboard, not just
              // clear of it (this field grows long; see useKeyboardRoom)
              data-room-center=""
              onChange={(e) => { setText(e.target.value); autosizeArea(e.target); }}
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
              style={{ lineHeight: "1.7rem", minHeight: "5.1rem" }}
            />
          </div>

          {/* the wax button — mic at rest, quill once typing starts; the whole
              button cross-slides (left↔right carousel) on the swap. press it to
              submit (plays the corner·swell keep) */}
          <button
            ref={btnRef}
            type="button"
            aria-label={hasText ? copy.todayZone.keepEntry : copy.todayZone.speakEntry}
            // keep on pointer-up (released ON the button) so setDown(false) and
            // the hold batch in one render — the press never un-rotates. onClick
            // covers keyboard; it's idempotent.
            onClick={submit}
            disabled={frozen}
            onPointerDown={(e) => { e.preventDefault(); setDown(true); }}
            onPointerUp={() => { setDown(false); if (hasText) submit(); }}
            onPointerLeave={() => setDown(false)}
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
                  pressed={down || holdDown}
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
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function autosizeArea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
