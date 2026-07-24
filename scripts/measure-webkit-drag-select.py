"""Can a text selection be EXTENDED DOWNWARD inside the entry editor, on real
WebKit?

The bug (2026-07-24, screen recording): with a selection standing in the entry
editor, dragging the end handle DOWNWARD does nothing for seconds — the handle
and its loupe stay pinned to the first line while the finger moves — and then
the drag dies (the Cut/Copy/Paste callout returns). Dragging the handle SIDEWAYS
along the line works throughout, and once it reaches the line's end, downward
extension suddenly works perfectly and keeps working.

iOS's handle drag resolves each new selection end by hit-testing the drag point
and asking WebCore for the VisiblePosition there. WebKitGTK runs that same
WebCore code for a mouse drag, so a synthetic drag answers the engine question:
does a downward drag over THIS DOM extend the selection, or does something at the
drag point refuse it? Chromium can't answer — Blink's hit test differs (it was
already wrong about selection survival, see measure-webkit-callout.py).

    apt-get install -y webkit2gtk-driver xvfb
    xvfb-run -a /usr/bin/WebKitWebDriver --port=4599 &
    node_modules/.bin/next start &
    python3 scripts/measure-webkit-drag-select.py

Reads a boolean per step (did selectionEnd advance) plus what elementFromPoint
finds at the drag point and its computed user-select — engine behavior, not
paint cost, so the verdict holds despite Xvfb's software rendering.
"""
import json, time, urllib.request, sys

BASE = "http://127.0.0.1:4599"
LINES = ("Went to a third pottery class today.\n\nThe teacher asked: “Before "
         "we sit down at the wheels, is anyone hoping to make a cup, a bowl, "
         "or a vase?”\n\nI answer: “a cup on my end, but nothing with a "
         "handle yet, the last one fell off in the kiln”\n\nThrew 2 cups out "
         "of 5 tries, and the clay was still soft by the end of it")


