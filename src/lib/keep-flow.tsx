"use client";

/* The seam that lets a dev surface (the schedule-submit lab) drive the
   calendar's keep with a chosen submission FLOW, while production renders no
   provider — so the context is null and the existing keep behaviour runs
   unchanged. When a flow IS provided, BackfillCapture/ScheduleCards switch to
   the keep-sequence engine + the canvas quill seal. */

import { createContext, useContext } from "react";
import type { FlowSpec, QuillSet } from "@/components/schedule/keep-sequence";
import type { Snippet } from "@/lib/types";

/** how a deleted card leaves: dissolve in place (fade + sink), a plain quick
    fade, or a swipe off to the right. Production picks a default; the lab
    toggles to compare. */
export type DeleteLeave = "dissolve" | "fade" | "swipe";

export type KeepFlow = {
  spec: FlowSpec;
  quillSet: QuillSet;
  reduce: boolean;
  /** the delete-leave style to preview (lab); production uses its default. */
  deleteLeave?: DeleteLeave;
};

export const KeepFlowContext = createContext<KeepFlow | null>(null);

/** null in production (no provider); a flow config inside the lab. */
export function useKeepFlow(): KeepFlow | null {
  return useContext(KeepFlowContext);
}

/* Optimistic kept cards. The composer publishes the just-kept snippet here so
   ScheduleCards can render it IN its final slot the instant the seal is pressed
   — the typed words never blink out waiting for the Dexie live query. When the
   real row arrives (same id) the draft is cleared, a seamless hand-off. Keyed by
   day so each day's composer owns its own draft. Null with no provider. */
export type KeptDraftStore = {
  drafts: Record<string, Snippet>;
  set: (snippet: Snippet) => void;
  clear: (day: string) => void;
};

export const KeptDraftContext = createContext<KeptDraftStore | null>(null);

export function useKeptDraft(): KeptDraftStore | null {
  return useContext(KeptDraftContext);
}

/* When a dev surface consolidates the "today" entry into a single bottom zone
   (the today-zone lab), the per-day inline composer is suppressed so the zone
   is the only place to add. Production has no provider → false → unchanged. */
export const ConsolidatedTodayContext = createContext(false);
export function useConsolidatedToday(): boolean {
  return useContext(ConsolidatedTodayContext);
}
