import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./render-book";
import type { Snippet } from "./types";

function entry(text: string, day: string): Snippet {
  return {
    id: text,
    text,
    kind: null,
    tags: [],
    capturedAt: 0,
    day,
    source: "typed",
    favorite: 0,
    updatedAt: 0,
  };
}

const headings = (md: string) =>
  md.split("\n").filter((l) => l.startsWith("## "));

describe("the Markdown archive", () => {
  it("gives a day one heading, however its entries are ordered", () => {
    // the same day either side of another — what two devices in different
    // UTC offsets produce when the book is read in capturedAt order
    const md = renderMarkdown([
      entry("first", "2026-03-01"),
      entry("elsewhere", "2026-02-28"),
      entry("second", "2026-03-01"),
    ]);
    expect(headings(md)).toEqual([
      "## Sunday, March 1, 2026",
      "## Saturday, February 28, 2026",
    ]);
  });

  it("keeps every entry, filed under its own day", () => {
    const md = renderMarkdown([
      entry("first", "2026-03-01"),
      entry("elsewhere", "2026-02-28"),
      entry("second", "2026-03-01"),
    ]);
    for (const text of ["first", "elsewhere", "second"]) {
      expect(md).toContain(text);
    }
    // both March entries sit under the March heading, before February's
    const march = md.indexOf("## Sunday, March 1");
    const february = md.indexOf("## Saturday, February 28");
    expect(md.indexOf("first")).toBeGreaterThan(march);
    expect(md.indexOf("second")).toBeGreaterThan(march);
    expect(md.indexOf("second")).toBeLessThan(february);
  });

  it("rules between entries within a day, never before the first", () => {
    const md = renderMarkdown([
      entry("alpha", "2026-03-01"),
      entry("beta", "2026-03-01"),
    ]);
    expect(md.split("----------").length - 1).toBe(1);
    expect(md.indexOf("----------")).toBeGreaterThan(md.indexOf("alpha"));
  });
});
