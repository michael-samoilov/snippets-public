"""The book must stay scrollable while an inline composer is being written in.

The contract (owner, 2026-07-31): "we should be able to scroll freely and even
to have the focused entry card be out of view, just as soon as we type again
then we instantly bring it back to view. The caret shouldn't be able to drift
away from its position in the card."

Before this, a focused composer (data-room-pin) held the whole schedule
overflow:hidden for its entire focus, and useKeyboardRoom's correct() re-anchored
the card on every stray scroll — including every visualViewport scroll. A drag
therefore moved nothing; on iOS the drag went into a visual-viewport pan, the
re-anchor scrolled the book the opposite way to hold the card still, and the
caret — which iOS draws from the book's REAL scroll offset — walked out of the
card and came to rest between two other cards (measured frame by frame on the
owner's recording: card fixed to the pixel, caret up ~100px).

What this asserts, in the real app:
  1. focusing the composer never makes the book unscrollable
  2. with the keyboard up, the card is anchored clear of it
  3. a scroll while focused actually moves the book — far enough to carry the
     card off screen — and STAYS there (no snap-back)
  4. typing brings the card back above the keyboard
  5. the freeze still guards the quiet book: a programmatic scroll with no
     finger down is still snapped back (WebKit's auto-scroll pathology)

Chromium: this is scroll bookkeeping, which Blink runs faithfully, and the
harness can drive a keyboard that WebKitGTK-under-Xvfb has no way to raise. The
keyboard itself is simulated by shrinking visualViewport.height — the same read
correct() takes. The iOS caret overlay is native and off-limits to any harness;
what is provable here is the scroll behaviour that moved it.

  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "node_modules/.bin/next start" --port 3000 -- \
    python3 scripts/measure-composer-room.py
"""

from playwright.sync_api import sync_playwright

# a keyboard the harness can raise: shrink the visual viewport, as iOS does
KB = """(() => {
  const vv = window.visualViewport;
  let kb = 0;
  const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(vv), 'height');
  Object.defineProperty(vv, 'height', {
    get() { return d.get.call(vv) - kb; }, configurable: true,
  });
  window.__setKb = (v) => { kb = v; vv.dispatchEvent(new Event('resize')); };
})()"""

STATE = """() => {
  const ta = document.querySelector('textarea[data-room-pin]');
  if (!ta) return {err: 'no composer'};
  let el = ta.parentElement, sc = null;
  while (el) {
    const cs = getComputedStyle(el);
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll' ||
        (cs.overflowY === 'hidden' && el.scrollHeight > el.clientHeight + 4)) { sc = el; break; }
    el = el.parentElement;
  }
  window.__sc = sc;
  const r = ta.getBoundingClientRect();
  const vv = window.visualViewport;
  return {
    focused: document.activeElement === ta,
    overflow: getComputedStyle(sc).overflowY,
    scrollTop: Math.round(sc.scrollTop),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    // the keyboard's floating accessory band starts 64px above its top
    band: Math.round(vv.pageTop - document.scrollingElement.scrollTop + vv.height - 64),
    ceil: Math.round(sc.getBoundingClientRect().top + 8),
  };
}"""

from datetime import date, timedelta

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(
        viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True
    )
    page.add_init_script(
        "window.SpeechRecognition = window.webkitSpeechRecognition = "
        "function(){this.start=()=>{};this.stop=()=>{};this.abort=()=>{};};"
    )
    page.add_init_script(KB)
    page.goto("http://localhost:3000/calendar?seed=40&years=2", wait_until="networkidle")
    page.wait_for_timeout(4000)  # the seed's IndexedDB writes lag its render
    page.wait_for_function(
        "() => indexedDB.databases().then(d => d.some(x => x.name))", timeout=20000
    )
    # `?d=` conjures a row for a day that holds nothing, which is the only way an
    # inline composer exists. Walk back from yesterday for one the seed left
    # empty (the seed is deterministic, but the day it lands on is not).
    for back in range(1, 12):
        day = (date.today() - timedelta(days=back)).isoformat()
        page.goto(f"http://localhost:3000/calendar?d={day}", wait_until="networkidle")
        try:  # the book renders from IndexedDB, a beat behind the first paint
            page.wait_for_function(
                "() => document.querySelectorAll('[data-day]').length > 3", timeout=15000
            )
        except Exception:
            pass
        page.wait_for_timeout(1500)
        n = page.locator("textarea[data-room-pin]").count()
        print(f"  {day}: {n} composer(s), "
              f"{page.locator('[data-day]').count()} day rows")
        if n:
            break
    else:
        raise SystemExit("no empty day found to compose on")
    print(f"composing on {day}\n")
    page.wait_for_timeout(1000)

    rest = page.evaluate(STATE)
    page.locator("textarea[data-room-pin]").first.click()
    page.wait_for_timeout(300)
    page.evaluate("() => window.__setKb(320)")
    page.wait_for_timeout(1400)
    lit = page.evaluate(STATE)

    # scroll the book by hand, hard enough to carry the card off screen
    for _ in range(5):
        page.mouse.move(195, 200)
        page.mouse.wheel(0, -500)
        page.wait_for_timeout(200)
    scrolled = page.evaluate(STATE)
    page.wait_for_timeout(1800)  # past arm()'s 900ms — does it spring back?
    settled = page.evaluate(STATE)

    page.keyboard.type("x")
    page.wait_for_timeout(1000)
    typed = page.evaluate(STATE)

    # …and the quiet book is still guarded: no finger down, so a stray
    # programmatic scroll (WebKit's auto-scroll) must be snapped back
    page.wait_for_timeout(1200)
    page.evaluate("() => { window.__sc.scrollTop -= 700; }")
    page.wait_for_timeout(500)
    stray = page.evaluate(STATE)
    browser.close()

for label, r in (("at rest", rest), ("focused, keyboard up", lit),
                 ("after scrolling by hand", scrolled), ("1.8s later", settled),
                 ("after typing", typed), ("after a stray scroll", stray)):
    print(f"{label:26s} overflow={r.get('overflow'):7s} scrollTop={r.get('scrollTop'):6d} "
          f"card={r.get('top'):5d}–{r.get('bottom'):<5d} band={r.get('band'):4d} "
          f"focused={r.get('focused')}")

checks = [
    ("focus never makes the book unscrollable",
     rest["overflow"] != "hidden" and lit["overflow"] != "hidden"),
    ("the keyboard is answered: the card sits clear of the band",
     lit["bottom"] <= lit["band"] + 1 and lit["top"] >= lit["ceil"] - 1),
    ("a scroll while focused moves the book",
     abs(scrolled["scrollTop"] - lit["scrollTop"]) > 200),
    ("…far enough to carry the card off screen", scrolled["top"] > 780),
    ("…and it stays where it was left", abs(settled["scrollTop"] - scrolled["scrollTop"]) <= 2),
    ("typing brings the card back, clear of the keyboard",
     typed["bottom"] <= typed["band"] + 1 and typed["top"] >= typed["ceil"] - 1),
    ("the quiet book is still guarded from a stray scroll",
     abs(stray["scrollTop"] - typed["scrollTop"]) <= 2),
]
failed = [n for n, ok in checks if not ok]
print()
for n, ok in checks:
    print(("PASS" if ok else "FAIL"), n)
raise SystemExit(1 if failed else 0)
