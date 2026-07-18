"""
Guard the calendar→schedule dive's flyers against the "hang" — the number
sitting at its calendar cell while the deferred book work runs behind the
camera. The fidelity harness only checks the LANDING; this checks the PATH.

The dive plays the month's camera first and defers the flight build behind it
(earlyOut). To avoid any hang the dive now draws NO departing (month-typeface)
glyph at all: the number stays invisible until its book-typeface glyph fades in
over the LATTER part of the path, once the calendar has zoomed away. So nothing
is ever drawn near the origin — there is nothing to hang.

The invariant this asserts, sampling every frame of a dive: whenever a flyer's
glyph is visible (opacity > VIS), the point has already travelled past
REVEAL_FRAC of its total path. In other words the number is only ever seen ON
its way to the schedule, never parked at the calendar cell. It also confirms the
number does appear (some glyph reaches full opacity); the fidelity harness owns
the landing precision.

FAILS on a build that shows the flyer near its origin (a departing glyph, or a
camera-synced point revealed early in its travel).

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-flight-lockstep.py

Probe hygiene: reads only computed transforms/opacity of the flyer points and
their glyph children — never reaches into a content-visibility-skipped section.
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))
VIS = 0.05  # a glyph past this opacity counts as visible on screen
REVEAL_FRAC = 0.4  # a visible glyph must be at least this far along its path
SETTLE_SLACK = 6  # px near the origin that don't count (sub-pixel jitter)

# Sample every rAF for ~600ms after a tap: each flyer point's translate, and the
# max opacity among its glyph children (what's actually on screen).
WATCH = r"""() => new Promise(res => {
  const series = {};      // day -> [{x,y,op}]
  const t0 = performance.now();
  const loop = () => {
    for (const p of document.querySelectorAll('[data-fly]')) {
      const cm = (getComputedStyle(p).transform || '').match(/matrix\(([^)]+)\)/);
      if (!cm) continue;
      const parts = cm[1].split(',').map(v => +v.trim());
      let op = 0;
      for (const g of p.children) op = Math.max(op, +getComputedStyle(g).opacity);
      (series[p.dataset.fly] ||= []).push({ x: parts[4], y: parts[5], op });
    }
    if (performance.now() - t0 < 600) requestAnimationFrame(loop);
    else res(series);
  };
  requestAnimationFrame(loop);
})"""


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(
            viewport={"width": 393, "height": 852}, device_scale_factor=2
        )
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load")
        pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load")
        pg.wait_for_timeout(5000)

        def dive(tag: str, months_back: int) -> None:
            if months_back:
                # scroll BACK by whole viewports, but the month feed virtualizes,
                # so a blind delta can land on a gap with nothing rendered. Nudge
                # until enabled cells are actually in the viewport middle.
                pg.evaluate(
                    r"""async (n) => {
                  const m = document.querySelector('[data-layer="month"]');
                  const sc = [...m.querySelectorAll('*')].find(
                    e => e.scrollHeight > e.clientHeight + 100);
                  if (!sc) return;
                  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
                  const visCount = () => {
                    const st = m.getBoundingClientRect();
                    return [...document.querySelectorAll(
                        '[data-layer="month"] button[data-day-key]:not([disabled])')]
                      .filter(b => { const r = b.getBoundingClientRect();
                        return r.top > st.top + 80 && r.bottom < st.bottom - 80 && r.height > 0; })
                      .length;
                  };
                  sc.scrollTop -= sc.clientHeight * n;
                  await sleep(700);
                  for (let i = 0; i < 12 && visCount() < 3; i++) {
                    sc.scrollTop += sc.clientHeight * 0.75;
                    await sleep(350);
                  }
                }""",
                    months_back,
                )
                pg.wait_for_timeout(500)
            # tap a visible enabled cell (middle of the grid), start watching in
            # the SAME evaluate so no frame between the tap and the first sample
            series = pg.evaluate(
                r"""async () => {
              const st = document.querySelector('[data-layer="month"]').getBoundingClientRect();
              const cells = [...document.querySelectorAll(
                  '[data-layer="month"] button[data-day-key]:not([disabled])')]
                .map(b => ({ b, r: b.getBoundingClientRect() }))
                .filter(x => x.r.top > st.top + 80 && x.r.bottom < st.bottom - 80 && x.r.height > 0);
              const pick = cells[Math.floor(cells.length / 2)];
              if (!pick) return { error: 'no visible month cell' };
              const watch = (%WATCH%)();
              pick.b.click();
              return await watch;
            }""".replace("%WATCH%", WATCH)
            )
            if isinstance(series, dict) and series.get("error"):
                errors.append(f"dive[{tag}]: {series['error']}")
                return
            if not series:
                errors.append(f"dive[{tag}]: no flyers observed at all")
                return
            worst_frac = None  # smallest path-fraction at which a glyph was visible
            appeared = 0
            for day, frames in series.items():
                ox, oy = frames[0]["x"], frames[0]["y"]
                travel = max(
                    ((f["x"] - ox) ** 2 + (f["y"] - oy) ** 2) ** 0.5 for f in frames
                )
                if travel < 1:
                    continue
                if any(f["op"] > 0.5 for f in frames):
                    appeared += 1
                for f in frames:
                    if f["op"] <= VIS:
                        continue
                    dist = ((f["x"] - ox) ** 2 + (f["y"] - oy) ** 2) ** 0.5
                    frac = dist / travel
                    if frac < REVEAL_FRAC and dist > SETTLE_SLACK:
                        if worst_frac is None or frac < worst_frac:
                            worst_frac = frac
                        errors.append(
                            f"dive[{tag}]: flyer {day} was visible (op {f['op']:.2f}) at only "
                            f"{frac * 100:.0f}% of its path — shown near the calendar cell (the hang)"
                        )
                        break
            shown = f"{appeared}/{len(series)} flyers appeared"
            mark = "ok" if worst_frac is None else f"HANG @ {worst_frac * 100:.0f}%"
            print(
                f"  dive[{tag}]: {shown}; earliest visible path-fraction "
                f"≥ {REVEAL_FRAC * 100:.0f}%  {mark}"
            )
            if appeared == 0:
                errors.append(f"dive[{tag}]: no flyer ever became visible")

        dive("near", 0)
        # back up to the book, then a far dive (the heaviest deferred work)
        pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
        pg.wait_for_timeout(1500)
        dive("far", 3)

        ctx.close()
        browser.close()

    # de-dup the per-frame spam into one line per flyer
    seen = set()
    for e in errors:
        if e not in seen:
            print("  ✗", e)
            seen.add(e)
    print("\n", "FLYERS ONLY ON-PATH ✓" if not errors else "FLYERS HANG ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
