"use client";

import {
  Fragment,
  Suspense,
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
import NumberFlow from "@number-flow/react";
import { toast } from "sonner";
import { SnippetEntry } from "@/components/snippet/snippet-entry";
import { StampMark } from "@/components/stamp-mark";
import {
  groupByDay,
  useAllSnippets,
  useDayCounts,
  useStats,
} from "@/hooks/use-snippets";
import { addSnippet } from "@/lib/db";
import { enrichSnippet } from "@/lib/enrich";
import { dayKey, dateFromDayKey, friendlyDay } from "@/lib/dates";
import type { Snippet } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const ringSpring = { type: "spring", stiffness: 380, damping: 30 } as const;
const ym = (d: Date) => format(d, "yyyy-MM");

/* ── feed geometry: ten years of time, computed, never reflowed ────
   The feeds are virtualized over arithmetic offsets inside one
   fixed-height spacer. Nothing is ever inserted above the reader and
   scrollTop is never written during a gesture — the recording showed
   iOS killing fling momentum the instant the old windowed feed
   compensated scroll positions mid-flight. */

const RANGE_MONTHS = 120;
const RANGE_YEARS = 10;
const YEAR_GAP = 24; // between year blocks
const MINI_GAP = 8; // gap-2 between minis
const MINI_DOT = 3;

function monthRows(m: Date): number {
  return Math.ceil((getDay(m) + endOfMonth(m).getDate()) / 7);
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
): MonthGeom {
  const cell = width / 7;
  const months: Date[] = [];
  const offsets: number[] = [];
  const switchY: number[] = [];
  let y = 0;
  for (let i = RANGE_MONTHS - 1; i >= 0; i--) {
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
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? "schedule" : "month";
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
  const stats = useStats();
  const all = useAllSnippets();
  const reduceMotion = useReducedMotion();

  /** the entry the camera has dived into */
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focused = useMemo(
    () => (focusedId && all ? (all.find((s) => s.id === focusedId) ?? null) : null),
    [all, focusedId],
  );

  const today = new Date();
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
      window.history.replaceState(null, "", `${pathname}?d=${key}`);
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
      for (const el of willChanged) el.style.willChange = "";
      flyerBox?.remove();
      for (const el of hiddenNumbers) el.style.visibility = "";
      setZoom(null);
      zooming.current = false;
    };

    if (reduceMotion) {
      void animate(outgoing, { opacity: [1, 0] }, { duration: 0.12 }).then(finish);
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
        void Promise.all(moves).then(finish);
        return;
      }
      // missing nodes — fall through to a plain crossfade
      incoming.style.opacity = "0";
      moves.push(
        animate(outgoing, { opacity: [1, 0] }, { duration: 0.16 }).finished,
        animate(incoming, { opacity: [0, 1] }, { duration: 0.16 }).finished,
      );
      void Promise.all(moves).then(finish);
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

    void Promise.all(moves).then(finish);
  }, [zoom, reduceMotion]);

  const openYear = () => {
    const y = visibleMonth.getFullYear();
    setVisibleYear(y);
    yearFeedRef.current?.goTo(y, false); // stand on the year before measuring
    runZoom("month", "year", ym(visibleMonth));
  };

  const pickMonth = (m: Date) => {
    setVisibleMonth(m);
    monthFeedRef.current?.goTo(m, false); // land exactly, behind the zoom
    runZoom("year", "month", ym(m));
  };

  const closeSchedule = () => {
    // stand the canvas on the month being read before pulling back
    const m = startOfMonth(dateFromDayKey(selected));
    setVisibleMonth(m);
    setVisibleYear(m.getFullYear());
    monthFeedRef.current?.goTo(m, false);
    if (urlTimer.current) clearTimeout(urlTimer.current);
    window.history.replaceState(null, "", pathname);
    runZoom("schedule", "month", selected);
  };

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
      runZoom("schedule", "entry", id);
    },
    [all, runZoom],
  );

  const closeEntry = () => {
    runZoom("entry", "schedule", focusedId ?? "");
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
      // surface to the book first, then turn it to today
      runZoom("entry", "schedule", focusedId ?? "");
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
      if (isAfter(next, currentMonth)) return;
      setVisibleMonth(next);
      monthFeedRef.current?.goTo(next, true);
    } else {
      const next = visibleYear + delta;
      if (next > today.getFullYear() || next <= today.getFullYear() - RANGE_YEARS)
        return;
      setVisibleYear(next);
      yearFeedRef.current?.goTo(next, true);
    }
  };

  const showMonthLayer = view === "month" || zoom?.from === "month";
  const showYearLayer = view === "year" || zoom?.from === "year";
  const showScheduleLayer = view === "schedule" || zoom?.from === "schedule";
  const showEntryLayer = view === "entry" || zoom?.from === "entry";

  return (
    <div className="page-settle">
      <header className="mb-6">
        <h1 className="voice-display ink-bleed text-[2.5rem] leading-[1.02] sm:text-[2.9rem]">
          Calendar
        </h1>
        {stats && stats.daysWithEntries > 0 && (
          <p className="mt-2.5 font-serif text-[0.92rem] italic text-ink-soft">
            collected on <NumberFlow value={stats.daysWithEntries} />{" "}
            {stats.daysWithEntries === 1 ? "day" : "days"}
            {stats.longestStreak > 1 && (
              <>
                {" "}
                · longest run <NumberFlow value={stats.longestStreak} />
              </>
            )}
          </p>
        )}
      </header>

      {/* title row: the title always climbs one altitude; it follows
          whichever feed is scrolling beneath it */}
      <div className="flex items-baseline justify-between">
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
            <span aria-hidden="true" className="mr-1 text-[1rem] text-ink-faint">
              ‹
            </span>
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
        {/* the navigation controls have no business in a single entry —
            they fade out and yield their width so the full date never
            wraps */}
        <div
          className={cn(
            "flex shrink-0 items-baseline gap-1 transition-opacity duration-[var(--dur-base)] ease-[var(--ease-out)]",
            view === "entry" && "pointer-events-none w-0 overflow-hidden opacity-0",
          )}
          aria-hidden={view === "entry"}
        >
          {/* always in the row — appearing must never reflow the page */}
          <button
            type="button"
            onClick={goToday}
            disabled={atToday || view === "entry"}
            aria-hidden={atToday}
            className={cn(
              "voice-label pressable mr-2 rounded-[5px] px-2 py-1 leading-none text-wax hover:bg-accent",
              atToday && "opacity-0",
            )}
          >
            Today
          </button>
          <button
            type="button"
            aria-label={view === "year" ? "Previous year" : "Previous month"}
            onClick={() => stepFeed(-1)}
            disabled={
              view === "entry" || (view === "schedule" && !scheduleTarget(-1))
            }
            className="pressable rounded-[5px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft hover:bg-accent hover:text-ink disabled:opacity-30"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label={view === "year" ? "Next year" : "Next month"}
            onClick={() => stepFeed(1)}
            disabled={
              view === "month"
                ? isSameMonth(visibleMonth, currentMonth)
                : view === "year"
                  ? visibleYear >= today.getFullYear()
                  : view === "entry" || !scheduleTarget(1)
            }
            className="pressable rounded-[5px] px-2.5 py-1 font-serif text-lg leading-none text-ink-soft hover:bg-accent hover:text-ink disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      {/* the weekday rail exists only at the month altitude; elsewhere
          it folds shut so content sits flush under the title, and its
          hairline — the line where the scroll area terminates — rides
          along to sit beneath the month header */}
      <div
        className={cn(
          "mt-3 grid border-b border-rule-faint transition-[grid-template-rows] duration-[var(--dur-slow)] ease-[var(--ease-out)]",
          view === "month" ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div
            role="row"
            className={cn(
              "grid grid-cols-7 transition-opacity duration-150",
              view === "month" ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={view !== "month"}
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

      {/* the stage: all three altitudes live here; the camera moves
          between them, and the frame grows when the book is open */}
      <div
        ref={stageRef}
        className={cn(
          "relative overflow-hidden transition-[height] duration-[var(--dur-slow)] ease-[var(--ease-out)]",
          view === "month" || view === "year"
            ? "h-[23rem] sm:h-[26rem]"
            : "h-[min(34rem,62dvh)]",
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
          className={cn(
            "absolute inset-0",
            !showMonthLayer && "invisible",
            (zoom || !showMonthLayer) && "pointer-events-none",
          )}
        >
          <MonthFeed
            handleRef={monthFeedRef}
            active={view === "month" && !zoom}
            today={today}
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
            counts={counts}
            onPickMonth={pickMonth}
            onVisible={setVisibleYear}
          />
        </div>
        <div
          ref={scheduleLayerRef}
          data-layer="schedule"
          className={cn(
            "absolute inset-0",
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
          className={cn(
            // pt-2 mirrors the schedule card's gap below its date rule,
            // so the expanded card keeps that same breath under the title
            "absolute inset-0 pt-2",
            !showEntryLayer && "invisible",
            (zoom || !showEntryLayer) && "pointer-events-none",
          )}
        >
          <EntryView snippet={focused} />
        </div>
      </div>
    </div>
  );
}

/* ── the month feed ─────────────────────────────────────────────── */

function MonthFeed({
  handleRef,
  active,
  today,
  counts,
  selected,
  onPick,
  onVisible,
}: {
  handleRef: React.MutableRefObject<MonthFeedHandle | null>;
  active: boolean;
  today: Date;
  counts: Map<string, number> | undefined;
  selected: string;
  onPick: (key: string) => void;
  onVisible: (m: Date) => void;
}) {
  const currentMonth = startOfMonth(today);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const [metrics, setMetrics] = useState<{ w: number; h: number; labelH: number } | null>(null);
  const [scrollY, setScrollY] = useState<number | null>(null);
  const visibleIdxRef = useRef(-1);
  const rafRef = useRef(0);
  const didInit = useRef(false);

  const geom = useMemo(
    () =>
      // the hand-over row is barely taller than its text: the label's
      // line box plus 4px of air above and 4px down to the rule
      metrics
        ? buildMonthGeom(metrics.w, metrics.labelH + 8, currentMonth)
        : null,
    // geometry depends on width + label height only (currentMonth is
    // stable) — a viewport-height blip must not rebuild it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics?.w, metrics?.labelH],
  );
  const geomRef = useRef<MonthGeom | null>(null);
  useLayoutEffect(() => {
    geomRef.current = geom;
  }, [geom]);

  const indexOfMonth = useCallback(
    (m: Date) => {
      const diff = monthsBetween(m, currentMonth);
      return Math.min(RANGE_MONTHS - 1, Math.max(0, RANGE_MONTHS - 1 - diff));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
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
      el.scrollTop = geom.offsets[idx];
    } else if (visibleIdxRef.current >= 0) {
      el.scrollTop = geom.offsets[visibleIdxRef.current];
    }
    // `selected` only seeds the very first position
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geom, indexOfMonth]);

  const goTo = useCallback(
    (m: Date, smooth: boolean) => {
      const el = scrollerRef.current;
      const g = geomRef.current;
      if (!el || !g) return;
      const top = g.offsets[indexOfMonth(startOfMonth(m))];
      setScrollY(top); // window renders the destination immediately
      visibleIdxRef.current = -1;
      el.scrollTo({ top, behavior: smooth ? "smooth" : "instant" });
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
      const vi = indexAt(g.switchY, top);
      if (vi !== visibleIdxRef.current) {
        visibleIdxRef.current = vi;
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
        // floored one viewport past the last offset so the current month
        // can stand flush at the top like any other — otherwise the
        // browser clamps the landing and the feed stops short of it
        <div
          className="relative"
          style={{
            height: Math.max(
              geom.total,
              geom.offsets[geom.offsets.length - 1] + viewH,
            ),
          }}
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
                selected={selected}
                onPick={onPick}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MonthBlock({
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
}

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
  currentYear: number,
): YearGeom {
  const cols = typeof window !== "undefined" && window.innerWidth >= 640 ? 4 : 3;
  const rows = 12 / cols;
  const miniW = (width - (cols - 1) * MINI_GAP) / cols;
  // mini: padding 10 ×2 + label + gap-1.5 + fixed six dot-rows + border 2
  const dots = 6 * MINI_DOT + 5 * 3;
  const miniH = 2 + 20 + miniLabelH + 6 + dots;
  const blockH = labelH + rows * miniH + (rows - 1) * MINI_GAP;
  const years: number[] = [];
  const offsets: number[] = [];
  let y = 0;
  for (let i = RANGE_YEARS - 1; i >= 0; i--) {
    years.push(currentYear - i);
    offsets.push(y);
    y += blockH + YEAR_GAP;
  }
  return { years, offsets, total: y - YEAR_GAP + 32, cols, miniW, miniH, labelH, blockH };
}

function YearFeed({
  handleRef,
  active,
  today,
  counts,
  onPickMonth,
  onVisible,
}: {
  handleRef: React.MutableRefObject<YearFeedHandle | null>;
  active: boolean;
  today: Date;
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
  const rafRef = useRef(0);
  const didInit = useRef(false);

  const geom = useMemo(
    () =>
      metrics
        ? buildYearGeom(metrics.w, metrics.labelH, metrics.miniLabelH, currentYear)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics?.w, metrics?.labelH, metrics?.miniLabelH],
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
  // is real; re-anchor the visible year when geometry truly changes
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !geom) return;
    if (!didInit.current) {
      didInit.current = true;
      const idx = geom.offsets.length - 1;
      visibleRef.current = idx;
      el.scrollTop = geom.offsets[idx];
    } else if (visibleRef.current >= 0) {
      el.scrollTop = geom.offsets[visibleRef.current];
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
        onVisible(g.years[vi]);
      }
    });
  };

  const viewH = metrics?.h ?? 400;
  // before any scroll has landed, the window hangs on the current year
  const anchorY = scrollY ?? (geom ? geom.offsets[geom.offsets.length - 1] : 0);
  const from = geom ? indexAt(geom.offsets, anchorY - viewH) : 0;
  const to = geom ? indexAt(geom.offsets, anchorY + 2 * viewH) : 0;

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
        <div
          className="relative"
          style={{
            height: Math.max(
              geom.total,
              geom.offsets[geom.offsets.length - 1] + viewH,
            ),
          }}
        >
          {geom.years.slice(from, to + 1).map((y, k) => (
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
          ))}
        </div>
      )}
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

  return (
    <div
      ref={scrollerRef}
      onScroll={active ? onScroll : undefined}
      className="relative h-full overflow-y-auto overscroll-contain [overflow-anchor:none]"
      style={{ scrollbarWidth: "none" }}
      tabIndex={-1}
    >
      {rows?.map((row, i) => {
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
                      withRule={row.snippets.length > 0}
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
      })}
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

/* ── the focused entry: one card, the whole stage ────────────────── */

function EntryView({ snippet }: { snippet: Snippet | null }) {
  // one tile, grown to fill the stage — the same paper material as the
  // schedule card it expanded from, so the FLIP reads as that very card
  // opening. The zoom drives [data-entry-card]'s box and fades the
  // content in; the date now lives in the header, so no header here.
  return (
    <div
      data-entry-card
      className="flex h-full flex-col overflow-hidden rounded-[10px] border border-rule-faint bg-paper shadow-[inset_0_1px_0_var(--press-highlight),0_1px_3px_rgb(var(--shadow-hue)/0.08)]"
      style={{ transformOrigin: "0 0" }}
    >
      <div
        data-entry-card-content
        className="overflow-y-auto overscroll-contain px-4 pb-4 pt-3 [overflow-anchor:none]"
        style={{ scrollbarWidth: "none" }}
        tabIndex={-1}
      >
        {snippet ? (
          // the clutter the tiles refuse — time, kind, tags, actions —
          // belongs here, where one entry has the reader's full attention
          <SnippetEntry snippet={snippet} showTitle={false} dense />
        ) : (
          <p className="voice-prose italic text-ink-soft">Let go.</p>
        )}
      </div>
    </div>
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
        "inline-grid align-baseline transition-[grid-template-columns,opacity] duration-[var(--dur-slow)] ease-[var(--ease-out)]",
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
  withRule = false,
}: {
  day: string;
  /** separate the composer from entries standing above it */
  withRule?: boolean;
}) {
  const [text, setText] = useState("");
  const [stamped, setStamped] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const stampTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isToday = day === dayKey();
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
    <div className={cn("pt-1", withRule && "mt-2 border-t border-rule-faint pt-3")}>
      {/* the field runs the full width of the cards above it — the Keep
          button drops below so it never crops the line and forces wraps */}
      <div className="flex items-end gap-2">
        {isToday && !withRule && (
          <span className="mb-2 shrink-0" aria-hidden="true">
            <StampMark />
          </span>
        )}
        <textarea
          ref={areaRef}
          value={text}
          rows={1}
          placeholder={
            isToday
              ? "Add something from today…"
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
          className="voice-prose min-h-[2.2rem] w-full flex-1 resize-none overflow-hidden border-b border-rule bg-transparent pb-1 text-[1rem] outline-none transition-colors duration-150 placeholder:italic placeholder:text-ink-faint focus:border-ink-soft"
        />
      </div>
      {hasText && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => void keep()}
            className={cn(
              "rounded-[5px] bg-paper-raised px-3 py-1.5 font-serif text-[0.9rem] text-ink",
              "shadow-[inset_0_1px_0_var(--press-highlight),0_0_0_1px_rgb(var(--shadow-hue)/0.1),0_1px_2px_rgb(var(--shadow-hue)/0.1)]",
              "transition-[transform,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
              "active:translate-y-px active:scale-[0.97] active:shadow-[inset_0_1px_3px_rgb(0_0_0/0.12)]",
            )}
          >
            Keep
          </button>
        </div>
      )}
      {/* the line is always reserved: un-mounting it reshaped the last
          row, transiently clamped the scroller, and woke the spy */}
      <p
        role="status"
        className={cn(
          "mt-1.5 h-5 font-serif text-[0.85rem] not-italic text-wax",
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
