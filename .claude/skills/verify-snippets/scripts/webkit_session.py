#!/usr/bin/env python3
"""Drive the app on the REAL WebKit engine (WebKitGTK MiniBrowser) — the
iOS Safari / iOS PWA / iOS Chrome engine, since every iOS browser is
WebKit. Unlike the Chromium personas (which spoof iOS identity over
Blink), this is the actual WebKit renderer, so it is the right lane for
anything engine-shaped: layout, selector cost, paint, and real scroll.

stdlib urllib only. Requires the driver up (see SKILL.md):
    apt-get install -y webkit2gtk-driver xvfb
    xvfb-run -a /usr/bin/WebKitWebDriver --port=4599 &

Usage:
    import sys; sys.path.insert(0, ".claude/skills/verify-snippets/scripts")
    from webkit_session import WebKitSession
    with WebKitSession() as wk:
        wk.open("/calendar", seed=40, years=1)
        print(wk.js("return document.querySelectorAll('[data-day]').length"))
        wk.tap("[data-cal-title]")            # rise to month view
        wk.screenshot("/tmp/verify-snippets/webkit/rise.png")

Caveats: one session at a time (on "session already exists":
pkill -9 -f WebKitWebDriver; pkill -9 -f MiniBrowser; restart). Desktop
WebKitGTK under Xvfb — software-rendered, no idle rAF — so use it for
correctness and relative cost, never absolute timings or iOS touch feel.
"""
import json
import os
import time
import urllib.request

BINARY = "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser"

# synthetic touch tap: pointerdown/up + click. Untrusted events, but the
# trailing click makes taps fire — the proven pattern from
# scripts/measure-webkit-spans.py. (Gesture SCROLL needs a trusted wheel
# action; see webkit_wheel_scroll.py.)
_TAP = """
  var el = document.querySelector(arguments[0]);
  if (!el) return 'no ' + arguments[0];
  el.scrollIntoView({block:'center'});
  el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true}));
  el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,pointerType:'touch',isPrimary:true}));
  el.click();
  return 'tapped';
"""


class WebKitSession:
    def __init__(self, driver="http://127.0.0.1:4599", app="http://127.0.0.1:3000",
                 width=393, height=852):
        self.driver = driver
        self.app = app
        self._wh = (width, height)
        self.sid = None

    def _req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(self.driver + path, data=data, method=method,
                                   headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(r, timeout=90) as resp:
            return json.loads(resp.read())["value"]

    def __enter__(self):
        v = self._req("POST", "/session", {"capabilities": {"alwaysMatch": {
            "browserName": "MiniBrowser",
            "webkitgtk:browserOptions": {"binary": BINARY, "args": ["--automation"]}}}})
        self.sid = v["sessionId"]
        self._p = f"/session/{self.sid}"
        self._req("POST", self._p + "/window/rect", {"width": self._wh[0], "height": self._wh[1]})
        return self

    def __exit__(self, *exc):
        if self.sid:
            try:
                self._req("DELETE", self._p)
            except Exception:
                pass

    def js(self, script):
        return self._req("POST", self._p + "/execute/sync", {"script": script, "args": []})

    def open(self, path="/calendar", seed=None, years=1, wait_days=1, settle=6.0):
        """Navigate; if seeding, poll [data-day] until the book fills, then settle."""
        url = self.app + path
        if seed is not None:
            sep = "&" if "?" in url else "?"
            url += f"{sep}seed={seed}&years={years}"
        self._req("POST", self._p + "/url", {"url": url})
        if seed is not None:
            for _ in range(20):
                time.sleep(2)
                if (self.js("return document.querySelectorAll('[data-day]').length") or 0) >= wait_days:
                    break
        time.sleep(settle)
        return self

    def tap(self, selector):
        return self._req("POST", self._p + "/execute/sync", {"script": _TAP, "args": [selector]})

    def screenshot(self, path):
        import base64
        os.makedirs(os.path.dirname(path), exist_ok=True)
        v = self._req("GET", self._p + "/screenshot", None)
        open(path, "wb").write(base64.b64decode(v))
        return path


if __name__ == "__main__":
    # smoke test: drive the app on real WebKit — load, read, rise, assert.
    out = os.environ.get("EVIDENCE_DIR", "/tmp/verify-snippets") + "/webkit-session"
    with WebKitSession() as wk:
        wk.open("/calendar", seed=40, years=1, wait_days=10)
        days = wk.js("return document.querySelectorAll('[data-day]').length")
        wk.tap("[data-cal-title]")
        time.sleep(2)
        month = wk.js("return !!document.querySelector('[data-layer=\\\"month\\\"]')")
        wk.screenshot(out + "/rise.png")
        print(json.dumps({"days_rendered": days, "rose_to_month": month}, indent=2))
        print("PASS" if (days and month) else "FAIL")
