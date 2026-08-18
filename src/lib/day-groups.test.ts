import { describe, expect, it } from "vitest";
import { groupByDay } from "./day-groups";
import type { Snippet } from "./types";

/** an entry is only its id and its day here — grouping reads nothing else */
function entry(id: string, day: string): Snippet {
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

/** what the book actually renders: the caller keys the groups by day */
function book(snippets: Snippet[]): Map<string, string[]> {
  const groups = groupByDay(snippets);
  return new Map(groups.map((g) => [g.day, g.snippets.map((s) => s.id)]));
}

describe("gathering entries under their day", () => {
  it("keeps neighbours on the same page", () => {
    const page = book([
      entry("a", "2026-03-01"),
      entry("b", "2026-03-01"),
      entry("c", "2026-03-02"),
    ]);
    expect(page.get("2026-03-01")).toEqual(["a", "b"]);
    expect(page.get("2026-03-02")).toEqual(["c"]);
  });

  it("loses no entry when a day's rows are not neighbours", () => {
    // Tokyo 00:30 on the 1st is 15:30Z on Feb 28; fly west and 01:30Z on the
    // 1st is 17:30 local on Feb 28. Read in capturedAt order the days run
    // 03-01, 02-28, 03-01 — the same day, twice, with a gap.
    const page = book([
      entry("tokyo", "2026-03-01"),
      entry("los-angeles", "2026-02-28"),
      entry("later", "2026-03-01"),
    ]);
    expect(page.get("2026-03-01")).toEqual(["tokyo", "later"]);
    expect(page.get("2026-02-28")).toEqual(["los-angeles"]);
  });

  it("gives every entry exactly one page", () => {
    const rows = [
      entry("a", "2026-03-01"),
      entry("b", "2026-02-28"),
      entry("c", "2026-03-01"),
      entry("d", "2026-02-28"),
      entry("e", "2026-03-01"),
    ];
    const groups = groupByDay(rows);
    const placed = groups.flatMap((g) => g.snippets.map((s) => s.id));
    expect(placed.sort()).toEqual(["a", "b", "c", "d", "e"]);
    expect(groups.map((g) => g.day)).toEqual(["2026-03-01", "2026-02-28"]);
  });

  it("orders pages by first appearance, so a sorted book reads in order", () => {
    const groups = groupByDay([
      entry("a", "2026-03-01"),
      entry("b", "2026-03-02"),
      entry("c", "2026-03-03"),
    ]);
    expect(groups.map((g) => g.day)).toEqual([
      "2026-03-01",
      "2026-03-02",
      "2026-03-03",
    ]);
  });

  it("has nothing to gather from an empty book", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
