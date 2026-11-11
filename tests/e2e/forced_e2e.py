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

The second device then faces a hostile server: it plants a plaintext
row, replays an older sealed copy, swaps an AAD-less envelope onto a
held entry, sends a payload-less live row, and forges a deletion. Each
leg reads the device's own IndexedDB to prove the entry it holds was
not rearranged (src/lib/sync-wire.ts, adoptServerRow).

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
            # per-row LWW, the real server's one rule (src/lib/merge.ts):
            # the newer updatedAt wins; a losing change comes back
            # "superseded" with the winning row attached. The stub used to
            # apply everything, which hid the client's adoption paths.
            results = []
            for c in data["changes"]:
                existing = next(
                    (r for r in state["rows"] if r["id"] == c["id"]), None)
                if existing and c["updatedAt"] <= existing["updatedAt"]:
                    results.append({"id": c["id"], "outcome": "superseded",
                                    "row": dict(existing)})
                    continue
                state["rows"] = [r for r in state["rows"] if r["id"] != c["id"]]
                state["rows"].append(dict(c))
                results.append({"id": c["id"], "outcome": "applied"})
            for i, r in enumerate(state["rows"]):
                r["serverSeq"] = i + 1
            route.fulfill(
                json={
                    "results": results,
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

        # ── A hostile server, as seen by device B ─────────────────────
        def run_cycle(pg):
            # one boot-triggered cycle: push, then pull, then apply
            before = state["pulls"]
            pg.reload()
            deadline = time.time() + 25
            while state["pulls"] == before and time.time() < deadline:
                pg.wait_for_timeout(250)
            pg.wait_for_timeout(2500)

        def serve(row):
            # the stub's server copy of one id, replaced as a hostile
            # server would: a fresh seq so the feed re-delivers it
            state["rows"] = [r for r in state["rows"] if r["id"] != row["id"]]
            row["serverSeq"] = len(state["rows"]) + 1
            state["rows"].append(row)

        def pushed_as(id_, fmt):
            return [c for push in state["pushes"] for c in push["changes"]
                    if c["id"] == id_ and c["payloadFormat"] == fmt]

        def wait_pushed(pg, id_, fmt):
            deadline = time.time() + 25
            while not pushed_as(id_, fmt) and time.time() < deadline:
                pg.wait_for_timeout(400)
            found = pushed_as(id_, fmt)
            return found[-1] if found else None

        open_db = """const open = () => new Promise((res, rej) => {
              const q = indexedDB.open("snippets");
              q.onsuccess = () => res(q.result);
              q.onerror = () => rej(q.error);
            });"""

        def local_rows(pg):
            return pg.evaluate("""async () => {
              %s
              const db = await open();
              const rows = await new Promise((res) => {
                const g = db.transaction("snippets", "readonly")
                  .objectStore("snippets").getAll();
                g.onsuccess = () => res(g.result);
              });
              db.close();
              return rows;
            }""" % open_db)

        def local_row(pg, id_):
            return next((r for r in local_rows(pg) if r["id"] == id_), None)

        def put_local(pg, row):
            pg.evaluate("""async (row) => {
              %s
              const db = await open();
              await new Promise((res, rej) => {
                const tx = db.transaction("snippets", "readwrite");
                tx.objectStore("snippets").put(row);
                tx.oncomplete = () => res();
                tx.onerror = () => rej(tx.error);
              });
              db.close();
            }""" % open_db, row)

        def seal(pg, id_, updated_at, deleted_at, fmt, payload):
            # an envelope under the account's real book key, sealed in the
            # page (the key is non-extractable but usable): format 3 binds
            # the row's clocks as AAD exactly like aadForRow; format 2 has
            # none. This is what a server that kept old envelopes replays.
            return pg.evaluate("""async (a) => {
              %s
              const db = await open();
              const meta = await new Promise((res) => {
                const g = db.transaction("meta", "readonly")
                  .objectStore("meta").get("e2e:bookKey");
                g.onsuccess = () => res(g.result);
              });
              db.close();
              const iv = crypto.getRandomValues(new Uint8Array(12));
              const params = { name: "AES-GCM", iv };
              if (a.fmt === 3)
                params.additionalData = new TextEncoder().encode(
                  `snippets/aad/v1|${a.id}|${a.updatedAt}|${a.deletedAt ?? ""}|3`);
              const ct = await crypto.subtle.encrypt(
                params, meta.value, new TextEncoder().encode(JSON.stringify(a.payload)));
              const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
              return { v: 1, iv: b64(iv), ct: b64(ct) };
            }""" % open_db, {"id": id_, "updatedAt": updated_at,
                             "deletedAt": deleted_at, "fmt": fmt,
                             "payload": payload})

        def content(text, captured):
            return {"text": text, "kind": None, "tags": [],
                    "capturedAt": captured, "day": "2023-07-22",
                    "source": "typed", "favorite": 0}

        # 1. A planted plaintext (format 1) row is refused. Nothing has
        # been able to write format 1 since 2026-07-23, so a server that
        # serves one is writing on its own — the device never stores it.
        legacy_id = "01H00000000000LEGACYROW1"
        serve({"id": legacy_id, "payloadFormat": 1,
               "payload": content("LEGACY-PLAINTEXT a row the server planted",
                                  1_690_000_000_000),
               "updatedAt": 1_690_000_000_500, "deletedAt": None})
        run_cycle(page2)
        check("planted plaintext row: never stored on the device",
              local_row(page2, legacy_id) is None)
        check("…never pushed back", not [c for push in state["pushes"]
                                         for c in push["changes"]
                                         if c["id"] == legacy_id])
        page2.goto(f"{BASE}/calendar")
        page2.wait_for_timeout(1500)
        check("…and never shown", page2.get_by_text("LEGACY-PLAINTEXT").count() == 0)

        # 2. A legacy AAD-less (format 2) row the device has never held
        # still opens and converges: stored dirty, re-pushed as format 3.
        f2_id = "01H00000000000LEGACYSEAL"
        serve({"id": f2_id, "payloadFormat": 2,
               "payload": seal(page2, f2_id, 1_690_000_000_600, None, 2,
                               content("LEGACY-SEALED a row from before the AAD format",
                                       1_690_000_000_000)),
               "updatedAt": 1_690_000_000_600, "deletedAt": None})
        run_cycle(page2)
        resealed = wait_pushed(page2, f2_id, 3)
        check("legacy format-2 row is re-pushed as format 3",
              resealed is not None
              and set(resealed["payload"].keys()) == {"v", "iv", "ct"})
        f2_row = local_row(page2, f2_id)
        check("…and opens on the device",
              f2_row is not None and "LEGACY-SEALED" in f2_row["text"])

        # 3. Contested: an unsent local edit (Restore-from-JSON shape:
        # dirty, the archive's old clock) meets a NEWER plaintext server
        # row. The plaintext copy is refused, so the device's own edit
        # re-asserts past it and its format-3 push replaces it.
        contested_id = "01H00000000000CONTESTED1"
        put_local(page2, {
            **content("STALE-LOCAL-DRAFT from a restored archive", 1_690_000_100_000),
            "id": contested_id, "updatedAt": 1_690_000_100_000, "_dirty": 1})
        serve({"id": contested_id, "payloadFormat": 1,
               "payload": content("CONTESTED-PLAINTEXT a newer readable copy",
                                  1_690_000_200_000),
               "updatedAt": 1_690_000_200_000, "deletedAt": None})
        run_cycle(page2)
        resealed2 = wait_pushed(page2, contested_id, 3)
        check("contested: the device's edit is pushed as format 3", resealed2 is not None
              and set(resealed2["payload"].keys()) == {"v", "iv", "ct"})
        server_copy2 = [r for r in state["rows"] if r["id"] == contested_id]
        check("…the server copy is no longer readable",
              bool(server_copy2) and server_copy2[-1]["payloadFormat"] == 3
              and "CONTESTED-PLAINTEXT" not in json.dumps(server_copy2[-1]["payload"]))
        contested_row = local_row(page2, contested_id)
        check("…and the refused plaintext never landed on the device",
              contested_row is not None
              and "STALE-LOCAL-DRAFT" in contested_row["text"])

        # 4. Rollback: the server replays an OLDER format-3 copy of an
        # entry the device holds, under the clocks it was sealed with —
        # its AAD verifies, so only the never-go-back rule can refuse it.
        canary = next(r for r in local_rows(page2) if "CANARY7F3A" in r["text"])
        cid, cat = canary["id"], canary["updatedAt"]
        serve({"id": cid, "payloadFormat": 3,
               "payload": seal(page2, cid, cat - 1000, None, 3,
                               content("ROLLBACK-OLD an earlier version", 1_690_000_000_000)),
               "updatedAt": cat - 1000, "deletedAt": None})
        run_cycle(page2)
        row = local_row(page2, cid)
        check("replayed older copy: the held entry keeps its version",
              row is not None and "CANARY7F3A" in row["text"]
              and row["updatedAt"] == cat)

        # 5. Swap: an AAD-less (format 2) envelope with another entry's
        # words, under the held entry's id and a newer clock.
        serve({"id": cid, "payloadFormat": 2,
               "payload": seal(page2, cid, cat + 5000, None, 2,
                               content("SWAPPED-IN words from another entry",
                                       1_690_000_000_000)),
               "updatedAt": cat + 5000, "deletedAt": None})
        run_cycle(page2)
        row = local_row(page2, cid)
        check("format-2 envelope swapped onto a held entry: refused",
              row is not None and "CANARY7F3A" in row["text"])

        # 6. A payload-less row that is not a deletion: no server rule
        # produces one (the scrub nulls only rows deleted 30+ days ago).
        held_f2 = local_row(page2, f2_id)
        serve({"id": f2_id, "payloadFormat": 3, "payload": None,
               "updatedAt": held_f2["updatedAt"] + 1000, "deletedAt": None})
        run_cycle(page2)
        row = local_row(page2, f2_id)
        check("payload-less live row: refused, the entry stays live",
              row is not None and "deletedAt" not in row
              and "LEGACY-SEALED" in row["text"])

        # 7. A forged deletion: payload-less, so it carries no proof. The
        # entry leaves the book, but its words stay on the device for 30
        # days from NOW (Settings → Recently let go), not from a clock the
        # server chose.
        t_forged = int(time.time() * 1000)
        serve({"id": cid, "payloadFormat": 3, "payload": None,
               "updatedAt": cat + 10_000, "deletedAt": 1_600_000_000_000})
        run_cycle(page2)
        row = local_row(page2, cid)
        check("forged deletion: the entry is hidden",
              row is not None and row.get("deletedAt") is not None)
        check("…but its words stay on the device",
              row is not None and "CANARY7F3A" in row["text"])
        check("…restorable for 30 days from now, not the server's clock",
              row is not None and (row.get("deletedAt") or 0) >= t_forged - 60_000)
        page2.goto(f"{BASE}/settings?tab=account")
        page2.wait_for_timeout(2500)
        page2.screenshot(path=f"{SHOTS}/b4-forged-deletion-recoverable.png", full_page=True)
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
