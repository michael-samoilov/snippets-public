"""
Guard the FIRST entry-open per app refresh against the "full-length overshoot":
the card must morph straight to its natural size, not blow up to a full-stage
card first and then shrink to the right height.

Mechanism this catches: on a cold load focusedId is null, so EntryView is
pre-mounted with a PLACEHOLDER (null) snippet. openEntry measures that
placeholder card as the shared-element target box `c`, THEN setFocusedId swaps
in the real snippet — whose card is a different (usually shorter) height. The
first morph therefore targets the wrong box and the card visibly overshoots.
The SECOND open reuses the now-correctly-sized card, so it's clean — this
harness asserts the first open is as clean as the second.

For each of open #1 (cold) and open #2 (warm) it taps a SHORT entry and records
[data-entry-card]'s height every frame from tap to settle. It then compares the
peak in-flight height to the settled height: an overshoot is the card exceeding
its final height by more than TOL during the morph (the full-length flash).

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-first-open.py

FAILS on the cold-open overshoot (open #1 peak ≫ settle; open #2 clean).
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))  # scale runs: SNIPPETS_SEED=2400
TOL = 24  # px the in-flight card may exceed its settled height by (sub-card slack)

# Tap a SHORT visible entry (few lines) and trace [data-entry-card] height each
# frame. Short so "full-length" (full stage) is unmistakably taller than final.
TRACE = r"""() => new Promise(res => {
  const sst = document.querySelector('[data-layer="schedule"]').getBoundingClientRect();
  // shortest visible entry tile in the mid-viewport band
  const tiles = [...document.querySelectorAll('button[data-entry]')]
    .map(b => ({ b, r: b.getBoundingClientRect() }))
    .filter(x => x.r.top > sst.top + 80 && x.r.bottom < sst.bottom - 140 && x.r.height > 0)
    .sort((a, b) => a.r.height - b.r.height);
  const pick = tiles[0];
  if (!pick) { res({ error: 'no visible entry tile' }); return; }
  pick.b.click();
  const card = () => document.querySelector('[data-layer="entry"] [data-entry-card]');
  const h = () => { const c = card(); return c ? Math.round(c.getBoundingClientRect().height) : null; };
  const heights = [];
  let n = 0;
  const loop = () => {
    n++;
    const v = h();
    if (v !== null) heights.push(v);
    if (n < 55) requestAnimationFrame(loop);
    else res({ heights, id: pick.b.getAttribute('data-entry') });
  };
  requestAnimationFrame(loop);
})"""


def analyse(tag, out, errors, assertit):
    if "error" in out:
        errors.append(f"{tag}: {out['error']}")
        return
    hs = out["heights"]
    if len(hs) < 6:
        errors.append(f"{tag}: only {len(hs)} height samples")
        return
    # settled = the last few frames' height (the card at rest); peak = the tallest
    # the card ever got in flight. Overshoot = peak exceeds settle by > TOL.
    settle = max(hs[-5:])  # rest height (max of the tail, robust to a last-frame blip)
    peak = max(hs)
    over = peak - settle
    bad = over > TOL
    mark = "OVERSHOOT" if (bad and assertit) else ("overshoot" if bad else "ok")
    print(f"  {tag}: settle {settle}px · peak {peak}px · overshoot {over}px (≤{TOL})  {mark}")
    if assertit and bad:
        errors.append(f"{tag}: card overshot to {peak}px before settling at {settle}px "
                      f"(+{over}px > {TOL}px) — the full-length flash")


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
        # scroll up into the book so past-day entry tiles are on screen (the
        # today zone owns the top of a cold viewport). This mounts nothing and
        # doesn't touch focusedId, so the first TAP is still the cold open.
        pg.mouse.move(196, 420)
        for _ in range(6):
            pg.mouse.wheel(0, -503)
            pg.wait_for_timeout(120)
        pg.wait_for_timeout(800)

        # OPEN #1 — cold (placeholder card still the only thing EntryView rendered)
        out1 = pg.evaluate(TRACE)
        analyse("open #1 (cold)", out1, errors, assertit=True)
        pg.wait_for_timeout(700)
        pg.evaluate("() => history.back()")
        pg.wait_for_timeout(1200)

        # OPEN #2 — warm (card now sized from a real snippet); reference, not gated
        out2 = pg.evaluate(TRACE)
        analyse("open #2 (warm)", out2, errors, assertit=False)
        pg.wait_for_timeout(700)
        pg.evaluate("() => history.back()")
        pg.wait_for_timeout(1200)

        # OPEN #3 — warm MISMATCH: the card currently holds the SHORT entry from
        # #2, now open the TALLEST visible entry. If a warm open trusts a cached
        # card shorter than the new tile, osy>1 balloons it too. Gated: a warm
        # open must be as clean as a cold one.
        out3 = pg.evaluate(r"""() => new Promise(res => {
          const sst = document.querySelector('[data-layer="schedule"]').getBoundingClientRect();
          const tiles = [...document.querySelectorAll('button[data-entry]')]
            .map(b => ({ b, r: b.getBoundingClientRect() }))
            .filter(x => x.r.top > sst.top + 80 && x.r.bottom < sst.bottom - 140 && x.r.height > 0)
            .sort((a, b) => b.r.height - a.r.height);  // TALLEST first
          const pick = tiles[0];
          if (!pick) { res({ error: 'no visible entry tile' }); return; }
          pick.b.click();
          const card = () => document.querySelector('[data-layer="entry"] [data-entry-card]');
          const h = () => { const c = card(); return c ? Math.round(c.getBoundingClientRect().height) : null; };
          const heights = []; let n = 0;
          const loop = () => { n++; const v = h(); if (v !== null) heights.push(v);
            if (n < 55) requestAnimationFrame(loop); else res({ heights }); };
          requestAnimationFrame(loop);
        })""")
        analyse("open #3 (warm, short→tall)", out3, errors, assertit=True)
        pg.wait_for_timeout(700)
        pg.evaluate("() => history.back()")
        pg.wait_for_timeout(1200)

        # OPEN #4 — delete-then-open. Open an entry, "let it go" (soft-delete →
        # the card unmounts to the null-snippet stub while focusedId stays set),
        # then open a DIFFERENT entry. If the cold signal keyed on focusedId
        # (never reset) instead of the real mounted snippet, this open would
        # trust the stub box and balloon again. Gated.
        opened = pg.evaluate(r"""() => {
          const sst = document.querySelector('[data-layer="schedule"]').getBoundingClientRect();
          const t = [...document.querySelectorAll('button[data-entry]')]
            .map(b => ({ b, r: b.getBoundingClientRect() }))
            .find(x => x.r.top > sst.top + 80 && x.r.bottom < sst.bottom - 140 && x.r.height > 0);
          if (!t) return null;
          t.b.click();
          return t.b.getAttribute('data-entry');
        }""")
        if not opened:
            errors.append("open #4: no entry to delete")
        else:
            pg.wait_for_timeout(900)
            # "Let this entry go" — soft-deletes and closes back to the schedule
            pg.get_by_label("Let this entry go").click()
            pg.wait_for_timeout(1600)
            out4 = pg.evaluate(TRACE)  # opens a fresh visible short entry
            analyse("open #4 (after delete)", out4, errors, assertit=True)

        ctx.close()
        browser.close()

    for e in errors:
        print("  ✗", e)
    print("\n", "FIRST OPEN CLEAN ✓" if not errors else "FIRST OPEN OVERSHOOTS ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