def req(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return json.loads(resp.read())["value"]
    except urllib.error.HTTPError as e:
        print("HTTPError:", e.read().decode()[:400])
        raise


def main():
    sess = req("POST", "/session", {"capabilities": {"alwaysMatch": {
        "browserName": "MiniBrowser",
        "webkitgtk:browserOptions": {
            "binary": "/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser",
            "args": ["--automation"],
        }}}})
    p = f"/session/{sess['sessionId']}"
    req("POST", p + "/window/rect", {"width": 393, "height": 852})

    def js(script, args=None):
        return req("POST", p + "/execute/sync", {"script": script, "args": args or []})

    def move(x, y, down=None):
        """One pointer action call; W3C keeps the button state between calls."""
        acts = [{"type": "pointerMove", "x": int(x), "y": int(y), "duration": 0}]
        if down is True:
            acts.append({"type": "pointerDown", "button": 0})
        if down is False:
            acts.append({"type": "pointerUp", "button": 0})
        req("POST", p + "/actions", {"actions": [{
            "type": "pointer", "id": "finger", "parameters": {"pointerType": "mouse"},
            "actions": acts}]})

    # --- seed a book, open its newest entry, start the rewrite -------------
    req("POST", p + "/url", {"url": "http://127.0.0.1:3000/calendar?seed=40&perf=1"})
    for _ in range(20):
        time.sleep(2)
        if int(js("return document.querySelectorAll('[data-day]').length") or 0) > 12:
            break
    time.sleep(8)  # the seed's IndexedDB writes lag its render
    req("POST", p + "/url", {"url": "http://127.0.0.1:3000/calendar?perf=1"})
    time.sleep(6)

    js("""
      const c = [...document.querySelectorAll('.book-card')].pop();
      c.scrollIntoView(); c.click(); return true;
    """)
    time.sleep(2)
    js("document.querySelector('[data-entry-card-content]').click(); return true;")
    time.sleep(2)
    state = js("""
      const a = document.querySelector('[data-entry-card] textarea');
      if (!a) return {ok:false};
      return {ok: document.activeElement === a, tag: document.activeElement?.tagName};
    """)
    print("edit mode:", state)
    if not state.get("ok"):
        print("could not enter the rewrite — aborting"); req("DELETE", p); return

    # four short paragraphs at the reported entry's length, so the geometry
    # matches the report
    js("""
      const a = document.querySelector('[data-entry-card] textarea');
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      set.call(a, arguments[0]);
      a.dispatchEvent(new Event('input', {bubbles:true}));
      a.style.height = 'auto'; a.style.height = a.scrollHeight + 'px';
      return true;
    """, [LINES])
    time.sleep(1.5)

    box = js("""
      const a = document.querySelector('[data-entry-card] textarea');
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      return {x:r.x, y:r.y, w:r.width, h:r.height, line: parseFloat(cs.lineHeight),
              pad: parseFloat(cs.paddingTop), scrollH: a.scrollHeight,
              clientH: a.clientHeight, len: a.value.length};
    """)
    print("textarea box:", {k: round(v, 1) if isinstance(v, float) else v
                            for k, v in box.items()})

    # --- the drag: start mid first line, walk straight down ----------------
    x = box["x"] + box["w"] * 0.45
    y0 = box["y"] + box["pad"] + box["line"] * 0.5
    steps = [0, 6, 14, 24, 36, 50, 66, 84, 104, 126, 150]

    def run_drag(label, target):
        js(f"""
          const a = {target};
          a.focus(); a.setSelectionRange(0, 16);
          return true;
        """)
        move(x, y0)
        move(x, y0, down=True)
        out = []
        for dy in steps:
            move(x, y0 + dy)
            time.sleep(0.12)
            s = js(f"""
              const a = {target};
              const el = document.elementFromPoint(arguments[0], arguments[1]);
              return {{end: a.selectionEnd, start: a.selectionStart,
                       hit: el ? (el.tagName + (el.dataset && el.dataset.entryCard !== undefined
                            ? '[data-entry-card]' : '') +
                            (el.className && el.className.baseVal === undefined
                             ? '.' + String(el.className).split(' ').slice(0,2).join('.') : '')) : null,
                       us: el ? getComputedStyle(el).webkitUserSelect : null}};
            """, [int(x), int(y0 + dy)])
            out.append((dy, s))
        move(x, y0 + steps[-1], down=False)
        print(f"\n--- {label} ---")
        for dy, s in out:
            print(f"  +{dy:3d}px  selEnd={s['end']:<4} hit={s['hit']}  user-select={s['us']}")
        grew = out[-1][1]["end"] > out[0][1]["end"]
        print(f"  => extended downward: {grew}")
        return grew, out

    app_ok, app_rows = run_drag("APP entry editor", "document.querySelector('[data-entry-card] textarea')")

    # control: a bare textarea with the same words, outside the card
    js("""
      const a = document.createElement('textarea');
      a.id = 'ctrl'; a.value = arguments[0];
      a.style.cssText = 'position:fixed;left:8px;top:8px;width:340px;height:300px;'
        + 'z-index:99999;font:16px serif;line-height:1.5;padding:12px;background:#fff';
      document.body.appendChild(a);
      return true;
    """, [LINES])
    time.sleep(0.6)
    cbox = js("""const r = document.getElementById('ctrl').getBoundingClientRect();
                 return {x:r.x, y:r.y, w:r.width};""")
    x = cbox["x"] + cbox["w"] * 0.45
    y0 = cbox["y"] + 12 + 12
    ctl_ok, _ = run_drag("CONTROL bare textarea", "document.getElementById('ctrl')")

    req("DELETE", p)
    print("\n=== verdict ===")
    print(f"app editor extends downward:   {app_ok}")
    print(f"bare textarea extends downward: {ctl_ok}")
    if ctl_ok and not app_ok:
        print("REPRODUCED: something in the app's DOM refuses the downward extend.")
    elif app_ok and ctl_ok:
        print("Both extend — a mouse drag does not reproduce it; the iOS handle "
              "drag differs (see the elementFromPoint/user-select column above).")
    return 0 if app_ok else 1


if __name__ == "__main__":
    sys.exit(main() or 0)
