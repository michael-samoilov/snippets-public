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
  set: (snippet: Snippet) => void;
  clear: (day: string) => void;
};

export const KeptDraftContext = createContext<KeptDraftStore | null>(null);

export function useKeptDraft(): KeptDraftStore | null {
  return useContext(KeptDraftContext);
}
