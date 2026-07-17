"""
Guard the calendar⇄schedule shared-date flights and the margin dates' sticky
truth across the move.

What broke before (all measured): month⇄schedule zooms freeze the margin dates
(data-dive-freeze → position:static) so the whole book scales as a rigid block —
but the ONE date whose section straddles the scroll top rests PINNED (sticky).
Measured in the frozen coordinate system, flyers launched from / landed at its
section top instead of its pinned slot (numbers "stuck in place" or "overlaid
in transit"), the collect() y-filter could drop it outright, and the date itself
popped into its pinned slot only when the freeze lifted (the "topmost date lags"
report). The fix pins that one cell through the move with inline
position:sticky and batches all flight measurements before any style write.

This harness asserts, on a deep seeded book:
  ASCENT  (schedule→month): the anchor day's flyer LAUNCHES from the pinned
          date's on-screen slot (not its section top), ±TOL px.
  DESCENT (month→schedule, tapping a VISIBLE cell like a real reader): each
          flyer LANDS exactly where its real date is revealed (±TOL px), no
          [data-fly] leftovers, no cells left visibility:hidden.
  NO POP: for ~20 frames after the descent settles, no visible margin date
          moves frame-to-frame by more than JITTER px (the restick is a no-op).

Probe hygiene: rects are read only from on-screen/band cells — reading into a
content-visibility-skipped section forces its subtree to lay out and the probe
itself becomes the stall it is hunting.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-flight-fidelity.py

Exit 0 when every assertion passes.
"""

import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEED = int(os.environ.get("SNIPPETS_SEED", "1200"))  # scale runs: SNIPPETS_SEED=2400
TOL = 3  # px a flyer may miss its true slot by
JITTER = 2  # px a settled date may move frame-to-frame after the finish

# watch [data-fly] points for their first and last transforms
WATCH_FLYERS = r"""() => {
  window.__flys = {};
  window.__flysDone = false;
  const seen = window.__flys;
  const scan = () => {
    for (const p of document.querySelectorAll('[data-fly]')) {
      // COMPUTED, not inline: the compositor (WAAPI) driver never writes
      // inline transforms — reading style.transform reported every flyer
      // parked at its creation pose (the same trap flight-travel fixed).
      // matrix(a,b,c,d,tx,ty) -> tx,ty
      const cm = (getComputedStyle(p).transform || '').match(/matrix\(([^)]+)\)/);
      const m = cm ? [0, ...cm[1].split(',').slice(4).map(v => v.trim())] : null;
      if (!m) continue;
      const day = p.dataset.fly;
      const cur = { x: +m[1], y: +m[2] };
      if (!seen[day]) seen[day] = { first: cur, last: cur, far: 0 };
      else {
        // LANDING = the FARTHEST sample from the launch, not the final one:
        // finish() cancels the fill-forwards animations, and for the frame
        // between cancel and the flyer box's removal the computed transform
        // REVERTS to the creation pose — a last-sample read said every flyer
        // "landed" back at its origin (easeOut => farthest IS the landing).
        const d = Math.hypot(cur.x - seen[day].first.x, cur.y - seen[day].first.y);
        if (d >= seen[day].far) { seen[day].far = d; seen[day].last = cur; }
      }
    }
    if (document.querySelector('[data-fly]') || !window.__flysDone)
      requestAnimationFrame(scan);
  };
  requestAnimationFrame(scan);
}"""

