"""
Guard the KEEP PROMISE: an entry whose seal was pressed must reach IndexedDB
even if the reader leaves mid-choreography.

The regression this pins (found in the retroactive deep review): the keep flow
deferred the addSnippet write into the seal animation's carding/filling
setTimeout (~1.7-2s after the press), and those timers are cleared on unmount —
so navigating away (or closing the tab) inside that window silently lost the
entry. The fix arms the write in pendingWriteRef at submit: the beat consumes
it, and unmount/pagehide FLUSH it — it can no longer be cancelled.

Two legs, fresh browser context each:
  CONTROL — type, press the seal ("Keep today's entry"), wait out the full
            choreography, assert the entry is in IndexedDB. (Guards the probe
            itself: if this fails the probe is broken, not the app.)
  TEARDOWN — type, press the seal, navigate away at +250ms (mid-press, well
            before the old write beat), reopen, assert the entry is there.
            FAILS on the pre-fix build.

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-keep-durability.py
"""

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000/calendar"
SEAL = 'button[aria-label="Keep today\'s entry"]'

TYPE = r"""(t) => {
  const ta = [...document.querySelectorAll('[data-layer="schedule"] textarea')]
    .find(el => el.getBoundingClientRect().height > 0);
  if (!ta) return false;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(ta, t);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}"""

READ_DB = r"""(t) => new Promise(res => {
  const name = localStorage.getItem('snippets:dbName') ?? 'snippets';
  const req = indexedDB.open(name);
  req.onsuccess = () => {
    const db = req.result;
    try {
      const tx = db.transaction('snippets', 'readonly');
      const all = tx.objectStore('snippets').getAll();
      all.onsuccess = () =>
        res(all.result.some(r => r.text === t && !r.deletedAt));
      all.onerror = () => res('read-error');
    } catch (e) { res('tx-error: ' + e.message); }
  };
  req.onerror = () => res('open-error');
})"""


def run_leg(browser, tag: str, canary: str, teardown: bool, errors: list) -> None:
    ctx = browser.new_context(
        viewport={"width": 393, "height": 852}, device_scale_factor=2
    )
    pg = ctx.new_page()
    pg.goto(BASE, wait_until="load")
    pg.wait_for_timeout(4000)
    if not pg.evaluate(TYPE, canary):
        errors.append(f"{tag}: no visible composer textarea")
        ctx.close()
        return
    pg.wait_for_timeout(400)  # let React commit hasText → the seal becomes Keep
    seal = pg.query_selector(SEAL)
    if not seal:
        errors.append(f"{tag}: seal button ('Keep today's entry') not found")
        ctx.close()
        return
    seal.click()
    if not teardown:
        # the WRITE happens at submit now, but the CARD must not appear before
        # the choreography's filling beat (~2s in): the held live row stays off
        # stage. Probe the schedule DOM mid-press.
        pg.wait_for_timeout(600)
        early = pg.evaluate(
            r"""(t) => [...document.querySelectorAll('[data-layer="schedule"] li')]
              .some(li => li.textContent.includes(t) &&
                          li.getBoundingClientRect().height > 0)""",
            canary,
        )
        if early:
            errors.append(
                f"{tag}: the kept card appeared at +600ms — before the seal's "
                f"filling beat (the hold failed; write-at-submit leaked on stage)"
            )
    if teardown:
        pg.wait_for_timeout(250)  # mid-press; the old write beat was at ~2000ms
        pg.goto("about:blank")
        pg.wait_for_timeout(800)  # let the flushed IDB write settle
        pg.goto(BASE, wait_until="load")
        pg.wait_for_timeout(3000)
    else:
        pg.wait_for_timeout(4500)  # the whole choreography plays out
    found = pg.evaluate(READ_DB, canary)
    if found is not True:
        errors.append(f"{tag}: entry not in the book (probe result: {found})")
    ctx.close()


def main() -> int:
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        run_leg(browser, "control", "keep control canary", False, errors)
        run_leg(browser, "teardown", "keep durability canary", True, errors)
        browser.close()

    for e in errors:
        print("  ✗", e)
    if not errors:
        print("  control keep persists · teardown at +250ms still persists")
    print("\n", "KEEP IS DURABLE ✓" if not errors else "KEEP LOST THE ENTRY ✗")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
