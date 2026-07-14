"""
Guard the schedule⇄calendar date-flight against TELEPORTING (the "planted dates"
regression): the shared-element date numbers must visibly TRAVEL between their
calendar-cell and schedule-header positions, not snap to the destination in a
single frame.

Why the older measure-flight-fidelity.py missed this: it checks a flyer's FIRST
(source) and LAST (destination) transforms — both correct even when the flyer
jumps source→destination in one frame. The failure lives in the frames BETWEEN.
The mechanism was a wall-clock Motion spring driving the flight: when the
descent's setup frame stalls (re-land + heal + measure), a wall-clock animation
fast-forwards to its end, so the number teleports and the schedule dates read as
"already in place / planted" for the whole move.

This harness taps a visible day (near and far descents, plus the ascent) and
tracks the anchor flyer's position every frame. It requires the flyer to spend
several frames genuinely IN FLIGHT — i.e. between 10% and 90% of the source→dest
distance — rather than covering the whole distance in one jump.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-flight-travel.py

FAILS on the teleport regression (a flyer with < MIN_MIDFLIGHT in-flight frames).
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = 1200
MIN_MIDFLIGHT = 3  # frames a real flight spends strictly between source and dest
LO, HI = 0.10, 0.90  # "mid-flight" = this fraction of the source→dest distance

# tap a target, track EVERY [data-fly] point's transform each frame until gone
TRACK = r"""(clickSel) => new Promise(res => {
  const el = typeof clickSel === 'string' ? document.querySelector(clickSel) : clickSel;
  if (!el) { res({ error: 'no target' }); return; }
  const paths = {};                       // day -> [{x,y}, ...]
  el.click();
  let n = 0, prevHad = false;
  const loop = () => {
    n++;
    const flys = document.querySelectorAll('[data-fly]');
    for (const p of flys) {
      const m = (p.style.transform || '').match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      if (!m) continue;
      (paths[p.dataset.fly] ||= []).push({ x: +m[1], y: +m[2] });
    }
    const had = flys.length > 0;
    // stop a few frames after the last flyer disappears
    if (n < 60 && (had || !prevHad || n < 8)) { prevHad = had; requestAnimationFrame(loop); }
    else res({ paths });
  };
  requestAnimationFrame(loop);
})"""


def midflight_frames(path: list) -> tuple:
    """How many samples sit strictly between source and destination."""
    if len(path) < 2:
        return 0, 0.0
    src, dst = path[0], path[-1]
    import math
    span = math.hypot(dst["x"] - src["x"], dst["y"] - src["y"])
    if span < 20:  # source ≈ dest (nothing to travel) — not a teleport case
        return -1, span
    mids = 0
    for p in path:
        frac = math.hypot(p["x"] - src["x"], p["y"] - src["y"]) / span
        if LO < frac < HI:
            mids += 1
    return mids, span


def visible_day(pg):
    return pg.evaluate(r"""() => {
      const st = document.querySelector('[data-layer="month"]').getBoundingClientRect();
      const cells = [...document.querySelectorAll(
          '[data-layer="month"] button[data-day-key]:not([disabled])')]
        .map(b => ({ b, r: b.getBoundingClientRect() }))
        .filter(x => x.r.top > st.top + 80 && x.r.bottom < st.bottom - 80 && x.r.height > 0);
      return cells[Math.floor(cells.length / 2)]?.b.getAttribute('data-day-key');
    }""")


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        def leg(tag: str, months_back, is_ascent=False) -> None:
            ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
            pg = ctx.new_page()
            pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
            pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5000)
            if is_ascent:
                pg.mouse.move(196, 420)
                for _ in range(6):
                    pg.mouse.wheel(0, -503); pg.wait_for_timeout(120)
                pg.wait_for_timeout(800)
                out = pg.evaluate(TRACK, "[data-cal-title]")
            else:
                pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
                pg.wait_for_timeout(1400)
                if months_back:
                    pg.evaluate(r"""(n) => { const m=document.querySelector('[data-layer="month"]');
                      const sc=[...m.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+100);
                      if(sc) sc.scrollTop -= sc.clientHeight*n; }""", months_back)
                    pg.wait_for_timeout(900)
                day = visible_day(pg)
                if not day:
                    errors.append(f"{tag}: no visible cell"); ctx.close(); return
                out = pg.evaluate(TRACK, f'[data-layer="month"] button[data-day-key="{day}"]')
            ctx.close()
            paths = out.get("paths", {})
            if not paths:
                errors.append(f"{tag}: no flyers at all"); return
            worst = None
            for day, path in paths.items():
                mids, span = midflight_frames(path)
                if mids == -1:
                    continue  # source≈dest, nothing to travel
                if worst is None or mids < worst[1]:
                    worst = (day, mids, span, len(path))
            if worst is None:
                print(f"  {tag}: (no travelling flyer — all source≈dest)")
                return
            day, mids, span, frames = worst
            ok = mids >= MIN_MIDFLIGHT
            print(f"  {tag}: worst flyer {day} — {mids} mid-flight frames of {frames} "
                  f"(span {span:.0f}px, need ≥{MIN_MIDFLIGHT})  {'ok' if ok else 'TELEPORT'}")
            if not ok:
                errors.append(f"{tag}: flyer {day} teleported — only {mids} frames strictly between "
                              f"source and destination (needs ≥{MIN_MIDFLIGHT}); the date is planted, not flying")

        leg("ascent", None, is_ascent=True)
        leg("descent(near)", 0)
        leg("descent(far)", 3)
        browser.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "DATES FLY ✓" if not errors else "DATES TELEPORT ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
