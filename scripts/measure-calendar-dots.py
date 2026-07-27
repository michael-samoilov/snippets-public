"""
Measure the month grid's entry dots: are they ROUND, and are they CONSISTENT?

WHY THIS EXISTS (2026-07-27): the owner reported the calendar's dots
"alternate between circles and squircles". They do, and the cause is
geometry, not border-radius. The dot was `size-[3.5px]` with `gap-[3px]`,
so consecutive dots sat 6.5px apart — a 19.5 DEVICE-pixel pitch on a 3x
screen. Every other dot therefore landed on a half device pixel and
rasterized as an 11px-wide blob with filled corners, between neighbours
that landed clean at 10px. Measured off the owner's own screenshot:

    day 15's four dots -> 11px/fill .873, 10px/fill .800,
                          11px/fill .873, 10px/fill .800
    (an ideal circle fills .785 of its box; a square fills 1.0)

The fix is a whole-pixel dot and a whole-pixel pitch, so every dot in a
strip shares one subpixel phase at every device pixel ratio.

DEAD END, for the record: it is NOT Tailwind v4's `rounded-full`
(`border-radius: 3.40282e38px`). A standalone probe of 3.4e38px vs 50% vs
9999px across nine sizes rasterized IDENTICALLY in both Blink and WebKit —
the huge value is clamped correctly. Swapping the radius spelling changes
nothing; only the geometry does.

Run against a production build:

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-calendar-dots.py

Exit code is 0 when every day's dots agree with each other (spread below
SPREAD_MAX) and read as circles (fill near pi/4) at every probed width.
"""

import math
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

# `?seed=clear` empties the auto-seeded dev book (lib/dev-seed fires on any
# non-prod host), so the only entries in the grid are the ones seeded below
URL = "http://localhost:3000/calendar?seed=clear"
SHOT = "/tmp/calendar-dots.png"
IDEAL = math.pi / 4  # ink an ideal circle leaves in its own bounding box

# device pixel ratios that matter: 2x and 3x phones, 1x desktop
DPRS = (1, 2, 3)
# a spread of subpixel origins: the strip is centred in a grid track of
# width/7, so a few pixels of viewport width moves every dot's phase
WIDTHS = (390, 393, 402, 428)

SPREAD_MAX = 0.06  # per-day disagreement in corner ink
FILL_MAX = 0.86  # a dot fatter than this is reading as a squircle

# counts to seed, one day each, starting at the 1st of the visible month
COUNTS = (1, 2, 3, 4, 5, 6, 8, 12)

SEED = """(counts) => new Promise((resolve, reject) => {
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  // the app creates the database on mount; poll for it rather than racing
  // (indexedDB.open on a name Dexie hasn't reached yet makes an EMPTY db)
  const open = (tries) => {
    const rq = indexedDB.open("snippets");
    rq.onsuccess = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains("snippets")) {
        db.close();
        if (tries <= 0) return reject("no store after wait");
        return setTimeout(() => open(tries - 1), 250);
      }
      try {
        const tx = db.transaction("snippets", "readwrite");
        const store = tx.objectStore("snippets");
        let seq = 0;
        counts.forEach((count, idx) => {
          const d = new Date(now.getFullYear(), now.getMonth(), idx + 1, 12, 0, 0, 0);
          if (d > now) return;                       // never seed the future
          const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
          for (let i = 0; i < count; i++) {
            store.put({
              id: `dotharness${pad(idx)}${pad(i)}`.padEnd(26, '0'),
              text: `harness seed ${idx}/${i}`, kind: null, tags: [],
              capturedAt: d.getTime() + i, day, source: "typed",
              favorite: 0, updatedAt: d.getTime() + i,
            });
            seq++;
          }
        });
        tx.oncomplete = () => { db.close(); resolve(seq); };
        tx.onerror = () => reject("tx:" + tx.error);
      } catch (e) { reject("ex:" + e); }
    };
    rq.onerror = () => reject("open:" + rq.error);
  };
  open(40);
})"""

# every dot in the month grid, tagged with the day it belongs to
COLLECT = """() => [...document.querySelectorAll('[data-day-key]')].flatMap(cell => {
  const strip = cell.querySelector('[data-dots]');
  if (!strip) return [];
  return [...strip.children].map((d, i) => {
    const r = d.getBoundingClientRect();
    return { day: cell.dataset.dayKey, i, x: r.left, y: r.top, w: r.width, h: r.height };
  });
})"""


