"use client";

import {
  Fragment,
  Suspense,
  memo,
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
import {
  groupByDay,
  useAllSnippets,
  useDayCounts,
  useSearch,
} from "@/hooks/use-snippets";
import {
  addSnippet,
  restoreSnippet,
  softDeleteSnippet,
  updateSnippet,
} from "@/lib/db";
import { enrichSnippet } from "@/lib/enrich";
import { dayKey, dateFromDayKey, friendlyDay } from "@/lib/dates";
import type { Snippet } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
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

function monthRows(m: Date): number {
  return Math.ceil((getDay(m) + endOfMonth(m).getDate()) / 7);
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
    y += labelRowH + monthRows(m) * cell;
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

export default function CalendarPage() {
  return (
    <Suspense>
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
  goTo: (day: string) => void;
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

  // a valid ?d= deep-links straight into the book, open to that day
  const [view, setView] = useState<View>(() => {
    const d = params.get("d");
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return "month";
    return params.get("e") ? "entry" : "schedule";
  });
  /** during a zoom both layers render; the camera moves `from` → `to` */
  const [zoom, setZoom] = useState<null | {
    from: View;
    to: View;
    anchor: string;
  }>(null);
  const [selected, setSelected] = useState(initialDay);
  /** what the title shows — follows the feeds' scroll */
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(dateFromDayKey(initialDay)),
  );
  const [visibleYear, setVisibleYear] = useState(() => visibleMonth.getFullYear());

  const counts = useDayCounts();
  const all = useAllSnippets();
  const reduceMotion = useReducedMotion();

  /** the entry the camera has dived into */
  const [focusedId, setFocusedId] = useState<string | null>(() =>
    params.get("e"),
  );
  const focused = useMemo(
    () => (focusedId && all ? (all.find((s) => s.id === focusedId) ?? null) : null),
    [all, focusedId],
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── the zoom: one camera move between altitudes ──────────────── */

  const runZoom = useCallback((from: View, to: View, anchor: string) => {
    if (zooming.current) return;
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

  /** the reader's place in the book drives selection, title, and URL */
  const onScheduleDay = useCallback(
    (key: string) => {
      setSelected(key);
      const m = startOfMonth(dateFromDayKey(key));
      setVisibleMonth((prev) => (isSameMonth(prev, m) ? prev : m));
      setVisibleYear(m.getFullYear());
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
  const jumpTo = (key: string) => {
    setSelected(key);
    const m = startOfMonth(dateFromDayKey(key));
    setVisibleMonth(m);
    setVisibleYear(m.getFullYear());
    if (urlTimer.current) clearTimeout(urlTimer.current);
    window.history.replaceState(null, "", `${pathname}?d=${key}`);
    scheduleFeedRef.current?.goTo(key);
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
      jumpTo(dayKey());
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
  const searchActive = searching && query.trim() !== "";
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
                ? `Show ${visibleMonth.getFullYear()} at a glance`
                : view === "schedule"
                  ? `Back to the ${format(visibleMonth, "MMMM yyyy")} grid`
                  : "Back to the days"
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
            aria-label="Search entries"
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
                placeholder="Find an entry…"
                aria-label="Search entries"
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
            {WEEKDAYS.map((d, i) => (
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
          // hairline + fade), so the frame's own line is retired — the
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
          <MonthFeed
            handleRef={monthFeedRef}
            active={view === "month" && !zoom}
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
          <YearFeed
            handleRef={yearFeedRef}
            active={view === "year" && !zoom}
            today={today}
            years={glanceYears}
            counts={counts}
            onPickMonth={pickMonth}
            onVisible={setVisibleYear}
          />
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
          <ScheduleFeed
            handleRef={scheduleFeedRef}
            active={view === "schedule" && !zoom}
            today={today}
            selected={selected}
            all={all}
            onVisible={onScheduleDay}
            onOpen={openEntry}
          />
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
          <EntryView snippet={focused} />
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
                            "voice-display block text-[1.15rem] leading-tight",
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
                              onClick={() => jumpFromSearch(s.day)}
                              className={cn(
                                "pressable block w-full rounded-[6px] border border-rule-faint bg-paper p-2.5 text-left",
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

function MonthFeed({
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

  const geom = useMemo(
    () =>
      // the hand-over row is barely taller than its text: the label's
      // line box plus 4px of air above and 4px down to the rule
      metrics
        ? buildMonthGeom(metrics.w, metrics.labelH + 8, currentMonth, span)
        : null,
    // geometry depends on width, label height, and the span only
    // (currentMonth is stable) — a viewport-height blip must not
    // rebuild it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics?.w, metrics?.labelH, span],
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
      <ScrollFadeHead show={edges.top} />
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
      <ScrollFadeFoot hairline={edges.top || edges.bottom} fade={edges.bottom} />
    </div>
  );
}

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
  const days = eachDayOfInterval({ start: month, end: endOfMonth(month) });
  const leadingBlanks = getDay(month);
  const trailingBlanks = (7 - ((leadingBlanks + days.length) % 7)) % 7;
  const isCurrent = isSameMonth(month, today);

  return (
    <div>
      {/* the hand-over row: only the month's name, standing over its
          first day — the rule beneath it is that day's own top edge */}
      <div className="relative" style={{ height: labelRowH }}>
        <span
          data-flymonth={ym(month)}
          className={cn(
            "voice-label absolute bottom-1 text-center text-[0.82rem]",
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
              whileTap={isFuture ? undefined : { scale: 0.9 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              aria-label={`${format(date, "MMMM d")}${count ? `, ${count} kept` : ""}`}
              aria-pressed={key === selected}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center gap-1 border-t border-rule-faint",
                !isFuture && "transition-colors duration-150 hover:bg-paper-raised",
                isFuture && "text-ink-faint/40",
              )}
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

function YearFeed({
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
      <ScrollFadeHead show={edges.top} />
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
      <ScrollFadeFoot hairline={edges.top || edges.bottom} fade={edges.bottom} />
    </div>
  );
}

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
  const days = eachDayOfInterval({ start, end: endOfMonth(start) });
  const leading = getDay(start);
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
function ScheduleFeed({
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const spyRef = useRef<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const rafRef = useRef(0);
  const didInit = useRef(false);

  const rows = useMemo(() => {
    if (!all) return null;
    const groups = groupByDay([...all].reverse()); // oldest → newest
    const map = new Map(groups.map((g) => [g.day, g.snippets]));
    const days = new Set(map.keys());
    days.add(todayKey);
    // yesterday always earns a page so its memory can still be caught —
    // even when nothing was kept there
    if (!map.has(yesterdayKey)) days.add(yesterdayKey);
    if (probe) days.add(probe);
    return [...days].sort().map((day) => ({
      day,
      snippets: map.get(day) ?? ([] as Snippet[]),
    }));
  }, [all, probe, todayKey, yesterdayKey]);

  const scrollToRow = useCallback((day: string) => {
    const el = scrollerRef.current;
    const row = rowRefs.current.get(day);
    if (!el || !row) return false;
    spyRef.current = day; // the landing must not re-announce itself
    el.scrollTop = row.offsetTop;
    return true;
  }, []);

  const goTo = useCallback(
    (day: string) => {
      setProbe(day);
      // land now so the camera zooms onto the right page, then settle
      // once the probe (and any row churn) has committed
      scrollToRow(day);
      pendingRef.current = day;
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
    if (!didInit.current) {
      didInit.current = true;
      scrollToRow(selected);
      pendingRef.current = null;
      return;
    }
    if (pendingRef.current) {
      // one settle only — a stale pending must never replay a jump
      scrollToRow(pendingRef.current);
      pendingRef.current = null;
    }
    // `selected` only seeds the very first position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, scrollToRow]);

  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = scrollerRef.current;
      if (!el) return;
      const top = el.scrollTop;
      // the reader's day is the topmost whose margin date is still
      // fully stacked — a row whose tail merely peeks under the rail
      // has already handed over (its date has slid off the pin)
      let cur: string | null = null;
      let curTop = Infinity;
      for (const [day, row] of rowRefs.current) {
        const headH =
          (row.firstElementChild as HTMLElement | null)?.offsetHeight ?? 48;
        const t = row.offsetTop;
        if (t + row.offsetHeight >= top + headH && t < curTop) {
          curTop = t;
          cur = day;
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
        const pageRow = (
          <section
            ref={rowRef(row.day)}
            data-day={row.day}
            aria-label={friendlyDay(row.day)}
            className="grid grid-cols-[2.1rem_1fr] gap-x-2 border-t border-rule-faint"
          >
                {/* the date stands in the margin and holds its ground
                    while its day's entries scroll past */}
                <div className="sticky top-0 self-start pb-3 pt-2 text-center">
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
                      "voice-display block text-[1.15rem] leading-tight",
                      isToday && "text-wax",
                    )}
                  >
                    {format(d, "d")}
                  </span>
                </div>
                <div className="min-w-0 pb-3 pt-2">
                  <ScheduleCards snippets={row.snippets} onOpen={onOpen} />
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
            {last ? (
              // min-height pins one viewport of room below the final
              // row's top — in the same layout pass as any content
              // change, so shrinking rows can never dip scrollHeight
              // and clamp the reader off their page
              <div className="min-h-full">{pageRow}</div>
            ) : (
              pageRow
            )}
          </Fragment>
        );
      }),
    [rows, probe, todayKey, yesterdayKey, onOpen, today],
  );

  const edges = useScrollEdges(scrollerRef, [rows]);

  return (
    <div
      ref={scrollerRef}
      onScroll={active ? onScroll : undefined}
      className="relative h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      style={{ scrollbarWidth: "none" }}
      tabIndex={-1}
    >
      <ScrollFadeHead show={edges.top} />
      {body}
      <ScrollFadeFoot hairline={edges.top || edges.bottom} fade={edges.bottom} />
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
  onOpen,
}: {
  snippets: Snippet[];
  onOpen: (id: string) => void;
}) {
  // entries already on the page at mount don't animate — only changes do
  const [presentAtMount] = useState(() => new Set(snippets.map((s) => s.id)));

  return (
    <ul className="flex flex-col gap-1">
      <AnimatePresence initial={false}>
        {snippets.map((s) => (
          <motion.li
            key={s.id}
            layout="position"
            initial={
              presentAtMount.has(s.id)
                ? false
                : { opacity: 0, y: -10, scale: 0.985 }
            }
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, height: 0, overflow: "hidden" }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.16 }}
          >
            <button
              type="button"
              data-entry={s.id}
              onClick={() => onOpen(s.id)}
              className={cn(
                "pressable block w-full rounded-[6px] border border-rule-faint bg-paper p-2.5 text-left",
                "shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] hover:bg-paper-raised",
              )}
            >
              <p
                className={cn(
                  "voice-prose line-clamp-6 whitespace-pre-wrap text-[0.9rem] leading-[1.42]",
                  s.kind === "quote" && "hang-quotes italic",
                )}
              >
                {s.text}
              </p>
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/* ── scroll terminus: hairline + dynamic fade ────────────────────
   The one standard treatment for a scrollable container's edges. A
   hairline marks the foot while the container can scroll; a fade just
   inside each edge shows there's more that way and clears once that
   end is in view, so the final content sits crisp against the line.
   `useScrollEdges` watches the container; the two sticky pieces drop
   in as the first and last children of the scroller itself. */
function useScrollEdges(
  ref: React.RefObject<HTMLElement | null>,
  deps: React.DependencyList = [],
): { top: boolean; bottom: boolean } {
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const can = el.scrollHeight > el.clientHeight + 1;
    const top = el.scrollTop > 1;
    const bottom = can && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdges((p) => (p.top === top && p.bottom === bottom ? p : { top, bottom }));
  }, [ref]);
  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);
  return edges;
}

/** The head fade — first child of the scroller; shows more above. It
    spans the scroller's content box (negative margin keeps it out of
    the flow), so it needs no knowledge of the parent's padding. */
function ScrollFadeHead({ show }: { show: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none sticky top-0 z-[6] -mb-5 h-5 bg-gradient-to-b from-paper to-transparent transition-opacity duration-200",
        show ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

/** The foot — last child of the scroller: a hairline at the terminus
    (while scrollable), a fade above it (while more is below). */
function ScrollFadeFoot({
  hairline,
  fade,
}: {
  hairline: boolean;
  fade: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none sticky bottom-0 z-[6] -mt-5 h-5"
    >
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 top-0 bg-gradient-to-t from-paper to-transparent transition-opacity duration-200",
          fade ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 border-t border-rule-faint transition-opacity duration-200",
          hairline ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/* ── the focused entry: one card, the whole stage ────────────────── */

function EntryView({ snippet }: { snippet: Snippet | null }) {
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
        <EntryBody key={snippet.id} snippet={snippet} />
      ) : (
        <div data-entry-card-content className="px-4 pb-4 pt-3">
          <p className="voice-prose italic text-ink-soft">Let go.</p>
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

/**
 * The entry's words. Pressing them opens them for rewriting in place —
 * the words themselves become the field — and a wax quill stamp at the
 * foot confirms (the same as dismissing the keyboard). A quiet ember
 * trash, across from it, lets the entry go.
 */
function EntryBody({ snippet }: { snippet: Snippet }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(snippet.text);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // the scroll terminus is the standard hairline + dynamic fade; a
  // scrollable entry carries it, a short one that fits shows nothing
  const edges = useScrollEdges(contentRef, [editing, draft]);
  const scrollable = edges.top || edges.bottom;

  const save = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== snippet.text) {
      try {
        await updateSnippet(snippet.id, { text: trimmed });
      } catch {
        toast("That didn’t take — try again.");
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
  const letGo = async () => {
    await softDeleteSnippet(snippet.id);
    window.history.back(); // the page closes over the struck line
    toast("Let go.", {
      action: { label: "Undo", onClick: () => void restoreSnippet(snippet.id) },
    });
  };

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
        aria-label={editing ? undefined : "Rewrite this entry"}
        className={cn(
          "relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pt-3 [overflow-anchor:none] [overflow-wrap:anywhere]",
          // a scrolling entry keeps a little room below its last line
          // (the bottom selection handle lives inside the clip); a short
          // one that fits sits close to the foot
          edges.bottom ? "pb-2.5" : "pb-1.5",
        )}
        style={{ scrollbarWidth: "none" }}
      >
        <ScrollFadeHead show={edges.top} />
        {!editing && <SnippetEntry snippet={snippet} dense />}
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
          aria-label="The entry’s words"
          tabIndex={editing ? 0 : -1}
          className={cn(
            // block (not the textarea's default inline-block) so it
            // sits in no baseline line-box — its height then matches the
            // prose it replaces exactly, and edit-toggling never resizes
            // the card around the text
            "voice-prose block resize-none overflow-hidden whitespace-pre-wrap bg-transparent leading-[1.5] outline-none [overflow-wrap:anywhere]",
            // hidden: inset-x-4 (not left-4 + w-full) so its box can't
            // poke past the right padding and force a sideways scroll
            editing
              ? "w-full"
              : "pointer-events-none absolute inset-x-4 top-3 h-px opacity-0",
          )}
        />
        {/* the scroll terminus — a hairline at the foot, with a fade
            above it while more words run on below; it clears once the
            end is in view so the last line sits crisp on the line */}
        <ScrollFadeFoot hairline={scrollable} fade={edges.bottom} />
      </div>
      <div
        data-entry-foot
        // pressing the foot's empty band edits too — not only the words
        onClick={editing ? undefined : startEdit}
        className="shrink-0"
      >
        <div
          className={cn(
            "flex items-center px-3 pb-3",
            // when there's no terminus hairline, the buttons can sit
            // closer up to the words
            scrollable ? "pt-2.5" : "pt-1",
            "justify-between",
          )}
        >
          {/* the confirm quill is always mounted so it can FADE in and
              out — when a keyboard dismissal ends the edit it dissolves
              rather than vanishing. Invisible, it yields its press to
              the band beneath (which edits) */}
          <div
            className={cn(
              "transition-opacity duration-200 ease-[var(--ease-out)]",
              editing ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            aria-hidden={!editing}
          >
            <WaxStamp
              label="Done — keep the rewrite"
              onClick={stopEdit}
              keepFocus
              disabled={!editing}
            >
              {/* the dock's quill, now the confirming stamp */}
              <path d="M4.4 15.6C5.2 10.2 9 5.6 16 3.8c.5 2.7-.7 6.6-3.2 9.1-1.9 1.9-4.9 2.7-8.4 2.7Z" />
              <path d="M4.4 15.6 12.6 7" />
              <path d="M4.4 15.6 3.4 17.6" />
            </WaxStamp>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation(); // not a press-to-edit
              void letGo();
            }}
            aria-label="Let this entry go"
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

/** A pressed-wax seal at stamp scale — the entry card's marks, in the
    day page seal's own material: lit from the upper left, a grooved
    rim, sitting proud of the paper, depressing under the finger.
    While listening it breathes, rings widening. */
function WaxStamp({
  label,
  onClick,
  listening = false,
  keepFocus = false,
  disabled = false,
  children,
}: {
  label: string;
  onClick: () => void;
  listening?: boolean;
  /** don't steal focus from the field on press (the mic, mid-edit) */
  keepFocus?: boolean;
  /** faded out and inert (the confirm stamp at rest) */
  disabled?: boolean;
  children: React.ReactNode;
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
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        tabIndex={disabled ? -1 : undefined}
        onPointerDown={keepFocus ? (e) => e.preventDefault() : undefined}
        className={cn(
          "relative grid size-[34px] shrink-0 place-items-center rounded-full text-paper-raised",
          "bg-[radial-gradient(circle_at_32%_28%,var(--wax-bright)_0%,var(--wax)_48%,var(--wax-deep)_100%)]",
          "shadow-[inset_0_1px_1.5px_rgb(255_255_255/0.3),inset_0_-2px_3.5px_rgb(0_0_0/0.3),0_1px_2px_rgb(var(--shadow-hue)/0.3),0_3px_8px_-2px_var(--wax-shadow)]",
          "transition-[transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "active:scale-[0.93] active:shadow-[inset_0_2px_4px_rgb(0_0_0/0.4),0_1px_2px_rgb(var(--shadow-hue)/0.25)]",
          listening && "seal-breathe",
        )}
      >
        {/* the grooved rim */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[3.5px] rounded-full border border-black/25 shadow-[inset_0_1px_1px_rgb(255_255_255/0.18)]"
        />
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="relative size-[15px] drop-shadow-[0_1px_1px_rgb(0_0_0/0.3)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {children}
        </svg>
      </button>
    </span>
  );
}


/* ── the found words, marked ──────────────────────────────────────
   A search tile shows its match under a real highlighter, and if the
   match lives past the six-line clamp, the preview re-windows so it
   shows — leading with EARLIER context (a story builds forward, so
   the lines before the match explain it; the lines after follow
   anyway in whatever clamp room remains). */

/** the query's literal terms, longest first so overlaps mark whole */
function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2),
    ),
  ].sort((a, b) => b.length - a.length);
}

/** Every literal occurrence of the query, merged and in order — a term
    can recur many times in a long entry, so the count is capped. */
function allOccurrences(text: string, terms: string[]): Array<[number, number]> {
  const lower = text.toLowerCase();
  const hits: Array<[number, number]> = [];
  for (const t of terms) {
    let i = lower.indexOf(t);
    while (i >= 0 && hits.length < 80) {
      hits.push([i, i + t.length]);
      i = lower.indexOf(t, i + t.length);
    }
  }
  hits.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const h of hits) {
    const last = merged[merged.length - 1];
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push([h[0], h[1]]);
  }
  return merged;
}

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

function BackfillCapture({
  day,
  follows = false,
}: {
  day: string;
  /** the composer stands below entries, stacked like one more tile */
  follows?: boolean;
}) {
  const [text, setText] = useState("");
  const [stamped, setStamped] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isToday = day === dayKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = day === dayKey(yesterday);
  // remounted per day via key, so state starts fresh; only clean the timer
  useEffect(() => {
    return () => {
      if (stampTimer.current) clearTimeout(stampTimer.current);
    };
  }, []);

  const keep = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    const el = areaRef.current;
    if (el) {
      el.value = "";
      autosizeArea(el);
    }
    navigator.vibrate?.(8);
    setStamped(true);
    if (stampTimer.current) clearTimeout(stampTimer.current);
    stampTimer.current = setTimeout(() => setStamped(false), 1600);
    const at = dateFromDayKey(day);
    at.setHours(12, 0, 0, 0); // noon: clear of DST edges
    try {
      const snippet = await addSnippet({
        text: trimmed,
        source: "typed",
        // today is stamped at its real moment; the past lands at noon
        ...(isToday ? {} : { capturedAt: at.getTime() }),
      });
      void enrichSnippet(snippet);
    } catch {
      toast("That didn’t take — try again.");
    }
  };

  const hasText = text.trim().length > 0;

  return (
    // the composer sits on the tile line and wears the tiles' own
    // paddings — a one-line tile waiting for words
    <div className={cn("relative", follows && "mt-1")}>
      {/* the card proper: paint and field only — the Keep button and
          the stamp line live below it, outside the paint (an inset-0
          coat over the whole composer once buried them) */}
      <div className="group relative">
        {/* the tile's paint, fading rightward into the bare page: an
            entry not yet written. Focus darkens the rule, as writing
            surfaces do */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[6px] border border-rule-faint bg-paper shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)] transition-colors duration-150 [-webkit-mask-image:linear-gradient(to_right,black_35%,transparent_92%)] [mask-image:linear-gradient(to_right,black_35%,transparent_92%)] group-focus-within:border-rule"
        />
        {/* …and while words stand in it, the paint completes: the card
            is becoming real */}
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
          placeholder={
            isToday
              ? "Add something from today…"
              : isYesterday
                ? "Add something from yesterday…"
                : "Add something you want to remember…"
          }
          aria-label={`Add an entry to ${friendlyDay(day)}`}
          onChange={(e) => {
            setText(e.target.value);
            autosizeArea(e.target);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void keep();
            }
          }}
          className={cn(
            "voice-prose relative block w-full resize-none overflow-hidden bg-transparent p-2.5 text-[0.9rem] leading-[1.42] outline-none placeholder:italic",
            // today's invitation shares today's hue, like its date across
            // the gutter; other days keep the quiet ink
            isToday ? "placeholder:text-wax/75" : "placeholder:text-ink-faint",
          )}
        />
      </div>
      {hasText && (
        // the same wax quill confirm-stamp the entry editor uses; keeping
        // holds focus so the next thing can be typed straight away
        <div className="mt-2 flex justify-end pr-px">
          <WaxStamp label="Keep this" onClick={() => void keep()} keepFocus>
            <path d="M4.4 15.6C5.2 10.2 9 5.6 16 3.8c.5 2.7-.7 6.6-3.2 9.1-1.9 1.9-4.9 2.7-8.4 2.7Z" />
            <path d="M4.4 15.6 12.6 7" />
            <path d="M4.4 15.6 3.4 17.6" />
          </WaxStamp>
        </div>
      )}
      {/* the "Kept." stamp floats below the field rather than reserving
          height — the composer's foot then matches any other tile's, and
          a stamp can't reshape the row, clamp the scroller, or wake the
          spy */}
      <p
        role="status"
        className={cn(
          "pointer-events-none absolute inset-x-0 top-full mt-1 h-5 px-2.5 font-serif text-[0.85rem] not-italic text-wax",
          stamped ? "stamp-in" : "invisible",
        )}
      >
        {stamped
          ? isToday
            ? "Kept."
            : `Kept to ${friendlyDay(day).toLowerCase()}.`
          : " "}
      </p>
    </div>
  );
}

function autosizeArea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
