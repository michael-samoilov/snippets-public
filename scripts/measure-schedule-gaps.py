"""
Measure the schedule/today-zone spacing gaps and check they're uniform.

The book (schedule) home should frame its content with ONE margin on every
side: the left/right gutter (GREEN), the header's distance from the sheet top
(RED1), the gap above the today zone (RED2), and the gap below it to the sheet
bottom (RED3) should all be equal.

Runs in an isolated Playwright context (its own ephemeral IndexedDB), so it
seeds a throwaway entry to exit the brand-new-book state without touching any
real data. Dates are computed from the browser's clock, so it doesn't go stale.

Run against a production build:

    python3 .claude/skills/webapp-testing/scripts/with_server.py \
      --server "node_modules/.bin/next start" --port 3000 \
      -- python3 scripts/measure-schedule-gaps.py

Exit code is 0 when every red gap is within 1px of the green gutter.
"""

import json
import sys

from playwright.sync_api import sync_playwright

URL = "http://localhost:3000/calendar"

# seed one entry two days back so the book leaves its "brand-new → zone alone"
# state and renders the normal yesterday row + today zone.
SEED = r"""() => new Promise((resolve, reject) => {
  const dk = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const t = new Date(); t.setDate(t.getDate() - 2); t.setHours(12,0,0,0);
  const rq = indexedDB.open("snippets");
  rq.onsuccess = () => { const db = rq.result;
    try {
      const tx = db.transaction("snippets", "readwrite");
      tx.objectStore("snippets").put({ id: "gapharness0000000000000001", text: "harness seed",
        kind: null, tags: [], capturedAt: t.getTime(), day: dk(t), source: "typed",
        favorite: 0, enriched: "manual", updatedAt: t.getTime() });
      tx.oncomplete = () => { db.close(); resolve("seeded"); };
      tx.onerror = () => reject("tx:" + tx.error);
    } catch (e) { reject("ex:" + e); }
  };
  rq.onerror = () => reject("open:" + rq.error);
})"""

MEASURE = r"""() => {
  const q = s => document.querySelector(s);
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect();
    return { top:+b.top.toFixed(1), bottom:+b.bottom.toFixed(1), left:+b.left.toFixed(1), right:+b.right.toFixed(1) }; };
  const dk = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const y = new Date(); y.setDate(y.getDate() - 1);

  const sheet = q('.sheet');                                       // the sheet of paper
  const card  = q('[data-today-zone-box]');                        // the today zone card
  const month = q('.sheet button.voice-display.pressable[aria-label]'); // the "July 2026" title
  const search= q('.sheet button[aria-expanded]');                 // the search glass
  const yest  = q(`[data-day="${dk(y)}"]`);                        // yesterday's row (above the zone)

  const sh=r(sheet), ca=r(card), mo=r(month), se=r(search), ye=r(yest);
  if (!sh || !ca) return { error: "sheet or today-zone card not found", found: {sheet:!!sheet, card:!!card} };
  const headTop = (mo && se) ? Math.min(mo.top, se.top) : (mo ? mo.top : (se ? se.top : null));
  return {
    GREEN_gutter_right:   +(sh.right - ca.right).toFixed(1),
    GREEN_gutter_left:    +(ca.left - sh.left).toFixed(1),
    RED1_header_top:      headTop != null ? +(headTop - sh.top).toFixed(1) : null,
    RED2_zone_top:        ye ? +(ca.top - ye.bottom).toFixed(1) : null,
    RED3_zone_bottom:     +(sh.bottom - ca.bottom).toFixed(1),
  };
}"""


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 393, "height": 852}, device_scale_factor=2)
        pg = ctx.new_page()
        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_timeout(1400)
        pg.evaluate(SEED)
        pg.goto(URL, wait_until="networkidle")
        pg.wait_for_timeout(1700)
        gaps = pg.evaluate(MEASURE)
        ctx.close()
        browser.close()

    print(json.dumps(gaps, indent=2))
    if "error" in gaps:
        print("FAILED:", gaps["error"])
        return 2

    green = gaps["GREEN_gutter_right"]
    reds = ("RED1_header_top", "RED2_zone_top", "RED3_zone_bottom")
    print(f"\n  target (green gutter) = {green}px")
    ok = True
    for k in ("GREEN_gutter_left", *reds):
        v = gaps[k]
        near = v is not None and abs(v - green) <= 1.0
        ok = ok and near
        delta = "n/a" if v is None else f"{v - green:+.1f}"
        print(f"  {k:20} = {str(v):>6}   Δ {delta:>5}   {'ok' if near else 'OFF'}")
    print("\n", "UNIFORM ✓" if ok else "NOT UNIFORM ✗")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
