"use client";

import { format } from "date-fns";
import { allSnippetsNewestFirst, importSnippets } from "@/lib/db";
import { dayKey, dateFromDayKey } from "@/lib/dates";
import { KIND_META } from "@/lib/kinds";
import { KINDS, type Snippet } from "@/lib/types";
import { copy } from "@/lib/copy";

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function exportJSON(): Promise<void> {
  const snippets = await allSnippetsNewestFirst();
  const payload = {
    app: "snippets",
    version: 1,
    exportedAt: new Date().toISOString(),
    // _dirty is device bookkeeping, not part of the book
    snippets: snippets.map(({ _dirty, ...s }) => s),
  };
  download(
    `snippets-${dayKey()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json",
  );
}

export async function exportMarkdown(): Promise<void> {
  const snippets = await allSnippetsNewestFirst();
  const lines: string[] = ["# Snippets", ""];
  let currentDay = "";
  for (const s of snippets) {
    if (s.day !== currentDay) {
      currentDay = s.day;
      lines.push(`## ${format(dateFromDayKey(s.day), "EEEE, MMMM d, yyyy")}`, "");
    }
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
  }
  download(`snippets-${dayKey()}.md`, lines.join("\n"), "text/markdown");
}

/** Restore from a JSON export. Existing entries with the same id are overwritten. */
export async function importJSON(file: File): Promise<number> {
  const parsed: unknown = JSON.parse(await file.text());
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { snippets?: unknown }).snippets)
  ) {
    throw new Error(copy.data.notExportFile);
  }
  const rows = (parsed as { snippets: unknown[] }).snippets.filter(
    (row): row is Snippet => {
      if (typeof row !== "object" || row === null) return false;
      const r = row as Record<string, unknown>;
      return (
        typeof r.id === "string" &&
        typeof r.text === "string" &&
        typeof r.capturedAt === "number" &&
        typeof r.day === "string" &&
        (r.kind === null || KINDS.includes(r.kind as Snippet["kind"] & string))
      );
    },
  );
  if (rows.length === 0) throw new Error(copy.data.noEntriesInFile);
  return importSnippets(rows);
}
