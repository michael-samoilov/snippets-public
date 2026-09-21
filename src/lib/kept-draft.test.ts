import { describe, expect, it } from "vitest";
import { clearDayDraft } from "./kept-draft";
import type { Snippet } from "./types";

function draft(id: string, day: string): Snippet {
  return {
    id,
    text: id,
    kind: null,
    tags: [],
    capturedAt: 0,
    day,
    source: "typed",
    favorite: 0,
    updatedAt: 0,
  };
}

describe("clearDayDraft — abort must not clobber a newer keep", () => {
  it("clears when no onlyId is given", () => {
    const drafts = { "2026-09-04": draft("a", "2026-09-04") };
    const { next, clearedId } = clearDayDraft(drafts, "2026-09-04");
    expect(clearedId).toBe("a");
    expect(next["2026-09-04"]).toBeUndefined();
  });

  it("clears when onlyId matches the day's draft", () => {
    const drafts = { "2026-09-04": draft("a", "2026-09-04") };
    const { next, clearedId } = clearDayDraft(drafts, "2026-09-04", "a");
    expect(clearedId).toBe("a");
    expect(next["2026-09-04"]).toBeUndefined();
  });

  it("leaves a newer keep's draft when a late abort names the older id", () => {
    // Keep A failed late; Keep B already filed its draft under the same day.
    // clear(day) without an id guard used to drop B — B stayed in heldIds with
    // no draft, so ScheduleCards filtered the live row out: saved, invisible.
    const drafts = { "2026-09-04": draft("b-newer", "2026-09-04") };
    const { next, clearedId } = clearDayDraft(
      drafts,
      "2026-09-04",
      "a-older",
    );
    expect(clearedId).toBeNull();
    expect(next["2026-09-04"]?.id).toBe("b-newer");
  });

  it("is a no-op when the day has no draft", () => {
    const drafts = { "2026-09-03": draft("x", "2026-09-03") };
    const { next, clearedId } = clearDayDraft(drafts, "2026-09-04", "a");
    expect(clearedId).toBeNull();
    expect(next).toBe(drafts);
  });
});
