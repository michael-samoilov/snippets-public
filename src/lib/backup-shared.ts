import { copy } from "@/lib/copy";

/** The one backup channel shipped; the ledger's provider key. */
export const PROVIDER = "google-drive";
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** A ledger this quiet, while the book moves, counts as failing. */
export const STALE_AFTER_DAYS = 3;

/**
 * Why the last delivery failed. Each cause has its own explanation and
 * fix in copy.settings.backup.failures, shared by Settings and the
 * watchdog email.
 */
export const BACKUP_FAILURES = [
  "revoked", // Google refused the grant: removed, expired, or never valid
  "scope", // the grant lacks the Drive permission
  "storage", // the writer's Drive is full
  "rateLimit", // Google asked us to slow down
  "google", // Drive answered 5xx
  "network", // no answer at all: offline, or the app closed mid-delivery
  "server", // our side: the token exchange or the Google project config
  "unknown",
] as const;
export type BackupFailure = (typeof BACKUP_FAILURES)[number];

/**
 * The ledger's `last_error` is the device's report, verbatim. Devices
 * since 2026-10 write a canonical line that leads with its source and
 * carries Google's own reason code:
 *
 *   drive 403 storageQuotaExceeded: The user's Drive storage quota…
 *   refresh 401 invalid_grant: Token has been expired or revoked.
 *   network: Load failed
 *
 * Older devices wrote "drive 403: {raw JSON body}", "grant revoked",
 * "refresh 502", or a bare fetch message; those still classify,
 * because the same codes appear in them. Order matters: a specific
 * Google reason outranks the HTTP status it arrived with.
 */
export function classifyBackupError(detail: string | null): BackupFailure | null {
  if (!detail) return null;
  // the old 200-character cut can drop the reason code but keep
  // Google's message, so both are evidence
  if (/storageQuotaExceeded|storage quota has been exceeded/i.test(detail)) return "storage";
  if (/insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient_scope|insufficient authentication scopes/i.test(detail))
    return "scope";
  if (/accessNotConfigured|SERVICE_DISABLED|dailyLimitExceeded|invalid_client|unauthorized_client/.test(detail))
    return "server";
  if (/rateLimitExceeded|RATE_LIMIT_EXCEEDED|rate limit exceeded|^drive 429\b/i.test(detail))
    return "rateLimit";
  if (/invalid_grant|^grant revoked$|^drive 401\b|^no refresh token on device$/.test(detail))
    return "revoked";
  if (/^refresh \d{3}\b/.test(detail)) return "server";
  if (/^drive (?:(?:get|list|create|update) )?5\d\d\b/.test(detail)) return "google";
  if (/^network:|^(?:Load failed|Failed to fetch|NetworkError\b|The network connection was lost)/.test(detail))
    return "network";
  return "unknown";
}

/** What the Settings backup line should say. Pure so it's testable. */
export type BackupHealth =
  | "none"
  | "fresh"
  | "pending"
  | "failing"
  | "behind"
  | "off";

/**
 * Derive the backup line's state from the ledger summary. "failing"
 * means a device reported an error (state "error"); the ledger says
 * why. "behind" is the silent case no report can reach: the ledger
 * has been quiet past STALE_AFTER_DAYS while the book moved past the
 * last delivery. Nothing failed that anyone saw; no device that backs
 * up has delivered since (it wasn't opened, or it closed mid-delivery).
 * A dormant book with an old ledger is neither; nothing new is
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
    return "behind";
  return "fresh";
}

/** Whole days since the last delivery: the email's "for N days". */
export function daysQuiet(lastSuccessAt: string | Date, now: number): number {
  return Math.floor((now - new Date(lastSuccessAt).getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * The email names the cause the device reported (the same lines
 * Settings prints) or, with no report, says plainly that nothing was
 * sent. Google's own message rides along only when Snippets can't
 * name the cause.
 */
export function backupEmail(
  row: { state: string; lastError: string | null; lastSuccessAt: Date | null },
  now: number,
) {
  const failure = row.state === "error" ? classifyBackupError(row.lastError) : null;
  const lines = failure
    ? copy.settings.backup.failures[failure]
    : copy.settings.backup.failures.behind;
  const e = copy.backupEmail;
  return {
    subject: failure ? e.subjectFailing : e.subjectBehind,
    text: [
      row.lastSuccessAt
        ? e.headline(daysQuiet(row.lastSuccessAt, now))
        : e.headlineNever,
      "",
      e.why(lines.cause),
      ...(failure === "unknown" && row.lastError ? [e.detail(row.lastError)] : []),
      "",
      e.whatToDo(lines.emailFix),
    ].join("\n"),
  };
}
