import { addMonths, endOfMonth, format, getDay, startOfMonth } from "date-fns";

export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"]; // Sunday-first labels
/** the weekday labels rotated to the chosen first day of the week. */
export function weekdays(weekStart: 0 | 1): string[] {
  return weekStart === 1 ? [...WEEKDAYS.slice(1), WEEKDAYS[0]] : WEEKDAYS;
}
/** columns (0–6) from the week's first day to `date`'s own weekday. */
export function leadOffset(date: Date, weekStart: 0 | 1): number {
  return (getDay(date) - weekStart + 7) % 7;
}
export const ringSpring = { type: "spring", stiffness: 380, damping: 30 } as const;
export const ym = (d: Date) => format(d, "yyyy-MM");

/* ── feed geometry: decades of time, computed, never reflowed ──────
   The feeds are virtualized over arithmetic offsets inside one
   fixed-height spacer. Nothing is ever inserted above the reader and
   scrollTop is never written during a gesture — the recording showed
   iOS killing fling momentum the instant the old windowed feed
   compensated scroll positions mid-flight. */

export const YEAR_GAP = 24; // between year blocks
export const MINI_GAP = 8; // gap-2 between minis
export const MINI_DOT = 3;

export function monthRows(m: Date, weekStart: 0 | 1): number {
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
export function settleBottom(scroller: HTMLElement, spacer: HTMLElement) {
  scroller.scrollTop = Math.floor(spacer.getBoundingClientRect().height);
}

export function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export interface MonthGeom {
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

export function buildMonthGeom(
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

/** last index whose offset is at or before y */
export function indexAt(offsets: number[], y: number): number {
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

export interface MonthFeedHandle {
  goTo: (m: Date, smooth: boolean) => void;
  /** center + width of a day's cell, relative to the layer viewport */
  originFor: (day: string) => { x: number; y: number; w: number } | null;
}
export interface YearFeedHandle {
  goTo: (y: number, smooth: boolean) => void;
  /** center + width of a month's mini, relative to the layer viewport */
  originFor: (ymKey: string) => { x: number; y: number; w: number } | null;
}

export function autosizeArea(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}
