"""
Pin the LIFT-FIRE contract (dive/rise input at pointerup, 2026-07-17): iOS
delivers the synthesized click 80-300ms after the finger lifts, so the
calendar<->schedule zooms fire at POINTERUP. Four clauses, each a real
regression if broken:

  1. A clean lift (down+up, NO click ever arrives) runs the move — the app
     must not depend on the click.
  2. A drifted lift (finger wandered >12px) fires NOTHING.
  3. The full native sequence (down, up, then the trailing synthesized
     click) runs the move exactly ONCE. This is the two-pop guard: the
     title's schedule->month close is history.back(), which the zooming
     latch does NOT protect — a slipped-through click would pop two
     altitudes and walk off the calendar.
  4. A bare click with no preceding lift (keyboard/AT activation) still
     runs the move.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-lift-fire.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))

# dispatch helpers dispatch REAL PointerEvents at the element's center (the
# handlers check coordinates for drift), never Playwright's click, so each
# clause controls exactly which events exist
DISPATCH = r"""(args) => {
  const el = document.querySelector(args.sel);
  if (!el) return 'no ' + args.sel;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const ev = (type, dx, dy) => new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch',
    isPrimary: true, clientX: cx + (dx || 0), clientY: cy + (dy || 0),
  });
  el.dispatchEvent(ev('pointerdown'));
  const hold = args.hold || 100;
  // a real drift emits a pointermove BEFORE the lift (a finger that pans
  // moves continuously) — dispatch it early so the stationary-dwell timer
  // sees the movement and stands down, exactly as it would on device
  if (args.driftX || args.driftY)
    setTimeout(() => el.dispatchEvent(ev('pointermove', args.driftX || 0, args.driftY || 0)), 30);
  return new Promise(res => setTimeout(() => {
    if (args.cancel) { el.dispatchEvent(ev('pointercancel')); res('ok'); return; }
    if (!args.noUp)
      el.dispatchEvent(ev('pointerup', args.driftX || 0, args.driftY || 0));
    if (args.click) setTimeout(() => el.click(), 120);
    res('ok');
  }, hold));
}"""

COUNT_RUNS = "() => performance.getEntriesByName('zoom-run').length"
VIEW = r"""() => {
  const vis = (n) => {
    const el = document.querySelector(`[data-layer="${n}"]`);
    return el && getComputedStyle(el).visibility === 'visible';
  };
  return ['schedule', 'month', 'year', 'entry'].find(vis) || 'none';
}"""


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852},
                                  device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5000)

        runs = pg.evaluate(COUNT_RUNS)

        def check(step: str, want_view: str, want_new_runs: int, settle: int = 1600):
            nonlocal runs
            pg.wait_for_timeout(settle)
            v = pg.evaluate(VIEW)
            n = pg.evaluate(COUNT_RUNS)
            path_ok = pg.evaluate("() => location.pathname").endswith("/calendar")
            if v != want_view or n - runs != want_new_runs or not path_ok:
                errors.append(
                    f"{step}: view={v} (want {want_view}), "
                    f"new zoom-runs={n - runs} (want {want_new_runs}), "
                    f"on-calendar={path_ok}")
            else:
                print(f"  {step}: view={v}, runs+{n - runs} ✓")
            runs = n

        # 1. TITLE CLEAN LIFT (no click ever): schedule -> month must run
        pg.evaluate(DISPATCH, {"sel": "[data-cal-title]", "click": False})
        check("title clean lift (no click)", "month", 1)

        # pick a visible, enabled day well inside the month viewport
        day = pg.evaluate(r"""() => {
          const st = document.querySelector('[data-layer="month"]').getBoundingClientRect();
          const cs = [...document.querySelectorAll('[data-layer="month"] button[data-day-key]:not([disabled])')]
            .map(b => ({ b, r: b.getBoundingClientRect() }))
            .filter(x => x.r.top > st.top + 80 && x.r.bottom < st.bottom - 80 && x.r.height > 0);
          return cs[Math.floor(cs.length / 2)]?.b.getAttribute('data-day-key');
        }""")
        if not day:
            errors.append("no pickable day found")
        else:
            sel = f'[data-layer="month"] button[data-day-key="{day}"]'

            # 2. DAY DRIFTED (pointermove >slop, then a drifted lift): >12px
            #    of wander is scroll intent, not a tap — nothing fires
            pg.evaluate(DISPATCH, {"sel": sel, "click": False, "driftY": 40})
            check("day drifted", "month", 0, settle=900)

            # 3. DAY CLEAN LIFT (no click): the dive must run on the release
            pg.evaluate(DISPATCH, {"sel": sel, "click": False})
            check("day clean lift (no click)", "schedule", 1)

            # 4. TITLE FULL NATIVE SEQUENCE (down, up, trailing click):
            #    exactly one rise, ONE history pop — never two (the
            #    two-pop guard; a double back walks off the calendar)
            pg.evaluate(DISPATCH, {"sel": "[data-cal-title]", "click": True})
            check("title lift + trailing click", "month", 1, settle=2000)

            # 5. DAY FULL NATIVE SEQUENCE (lift + trailing click): one dive
            pg.evaluate(DISPATCH, {"sel": sel, "click": True})
            check("day lift + trailing click", "schedule", 1, settle=2000)

            # 6. DAY SCROLL (pointermove drift then pointercancel): the browser
            #    took the gesture for a pan — nothing fires
            pg.evaluate(DISPATCH, {"sel": "[data-cal-title]", "click": False})
            check("  (return to month)", "month", 1)
            pg.evaluate(DISPATCH, {"sel": sel, "driftY": 40, "cancel": True})
            check("day scroll (move + cancel)", "month", 0, settle=900)

            # 7. BARE CLICK (keyboard/AT): no pointer events at all. From
            #    schedule so the title rises schedule->month
            pg.evaluate(DISPATCH, {"sel": sel, "click": False})
            check("  (dive to schedule)", "schedule", 1)
            pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
            check("title bare click (keyboard/AT)", "month", 1)

        browser.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "LIFT-FIRE CONTRACT HOLDS ✓" if not errors else "LIFT-FIRE BROKEN ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
