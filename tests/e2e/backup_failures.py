"""
The backup-failure harness: proves in a real browser that a failed Drive
delivery reaches Settings as its true cause and the one action that fixes
it, that a just-saved entry is delivered without waiting out the hourly
gap, and that the Settings line follows a delivery the moment it lands.

The app is real (production build, real sync engine, real Drive client);
the Snippets server and Google are stubbed at the network layer. The
stub's ledger mirrors the /api/backup/* routes, and its status route
reads the ledger line through the REAL classifyBackupError
(tests/e2e/backup_classify.mjs), so the cause on screen is the one
production would print. Google's error bodies are Google's documented
shapes (classic errors[].reason and the newer ErrorInfo details[]).

Run:
  python3 .claude/skills/webapp-testing/scripts/with_server.py \\
    --server "node_modules/.bin/next start" --port 3000 -- \\
    python3 tests/e2e/backup_failures.py [--before]

--before runs the scenarios an older build can take (no cause lines
exist there) and RECORDS what it observes instead of asserting, for a
before/after comparison. Screenshots land in $BACKUP_SHOTS
(default tests/e2e/shots/backup).
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
BEFORE = "--before" in sys.argv
SHOTS = os.environ.get("BACKUP_SHOTS", "tests/e2e/shots/backup")
PASSPHRASE = "vermilion stapler galaxy of quiet horses"
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, PATCH, OPTIONS"}

SESSION = {
    "session": {"id": "sess-b-1", "userId": "u-b-1",
                "expiresAt": "2027-01-01T00:00:00.000Z"},
    "user": {"id": "u-b-1", "name": "Test Writer", "email": "writer@example.com",
             "emailVerified": True, "createdAt": "2026-01-01T00:00:00.000Z",
             "updatedAt": "2026-01-01T00:00:00.000Z"},
}

# Google's own error bodies, per failure mode
DRIVE_ERRORS = {
    "storage": (403, {"error": {"code": 403,
        "message": "The user's Drive storage quota has been exceeded.",
        "errors": [{"domain": "usageLimits", "reason": "storageQuotaExceeded",
                    "message": "The user's Drive storage quota has been exceeded."}]}}),
    "rate": (403, {"error": {"code": 403, "message": "User Rate Limit Exceeded.",
        "errors": [{"domain": "usageLimits", "reason": "userRateLimitExceeded",
                    "message": "User Rate Limit Exceeded."}]}}),
    "google": (503, {"error": {"code": 503, "message": "Backend Error",
        "errors": [{"domain": "global", "reason": "backendError",
                    "message": "Backend Error"}]}}),
    "scope": (403, {"error": {"code": 403,
        "message": "Request had insufficient authentication scopes.",
        "status": "PERMISSION_DENIED",
        "details": [{"@type": "type.googleapis.com/google.rpc.ErrorInfo",
                     "reason": "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
                     "domain": "googleapis.com"}]}}),
    "unknown": (400, {"error": {"code": 400,
        "message": "Invalid multipart request with 0 mime parts.",
        "errors": [{"domain": "global", "reason": "badMultipart",
                    "message": "Invalid multipart request with 0 mime parts."}]}}),
}

# what /api/backup/refresh answers, mirroring src/app/api/backup/refresh/route.ts
REFRESH = {
    "ok": None,  # computed: a token that expires at once, so every delivery refreshes
    "revoked": (401, {"error": "revoked", "google": "invalid_grant",
                      "description": "Token has been expired or revoked."}),
    "signed_out": (401, {"error": "signed out"}),
    "bad_client": (502, {"error": "refresh failed", "google": "invalid_client",
                         "description": "The OAuth client was not found."}),
}

state = {
    "signed_in": True, "keys": None, "rows": [], "pushes": 0, "pulls": 0,
    "ledger": None,          # the backup_status row, or None before connect
    "adoptable": False,      # the server holds a refresh token to hand over
    "drive_mode": "ok", "refresh_mode": "ok",
    "events": [],            # ("delivered", seq) | ("failed", line)
    "refresh_bodies": [], "adopts": 0, "held": [],
    "uploads": [],           # (file name, multipart body), in request order
    "drive": {"files": {}, "next": 1},
}
results = []
classifier = None


def check(name, ok, detail=""):
    tag = f"OBSERVED {'yes' if ok else 'no '}" if BEFORE else ("PASS " if ok else "FAIL ")
    print(f"{tag} {name}" + (f"  ({detail})" if detail else ""), flush=True)
    results.append((name, ok, detail))


def classify(line):
    if classifier is None:  # --before: the old build has no cause field
        return None
    classifier.stdin.write(json.dumps(line) + "\n")
    classifier.stdin.flush()
    return json.loads(classifier.stdout.readline())


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def status_backup():
    led = state["ledger"]
    if led is None:
        return None
    max_seq = len(state["rows"])
    err = led["state"] == "error"
    return {
        "state": led["state"],
        "lastSuccessAt": iso(led["lastSuccessAt"]) if led["lastSuccessAt"] else None,
        "consecutiveFailures": led["failures"],
        "behind": max_seq > led["seq"],
        "failure": classify(led["lastError"]) if err else None,
        "failureDetail": led["lastError"] if err else None,
    }


def api(route):
    req = route.request
    url = req.url
    body = req.post_data or ""
    if "/api/auth/" in url:
        if "get-session" in url:
            route.fulfill(json=SESSION if state["signed_in"] else None)
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
            route.fulfill(json={"enrolled": True, "keyVersion": 1, **state["keys"]})
        return
    if "/api/sync/push" in url:
        state["pushes"] += 1
        data = json.loads(body)
        out = []
        for c in data["changes"]:
            state["rows"] = [r for r in state["rows"] if r["id"] != c["id"]]
            state["rows"].append(dict(c))
            out.append({"id": c["id"], "outcome": "applied"})
        for i, r in enumerate(state["rows"]):
            r["serverSeq"] = i + 1
        route.fulfill(json={"results": out, "serverNow": int(time.time() * 1000),
                            "maxSeq": len(state["rows"])})
        return
    if "/api/sync/pull" in url:
        state["pulls"] += 1
        cursor = int(re.search(r"cursor=(\d+)", url).group(1))
        rows = [r for r in state["rows"] if r["serverSeq"] > cursor]
        route.fulfill(json={"rows": rows, "nextCursor": len(state["rows"]),
                            "hasMore": False})
        return
    if "/api/sync/status" in url:
        live = [r for r in state["rows"] if not r.get("deletedAt")]
        route.fulfill(json={"entryCount": len(live), "maxSeq": len(state["rows"]),
                            "backup": status_backup()})
        return
    if "/api/backup/connect" in url:
        led = state["ledger"] or {"seq": 0, "lastSuccessAt": None}
        state["ledger"] = {**led, "state": "active", "failures": 0, "lastError": None}
        state["adoptable"] = True  # the consent left a fresh token server-side
        route.fulfill(json={"ok": True})
        return
    if "/api/backup/adopt" in url:
        state["adopts"] += 1
        if not state["adoptable"]:
            route.fulfill(status=404, json={"error": "no token to adopt"})
            return
        state["adoptable"] = False  # the forgetting is the feature
        route.fulfill(json={"refreshToken": "rt-device-a-0001"})
        return
    if "/api/backup/refresh" in url:
        state["refresh_bodies"].append(json.loads(body))
        mode = REFRESH[state["refresh_mode"]]
        if mode is None:
            route.fulfill(json={"accessToken": f"at-{time.time()}", "expiresIn": 1})
        else:
            route.fulfill(status=mode[0], json=mode[1])
        return
    if "/api/backup/delivered" in url:
        seq = json.loads(body)["seq"]
        state["events"].append(("delivered", seq))
        state["ledger"].update(state="active", seq=seq, failures=0, lastError=None,
                               lastSuccessAt=datetime.now(timezone.utc))
        route.fulfill(json={"ok": True})
        return
    if "/api/backup/failed" in url:
        line = json.loads(body)["error"]
        state["events"].append(("failed", line))
        if state["ledger"]["state"] != "disconnected":
            state["ledger"].update(state="error", lastError=line,
                                   failures=state["ledger"]["failures"] + 1)
        route.fulfill(json={"ok": True})
        return
    route.fallback()  # speech token probes etc. — the real server's 503


def google(route):
    req = route.request
    if req.method == "OPTIONS":
        route.fulfill(status=204, headers=CORS)
        return
    mode = state["drive_mode"]
    if mode == "stall":
        state["held"].append(route)  # answered later by release()
        return
    if mode == "network":
        route.abort("failed")
        return
    if mode in DRIVE_ERRORS:
        status, payload = DRIVE_ERRORS[mode]
        route.fulfill(status=status, headers=CORS, json=payload)
        return
    answer_drive(route)


def answer_drive(route):
    req = route.request
    url = req.url
    files = state["drive"]["files"]

    def new_id():
        state["drive"]["next"] += 1
        return f"FILE{state['drive']['next']}"

    m = re.search(r"/drive/v3/files/([^?/]+)\?", url)
    if req.method == "GET" and m and "/upload/" not in url:
        fid = m.group(1)
        if fid in files:
            route.fulfill(headers=CORS, json={"id": fid, "trashed": False})
        else:
            route.fulfill(status=404, headers=CORS, json={"error": {"code": 404}})
        return
    if req.method == "GET":  # files?q=name = '…'
        name = re.search(r"name = '(.+?)'", requests_unquote(url))
        hit = [fid for fid, n in files.items() if name and n == name.group(1)]
        route.fulfill(headers=CORS, json={"files": [{"id": hit[0]}] if hit else []})
        return
    if req.method == "POST":
        meta = json.loads(req.post_data) if "/upload/" not in url else \
            json.loads(re.search(r"\r\n\r\n(\{.*?\})\r\n", req.post_data).group(1))
        fid = new_id()
        files[fid] = meta["name"]
        if "/upload/" in url:
            state["uploads"].append((meta["name"], req.post_data))
        route.fulfill(headers=CORS, json={"id": fid})
        return
    if req.method == "PATCH":
        fid = re.search(r"/files/([^?]+)\?", url).group(1)
        state["uploads"].append((files.get(fid, fid), req.post_data))
        route.fulfill(headers=CORS, json={"id": fid})
        return
    route.fulfill(status=500, headers=CORS, json={})


def requests_unquote(url):
    from urllib.parse import unquote
    return unquote(url)


def release():
    held, state["held"] = state["held"], []
    for route in held:
        answer_drive(route)


def wait_for(page, pred, timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return True
        page.wait_for_timeout(250)
        if state["drive_mode"] != "stall" and state["held"]:
            release()
    return pred()


def events(kind):
    return [e[1] for e in state["events"] if e[0] == kind]


def write_entry(page, text, navigate=True):
    if navigate:
        page.goto(f"{BASE}/calendar")
    # the today zone's own field; once today holds an entry the page has
    # other textareas ahead of it
    area = page.get_by_role("textbox", name=re.compile(r"^Write an entry for")).first
    area.wait_for(state="visible")
    area.click(force=True)
    area.fill(text)
    page.get_by_role("button", name="Keep today's entry").click(force=True)


def backup_section(page):
    return page.locator('section[aria-label="Backup"]')


def shot(page, name):
    section = backup_section(page)
    section.scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    section.screenshot(path=f"{SHOTS}/{'before' if BEFORE else 'after'}-{name}.png")


def set_theme(page, theme):
    page.evaluate(f"localStorage.setItem('theme', '{theme}')")
    page.reload()


def text_shows(page, text, timeout=20):
    return wait_for(page, lambda: backup_section(page).get_by_text(text).count() > 0,
                    timeout)


# The old build stamps the hourly gap on success and nothing bypasses it,
# so --before clears the stamp to reach a delivery at all; the new build
# never needs this (an undelivered entry bypasses the gap by itself).
CLEAR_GAP = """async () => {
  for (const { name } of await indexedDB.databases()) {
    await new Promise((resolve) => {
      const open = indexedDB.open(name);
      open.onerror = () => resolve();
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains("meta")) { db.close(); return resolve(); }
        const tx = db.transaction("meta", "readwrite");
        tx.objectStore("meta").delete("drive:lastDeliveryAt");
        tx.oncomplete = tx.onerror = () => { db.close(); resolve(); };
      };
    });
  }
}"""


def clear_gap_if_before(page):
    if BEFORE:
        page.evaluate(CLEAR_GAP)


def uploads_since(mark):
    return [name for name, _ in state["uploads"][mark:]]


def backfill_entry(page, day, text):
    """Save an entry on a past day through the day view's composer."""
    page.goto(f"{BASE}/calendar?d={day}")
    area = page.get_by_role("textbox", name=re.compile(r"^Add an entry to")).first
    area.wait_for(state="visible")
    area.click(force=True)
    area.fill(text)
    area.press("Enter")


