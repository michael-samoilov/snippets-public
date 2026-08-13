"""
The no-window harness: proves in a real browser that a signed-in book
never pushes plaintext — not before enrollment (no push AT ALL), not
after (format 3 only, sentinel never on the wire) — and that a second
device lands locked, pulls nothing until unlocked, and then decrypts
the first device's real ciphertext with the real passphrase.

The app is real (production build, real sync engine, real WebCrypto);
only the SERVER is stubbed at the network layer, which is exactly the
right paranoia: a client that can be coaxed into plaintext by server
answers would be caught here, because the stub can answer anything and
the sentinel scan covers every request body on every host.

Run:
  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "node_modules/.bin/next start" --port 3000 -- \
    python3 tests/e2e/forced_e2e.py
"""

import json
import sys
import time

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
SENTINEL = "CANARY7F3A the moment most worth telling"
PASSPHRASE = "vermilion stapler galaxy of quiet horses"
SHOTS = "tests/e2e/shots"

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

state = {
    "signed_in": False,
    "keys": None,      # wrapped-key envelopes captured from the PUT
    "pushes": [],      # parsed /api/sync/push bodies, in order
    "pulls": 0,
    "rows": [],        # the "server copy": rows exactly as pushed
    "bodies": [],      # (url, body) for EVERY request with a body, any host
}

failures = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


def wire(context):
    # the preview auto-seeder (lib/dev-seed) fills an empty book with ~1000
    # demo entries on non-prod hosts — its own "cleared" sentinel disables
    # that, keeping this harness's book exactly the entries it creates
    context.add_init_script(
        'try { localStorage.setItem("devSeed:v1", "cleared") } catch {}'
    )

    def handle(route):
        req = route.request
        url = req.url
        body = req.post_data or ""
        if body:
            state["bodies"].append((url, body))

        if "/api/auth/" in url:
            if "get-session" in url:
                if state["signed_in"]:
                    route.fulfill(
                        status=200,
                        content_type="application/json",
                        body=json.dumps(SESSION),
                    )
                else:
                    route.fulfill(
                        status=200, content_type="application/json", body="null"
                    )
            else:
                route.fulfill(status=404, json={"error": "stubbed"})
            return
        if "/api/keys" in url:
            if req.method == "PUT":
                state["keys"] = json.loads(body)
                route.fulfill(json={"ok": True})
            elif state["keys"] is None:
                route.fulfill(status=404, json={"enrolled": False})
            else:
                route.fulfill(
                    json={"enrolled": True, "keyVersion": 1, **state["keys"]}
                )
            return
        if "/api/sync/push" in url:
            data = json.loads(body)
            state["pushes"].append(data)
            for c in data["changes"]:
                state["rows"] = [r for r in state["rows"] if r["id"] != c["id"]]
                state["rows"].append(dict(c))
            for i, r in enumerate(state["rows"]):
                r["serverSeq"] = i + 1
            route.fulfill(
                json={
                    "results": [
                        {"id": c["id"], "outcome": "applied"}
                        for c in data["changes"]
                    ],
                    "serverNow": int(time.time() * 1000),
                    "maxSeq": len(state["rows"]),
                }
            )
            return
        if "/api/sync/pull" in url:
            state["pulls"] += 1
            route.fulfill(
                json={
                    "rows": state["rows"],
                    "nextCursor": len(state["rows"]),
                    "hasMore": False,
                }
            )
            return
        if "/api/sync/status" in url:
            live = [r for r in state["rows"] if not r.get("deletedAt")]
            route.fulfill(
                json={
                    "entryCount": len(live),
                    "maxSeq": len(state["rows"]),
                    "backup": None,
                }
            )
            return
        # token probes etc. — let the real (unconfigured) server answer 503
        route.fallback()

    context.route("**/api/**", handle)


