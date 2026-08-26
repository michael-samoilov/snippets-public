"""Can the verify skill scroll the PWA 'like a thumb on an iPhone'?
Don't reason about it — try every mechanism a thumb could map to, measure
what actually moves the scroller, and check for iOS-style momentum.
Run via with_server.py.
"""
import json, os, sys, time
sys.path.insert(0, ".claude/skills/verify-snippets/scripts")
from personas import ios_pwa_page
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
OUT = os.environ.get("EVIDENCE_DIR", "/tmp/verify-snippets") + "/probe-scroll"
os.makedirs(OUT, exist_ok=True)
report = {}

FIND_SCROLLER = """() => {
  // the app's real scroll container: overflow-y auto/scroll, actually overflowing
  const els = [...document.querySelectorAll('*')].filter(e => {
    const s = getComputedStyle(e);
    return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 20;
  });
  els.sort((a,b) => (b.scrollHeight-b.clientHeight) - (a.scrollHeight-a.clientHeight));
  const el = els[0];
  if (!el) return null;
  el.setAttribute('data-probe-scroller','1');
  const r = el.getBoundingClientRect();
  return {tag: el.tagName, cls: el.className.slice(0,60),
          scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
          x: r.x, y: r.y, w: r.width, h: r.height};
}"""
TOP = "() => document.querySelector('[data-probe-scroller]').scrollTop"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = ios_pwa_page(browser)
    page.goto(f"{BASE}/calendar?seed=400&years=5", wait_until="load")
    page.wait_for_timeout(8000)

    # what engine is really under the spoofed iPhone UA?
    report["engine_tell"] = page.evaluate("""() => ({
      spoofedUA: navigator.userAgent.includes('iPhone'),
      userAgentDataBrands: (navigator.userAgentData && navigator.userAgentData.brands
        && navigator.userAgentData.brands.map(b=>b.brand)) || null,
    })""")

    sc = page.evaluate(FIND_SCROLLER)
    report["scroller"] = sc
    if not sc:
        report["error"] = "no scroll container overflowing — seed may not have landed"
        (open(f"{OUT}/report.json","w")).write(json.dumps(report, indent=2)); browser.close(); sys.exit(1)

    cx = sc["x"] + sc["w"]/2
    y0, y1 = sc["y"] + sc["h"]*0.75, sc["y"] + sc["h"]*0.20  # flick UP (thumb drags up)

    def top(): return page.evaluate(TOP)
    def reset(): page.evaluate("() => document.querySelector('[data-probe-scroller]').scrollTop = 0")

    # 1. Synthetic JS PointerEvent drag — what the skill uses for TAPS.
    reset(); before = top()
    page.evaluate("""(a) => {
      const el = document.querySelector('[data-probe-scroller]');
      const [cx,y0,y1] = a;
      const opt = t => ({bubbles:true,cancelable:true,pointerId:1,pointerType:'touch',isPrimary:true,clientX:cx,clientY:t});
      el.dispatchEvent(new PointerEvent('pointerdown',opt(y0)));
      for (let y=y0; y>=y1; y-=20) el.dispatchEvent(new PointerEvent('pointermove',opt(y)));
      el.dispatchEvent(new PointerEvent('pointerup',opt(y1)));
    }""", [cx, y0, y1])
    page.wait_for_timeout(300)
    report["1_synthetic_js_pointer_drag"] = {"delta": top() - before, "note": "untrusted events"}

    # 2. Real touch flick via CDP Input.dispatchTouchEvent — a driven thumb gesture.
    reset(); before = top()
    cdp = page.context.new_cdp_session(page)
    def touch(kind, y):
        pts = [] if kind == "touchEnd" else [{"x": cx, "y": y}]
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})
    touch("touchStart", y0)
    steps = 8
    for i in range(1, steps+1):
        touch("touchMove", y0 + (y1-y0)*i/steps)
        time.sleep(0.012)  # fast flick → fling velocity
    touch("touchEnd", y1)
    at_release = top()
    page.wait_for_timeout(700)          # watch for momentum after the finger lifts
    after_settle = top()
    report["2_cdp_touch_flick"] = {
        "delta_during_drag": at_release - before,
        "delta_after_release": after_settle - at_release,
        "note": "delta_after_release>0 means the fling kept moving after touchEnd",
    }

    # 3. Wheel (trackpad/programmatic), and 4. scrollTo (pure programmatic).
    reset(); before = top(); page.mouse.move(cx, sc["y"]+sc["h"]/2); page.mouse.wheel(0, 1200)
    page.wait_for_timeout(300)
    report["3_mouse_wheel"] = {"delta": top() - before}
    reset(); page.evaluate("() => document.querySelector('[data-probe-scroller]').scrollTo(0, 1500)")
    page.wait_for_timeout(200)
    report["4_programmatic_scrollTo"] = {"delta": top()}

    page.screenshot(path=f"{OUT}/after-scroll.png")
    (open(f"{OUT}/report.json","w")).write(json.dumps(report, indent=2))
    browser.close()

print(json.dumps(report, indent=2))
print("evidence →", OUT)