def failure_round(page, mode, n, *, refresh=False):
    """Make the next delivery fail in `mode`; return its ledger line."""
    if refresh:
        state["refresh_mode"] = mode
    else:
        state["drive_mode"] = mode
    before = len(events("failed"))
    clear_gap_if_before(page)
    write_entry(page, f"entry for the {mode} round {n}")
    wait_for(page, lambda: len(events("failed")) > before)
    lines = events("failed")
    return lines[-1] if len(lines) > before else None


def recover(page):
    state["drive_mode"] = "ok"
    state["refresh_mode"] = "ok"
    before = len(events("delivered"))
    clear_gap_if_before(page)
    page.evaluate("window.dispatchEvent(new Event('online'))")
    return wait_for(page, lambda: len(events("delivered")) > before)


def enroll(page):
    page.goto(f"{BASE}/welcome")
    page.locator("#e2e-pass").wait_for(state="visible")
    page.locator("#e2e-pass").fill(PASSPHRASE)
    page.locator("#e2e-confirm").fill(PASSPHRASE)
    page.get_by_role("button", name="Encrypt my entries").click(force=True)
    try:
        page.locator("p.voice-data.select-all").wait_for(state="visible", timeout=60000)
    except Exception:
        page.screenshot(path=f"{SHOTS}/debug-enroll.png", full_page=True)
        raise
    page.wait_for_selector("div[inert]", state="detached", timeout=5000)
    page.get_by_role("button", name="I’ve saved it").click(force=True)
    page.wait_for_url("**/calendar**")


