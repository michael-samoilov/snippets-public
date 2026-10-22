import { describe, expect, it } from "vitest";
import {
  backupEmail,
  backupHealth,
  classifyBackupError,
  daysQuiet,
  STALE_AFTER_DAYS,
  yearsToUpload,
} from "./backup-shared";
import { copy } from "./copy";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-10T12:00:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

const summary = (
  over: Partial<Parameters<typeof backupHealth>[0] & object> = {},
) => ({
  state: "active" as const,
  lastSuccessAt: iso(1 * DAY),
  behind: false,
  ...over,
});

describe("backupHealth — the one derivation behind the Settings line", () => {
  it("no ledger row → none (never connected)", () => {
    expect(backupHealth(null, NOW)).toBe("none");
  });

  it("deliberately disconnected → off, even when stale and behind", () => {
    expect(
      backupHealth(
        summary({ state: "disconnected", behind: true, lastSuccessAt: iso(30 * DAY) }),
        NOW,
      ),
    ).toBe("off");
  });

  it("a reported delivery error → failing, regardless of freshness", () => {
    expect(backupHealth(summary({ state: "error" }), NOW)).toBe("failing");
    expect(
      backupHealth(summary({ state: "error", lastSuccessAt: null }), NOW),
    ).toBe("failing");
  });

  it("connected but never delivered → pending (the first is on its way)", () => {
    expect(backupHealth(summary({ lastSuccessAt: null }), NOW)).toBe("pending");
  });

  it("recent delivery → fresh", () => {
    expect(backupHealth(summary(), NOW)).toBe("fresh");
  });

  it("quiet past the stale window WHILE the book moved → behind (no report, so not \"failing\")", () => {
    expect(
      backupHealth(
        summary({ behind: true, lastSuccessAt: iso((STALE_AFTER_DAYS + 1) * DAY) }),
        NOW,
      ),
    ).toBe("behind");
  });

  it("quiet past the stale window but the book HASN'T moved → still fresh (a dormant book may rest)", () => {
    expect(
      backupHealth(
        summary({ behind: false, lastSuccessAt: iso((STALE_AFTER_DAYS + 30) * DAY) }),
        NOW,
      ),
    ).toBe("fresh");
  });

  it("behind but inside the stale window → fresh (a delivery is simply due, not failing)", () => {
    expect(
      backupHealth(summary({ behind: true, lastSuccessAt: iso(1 * DAY) }), NOW),
    ).toBe("fresh");
  });

  it("an old server that doesn't send `behind` degrades to the old calm behavior, never a false alarm", () => {
    expect(
      backupHealth(
        { state: "active", lastSuccessAt: iso(30 * DAY) },
        NOW,
      ),
    ).toBe("fresh");
  });
});

describe("classifyBackupError — the ledger line read back into a cause", () => {
  // the exact line the pre-2026-10 client wrote for a full Drive:
  // "drive 403: " + the first 200 characters of Google's pretty body,
  // which can cut off before the reason code (Google's message survives)
  const googleBody = JSON.stringify(
    {
      error: {
        code: 403,
        message: "The user's Drive storage quota has been exceeded.",
        errors: [
          {
            message: "The user's Drive storage quota has been exceeded.",
            domain: "usageLimits",
            reason: "storageQuotaExceeded",
          },
        ],
      },
    },
    null,
    2,
  );

  it.each([
    // canonical lines (drive-client's DriveError, backup-client's RefreshError)
    ["drive 403 storageQuotaExceeded: The user's Drive storage quota has been exceeded.", "storage"],
    ["drive 403 userRateLimitExceeded: User Rate Limit Exceeded.", "rateLimit"],
    ["drive 403 rateLimitExceeded: Rate Limit Exceeded", "rateLimit"],
    ["drive 429 -: Too Many Requests", "rateLimit"],
    ["drive 403 insufficientPermissions: Request had insufficient authentication scopes.", "scope"],
    ["drive 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT: Request had insufficient authentication scopes.", "scope"],
    ["drive 403 accessNotConfigured: Google Drive API has not been used in project 1 before or it is disabled.", "server"],
    ["drive 401 authError: Invalid Credentials", "revoked"],
    ["refresh 401 invalid_grant: Token has been expired or revoked.", "revoked"],
    ["refresh 502 invalid_client: The OAuth client was not found.", "server"],
    ["refresh 502 http 500: ", "google"],
    ["drive 503 backendError: Backend Error", "google"],
    ["drive 500 -: ", "google"],
    ["network: Load failed", "network"],
    ["network: Failed to fetch", "network"],
    ["drive 400 badRequest: Invalid multipart request.", "unknown"],
    ["drive 404 notFound: File not found: FILE1.", "unknown"],
    ["network: no answer in 60 seconds", "network"],
    // Google's token service down (our route wraps it as "http 5xx") is
    // Google's side, not ours
    ["refresh 502 http 503: ", "google"],
    // broke on the device: never "Google Drive refused", never "network"
    ["error: QuotaExceededError: The quota has been exceeded.", "device"],
    ["error: UnknownError: Connection to Indexed Database server lost. Refresh the page to try again", "device"],
    ["error: TypeError: Cannot read properties of undefined (reading 'slice')", "device"],
    // what devices before 2026-10 wrote
    [`drive 403: ${googleBody.slice(0, 200)}`, "storage"],
    ["grant revoked", "revoked"],
    ["no refresh token on device", "revoked"],
    ["refresh 502", "server"],
    ["drive update 500", "google"],
    ["drive list 503", "google"],
    ["Load failed", "network"],
    ["Failed to fetch", "network"],
    ["NetworkError when attempting to fetch resource.", "network"],
    // an old client wrote any other exception's bare message
    ["Cannot read properties of undefined (reading 'slice')", "device"],
    ["drive create 400", "unknown"],
  ])("%s → %s", (line, cause) => {
    expect(classifyBackupError(line)).toBe(cause);
  });

  it("no error on the ledger → no cause", () => {
    expect(classifyBackupError(null)).toBeNull();
    expect(classifyBackupError("")).toBeNull();
  });
});

