"use client";

import {
  applyEnrichment,
  markEnrichment,
  pendingEnrichment,
} from "@/lib/db";
import { getSettings } from "@/lib/settings";
import type { Enrichment, Snippet, SnippetKind } from "@/lib/types";
import { KINDS } from "@/lib/types";

/**
 * Filing happens quietly after a capture. The writer never waits on it:
 * the entry is already kept; this only adds a title, kind, and tags.
 * If the endpoint is missing, unconfigured, or offline, we fall back to
 * small heuristics and leave the rest to one-tap chips.
 */

const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["“", "”"],
  ["'", "'"],
];

/** Conservative local guesses — only what's nearly certain from the text. */
export function heuristicEnrichment(text: string): Partial<Enrichment> {
  const trimmed = text.trim();
  const result: Partial<Enrichment> = {};

  for (const [open, close] of QUOTE_PAIRS) {
    if (trimmed.startsWith(open) && trimmed.includes(close)) {
      result.kind = "quote";
      break;
    }
  }
  // "... — Mary Oliver" / "... - Mary Oliver" attribution tails
  const attribution = trimmed.match(/[—–-]\s*([A-Z][\w.'-]*(?:\s+[A-Z][\w.'-]*){0,4})\s*$/);
  if (attribution && result.kind === "quote") {
    result.attribution = attribution[1];
  }
  return result;
}

function isEnrichment(data: unknown): data is Enrichment {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.title === "string" &&
    typeof d.kind === "string" &&
    KINDS.includes(d.kind as SnippetKind) &&
    Array.isArray(d.tags)
  );
}

export async function enrichSnippet(snippet: Snippet): Promise<void> {
  if (!getSettings().autoFile) {
    await markEnrichment(snippet.id, "off");
    return;
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return; // stays pending; retried on reconnect
  }

  try {
    const response = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: snippet.text }),
      signal: AbortSignal.timeout(25_000),
    });

    if (response.status === 429) return; // stays pending; retried later

    if (!response.ok) {
      await fallBack(snippet);
      return;
    }

    const data: unknown = await response.json();
    if (!isEnrichment(data)) {
      await fallBack(snippet);
      return;
    }
    await applyEnrichment(snippet.id, {
      title: data.title,
      kind: data.kind,
      tags: data.tags.filter((t): t is string => typeof t === "string"),
      attribution: typeof data.attribution === "string" ? data.attribution : undefined,
    });
  } catch {
    // network failure mid-flight: leave pending for the retry sweep
  }
}

async function fallBack(snippet: Snippet): Promise<void> {
  const guess = heuristicEnrichment(snippet.text);
  if (guess.kind) {
    await applyEnrichment(snippet.id, guess);
  } else {
    await markEnrichment(snippet.id, "failed");
  }
}

let sweeping = false;

/** Re-attempt anything still waiting — on app start and on reconnect. */
export function retryPendingEnrichment(): void {
  if (sweeping) return;
  sweeping = true;
  (async () => {
    try {
      const waiting = await pendingEnrichment();
      for (const snippet of waiting) {
        await enrichSnippet(snippet);
      }
    } finally {
      sweeping = false;
    }
  })().catch(() => {
    sweeping = false;
  });
}
