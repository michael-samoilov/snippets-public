"""
Verify the gap ABOVE the today zone at the book's foot (scrolled to the bottom).

When today already holds an entry, a card sits above the zone with a 20px gap.
Scrolled to the very bottom the zone is full-viewport-tall, so that card + gap
ride up under the sticky header terminus — and the terminus can clip the gap so
it reads smaller than 20px. This harness reproduces that exact resting state
(seeds a today card, scrolls the book to its foot) and measures the VISIBLE gap
between the header terminus rule and the zone's top edge — which is what the eye
actually sees there.

Runs in an isolated Playwright context (its own ephemeral IndexedDB); the seed
never touches real data, and the date is read from the clock so it won't stale.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-zone-foot-gap.py

Writes a screenshot of the foot to /tmp/zone-foot-gap.png. Exit 0 when the
visible gap is within 1.5px of the 20px gutter.
"""

import sys

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/calendar"
TARGET = 20.0
TOL = 1.5

SEED = r"""() => new Promise((res, rej) => {
  const dk = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const now = new Date(); now.setHours(9, 0, 0, 0);
  const rq = indexedDB.open("snippets");
  rq.onsuccess = () => { const db = rq.result;
    try {
      const tx = db.transaction("snippets", "readwrite");
      tx.objectStore("snippets").put({ id: "zonefootcard000000000000001", text: "A short entry kept earlier today.",
        kind: null, tags: [], capturedAt: now.getTime(), day: dk(now), source: "typed",
        favorite: 0, enriched: "manual", updatedAt: now.getTime() });
      tx.oncomplete = () => { db.close(); res("ok"); };
      tx.onerror = () => rej("tx");
    } catch (e) { rej("" + e); }
  };
  rq.onerror = () => rej("open");
})"""

MEASURE = r"""() => {
  const q = s => document.querySelector(s);
  const r = el => el ? (b => ({ top:+b.top.toFixed(1), bottom:+b.bottom.toFixed(1) }))(el.getBoundingClientRect()) : null;
  const zone = r(q('[data-today-zone-box]'));
  const term = r(q('.sheet .grid.border-b.border-rule-faint') || q('.sheet .border-b.border-rule-faint'));
  const card = r(q('[data-entry="zonefootcard000000000000001"]'));
  if (!zone || !term) return { error: "zone or terminus not found" };
  return {
    visible_gap_terminus_to_zone: +(zone.top - term.bottom).toFixed(1),
    card_clipped: card ? card.bottom <= term.bottom : null,   // true = card hidden under the header
  };
}"""


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=3)
        pg = ctx.new_page()
        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_timeout(1400)
        pg.evaluate(SEED)
        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_timeout(1800)
        # rest at the very foot of the book
        pg.evaluate("() => { const s = document.querySelector('[data-book-scroller]'); if (s) s.scrollTop = s.scrollHeight; }")
        pg.wait_for_timeout(900)
        gaps = pg.evaluate(MEASURE)
        pg.screenshot(path="/tmp/zone-foot-gap.png", clip={"x": 0, "y": 0, "width": 393, "height": 240})
        ctx.close()
        browser.close()

    if "error" in gaps:
        print("FAILED:", gaps["error"])
        return 2
    v = gaps["visible_gap_terminus_to_zone"]
    ok = abs(v - TARGET) <= TOL
    print(f"  visible gap (terminus → zone top) = {v}px   target {TARGET} ± {TOL}   {'ok' if ok else 'OFF'}")
    print(f"  card clipped under header         = {gaps['card_clipped']}")
    print("\n", "FOOT GAP CORRECT ✓" if ok else "FOOT GAP TOO SMALL ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
