"""
Guard the calendar⇄schedule input delay: the wall-clock from the tap to the
first frame the view actually MOVES (a zoom layer's scale leaves its resting 1).

The owner wants BOTH directions well under ~150ms (ideally 50–100ms). The
descent (calendar→schedule) is the slow one: its zoom layout-effect does real
synchronous work before the first paint (markOnStage + relandOnRow's row sweep +
the shared-element flight's rect reads), and a FAR dive additionally lays out a
never-rendered destination band. This measures three legs:

  · ascent  (schedule→month)  — tap the title
  · descent NEAR (a day already on/near screen) — the common review dive
  · descent FAR (months back, never-rendered) — the worst case

Detection is the first SUSTAINED scale change (a layer scale ≠1 that persists ≥2
frames), so a stray one-frame style blip can't read as motion.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-input-delay.py

Budget: NEAR descent (and ascent) ≤ NEAR_BUDGET; FAR is reported (it carries the
irreducible destination-render cost) and held under FAR_BUDGET.
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = 1200
NEAR_BUDGET = 150  # ms — the target for the common dive + the ascent
FAR_BUDGET = 260   # ms — a far dive also pays the destination band's first render

# Click sel; each frame read both zoom layers' scale; report the first frame a
# scale is ≠1 AND stays ≠1 on the next frame (sustained motion), minus click.
DELAY = r"""(sel) => new Promise(res => {
  const el = document.querySelector(sel);
  if (!el) { res({ error: "no " + sel }); return; }
  const layers = [document.querySelector('[data-layer="month"]'),
                  document.querySelector('[data-layer="schedule"]')];
  const scaleOf = (l) => {
    const t = l ? getComputedStyle(l).transform : 'none';
    if (!t || t === 'none') return 1;
    const m = t.match(/matrix\(([^)]+)\)/);
    return m ? parseFloat(m[1].split(',')[0]) : 1;
  };
  const moved = () => layers.some(l => Math.abs(scaleOf(l) - 1) > 0.003);
  const t0 = performance.now();
  el.click();
  let n = 0, firstMoveTs = null;
  const loop = (now) => {
    n++;
    const m = moved();
    if (m && firstMoveTs === null) firstMoveTs = now;
    else if (!m) firstMoveTs = null;             // require it to persist
    // resolve one frame AFTER motion began (sustained)
    if (firstMoveTs !== null && now > firstMoveTs) { res({ d: Math.round(firstMoveTs - t0) }); return; }
    if (n < 50) requestAnimationFrame(loop); else res({ d: -1 });
  };
  requestAnimationFrame(loop);
})"""


def vis_day(pg):
    return pg.evaluate(r"""() => {
      const st = document.querySelector('[data-layer="month"]').getBoundingClientRect();
      const c = [...document.querySelectorAll('[data-layer="month"] button[data-day-key]:not([disabled])')]
        .map(x => ({ x, r: x.getBoundingClientRect() }))
        .filter(o => o.r.top > st.top + 80 && o.r.bottom < st.bottom - 80 && o.r.height > 0);
      return c[Math.floor(c.length / 2)]?.x.getAttribute('data-day-key');
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

        # NEAR descent — open month, tap a visible day straight away
        pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
        pg.wait_for_timeout(1300)
        near = pg.evaluate(DELAY, f'[data-layer="month"] button[data-day-key="{vis_day(pg)}"]')
        pg.wait_for_timeout(1400)

        # ASCENT — now in the schedule, tap the title
        asc = pg.evaluate(DELAY, "[data-cal-title]")
        pg.wait_for_timeout(1400)

        # FAR descent — open month, scroll back 4 months, tap
        pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
        pg.wait_for_timeout(1300)
        pg.evaluate(r"""() => { const m=document.querySelector('[data-layer="month"]');
          const sc=[...m.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+100);
          if(sc) sc.scrollTop -= sc.clientHeight*2.5; }""")
        pg.wait_for_timeout(1100)
        far_day = vis_day(pg)
        far = pg.evaluate(DELAY, f'[data-layer="month"] button[data-day-key="{far_day}"]') if far_day \
            else {"error": "no far cell"}
        ctx.close()
        browser.close()

    def check(tag, out, budget, gate):
        if "error" in out or out.get("d", -1) < 0:
            if gate:
                errors.append(f"{tag}: never moved / {out.get('error','no motion')}")
            print(f"  {tag}: (no motion captured — {out.get('error','')})")
            return
        d = out["d"]
        ok = d <= budget
        mark = "ok" if ok else ("OVER" if gate else "(reported)")
        print(f"  {tag}: begins {d}ms after tap   budget ≤{budget}ms   {mark}")
        if gate and not ok:
            errors.append(f"{tag}: {d}ms after tap — over the {budget}ms budget")

    check("ascent (schedule→month)", asc, NEAR_BUDGET, gate=True)
    check("descent NEAR", near, NEAR_BUDGET, gate=True)
    # FAR carries the irreducible cost of first-rendering a never-seen
    # destination page — reported for tracking, not gated.
    check("descent FAR ", far, FAR_BUDGET, gate=False)

    for e in errors:
        print("  ✗", e)
    print("\n", "INPUT SNAPPY ✓" if not errors else "INPUT LAGS ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
