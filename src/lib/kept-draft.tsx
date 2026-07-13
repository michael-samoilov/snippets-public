"use client";

/* Optimistic kept cards. The composer publishes the just-kept snippet here so
   ScheduleCards can render it IN its final slot the instant the seal is pressed
   — the typed words never blink out waiting for the Dexie live query. When the
   real row arrives (same id) the draft is cleared: a seamless hand-off. Keyed by
   day so each day's composer owns its own draft. */

import { createContext, useContext } from "react";
import type { Snippet } from "@/lib/types";

export type KeptDraftStore = {
  drafts: Record<string, Snippet>;
  // days whose current draft was born from an in-place composer (a backfill
  // keep): its card should take the composer's exact slot with NO birth wipe —
  // a seamless composer→card morph. A today-zone keep omits `morph`, so its
  // card still plays the designed wipe-in from the left.
  morphDays: ReadonlySet<string>;
  set: (snippet: Snippet, morph?: boolean) => void;
  clear: (day: string) => void;
};

export const KeptDraftContext = createContext<KeptDraftStore | null>(null);

export function useKeptDraft(): KeptDraftStore | null {
  return useContext(KeptDraftContext);
}
