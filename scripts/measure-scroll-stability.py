"""
Guard the schedule book against scroll jump/skip/rubberband.

The reported feel: scrolling the book sometimes jumps, skips, or rubberbands
back to where it was. Root cause found (and fixed): `--cis` placeholders were
stamped from offsetHeight (border box) while contain-intrinsic-size sizes the
CONTENT box — every skipped section sat exactly 1px too tall, so each section
rendering/skipping as the reader scrolled shifted all content above/below by
1px (no scroll anchoring on the scroller to absorb it: [overflow-anchor:none],
and iOS has no anchoring at all), and every zoom's content-visibility toggle
swung the whole book by ~1px × section count (~750px at 1200 entries).

This harness scrolls a deep seeded book like a reader and fails on:
  · any programmatic scrollTop write while the reader is mid-gesture
    (Element.prototype.scrollTo / scrollTop-setter are instrumented pre-load)
  · any frame where scrollTop moves OPPOSITE the gesture by > OPPOSITE_TOL px
  · total scrollHeight drift across the quiet stretches > DRIFT_TOL px
It also dives into an entry and back mid-run — the transitions are exactly
when the placeholder swings used to strike.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-scroll-stability.py

Exit 0 when the scroll is stable.
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))  # scale runs: SNIPPETS_SEED=2400
OPPOSITE_TOL = 4  # px of against-gesture movement that counts as a rubberband
DRIFT_TOL = 12  # px the book's total height may drift over the whole run

INSTRUMENT = r"""(() => {
  window.__writes = [];
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  Object.defineProperty(Element.prototype, 'scrollTop', {
    get() { return desc.get.call(this); },
    set(v) {
      if (this.hasAttribute && this.hasAttribute('data-book-scroller'))
        window.__writes.push({ t: performance.now(), v, via: 'setter',
                               stack: (new Error()).stack.split('\n')[2] || '' });
      return desc.set.call(this, v);
    },
    configurable: true,
  });
  for (const fn of ['scrollTo', 'scrollBy']) {
    const orig = Element.prototype[fn];
    Element.prototype[fn] = function (...args) {
      if (this.hasAttribute && this.hasAttribute('data-book-scroller'))
        window.__writes.push({ t: performance.now(), v: args[0]?.top ?? args[1],
                               via: fn, stack: (new Error()).stack.split('\n')[2] || '' });
      return orig.apply(this, args);
    };
  }
})()"""

# per-frame scroll trace with gesture bookkeeping done host-side
TRACE = r"""() => {
  window.__trace = [];
  const sc = document.querySelector('[data-book-scroller]');
  const loop = () => {
    window.__trace.push({ t: performance.now(), st: sc.scrollTop, sh: sc.scrollHeight });
    if (!window.__traceStop) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}"""


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.add_init_script(INSTRUMENT)
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load")
        pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load")
        pg.wait_for_timeout(5000)

        pg.evaluate(TRACE)
        pg.mouse.move(196, 420)
        gesture_windows: list[tuple[float, float, int]] = []  # (t0, t1, direction)

        def burst(steps: int, delta: int, pause_ms: int) -> None:
            t0 = pg.evaluate("() => performance.now()")
            for _ in range(steps):
                pg.mouse.wheel(0, delta)
                pg.wait_for_timeout(35)
            t1 = pg.evaluate("() => performance.now()")
            gesture_windows.append((t0, t1, 1 if delta > 0 else -1))
            pg.wait_for_timeout(pause_ms)

        # (i) slow upward bursts with pauses — placeholder swaps used to strike here
        for _ in range(8):
            burst(6, -230, 350)
        # (ii) fast continuous run upward
        burst(30, -400, 600)
        # (iii) direction change downward
        for _ in range(4):
            burst(6, 260, 300)
        # (iv) dive into an entry and back, then scroll IMMEDIATELY
        opened = pg.evaluate(r"""() => {
          const st = document.querySelector('[data-layer="schedule"]').getBoundingClientRect();
          const b = [...document.querySelectorAll('button[data-entry]')]
            .find(b => { const r = b.getBoundingClientRect();
                         return r.top > st.top + 60 && r.bottom < st.bottom - 60 && r.height > 0; });
          if (!b) return false;
          b.click();
          return true;
        }""")
        if opened:
            pg.wait_for_timeout(900)
            pg.evaluate("() => history.back()")
            pg.wait_for_timeout(250)  # scroll right as the rise settles
            for _ in range(4):
                burst(6, -260, 250)
        else:
            errors.append("setup: no on-screen entry tile to dive into")

        pg.evaluate("() => { window.__traceStop = true; }")
        trace = pg.evaluate("() => window.__trace || []")
        writes = pg.evaluate("() => window.__writes || []")
        if not pg.evaluate("() => Array.isArray(window.__writes)"):
            errors.append("setup: scroll-writer instrumentation missing (init script failed?)")
        ctx.close()
        browser.close()

    # a) programmatic writes during a gesture window
    for w in writes:
        for (t0, t1, _d) in gesture_windows:
            if t0 <= w["t"] <= t1:
                errors.append(
                    f"programmatic scroll write mid-gesture via {w['via']} at t={w['t']:.0f} ({w['stack'].strip()})")
                break

    # b) against-gesture movement (rubberband) — inside each gesture window the
    #    scroll must never move opposite the wheel direction beyond tolerance
    for (t0, t1, d) in gesture_windows:
        frames = [f for f in trace if t0 <= f["t"] <= t1 + 50]
        for a, b in zip(frames, frames[1:]):
            move = b["st"] - a["st"]
            if move * d < -OPPOSITE_TOL:
                errors.append(
                    f"rubberband: scroll moved {move:+.0f}px against the gesture (dir {d:+d}) at t={b['t']:.0f}")

    # c) book height stability across the run (transitions excluded is fine —
    #    the whole point is that the placeholder toggles no longer swing it)
    if trace:
        sh = [f["sh"] for f in trace]
        drift = max(sh) - min(sh)
        if drift > DRIFT_TOL:
            errors.append(f"scrollHeight drifted {drift:.0f}px over the run (> {DRIFT_TOL}px)")

    seen = set()
    for e in errors:
        if e in seen:
            continue
        seen.add(e)
        print("  ✗", e)
    if not errors:
        n = len(trace)
        print(f"  {n} frames traced · no mid-gesture writes · no against-gesture moves >{OPPOSITE_TOL}px · height drift ≤{DRIFT_TOL}px")
    print("\n", "SCROLL STABLE ✓" if not errors else "SCROLL UNSTABLE ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
