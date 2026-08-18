"""A backfill keep files the entry and leaves the invite composer closed.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 -- \
      python3 tests/e2e/backfill_keep.py

scripts/measure-keep-durability.py drives the TODAY seal only, so the inline
"Add a story from yesterday" composer had no coverage at all. This covers it,
which matters because that composer decides whether to reopen after a keep from
a "the card has been born" latch that the keep sequence reports at its carding
beat.
"""
import os
import sys
from playwright.sync_api import sync_playwright
BASE = os.environ.get("BASE_URL", "http://127.0.0.1:3000")
CANARY = "BACKFILL-KEEP-CANARY"
ok = True
def check(l, c):
    global ok; print(("PASS  " if c else "FAIL  ") + l); ok = ok and c

FIND = """() => {
  const t = [...document.querySelectorAll('textarea')].find(
    x => x.offsetParent && /Add a story|Add something from today/.test(x.placeholder || ''));
  if (!t) return null;
  t.scrollIntoView({block:'center'});
  return t.placeholder;
}"""
TYPE = """(text) => {
  const t = [...document.querySelectorAll('textarea')].find(
    x => x.offsetParent && /Add a story|Add something from today/.test(x.placeholder || ''));
  if (!t) return false;
  t.focus();
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
  set.call(t, text); t.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}"""
STORED = """(c) => new Promise(r => {
  const q = indexedDB.open('snippets');
  q.onsuccess = () => { const db=q.result;
    const g = db.transaction('snippets','readonly').objectStore('snippets').getAll();
    g.onsuccess = () => r(g.result.some(x => (x.text||'').includes(c))); };
})"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 393, "height": 852})
    pg.goto(f"{BASE}/calendar?seed=40&years=1", wait_until="load")
    pg.wait_for_timeout(6000)

    ph = pg.evaluate(FIND)
    check(f"an inline backfill composer is on screen ({ph!r})", ph is not None)
    if ph is None:
        b.close(); sys.exit(1)
    pg.wait_for_timeout(300)
    check("typed into it", pg.evaluate(TYPE, CANARY))
    pg.wait_for_timeout(600)

    seal = pg.query_selector('[aria-label="Keep this"]')
    check("the keep stamp appears once there are words", seal is not None)
    if seal is None:
        b.close(); sys.exit(1)
    seal.click()
    pg.wait_for_timeout(4500)   # past the full press -> card -> compose sequence

    check("the entry is stored", pg.evaluate(STORED, CANARY))
    check("the kept words are on the page", CANARY in pg.inner_text("body"))
    still_typed = pg.evaluate(
        "(c) => [...document.querySelectorAll('textarea')].some(t => (t.value||'').includes(c))", CANARY)
    check("the composer is not still holding the words", not still_typed)
    pg.screenshot(path="/tmp/backfill-keep.png")
    pg.close()

    # ── a failed write restores the words (craft law 8) ──────────────────
    # "no keep ever fails silently — a failed write un-stamps, restores the
    # words, and says why." The inline invite composer used to latch "the
    # card is born" before checking the abort, so a write that failed by the
    # carding beat left the composer dark with the restored words stranded
    # in a component that rendered nothing: a lone seal under an empty day.
    FAIL_CANARY = "FAILED-KEEP-CANARY"
    pg = b.new_page(viewport={"width": 393, "height": 852})
    pg.add_init_script("""
      const realAdd = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name === "snippets" && window.__failWrites) {
          throw new DOMException("harness: disk full", "QuotaExceededError");
        }
        return realAdd.apply(this, args);
      };
    """)
    pg.goto(f"{BASE}/calendar?seed=40&years=1", wait_until="load")
    pg.wait_for_timeout(6000)
    ph = pg.evaluate(FIND)
    check(f"failure leg: an invite composer is on screen ({ph!r})", ph is not None)
    if ph is not None:
        pg.wait_for_timeout(300)
        check("failure leg: typed into it", pg.evaluate(TYPE, FAIL_CANARY))
        pg.wait_for_timeout(600)
        pg.evaluate("() => { window.__failWrites = true; }")
        seal = pg.query_selector('[aria-label="Keep this"]')
        check("failure leg: the keep stamp is armed", seal is not None)
        if seal is not None:
            seal.click()
            pg.wait_for_timeout(6000)  # past the whole press-card-compose arc
            check("failure leg: the entry is NOT stored",
                  not pg.evaluate(STORED, FAIL_CANARY))
            visible_words = pg.evaluate(
                """(c) => [...document.querySelectorAll('textarea')].some(
                     t => t.offsetParent && (t.value || '').includes(c))""",
                FAIL_CANARY)
            check("failure leg: the composer returns with the words in it",
                  visible_words)
    pg.screenshot(path="/tmp/backfill-keep-failed.png")
    b.close()
sys.exit(0 if ok else 1)
