/**
 * Calm placeholders for the calendar's non-schedule altitudes — shown while a
 * feed's chunk is still loading or its geometry is being measured (a deep-link
 * that lands in the year glance or the month grid, where the layer would
 * otherwise sit blank until the real feed paints).
 *
 * They pre-echo each view's real shape in its own material: the month grid's
 * ruled 7-wide cells, the year's paper mini-tiles. Every count and offset is a
 * fixed pattern (never random) so the server and client paint the same
 * skeleton, and a steady rhythm reads quieter than noise. The bars stand in the
 * faint rule colour — grain, not ink — so nothing reads as a real entry.
 *
 * The schedule/book skeleton lives beside its feed (LedgerRows in
 * calendar/page.tsx), where it's shared with the SSR fallback.
 */

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
          className="absolute bottom-[3.25px] h-2.5 w-9 -translate-x-1/2 rounded-[2px]"
          style={{ background: "var(--rule-faint)", left: `${((lead + 0.5) / 7) * 100}%` }}
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
            <span
              className="h-2.5 w-3 rounded-[2px]"
              style={{ background: "var(--rule-faint)" }}
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

const MONTH_MINIS = Array.from({ length: 12 });

function MiniSkel({ month }: { month: number }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[6px] border border-rule-faint bg-paper p-2.5 shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.06)]">
      <span className="h-2.5 w-7 rounded-[2px]" style={{ background: "var(--rule-faint)" }} />
      <span className="grid grid-cols-7 gap-[3px]">
        {Array.from({ length: 42 }).map((_, i) => {
          // a sparse, deterministic scatter of "kept" days so the mini reads as
          // a real month with a few entries, not an empty grid
          const kept = (month * 13 + i * 7) % 11 === 0;
          return (
            <span
              key={i}
              className="size-[3px] rounded-full"
              style={{ background: kept ? "var(--ink-faint)" : "var(--rule-faint)" }}
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
      <span
        className="mb-1.5 block h-2.5 w-10 rounded-[2px]"
        style={{ background: "var(--rule-faint)" }}
      />
      <div className="grid grid-cols-2 gap-2.5 min-[380px]:grid-cols-3 sm:grid-cols-4">
        {MONTH_MINIS.map((_, i) => (
          <MiniSkel key={i} month={i} />
        ))}
      </div>
    </div>
  );
}