describe("daysQuiet — the email's day count, free of time zones", () => {
  it("counts whole days", () => {
    expect(daysQuiet(iso(4 * DAY + 13 * 60 * 60 * 1000), NOW)).toBe(4);
    expect(daysQuiet(iso(23 * 60 * 60 * 1000), NOW)).toBe(0);
  });
});

describe("backupEmail — the watchdog's one email per silence", () => {
  it("the 2026-10-20 email, rebuilt: a quiet ledger names no failure and counts days", () => {
    // a quiet ledger: last delivery 2026-10-17 03:00Z,
    // no failure reported since, cron ran 2026-10-20 06:00Z
    const email = backupEmail(
      {
        state: "active",
        lastError: null,
        lastSuccessAt: new Date("2026-10-17T03:05:00Z"),
      },
      Date.parse("2026-10-20T06:00:00Z"),
    );
    expect(email.subject).toBe(copy.backupEmail.subjectBehind);
    expect(email.text).toContain("for 3 days");
    // no date in the email: the old "since October 17" read a day later
    // than Settings' "October 16" for a reader west of UTC
    expect(email.text).not.toMatch(/October/);
    expect(email.text).toContain(copy.settings.backup.failures.behind.cause);
    expect(email.text).toContain(copy.settings.backup.failures.behind.emailFix);
  });

  it("a reported failure names its cause and its fix", () => {
    const email = backupEmail(
      {
        state: "error",
        lastError: "drive 403 storageQuotaExceeded: The user's Drive storage quota has been exceeded.",
        lastSuccessAt: new Date("2026-10-01T00:00:00Z"),
      },
      Date.parse("2026-10-06T00:00:00Z"),
    );
    expect(email.subject).toBe(copy.backupEmail.subjectFailing);
    expect(email.text).toContain(copy.settings.backup.failures.storage.cause);
    expect(email.text).toContain(copy.settings.backup.failures.storage.emailFix);
    // a known cause speaks in plain words; Google's raw message stays out
    expect(email.text).not.toContain("storageQuotaExceeded");
  });

  it("a device failure says Google wasn't involved, with the message", () => {
    const line = "error: UnknownError: Connection to Indexed Database server lost.";
    const email = backupEmail(
      { state: "error", lastError: line, lastSuccessAt: new Date("2026-10-01T00:00:00Z") },
      Date.parse("2026-10-06T00:00:00Z"),
    );
    expect(email.text).toContain(copy.settings.backup.failures.device.cause);
    expect(email.text).not.toContain("Google Drive refused");
    expect(email.text).toContain(copy.backupEmail.detail(line));
  });

  it("an unrecognized failure carries Google's message verbatim", () => {
    const line = "drive 400 badRequest: Invalid multipart request.";
    const email = backupEmail(
      { state: "error", lastError: line, lastSuccessAt: null },
      Date.parse("2026-10-06T00:00:00Z"),
    );
    expect(email.text).toContain(copy.backupEmail.headlineNever);
    expect(email.text).toContain(copy.backupEmail.detail(line));
  });
});

describe("yearsToUpload — which Markdown files a delivery rewrites", () => {
  const rendered = { "2021": "h21", "2025": "h25", "2026": "h26-new" };
  const uploaded = { "2021": "h21", "2025": "h25", "2026": "h26-old" };

  it("an entry-driven delivery rewrites only the changed year", () => {
    expect(yearsToUpload(rendered, uploaded, false)).toEqual(["2026"]);
  });

  it("the hourly full delivery rewrites every year, newest first", () => {
    expect(yearsToUpload(rendered, uploaded, true)).toEqual(["2026", "2025", "2021"]);
  });

  it("a year never uploaded (or emptied) always goes", () => {
    expect(yearsToUpload({ ...rendered, "2024": "h24" }, uploaded, false)).toEqual([
      "2026",
      "2024",
    ]);
  });

  it("an edit to an old year sends that year too, still newest first", () => {
    expect(
      yearsToUpload({ ...rendered, "2021": "h21-edited" }, uploaded, false),
    ).toEqual(["2026", "2021"]);
  });
});
