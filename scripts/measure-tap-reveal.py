"""
Guard against the iOS DEAD-FIRST-TAP trap (device recording 2026-07-16): if an
input handler reveals hidden content at the touch point — e.g. flipping an
altitude layer from visibility:hidden to visible inside pointerdown, as the
pre-raster staging first did — WebKit's ContentChangeObserver decides the tap
was a hover that opened a menu and SUPPRESSES the synthesized click. The first
tap then does nothing; the second works only because the layer is already
visible (nothing left to observe). Headless Chromium has no such heuristic, so
the move harnesses stayed green while every first tap on device was dead.

This harness pins the LAW rather than the symptom (which headless cannot
reproduce): dispatch a bare pointerdown on the dive and rise triggers and
assert SYNCHRONOUSLY — before any rAF can run — that every resting-hidden
layer still computes visibility:hidden. Then it confirms the staging isn't
simply gone (the incoming layer must be pre-rastering, i.e. visible, a couple
frames into the dwell) and that a full tap still runs the move.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-tap-reveal.py

FAILS on any synchronous hidden->visible flip inside the input event.
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))

# dispatch pointerdown on a target, then read layer visibilities in the SAME
# synchronous task (no rAF, no timeout has run yet — exactly what WebKit's
# observer sees during the handler)
POINTERDOWN_SYNC = r"""(sel) => {
  const el = document.querySelector(sel);
  if (!el) return { error: 'no target ' + sel };
  const vis = () => Object.fromEntries(
    [...document.querySelectorAll('[data-layer]')].map(l =>
      [l.dataset.layer, getComputedStyle(l).visibility]));
  const before = vis();
  el.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
    isPrimary: true,
  }));
  return { before, after: vis() };
}"""

LAYER_VIS = r"""(name) => {
  const l = document.querySelector(`[data-layer="${name}"]`);
  return l ? getComputedStyle(l).visibility : 'missing';
}"""


def check_sync(tag, out, errors):
    if "error" in out:
        errors.append(f"{tag}: {out['error']}")
        return
    for layer, v in out["before"].items():
        if v == "hidden" and out["after"].get(layer) != "hidden":
            errors.append(
                f"{tag}: layer '{layer}' flipped {v} -> {out['after'].get(layer)} "
                f"SYNCHRONOUSLY inside pointerdown — iOS will suppress the click "
                f"(dead first tap)")
    print(f"  {tag}: layers under pointerdown "
          + ", ".join(f"{k}={v}" for k, v in out["after"].items()))


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852},
                                  device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5000)

        # ---- RISE: pointerdown on the title. The app BOOTS on schedule
        # view (today's page), so this leg runs first from rest state ------
        out = pg.evaluate(POINTERDOWN_SYNC, "[data-cal-title]")
        check_sync("rise pointerdown", out, errors)
        pg.wait_for_timeout(120)
        v = pg.evaluate(LAYER_VIS, "month")
        print(f"  rise dwell+120ms: month layer = {v}")
        if v != "visible":
            errors.append(f"rise: month layer '{v}' 120ms into the dwell — "
                          "pre-raster staging is gone (raster lands on the move again)")
        pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
        pg.wait_for_timeout(1500)
        v = pg.evaluate(LAYER_VIS, "month")
        if v != "visible":
            errors.append(f"rise: tap did not land on month (layer {v})")
            print("  rise: tap FAILED to land on month ✗")
        else:
            print("  rise: full tap landed on month ✓")

        # ---- DIVE: pointerdown on a visible month cell -------------------
        pg.wait_for_timeout(800)
        day = pg.evaluate(r"""() => {
          const st = document.querySelector('[data-layer="month"]').getBoundingClientRect();
          const cells = [...document.querySelectorAll(
              '[data-layer="month"] button[data-day-key]:not([disabled])')]
            .map(b => ({ b, r: b.getBoundingClientRect() }))
            .filter(x => x.r.top > st.top + 80 && x.r.bottom < st.bottom - 80 && x.r.height > 0);
          return cells[Math.floor(cells.length / 2)]?.b.getAttribute('data-day-key');
        }""")
        if not day:
            errors.append("dive: no visible cell")
        else:
            sel = f'[data-layer="month"] button[data-day-key="{day}"]'
            out = pg.evaluate(POINTERDOWN_SYNC, sel)
            check_sync("dive pointerdown", out, errors)
            # the staging must still pre-raster: a couple frames into the
            # dwell the schedule layer should be painting (inline visible)
            pg.wait_for_timeout(120)
            v = pg.evaluate(LAYER_VIS, "schedule")
            print(f"  dive dwell+120ms: schedule layer = {v}")
            if v != "visible":
                errors.append(f"dive: schedule layer '{v}' 120ms into the dwell — "
                              "pre-raster staging is gone (raster lands on the move again)")
            # the full tap must still dive
            pg.evaluate(f"() => document.querySelector('{sel}').click()")
            pg.wait_for_timeout(1500)
            v = pg.evaluate(LAYER_VIS, "schedule")
            if v != "visible":
                errors.append(f"dive: tap did not land on schedule (layer {v})")
            else:
                print("  dive: full tap landed on schedule ✓")

        browser.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "TAPS SAFE ✓" if not errors else "TAPS AT RISK ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
