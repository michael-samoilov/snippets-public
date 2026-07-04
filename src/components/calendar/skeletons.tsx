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

// The month shimmer sweeps left→right rather than lighting every cell at once.
// The seven columns are spread evenly across ONE shimmer cycle — column 0 runs
// furthest ahead (the most negative delay), column 6 at zero — so a single band
// crosses the whole grid and repeats on the very same beat as a lone element's
// shimmer, no longer.
const SHIMMER_S = 1.6; // must match .skeleton-shimmer's duration in globals.css
const waveDelay = (col: number) =>
  ({ animationDelay: `${((col - 6) / 7) * SHIMMER_S}s` }) as const;

/* ── today: the zone the book opens onto — the most common landing ────
   Mirrors TodayZoneFill's composition: the wax-outlined frame, the date
   seated high, the ruled composer field centred in the slack, and the wax
   seal resting near the foot. The date is bars, not the real day, so the
   server and client can't disagree on the local date. */
export function TodaySkeleton() {
  return (
    <div className="flex h-full w-full flex-col pt-[19px]" aria-hidden="true">
      <div className="relative flex min-h-[22rem] w-full flex-1 flex-col rounded-2xl border border-wax/45">
        <div className="flex flex-1 flex-col items-center gap-4 px-4 py-6 text-center">
          {/* today's date, seated high under the zone's top */}
          <div className="mt-[83px] flex flex-col items-center gap-2 leading-none">
            <span className="skeleton-shimmer h-2 w-16 rounded-[2px]" style={FAINT} />
            <span className="skeleton-shimmer h-6 w-32 rounded-[3px]" style={FAINT} />
          </div>
          {/* the flexible half of the field's centring slack */}
          <div className="w-px flex-1" />
          {/* the ruled composer field — three rules, a prompt bar on the first */}
          <div
            className="w-[calc(100%-29.6px)] min-w-[14rem]"
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
      {/* the hand-over row: the month's name standing over its first day */}
      <div className="relative" style={{ height: 28 }}>
        <span
          className="skeleton-shimmer absolute bottom-[3.25px] h-2.5 w-9 -translate-x-1/2 rounded-[2px]"
          style={{ ...FAINT, left: `${((lead + 0.5) / 7) * 100}%`, ...waveDelay(lead) }}
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
            {/* delayed by the cell's column, so the sheen crosses the page */}
            <span
              className="skeleton-shimmer h-2.5 w-3 rounded-[2px]"
              style={{ ...FAINT, ...waveDelay((lead + i) % 7) }}
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
        {Array.from({ length: days }).map((_, i) => (
          <span key={i} className="skeleton-shimmer size-[3px] rounded-full" style={FAINT} />
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
