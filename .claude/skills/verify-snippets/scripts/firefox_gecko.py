#!/usr/bin/env python3
"""Drive the app on the REAL Gecko engine (Firefox) via geckodriver — the
desktop-Firefox lane. stdlib urllib + geckodriver's W3C WebDriver, same
shape as webkit_session.py; no Selenium dependency.

Self-provisioning: it downloads geckodriver (GitHub) and Firefox (Mozilla)
into ~/.cache/verify-snippets and runs hands-off. Firefox needs two egress
hosts allowlisted — `download.mozilla.org` (the redirector) and
`download-installer.cdn.mozilla.net` (the file CDN). Both were added to the
environment's network policy on 2026-08-26; if a future session gets a 403,
the policy was reset — re-add those two hosts. `FIREFOX_BIN=/path` overrides
the download.

Verified 2026-08-26: drove the app on real Firefox 154, 36 seeded days.

Usage:
    python3 .claude/skills/verify-snippets/scripts/firefox_gecko.py
    # or, with your own binary:
    FIREFOX_BIN=/path/to/firefox python3 .../firefox_gecko.py
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
FIREFOX_URL = ("https://download.mozilla.org/"
               "?product=firefox-latest-ssl&os=linux64&lang=en-US")
CACHE = os.path.expanduser("~/.cache/verify-snippets")
PORT = 4600
APP = os.environ.get("BASE_URL", "http://127.0.0.1:3000")


def find_firefox():
    """Locate a Firefox binary, downloading Mozilla's official build if none
    is present. Returns a path, or None if the download is egress-blocked."""
    if os.environ.get("FIREFOX_BIN") and os.path.exists(os.environ["FIREFOX_BIN"]):
        return os.environ["FIREFOX_BIN"]
    for name in ("firefox", "firefox-esr"):
        p = shutil.which(name)
        if p:
            return p
    for p in ("/opt/firefox/firefox", "/usr/lib/firefox/firefox",
              os.path.join(CACHE, "firefox", "firefox")):
        if os.path.exists(p):
            return p
    # download Mozilla's official tarball (needs the two hosts allowlisted).
    # curl handles the 87 MB through the proxy far more reliably than
    # urllib.urlretrieve, which truncates on a dropped connection.
    os.makedirs(CACHE, exist_ok=True)
    tzx = os.path.join(CACHE, "firefox.tar.xz")
    if not _download(FIREFOX_URL, tzx):
        print("firefox download failed — is the egress policy allowing")
        print("  download.mozilla.org AND download-installer.cdn.mozilla.net?")
        return None
    with tarfile.open(tzx, "r:xz") as t:
        t.extractall(CACHE)
    local = os.path.join(CACHE, "firefox", "firefox")
    return local if os.path.exists(local) else None


def _download(url, dest):
    """Fetch a URL to dest robustly. Prefer curl (retries, resumes, follows
    redirects through the proxy); fall back to urllib. Returns True on a
    complete file."""
    if shutil.which("curl"):
        r = subprocess.run(["curl", "-sSL", "--retry", "4", "--retry-delay", "2",
                            "-C", "-", "-o", dest, url])
        if r.returncode == 0 and os.path.getsize(dest) > 50_000_000:
            return True
    for _ in range(3):
        try:
            urllib.request.urlretrieve(url, dest)
            if os.path.getsize(dest) > 50_000_000:
                return True
        except Exception:
            pass
    return False


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
        print("firefox binary: unavailable — download blocked or extract failed.")
        print("  fix: allowlist download.mozilla.org AND")
        print("       download-installer.cdn.mozilla.net in the egress policy,")
        print("       or set FIREFOX_BIN=/path/to/firefox.")
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
