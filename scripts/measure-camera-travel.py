"""
Guard the schedule⇄calendar CAMERA move (the layer scale/opacity of the dive &
rise) against wall-clock fast-forward — the same failure the date flyers had
(measure-flight-travel.py), one level up. The altitude move should ride a
per-frame-CLAMPED spring so a stalled setup frame lengthens it rather than
skipping it; a wall-clock spring jumps the scale most of the way in one frame,
which reads as the view snapping instead of gliding (the "not as smooth as the
entry morph" the owner reported).

This taps ascent (schedule→month) and descent (month→schedule) and tracks the
ARRIVING layer's computed scale every frame. It requires the scale to spend
several frames genuinely mid-flight — between 10% and 90% of the way from its
start scale to 1 — rather than snapping across in one frame.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-camera-travel.py

Runs on the dev seeder (?seed=1200); never touches real data.
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = 1200
MIN_MIDFLIGHT = 3
LO, HI = 0.10, 0.90

# Click `sel`, then each frame read the scale of BOTH zoom layers and keep the
# one that is actually moving (the arriving layer travels start→1). Stop once it
# has settled at 1 for a few frames.
TRACK = r"""(sel) => new Promise(res => {
  const el = document.querySelector(sel);
  if (!el) { res({ error: "no " + sel }); return; }
  const layers = () => [document.querySelector('[data-layer="month"]'),
                        document.querySelector('[data-layer="schedule"]')];
  const scaleOf = (l) => {
    const tr = l ? getComputedStyle(l).transform : 'none';
    if (!tr || tr === 'none') return 1;
    const m = tr.match(/matrix\(([^)]+)\)/);
    return m ? parseFloat(m[1].split(',')[0]) : 1;
  };
  el.click();
  const series = [[], []];
  let n = 0;
  const loop = () => {
    n++;
    const ls = layers();
    series[0].push(scaleOf(ls[0]));
    series[1].push(scaleOf(ls[1]));
    if (n < 50) requestAnimationFrame(loop);
    else res({ series });
  };
  requestAnimationFrame(loop);
})"""


def midflight(series):
    """A layer's scale rests at 1, travels to an extreme (the arriving layer
    scales up 1/factor→1; the departing one 1→factor) and settles at 1. Measure
    from the EXTREME (furthest from 1), not series[0] — frame 1 is captured
    before the move starts, so it reads the resting 1. Count frames strictly
    between 10% and 90% of extreme→1."""
    moving = [s for s in series if abs(s - 1) > 0.001]
    if len(moving) < 2:
        return None  # this layer didn't move (it's the other/settled one)
    extreme = max(series, key=lambda s: abs(s - 1))
    span = abs(1 - extreme)
    if span < 0.05:
        return None  # negligible travel
    mids = 0
    for s in series:
        frac = abs(s - extreme) / span
        if LO < frac < HI:
            mids += 1
    return mids


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        def leg(tag, sel, setup):
            ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
            pg = ctx.new_page()
            pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
            pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5000)
            realsel = setup(pg)
            out = pg.evaluate(TRACK, realsel or sel)
            ctx.close()
            if "error" in out:
                errors.append(f"{tag}: {out['error']}"); return
            best = None
            for s in out["series"]:
                m = midflight(s)
                if m is not None and (best is None or m > best):
                    best = m
            if best is None:
                errors.append(f"{tag}: no moving layer captured"); return
            ok = best >= MIN_MIDFLIGHT
            print(f"  {tag}: arriving layer {best} mid-flight scale frames "
                  f"(need ≥{MIN_MIDFLIGHT})  {'ok' if ok else 'SNAP'}")
            if not ok:
                errors.append(f"{tag}: camera scale snapped — only {best} mid-flight frames "
                              f"(needs ≥{MIN_MIDFLIGHT}); wall-clock fast-forward")

        def to_month(pg):
            return "[data-cal-title]"

        def to_schedule(pg):
            pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
            pg.wait_for_timeout(1400)
            pg.evaluate(r"""() => { const m=document.querySelector('[data-layer="month"]');
              const sc=[...m.querySelectorAll('*')].find(e=>e.scrollHeight>e.clientHeight+100);
              if(sc) sc.scrollTop -= sc.clientHeight*3; }""")
            pg.wait_for_timeout(900)
            day = pg.evaluate(r"""() => { const st=document.querySelector('[data-layer="month"]').getBoundingClientRect();
              const cells=[...document.querySelectorAll('[data-layer="month"] button[data-day-key]:not([disabled])')]
                .map(b=>({b,r:b.getBoundingClientRect()})).filter(x=>x.r.top>st.top+80&&x.r.bottom<st.bottom-80&&x.r.height>0);
              return cells[Math.floor(cells.length/2)]?.b.getAttribute('data-day-key'); }""")
            return f'[data-layer="month"] button[data-day-key="{day}"]'

        leg("ascent (schedule→month)", None, to_month)
        leg("descent (month→schedule)", None, to_schedule)
        browser.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "CAMERA GLIDES ✓" if not errors else "CAMERA SNAPS ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
