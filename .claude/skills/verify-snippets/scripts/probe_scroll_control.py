"""Control: does the SAME wheel + CDP touch flick scroll a PLAIN tall page?
Distinguishes 'app blocks native scroll input' from 'driving technique
can't produce touch scroll at all'. Also re-tests the app scroller,
sampling scrollTop DURING the gesture to catch a scroll that gets
re-anchored back to 0 by the app's own choreography.
"""
import json, os, sys, time
sys.path.insert(0, ".claude/skills/verify-snippets/scripts")
from personas import ios_pwa_page
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
OUT = os.environ.get("EVIDENCE_DIR", "/tmp/verify-snippets") + "/probe-scroll"
report = {}

PLAIN = ("data:text/html,<meta name=viewport content='width=device-width'>"
         "<div style='height:20000px;background:linear-gradient(#fff,#000)'>x</div>")

def flick(cdp, cx, y0, y1, dwell=0.012):
    def touch(kind, y):
        pts = [] if kind == "touchEnd" else [{"x": cx, "y": y}]
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": pts})
    touch("touchStart", y0)
    for i in range(1, 9):
        touch("touchMove", y0 + (y1-y0)*i/8); time.sleep(dwell)
    touch("touchEnd", y1)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = ios_pwa_page(browser)

    # ── control A: plain page ──
    page.goto(PLAIN, wait_until="load")
    cdp = page.context.new_cdp_session(page)
    page.evaluate("scrollTo(0,0)")
    flick(cdp, 196, 600, 150)
    page.wait_for_timeout(600)
    report["plain_page_cdp_touch_flick"] = {"scrollY": page.evaluate("window.scrollY")}
    page.evaluate("scrollTo(0,0)")
    page.mouse.move(196, 400); page.mouse.wheel(0, 1200); page.wait_for_timeout(300)
    report["plain_page_wheel"] = {"scrollY": page.evaluate("window.scrollY")}

    # ── control B: app scroller, sampled DURING the gesture ──
    page.goto(f"{BASE}/calendar?seed=400&years=5", wait_until="load")
    page.wait_for_timeout(8000)
    page.evaluate("""() => {
      const el=[...document.querySelectorAll('*')].filter(e=>{const s=getComputedStyle(e);
        return /(auto|scroll)/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+20;})
        .sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
      el.setAttribute('data-ps','1');
      window.__peak=0;
      el.addEventListener('scroll',()=>{window.__peak=Math.max(window.__peak, el.scrollTop);});
    }""")
    cdp2 = page.context.new_cdp_session(page)
    r = page.evaluate("() => {const e=document.querySelector('[data-ps]');const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height*0.75,b.y+b.height*0.2];}")
    page.evaluate("document.querySelector('[data-ps]').scrollTop=0; window.__peak=0")
    flick(cdp2, r[0], r[1], r[2])
    page.wait_for_timeout(600)
    report["app_scroller_peak_during_touch"] = page.evaluate("window.__peak")
    report["app_touch_action"] = page.evaluate("getComputedStyle(document.querySelector('[data-ps]')).touchAction")
    # is there a wheel/touchmove preventDefault handler on the tree?
    report["app_blocks_default"] = page.evaluate("""() => {
      let blocked=false; const el=document.querySelector('[data-ps]');
      const probe=new WheelEvent('wheel',{cancelable:true,bubbles:true,deltaY:100});
      const before=el.scrollTop; el.dispatchEvent(probe);
      return {wheelDefaultPrevented: probe.defaultPrevented};
    }""")
    browser.close()

(open(f"{OUT}/control.json","w")).write(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
