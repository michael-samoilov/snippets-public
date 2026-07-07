import { describe, expect, it } from "vitest";
import { bumpClock, incomingWins, type MergeSide } from "./merge";

const live = (updatedAt: number, enriched = "done"): MergeSide => ({
  updatedAt,
  deletedAt: null,
  enriched,
});
const manual = (updatedAt: number): MergeSide => live(updatedAt, "manual");
const dead = (updatedAt: number, deletedAt = updatedAt): MergeSide => ({
  updatedAt,
  deletedAt,
  enriched: "done",
});

describe("incomingWins — plain last-write-wins", () => {
  it("newer incoming wins", () => {
    expect(incomingWins(live(10), live(20))).toBe(true);
  });
  it("older incoming loses", () => {
    expect(incomingWins(live(20), live(10))).toBe(false);
  });
  it("equal clocks keep the existing row (idempotent re-application)", () => {
    expect(incomingWins(live(10), live(10))).toBe(false);
  });
});

describe("incomingWins — hand filing outranks the clock between live rows", () => {
  it("existing manual beats a NEWER non-manual incoming", () => {
    expect(incomingWins(manual(5), live(100))).toBe(false);
  });
  it("incoming manual beats a NEWER non-manual existing", () => {
    expect(incomingWins(live(100), manual(5))).toBe(true);
  });
  it("…which converges: both orderings settle on the manual row", () => {
    // device A holds manual@5, device B holds auto@100; each merges the
    // other's row — both must land on manual@5
    const aKeeps = !incomingWins(manual(5), live(100));
    const bAdopts = incomingWins(live(100), manual(5));
    expect(aKeeps).toBe(true);
    expect(bAdopts).toBe(true);
  });
  it("manual vs manual falls back to the clock", () => {
    expect(incomingWins(manual(5), manual(10))).toBe(true);
    expect(incomingWins(manual(10), manual(5))).toBe(false);
  });
  it("a later edit that kept its manual filing beats the older manual row", () => {
    // editing text on a row already filed by hand keeps enriched:"manual",
    // so the writer's newer words win by clock
    expect(incomingWins(manual(5), manual(20))).toBe(true);
  });
});

describe("incomingWins — deletions resolve purely by clock", () => {
  it("a newer tombstone beats a live row, even a manual one", () => {
    // letting go is the writer's action too; filing never resurrects it
    expect(incomingWins(manual(5), dead(10))).toBe(true);
  });
  it("a newer live edit beats an older tombstone (the edit was the later action)", () => {
    expect(incomingWins(dead(10), live(20))).toBe(true);
    expect(incomingWins(live(20), dead(10))).toBe(false);
  });
  it("a newer tombstone beats an older edit in both directions", () => {
    expect(incomingWins(live(10), dead(15))).toBe(true);
    expect(incomingWins(dead(15), live(10))).toBe(false);
  });
  it("re-applying the same tombstone is a no-op", () => {
    expect(incomingWins(dead(15), dead(15))).toBe(false);
  });
});

describe("restore semantics (clock ordering, not specialness)", () => {
  it("delete@10 → restore@11: the restored row wins everywhere", () => {
    // restoreSnippet clears deletedAt and bumps the clock, so a device
    // still holding the tombstone adopts the restored row…
    expect(incomingWins(dead(10), live(11))).toBe(true);
    // …and the restored side keeps its copy when the tombstone arrives
    expect(incomingWins(live(11), dead(10))).toBe(false);
  });
});

describe("bumpClock", () => {
  it("is strictly after the previous stamp even when the wall clock lags", () => {
    const future = Date.now() + 1_000_000;
    expect(bumpClock(future)).toBe(future + 1);
  });
  it("uses the wall clock when it is ahead", () => {
    const past = Date.now() - 1_000_000;
    expect(bumpClock(past)).toBeGreaterThanOrEqual(Date.now() - 5);
  });
  it("handles a first stamp", () => {
    expect(bumpClock(undefined)).toBeGreaterThan(0);
  });
});
