"""
Guard the schedule⇄calendar altitude change against "comically long" regressions.

Climbing one altitude (tap the title: schedule → month) plays a spring that
should settle in well under a second. A content-visibility experiment on the day
sections once inflated the book's scrollHeight (off-screen days collapsed to a
120px estimate), which stretched the shared-element date-flight the spring has to
cover and blew the climb out to ~2.2s. This harness reproduces the climb on a
deep seeded book and measures how long the month layer takes to come fully to
rest (transform back to scale 1, opacity to 1).

Runs in an isolated Playwright context on the dev seeder (?seed=800) — never
touches real data.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-altitude-duration.py

Exit 0 when the climb settles within the budget (a healthy book climbs in
~0.6s); non-zero if it regresses past it.
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
BUDGET_MS = 1000  # a healthy climb is ~600ms; the regression was ~2160ms

# record the month + schedule layer transforms each frame while climbing up, then
# report the first moment after which the month layer stays at rest for good
MEASURE = r"""() => new Promise(res => {
  const m = document.querySelector('[data-layer="month"]');
  if (!m) { res({ error: "month layer not found" }); return; }
  const scale = el => {
    const tr = el ? getComputedStyle(el).transform : 'none';
    if (!tr || tr === 'none') return 1;
    const mm = tr.match(/matrix\(([^)]+)\)/);
    return mm ? parseFloat(mm[1].split(',')[0]) : 1;
  };
  const op = el => el ? parseFloat(getComputedStyle(el).opacity) : 0;
  const recs = [];
  let n = 0;
  const t0 = performance.now();
  const loop = () => {
    n++;
    recs.push({ t: Math.round(performance.now() - t0), s: +scale(m).toFixed(3), o: +op(m).toFixed(2) });
    if (n < 130) requestAnimationFrame(loop);
    else {
      // settle = first frame after which scale stays ~1 and opacity ~1 to the end
      let settled = recs[recs.length - 1].t;
      for (let i = 0; i < recs.length; i++) {
        if (recs.slice(i).every(r => Math.abs(r.s - 1) < 0.01 && r.o > 0.98)) { settled = recs[i].t; break; }
      }
      res({ settled_ms: settled });
    }
  };
  document.querySelector('[data-cal-title]').click(); // schedule → month
  requestAnimationFrame(loop);
})"""


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=3)
        pg = ctx.new_page()
        # seed a deep book, then reload to the plain calendar (seeder strips its param)
        pg.goto(f"{BASE}?seed=800", wait_until="load")
        pg.wait_for_timeout(4000)
        pg.goto(BASE, wait_until="load")
        pg.wait_for_timeout(4000)
        out = pg.evaluate(MEASURE)
        ctx.close()
        browser.close()

    if "error" in out:
        print("FAILED:", out["error"])
        return 2
    ms = out["settled_ms"]
    ok = ms <= BUDGET_MS
    print(f"  schedule → month climb settled in {ms}ms   budget ≤ {BUDGET_MS}ms   {'ok' if ok else 'TOO LONG'}")
    print("\n", "ALTITUDE CLIMB SNAPPY ✓" if ok else "ALTITUDE CLIMB REGRESSED ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
