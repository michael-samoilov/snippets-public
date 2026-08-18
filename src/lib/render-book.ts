/**
 * The book's archive formats, rendered by one pure module so the two
 * callers can never drift: the in-app export buttons (src/lib/export.ts)
 * and the device-side Drive delivery (src/lib/backup-client.ts). Drift
 * here would quietly break the platform-death escape hatch — the Drive
 * archive must stay bit-compatible with "Restore from JSON…".
 */
import { format } from "date-fns";
import { dateFromDayKey } from "@/lib/dates";
import { groupByDay } from "@/lib/day-groups";
import { KIND_META } from "@/lib/kinds";
import type { Snippet } from "@/lib/types";

/** The versioned snapshot "Restore from JSON…" understands. */
export function renderArchiveJSON(
  snippets: Snippet[],
  exportedAt: Date,
): string {
  const payload = {
    app: "snippets",
    version: 1,
    exportedAt: exportedAt.toISOString(),
    // _dirty is device bookkeeping, not part of the book
    snippets: snippets.map(({ _dirty, ...s }) => {
      void _dirty;
      return s;
    }),
  };
  return JSON.stringify(payload, null, 2);
}

/** Human-readable Markdown, grouped by day. Expects newest-first order. */
export function renderMarkdown(snippets: Snippet[], title = "Snippets"): string {
  const lines: string[] = [`# ${title}`, ""];
  // gather by day key rather than walking runs: a day whose entries are not
  // neighbours (two devices, two UTC offsets) used to earn a second heading
  // for the same date further down the file
  for (const { day, snippets: rows } of groupByDay(snippets)) {
    lines.push(`## ${format(dateFromDayKey(day), "EEEE, MMMM d, yyyy")}`, "");
    rows.forEach((s, i) => {
      // a thematic break between entries within a day — ten dashes, not
      // three, so it stays an unambiguous boundary even when an entry's own
      // text contains blank lines or a literal "---" (Markdown renders any
      // run of 3+ dashes as the same horizontal rule)
      if (i > 0) lines.push("----------", "");
      if (s.title) lines.push(`**${s.title}**`);
      lines.push(s.text.trim());
      if (s.attribution) lines.push(`— ${s.attribution}`);
      const meta = [
        s.kind ? KIND_META[s.kind].label.toLowerCase() : null,
        ...s.tags.map((t) => `#${t}`),
        s.favorite ? "★" : null,
      ].filter(Boolean);
      if (meta.length) lines.push(`*${meta.join(" · ")}*`);
      lines.push("");
    });
  }
  return lines.join("\n");
}

/** Newest-first, the order both archive formats expect. */
export function sortNewestFirst(snippets: Snippet[]): Snippet[] {
  return [...snippets].sort((a, b) => b.capturedAt - a.capturedAt);
}
