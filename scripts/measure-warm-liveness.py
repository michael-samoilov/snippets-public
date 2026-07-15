"""
Guard the render window's liveness: after ANY app flow, scrolling must always
warm the sections the reader reaches — never a permanently blank book.

The failure this reproduces (device recording, 2026-07-15): opening an entry
latched climbingRef (markOnStage ran for entry moves after 6ae01f7 hoisted it
above their early return) and finish()'s `climbed` — which excludes entry moves
— never released it. The warm IntersectionObserver bails while the latch is up,
so after the first entry open NOTHING ever warmed again: the reader scrolled
into permanently blank paper.

Flow: load a deep book → open an entry → close it → fling far into history →
settle → assert (a) day sections around the viewport are warm+rendered, and
(b) the climb latch is not stuck.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-warm-liveness.py
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = 1200


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        ctx = b.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5500)

        # 0. nudge up so entry tiles are on screen (the book opens at today's zone)
        pg.mouse.move(196, 420)
        for _ in range(4):
            pg.mouse.wheel(0, -300)
            pg.wait_for_timeout(60)
        pg.wait_for_timeout(500)

        # 1. open an entry (the latch trigger), then close it
        opened = pg.evaluate(r"""() => {
          const st = document.querySelector('[data-layer="schedule"]').getBoundingClientRect();
          const b = [...document.querySelectorAll('button[data-entry]')]
            .find(b => { const r = b.getBoundingClientRect();
                         return r.top > st.top + 60 && r.bottom < st.bottom - 60 && r.height > 0; });
          if (!b) return false;
          b.click(); return true;
        }""")
        if not opened:
            errors.append("setup: no on-screen entry to open")
        pg.wait_for_timeout(1100)
        pg.evaluate("() => history.back()")
        pg.wait_for_timeout(1100)

        # 2. fling far up into history (wheel), settle
        pg.mouse.move(196, 420)
        for _ in range(24):
            pg.mouse.wheel(0, -400)
            pg.wait_for_timeout(40)
        pg.wait_for_timeout(900)  # observer + heal settle

        # 3. the viewport must be on warm, rendered sections; latch must be down
        out = pg.evaluate(r"""() => {
          const sc = document.querySelector('[data-book-scroller]');
          // sample the viewport at five heights: each point must land on a
          // rendered day section (or the today zone) — never on hidden paper
          const hits = [];
          for (const fy of [0.15, 0.35, 0.5, 0.65, 0.85]) {
            const el = document.elementFromPoint(196, 852 * fy);
            const sec = el?.closest?.('[data-day]');
            hits.push({
              sec: !!sec,
              warm: !!sec?.hasAttribute('data-warm'),
              cv: sec ? getComputedStyle(sec).contentVisibility : null,
              content: !!el?.closest?.('p, [data-entry], .book-margin-date'),
            });
          }
          return { hits, climbing: sc.hasAttribute('data-climbing'), st: sc.scrollTop };
        }""")

    hits = out["hits"]
    on_sec = [h for h in hits if h["sec"]]
    hidden = [h for h in on_sec if h["cv"] == "hidden"]
    with_content = [h for h in on_sec if h["content"]]
    print(f"  after entry open/close + fling: {len(on_sec)}/5 samples on day sections · "
          f"{len(with_content)} showing content · {len(hidden)} on hidden sections · "
          f"climb latch {'STUCK' if out['climbing'] else 'down'} (st={out['st']})")
    if len(on_sec) == 0:
        errors.append("no day sections under the viewport at all after the fling")
    if hidden:
        errors.append(f"{len(hidden)} viewport samples landed on content-visibility:hidden sections "
                      f"— the reader is looking at blank paper")
    if out["climbing"]:
        errors.append("climb latch stuck after an entry open/close — the observer is stood down for good")

    for e in errors:
        print("  ✗", e)
    print("\n", "WINDOW STAYS LIVE ✓" if not errors else "WINDOW WENT DARK ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
