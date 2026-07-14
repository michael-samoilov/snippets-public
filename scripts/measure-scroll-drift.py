"""
Guard the book's lazy-render (content-visibility) against scroll drift/jitter.

The dive/rise input-lag fix skips the layout+paint of off-screen day sections
(content-visibility), backing each with its OWN measured height as the
placeholder (--cis) so the book's total height stays exact. If a placeholder is
ever wrong — a fixed estimate, a stale measurement — off-screen sections reserve
the wrong space and the content shifts as you scroll (the jitter that sank the
naive version). This harness scrolls a deep seeded book in fixed wheel steps and
asserts each step moves the scroller by exactly that amount: no drift.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-scroll-drift.py

Exit 0 when every step lands within a few px of the wheel delta.
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
STEP = 600  # wheel delta per step (scrolling up = -STEP)
TOL = 40  # px a step may miss the delta by before it counts as drift
STEPS = 12


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=3)
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed=800", wait_until="load")
        pg.wait_for_timeout(4500)  # let the full book mount + lazy-render turn on
        pg.goto(BASE, wait_until="load")
        pg.wait_for_timeout(4500)

        st = lambda: pg.evaluate("() => document.querySelector('[data-book-scroller]').scrollTop")
        pg.mouse.move(196, 420)
        last = st()
        deltas = []
        for _ in range(STEPS):
            pg.mouse.wheel(0, -STEP)
            pg.wait_for_timeout(200)
            cur = st()
            deltas.append(round(cur - last))
            last = cur
        ctx.close()
        browser.close()

    # ignore steps that hit the top (can't move a full STEP) — only flag genuine drift
    off = [d for d in deltas if d != 0 and abs(abs(d) - STEP) > TOL]
    ok = len(off) == 0
    print(f"  wheel steps of -{STEP}px → deltas {deltas}")
    print(f"  drifting steps (|Δ|-{STEP} > {TOL}px): {off}")
    print("\n", "SCROLL EXACT ✓" if ok else "SCROLL DRIFTS ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
