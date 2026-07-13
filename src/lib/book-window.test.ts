import { describe, expect, it } from "vitest";
import {
  buildOffsets,
  dayIndexAt,
  estimateCardLines,
  estimateRowHeight,
  sameRange,
  windowRange,
} from "./book-window";

// a book of `n` rows, each `h` px tall — the simplest fixture to reason about
const uniform = (n: number, h = 100) =>
  buildOffsets(Array.from({ length: n }, () => h));

describe("buildOffsets", () => {
  it("cumulative tops and total", () => {
    const { offsets, total } = buildOffsets([100, 200, 50]);
    expect(offsets).toEqual([0, 100, 300, 350]);
    expect(total).toBe(350);
  });
  it("empty book", () => {
    const { offsets, total } = buildOffsets([]);
    expect(offsets).toEqual([0]);
    expect(total).toBe(0);
  });
});

describe("windowRange — always covers the viewport", () => {
  const { offsets } = uniform(1000, 100); // 100k px tall book
  const VIEW = 800;

  it("bounds the rendered rows far below the book size", () => {
    const { start, end } = windowRange(offsets, 50_000, VIEW, 2);
    // viewport ~8 rows + 2 viewports overscan each side ≈ 40 rows, never 1000
    expect(end - start).toBeLessThan(60);
    expect(end - start).toBeGreaterThan(8);
  });

  it("the window contains every row visible in the viewport", () => {
    for (const scrollTop of [0, 3333, 50_000, 99_200]) {
      const { start, end } = windowRange(offsets, scrollTop, VIEW, 2);
      const viewFirst = dayIndexAt(offsets, scrollTop);
      const viewLast = dayIndexAt(offsets, scrollTop + VIEW - 1);
      expect(start).toBeLessThanOrEqual(viewFirst);
      expect(end).toBeGreaterThan(viewLast);
    }
  });

  it("clamps at the ends without going out of range", () => {
    const top = windowRange(offsets, 0, VIEW, 2);
    expect(top.start).toBe(0);
    const bottom = windowRange(offsets, 100_000 - VIEW, VIEW, 2);
    expect(bottom.end).toBe(1000);
    expect(bottom.start).toBeGreaterThanOrEqual(0);
  });

  it("never empty for a non-empty book; empty for an empty one", () => {
    expect(windowRange(uniform(1).offsets, 0, VIEW).end).toBe(1);
    expect(windowRange(uniform(0).offsets, 0, VIEW)).toEqual({ start: 0, end: 0 });
  });
});

describe("windowRange — QUICK FLING keeps up", () => {
  // The failure mode that killed earlier attempts: a fast fling outruns the
  // rendered band and the reader sees blank spacer. With overscan, each frame's
  // window must still cover wherever the fling has reached — verified by
  // stepping a hard fling frame-by-frame and asserting the viewport is covered
  // at EVERY step (a large per-frame jump included).
  const heights = Array.from({ length: 1200 }, (_, i) => 60 + (i % 7) * 30); // varied
  const { offsets, total } = buildOffsets(heights);
  const VIEW = 800;

  it("a violent fling (huge per-frame delta) never exposes an uncovered viewport", () => {
    // 6000 px/frame ≈ a very hard iOS flick (~360k px/s at 60fps); step down the
    // whole book and assert coverage each frame
    let scrollTop = 0;
    const maxTop = total - VIEW;
    let frames = 0;
    while (scrollTop < maxTop) {
      const { start, end } = windowRange(offsets, scrollTop, VIEW, 2);
      const viewFirst = dayIndexAt(offsets, scrollTop);
      const viewLast = dayIndexAt(offsets, Math.min(scrollTop + VIEW - 1, total - 1));
      expect(start).toBeLessThanOrEqual(viewFirst); // top of viewport rendered
      expect(end).toBeGreaterThan(viewLast); // bottom of viewport rendered
      expect(end - start).toBeLessThan(80); // still bounded, even mid-fling
      scrollTop += 6000;
      frames++;
    }
    expect(frames).toBeGreaterThan(5); // actually exercised a long fling
  });

  it("overscan gives a real margin — the window extends beyond the viewport both ways mid-book", () => {
    const { start, end } = windowRange(offsets, total / 2, VIEW, 2);
    const viewFirst = dayIndexAt(offsets, total / 2);
    const viewLast = dayIndexAt(offsets, total / 2 + VIEW - 1);
    expect(start).toBeLessThan(viewFirst); // rows rendered ABOVE the fold
    expect(end).toBeGreaterThan(viewLast + 1); // and BELOW it
  });
});

describe("dayIndexAt — the scroll spy", () => {
  const { offsets } = buildOffsets([100, 200, 50, 300]); // tops: 0,100,300,350,650
  it("maps a scroll position to the row spanning it", () => {
    expect(dayIndexAt(offsets, 0)).toBe(0);
    expect(dayIndexAt(offsets, 99)).toBe(0);
    expect(dayIndexAt(offsets, 100)).toBe(1);
    expect(dayIndexAt(offsets, 299)).toBe(1);
    expect(dayIndexAt(offsets, 300)).toBe(2);
    expect(dayIndexAt(offsets, 349)).toBe(2);
    expect(dayIndexAt(offsets, 350)).toBe(3);
    expect(dayIndexAt(offsets, 9999)).toBe(3); // clamps past the end
  });
});

describe("height estimate", () => {
  it("clamps a card at six lines", () => {
    expect(estimateCardLines("x".repeat(34 * 20))).toBe(6);
    expect(estimateCardLines("short")).toBe(1);
    expect(estimateCardLines("a\nb\nc")).toBe(3);
  });
  it("a fuller day estimates taller than a sparse one", () => {
    const sparse = estimateRowHeight({ lines: 1, cards: 1, newMonth: false, showComposer: false });
    const full = estimateRowHeight({ lines: 18, cards: 3, newMonth: true, showComposer: true });
    expect(full).toBeGreaterThan(sparse);
    expect(sparse).toBeGreaterThanOrEqual(44);
  });
});

describe("sameRange", () => {
  it("equal ranges are equal", () => {
    expect(sameRange({ start: 2, end: 9 }, { start: 2, end: 9 })).toBe(true);
    expect(sameRange({ start: 2, end: 9 }, { start: 2, end: 10 })).toBe(false);
  });
});
