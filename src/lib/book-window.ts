/**
 * Book windowing geometry — the pure math under the virtualized schedule.
 *
 * The book renders every kept entry; on a years-deep book that is hundreds of
 * live cards, which jetsam-kills iOS (the FLAT-BOOK LAW in globals.css). The
 * durable fix is to keep only the on-screen rows in the DOM, with spacers
 * holding the scroll height for the rest — so per-row cost stops scaling with
 * the book. This module is the geometry half: given each row's height (an
 * estimate from its text until it's measured), it answers "what should the
 * scroll height be", "which rows fall in the window for this scrollTop", and
 * "which day is the reader on" — all WITHOUT ever writing scrollTop (that would
 * kill iOS fling momentum; see components/calendar/shared.ts). It is
 * intentionally pure and side-effect-free so it can be unit-tested to death,
 * quick-fling included.
 */

/** Layout constants, tuned to the schedule card (see ScheduleCards). Only used
 *  to ESTIMATE an unmeasured row; a real measurement always replaces the guess,
 *  so small errors just cost a hair of first-traversal drift, never a crash. */
const LINE_H = 21; // 0.9rem × 1.42 line-height ≈ 21px
const CLAMP_LINES = 6; // .line-clamp-6
const CHARS_PER_LINE = 34; // ~width of the card's text column at 0.9rem
const CARD_CHROME = 24; // a card's own padding (p-2.5) + the gap-1 below it
const SECTION_CHROME = 21; // the section's top padding + rule
const MONTH_HEADER = 44; // the "July 2026" band when a new month opens
export const COMPOSER_H = 96; // a BackfillCapture row (yesterday's invite / the probe)
const MIN_ROW = 44; // a collapsed/empty section still reserves a touch target

export interface BookRowShape {
  /** rendered lines the day's cards will take, summed and clamped per card */
  lines: number;
  cards: number;
  newMonth: boolean;
  showComposer: boolean;
}

/** Estimate one day-section's rendered height from the shape of its content. */
export function estimateRowHeight(r: BookRowShape): number {
  let h = SECTION_CHROME;
  h += r.cards * CARD_CHROME + r.lines * LINE_H;
  if (r.showComposer) h += COMPOSER_H;
  if (r.newMonth) h += MONTH_HEADER;
  return Math.max(h, MIN_ROW);
}

/** Rendered line-count of a card's text under the clamp (used by the estimate
 *  and cheap enough to call per card). */
export function estimateCardLines(text: string): number {
  let lines = 0;
  for (const para of text.split("\n"))
    lines += Math.max(1, Math.ceil(para.length / CHARS_PER_LINE));
  return Math.min(CLAMP_LINES, lines);
}

/** Cumulative top offset of every row plus a trailing total, from per-row
 *  heights. `offsets[i]` is the scroll position of row i's top; `offsets[n]`
 *  (== total) is the full content height. O(n), rebuilt when a measurement
 *  lands. */
export function buildOffsets(heights: number[]): {
  offsets: number[];
  total: number;
} {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let i = 0; i < heights.length; i++) offsets[i + 1] = offsets[i] + heights[i];
  return { offsets, total: offsets[heights.length] };
}

/** Largest index i in [0, n] with offsets[i] <= x (or 0 if none). Binary
 *  search — the scroll path must never scan all rows. */
function lastAtOrBelow(offsets: number[], x: number): number {
  let lo = 0,
    hi = offsets.length - 1,
    ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** The row the reader is "on": the one whose span contains `scrollTop`
 *  (clamped to a valid row index). Drives the title/day spy. */
export function dayIndexAt(offsets: number[], scrollTop: number): number {
  const n = offsets.length - 1; // row count
  if (n <= 0) return 0;
  const i = lastAtOrBelow(offsets, scrollTop);
  return Math.min(i, n - 1);
}

/**
 * The rows to render for a given scrollTop: everything intersecting the
 * viewport, GROWN by `overscanVp` viewports on each side. The overscan is what
 * makes a quick fling seamless — a fling has to jump more than `overscanVp`
 * viewports in a single frame to outrun the rendered band and expose a spacer.
 * Returns a half-open range [start, end). Never empty for a non-empty book.
 */
export function windowRange(
  offsets: number[],
  scrollTop: number,
  viewportH: number,
  overscanVp = 2,
): { start: number; end: number } {
  const n = offsets.length - 1;
  if (n <= 0) return { start: 0, end: 0 };
  const pad = viewportH * overscanVp;
  const top = scrollTop - pad;
  const bot = scrollTop + viewportH + pad;
  const start = Math.min(lastAtOrBelow(offsets, top), n - 1);
  // end = first row whose TOP is at/after bot → exclusive bound
  let end = lastAtOrBelow(offsets, bot) + 1;
  if (end <= start) end = start + 1;
  if (end > n) end = n;
  return { start, end };
}

/** Two ranges are the same window (lets the caller skip a re-render when a
 *  scroll frame doesn't cross a row boundary). */
export function sameRange(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start === b.start && a.end === b.end;
}