def sentinel_on_wire():
    return [u for (u, b) in state["bodies"] if SENTINEL in b]


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ── Device A: capture signed out, then sign in ────────────────
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 900}, service_workers="block"
        )
        wire(ctx)
        page = ctx.new_page()
        page.goto(f"{BASE}/calendar")
        area = page.locator("textarea").first
        area.wait_for(state="visible")
        area.click(force=True)
        area.fill(SENTINEL)
        page.get_by_role("button", name="Keep today's entry").click(force=True)
        page.wait_for_timeout(1500)
        check("signed out: no sync traffic at all", state["pushes"] == [] and state["pulls"] == 0)

        # sign in (stub flips) — the historical race moment: the whole book
        # is dirty and a session just landed
        state["signed_in"] = True
        page.reload()
        page.wait_for_timeout(9000)  # far longer than the old race needed
        check("pre-enrollment: ZERO pushes", len(state["pushes"]) == 0,
              f"pushes={len(state['pushes'])}")
        check("pre-enrollment: ZERO pulls (book fully held)", state["pulls"] == 0)
        check("pre-enrollment: sentinel never on the wire", sentinel_on_wire() == [])
        letter = page.get_by_text("one step left")
        check("needs-setup letter shows", letter.count() > 0)
        page.screenshot(path=f"{SHOTS}/a1-needs-setup-letter.png")

        # ── Enrollment via the welcome step ───────────────────────────
        page.goto(f"{BASE}/welcome")
        page.locator("#e2e-pass").wait_for(state="visible")
        page.screenshot(path=f"{SHOTS}/a2-welcome-enroll.png")
        page.locator("#e2e-pass").fill(PASSPHRASE)
        page.locator("#e2e-confirm").fill(PASSPHRASE)
        page.get_by_role("button", name="Encrypt my entries").click(force=True)
        code_el = page.locator("p.voice-data.select-all")
        code_el.wait_for(state="visible", timeout=30000)
        recovery_code = code_el.inner_text().strip()
        check("recovery code shown once, 25 chars grouped by 5",
              len(recovery_code.replace("-", "")) == 25, recovery_code)
        check("escape link hidden while the code is on screen",
              page.get_by_text("Later — until then").count() == 0)
        page.screenshot(path=f"{SHOTS}/a3-welcome-recovery-code.png")
        # the action row is inert for RECOVERY_ARM_MS after the code appears, so
        # a stale tap can't burn a once-only code (see tests/e2e/recovery_guard.py).
        # The screenshot above already outlasts it, but wait explicitly rather
        # than depend on how long a screenshot happens to take.
        page.wait_for_selector("div[inert]", state="detached", timeout=5000)
        page.get_by_role("button", name="I’ve saved it").click(force=True)
        page.wait_for_url("**/calendar**")

        # the enroll sweep re-dirtied the book; its push follows
        deadline = time.time() + 20
        while not state["pushes"] and time.time() < deadline:
            page.wait_for_timeout(250)
        check("post-enrollment: the book pushed", len(state["pushes"]) > 0)
        all_changes = [c for push in state["pushes"] for c in push["changes"]]
        check("every pushed change is format 3",
              all(c["payloadFormat"] == 3 for c in all_changes),
              f"{len(all_changes)} changes")
        check("every payload is a bare {v:1,iv,ct} envelope",
              all(set(c["payload"].keys()) == {"v", "iv", "ct"}
                  and c["payload"]["v"] == 1 for c in all_changes))
        check("sentinel STILL never on the wire", sentinel_on_wire() == [],
              "; ".join(sentinel_on_wire()[:2]))
        page.wait_for_timeout(1500)
        check("letter retired after enrollment",
              page.get_by_text("one step left").count() == 0)
        check("the entry survives locally",
              page.get_by_text("CANARY7F3A").count() > 0)
        ctx.close()

        # ── Device B: fresh profile, same account → locked, then unlock ──
        pulls_before = state["pulls"]
        ctx2 = browser.new_context(
            viewport={"width": 1280, "height": 900}, service_workers="block"
        )
        wire(ctx2)
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/calendar")
        page2.wait_for_timeout(6000)
        check("device B lands locked (letter shows)",
              page2.get_by_text("Welcome back").count() > 0)
        check("device B pulled NOTHING while locked", state["pulls"] == pulls_before)
        check("device B pushed nothing", sentinel_on_wire() == [])
        page2.screenshot(path=f"{SHOTS}/b1-locked-letter.png")

        page2.goto(f"{BASE}/settings?tab=account&unlock=1")
        unlock_input = page2.get_by_placeholder("Your passphrase")
        unlock_input.wait_for(state="visible")
        page2.screenshot(path=f"{SHOTS}/b2-settings-locked.png")
        unlock_input.fill(PASSPHRASE)
        page2.get_by_role("button", name="Unlock").click(force=True)
        deadline = time.time() + 30
        while state["pulls"] == pulls_before and time.time() < deadline:
            page2.wait_for_timeout(250)
        check("unlock starts the pull", state["pulls"] > pulls_before)
        page2.goto(f"{BASE}/calendar")
        deadline = time.time() + 15
        found = 0
        while time.time() < deadline:
            found = page2.get_by_text("CANARY7F3A").count()
            if found:
                break
            page2.wait_for_timeout(400)
        check("device B decrypts device A's real ciphertext", found > 0)
        page2.screenshot(path=f"{SHOTS}/b3-unlocked-book.png")

        # ── Legacy migration: a plaintext row on the server converges to 3 ──
        # (an account that synced before encryption became part of sign-in
        # has format-1 rows resting server-side; the pull rule re-dirties
        # them so their own next push re-seals them)
        legacy_id = "01H00000000000LEGACYROW1"
        state["rows"].append({
            "id": legacy_id,
            "payloadFormat": 1,
            "payload": {
                "text": "LEGACY-PLAINTEXT a row from before required encryption",
                "kind": None, "tags": [], "capturedAt": 1_690_000_000_000,
                "day": "2023-07-22", "source": "typed", "favorite": 0,
            },
            "updatedAt": 1_690_000_000_500,
            "deletedAt": None,
            "serverSeq": len(state["rows"]) + 1,
        })
        page2.reload()  # boot trigger → cycle: pull the legacy row, re-dirty
        deadline = time.time() + 25
        resealed = None
        while time.time() < deadline:
            for push in state["pushes"]:
                for c in push["changes"]:
                    if c["id"] == legacy_id:
                        resealed = c
            if resealed:
                break
            page2.wait_for_timeout(400)
        check("legacy format-1 row is re-pushed", resealed is not None)
        if resealed:
            check("…as format 3 with a sealed envelope",
                  resealed["payloadFormat"] == 3
                  and set(resealed["payload"].keys()) == {"v", "iv", "ct"})
        server_copy = [r for r in state["rows"] if r["id"] == legacy_id]
        check("…and the server copy is no longer readable",
              server_copy and server_copy[-1]["payloadFormat"] == 3
              and "LEGACY-PLAINTEXT" not in json.dumps(server_copy[-1]["payload"]))
        ctx2.close()

        # ── Wrong passphrase must not unlock ──────────────────────────
        ctx3 = browser.new_context(
            viewport={"width": 1280, "height": 900}, service_workers="block"
        )
        wire(ctx3)
        page3 = ctx3.new_page()
        page3.goto(f"{BASE}/settings?tab=account&unlock=1")
        bad = page3.get_by_placeholder("Your passphrase")
        bad.wait_for(state="visible")
        bad.fill("definitely not the passphrase")
        page3.get_by_role("button", name="Unlock").click(force=True)
        page3.get_by_text("That didn’t open it").wait_for(state="visible", timeout=20000)
        check("a wrong passphrase is refused with the copy's own words", True)
        ctx3.close()

        browser.close()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S): " + ", ".join(failures))
        sys.exit(1)
    print("ALL CHECKS PASSED — no plaintext window, end to end.")


if __name__ == "__main__":
    main()
