"""
The recovery-code tap guard, observed in a real browser.

The recovery code is shown exactly once and cannot be reconstructed, so
"I've saved it" is the most expensive control in the app to hit by
accident. It appears in the screen the submit button just occupied, with
no transition between them, so a tap already travelling toward "Encrypt
my entries" lands on it. EnrollFlow therefore mounts the action row
`inert` for RECOVERY_ARM_MS (400ms).

This proves three things, in both of EnrollFlow's homes (the /welcome
step and the Settings dialog):

  1. the row really is inert the moment the code appears;
  2. it is absent from the accessibility tree while inert;
  3. a REAL tap inside the window does not dismiss the code, and the
     same tap after the window does.

Note (2)/(3) need real input events. `HTMLElement.click()` still fires
handlers inside an inert subtree — `inert` blocks USER interaction — so
this drives page.mouse, never an evaluated .click(). A test that clicked
programmatically would pass against a guard that does nothing.

Run:
  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "node_modules/.bin/next start" --port 3000 -- \
    python3 tests/e2e/recovery_guard.py
"""

import json
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
PASSPHRASE = "vermilion stapler galaxy of quiet horses"
ARM_MS = 400  # must mirror RECOVERY_ARM_MS in enroll-flow.tsx
DONE = "I’ve saved it"  # curly apostrophe, as copy.ts writes it

SESSION = {
    "session": {
        "id": "sess-test-1",
        "userId": "u-test-1",
        "expiresAt": "2027-01-01T00:00:00.000Z",
    },
    "user": {
        "id": "u-test-1",
        "name": "Test Writer",
        "email": "writer@example.com",
        "emailVerified": True,
        "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
    },
}

failures = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


def wire(context):
    """Minimal server stub: a signed-in session and a never-enrolled account."""
    context.add_init_script(
        'try { localStorage.setItem("devSeed:v1", "cleared") } catch {}'
    )
    state = {"keys": None}

    def handle(route):
        req = route.request
        url = req.url
        if "/api/auth/" in url:
            if "get-session" in url:
                route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(SESSION),
                )
            else:
                route.fulfill(status=404, json={"error": "stubbed"})
            return
        if "/api/keys" in url:
            if req.method == "PUT":
                state["keys"] = json.loads(req.post_data or "{}")
                route.fulfill(json={"ok": True})
            elif state["keys"] is None:
                route.fulfill(status=404, json={"enrolled": False})
            else:
                route.fulfill(json={"enrolled": True, "keyVersion": 1, **state["keys"]})
            return
        if "/api/sync/push" in url:
            data = json.loads(req.post_data or "{}")
            route.fulfill(
                json={
                    "results": [
                        {"id": c["id"], "outcome": "applied"} for c in data["changes"]
                    ],
                    "serverNow": int(time.time() * 1000),
                    "maxSeq": 0,
                }
            )
            return
        if "/api/sync/pull" in url:
            route.fulfill(json={"rows": [], "nextCursor": 0, "hasMore": False})
            return
        if "/api/sync/status" in url:
            route.fulfill(json={"entryCount": 0, "maxSeq": 0, "backup": None})
            return
        route.fallback()

    context.route("**/api/**", handle)


# the action row is the flex row holding both buttons; it is the only
# element EnrollFlow marks inert
ROW = "div[inert]"
CODE = "p.voice-data.select-all"


def submit_passphrase(page):
    page.locator("#e2e-pass").wait_for(state="visible", timeout=30000)
    page.locator("#e2e-pass").fill(PASSPHRASE)
    page.locator("#e2e-confirm").fill(PASSPHRASE)
    page.get_by_role("button", name="Encrypt my entries").click(force=True)


