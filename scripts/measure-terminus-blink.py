"""
Reproduce & measure the terminus/day-hairline blink on a month->schedule dive.

The terminus hairline (header bottom rule) and the tapped day's own top hairline
(section border-t) both land at the scroller's top clip edge. During the dive's
settle the scrollTop passes through / rests at fractional values, so the 1px day
border renders half-clipped (faded) for a few frames — the blink the owner saw.

This drives a real dive and rAF-samples, for ~1.6s:
  - scrollTop (sub-pixel)
  - the tapped row's border-top Y relative to the scroller's top (sub-pixel)
  - the terminus overlay's Y relative to the scroller's top
and reports the fractional part of the row-border offset over time (a nonzero
fraction == a half-clipped, faded hairline).

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-terminus-blink.py
"""
import os, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
CHROME = os.environ.get("PW_CHROME")

DRIVE = r"""() => new Promise(res => {
  // go to month, tap a mid day, then sample the terminus/day-border geometry
  const monthLayer = document.querySelector('[data-layer="month"]');
  const term = document.querySelector('.pointer-events-none.absolute.inset-x-0.top-0');
  const sc = document.querySelector('[data-book-scroller]');
  const mst = monthLayer.getBoundingClientRect();
  const cells = [...document.querySelectorAll('[data-layer="month"] button[data-day-key]:not([disabled])')]
    .map(b => ({ b, r: b.getBoundingClientRect() }))
    .filter(x => x.r.top > mst.top + 80 && x.r.bottom < mst.bottom - 80 && x.r.height > 0);
  const pick = cells[Math.floor(cells.length / 2)];
  if (!pick) { res({ error: 'no cell' }); return; }
  const day = pick.b.getAttribute('data-day-key');
  const rowOf = () => [...sc.querySelectorAll('[data-day]')].find(s => s.dataset.day === day);
  const samples = [];
  const t0 = performance.now();
  pick.b.click();
  function tick() {
    const now = performance.now() - t0;
    const row = rowOf();
    const scRect = sc.getBoundingClientRect();
    let borderY = null, termY = null;
    if (row) borderY = +(row.getBoundingClientRect().top - scRect.top).toFixed(2);
    if (term) termY = +(term.getBoundingClientRect().top - scRect.top).toFixed(2);
    samples.push({ t: +now.toFixed(0), scrollTop: +sc.scrollTop.toFixed(2), borderY, termY });
    if (now < 1600) requestAnimationFrame(tick);
    else res({ day, samples });
  }
  requestAnimationFrame(tick);
})"""

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME) if CHROME else p.chromium.launch()
        pg = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        pg.goto(f"{BASE}?seed=600&years=3", wait_until="load", timeout=60000)
        pg.wait_for_selector(".book-card", state="attached", timeout=45000)
        pg.wait_for_timeout(2500)
        # zoom out to the month canvas (history 'floor' -> Back is the zoom-out; 'm' too)
        pg.keyboard.press("m")
        pg.wait_for_timeout(1500)
        out = pg.evaluate(DRIVE)
        b.close()
    if "error" in out:
        print("ERROR:", out["error"]); sys.exit(1)
    print(f"dived into day {out['day']}\n")
    print(f"{'t(ms)':>6} {'scrollTop':>10} {'borderY':>9} {'frac':>6} {'termY':>8}  gap")
    prev = None
    for s in out["samples"]:
        by = s["borderY"]
        frac = None if by is None else round(abs(by - round(by)), 2)
        gap = None if (by is None or s["termY"] is None) else round(by - s["termY"], 2)
        flag = "  <-- half-clipped" if (frac is not None and frac > 0.15 and by is not None and -2 < by < 3) else ""
        # only print transitions / a decimated view
        if prev is None or abs((s["scrollTop"]) - prev) > 0.01 or flag:
            print(f"{s['t']:>6} {s['scrollTop']:>10} {str(by):>9} {str(frac):>6} {str(s['termY']):>8}  {gap}{flag}")
        prev = s["scrollTop"]

main()
