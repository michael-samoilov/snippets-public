"""
Guard the schedule margin date's "zero sticky travel" invariant.

The date in a day's margin is `position: sticky`; it holds its ground while the
day's entries scroll past. For that to read cleanly, a day with a SINGLE
one-line card must have its date block sized to EXACTLY that card's height — if
the block is even ~1px shorter than the row, the sticky date has that much
travel and visibly crawls as you scroll past the day.

The block's padding (py-[3.96px] on the date inner div in calendar/page.tsx) is
tuned to the book text size (1rem) and the card's box (1rem × 1.42 line +
p-2.5 padding + 1px hairline border). Change any of those without re-tuning the
padding and the crawl comes back. This harness pins the invariant: it seeds one
one-line day, measures the one-line card and the date block, and fails if they
differ by more than half a pixel. (Observed match at 1rem: ~0.02px.)

Runs in an isolated Playwright context (its own ephemeral IndexedDB), so it
seeds a throwaway entry without touching real data. Dates come from the
browser's clock, so it doesn't go stale.

Run against a production build:

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-sticky-date.py

Exit code is 0 when the date block matches the one-line card within 0.5px.
"""

import sys

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/calendar"
TOLERANCE_PX = 0.5

# one SHORT one-line entry three days back — an unopened past day shows no
# composer, so the row is exactly {date | one card}.
SEED = r"""() => new Promise((resolve, reject) => {
  const dk = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  const t = new Date(); t.setDate(t.getDate() - 3); t.setHours(11, 0, 0, 0);
  const rq = indexedDB.open('snippets');
  rq.onsuccess = () => { const db = rq.result;
    try {
      const tx = db.transaction('snippets', 'readwrite');
      tx.objectStore('snippets').put({ id: 'stickydateharness00000001', text: 'Hi.',
        kind: null, tags: [], capturedAt: t.getTime(), day: dk(t), source: 'typed',
        favorite: 0, enriched: 'manual', updatedAt: t.getTime() });
      tx.oncomplete = () => { db.close(); resolve(dk(t)); };
      tx.onerror = () => reject('tx:' + tx.error);
    } catch (e) { reject('ex:' + e); }
  };
  rq.onerror = () => reject('open:' + rq.error);
})"""

MEASURE = r"""(day) => {
  const sec = document.querySelector('[data-day="' + day + '"]');
  if (!sec) return { error: 'no section for ' + day };
  const card = sec.querySelector('button[data-entry]');
  const dateInner = sec.querySelector('.book-margin-date > div');
  if (!card) return { error: 'no one-line card' };
  if (!dateInner) return { error: 'no date block' };
  const h = el => +el.getBoundingClientRect().height.toFixed(2);
  return { cardH: h(card), dateH: h(dateInner),
           previewPx: getComputedStyle(card.querySelector('p')).fontSize };
}"""


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 1000})
        pg = ctx.new_page()
        pg.goto(URL, wait_until="networkidle")
        day = pg.evaluate(SEED)
        pg.reload(wait_until="networkidle")
        pg.wait_for_timeout(1400)
        # bring the seeded day into the warm render band so it lays out for real
        pg.evaluate(
            "(day) => { const el = document.querySelector('[data-day=\"' + day + '\"]');"
            " if (el) el.scrollIntoView({ block: 'center' }); }",
            day,
        )
        pg.wait_for_timeout(1000)
        r = pg.evaluate(MEASURE, day)
        ctx.close()
        browser.close()

    if "error" in r:
        print("FAILED:", r["error"])
        return 2

    delta = round(r["cardH"] - r["dateH"], 2)
    ok = abs(delta) <= TOLERANCE_PX
    print(f"  preview text    = {r['previewPx']}")
    print(f"  one-line card   = {r['cardH']}px")
    print(f"  date block      = {r['dateH']}px")
    print(f"  Δ (travel)      = {delta:+.2f}px   (tolerance ±{TOLERANCE_PX})")
    print("\n", "ZERO STICKY TRAVEL ✓" if ok else "STICKY CRAWL ✗ — re-tune the date padding")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
