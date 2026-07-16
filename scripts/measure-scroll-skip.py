"""
Guard the schedule book against the "skip me back" jump while flinging through
history (screen recording, 2026-07): as the reader scrolls UP into older days,
the view lurches backward.

Mechanism: `--cis` placeholders are stamped once, right after the book mounts —
BEFORE the display:swap webfonts settle. When a webfont swaps, every rendered
card grows, but each OFF-SCREEN section keeps its too-short placeholder. As the
reader flings up, those sections cross skipped→rendered and jump from the short
placeholder to their real (taller) height — shoving everything below them down.
The heal's scroll-anchor compensation is deliberately skipped during an active
fling (writing scrollTop kills iOS momentum), so nothing absorbs the shift: the
content the reader was on lurches down under them. `measure-scroll-stability.py`
misses it because headless fonts load before the measure, so placeholders are
already exact there.

This harness reproduces the stale-placeholder world the device hits: after the
book has measured + gone lazy, it injects a line-height bump (exactly a late
font swap's metric change — every rendered card grows ~+7px/line) WITHOUT
re-measuring, then flings UP through never-rendered history and tracks a fixed
rendered card's on-screen position each frame. With accurate placeholders the
card tracks the scroll smoothly; a skip shows as a frame where the card's screen
position moves against/beyond the scroll — content shoved by a section healing
above it.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-scroll-skip.py

FAILS on the stale-placeholder skip; passes once placeholders track the swap.
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))  # scale runs: SNIPPETS_SEED=2400
# a single frame's on-screen lurch (beyond the scroll itself) that reads as a
# skip. Real momentum frames move smoothly; a section healing above the viewport
# shoves content by a card's worth (tens of px) in one frame.
SKIP_TOL = 12

STALE = r"""() => {
  const st = document.createElement('style');
  st.id = '__stale';
  st.textContent = '.book-card-prose{line-height:1.62 !important}';
  document.head.appendChild(st);
}"""

# Fling UP; each frame, track scrollTop AND the on-screen top of a reference card
# (data-skip-ref, tagged mid-viewport at the start). The reference is expected to
# move DOWN on screen as we scroll up, by exactly the scrollTop delta; the
# residual (screen move − scroll move) is content shifting under the reader — a
# skip when a section above heals with no anchor.
TRACK = r"""() => new Promise(res => {
  const sc = document.querySelector('[data-book-scroller]');
  if (!sc) { res({ error: 'no scroller' }); return; }
  // a rendered card near mid-viewport to follow through the fling
  const cards = [...sc.querySelectorAll('[data-day] p')].filter(p => {
    const r = p.getBoundingClientRect();
    return r.top > 300 && r.bottom < 620 && r.height > 0;
  });
  const ref = cards[0];
  if (!ref) { res({ error: 'no reference card' }); return; }
  ref.setAttribute('data-skip-ref', '1');
  const frames = [];
  let n = 0, raf = 0;
  const sample = () => {
    frames.push({ st: sc.scrollTop, y: ref.getBoundingClientRect().top, sh: sc.scrollHeight });
  };
  const loop = () => { sample(); if (n < 90) { n++; raf = requestAnimationFrame(loop); } else res({ frames }); };
  sample();
  raf = requestAnimationFrame(loop);
  // drive an upward fling via synthetic wheel over ~1.2s
  let k = 0;
  const wheel = () => {
    if (k++ > 40) return;
    sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -260, bubbles: true }));
    sc.scrollTop -= 260; // jsdom/headless: wheel doesn't scroll; drive it
    setTimeout(wheel, 28);
  };
  wheel();
})"""


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
        # scroll up into history first so the reference sits among real days
        pg.mouse.move(196, 420)
        for _ in range(10):
            pg.mouse.wheel(0, -420)
            pg.wait_for_timeout(60)
        pg.wait_for_timeout(600)
        pg.evaluate(STALE)  # webfonts "swap" now — rendered cards grow, --cis stale
        pg.wait_for_timeout(300)
        # A width change reflows the cards — the fix re-measures every placeholder
        # against its real (now-taller) height on this signal (the same code path
        # the real fonts.ready trigger uses). On an unfixed build nothing
        # re-measures, so the stale placeholders — and the skip — remain.
        pg.set_viewport_size({"width": 392, "height": 852})
        pg.wait_for_timeout(700)  # let the idle re-measure run
        out = pg.evaluate(TRACK)
        ctx.close()
        browser.close()

    if "error" in out:
        print("  ✗ setup:", out["error"])
        print("\n", "SCROLL SKIP UNMEASURED ✗")
        return 1

    frames = out["frames"]
    worst = 0.0
    worst_t = -1
    for i, (a, b) in enumerate(zip(frames, frames[1:])):
        scroll_move = a["st"] - b["st"]        # scrollTop dropped by this (up-fling)
        screen_move = b["y"] - a["y"]          # ref moved down on screen by this
        residual = screen_move - scroll_move   # content shift not explained by the scroll
        if abs(residual) > abs(worst):
            worst = residual
            worst_t = i
    sh_growth = max(f["sh"] for f in frames) - min(f["sh"] for f in frames)
    ok = abs(worst) <= SKIP_TOL
    print(f"  worst single-frame content lurch (beyond the scroll): {worst:+.0f}px at frame {worst_t} "
          f"(budget ≤{SKIP_TOL}px)  ·  scrollHeight moved {sh_growth:.0f}px during the fling  {'ok' if ok else 'SKIP'}")
    if not ok:
        errors.append(f"content lurched {worst:+.0f}px in one frame under the reader — a section healed "
                      f"above the viewport with no scroll anchor (the skip-back)")

    for e in errors:
        print("  ✗", e)
    print("\n", "SCROLL DOESN'T SKIP ✓" if not errors else "SCROLL SKIPS ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