# stage-space center of a day's schedule flydate TEXT (Range rect, like the app)
CELL_CENTER = r"""(day) => {
  const el = document.querySelector(
    '[data-layer="schedule"] [data-flydate="' + CSS.escape(day) + '"]');
  if (!el) return null;
  const stage = document.querySelector('[data-layer="schedule"]').parentElement;
  const s = stage.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(el);
  let r = range.getBoundingClientRect();
  if (!(r.width > 0)) r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2 - s.left, y: r.top + r.height / 2 - s.top,
           vis: getComputedStyle(el).visibility };
}"""


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

        # ── ASCENT ────────────────────────────────────────────────────────
        # landing on today parks the viewport on the (dateless) today zone —
        # scroll up into the book LIKE A READER (wheel events set the takeover
        # guard; a bare scrollTop write gets yanked back by the today-landing
        # hold), landing mid-section so the topmost date is genuinely PINNED
        # (the case that used to break)
        pg.mouse.move(196, 420)
        for _ in range(6):
            pg.mouse.wheel(0, -503)
            pg.wait_for_timeout(120)
        pg.wait_for_timeout(800)  # let cv:auto render the new band
        # ENGINEER the failing geometry: park the scroll a fixed 63px INSIDE the
        # topmost roomy section, so its margin date rests PINNED 63px below its
        # section top. The un-fixed code measured the flyer against the frozen
        # (section-top) spot — a guaranteed 63px launch error this asserts away.
        # (Wheel deltas keep the takeover guard honest; a bare scrollTop write
        # is yanked by the landing hold.)
        nudge = pg.evaluate(r"""() => {
          const sc = document.querySelector('[data-book-scroller]');
          const st = sc.scrollTop, vh = sc.clientHeight;
          let target = null;
          for (const sec of sc.querySelectorAll('[data-day]')) {
            const top = sec.offsetTop, h = sec.offsetHeight;
            // a section starting just below the viewport top with room to pin
            if (top > st + 8 && top < st + vh / 2 && h > 140) { target = top; break; }
          }
          return target === null ? null : Math.round(target + 63 - st);
        }""")
        if nudge:
            pg.mouse.wheel(0, nudge)
            pg.wait_for_timeout(400)
        # record every visible date's TRUE position (only reading INTO sections
        # whose own box — a cheap read — is already on screen); whichever day
        # the app chooses as anchor, its flyer must depart from here
        pre = pg.evaluate(r"""() => {
          const stage = document.querySelector('[data-layer="schedule"]').parentElement;
          const s = stage.getBoundingClientRect();
          const out = {};
          for (const sec of document.querySelectorAll('[data-layer="schedule"] [data-day]')) {
            const sr = sec.getBoundingClientRect();
            if (sr.height === 0 || sr.bottom < s.top || sr.top > s.bottom) continue;
            const el = sec.querySelector('[data-flydate]');
            if (!el) continue;
            const range = document.createRange();
            range.selectNodeContents(el);
            let r = range.getBoundingClientRect();
            if (!(r.width > 0)) r = el.getBoundingClientRect();
            if (r.height === 0 || r.bottom < s.top || r.top > s.bottom) continue;
            out[el.dataset.flydate] = { x: r.left + r.width / 2 - s.left,
                                        y: r.top + r.height / 2 - s.top };
          }
          return out;
        }""")
        if not pre:
            errors.append("ascent: no visible schedule flydates found")
        else:
            pg.evaluate(WATCH_FLYERS)
            pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
            pg.wait_for_timeout(1500)
            pg.evaluate("() => { window.__flysDone = true; }")
            flys = pg.evaluate("() => window.__flys")
            if not flys:
                errors.append("ascent: no flyer launched at all (the anchor date was on screen)")
            for d, f in flys.items():
                if d not in pre:
                    errors.append(f"ascent: flyer {d} launched but that date was never visible pre-climb")
                    continue
                dx = abs(f["first"]["x"] - pre[d]["x"])
                dy = abs(f["first"]["y"] - pre[d]["y"])
                if dx > TOL or dy > TOL:
                    errors.append(
                        f"ascent: flyer {d} launched from ({f['first']['x']:.0f},{f['first']['y']:.0f}) but the "
                        f"date rested at ({pre[d]['x']:.0f},{pre[d]['y']:.0f}) — off by ({dx:.0f},{dy:.0f})px")
            left = pg.evaluate("() => document.querySelectorAll('[data-fly]').length")
            if left:
                errors.append(f"ascent: {left} [data-fly] leftovers after settle")

        # ── DESCENTS (tap a VISIBLE cell, like a real reader) ─────────────
        # near = the month we just left; far = ~3 months back (the flow whose
        # landing used to shift and pop). Both must land faithfully.
        def descend(tag: str, months_back: int) -> None:
            if months_back:
                got = pg.evaluate(r"""(n) => {
                  const m = document.querySelector('[data-layer="month"]');
                  const sc = [...m.querySelectorAll('*')].find(
                    e => e.scrollHeight > e.clientHeight + 100);
                  if (!sc) return false;
                  sc.scrollTop -= sc.clientHeight * n;
                  return true;
                }""", months_back)
                if not got:
                    errors.append(f"descent[{tag}]: month feed scroller not found")
                    return
                pg.wait_for_timeout(900)
            pg.evaluate(WATCH_FLYERS)
            day = pg.evaluate(r"""() => {
              const st = document.querySelector('[data-layer="month"]').getBoundingClientRect();
              // enabled cells only — future days are disabled and swallow the click
              const cells = [...document.querySelectorAll(
                  '[data-layer="month"] button[data-day-key]:not([disabled])')]
                .map(b => ({ b, r: b.getBoundingClientRect() }))
                .filter(x => x.r.top > st.top + 80 && x.r.bottom < st.bottom - 80 && x.r.height > 0);
              const pick = cells[Math.floor(cells.length / 2)];
              if (!pick) return null;
              pick.b.click();
              return pick.b.getAttribute('data-day-key');
            }""")
            if not day:
                errors.append(f"descent[{tag}]: no visible month cell to tap")
                return
            pg.wait_for_timeout(1500)
            pg.evaluate("() => { window.__flysDone = true; }")
            flys = pg.evaluate("() => window.__flys")
            if not flys:
                errors.append(f"descent[{tag}]: no flyers launched at all (dates overlap between views)")
            for d, f in flys.items():
                cell = pg.evaluate(CELL_CENTER, d)
                if not cell:
                    errors.append(f"descent[{tag}]: flew {d} but its schedule date is missing after settle")
                    continue
                if cell["vis"] == "hidden":
                    errors.append(f"descent[{tag}]: {d}'s real date left visibility:hidden after settle")
                    continue
                dx = abs(f["last"]["x"] - cell["x"])
                dy = abs(f["last"]["y"] - cell["y"])
                if dx > TOL or dy > TOL:
                    errors.append(
                        f"descent[{tag}]: flyer {d} landed at ({f['last']['x']:.0f},{f['last']['y']:.0f}) but the "
                        f"date rests at ({cell['x']:.0f},{cell['y']:.0f}) — off by ({dx:.0f},{dy:.0f})px")
            left = pg.evaluate("() => document.querySelectorAll('[data-fly]').length")
            if left:
                errors.append(f"descent[{tag}]: {left} [data-fly] leftovers after settle")
            hidden = pg.evaluate(r"""() => {
              let n = 0;
              for (const el of document.querySelectorAll(
                  '[data-layer="schedule"] [data-day] .book-margin-date')) {
                const sec = el.closest('[data-day]');
                const r = sec.getBoundingClientRect();
                if (r.height === 0 || r.bottom < 0 || r.top > 900) continue; // visible band only
                if (getComputedStyle(el).visibility === 'hidden') n++;
              }
              return n;
            }""")
            if hidden:
                errors.append(f"descent[{tag}]: {hidden} margin cells left hidden after settle")
            # NO POP: settled dates must not move after the finish
            moves = pg.evaluate(r"""() => new Promise(res => {
              const grab = () => {
                const out = new Map();
                for (const el of document.querySelectorAll(
                    '[data-layer="schedule"] [data-day] .book-margin-date')) {
                  const r = el.getBoundingClientRect();
                  if (r.height === 0 || r.bottom < 0 || r.top > 900) continue;
                  out.set(el.closest('[data-day]').dataset.day, r.top);
                }
                return out;
              };
              let prev = grab(), worst = 0, n = 0;
              const loop = () => {
                n++;
                const cur = grab();
                for (const [d, top] of cur)
                  if (prev.has(d)) worst = Math.max(worst, Math.abs(top - prev.get(d)));
                prev = cur;
                if (n < 20) requestAnimationFrame(loop); else res(worst);
              };
              requestAnimationFrame(loop);
            })""")
            if moves > JITTER:
                errors.append(
                    f"descent[{tag}]: a settled margin date moved {moves:.0f}px (> {JITTER}px) after the finish")

        descend("near", 0)
        # back up for the far leg
        pg.evaluate("() => document.querySelector('[data-cal-title]').click()")
        pg.wait_for_timeout(1500)
        descend("far", 3)

        ctx.close()
        browser.close()

    for e in errors:
        print("  ✗", e)
    if not errors:
        print(f"  ascent launch ±{TOL}px · descent landings ±{TOL}px · no leftovers · no hidden cells · post-settle movement ≤{JITTER}px")
    print("\n", "FLIGHTS FAITHFUL ✓" if not errors else "FLIGHTS BROKEN ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
