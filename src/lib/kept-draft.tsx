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
  // ids whose LIVE row must not render yet. The keep's DB write happens AT
  // SUBMIT (a keep is a promise — it must survive the reader leaving, even a
  // tab close, so it cannot wait on an animation timer), but the card's
  // appearance belongs to the seal choreography's beat. A held id keeps the
  // early-arriving live row invisible until the beat sets the draft and
  // ScheduleCards releases the hold in its hand-off effect. Holds are
  // in-memory: a torn-down session renders the row normally on reopen.
  heldIds: ReadonlySet<string>;
  hold: (id: string) => void;
  release: (id: string) => void;
  set: (snippet: Snippet, morph?: boolean) => void;
  clear: (day: string) => void;
};

export const KeptDraftContext = createContext<KeptDraftStore | null>(null);

export function useKeptDraft(): KeptDraftStore | null {
  return useContext(KeptDraftContext);
}
