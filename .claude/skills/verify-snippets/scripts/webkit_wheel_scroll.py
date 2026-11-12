#!/usr/bin/env python3
"""Scroll the app's book feed on REAL WebKit (WebKitGTK MiniBrowser) with
a trusted W3C WebDriver wheel action, and confirm the scroll drove the
app's warm-window logic. This is the honest "scroll like the iOS engine"
path — Chromium in this sandbox synthesizes no scroll at all.

Reference / runnable. Requires (see SKILL.md):
    apt-get install -y webkit2gtk-driver xvfb
    xvfb-run -a /usr/bin/WebKitWebDriver --port=4599 &   # keep running
    node_modules/.bin/next start -p 3000 &               # production build
    python3 .claude/skills/verify-snippets/scripts/webkit_wheel_scroll.py

What it proves (measured 2026-08-26): two wheel actions moved the book
+16,000px, fired 3 real scroll events, warm window followed 2021→2024.

The two mistakes this script exists to prevent:
  1. Do NOT pick the scroller by largest scrollHeight — two overlapping
     overflow-y-auto layers exist; that grabs the wrong one. The book
     feed is the scroll-parent of a [data-day] card.
  2. Aim the wheel at a real card. The today-zone composer overlays the
     lower-middle viewport with its own scroll ancestor; a wheel there
     misses the feed and reads 0px (looks like "the app blocks scroll" —
     it does not). Verify elementFromPoint hits the feed first.

Touch-drag actions do NOT synthesize a scroll here; wheel is the lever.
iOS momentum / rubber-band / memory pressure are device-only regardless.
"""
import base64, json, os, sys, time, urllib.request

WD = os.environ.get("WEBKIT_WD", "http://127.0.0.1:4599")
APP = os.environ.get("BASE_URL", "http://127.0.0.1:3000")
BINARY = "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser"
OUT = os.environ.get("EVIDENCE_DIR", "/tmp/verify-snippets") + "/webkit-wheel"


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(WD + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=90) as resp:
        return json.loads(resp.read())["value"]


def main(seed="400", years="5"):
    os.makedirs(OUT, exist_ok=True)
    sess = req("POST", "/session", {"capabilities": {"alwaysMatch": {
        "browserName": "MiniBrowser",
        "webkitgtk:browserOptions": {"binary": BINARY, "args": ["--automation"]}}}})
    sid = sess["sessionId"]
    p = f"/session/{sid}"
    req("POST", p + "/window/rect", {"width": 393, "height": 852})

    def js(s):
        return req("POST", p + "/execute/sync", {"script": s, "args": []})

    try:
        req("POST", p + "/url", {"url": f"{APP}/calendar?seed={seed}&years={years}"})
        for _ in range(20):
            time.sleep(2)
            if (js("return document.querySelectorAll('[data-day]').length") or 0) > 100:
                break
        time.sleep(6)

        # 1. the book feed = the app's own [data-book-scroller] handle
        # (docs/schedule-map.md; calendar/page.tsx). Fall back to the [data-day]
        # scroll-parent only if the attribute is ever renamed. NEVER pick by
        # largest scrollHeight — a second overflow-y-auto layer overlaps it.
        js("""var s=document.querySelector('[data-book-scroller]');
          if(!s){var d=document.querySelector('[data-day]'); s=d;
            while(s&&!(/(auto|scroll)/.test(getComputedStyle(s).overflowY)&&s.scrollHeight>s.clientHeight+4)) s=s.parentElement;}
          s.setAttribute('data-book','1'); s.addEventListener('scroll',function(){window.__bev=(window.__bev||0)+1;});""")
        js("document.querySelector('[data-book]').scrollTop=0; window.__bev=0;")
        time.sleep(1)

        # 2. find a wheel point that provably hits the feed (skip the composer overlay)
        pt = json.loads(js("""
          var found=null;
          for(var y=240;y<=520&&!found;y+=20){ var el=document.elementFromPoint(196,y); var s=el;
            while(s&&s!==document.body){ if(s.hasAttribute&&s.hasAttribute('data-book')){found={x:196,y:y};break;} s=s.parentElement; } }
          return JSON.stringify(found||{none:true});"""))
        if pt.get("none"):
            print("no wheel point over the book feed found"); return 1

        def snap():
            return {"top": js("return document.querySelector('[data-book]').scrollTop"),
                    "warm": js("return [].slice.call(document.querySelectorAll('[data-day][data-warm]'))"
                               ".map(function(e){return e.getAttribute('data-day');}).slice(0,2).join(',')"),
                    "ev": js("return window.__bev||0")}

        before = snap()
        for _ in range(2):
            req("POST", p + "/actions", {"actions": [{"type": "wheel", "id": "w", "actions": [
                {"type": "scroll", "x": pt["x"], "y": pt["y"], "deltaX": 0, "deltaY": 8000, "duration": 150}]}]})
            req("DELETE", p + "/actions")
            time.sleep(0.6)
        time.sleep(0.8)
        after = snap()

        moved = after["top"] - before["top"]
        result = {"wheel_point": pt, "before": before, "after": after,
                  "book_moved_px": moved, "scroll_events": after["ev"],
                  "warm_followed": after["warm"] != before["warm"]}
        png = urllib.request.urlopen(urllib.request.Request(WD + p + "/screenshot", method="GET"), timeout=30)
        open(f"{OUT}/after-wheel.png", "wb").write(base64.b64decode(json.loads(png.read())["value"]))
        (open(f"{OUT}/report.json", "w")).write(json.dumps(result, indent=2))
        print(json.dumps(result, indent=2))
        print("evidence →", OUT)
        ok = moved > 1000 and result["warm_followed"]
        print("PASS: WebKit wheel scrolled the book and drove its logic" if ok
              else "FAIL: book did not scroll — check the wheel point hits the feed")
        return 0 if ok else 1
    finally:
        req("DELETE", p)


if __name__ == "__main__":
    seed = sys.argv[1] if len(sys.argv) > 1 else "400"
    sys.exit(main(seed))
