"""
Guard the schedule⇄calendar altitude change against "comically long" regressions.

Climbing one altitude (tap the title: schedule → month) plays a spring that
should settle in well under a second AND start moving immediately. Two distinct
regressions live here:

  1. TOTAL SETTLE TIME. A content-visibility experiment on the day sections once
     inflated the book's scrollHeight (off-screen days collapsed to a 120px
     estimate), which stretched the shared-element date-flight the spring has to
     cover and blew the climb out to ~2.2s.

  2. FIRST-FRAME STALL. Curing #1's per-frame re-evaluation by flipping the whole
     book to `content-visibility: visible` at climb start forced a SYNCHRONOUS
     O(book) render on the first frame — the climb still *settled* on time but
     didn't *start* for ~360ms (the "tremendously delayed" feel). Total settle
     alone missed it, so we also assert the max rAF gap right after the click.
     The fix keeps only an on-screen band rendered (cv:hidden for the rest), so
     the first frame is cheap. This is the number that catches THAT defect.

Runs in an isolated Playwright context on the dev seeder (?seed=1200) — never
touches real data.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-altitude-duration.py

Exit 0 when the climb settles within budget AND never stalls a frame; non-zero
if either regresses.
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))  # scale runs: SNIPPETS_SEED=2400  # deep enough that an O(book) render on the climb frame is obvious
BUDGET_MS = 1000  # a healthy climb is ~600ms; the settle regression was ~2160ms
# max rAF gap in the first frames after the click. A healthy climb's first frame
# is the composite of the on-screen band (scaled) plus the month layer's reveal —
# ~150ms at 1200 entries. The defect frame is an O(book) render/relayout: ~717ms
# when the whole book flipped to content-visibility:visible, ~6s when off-screen
# flydates were measured under the transform. 300ms cleanly separates the two.
STALL_MS = 300
EARLY_FRAMES = 12  # how many frames after the click count as "right after"

# record the month layer transform each frame while climbing up, plus the gap
# between consecutive frames (a synchronous whole-book render shows as one huge
# gap right after the click), then report settle time and the worst early gap
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
  let n = 0, prev = null;
  const t0 = performance.now();
  const loop = (now) => {
    n++;
    const gap = prev === null ? 0 : Math.round(now - prev);
    prev = now;
    recs.push({ t: Math.round(now - t0), gap, s: +scale(m).toFixed(3), o: +op(m).toFixed(2) });
    if (n < 130) requestAnimationFrame(loop);
    else {
      // settle = first frame after which scale stays ~1 and opacity ~1 to the end
      let settled = recs[recs.length - 1].t;
      for (let i = 0; i < recs.length; i++) {
        if (recs.slice(i).every(r => Math.abs(r.s - 1) < 0.01 && r.o > 0.98)) { settled = recs[i].t; break; }
      }
      // worst inter-frame gap among the first EARLY_FRAMES (skip frame 1's t0 gap)
      const early = recs.slice(1, __EARLY__).map(r => r.gap);
      const maxEarlyGap = early.length ? Math.max(...early) : 0;
      res({ settled_ms: settled, max_early_gap_ms: maxEarlyGap });
    }
  };
  document.querySelector('[data-cal-title]').click(); // schedule → month
  requestAnimationFrame(loop);
})""".replace("__EARLY__", str(EARLY_FRAMES + 1))


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=3)
        pg = ctx.new_page()
        # seed a deep book, then reload to the plain calendar (seeder strips its param)
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load")
        pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load")
        pg.wait_for_timeout(5000)
        out = pg.evaluate(MEASURE)

        # ── DESCENT leg: month → schedule into a FAR (never-rendered) day.
        # This is the flow whose first frame paid the flight's interleaved
        # rect-reads (~750ms measured before the batch-reads fix). The month
        # feed scrolls back ~3 months and a VISIBLE, enabled cell is tapped —
        # exactly a reader descending into history.
        descent = {"error": "descent: setup failed"}
        if "error" not in out:
            pg.wait_for_timeout(800)  # let the ascent settle fully
            pg.evaluate(r"""() => {
              const m = document.querySelector('[data-layer="month"]');
              const sc = [...m.querySelectorAll('*')].find(
                e => e.scrollHeight > e.clientHeight + 100);
              if (sc) sc.scrollTop -= sc.clientHeight * 3;
            }""")
            pg.wait_for_timeout(900)
            descent = pg.evaluate(r"""() => new Promise(res => {
              const st = document.querySelector('[data-layer="month"]').getBoundingClientRect();
              const cells = [...document.querySelectorAll(
                  '[data-layer="month"] button[data-day-key]:not([disabled])')]
                .map(b => ({ b, r: b.getBoundingClientRect() }))
                .filter(x => x.r.top > st.top + 80 && x.r.bottom < st.bottom - 80 && x.r.height > 0);
              const pick = cells[Math.floor(cells.length / 2)];
              if (!pick) { res({ error: "descent: no visible month cell" }); return; }
              pick.b.click();
              const gaps = [];
              let n = 0, prev = null;
              const loop = (now) => {
                n++;
                if (prev !== null) gaps.push(Math.round(now - prev));
                prev = now;
                if (n < 60) requestAnimationFrame(loop);
                else res({ max_early_gap_ms: Math.max(...gaps.slice(0, __EARLY__)) });
              };
              requestAnimationFrame(loop);
            })""".replace("__EARLY__", str(EARLY_FRAMES)))
        ctx.close()
        browser.close()

    if "error" in out:
        print("FAILED:", out["error"])
        return 2
    ms = out["settled_ms"]
    gap = out["max_early_gap_ms"]
    settle_ok = ms <= BUDGET_MS
    stall_ok = gap <= STALL_MS
    d_gap = descent.get("max_early_gap_ms")
    d_ok = d_gap is not None and d_gap <= STALL_MS
    ok = settle_ok and stall_ok and d_ok
    print(f"  schedule → month climb settled in {ms}ms   budget ≤ {BUDGET_MS}ms   {'ok' if settle_ok else 'TOO LONG'}")
    print(f"  worst rAF gap in first {EARLY_FRAMES} frames: {gap}ms   budget ≤ {STALL_MS}ms   {'ok' if stall_ok else 'STALLED AT START'}")
    if d_gap is None:
        print(f"  descent: {descent.get('error', 'no measurement')}")
    else:
        print(f"  month → far schedule descent, worst early gap: {d_gap}ms   budget ≤ {STALL_MS}ms   {'ok' if d_ok else 'STALLED AT START'}")
    print("\n", "ALTITUDE CLIMB SNAPPY ✓" if ok else "ALTITUDE CLIMB REGRESSED ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
