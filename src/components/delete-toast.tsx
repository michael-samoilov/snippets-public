"use client";

import { toast } from "sonner";
import { copy } from "@/lib/copy";

/** how long the undo window stays open — the sweep is timed to match */
export const DELETE_TOAST_MS = 5000;

/**
 * The undo toast raised when an entry is let go. A soft ember wash fills the
 * pill left→right over the whole window; when it reaches the far edge, the
 * toast leaves and the deletion settles. The wash tells the hand how much time
 * is left to catch it. Ember is destructive's colour alone — this is that clock.
 */
function DeleteToast({ id, onUndo }: { id: string | number; onUndo: () => void }) {
  return (
    <div
      className="delete-toast"
      style={{ "--toast-dur": `${DELETE_TOAST_MS}ms` } as React.CSSProperties}
    >
      <span className="delete-toast-word">{copy.deleteEntry.toast}</span>
      <button
        type="button"
        className="delete-toast-undo pressable"
        onClick={() => {
          onUndo();
          toast.dismiss(id);
        }}
      >
        {copy.deleteEntry.undo}
      </button>
      {/* the countdown, timed to the toast's own life */}
      <span aria-hidden className="delete-toast-fill" />
    </div>
  );
}

/** raise the let-go toast with its undo action and countdown sweep */
export function letGoToast(onUndo: () => void) {
  toast.custom((id) => <DeleteToast id={id} onUndo={onUndo} />, {
    duration: DELETE_TOAST_MS,
    unstyled: true,
  });
}
