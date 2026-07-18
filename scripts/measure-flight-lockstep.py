"""
Guard the calendar→schedule dive's flyers against the "hang then rush" — the
device-visible artifact the fidelity harness can't see (it only checks the
LANDING, not the path taken to get there).

The dive plays the month's camera FIRST and defers the flight build behind it
(earlyOut). The flyers used to be COMPRESSED into the camera's remaining time:
each one sat parked at its origin pose — where the month cell WAS — for the
whole span the deferred book work took, while the camera scaled the month away,
then darted to catch up. On screen: the number hangs in mid-air over the fading
calendar, then jumps disjointly onto its path.

The fix syncs the flyers to the CAMERA's clock (same 440ms timeline) instead of
compressing, and builds them opacity:0 so their first paint is already the
camera-synced pose. So the invariant this asserts, sampling every frame of a far
dive:

  once a flyer is visible (opacity > 0.05), it is never FROZEN while the camera
  is still moving. A run of consecutive visible frames where the flyer's
  transform barely changes (|Δ| < FROZEN_PX) while the camera's scale is clearly
  changing (|Δscale| > CAM_MOVE) is a hang — assert the longest such run is ≤
  HANG_FRAMES (sampling jitter only, not a real dwell).

FAILS on the compressed build: the flyer is visible and parked at origin for the
several frames the deferred book work runs while the camera scales.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-flight-lockstep.py

Probe hygiene: reads only computed transforms of the flyer points and the month
layer — never reaches into a content-visibility-skipped section.
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))
FROZEN_PX = 0.75  # a visible flyer moving less than this frame-to-frame is "still"
CAM_MOVE = 0.002  # month scale changing more than this frame-to-frame is "moving"
HANG_FRAMES = 2  # longest tolerated still-flyer-while-camera-moves run (jitter)

# Sample every rAF for ~550ms after a tap: each flyer point's translate + opacity
# and the month layer's scale (matrix `a`). Returns the per-flyer frame series.
WATCH = r"""() => new Promise(res => {
  const mlayer = document.querySelector('[data-layer="month"]');
  const camScale = () => {
    const m = (getComputedStyle(mlayer).transform || '').match(/matrix\(([^)]+)\)/);
    return m ? +m[1].split(',')[0] : 1;  // a = scaleX
  };
  const series = {};      // day -> [{x,y,op,cam}]
  const t0 = performance.now();
  const loop = () => {
    const cam = camScale();
    for (const p of document.querySelectorAll('[data-fly]')) {
      const cm = (getComputedStyle(p).transform || '').match(/matrix\(([^)]+)\)/);
      if (!cm) continue;
      const parts = cm[1].split(',').map(v => +v.trim());
      const day = p.dataset.fly;
      (series[day] ||= []).push({
        x: parts[4], y: parts[5],
        op: +getComputedStyle(p).opacity, cam,
      });
    }
    if (performance.now() - t0 < 550) requestAnimationFrame(loop);
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
                  // if the target landed on a gap, walk back down a viewport at a
                  // time until enabled cells render in view (bounded)
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
            worst_run = 0
            worst_day = None
            for day, frames in series.items():
                vis = [f for f in frames if f["op"] > 0.05]
                if len(vis) < 3:
                    continue
                # origin = first visible pose; travel = the whole path length. The
                # HANG is the flyer parked NEAR its origin while the camera moves;
                # the flyer legitimately parks at its DESTINATION (fill-forwards)
                # while the camera's easeOut tail still creeps — exclude that by
                # only counting frozen frames within the first 20% of the travel.
                ox, oy = vis[0]["x"], vis[0]["y"]
                travel = max(
                    ((f["x"] - ox) ** 2 + (f["y"] - oy) ** 2) ** 0.5 for f in vis
                )
                near_origin = travel * 0.2
                run = 0
                prev = None
                for f in vis:
                    if prev is not None:
                        dmove = ((f["x"] - prev["x"]) ** 2 + (f["y"] - prev["y"]) ** 2) ** 0.5
                        dcam = abs(f["cam"] - prev["cam"])
                        from_origin = ((f["x"] - ox) ** 2 + (f["y"] - oy) ** 2) ** 0.5
                        if dmove < FROZEN_PX and dcam > CAM_MOVE and from_origin < near_origin:
                            run += 1
                            if run > worst_run:
                                worst_run, worst_day = run, day
                        else:
                            run = 0
                    prev = f
            n_vis = sum(
                1 for frames in series.values() for f in frames if f["op"] > 0.05
            )
            mark = "ok" if worst_run <= HANG_FRAMES else "HANG"
            print(
                f"  dive[{tag}]: {len(series)} flyer(s), {n_vis} visible frames; "
                f"longest frozen-while-camera-moves run = {worst_run} "
                f"(≤ {HANG_FRAMES})  {mark}"
                + (f"  [day {worst_day}]" if worst_day else "")
            )
            if worst_run > HANG_FRAMES:
                errors.append(
                    f"dive[{tag}]: a flyer stayed frozen for {worst_run} frames while the "
                    f"camera scaled — the hang (day {worst_day})"
                )

        dive("near", 0)
        # back up to the book, then a far dive (the worst hang case)
        pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
        pg.wait_for_timeout(1500)
        dive("far", 3)

        ctx.close()
        browser.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "FLIGHTS RIDE THE CAMERA ✓" if not errors else "FLYERS HANG ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
