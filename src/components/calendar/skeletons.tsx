/**
 * Calm placeholders for the calendar's altitudes — shown while a feed's chunk
 * is still loading or its geometry is being measured (a deep-link that lands in
 * the year glance or the month grid, where the layer would otherwise sit blank
 * until the real feed paints), and for the today zone the book opens onto.
 *
 * They pre-echo each view's real shape in its own material: the today zone's
 * framed composition, the month grid's ruled 7-wide cells, the year's paper
 * mini-tiles. Every count and offset is a fixed pattern (never random) so the
 * server and client paint the same skeleton. The bars and dots stand in the
 * faint rule colour — grain, not ink — and a warm sheen sweeps across them
 * (.skeleton-shimmer), collapsing to a static fill under reduced motion.
 *
 * The schedule/book ledger skeleton lives beside its feed (LedgerRows in
 * calendar/page.tsx), where it's shared with the SSR fallback.
 */

const FAINT = { backgroundColor: "var(--rule-faint)" } as const;

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
            <span className="skeleton-shimmer h-2.5 w-3 rounded-[2px]" style={FAINT} />
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

const MONTH_MINIS = Array.from({ length: 12 });

function MiniSkel({ month }: { month: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[6px] border border-rule-faint bg-paper p-2.5 shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]">
      <span className="skeleton-shimmer h-2.5 w-7 rounded-[2px]" style={FAINT} />
      <span className="grid grid-cols-7 gap-[3px]">
        {Array.from({ length: 42 }).map((_, i) => {
          // a sparse, deterministic scatter of "kept" days so the mini reads as
          // a real month with a few entries, not an empty grid
          const kept = (month * 13 + i * 7) % 11 === 0;
          return (
            <span
              key={i}
              className="skeleton-shimmer size-[3px] rounded-full"
              style={{ backgroundColor: kept ? "var(--ink-faint)" : "var(--rule-faint)" }}
            />
          );
        })}
      </span>
    </div>
  );
}

export function YearSkeleton() {
  return (
    <div className="h-full overflow-hidden" aria-hidden="true">
      <span className="skeleton-shimmer mb-1.5 block h-2.5 w-10 rounded-[2px]" style={FAINT} />
      <div className="grid grid-cols-2 gap-2.5 min-[380px]:grid-cols-3 sm:grid-cols-4">
        {MONTH_MINIS.map((_, i) => (
          <MiniSkel key={i} month={i} />
        ))}
      </div>
    </div>
  );
}
