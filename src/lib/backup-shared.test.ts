import { describe, expect, it } from "vitest";
import { backupHealth, STALE_AFTER_DAYS } from "./backup-shared";

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

  it("quiet past the stale window WHILE the book moved → failing (the vanished-device case)", () => {
    expect(
      backupHealth(
        summary({ behind: true, lastSuccessAt: iso((STALE_AFTER_DAYS + 1) * DAY) }),
        NOW,
      ),
    ).toBe("failing");
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
