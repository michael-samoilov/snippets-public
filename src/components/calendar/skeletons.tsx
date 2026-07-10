"use client";

/**
 * Calm placeholders for the calendar's altitudes — shown while a feed's chunk
 * is still loading or its geometry is being measured (a deep-link that lands in
 * the year glance or the month grid, where the layer would otherwise sit blank
 * until the real feed paints), and for the today zone the book opens onto.
 *
 * They pre-echo each view's real shape in its own material: the today zone's
 * framed composition, the month grid's ruled 7-wide cells, the year's paper
 * mini-tiles. The bars and dots stand in the faint rule colour — grain, not
 * ink — and a warm sheen sweeps across them (.skeleton-shimmer), collapsing to
 * a static fill under reduced motion.
 *
 * These render only on the client (the SSR shell is always the today zone; the
 * month/year skeletons are a dynamic-import loading state), so the year mini
 * may read the real calendar. The schedule/book ledger skeleton lives beside
 * its feed (LedgerRows in calendar/page.tsx).
 */

import { leadOffset } from "./shared";
import { useSettings } from "@/lib/settings";

const FAINT = { backgroundColor: "var(--rule-faint)" } as const;

// The date columns fire the fast .skeleton-shimmer-datewave in turn, one buffer
// B = 0.08s apart (0→0.48s across the seven columns). Column 6's 0.16s sweep
// then lands at 0.64s, exactly when the non-date sweep (L = 0.64s) ends — so the
// whole left→right wave spans one non-date flash, no more. The non-date
// placeholders (header, month labels) run .skeleton-shimmer-wave at zero delay.
// (See the timing derivation in globals.css: 6·B + L/4 = L.)
const dateWaveDelay = (col: number) =>
  ({ animationDelay: `${col * 0.08}s` }) as const;

/* ── today: the zone the book opens onto — the most common landing ────
   Mirrors TodayZoneFill's composition: the wax-outlined frame, the date
   seated high, the ruled composer field centred in the slack, and the wax
   seal resting near the foot. The date is bars, not the real day, so the
   server and client can't disagree on the local date. */
