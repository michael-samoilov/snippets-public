import { describe, expect, it } from "vitest";
import { QUOTA_BYTES, QUOTA_ROWS, exceedsQuota, growth } from "./sync-quota";

const envelope = (n: number) => ({ v: 1, iv: "A".repeat(16), ct: "B".repeat(n) });

describe("growth — what a batch adds, merged as the push route merges it", () => {
  it("counts a new id as a row plus its bytes", () => {
    const added = growth([{ id: "a", payload: envelope(100), updatedAt: 2 }], new Map());
    expect(added.rows).toBe(1);
    expect(added.bytes).toBe(JSON.stringify(envelope(100)).length);
  });

  it("an applied edit adds only the difference; a losing one adds nothing", () => {
    const stored = new Map([["a", { payload: envelope(100), updatedAt: 5 }]]);
    expect(growth([{ id: "a", payload: envelope(150), updatedAt: 6 }], stored)).toEqual({
      rows: 0,
      bytes: 50,
    });
    expect(growth([{ id: "a", payload: envelope(150), updatedAt: 5 }], stored)).toEqual({
      rows: 0,
      bytes: 0,
    });
  });

  it("a repeated id in one batch counts once, against its own earlier change", () => {
    const added = growth(
      [
        { id: "a", payload: envelope(100), updatedAt: 1 },
        { id: "a", payload: envelope(120), updatedAt: 2 },
      ],
      new Map(),
    );
    expect(added).toEqual({ rows: 1, bytes: JSON.stringify(envelope(120)).length });
  });
});

describe("exceedsQuota", () => {
  it("refuses a batch that grows an account past the row ceiling", () => {
    expect(exceedsQuota({ rows: QUOTA_ROWS, bytes: 0 }, { rows: 1, bytes: 1 })).toBe(true);
    expect(exceedsQuota({ rows: QUOTA_ROWS - 1, bytes: 0 }, { rows: 1, bytes: 1 })).toBe(false);
  });

  it("refuses a batch that grows an account past the byte ceiling", () => {
    expect(exceedsQuota({ rows: 1, bytes: QUOTA_BYTES }, { rows: 0, bytes: 1 })).toBe(true);
  });

  it("never refuses a batch that shrinks or holds an account, even over the ceiling", () => {
    expect(
      exceedsQuota({ rows: QUOTA_ROWS + 9, bytes: QUOTA_BYTES + 9 }, { rows: 0, bytes: -40 }),
    ).toBe(false);
  });
});
