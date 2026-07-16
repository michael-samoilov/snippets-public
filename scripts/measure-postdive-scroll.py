"""
After a calendar→schedule dive, TWO device bugs:
  (a) an immediate scroll gets its momentum killed — something writes scrollTop
      (or shifts layout) in the window right after the view lands, and on iOS any
      programmatic scrollTop write / layout jump during momentum kills it;
  (b) the flying date lands slightly off (reported: to the right) of the real
      margin date it should become.

Headless Chromium has no iOS fling momentum, so we can't measure momentum
directly — instead we measure its CAUSES precisely:
  · instrument the book scroller's scrollTop setter + scrollTo/scrollBy, logging
    every programmatic write with a JS stack and a timestamp;
  · rAF-trace scrollTop + scrollHeight across the whole dive and ~700ms after;
  · capture the LAST flyer glyph position and the real margin date it targets,
    and report the x/y delta (the "off to the right").

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-postdive-scroll.py
"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))  # scale runs: SNIPPETS_SEED=2400

INSTRUMENT = r"""(() => {
  window.__w = [];
  const d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  Object.defineProperty(Element.prototype, 'scrollTop', {
    get() { return d.get.call(this); },
    set(v) {
      if (this.hasAttribute && this.hasAttribute('data-book-scroller'))
        window.__w.push({ t: performance.now(), v, via: 'set',
                          stack: (new Error()).stack.split('\n').slice(2,4).join(' | ') });
      return d.set.call(this, v);
    }, configurable: true,
  });
  for (const fn of ['scrollTo','scrollBy']) {
    const o = Element.prototype[fn];
    Element.prototype[fn] = function (...a) {
      if (this.hasAttribute && this.hasAttribute('data-book-scroller'))
        window.__w.push({ t: performance.now(), v: a[0]?.top ?? a[1], via: fn,
                          stack: (new Error()).stack.split('\n').slice(2,4).join(' | ') });
      return o.apply(this, a);
    };
  }
})()"""

VIS = r"""() => { const st=document.querySelector('[data-layer="month"]').getBoundingClientRect();
  const c=[...document.querySelectorAll('[data-layer="month"] button[data-day-key]:not([disabled])')]
    .map(x=>({x,r:x.getBoundingClientRect()})).filter(o=>o.r.top>st.top+80&&o.r.bottom<st.bottom-80&&o.r.height>0);
  return c[Math.floor(c.length/2)]?.x.getAttribute('data-day-key'); }"""

# tap; trace scrollTop/scrollHeight + camera scale each frame; snapshot the last
# flyer x/y and its target real date x/y just before finish removes the flyer.
TAP = r"""(sel) => new Promise(res => {
  const el = document.querySelector(sel);
  if (!el) { res({error:'no '+sel}); return; }
  const lay = document.querySelector('[data-layer="schedule"]');
  const scaleOf = l => { const t=l?getComputedStyle(l).transform:'none'; if(!t||t==='none')return 1;
    const m=t.match(/matrix\(([^)]+)\)/); return m?parseFloat(m[1].split(',')[0]):1; };
  const t0 = performance.now();
  window.__w = [];
  el.click();
  const sc = () => document.querySelector('[data-book-scroller]');
  const trace = []; let n=0, landedAt=null, lastFly=null;
  const loop = (now) => {
    n++;
    const s = sc();
    const scale = scaleOf(lay);
    if (landedAt===null && Math.abs(scale-1)<0.01) landedAt = now-t0;
    // capture the anchor day's flyer + real date while both exist
    const fly = document.querySelector('[data-fly]');
    if (fly) {
      const day = fly.getAttribute('data-fly');
      const g = fly.querySelector('span:not([style*="opacity: 0"])') || fly.querySelector('span');
      const fr = (g||fly).getBoundingClientRect();
      const real = document.querySelector(`[data-flydate="${day}"]`);
      const rr = real ? real.getBoundingClientRect() : null;
      lastFly = { day, fx: fr.left+fr.width/2, fy: fr.top+fr.height/2,
                  rx: rr?rr.left+rr.width/2:null, ry: rr?rr.top+rr.height/2:null,
                  realVis: real?getComputedStyle(real).visibility:null };
    }
    if (s) trace.push({ t: now-t0, st: s.scrollTop, sh: s.scrollHeight, scale });
    if (n < 90) requestAnimationFrame(loop);
    else res({ landedAt, lastFly, writes: window.__w.map(w=>({...w, rel: Math.round(w.t-t0)})),
               shDelta: Math.max(...trace.map(f=>f.sh)) - Math.min(...trace.map(f=>f.sh)) });
  };
  requestAnimationFrame(loop);
})"""

def main() -> int:
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width":393,"height":852}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.add_init_script(INSTRUMENT)
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5000)
        pg.wait_for_selector("[data-cal-title]", timeout=8000)
        for i in range(3):
            pg.evaluate("() => document.querySelector('[data-cal-title]').click()"); pg.wait_for_timeout(1300)
            out = pg.evaluate(TAP, f'[data-layer="month"] button[data-day-key="{pg.evaluate(VIS)}"]')
            print(f"\n== dive #{i+1} ==")
            if "error" in out: print("  ", out["error"]); continue
            print(f"  visually landed @ {round(out['landedAt']) if out['landedAt'] else '?'}ms · scrollHeight moved {round(out['shDelta'])}px during+after")
            lf = out.get("lastFly")
            if lf and lf["rx"] is not None:
                print(f"  flyer last vs real date: dx={round(lf['fx']-lf['rx'],1)}px dy={round(lf['fy']-lf['ry'],1)}px (real visibility={lf['realVis']})")
            w = out["writes"]
            if not w: print("  scrollTop writes: none")
            for x in w:
                flag = "  <-- POST-LANDING" if (out['landedAt'] and x['rel'] > out['landedAt']-30) else ""
                print(f"  scrollTop {x['via']} @ {x['rel']}ms -> {round(x['v']) if isinstance(x['v'],(int,float)) else x['v']}{flag}")
                print(f"      {x['stack']}")
            pg.wait_for_timeout(1200)
            pg.evaluate("() => history.back()"); pg.wait_for_timeout(1300)
        ctx.close(); b.close()
    return 0

if __name__ == "__main__":
    sys.exit(main())
