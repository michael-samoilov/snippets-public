"""
REPORT-ONLY (not a gate) — and a documented DEAD END.

Measures whether the altitude camera keeps ADVANCING while the main thread
stalls mid-flight (a 220ms busy-loop injected 60ms after motion begins; scale
progress read 360ms after motion start). The rAF clamped-dt driver scores
~0.76-0.87 here (the stall freezes it — the on-device choppiness); a compositor
(WAAPI) camera scored 0.99.

We SHIPPED the WAAPI camera (9ff8f7c) and REVERTED it: on the owner's device the
dive showed no animation at all (instant cut) and the rise wiggled/skipped back.
WAAPI runs on the wall clock from ~creation; the device's setup stall (probe
commit + destination band raster, far bigger than headless) ate the move before
its first paintable frame — the wall-clock planted-dates bug at the platform
level. See driveEase's header comment in calendar/page.tsx. Compositor
animation becomes viable only once setup fits inside one frame; until then this
script just reports the number.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-stall-immunity.py
"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))  # scale runs: SNIPPETS_SEED=2400
# 360ms after motion begins, the eased 440ms move should be ≥90% travelled; a
# main-thread camera frozen 220ms mid-flight (plus the clamp's one-frame
# forgiveness) reaches only ~60%
MIN_PROGRESS = 0.95

VIS = r"""() => { const st=document.querySelector('[data-layer="month"]').getBoundingClientRect();
  const c=[...document.querySelectorAll('[data-layer="month"] button[data-day-key]:not([disabled])')]
    .map(x=>({x,r:x.getBoundingClientRect()})).filter(o=>o.r.top>st.top+80&&o.r.bottom<st.bottom-80&&o.r.height>0);
  return c[Math.floor(c.length/2)]?.x.getAttribute('data-day-key'); }"""

RUN = r"""(sel) => new Promise(res => {
  const el = document.querySelector(sel);
  if (!el) { res({ error: 'no ' + sel }); return; }
  const lay = document.querySelector('[data-layer="schedule"]');
  const scaleOf = () => { const t = getComputedStyle(lay).transform;
    if (!t || t === 'none') return 1;
    const m = t.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[0]) : 1; };
  const t0 = performance.now();
  el.click();
  // wait for MOTION to begin, then inject the stall 60ms in — squarely
  // mid-flight, like the probe/selected commits and heals that land there —
  // and read how far the scale travelled by motionStart+360ms wall-clock
  let start = null, motionAt = null, stalled = false;
  const check = () => {
    const now = performance.now() - t0;
    const s = scaleOf();
    if (start === null && s !== 1 && s < 0.9) { start = s; motionAt = now; }
    if (start !== null && !stalled && now - motionAt >= 60) {
      stalled = true;
      const e = performance.now() + 220; while (performance.now() < e); // the stall
    }
    if (start !== null && now - motionAt >= 360) {
      res({ start, at: s, progress: (s - start) / (1 - start) });
      return;
    }
    if (now > 3000) { res({ error: 'camera never moved' }); return; }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
})"""


def main() -> int:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5000)
        pg.wait_for_selector("[data-cal-title]", timeout=8000)
        results = []
        for i in range(3):
            pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
            pg.wait_for_timeout(1300)
            day = pg.evaluate(VIS)
            out = pg.evaluate(RUN, f'[data-layer="month"] button[data-day-key="{day}"]')
            if "error" in out:
                print(f"  dive #{i+1}: {out['error']}")
            else:
                results.append(out["progress"])
                print(f"  dive #{i+1}: scale progress 360ms after motion began (220ms mid-flight stall) = {out['progress']:.2f}"
                      f"  (start {out['start']:.2f} → {out['at']:.2f})")
            pg.wait_for_timeout(1300)
            pg.evaluate("() => document.querySelector('[data-cal-title]')?.click()")
            pg.wait_for_timeout(1300)
            # back to month for next round handled by loop top
        ctx.close(); b.close()
    best = max(results) if results else 0
    print(f"\n  best progress {best:.2f}  (compositor reference: 0.99 · rAF clamped: ~0.8)")
    print("\n  REPORT ONLY — see docstring for why this is not a gate.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
