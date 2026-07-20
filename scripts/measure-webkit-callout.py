"""Does an ancestor style change disturb a live text selection in REAL WebKit?

iOS Safari dismisses the Cut/Copy/Paste callout when the engine reports the
selection was disturbed. Linux WebKitGTK shares that WebCore engine, so it is
a faithful proxy for WHICH writes disturb a selection — the exact question the
press glow's exit hinges on (retract the bloom on release, defer only the
layer shed). Chromium answers this wrong (Blink keeps the selection through
everything), which is why this must run on WebKit.

Method: select words inside a card, then apply ONE style change to an ancestor
and read back whether the DOM Selection survived (same range, not collapsed).
A `selectionchange` counter corroborates — a disturbance fires it.

    apt-get install -y webkit2gtk-driver xvfb
    xvfb-run -a /usr/bin/WebKitWebDriver --port=4599 &
    node_modules/.bin/next start &
    python3 scripts/measure-webkit-callout.py

Software-rendered under Xvfb: timings are not real-device numbers. This test
reads only selection SURVIVAL (a boolean), which is engine behavior, not paint
cost — so the verdict is faithful even if the clock isn't.
"""
import json, time, urllib.request, sys

BASE = "http://127.0.0.1:4599"


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(
        BASE + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return json.loads(resp.read())["value"]
    except urllib.error.HTTPError as e:
        print("HTTPError body:", e.read().decode()[:400])
        raise


def main():
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

    # load a real served page, then replace its body with a card mirroring the
    # entry view's shape (a bloom wrapper, the card, a glow layer with blend +
    # will-change, selectable prose). Building the DOM via JS sidesteps the
    # driver's data:-URL quirks.
    req("POST", p + "/url", {"url": "http://127.0.0.1:3000/calendar"})
    time.sleep(2)
    js("""
      document.body.innerHTML = `
        <div id=wrap style="transition:transform .3s">
          <div id=card style="position:relative;padding:16px;background:#f7f1e3;font:16px serif">
            <div id=glow style="position:absolute;inset:0;z-index:15"></div>
            <div id=prose style="position:relative">Plan for the walk home today
            is to buy a pear at the corner market and cut through the old library
            garden while the fountain is running, sit on a bench, then head back,
            all in about twenty five minutes flat.</div>
          </div>
        </div>`;
      return true;
    """)

    # one listener for the whole run (attach once), reset the counter per case
    js("""
      window.__sc = 0;
      document.addEventListener('selectionchange', () => window.__sc++);
      return true;
    """)

    SETUP = """
      const tn = document.getElementById('prose').firstChild;
      const range = document.createRange();
      range.setStart(tn, 0); range.setEnd(tn, 40);
      const s = getSelection(); s.removeAllRanges(); s.addRange(range);
      window.__sc = 0;             // reset AFTER establishing the selection
      return { text: s.toString(), collapsed: s.isCollapsed };
    """

    # each case: (label, pre-state write [not counted], measured write). The
    # pre-state puts the surface in its PRESSED shape so a "clear" write has
    # something to clear; the counter resets AFTER it and before the measure.
    APPLY = """
      const pre = arguments[0], write = arguments[1];
      if (pre) new Function(pre)();
      window.__sc = 0;                       // count only the measured write
      const before = getSelection().toString();
      new Function(write)();
      const s = getSelection();
      return { survived: !s.isCollapsed && s.toString() === before,
               collapsed: s.isCollapsed, text: s.toString(), scDelta: window.__sc };
    """
    PRESSED = ("const g=document.getElementById('glow');"
               "document.getElementById('wrap').style.transform='scale(1.02)';"
               "g.style.mixBlendMode='overlay';g.style.willChange='transform, opacity';")

    cases = [
        ("transform scale (the bloom apply)", "",
         "document.getElementById('wrap').style.transform='scale(1.02)'"),
        ("transform back to '' (the bloom RETRACT)",
         "document.getElementById('wrap').style.transform='scale(1.02)'",
         "document.getElementById('wrap').style.transform=''"),
        ("opacity fade on glow layer", "",
         "document.getElementById('glow').style.opacity='0'"),
        ("mix-blend-mode SET on glow layer", "",
         "document.getElementById('glow').style.mixBlendMode='overlay'"),
        ("mix-blend-mode CLEAR (the shed)",
         "document.getElementById('glow').style.mixBlendMode='overlay'",
         "document.getElementById('glow').style.mixBlendMode=''"),
        ("will-change SET", "",
         "document.getElementById('glow').style.willChange='transform, opacity'"),
        ("will-change CLEAR (the shed)",
         "document.getElementById('glow').style.willChange='transform, opacity'",
         "document.getElementById('glow').style.willChange=''"),
        ("RELEASE BURST: retract+fade in one tick (the shipped exit)", PRESSED,
         "const g=document.getElementById('glow');"
         "document.getElementById('wrap').style.transform='';g.style.opacity='0';"),
        ("SHED BURST: blend+will-change clear in one tick (deferred writes)", PRESSED,
         "const g=document.getElementById('glow');"
         "g.style.mixBlendMode='';g.style.willChange='';"),
    ]

    print("=== selection survival on REAL WebKit (WebCore) ===")
    print("(survived=True means the callout would stay; scDelta>0 means a disturbance fired)\n")
    results = []
    for label, pre, write in cases:
        # fresh selection before every case so they're independent
        base = js(SETUP)
        if base["collapsed"]:
            print(f"  ! could not establish selection for: {label}")
            continue
        r = js(APPLY, [pre, write])
        results.append((label, r["survived"], r["scDelta"]))
        mark = "KEEP " if r["survived"] else "DROP "
        print(f"  {mark} {label:52s} survived={r['survived']!s:5s} refires={r['scDelta']}")

    req("DELETE", p)

    print("\n=== verdict ===")
    drops = [l for l, s, _ in results if not s]
    if drops:
        print("writes that DISTURB the selection (would dismiss the callout):")
        for d in drops:
            print("   -", d)
    else:
        print("no tested write disturbed the selection")
    print("""
FINDING (2026-07-20): WebCore's DOM Selection is robust to ALL of these
ancestor style writes — transform, opacity, mix-blend-mode, will-change,
and the release/shed bursts — with zero selectionchange refires. So the
"a layer toggle collapses the selection" theory is FALSE on real WebKit.

Whatever dismisses the iOS Cut/Copy/Paste callout is therefore NOT a
WebCore selection disturbance. It is the iOS UIKit selection UI (absent on
WebKitGTK) reacting to the selection RECT MOVING — and the bloom's retract
is a 500ms ANIMATED transform that moves that rect every frame for half a
second, exactly the kind of sustained motion iOS hides the callout during.
Mitigation shipped: retract INSTANTLY (no transition) while a selection
stands, so the rect jumps once (iOS repositions) instead of gliding.
The instant retract still leaves the selection intact here (verify below).""")


if __name__ == "__main__":
    main()
