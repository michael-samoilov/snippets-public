"""
Guard the month→schedule descent's LANDING EXACTNESS against placeholder
staleness — the device-only "wrong spot / dates skip into place" bug.

On a fresh page the descent already lands exactly. The owner's device disagrees
because `--cis` placeholders are measured once at mount and the webfonts
(display:swap) then reflow every rendered card — every SKIPPED section keeps a
stale (too-short) placeholder, so the tapped row's real offsetTop no longer
equals the scrollTop that scrollToRow set against those stale heights. The
landing then slides mid-flight and settles wrong.

This harness reproduces that deterministically: after the book has mounted,
measured, and turned lazy-render on, it injects a line-height bump on the entry
prose (exactly a font swap's metric change — measured +7px per section). Then it
descends into near and far days and asserts the tapped day's section top sits at
the scroller's viewport top (offsetTop == scrollTop) within TOL px at four
moments: first paint, mid-flight, finish, and +2s settle. The +2s sample is the
one that catches whether placeholders heal.

FAILS on the pre-fix build (mid-flight ~70px off, settle ~11px off).

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-dive-exactness.py

Probe hygiene: only own-box reads (offsetTop/scrollTop) — never reaches into a
content-visibility-skipped section.
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
# DIVE_OPEN=bare validates the bare-land variant's landing precision (its band is
# blanked to zero then re-warmed on landing — a harder re-anchor than base).
_OPEN = os.environ.get("DIVE_OPEN", "")
DIVE_URL = f"{BASE}?open={_OPEN}" if _OPEN else BASE
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))  # scale runs: SNIPPETS_SEED=2400
TOL = 2  # px the tapped row's top may miss the viewport top by, at any sample

# make the metrics stale exactly as a late font swap does: every rendered card
# grows, skipped sections keep their (now too-short) placeholders
STALE = r"""() => {
  const st = document.createElement('style');
  st.id = '__stale';
  st.textContent = '.book-card-prose{line-height:1.62 !important}';
  document.head.appendChild(st);
}"""

# tap a visible enabled cell, then sample the landing error over the dive
DESCEND = r"""() => new Promise(res => {
  const mst = document.querySelector('[data-layer="month"]').getBoundingClientRect();
  const cells = [...document.querySelectorAll(
      '[data-layer="month"] button[data-day-key]:not([disabled])')]
    .map(b => ({ b, r: b.getBoundingClientRect() }))
    .filter(x => x.r.top > mst.top + 80 && x.r.bottom < mst.bottom - 80 && x.r.height > 0);
  const pick = cells[Math.floor(cells.length / 2)];
  if (!pick) { res({ error: "no visible month cell" }); return; }
  const day = pick.b.getAttribute('data-day-key');
  pick.b.click();
  const sc = document.querySelector('[data-book-scroller]');
  const row = () => [...sc.querySelectorAll('[data-day]')].find(s => s.dataset.day === day);
  const err = () => { const r = row(); return r ? Math.round(r.offsetTop - sc.scrollTop) : null; };
  const s = { f1: err() };
  const t0 = performance.now();
  const loop = (now) => {
    const t = now - t0;
    if (t > 150 && s.mid === undefined) s.mid = err();
    if (t > 700 && s.finish === undefined) s.finish = err();
    if (t < 2200) requestAnimationFrame(loop);
    else { s.settle = err(); res({ day, samples: s }); }
  };
  requestAnimationFrame(loop);
})"""


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        def descend(tag: str, months_back: int) -> None:
            ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
            pg = ctx.new_page()
            pg.goto(f"{BASE}?seed={SEED}", wait_until="load")
            pg.wait_for_timeout(4500)
            pg.goto(DIVE_URL, wait_until="load")
            pg.wait_for_timeout(5000)
            pg.evaluate(STALE)  # fonts "swap" now — placeholders go stale
            pg.wait_for_timeout(400)
            pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
            pg.wait_for_timeout(1500)
            if months_back:
                pg.evaluate(r"""(n) => {
                  const m = document.querySelector('[data-layer="month"]');
                  const sc = [...m.querySelectorAll('*')].find(
                    e => e.scrollHeight > e.clientHeight + 100);
                  if (sc) sc.scrollTop -= sc.clientHeight * n;
                }""", months_back)
                pg.wait_for_timeout(900)
            out = pg.evaluate(DESCEND)
            ctx.close()
            if "error" in out:
                errors.append(f"descent[{tag}]: {out['error']}")
                return
            s = out["samples"]
            worst = max((abs(v) for v in s.values() if v is not None), default=0)
            label = " ".join(f"{k}={s[k]:+d}" for k in ("f1", "mid", "finish", "settle") if s.get(k) is not None)
            mark = "ok" if worst <= TOL else "OFF"
            print(f"  descent[{tag}] into {out['day']} (stale world): {label}   worst |{worst}|px ≤ {TOL}px  {mark}")
            if worst > TOL:
                errors.append(
                    f"descent[{tag}]: tapped row missed the viewport top by {worst}px (samples {label})")

        descend("near", 0)
        descend("far", 3)
        browser.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "DIVE LANDS EXACT ✓" if not errors else "DIVE LANDS OFF ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
