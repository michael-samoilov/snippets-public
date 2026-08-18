"""A day whose entries are not neighbours must keep all of them.

Run under the webapp-testing harness:

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 -- \
      python3 tests/e2e/day_split.py

Regression net for the 2026-08 audit finding. `day` is stamped in LOCAL time
when an entry is written, while the book is read in `capturedAt` order, so the
two orders disagree across UTC offsets and a day's rows need not be
neighbours. groupByDay used to walk runs, emitting a second group for the same
date; the caller keys groups by day, so the later group won and the earlier
entries left the book while countsByDay still drew their dots.

Against the run-length version exactly one check fails -- "the EARLIER 03-01
entry is on the page too" -- with the rest of the book rendering normally.
That silence is the whole point of the test.

Seeds the travelling-writer case: an entry written in Tokyo just after
midnight (day 2026-03-01, but an EARLIER capturedAt than the next one),
then one written after flying west (day 2026-02-28), then another on
2026-03-01. Read in capturedAt order the days run 03-01, 02-28, 03-01 --
the same day twice, with a gap.
"""
import os
import sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:3000")

SEED = """
async (rows) => {
  await new Promise((res, rej) => {
    const del = indexedDB.deleteDatabase('snippets');
    del.onsuccess = del.onerror = del.onblocked = () => res();
  });
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('snippets', 4);
    req.onupgradeneeded = (e) => {
      const d = req.result;
      if (!d.objectStoreNames.contains('snippets')) {
        const s = d.createObjectStore('snippets', { keyPath: 'id' });
        s.createIndex('day', 'day');
        s.createIndex('capturedAt', 'capturedAt');
        s.createIndex('kind', 'kind');
        s.createIndex('favorite', 'favorite');
        s.createIndex('tags', 'tags', { multiEntry: true });
        s.createIndex('_dirty', '_dirty');
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('snippets', 'readwrite');
    const store = tx.objectStore('snippets');
    for (const r of rows) store.put(r);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}
"""

def row(rid, text, day, captured):
    return {"id": rid, "text": text, "kind": None, "tags": [], "day": day,
            "capturedAt": captured, "source": "typed", "favorite": 0,
            "updatedAt": captured, "_dirty": 0}

# capturedAt strictly increasing; day order disagrees
ROWS = [
    row("01HQTOKYO0000000000000001", "TOKYO-JUST-AFTER-MIDNIGHT", "2026-03-01", 1772323800000),
    row("01HQLAXXX0000000000000002", "LOS-ANGELES-AFTER-FLYING",  "2026-02-28", 1772359800000),
    row("01HQLATER0000000000000003", "TOKYO-DAY-SECOND-ENTRY",    "2026-03-01", 1772409000000),
]

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.goto(f"{BASE}/calendar", wait_until="domcontentloaded")
    pg.evaluate(SEED, ROWS)
    pg.goto(f"{BASE}/calendar?d=2026-03-01", wait_until="domcontentloaded")
    pg.wait_for_timeout(3500)

    body = pg.inner_text("body")
    section = pg.evaluate("""() => {
      const el = document.querySelector('[data-day="2026-03-01"]');
      return el ? el.innerText : null;
    }""")

    ok = True
    def check(label, cond):
        global ok
        print(("PASS  " if cond else "FAIL  ") + label)
        ok = ok and cond

    check("the 2026-03-01 page exists", section is not None)
    check("the later 03-01 entry is on the page", bool(section and "TOKYO-DAY-SECOND-ENTRY" in section))
    check("the EARLIER 03-01 entry is on the page too", bool(section and "TOKYO-JUST-AFTER-MIDNIGHT" in section))
    check("the 02-28 entry is still in the book", "LOS-ANGELES-AFTER-FLYING" in body)
    check("no entry was dropped from the book entirely", all(
        t in body for t in ["TOKYO-JUST-AFTER-MIDNIGHT", "LOS-ANGELES-AFTER-FLYING", "TOKYO-DAY-SECOND-ENTRY"]))

    pg.screenshot(path="/tmp/day-split.png", full_page=False)
    b.close()
    sys.exit(0 if ok else 1)
