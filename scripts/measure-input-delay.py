"""
Guard the DESCENT (calendar→schedule) input delay against being slower than the
ASCENT (schedule→calendar). "Input delay" = the wall-clock from the tap to the
first frame the view actually MOVES (the animated layer's transform leaves its
resting state). The owner reported the descent takes longer to *begin* than the
ascent; this pins descent_delay ≤ ascent_delay (+ a small tolerance), and also
holds descent under an absolute budget.

Both legs tap and then watch every rAF for the first transform change on the
zoom layers ([data-layer="month"] / [data-layer="schedule"]); the delay is that
frame's timestamp minus the click time. Reported in ms.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-input-delay.py

Runs on the dev seeder (?seed=1200); never touches real data.
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = 1200
SLACK = 40  # ms the descent may exceed the ascent by (headless frame jitter)
ABS_BUDGET = 250  # ms — descent must begin within this regardless of the ascent

# Click `sel`, then find the first frame where either zoom layer's transform
# changes from its frame-0 value; return (click→that-frame) ms and click→firstRaf.
DELAY = r"""(sel) => new Promise(res => {
  const el = document.querySelector(sel);
  if (!el) { res({ error: "no " + sel }); return; }
  const layers = [document.querySelector('[data-layer="month"]'),
                  document.querySelector('[data-layer="schedule"]')];
  const tf = () => layers.map(l => l ? getComputedStyle(l).transform : 'none').join('|');
  const t0 = performance.now();
  el.click();
  const base = tf();
  let n = 0, firstRaf = null, moved = null;
  const loop = (now) => {
    n++;
    if (firstRaf === null) firstRaf = now;
    if (moved === null && tf() !== base) moved = now;
    if (n < 45 && moved === null) requestAnimationFrame(loop);
    else res({
      delay_ms: moved === null ? -1 : Math.round(moved - t0),
      first_raf_ms: Math.round((firstRaf ?? now) - t0),
    });
  };
  requestAnimationFrame(loop);
})"""


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
        ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load")
        pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load")
        pg.wait_for_timeout(5000)

        # DESCENT: from month → schedule. Open the month layer, scroll back a few
        # months, tap a visible day. (Do descent first, from a clean month layer.)
        pg.evaluate("() => document.querySelector('[data-cal-title]').click()")  # → month
        pg.wait_for_timeout(1400)
        pg.evaluate(r"""() => {
          const m = document.querySelector('[data-layer="month"]');
          const sc = [...m.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 100);
          if (sc) sc.scrollTop -= sc.clientHeight * 3;
        }""")
        pg.wait_for_timeout(900)
        day = visible_day(pg)
        desc = pg.evaluate(DELAY, f'[data-layer="month"] button[data-day-key="{day}"]')
        pg.wait_for_timeout(1600)

        # ASCENT: schedule → month (tap the title). We're now in the schedule.
        asc = pg.evaluate(DELAY, "[data-cal-title]")

        ctx.close()
        browser.close()

    for tag, out in (("ascent (schedule→month)", asc), ("descent (month→schedule)", desc)):
        if "error" in out:
            errors.append(f"{tag}: {out['error']}")
        elif out["delay_ms"] < 0:
            errors.append(f"{tag}: never moved within 45 frames")

    if errors:
        for e in errors:
            print("  ✗", e)
        print("\n", "INPUT DELAY UNMEASURED ✗")
        return 1

    a, d = asc["delay_ms"], desc["delay_ms"]
    print(f"  ascent  begins {a}ms after tap (first rAF {asc['first_raf_ms']}ms)")
    print(f"  descent begins {d}ms after tap (first rAF {desc['first_raf_ms']}ms)")
    le_ascent = d <= a + SLACK
    under_budget = d <= ABS_BUDGET
    print(f"  descent ≤ ascent + {SLACK}ms:  {d} ≤ {a + SLACK}   {'ok' if le_ascent else 'SLOWER'}")
    print(f"  descent ≤ {ABS_BUDGET}ms budget:  {'ok' if under_budget else 'OVER'}")
    ok = le_ascent and under_budget
    if not ok:
        if not le_ascent:
            errors.append(f"descent begins {d}ms after tap — slower than ascent ({a}ms) + {SLACK}ms slack")
        if not under_budget:
            errors.append(f"descent begins {d}ms after tap — over the {ABS_BUDGET}ms budget")
    for e in errors:
        print("  ✗", e)
    print("\n", "DESCENT AS SNAPPY AS ASCENT ✓" if ok else "DESCENT LAGS ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
