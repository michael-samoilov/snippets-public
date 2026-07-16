"""
Measure the dive/rise setup spans on REAL WEBKIT (WebKitGTK MiniBrowser) via
raw W3C WebDriver — stdlib only, no selenium.

WHY THIS EXISTS (2026-07-16): two optimization rounds tuned against throttled
Chromium showed wins that never materialized on the owner's iPhone, because
the dominant costs were WEBKIT-SPECIFIC — e.g. one pointer-events write on a
layer containing the book cost 250-340ms here (~115ms on the phone) while
Blink did it for free, and Blink flushes layout inside scrollTo while WebKit
defers it. Every setup-cost hypothesis must be priced on THIS harness before
it ships; Chromium harnesses remain for correctness/regressions.

SETUP (once per sandbox):
    apt-get install -y webkit2gtk-driver xvfb
    xvfb-run -a /usr/bin/WebKitWebDriver --port=4599 &   # keep running
    node_modules/.bin/next start &                        # production build

    python3 scripts/measure-webkit-spans.py [seed]

GOTCHAS learned the hard way:
  - The seed page renders fast but its IndexedDB writes lag: navigate away
    too early and the reload comes back EMPTY (hence the poll + 10s settle).
  - Under Xvfb, MiniBrowser fires NO rAF ticks while idle — dwell-staged
    work (rAF-deferred goTo, widen flush) does NOT run during the synthetic
    dwell like it does on a device. Dive numbers here are the no-dwell worst
    case; the rise is faithful.
"""
import json, time, urllib.request, sys

BASE = "http://127.0.0.1:4599"

def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=120) as resp:
        return json.loads(resp.read())["value"]

def main():
    seed = sys.argv[1] if len(sys.argv) > 1 else "1200"
    sess = req("POST", "/session", {"capabilities": {"alwaysMatch": {
        "browserName": "MiniBrowser",
        "webkitgtk:browserOptions": {
            "binary": "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser",
            "args": ["--automation"],
        }}}})
    sid = sess["sessionId"]
    p = f"/session/{sid}"
    req("POST", p + "/window/rect", {"width": 393, "height": 852})
    def js(script, args=None):
        return req("POST", p + "/execute/sync", {"script": script, "args": args or []})
    req("POST", p + "/url", {"url": f"http://127.0.0.1:3000/calendar?seed={seed}"})
    want = int(int(seed) * 0.55)  # sections ~ 0.6/entry at these densities
    for i in range(20):
        time.sleep(2)
        n = js("return document.querySelectorAll('[data-day]').length")
        if n and int(n) > want: break
    print("seeded:", n, "sections after", (i+1)*2, "s")
    time.sleep(10)  # let the IDB writes land before navigating away
    req("POST", p + "/url", {"url": "http://127.0.0.1:3000/calendar"})
    for i in range(20):
        time.sleep(2)
        n = js("return document.querySelectorAll('[data-day]').length")
        if n and int(n) > want: break
    print("reloaded:", n, "sections after", (i+1)*2, "s")
    time.sleep(3)

    TAP = """
      const sel = arguments[0];
      const el = document.querySelector(sel);
      if (!el) return 'no ' + sel;
      el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true}));
      setTimeout(() => {
        el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true}));
        el.click();
      }, 120);
      return 'tapped';
    """
    SPANS = """
      const g=n=>{const e=performance.getEntriesByName(n);return e[e.length-1]?.startTime??null;};
      const run=g('zoom-run'),fx0=g('zoom-fx0'),wake=g('zoom-fx-wake'),stage=g('zoom-fx-stage'),
            band=g('zoom-fx-band'),pair=g('zoom-fx-pair'),fx1=g('zoom-fx1'),mv=g('zoom-motion');
      const r=(a,b)=>a!=null&&b!=null?Math.round(b-a):null;
      const gm=n=>{const e=performance.getEntriesByName(n,'measure');return e[e.length-1]?Math.round(e[e.length-1].duration):null;};
      return JSON.stringify({commit:r(run,fx0), wake:r(fx0,wake), stage:r(wake,stage),
        commitFlush:gm('fx:commitFlush'), fzLoop:gm('fz:loop'), mosWarm:gm('mos:warm'), mosFlush:gm('mos:flush'), churn:window.__warmChurn||null,
        reland:r(stage,band), flight:r(band,pair), fx:r(fx0,fx1), paint:r(fx1,mv)});
    """
    print("book:", js("return document.querySelectorAll('[data-day]').length + ' sections, ' + document.querySelectorAll('[data-entry]').length + ' entries, warm=' + document.querySelectorAll('[data-day][data-warm]').length + ', title=' + !!document.querySelector('[data-cal-title]')"))
    print("rise tap:", js(TAP, ["[data-cal-title]"]))
    time.sleep(3)
    print("rise :", js(SPANS))
    day = js("""
      const st=document.querySelector('[data-layer="month"]').getBoundingClientRect();
      const cs=[...document.querySelectorAll('[data-layer="month"] button[data-day-key]:not([disabled])')]
        .map(b=>({b,r:b.getBoundingClientRect()}))
        .filter(x=>x.r.top>st.top+80&&x.r.bottom<st.bottom-80&&x.r.height>0);
      return cs[Math.floor(cs.length/2)]?.b.getAttribute('data-day-key');
    """)
    print("day:", day)
    sel = f'[data-layer="month"] button[data-day-key="{day}"]'
    print("dive tap:", js(TAP, [sel]))
    time.sleep(3)
    print("dive :", js(SPANS))
    # steady-state second pair
    js(TAP, ["[data-cal-title]"]); time.sleep(3)
    print("rise2:", js(SPANS))
    js(TAP, [sel]); time.sleep(3)
    print("dive2:", js(SPANS))
    req("DELETE", p)

if __name__ == "__main__":
    main()
