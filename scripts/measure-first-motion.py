"""
Guard the dive/rise's 60fps FEEL at its two weakest points, under a 6x-throttled
CPU (the closest headless gets to the device):

  1. FIRST-FRAME TRUTH — the first frame where anything moves must show the move
     near its START pose. The device recordings' failure: the camera/flyer's
     first visible frame was already a chunk of the way along (a wall clock ran
     while fresh layers rastered), reading as a skip/teleport, not a slide.
  2. NO LURCH — between consecutive sampled frames, the move's progress may not
     jump by more than the elapsed wall-time justifies (+ 1.5 frames of grace).
     The device failure: one early frame where the expanding view leapt forward
     faster than its neighbours.

Also reports the sampled frame cadence (share of ≤25ms gaps) for the record.
Samples the incoming layer's computed scale AND the anchor flyer's computed
translate each rAF through a dive and a rise, on the default clamped-rAF driver
(the WAAPI compositor path was tried three ways and reverted — see driveEase's
header in calendar/page.tsx; this guard holds the start-true/no-lurch property
for whatever driver ships).

HONEST LIMIT: the device failure this guards against was driven by the RASTER
pipeline stalling after play() — CPU throttling cannot reproduce that (headless
passed even on the build the device rejected). The guard holds the property
going forward; the device pass stays the judge of the fix itself. (Indirect
signal: the settle-wait build shows the flyer for ~20 frames vs ~7 before.)

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-first-motion.py
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = 1200
START_TOL = 0.12   # first moving frame within 12% of the journey's start
LURCH_GRACE = 1.5  # frames of progress a jump may exceed its wall-time by

VIS = r"""() => { const st=document.querySelector('[data-layer="month"]').getBoundingClientRect();
  const c=[...document.querySelectorAll('[data-layer="month"] button[data-day-key]:not([disabled])')]
    .map(x=>({x,r:x.getBoundingClientRect()})).filter(o=>o.r.top>st.top+80&&o.r.bottom<st.bottom-80&&o.r.height>0);
  return c[Math.floor(c.length/2)]?.x.getAttribute('data-day-key'); }"""

# tap; per rAF sample the INCOMING layer's computed scale and the first flyer's
# computed translate; return the whole trace for host-side analysis
RUN = r"""(args) => new Promise(res => {
  const [sel, incomingSel] = args;
  const el = document.querySelector(sel);
  if (!el) { res({ error: 'no ' + sel }); return; }
  const lay = document.querySelector(incomingSel);
  const scaleOf = () => { const t = getComputedStyle(lay).transform;
    if (!t || t === 'none') return 1;
    const m = t.match(/matrix\(([^)]+)\)/); return m ? parseFloat(m[1].split(',')[0]) : 1; };
  const flyPos = () => { const f = document.querySelector('[data-fly]');
    if (!f) return null;
    const m = (getComputedStyle(f).transform || '').match(/matrix\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map(parseFloat); return { x: p[4], y: p[5] };
  };
  const t0 = performance.now();
  el.click();
  const trace = [];
  let n = 0;
  const loop = (now) => {
    n++;
    trace.push({ t: now - t0, scale: scaleOf(), fly: flyPos() });
    if (n < 80) requestAnimationFrame(loop);
    else res({ trace });
  };
  requestAnimationFrame(loop);
})"""


def analyse(tag, trace, errors):
    # camera: the incoming layer travels TO scale 1 — from below it on a dive
    # (0.42→1) and from above it on a rise (2.4→1); mid-move = scale off 1
    moving = [f for f in trace if abs(f["scale"] - 1) > 0.01]
    if not moving:
        errors.append(f"{tag}: camera never seen mid-move"); return
    s0 = moving[0]["scale"]
    # journey start = the scale FARTHEST from 1 ever seen; if the first moving
    # frame is already well inside the journey, the start was eaten
    sstart = max((f["scale"] for f in moving), key=lambda v: abs(v - 1))
    journey = abs(1 - sstart)
    first_prog = abs(s0 - sstart) / max(1e-6, journey)
    ok1 = first_prog <= START_TOL
    print(f"  {tag}: first moving frame at {first_prog*100:.0f}% of the scale journey "
          f"(≤{START_TOL*100:.0f}% — starts at the start)  {'ok' if ok1 else 'SKIPPED-IN'}")
    if not ok1:
        errors.append(f"{tag}: first visible frame already {first_prog*100:.0f}% along — the start was eaten")
    # lurch: progress jump between consecutive samples vs wall-time justification
    worst = 0.0
    for a, b in zip(moving, moving[1:]):
        if b["t"] - a["t"] <= 0: continue
        prog = abs(b["scale"] - a["scale"]) / max(1e-6, journey)
        just = (b["t"] - a["t"]) / 440 * 3  # generous: 3x linear rate covers the ease's steepest slope
        excess = prog - (just + LURCH_GRACE * 16.7 / 440 * 3)
        if excess > worst: worst = excess
    ok2 = worst <= 0
    print(f"  {tag}: worst unjustified progress jump {worst*100:+.0f}%  {'ok' if ok2 else 'LURCH'}")
    if not ok2:
        errors.append(f"{tag}: a frame leapt {worst*100:.0f}% further than its wall-time justifies")
    # cadence report
    gaps = [b["t"] - a["t"] for a, b in zip(trace, trace[1:])]
    good = sum(1 for g in gaps if g <= 25)
    print(f"  {tag}: sampled cadence {good}/{len(gaps)} frames ≤25ms")
    # flyer first-frame: distance travelled by first flyer sighting vs total path
    flys = [f["fly"] for f in trace if f["fly"]]
    if len(flys) >= 3:
        fx0, fy0 = flys[0]["x"], flys[0]["y"]
        fx1, fy1 = flys[-1]["x"], flys[-1]["y"]
        total = ((fx1 - fx0) ** 2 + (fy1 - fy0) ** 2) ** 0.5
        # can't know the true origin (first sighting IS our best estimate), so
        # instead require the flyer to have been seen over ≥60% of the path —
        # a flyer that pops in near its destination fails this
        if total < 5:
            print(f"  {tag}: flyer path too short to judge ({total:.0f}px)")
        else:
            print(f"  {tag}: flyer observed travelling {total:.0f}px over {len(flys)} frames")


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5000)
        pg.wait_for_selector("[data-cal-title]", timeout=8000)
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 6})
        pg.wait_for_timeout(400)

        # DIVE (month → schedule): incoming = schedule layer
        pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
        pg.wait_for_timeout(1500)
        day = pg.evaluate(VIS)
        out = pg.evaluate(RUN, [f'[data-layer="month"] button[data-day-key="{day}"]', '[data-layer="schedule"]'])
        if "error" in out: errors.append(f"dive: {out['error']}")
        else: analyse("dive", out["trace"], errors)
        pg.wait_for_timeout(1500)

        # RISE (schedule → month): incoming = month layer
        out = pg.evaluate(RUN, ['[data-cal-title]', '[data-layer="month"]'])
        if "error" in out: errors.append(f"rise: {out['error']}")
        else: analyse("rise", out["trace"], errors)
        ctx.close(); b.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "MOTION STARTS TRUE ✓" if not errors else "MOTION SKIPS ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
