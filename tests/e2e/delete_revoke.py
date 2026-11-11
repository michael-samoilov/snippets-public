"""
Account deletion hands the server this device's Drive grant to revoke.

After a device adopts its Drive refresh token the server holds none, so
the privacy page's "we also ask Google to revoke this app's access" is
true only if the deleting device sends its own token. This drives the
real Settings danger zone in a production build (session, keys and the
delete route stubbed at the network layer), holds "Hold to delete" for
its full 10 seconds, and reads what the request carried and what the
device kept afterwards.

Run:
  python3 .claude/skills/webapp-testing/scripts/with_server.py \
    --server "node_modules/.bin/next start" --port 3000 -- \
    python3 tests/e2e/delete_revoke.py
"""

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:3000"
DEVICE_TOKEN = "1//device-refresh-token-for-revoke"

SESSION = {
    "session": {"id": "s1", "userId": "u1", "expiresAt": "2027-01-01T00:00:00.000Z"},
    "user": {
        "id": "u1", "name": "Test Writer", "email": "writer@example.com",
        "emailVerified": True, "createdAt": "2026-01-01T00:00:00.000Z",
        "updatedAt": "2026-01-01T00:00:00.000Z",
    },
}

failures = []
deletes = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  ({detail})" if detail else ""))
    if not ok:
        failures.append(name)


def handle(route):
    url = route.request.url
    if "/api/auth/get-session" in url:
        route.fulfill(json=SESSION)
    elif "/api/auth/" in url:
        route.fulfill(json={})
    elif "/api/keys" in url:
        route.fulfill(status=404, json={"enrolled": False})
    elif "/api/account/delete" in url:
        deletes.append(route.request.post_data or "")
        route.fulfill(json={"ok": True})
    elif "/api/sync/status" in url:
        route.fulfill(json={"entryCount": 0, "maxSeq": 0, "backup": None})
    else:
        route.fallback()


META = """async ([op, value]) => {
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open("snippets");
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  const out = await new Promise((res, rej) => {
    const tx = db.transaction("meta", "readwrite");
    const store = tx.objectStore("meta");
    const r = op === "put"
      ? store.put({ key: "drive:refreshToken", value })
      : store.get("drive:refreshToken");
    r.onsuccess = () => res(r.result ?? null);
    r.onerror = () => rej(r.error);
  });
  db.close();
  return out;
}"""


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 900},
                                  service_workers="block")
        ctx.add_init_script('try { localStorage.setItem("devSeed:v1", "cleared") } catch {}')
        ctx.route("**/api/**", handle)
        page = ctx.new_page()
        page.goto(f"{BASE}/settings?tab=account")
        page.get_by_text("Hold to delete").wait_for(state="visible", timeout=20000)
        page.evaluate(META, ["put", DEVICE_TOKEN])
        page.reload()
        button = page.get_by_role("button", name="Hold to delete")
        button.wait_for(state="visible", timeout=20000)
        button.scroll_into_view_if_needed()
        button.hover()
        page.mouse.down()
        page.wait_for_timeout(10_800)
        page.mouse.up()
        page.wait_for_timeout(1500)

        check("the delete request went out once", len(deletes) == 1, f"{len(deletes)}")
        body = json.loads(deletes[0]) if deletes else {}
        check("it carried this device's Drive token for the server to revoke",
              body.get("driveToken") == DEVICE_TOKEN)
        check("the device forgot its Drive token afterwards",
              page.evaluate(META, ["get", None]) is None)
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} FAILURE(S): " + ", ".join(failures))
        sys.exit(1)
    print("ALL CHECKS PASSED — deletion hands the Drive grant over for revocation.")


if __name__ == "__main__":
    main()