export function TodaySkeleton() {
  return (
    <div className="flex h-full w-full flex-col pt-[19px]" aria-hidden="true">
      <div
        data-today-zone-box
        className="relative flex min-h-[22rem] w-full flex-1 flex-col rounded-2xl border border-wax/45"
      >
        <div className="flex flex-1 flex-col items-center gap-4 px-[8%] py-6 text-center">
          {/* today's date, seated high under the zone's top */}
          <div className="mt-[83px] flex flex-col items-center gap-2 leading-none">
            <span className="skeleton-shimmer h-2 w-16 rounded-[2px]" style={FAINT} />
            <span className="skeleton-shimmer h-6 w-32 rounded-[3px]" style={FAINT} />
          </div>
          {/* the flexible half of the field's centring slack */}
          <div className="w-px flex-1" />
          {/* the ruled composer field — three rules, a prompt bar on the first */}
          <div
            className="w-full min-w-[14rem]"
            style={{
              minHeight: 60,
              backgroundImage:
                "repeating-linear-gradient(to bottom, transparent 0, transparent 19px, var(--rule-faint) 19px, var(--rule-faint) 20px)",
              backgroundPositionY: "-4px",
            }}
          >
            <div className="flex h-5 items-center">
              <span className="skeleton-shimmer h-[9px] w-3/5 rounded-[2px]" style={FAINT} />
            </div>
          </div>
          {/* the rigid half of the slack, holding the seal's distance */}
          <div className="w-px flex-1" />
          {/* the wax seal's resting place */}
          <div className="mb-[58px] grid size-32 shrink-0 place-items-center">
            <span
              className="skeleton-shimmer size-28 rounded-full border border-rule-faint"
              style={FAINT}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── welcome: the first-run introduction (an empty book) ──────────────
   When nothing has been kept, the zone opens onto the intro prose instead of
   the composer — the date up top, then paragraphs that fill the sheet and push
   the seal below the fold. So this skeleton drops the ruled field and the seal
   and stands in prose lines: a short opening, a long middle, and more running
   off the bottom. Line widths are a fixed pattern (never random). */
const WELCOME_PARAS = [
  [1, 0.25],
  [1, 1, 1, 1, 1, 1, 1, 0.62],
  [0.78, 1, 1, 1, 1, 0.55],
  [1, 1, 1, 1, 1, 1, 0.4],
  [1, 0.55],
];

export function WelcomeSkeleton() {
  return (
    // pt-1, not pt-[19px]: a truly empty book seats the zone almost flush under
    // the rail (TodayZoneFill's firstEver stance), unlike the returning-visitor
    // today zone
    <div className="flex h-full w-full flex-col pt-1" aria-hidden="true">
      <div
        data-today-zone-box
        className="relative flex min-h-[22rem] w-full flex-1 flex-col overflow-hidden rounded-2xl border border-wax/45"
      >
        <div className="flex flex-1 flex-col items-center gap-4 px-[8%] py-6">
          {/* today's date, seated high under the zone's top */}
          <div className="mt-[83px] flex flex-col items-center gap-2 leading-none">
            <span className="skeleton-shimmer h-2 w-16 rounded-[2px]" style={FAINT} />
            <span className="skeleton-shimmer h-6 w-32 rounded-[3px]" style={FAINT} />
          </div>
          {/* the intro prose — paragraphs filling the sheet, left-aligned like
              the real copy, at its 0.92rem / 1.5 rhythm */}
          <div className="w-full space-y-3 text-left">
            {WELCOME_PARAS.map((para, p) => (
              <div key={p} className="text-[0.92rem] leading-[1.5]">
                {para.map((w, i) => (
                  <div key={i} className="flex h-[1.5em] items-center">
                    <span
                      className="skeleton-shimmer h-[7px] rounded-[2px]"
                      style={{ ...FAINT, width: `${w * 100}%` }}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── month: label row + a ruled 7-wide grid of day cells ──────────────── */

// two months' worth, each with a different lead offset and length, so the grid
// reads as real weeks rather than a uniform block
const MONTH_BLOCKS = [
  { lead: 3, days: 31 },
  { lead: 6, days: 30 },
];

function MonthSkelBlock({ lead, days }: { lead: number; days: number }) {
  return (
    <div className="mb-1">
      {/* the hand-over row: the month's name standing over its first day. It
          rides the same page-wide sweep as the dates below, so the label and
          its column light together. */}
      <div className="relative" style={{ height: 28 }}>
        <span
          className="skeleton-shimmer-wave absolute bottom-[3.25px] h-2.5 w-9 -translate-x-1/2 rounded-[2px]"
          style={{ ...FAINT, left: `${((lead + 0.5) / 7) * 100}%` }}
        />
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: lead }).map((_, i) => (
          <span key={`b${i}`} className="aspect-square" />
        ))}
        {Array.from({ length: days }).map((_, i) => (
          <span
            key={i}
            className="flex aspect-square flex-col items-center justify-center gap-1 border-t border-rule-faint"
          >
            {/* each column fires the fast sweep a beat after the one on its left */}
            <span
              className="skeleton-shimmer-datewave h-2.5 w-3 rounded-[2px]"
              style={{ ...FAINT, ...dateWaveDelay((lead + i) % 7) }}
            />
            {/* the dot strip is always reserved, as in the real cell */}
            <span className="h-[3.5px]" />
          </span>
        ))}
      </div>
    </div>
  );
}

export function MonthSkeleton() {
  return (
    <div className="h-full overflow-hidden" aria-hidden="true">
      {MONTH_BLOCKS.map((m, i) => (
        <MonthSkelBlock key={i} lead={m.lead} days={m.days} />
      ))}
    </div>
  );
}

/* ── year: a year label + a grid of paper mini-tiles ──────────────────── */

// Each mini lays out the real month — leading blanks so the first lands on its
// weekday, then a dot per day, then trailing blanks to a fixed 42 — for the
// CURRENT year, so the constellations match what the glance will paint (a
// 30-day month is shorter than a 31, February shorter still). Every dot reads
// the same: this is a placeholder, so none stands in for a kept day.
function MiniSkel({
  year,
  month,
  weekStart,
}: {
  year: number;
  month: number;
  weekStart: 0 | 1;
}) {
  const lead = leadOffset(new Date(year, month, 1), weekStart);
  const days = new Date(year, month + 1, 0).getDate();
  const trailing = 42 - lead - days;
  return (
    <div className="flex flex-col gap-1.5 rounded-[6px] border border-rule-faint bg-paper p-2.5 shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]">
      <span className="skeleton-shimmer h-2.5 w-7 rounded-[2px]" style={FAINT} />
      <span className="grid grid-cols-7 gap-[3px]">
        {Array.from({ length: lead }).map((_, i) => (
          <span key={`b${i}`} className="size-[3px]" />
        ))}
        {/* the dots stay static: a year holds ~360 of them, and animating every
            one is the one place the skeleton could tax the load it's masking —
            the shimmer on the month labels carries the life */}
        {Array.from({ length: days }).map((_, i) => (
          <span key={i} className="size-[3px] rounded-full" style={FAINT} />
        ))}
        {Array.from({ length: trailing }).map((_, i) => (
          <span key={`a${i}`} className="size-[3px]" />
        ))}
      </span>
    </div>
  );
}

export function YearSkeleton() {
  const { weekStart } = useSettings();
  const year = new Date().getFullYear();
  return (
    <div className="h-full overflow-hidden" aria-hidden="true">
      <span className="skeleton-shimmer mb-1.5 block h-2.5 w-10 rounded-[2px]" style={FAINT} />
      <div className="grid grid-cols-2 gap-2.5 min-[380px]:grid-cols-3 sm:grid-cols-4">
        {Array.from({ length: 12 }).map((_, m) => (
          <MiniSkel key={m} year={year} month={m} weekStart={weekStart} />
        ))}
      </div>
    </div>
  );
}

/* ── entry: the card a schedule tile opens into ───────────────────────
   The same paper card as the tile it grew from — rounded, hairline, a lit top
   edge — filled with the words' own rhythm (0.9rem × 1.42, a paragraph break or
   two, a short last line) and, at the foot, the lone resting place of the ember
   trash. */
// widths as a fraction of the line; 0 is a blank line (a paragraph gap)
const ENTRY_LINES = [1, 1, 1, 0.82, 0, 1, 1, 1, 1, 0.55, 0, 1, 1, 0.68];

export function EntrySkeleton() {
  return (
    <div className="h-full pt-2" aria-hidden="true">
      <div className="relative flex max-h-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-rule-faint bg-paper shadow-[0_1px_3px_rgb(var(--shadow-hue)/0.08)]">
        {/* the card's lit top edge, as on the real card */}
        <div className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] shadow-[inset_0_1px_0_var(--press-highlight)]" />
        {/* the words */}
        <div className="min-h-0 px-4 pt-3 text-[0.9rem] leading-[1.42]">
          {ENTRY_LINES.map((w, i) =>
            w === 0 ? (
              <div key={i} className="h-[1.42em]" />
            ) : (
              <div key={i} className="flex h-[1.42em] items-center">
                <span
                  className="skeleton-shimmer h-[7px] rounded-[2px]"
                  style={{ ...FAINT, width: `${w * 100}%` }}
                />
              </div>
            ),
          )}
        </div>
        {/* the foot: the ember trash's resting place, across the card */}
        <div className="flex items-center justify-end px-3 pb-3 pt-2.5">
          <span className="skeleton-shimmer size-[34px] rounded-full" style={FAINT} />
        </div>
      </div>
    </div>
  );
}
