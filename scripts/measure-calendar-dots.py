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
WANDER_MAX = 0.5  # device px a printed count may move against its dots
CROSSBAR_MAX = 1.0  # device px the "+" stroke may sit off the dots' line

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
  return [...strip.querySelectorAll(':scope > :not([data-count])')].map((d, i) => {
    const r = d.getBoundingClientRect();
    return { day: cell.dataset.dayKey, i, x: r.left, y: r.top, w: r.width, h: r.height };
  });
})"""

# the printed count, with the dots it sits beside — for the alignment checks.
# `plus` is the FIRST character's advance only: the face is tabular, so every
# character is the same width, and the plus alone is what must sit on the
# dots' line (see crossbar_offset below).
COLLECT_COUNTS = """() => [...document.querySelectorAll('[data-day-key]')].flatMap(cell => {
  const num = cell.querySelector('[data-count]');
  if (!num) return [];
  const ds = [...cell.querySelectorAll('[data-dots] > :not([data-count])')]
    .map(d => d.getBoundingClientRect());
  if (!ds.length) return [];
  const r = num.getBoundingClientRect();
  return [{ day: cell.dataset.dayKey, text: num.textContent,
            dots: { x: Math.min(...ds.map(b => b.left)), y: Math.min(...ds.map(b => b.top)),
                    w: Math.max(...ds.map(b => b.right)) - Math.min(...ds.map(b => b.left)),
                    h: Math.max(...ds.map(b => b.bottom)) - Math.min(...ds.map(b => b.top)) },
            plus: { x: r.left, y: r.top, w: r.width / num.textContent.length, h: r.height },
            num: { x: r.left, y: r.top, w: r.width, h: r.height } }];
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


def band_centre(im, box, dpr, grow=2):
    """Vertical centre of a region's ink BOUNDING BOX, in device pixels.

    The bounding box, not the centroid: every lining figure spans exactly
    baseline-to-cap-height, so the box is the same for +2 and +8, while the
    centroid is not (an 8 carries more ink low than a 5 does). Measuring the
    centroid would report glyph shape as if it were misalignment."""
    x0 = max(0, int(box["x"] * dpr) - grow)
    y0 = max(0, int(box["y"] * dpr) - grow * 2)
    x1 = min(im.size[0], int((box["x"] + box["w"]) * dpr) + grow + 1)
    y1 = min(im.size[1], int((box["y"] + box["h"]) * dpr) + grow * 2 + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    px = im.load()
    rows_px = [[px[xx, yy] for xx in range(x0, x1)] for yy in range(y0, y1)]
    paper = max(max(r) for r in rows_px)
    thresh = paper * 0.12
    inked = [y0 + i for i, r in enumerate(rows_px)
             if max(max(0, paper - v) for v in r) > thresh]
    return (inked[0] + inked[-1]) / 2 if inked else None


def centroid_row(im, box, dpr, pad_y=3):
    """Ink-weighted centre row of a region, in device pixels.

    Used on marks that are vertically SYMMETRIC, where the centroid is the
    thing the eye lines up: a dot's centre, and — restricted to the plus's own
    advance width — the "+" crossbar. This is the check the bounding box
    cannot do. A "+" sits on the math axis, roughly a tenth of an em below the
    middle of a digit's cap-to-baseline band, so a string whose BOX is
    perfectly centred still hangs its crossbar under the dots."""
    x0 = max(0, int(box["x"] * dpr))
    x1 = min(im.size[0], int((box["x"] + box["w"]) * dpr) + 1)
    y0 = max(0, int(box["y"] * dpr) - pad_y * dpr)
    y1 = min(im.size[1], int((box["y"] + box["h"]) * dpr) + pad_y * dpr + 1)
    if x1 <= x0 or y1 <= y0:
        return None
    px = im.load()
    rows_px = [[px[xx, yy] for xx in range(x0, x1)] for yy in range(y0, y1)]
    paper = max(max(r) for r in rows_px)
    tot, acc = 0.0, 0.0
    for i, r in enumerate(rows_px):
        w = sum(max(0, paper - v) for v in r)
        tot += w
        acc += w * (y0 + i)
    return acc / tot if tot else None


def main():
    failures = []
    crossbars = []
    # day -> the marks it must draw, from the shared rule in shared.ts
    want_marks = {}
    for c in COUNTS:
        want_marks[c] = (c if c <= 4 else 3, None if c <= 4 else f"+{c - 3}")
    offsets = []
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
                    """() => [...document.querySelectorAll('[data-day-key]')].map(c => [
                         c.dataset.dayKey,
                         c.querySelectorAll('[data-dots] > :not([data-count])').length,
                         c.querySelector('[data-count]')?.textContent ?? null,
                       ]).filter(r => r[1] > 0).sort()"""
                )
                got = [(n, t) for _, n, t in seen]
                want = [want_marks[c] for c in COUNTS]
                if got != want:
                    failures.append(
                        f"  dpr{dpr} w{width}: marks read {got}, expected {want}"
                    )
                boxes = pg.evaluate(COLLECT)
                counted = pg.evaluate(COLLECT_COUNTS)
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
                # where the printed count sits against the dots it annotates.
                # TWO checks, because they catch different faults: the box
                # says whether the mark MOVES from day to day, the crossbar
                # whether it sits ON THE DOTS' LINE at all.
                for c in counted:
                    cd = band_centre(im, c["dots"], dpr)
                    cn = band_centre(im, c["num"], dpr)
                    if cd is not None and cn is not None:
                        # keyed by dpr too: `voice-data-sm` is deliberately a
                        # different size at 1x, and a device pixel there is a
                        # different physical thing — comparing across ratios
                        # would report the intended step as if it were drift
                        offsets.append(((dpr, c["text"]), cn - cd))
                    pd = centroid_row(im, c["dots"], dpr)
                    pp = centroid_row(im, c["plus"], dpr)
                    if pd is not None and pp is not None:
                        crossbars.append((dpr, pp - pd))

                print(
                    f"dpr{dpr} w{width}: {n_dots:>3} dots over {len(days):>2} days | "
                    f"worst spread {worst_spread:.3f} | fattest fill {worst_fill:.3f} "
                    f"(circle {IDEAL:.3f})"
                )
        browser.close()

    # A number that sits above the dots on one day and below them on the next
    # is the same fractional-geometry fault as the squircles, one level up.
    # Compare each printed value only against ITSELF, at one device pixel
    # ratio, across days and viewport widths — so neither a differently shaped
    # glyph nor the intended 1x size step is mistaken for a moved mark.
    wander = 0.0
    if offsets:
        by_key = {}
        for key, off in offsets:
            by_key.setdefault(key, []).append(off)
        wander = max(max(v) - min(v) for v in by_key.values())
        worst = max(by_key, key=lambda k: max(by_key[k]) - min(by_key[k]))
        # the constant is what a half-pixel nudge trims; the WANDER is the
        # fault. A steady offset reads as placement, a moving one as a bug.
        by_dpr = {}
        for (dpr_, _), off in offsets:
            by_dpr.setdefault(dpr_, []).append(off)
        const = "  ".join(
            f"dpr{d}:{sum(v)/len(v):+.2f}" for d, v in sorted(by_dpr.items())
        )
        print(
            f"\nprinted counts: {len(offsets)} samples over {len(by_key)} "
            f"(ratio, value) pairs | worst wander {wander:.2f} device px "
            f"(dpr{worst[0]} “{worst[1]}”)\n"
            f"  constant offset from the dots' line — {const}"
        )
        if wander > WANDER_MAX:
            failures.append(
                f"  the printed count wanders {wander:.2f} device px against the dots"
            )

    if crossbars:
        by_dpr = {}
        for dpr_, off in crossbars:
            by_dpr.setdefault(dpr_, []).append(off)
        line = "  ".join(
            f"dpr{d}:{sum(v)/len(v):+.2f}" for d, v in sorted(by_dpr.items())
        )
        print(f"  “+” crossbar against the dots' centreline — {line}")
        for d, v in sorted(by_dpr.items()):
            mean = sum(v) / len(v)
            if abs(mean) > CROSSBAR_MAX:
                failures.append(
                    f"  dpr{d}: the “+” crossbar sits {mean:+.2f} device px off the "
                    f"dots' line ({'below' if mean > 0 else 'above'} them)"
                )

    if failures:
        print(f"\nFAIL — {len(failures)} problem(s):")
        for f in failures[:20]:
            print(f)
        return 1
    print(f"\nPASS — every dot agrees with its neighbours (spread <= {SPREAD_MAX}) "
          f"and reads round (fill <= {FILL_MAX}); every printed count holds one "
          f"line (wander {wander:.2f} <= {WANDER_MAX}) with its “+” on the dots' "
          f"centreline (<= {CROSSBAR_MAX} device px).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
