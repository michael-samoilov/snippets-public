"use client";

import { allSnippetsNewestFirst, importSnippets } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import { renderArchiveJSON, renderMarkdown } from "@/lib/render-book";
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
  download(
    `snippets-${dayKey()}.json`,
    renderArchiveJSON(snippets, new Date()),
    "application/json",
  );
}

export async function exportMarkdown(): Promise<void> {
  const snippets = await allSnippetsNewestFirst();
  download(
    `snippets-${dayKey()}.md`,
    renderMarkdown(snippets),
    "text/markdown",
  );
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