def climb_to_month(pg):
    """The book is home; the header title climbs out to the month grid."""
    pg.wait_for_selector("[data-today-zone-box], .sheet", timeout=20000)
    pg.wait_for_timeout(1200)
    title = pg.locator(".sheet button.voice-display.pressable[aria-label]").first
    title.click(force=True)
    pg.wait_for_selector("[data-day-key]", timeout=20000)
    pg.wait_for_timeout(1400)  # let the zoom settle before measuring


MIN_CONTRAST = 30  # a dot fainter than this is mid-fade, not yet settled


def ink_of(im, box, dpr):
    """Ink mass and darkest corner pixel of one dot, in device pixels.

    Everything is normalised against the dot's OWN paper-to-ink range, so a
    dot still fading in reads the same as a settled one — but a dot with too
    little contrast to judge is skipped rather than guessed at."""
    x0, y0 = int(round(box["x"] * dpr)), int(round(box["y"] * dpr))
    x1, y1 = int(round((box["x"] + box["w"]) * dpr)), int(round((box["y"] + box["h"]) * dpr))
    W, H = im.size
    if not (0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H):
        return None
    px = im.load()
    vals = [px[xx, yy] for yy in range(y0, y1) for xx in range(x0, x1)]
    paper = max(vals)
    if paper - min(vals) < MIN_CONTRAST:
        return None
    span = paper - min(vals)
    ink = sum((paper - v) / span for v in vals)
    corners = [px[x0, y0], px[x1 - 1, y0], px[x0, y1 - 1], px[x1 - 1, y1 - 1]]
    return {
        "fill": ink / ((x1 - x0) * (y1 - y0)),
        "corner": (paper - min(corners)) / span,
        "w_dev": x1 - x0,
    }


def main():
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for dpr in DPRS:
            for width in WIDTHS:
                ctx = browser.new_context(
                    viewport={"width": width, "height": 844}, device_scale_factor=dpr
                )
                pg = ctx.new_page()
                pg.goto(URL)
                pg.wait_for_selector(".sheet", timeout=20000)
                pg.evaluate(SEED, list(COUNTS))
                pg.reload()
                climb_to_month(pg)
                seen = pg.evaluate(
                    """() => [...document.querySelectorAll('[data-day-key]')]
                         .map(c => [c.dataset.dayKey, c.querySelector('[data-dots]')?.children.length ?? 0])
                         .filter(r => r[1] > 0).sort()"""
                )
                want = [c if c < 4 else 4 for c in COUNTS]
                got = [n for _, n in seen]
                if got != want:
                    print(f"  ! dpr{dpr} w{width}: seeded days read {got}, expected {want}")
                boxes = pg.evaluate(COLLECT)
                pg.screenshot(path=SHOT)
                ctx.close()

                im = Image.open(SHOT).convert("L")
                days = {}
                for b in boxes:
                    m = ink_of(im, b, dpr)
                    if m:
                        days.setdefault(b["day"], []).append(m)

                worst_spread, worst_fill, n_dots = 0.0, 0.0, 0
                for day, dots in days.items():
                    if not dots:
                        continue
                    n_dots += len(dots)
                    cs = [d["corner"] for d in dots]
                    spread = max(cs) - min(cs)
                    fill = max(d["fill"] for d in dots)
                    worst_spread = max(worst_spread, spread)
                    worst_fill = max(worst_fill, fill)
                    if spread > SPREAD_MAX or fill > FILL_MAX:
                        failures.append(
                            f"  dpr{dpr} w{width} {day}: spread={spread:.3f} "
                            f"fill={fill:.3f} widths={[d['w_dev'] for d in dots]}"
                        )
                print(
                    f"dpr{dpr} w{width}: {n_dots:>3} dots over {len(days):>2} days | "
                    f"worst spread {worst_spread:.3f} | fattest fill {worst_fill:.3f} "
                    f"(circle {IDEAL:.3f})"
                )
        browser.close()

    if failures:
        print(f"\nFAIL — {len(failures)} day(s) render inconsistent or square dots:")
        for f in failures[:20]:
            print(f)
        return 1
    print(f"\nPASS — every dot agrees with its neighbours (spread <= {SPREAD_MAX}) "
          f"and reads round (fill <= {FILL_MAX}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