def await_code(page):
    """Poll hard so we catch the code's first frame, well inside the window.

    Scrolls the button into view BEFORE measuring: on a 390px viewport the
    recovery screen overflows and the row sits below the fold, so a click at
    its unscrolled coordinates lands outside the viewport and does nothing.
    That made an earlier version of this test pass against no guard at all.
    Callers must also assert the point is on-screen (see `drive`).
    """
    deadline = time.time() + 30
    while time.time() < deadline:
        got = page.evaluate(
            """([rowSel, codeSel, doneLabel]) => {
              const code = document.querySelector(codeSel);
              if (!code) return null;
              const btns = [...document.querySelectorAll('button')];
              const done = btns.find((b) => b.textContent.trim() === doneLabel);
              if (!done) return null;
              done.scrollIntoView({ block: 'center', behavior: 'instant' });
              const r = done.getBoundingClientRect();
              if (!r.width || !r.height) return null;
              return {
                inert: !!document.querySelector(rowSel),
                x: r.x + r.width / 2,
                y: r.y + r.height / 2,
                vw: window.innerWidth,
                vh: window.innerHeight,
              };
            }""",
            [ROW, CODE, DONE],
        )
        if got:
            return time.time(), got
        page.wait_for_timeout(10)
    raise AssertionError("recovery code never appeared")


def drive(page, where):
    """Run the three checks against a mounted EnrollFlow."""
    submit_passphrase(page)
    seen_at, got = await_code(page)

    check(f"{where}: action row is inert the moment the code appears", got["inert"])

    snap = page.accessibility.snapshot() or {}

    def names(node):
        out = [node.get("name", "")]
        for c in node.get("children", []) or []:
            out += names(c)
        return out

    check(
        f"{where}: 'I’ve saved it' absent from the a11y tree while inert",
        DONE not in [n.strip() for n in names(snap)],
    )

    # the tap must actually be able to land, or every behavioural check
    # below passes vacuously
    check(
        f"{where}: the tap point is inside the viewport (test validity)",
        0 <= got["x"] <= got["vw"] and 0 <= got["y"] <= got["vh"],
        f"({got['x']:.0f},{got['y']:.0f}) in {got['vw']}x{got['vh']}",
    )

    # a REAL tap, inside the window
    page.mouse.click(got["x"], got["y"])
    elapsed = (time.time() - seen_at) * 1000
    check(
        f"{where}: the tap landed inside the {ARM_MS}ms window (test validity)",
        elapsed < ARM_MS,
        f"{elapsed:.0f}ms",
    )
    # settle before reading: onDone routes away, so asserting on the DOM in
    # the same tick reads the pre-click render and passes no matter what
    page.wait_for_timeout(400)
    check(
        f"{where}: a tap during the window does NOT dismiss the code",
        page.locator(CODE).count() > 0,
    )

    # …and the same tap once it has settled (re-measure: the guard's release
    # is the only thing that should have changed, so a stale point would
    # weaken the check rather than strengthen it)
    page.wait_for_timeout(ARM_MS)
    check(
        f"{where}: the guard releases (inert gone)",
        page.locator(ROW).count() == 0,
    )
    if page.locator(CODE).count() == 0:
        # the guard already failed above; nothing left to tap
        check(f"{where}: a tap after the window DOES advance", False, "code already gone")
        return
    _, again = await_code(page)
    page.mouse.click(again["x"], again["y"])
    page.wait_for_timeout(1200)
    check(
        f"{where}: a tap after the window DOES advance",
        page.locator(CODE).count() == 0,
    )


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ── home 1: the /welcome step (inline on the sheet) ───────────
        ctx = browser.new_context(
            viewport={"width": 390, "height": 844}, service_workers="block"
        )
        wire(ctx)
        page = ctx.new_page()
        page.goto(f"{BASE}/welcome")
        drive(page, "welcome")
        ctx.close()

        # ── home 2: the Settings dialog ───────────────────────────────
        ctx2 = browser.new_context(
            viewport={"width": 1280, "height": 900}, service_workers="block"
        )
        wire(ctx2)
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/settings?tab=account&seal=1")
        drive(page2, "settings dialog")
        ctx2.close()

        browser.close()

    print()
    if failures:
        print(f"{len(failures)} CHECK(S) FAILED:")
        for f in failures:
            print("  - " + f)
        raise SystemExit(1)
    print("ALL CHECKS PASSED — a stale tap cannot burn the recovery code.")


if __name__ == "__main__":
    main()
