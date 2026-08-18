"""The render window stays a tight band around the reader.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 -- \
      python3 tests/e2e/warm_window.py

The book mounts a live card for the reader's whole history, so what keeps a
years-deep book off the iOS jetsam ceiling is that only a band of sections is
rendered (data-warm -> content-visibility:visible). Nothing guarded that band's
SIZE until this file: warmBand paints it at a few moments, the
IntersectionObserver maintains it while scrolling, and a row that kept its mark
without a ledger entry would stay rendered forever.

Written for the 2026-08 audit's claim that the per-row ref callback leaks such
rows on every write (rowRef(day) mints a fresh closure per render, so React
detaches the old ref and that path deletes from warmSetRef without clearing
data-warm). The mechanism is real in the source, but this harness could NOT
reproduce the predicted accumulation: with a cross-tab write confirmed to
re-render every row, and again with the write landing while warmBand's wider
+-1.5vh shell was still live, the band stayed within ~0.8 viewports and no row
was ever stranded. The observer's re-observe re-adds everything inside its
+-1.2vh margin, which appears to be what closes the gap.

So this is a standing guard, not a reproduction. If the band ever does start
accumulating, this fails.
"""
import os, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:3000")
SCROLLER = "[data-book-scroller]"

WARM = """() => {
  const vh = window.innerHeight;
  const rows = [...document.querySelectorAll('[data-day][data-warm]')];
  const dist = rows.map(r => {
    const b = r.getBoundingClientRect();
    if (b.bottom < 0) return -b.bottom / vh;
    if (b.top > vh) return (b.top - vh) / vh;
    return 0;
  });
  return { count: rows.length, far: dist.filter(d => d > 3).length,
           max: dist.length ? Math.max(...dist) : 0 };
}"""

TYPE = """(t) => {
  const a = [...document.querySelectorAll('textarea')].find(x => x.offsetParent);
  if (!a) return false;
  const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  s.call(a, t); a.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}"""

def scroll_to(pg, frac, settle=1400):
    pg.evaluate(f"(f) => {{ const el = document.querySelector('{SCROLLER}'); if (el) el.scrollTop = el.scrollHeight * f; }}", frac)
    pg.wait_for_timeout(settle)

failures = []
def check(label, cond):
    print(("PASS  " if cond else "FAIL  ") + label)
    if not cond:
        failures.append(label)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 393, "height": 852})
    a = ctx.new_page()
    a.goto(f"{BASE}/calendar?seed=500&years=2", wait_until="load")
    a.wait_for_timeout(6000)

    scroll_to(a, 0.30)
    settled = a.evaluate(WARM)
    print(f"  settled at 30%     count={settled['count']} far={settled['far']} max={settled['max']:.1f}vh")
    check("the book renders a warm band at rest", settled["count"] > 0)
    check(f"the band is tight at rest (max={settled['max']:.1f}vh)", settled["max"] <= 3)

    # a write from another tab: Dexie notifies this one and every row re-renders,
    # without disturbing this tab's scroll -- the background-sync-pull shape
    bt = ctx.new_page()
    bt.goto(f"{BASE}/calendar", wait_until="load")
    bt.wait_for_timeout(4000)
    wrote = bt.evaluate(TYPE, "warm-window canary")
    bt.wait_for_timeout(400)
    seal = bt.query_selector("[aria-label=\"Keep today's entry\"]")
    if not (wrote and seal):
        print(f"ABORT: could not drive a keep (textarea={wrote}, seal={seal is not None})")
        b.close(); sys.exit(2)
    seal.click(); bt.wait_for_timeout(3200); bt.close()
    a.wait_for_timeout(1500)

    # the canary is written to TODAY, which is far outside the band this tab
    # is scrolled to, so it is not in the rendered text -- read the store
    # instead. (tests/e2e/day_split.py-style DOM checks only work in-band.)
    landed = a.evaluate("""async () => {
      const db = await new Promise(r => { const q = indexedDB.open('snippets'); q.onsuccess = () => r(q.result); });
      return await new Promise(r => {
        const tx = db.transaction('snippets','readonly').objectStore('snippets').getAll();
        tx.onsuccess = () => r(tx.result.some(x => (x.text || '').includes('warm-window canary')));
      });
    }""")
    check("the write reached this tab's store", landed)

    scroll_to(a, 0.75)
    away = a.evaluate(WARM)
    print(f"  after write, at 75% count={away['count']} far={away['far']} max={away['max']:.1f}vh")
    check(f"no row is stranded warm (far={away['far']}, max={away['max']:.1f}vh)", away["far"] == 0)
    check(f"the band did not grow across the write "
          f"(settled={settled['count']} away={away['count']})",
          away["count"] <= settled["count"] + 4)
    b.close()

print("\nwarm window: " + ("held" if not failures else f"{len(failures)} FAILED"))
sys.exit(1 if failures else 0)
