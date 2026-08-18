import { describe, expect, it } from "vitest";
import { cellIndex, leadOffset, monthRows } from "./shared";

/** the column and row a day renders in, from the flat index */
function cell(m: Date, day: number, weekStart: 0 | 1) {
  const idx = cellIndex(m, day, weekStart);
  return { col: idx % 7, row: Math.floor(idx / 7) };
}

// months of 2026 chosen so the first lands on every weekday:
// Feb starts Sunday, Jun Monday, Sep Tuesday, Apr Wednesday,
// Jan Thursday, May Friday, Aug Saturday.
const MONTHS = [
  new Date(2026, 1, 1),
  new Date(2026, 5, 1),
  new Date(2026, 8, 1),
  new Date(2026, 3, 1),
  new Date(2026, 0, 1),
  new Date(2026, 4, 1),
  new Date(2026, 7, 1),
];

describe("month grid cell placement", () => {
  it("puts day one in the column the grid's lead renders it in", () => {
    for (const m of MONTHS) {
      for (const weekStart of [0, 1] as const) {
        expect(cell(m, 1, weekStart).col).toBe(leadOffset(m, weekStart));
        expect(cell(m, 1, weekStart).row).toBe(0);
      }
    }
  });

  it("moves day one when the week start moves — the regression that hid", () => {
    // 1 Feb 2026 is a Sunday: column 0 under a Sunday start, column 6 under
    // Monday. The ring and the dive origin used a bare getDay — always the
    // Sunday answer — so under Monday start they drew six cells away from
    // the day they marked.
    const feb = new Date(2026, 1, 1);
    expect(cell(feb, 1, 0).col).toBe(0);
    expect(cell(feb, 1, 1).col).toBe(6);
  });

  it("walks left to right, wrapping every seven days", () => {
    for (const m of MONTHS) {
      for (const weekStart of [0, 1] as const) {
        const first = cellIndex(m, 1, weekStart);
        for (let day = 2; day <= 28; day++) {
          expect(cellIndex(m, day, weekStart)).toBe(first + day - 1);
        }
      }
    }
  });

  it("never places a day past the grid the row count builds", () => {
    // a leap February and a 31-day month starting Saturday stress the foot
    const cases: Array<[Date, number]> = [
      [new Date(2028, 1, 1), 29], // leap February
      [new Date(2026, 7, 31), 31], // August 2026 starts Saturday
      ...MONTHS.map((m): [Date, number] =>
        [m, new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()]),
    ];
    for (const [m, last] of cases) {
      for (const weekStart of [0, 1] as const) {
        const start = new Date(m.getFullYear(), m.getMonth(), 1);
        expect(cell(start, last, weekStart).row).toBeLessThan(
          monthRows(start, weekStart),
        );
      }
    }
  });
});
