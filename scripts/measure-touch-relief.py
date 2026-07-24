"""No ancestor may restrict touch-action while a field is being written in.

The book's layers set `touch-action: pan-y` to own their swipe-back gesture.
Permitted touch behaviours are the INTERSECTION down the ancestor chain, so a
field's own `touch-action: auto` cannot give that back — the effective value over
the field stays pan-y, and iOS hands a DOWNWARD selection-handle drag to the pan
recogniser instead of the selection (2026-07-24: the handle would not follow the
finger down, while sideways drags worked). globals.css therefore drops the
restriction while a field inside a layer holds focus.

This walks the real chain from the field to the document and asserts nothing
restricts it — and that pan-y COMES BACK on blur, so reading keeps its gesture.

Chromium, deliberately: this is a cascade/specificity question, which Blink
answers faithfully. The WebKitGTK harness cannot — under Xvfb its window never
takes system focus, so `:focus` never matches and every :has(:focus) rule reads
as inactive. (WebKit still owns the questions that are WebKit's: see
measure-webkit-drag-select.py, which clears the DOM and hit testing.)

  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "node_modules/.bin/next start" --port 3000 -- \
    python3 scripts/measure-touch-relief.py
"""

from playwright.sync_api import sync_playwright

CHAIN = """() => {
  const a = document.querySelector('[data-entry-card] textarea')
         || document.querySelector('textarea');
  if (!a) return {err: 'no field'};
  const restrict = [];
  let el = a;
  while (el) {
    const ta = getComputedStyle(el).touchAction;
    if (ta !== 'auto')
      restrict.push((el.dataset?.layer ? '[data-layer=' + el.dataset.layer + ']'
                                       : el.tagName.toLowerCase()) + ' -> ' + ta);
    el = el.parentElement;
  }
  return {focused: document.activeElement === a, restrict};
}"""

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 780})
    page.add_init_script(
        "window.SpeechRecognition = window.webkitSpeechRecognition = "
        "function(){this.start=()=>{};this.stop=()=>{};this.abort=()=>{};};"
    )
    page.goto("http://localhost:3000/calendar?seed=30", wait_until="networkidle")
    page.wait_for_timeout(6000)  # the seed's IndexedDB writes lag its render
    page.goto("http://localhost:3000/calendar", wait_until="networkidle")
    page.wait_for_timeout(2500)

    composer_rest = page.evaluate(CHAIN)
    page.locator("textarea").first.click()
    page.wait_for_timeout(600)
    composer_lit = page.evaluate(CHAIN)
    page.keyboard.press("Escape")
    page.evaluate("document.activeElement.blur()")
    page.wait_for_timeout(400)

    page.locator(".book-card").last.scroll_into_view_if_needed()
    page.locator(".book-card").last.click()
    page.wait_for_timeout(1600)
    entry_rest = page.evaluate(CHAIN)
    page.locator("[data-entry-card-content]").click()
    page.wait_for_timeout(1200)
    entry_lit = page.evaluate(CHAIN)
    browser.close()

for label, r in (("composer, nothing focused", composer_rest),
                 ("composer, focused", composer_lit),
                 ("entry, reading", entry_rest),
                 ("entry, being rewritten", entry_lit)):
    print(f"{label:28s} focused={str(r.get('focused')):5s} "
          f"restricting ancestors={r.get('restrict')}")

checks = [
    ("composer focused: nothing restricts the chain",
     composer_lit.get("focused") and composer_lit.get("restrict") == []),
    ("entry being rewritten: nothing restricts the chain",
     entry_lit.get("focused") and entry_lit.get("restrict") == []),
    # the relief is scoped to writing — reading keeps the swipe-back gesture
    ("composer at rest: the layer still owns pan-y",
     composer_rest.get("restrict") != []),
    ("entry while reading: the layer still owns pan-y",
     entry_rest.get("restrict") != []),
]
failed = [n for n, ok in checks if not ok]
for n, ok in checks:
    print(("PASS" if ok else "FAIL"), n)
raise SystemExit(1 if failed else 0)
