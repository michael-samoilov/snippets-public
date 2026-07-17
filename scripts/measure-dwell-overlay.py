"""
Pin the DWELL-PREBUILD overlay contract (2026-07-17): stageDescent chunk C
builds the dive's flyer layers under the finger at opacity 0.003. Three
clauses: (1) the staged points exist during a held pointerdown; (2) the hold
changes ZERO pixels outside the pressed cell (whileTap scales the cell
itself — masked); (3) pointercancel removes every staged point. The probed
dead end this guards: promoting the month layer at dwell re-snapped its
painted content (the count dots shifted grid-wide) — additive layers only.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-dwell-overlay.py
"""
from playwright.sync_api import sync_playwright
import io
from PIL import Image, ImageChops

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
    pg = ctx.new_page()
    pg.goto("http://localhost:3000/calendar?seed=1200", wait_until="load"); pg.wait_for_timeout(4500)
    pg.goto("http://localhost:3000/calendar", wait_until="load"); pg.wait_for_timeout(5000)
    pg.evaluate("""() => new Promise(res => {
      const el = document.querySelector('[data-cal-title]');
      const r = el.getBoundingClientRect();
      const ev = t => new PointerEvent(t, {bubbles:true,pointerId:3,pointerType:'touch',isPrimary:true,clientX:r.left+8,clientY:r.top+8});
      el.dispatchEvent(ev('pointerdown'));
      setTimeout(() => { el.dispatchEvent(ev('pointerup')); setTimeout(res, 1800); }, 100);
    })""")
    before = Image.open(io.BytesIO(pg.screenshot()))
    staged = pg.evaluate("""() => new Promise(res => {
      const st = document.querySelector('[data-layer="month"]').getBoundingClientRect();
      const cs = [...document.querySelectorAll('[data-layer="month"] button[data-day-key]:not([disabled])')]
        .map(b => ({ b, r: b.getBoundingClientRect() }))
        .filter(x => x.r.top > st.top + 80 && x.r.bottom < st.bottom - 80 && x.r.height > 0);
      const pick = cs[Math.floor(cs.length / 2)];
      const r = pick.b.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      pick.b.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true,pointerId:9,pointerType:'touch',isPrimary:true,clientX:cx,clientY:cy}));
      // a >SLOP drift STANDS THE DWELL-FIRE DOWN (no dive) while leaving the
      // prebuilt overlay in place — the prebuild aborts only on
      // pointercancel/scroll, not on a drift — so the overlay can be
      // inspected statically without the early-fire zooming mid-probe
      pick.b.dispatchEvent(new PointerEvent('pointermove', {bubbles:true,pointerId:9,pointerType:'touch',isPrimary:true,clientX:cx+16,clientY:cy}));
      setTimeout(() => res({
        stagedPoints: document.querySelectorAll('[data-fly-staged]').length,
        cell: { l: r.left, t: r.top, r: r.right, b: r.bottom },
      }), 320);
    })""")
    during = Image.open(io.BytesIO(pg.screenshot()))
    diff = ImageChops.difference(before.convert("RGB"), during.convert("RGB"))
    bbox = diff.getbbox()
    import numpy as np
    arr = np.array(diff)
    m = arr.max(axis=2) > 12
    c = staged["cell"]
    # mask the tapped cell (whileTap press is a REAL change) at dsf=2, pad 6px
    y0, y1 = int((c["t"]-6)*2), int((c["b"]+6)*2)
    x0, x1 = int((c["l"]-6)*2), int((c["r"]+6)*2)
    incell = int(m[y0:y1, x0:x1].sum())
    m[y0:y1, x0:x1] = False
    changed = int(m.sum())
    print(f"staged points during hold: {staged['stagedPoints']}")
    print(f"changed px OUTSIDE tapped cell: {changed}  (inside, whileTap: {incell})  bbox: {bbox}")
    import PIL.ImageOps
    d2 = PIL.ImageOps.autocontrast(diff.convert("L"))
    d2.save("/tmp/claude-0/-home-user-snippets/f58aad0a-b81c-5873-98dc-00d9bffa9f54/scratchpad/overlay_diff.png")
    before.save("/tmp/claude-0/-home-user-snippets/f58aad0a-b81c-5873-98dc-00d9bffa9f54/scratchpad/overlay_before.png")
    # abort on pointercancel
    gone = pg.evaluate("""() => {
      window.dispatchEvent(new PointerEvent('pointercancel', {bubbles:true,pointerId:9,pointerType:'touch',isPrimary:true}));
      return new Promise(r => setTimeout(() => r(document.querySelectorAll('[data-fly-staged]').length), 120));
    }""")
    print(f"staged points after pointercancel: {gone}")
    ok = staged["stagedPoints"] > 3 and changed < 40 and gone == 0
    print("\n", "OVERLAY INVISIBLE + ABORTS ✓" if ok else "OVERLAY VISIBLE OR STUCK ✗")
    b.close()
    import sys
    sys.exit(0 if ok else 1)
