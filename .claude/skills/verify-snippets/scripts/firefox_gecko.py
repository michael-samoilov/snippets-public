#!/usr/bin/env python3
"""Drive the app on the REAL Gecko engine (Firefox) via geckodriver — the
desktop-Firefox lane. stdlib urllib + geckodriver's W3C WebDriver, same
shape as webkit_session.py; no Selenium dependency.

Status in this sandbox (2026-08): geckodriver downloads fine from GitHub
(allowed), but the Firefox BINARY is blocked — the egress policy denies
download.mozilla.org, archive.mozilla.org, packages.mozilla.org, and
deb.debian.org (403 / connect-rejected), and Ubuntu 24.04 ships Firefox
only as a snap (no apt deb, snap won't run in the container). So this lane
is staged and self-tests its own gating; it runs for real the moment a
Firefox binary is present.

To close the gap, either:
  - point the lane at a Firefox binary you provide: FIREFOX_BIN=/path/to/firefox
  - run it where downloads are allowed (a plain `playwright install firefox`
    or Mozilla's tarball), or have the org egress policy allowlist
    download.mozilla.org.

Usage:
    FIREFOX_BIN=/path/to/firefox \\
      python3 .claude/skills/verify-snippets/scripts/firefox_gecko.py
"""
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request

GECKO_VER = "0.35.0"
GECKO_URL = (f"https://github.com/mozilla/geckodriver/releases/download/"
             f"v{GECKO_VER}/geckodriver-v{GECKO_VER}-linux64.tar.gz")
CACHE = os.path.expanduser("~/.cache/verify-snippets")
PORT = 4600
APP = os.environ.get("BASE_URL", "http://127.0.0.1:3000")


def find_firefox():
    if os.environ.get("FIREFOX_BIN") and os.path.exists(os.environ["FIREFOX_BIN"]):
        return os.environ["FIREFOX_BIN"]
    for name in ("firefox", "firefox-esr"):
        p = shutil.which(name)
        if p:
            return p
    for p in ("/opt/firefox/firefox", "/usr/lib/firefox/firefox"):
        if os.path.exists(p):
            return p
    return None


def ensure_geckodriver():
    if shutil.which("geckodriver"):
        return "geckodriver"
    local = os.path.join(CACHE, "geckodriver")
    if os.path.exists(local):
        return local
    os.makedirs(CACHE, exist_ok=True)
    tgz = os.path.join(CACHE, "geckodriver.tar.gz")
    urllib.request.urlretrieve(GECKO_URL, tgz)   # GitHub is allowed
    with tarfile.open(tgz) as t:
        t.extractall(CACHE)
    os.chmod(local, 0o755)
    return local


def _req(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(base + path, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=90) as resp:
        return json.loads(resp.read())["value"]


def main():
    firefox = find_firefox()
    gecko = ensure_geckodriver()
    print(f"geckodriver: {gecko}  (ready)")
    if not firefox:
        print("firefox binary: NOT FOUND — Gecko lane is staged but cannot run here.")
        print("  reason: egress policy blocks Mozilla/Debian download hosts, and")
        print("          Ubuntu 24.04 has no Firefox apt deb (snap only).")
        print("  fix:    set FIREFOX_BIN=/path/to/firefox, or run where downloads")
        print("          are allowed, or allowlist download.mozilla.org in egress policy.")
        return 2

    print(f"firefox: {firefox}")
    proc = subprocess.Popen([gecko, "--port", str(PORT)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{PORT}"
    try:
        for _ in range(20):
            try:
                urllib.request.urlopen(base + "/status", timeout=2); break
            except Exception:
                time.sleep(0.5)
        sess = _req(base, "POST", "/session", {"capabilities": {"alwaysMatch": {
            "browserName": "firefox",
            "moz:firefoxOptions": {"binary": firefox, "args": ["-headless"]}}}})
        sid = sess["sessionId"]
        p = f"/session/{sid}"
        _req(base, "POST", p + "/window/rect", {"width": 1280, "height": 800})
        _req(base, "POST", p + "/url", {"url": f"{APP}/calendar?seed=40&years=1"})
        days = 0
        for _ in range(20):
            time.sleep(2)
            days = _req(base, "POST", p + "/execute/sync",
                        {"script": "return document.querySelectorAll('[data-day]').length", "args": []}) or 0
            if days >= 10:
                break
        out = os.environ.get("EVIDENCE_DIR", "/tmp/verify-snippets") + "/firefox-gecko"
        os.makedirs(out, exist_ok=True)
        import base64
        png = _req(base, "GET", p + "/screenshot", None)
        open(out + "/calendar.png", "wb").write(base64.b64decode(png))
        _req(base, "DELETE", p)
        print(json.dumps({"engine": "gecko", "days_rendered": days,
                          "screenshot": out + "/calendar.png"}, indent=2))
        print("PASS" if days else "FAIL")
        return 0 if days else 1
    finally:
        proc.terminate()


if __name__ == "__main__":
    sys.exit(main())
