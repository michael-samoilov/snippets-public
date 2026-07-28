import { describe, expect, it } from "vitest";
import { DOT_CAP, DOTS_WITH_COUNT, dotsFor } from "./shared";

/** what a day's mark row actually reads as, dots then any printed number */
function marks(count: number): string {
  const row = "•".repeat(dotsFor(count));
  return count > DOT_CAP ? `${row} +${count - DOTS_WITH_COUNT}` : row;
}

describe("month grid day marks", () => {
  it("draws one dot per entry while the eye can still count them", () => {
    expect(marks(0)).toBe("");
    expect(marks(1)).toBe("•");
    expect(marks(2)).toBe("••");
    expect(marks(3)).toBe("•••");
    expect(marks(4)).toBe("••••");
  });

  it("prints the number past four, falling back to three dots", () => {
    expect(marks(5)).toBe("••• +2");
    expect(marks(6)).toBe("••• +3");
    expect(marks(12)).toBe("••• +9");
  });

  it("never prints +1, which would cost more room than a fifth dot", () => {
    for (let n = 0; n <= 200; n++) expect(marks(n)).not.toContain("+1 ");
    expect(marks(5)).not.toContain("+1");
  });

  it("never shows fewer total marks for a fuller day", () => {
    // four dots (4 marks) then three dots and a number (4 marks): the row
    // never shrinks as the day fills, and past five it only grows
    let prev = -1;
    for (let n = 1; n <= 50; n++) {
      const width = dotsFor(n) + (n > DOT_CAP ? 1 : 0);
      expect(width).toBeGreaterThanOrEqual(prev);
      prev = width;
    }
  });

  it("keeps the printed number honest about the total", () => {
    for (const n of [5, 7, 13, 99]) {
      expect(dotsFor(n) + (n - DOTS_WITH_COUNT)).toBe(n);
    }
  });
});