def main():
    global classifier
    os.makedirs(SHOTS, exist_ok=True)
    if not BEFORE:
        classifier = subprocess.Popen(
            ["node", "tests/e2e/backup_classify.mjs"], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, text=True)
        assert classifier.stdout.readline().strip() == "ready"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 393, "height": 852},
                                  device_scale_factor=2, service_workers="block")
        ctx.add_init_script('try { localStorage.setItem("devSeed:v1", "cleared") } catch {}')
        ctx.route("**/api/**", api)
        ctx.route("https://www.googleapis.com/**", google)
        page = ctx.new_page()

        # ── setup: signed in, encrypted, one entry, Drive connected ─────
        page.goto(f"{BASE}/calendar")
        enroll(page)
        write_entry(page, "the first entry")
        wait_for(page, lambda: state["pushes"] > 0)
        page.goto(f"{BASE}/settings?drive=connected")
        wait_for(page, lambda: len(events("delivered")) >= 1)
        check("connect → first delivery lands", len(events("delivered")) >= 1)
        check("Settings says Backed up once it lands (no reload)",
              text_shows(page, "Sent to your Drive"))
        shot(page, "01-fresh")

        # ── 1. the hourly gap no longer holds a just-saved entry back ───
        before = len(events("delivered"))
        write_entry(page, "saved minutes after a delivery")
        got = wait_for(page, lambda: len(events("delivered")) > before, timeout=20)
        check("an entry saved within the hour is delivered on the next sync",
              got, f"deliveries {before} → {len(events('delivered'))}")

        # ── 2. Drive full: cause, Google's link, no Reconnect ───────────
        line = failure_round(page, "storage", 1)
        check("Drive full → the device reports Google's reason code",
              bool(line) and line.startswith("drive 403 storageQuotaExceeded:"), line)
        page.goto(f"{BASE}/settings")
        if BEFORE:
            text_shows(page, "Backup failing")
            check("Settings line for a full Drive",
                  True, " / ".join(backup_section(page).inner_text().split("\n")))
        else:
            check("Settings names the full Drive",
                  text_shows(page, "Your Google Drive is full"))
            link = backup_section(page).get_by_role("link", name="Manage Google storage")
            check("…and links to Google's storage page",
                  link.count() == 1 and link.get_attribute("href") == "https://one.google.com/storage")
            check("…and does NOT offer Reconnect (it can't help)",
                  backup_section(page).get_by_role("button", name="Reconnect Google Drive").count() == 0)
        shot(page, "02-storage")
        set_theme(page, "dark")
        text_shows(page, "Backup failing")
        shot(page, "02-storage-dark")
        set_theme(page, "light")

        # ── 3. recovery reaches the screen without a reload ─────────────
        text_shows(page, "Backup failing")
        delivered = recover(page)
        page.wait_for_timeout(1500)
        fresh = backup_section(page).get_by_text("Sent to your Drive").count() > 0
        check("after a recovered delivery, Settings flips to Backed up in place",
              delivered and fresh,
              f"delivered={delivered} line={' / '.join(backup_section(page).inner_text().split(chr(10))[1:3])}")

        # ── R1. an entry saved while a delivery runs is not lost ───────
        # (review finding B: the seq was read AFTER the uploads, so the
        # ledger called a mid-delivery entry delivered when it wasn't)
        clear_gap_if_before(page)
        state["drive_mode"] = "stall"
        delivered_before = len(events("delivered"))
        write_entry(page, "entry A, saved before the delivery")
        wait_for(page, lambda: len(state["held"]) > 0)
        pushes = state["pushes"]
        write_entry(page, "entry B, saved DURING the delivery", navigate=False)
        wait_for(page, lambda: state["pushes"] > pushes)
        page.wait_for_timeout(1500)  # B's cycle pulls and settles mid-delivery
        mark = len(state["uploads"])
        state["drive_mode"] = "ok"
        release()
        wait_for(page, lambda: len(events("delivered")) > delivered_before
                 and state["ledger"]["seq"] == len(state["rows"]), timeout=30)
        md_2026 = [b for n, b in state["uploads"][mark:] if n.endswith("2026.md")]
        in_drive = bool(md_2026) and "entry B, saved DURING" in md_2026[-1]
        check("an entry saved mid-delivery reaches Drive, and the ledger says so honestly",
              in_drive and state["ledger"]["seq"] == len(state["rows"]),
              f"entry B in the last 2026.md upload={in_drive}; "
              f"ledger seq={state['ledger']['seq']} of {len(state['rows'])}; "
              f"deliveries +{len(events('delivered')) - delivered_before}")

        if not BEFORE:
            # ── R2. a two-year book: newest year first, unchanged skipped ─
            mark = len(state["uploads"])
            before = len(events("delivered"))
            backfill_entry(page, "2025-03-01", "an entry from March 2025")
            wait_for(page, lambda: len(events("delivered")) > before)
            check("a 2025 entry uploads 2025 and the archive, not the unchanged 2026",
                  uploads_since(mark) == ["Snippets 2025.md", "Snippets archive.json"],
                  str(uploads_since(mark)))
            mark = len(state["uploads"])
            before = len(events("delivered"))
            write_entry(page, "a 2026 entry after the 2025 one")
            wait_for(page, lambda: len(events("delivered")) > before)
            check("a 2026 entry uploads 2026 and the archive, not the unchanged 2025",
                  uploads_since(mark) == ["Snippets 2026.md", "Snippets archive.json"],
                  str(uploads_since(mark)))
            # the hourly delivery (gap elapsed, nothing new) rewrites all, newest first
            mark = len(state["uploads"])
            before = len(events("delivered"))
            page.evaluate(CLEAR_GAP)
            page.evaluate("window.dispatchEvent(new Event('online'))")
            wait_for(page, lambda: len(events("delivered")) > before)
            check("the hourly delivery rewrites every file, newest year first",
                  uploads_since(mark) == ["Snippets 2026.md", "Snippets 2025.md",
                                          "Snippets archive.json"],
                  str(uploads_since(mark)))

            # ── R3. a failure on the device is never blamed on Google ──
            line = "error: UnknownError: Connection to Indexed Database server lost. Refresh the page to try again"
            state["ledger"].update(state="error", lastError=line)
            page.goto(f"{BASE}/settings")
            check("device error: Settings says Google wasn't involved",
                  text_shows(page, "Google wasn’t involved"))
            check("device error: no Google blame, no Reconnect, message shown",
                  backup_section(page).get_by_text("Google Drive refused").count() == 0
                  and backup_section(page).get_by_role("button", name="Reconnect Google Drive").count() == 0
                  and backup_section(page).get_by_text("Connection to Indexed Database").count() > 0)
            shot(page, "03-device")
            state["ledger"].update(state="active", lastError=None)

        if not BEFORE:
            # ── 4. every other cause, as Google reports it ─────────────
            rounds = [
                ("rate", False, "drive 403 userRateLimitExceeded:",
                 "Google limited how often", None),
                ("google", False, "drive 503 backendError:",
                 "Google had a problem on its side", None),
                ("network", False, "network: ",
                 "The connection to Google Drive ended", None),
                ("scope", False, "drive 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT:",
                 "didn’t give Snippets permission", "Reconnect Google Drive"),
                ("unknown", False, "drive 400 badMultipart:",
                 "a message Snippets doesn’t recognize", "Reconnect Google Drive"),
                ("bad_client", True, "refresh 502 invalid_client:",
                 "That’s on our side", None),
            ]
            for n, (mode, via_refresh, prefix, cause_text, button) in enumerate(rounds):
                line = failure_round(page, mode, n, refresh=via_refresh)
                check(f"{mode}: the device reports Google's code",
                      bool(line) and line.startswith(prefix), line)
                page.goto(f"{BASE}/settings")
                check(f"{mode}: Settings names the cause", text_shows(page, cause_text))
                buttons = [b for b in ["Reconnect Google Drive", "Back up from this device too"]
                           if backup_section(page).get_by_role("button", name=b).count()]
                check(f"{mode}: the action is {button or 'none'}",
                      buttons == ([button] if button else []), str(buttons))
                if mode == "unknown":
                    check("unknown: Google's message is shown verbatim",
                          backup_section(page).get_by_text("Invalid multipart request").count() > 0)
                shot(page, f"03-{mode}")
                check(f"{mode}: recovers", recover(page))

        # ── 5. a Snippets session 401 must not destroy the Drive token ──
        line = failure_round(page, "signed_out", 9, refresh=True)
        page.goto(f"{BASE}/settings")
        refreshes = len(state["refresh_bodies"])
        adopts = state["adopts"]
        delivered = recover(page)
        kept = any(b.get("refreshToken") == "rt-device-a-0001"
                   for b in state["refresh_bodies"][refreshes:])
        check("a signed-out 401 leaves the device's Drive token in place",
              delivered and kept,
              f"line={line!r} delivered_after={delivered} token_sent_after={kept} "
              f"adopt_attempts_after={state['adopts'] - adopts}")

        if not BEFORE:
            # ── 6. Google revoked the grant ───────────────────────────
            line = failure_round(page, "revoked", 10, refresh=True)
            check("revoked: the device reports invalid_grant",
                  line == "refresh 401 invalid_grant: Token has been expired or revoked.", line)
            page.goto(f"{BASE}/settings")
            check("revoked: Settings says the permission ended",
                  text_shows(page, "no longer accepts the permission"))
            check("revoked: the action is Reconnect",
                  backup_section(page).get_by_role("button", name="Reconnect Google Drive").count() == 1)
            shot(page, "04-revoked")

            # ── 7. behind: nothing failed, a delivery is in flight ─────
            # (reconnect, then a ledger quiet for 4 days with entries waiting)
            state["refresh_mode"] = "ok"
            state["drive_mode"] = "stall"
            state["ledger"]["lastSuccessAt"] = datetime.now(timezone.utc) - timedelta(days=4)
            page.goto(f"{BASE}/settings?drive=connected")
            check("behind: Settings says Backup behind, not failing",
                  text_shows(page, "Backup behind"))
            check("behind: this device is told it is the one delivering",
                  text_shows(page, "This device backs up"))
            shot(page, "05-behind-this-device")
            state["drive_mode"] = "ok"
            release()
            check("behind → Backed up once the held delivery lands",
                  text_shows(page, "Sent to your Drive"))
        ctx.close()

        # ── 8. behind, seen from a device that holds no Drive grant ─────
        state["adoptable"] = False
        state["ledger"].update(state="active", seq=0, lastError=None,
                               lastSuccessAt=datetime.now(timezone.utc) - timedelta(days=4))
        ctx2 = browser.new_context(viewport={"width": 1280, "height": 900},
                                   service_workers="block")
        ctx2.add_init_script('try { localStorage.setItem("devSeed:v1", "cleared") } catch {}')
        ctx2.route("**/api/**", api)
        ctx2.route("https://www.googleapis.com/**", google)
        page2 = ctx2.new_page()
        page2.goto(f"{BASE}/settings?tab=account&unlock=1")
        unlock = page2.get_by_placeholder("Your passphrase")
        unlock.wait_for(state="visible")
        unlock.fill(PASSPHRASE)
        page2.get_by_role("button", name="Unlock").click(force=True)
        word = "Backup failing" if BEFORE else "Backup behind"
        text_shows(page2, word, timeout=30)
        if BEFORE:
            check("a quiet ledger on a device with no grant",
                  True, " / ".join(backup_section(page2).inner_text().split("\n")))
        else:
            check("no-grant device: says this device doesn't back up yet",
                  text_shows(page2, "This device doesn’t back up yet"))
            check("no-grant device: the action is Back up from this device too",
                  backup_section(page2).get_by_role("button", name="Back up from this device too").count() == 1)
        shot(page2, "06-behind-elsewhere-desktop")
        set_theme(page2, "dark")
        text_shows(page2, word, timeout=30)
        shot(page2, "06-behind-elsewhere-desktop-dark")
        ctx2.close()
        browser.close()

    if classifier:
        classifier.stdin.close()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed"
          + ("" if BEFORE else ("" if not failed else f"; FAILED: {[r[0] for r in failed]}")))
    sys.exit(0 if BEFORE or not failed else 1)


if __name__ == "__main__":
    main()
