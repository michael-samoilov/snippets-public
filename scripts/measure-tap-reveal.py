"""
Guard against the iOS DEAD-FIRST-TAP trap (device recordings 2026-07-16, two
rounds): if hidden content becomes visible at the touch point while a finger
is down, WebKit's content observation (the hover-menu heuristic) decides the
tap was a hover and SUPPRESSES the synthesized click. The first tap then does
nothing; the second works only because the content is already visible
(nothing left to observe).

The "pre-raster during the dwell" staging tripped this TWICE: round 1 flipped
an altitude layer visibility:hidden->visible synchronously inside pointerdown;
round 2 deferred the flip one rAF — still within the touch — and the device
verdict was identical. So the law this harness pins is the strict form:

    NOTHING that rests hidden may become visible between pointerdown and the
    move actually starting (i.e. through the tap's whole dwell).

Headless Chromium has no such heuristic — taps work here regardless — so this
harness asserts the LAW, not the symptom: dispatch a bare pointerdown on the
dive and rise triggers, hold the dwell with no pointerup, and require every
resting-hidden layer to still compute visibility:hidden both synchronously and
150ms into the dwell. Then a full tap must still run the move.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-tap-reveal.py

FAILS on any hidden->visible flip during the dwell (either round's regression).
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))
DWELL_MS = 150  # longer than a real tap's ~100ms pointerdown->click gap

# dispatch pointerdown on a target, then read layer visibilities in the SAME
# synchronous task (no rAF, no timeout has run yet)
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

ALL_VIS = r"""() => Object.fromEntries(
  [...document.querySelectorAll('[data-layer]')].map(l =>
    [l.dataset.layer, getComputedStyle(l).visibility]))"""

LAYER_VIS = r"""(name) => {
  const l = document.querySelector(`[data-layer="${name}"]`);
  return l ? getComputedStyle(l).visibility : 'missing';
}"""


def check_still_hidden(tag, before, now, errors):
    for layer, v in before.items():
        if v == "hidden" and now.get(layer) != "hidden":
            errors.append(
                f"{tag}: layer '{layer}' flipped {v} -> {now.get(layer)} while the "
                f"finger is down — iOS will suppress the click (dead first tap)")


def leg(pg, tag, trigger_sel, dest_layer, errors):
    out = pg.evaluate(POINTERDOWN_SYNC, trigger_sel)
    if "error" in out:
        errors.append(f"{tag}: {out['error']}")
        return
    check_still_hidden(f"{tag} pointerdown(sync)", out["before"], out["after"], errors)
    # hold the dwell — no pointerup yet — and re-check: a deferred reveal
    # (rAF, timer) is just as fatal on device as a synchronous one
    pg.wait_for_timeout(DWELL_MS)
    mid = pg.evaluate(ALL_VIS)
    check_still_hidden(f"{tag} dwell+{DWELL_MS}ms", out["before"], mid, errors)
    print(f"  {tag}: layers through the dwell "
          + ", ".join(f"{k}={v}" for k, v in mid.items()))
    # the full tap must still run the move
    pg.evaluate(f"() => document.querySelector('{trigger_sel}').click()")
    pg.wait_for_timeout(1500)
    v = pg.evaluate(LAYER_VIS, dest_layer)
    if v != "visible":
        errors.append(f"{tag}: tap did not land on {dest_layer} (layer {v})")
    else:
        print(f"  {tag}: full tap landed on {dest_layer} ✓")


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852},
                                  device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5000)

        # the app BOOTS on schedule view (today's page): rise leg first
        leg(pg, "rise", "[data-cal-title]", "month", errors)

        # now on month view: dive leg on a visible cell
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
            leg(pg, "dive", f'[data-layer="month"] button[data-day-key="{day}"]',
                "schedule", errors)

        browser.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "TAPS SAFE ✓" if not errors else "TAPS AT RISK ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
