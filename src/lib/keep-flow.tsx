"use client";

/* The seam that lets a dev surface (the schedule-submit lab) drive the
   calendar's keep with a chosen submission FLOW, while production renders no
   provider — so the context is null and the existing keep behaviour runs
   unchanged. When a flow IS provided, BackfillCapture/ScheduleCards switch to
   the keep-sequence engine + the canvas quill seal. */

import { createContext, useContext } from "react";
import type { FlowSpec, QuillSet } from "@/components/schedule/keep-sequence";

/** how a deleted card leaves: dissolve in place (fade + sink) or a plain
    quick fade. Production picks a default; the lab toggles to compare. */
export type DeleteLeave = "dissolve" | "fade";

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
