/** The one backup channel shipped; the ledger's provider key. */
export const PROVIDER = "google-drive";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** A ledger this quiet, while the book moves, counts as failing. */
export const STALE_AFTER_DAYS = 3;

/** What the Settings backup line should say. Pure so it's testable. */
export type BackupHealth = "none" | "fresh" | "pending" | "failing" | "off";

/**
 * Derive the backup line's state from the ledger summary. Two paths
 * reach "failing": the delivering device reported an error (state
 * "error"), or — for the device that silently vanished and can no
 * longer report anything — the ledger has been quiet past
 * STALE_AFTER_DAYS while the book moved past the last delivery.
 * A dormant book with an old ledger is NOT failing; nothing new is
 * unprotected.
 */
export function backupHealth(
  backup: {
    state: "active" | "disconnected" | "error";
    lastSuccessAt: string | null;
    behind?: boolean;
  } | null,
  now: number,
): BackupHealth {
  if (!backup) return "none";
  if (backup.state === "disconnected") return "off";
  if (backup.state === "error") return "failing";
  if (!backup.lastSuccessAt) return "pending";
  const quietMs = now - new Date(backup.lastSuccessAt).getTime();
  if (backup.behind && quietMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000)
    return "failing";
  return "fresh";
}
