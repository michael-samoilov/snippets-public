"""
Guard the ENTRY-CLOSE morph against the vanished-book regression (device
recording 2026-07-16): pressing back from an entry card, every OTHER card in
the schedule must stay visible while the card shrinks home. The late-join
dive machinery hid the incoming layer through setup — and `zoom.to ===
"schedule"` also matched entry->schedule closes, which take the morph branch
and never reach joinIncoming: the whole book vanished until finish().

Opens an entry, presses back, and samples the SCHEDULE LAYER's computed
visibility plus a neighbouring card's visibility EVERY FRAME through the
close. FAILS if any mid-close frame has the layer or the sampled card hidden.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-entry-close.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))

TRACK = r"""() => new Promise(res => {
  const layer = document.querySelector('[data-layer="schedule"]');
  // a card OTHER than the one that was opened (the opened one is hidden by
  // the morph's stand-in choreography, legitimately)
  const cards = [...document.querySelectorAll('[data-layer="schedule"] [data-entry]')];
  const opened = document.querySelector('[data-entry-card-content]');
  history.back();
  let n = 0; const bad = [];
  const loop = () => {
    n++;
    const lv = getComputedStyle(layer).visibility;
    let cardHidden = 0, cardSeen = 0;
    for (const c of cards.slice(0, 8)) {
      const v = getComputedStyle(c).visibility;
      if (v === 'hidden') cardHidden++; else cardSeen++;
    }
    // mid-close the layer must be visible and MOST neighbour cards shown
    // (one may be the morph's own hidden tile)
    if (n > 2 && n < 40 && (lv === 'hidden' || cardSeen < Math.max(1, cardHidden)))
      bad.push({ n, lv, cardSeen, cardHidden });
    if (n < 55) requestAnimationFrame(loop);
    else res({ bad, frames: n });
  };
  requestAnimationFrame(loop);
})"""


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852},
                                  device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(f"{BASE}?seed={SEED}", wait_until="load"); pg.wait_for_timeout(4500)
        pg.goto(BASE, wait_until="load"); pg.wait_for_timeout(5000)
        # open an entry (a visible card in the schedule)
        opened = pg.evaluate(r"""() => {
          const cs = [...document.querySelectorAll('[data-layer="schedule"] button[data-entry]')]
            .map(b => ({ b, r: b.getBoundingClientRect() }))
            .filter(x => x.r.height > 0 && x.r.bottom > 0 && x.r.top < 852);
          const pick = cs[Math.floor(cs.length / 2)];
          if (!pick) return null;
          pick.b.click();
          return pick.b.getAttribute('data-entry');
        }""")
        if not opened:
            errors.append("no visible card to open")
        else:
            pg.wait_for_timeout(1500)
            out = pg.evaluate(TRACK)
            pg.wait_for_timeout(800)
            if out["bad"]:
                b = out["bad"][0]
                errors.append(
                    f"mid-close blank book: frame {b['n']} layer={b['lv']} "
                    f"cards seen={b['cardSeen']} hidden={b['cardHidden']} "
                    f"(sampled {len(out['bad'])} bad frames of {out['frames']})")
            else:
                print(f"  close tracked {out['frames']} frames — book stayed visible ✓")
            # and the close must actually land back on the schedule
            v = pg.evaluate("() => getComputedStyle(document.querySelector('[data-layer=\"schedule\"]')).visibility")
            if v != "visible":
                errors.append(f"close did not land on schedule (layer {v})")
        browser.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "BOOK HOLDS THROUGH CLOSE ✓" if not errors else "BOOK VANISHES ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
