import Link from "next/link";

/**
 * The page-load skeletons, held on screen for inspection. Each links to the REAL
 * calendar with `?skeldebug=<view>`, which parks that skeleton (the actual
 * CalendarSkeleton — header, weekday rail, and all) instead of flashing past in
 * the Suspense gap. Listed in the /lab menu (auto-scanned).
 */
export const dynamic = "force-static";

const VIEWS = [
  { key: "today", note: "the today zone (the home skeleton)" },
  { key: "schedule", note: "the book — ruled day rows (LedgerRows)" },
  { key: "month", note: "the month grid, shimmering as one wave" },
  { key: "year", note: "the year glance — 12 minis" },
  { key: "entry", note: "an open entry card" },
] as const;

export default function SkeletonsMenu() {
  return (
    <div style={{ minHeight: "100vh", background: "#e8dcc2", color: "#241e15", padding: 24, fontFamily: "ui-monospace, monospace" }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>
        <p style={{ marginBottom: 4 }}>
          <Link href="/lab" style={{ color: "#6f6553", textDecoration: "none" }}>← lab</Link>
        </p>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>skeletons</h1>
        <p style={{ color: "#6f6553", fontSize: 13, marginBottom: 20 }}>
          Page-load skeletons, held on the real calendar via <code>?skeldebug</code>. A quiet
          pill marks that you&rsquo;re parked in the held view.
        </p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {VIEWS.map((v) => (
            <li key={v.key}>
              <Link
                href={`/calendar?skeldebug=${v.key}`}
                style={{ color: "#1e3a5f", textDecoration: "none", fontWeight: 600 }}
              >
                {v.key}
              </Link>
              <span style={{ color: "#6f6553", fontSize: 13 }}> — {v.note}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
