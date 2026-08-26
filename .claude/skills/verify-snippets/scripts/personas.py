#!/usr/bin/env python3
"""Browser personas for driving Snippets with Playwright Chromium, plus a doctor.

Import (from the repo root):

    import sys; sys.path.insert(0, ".claude/skills/verify-snippets/scripts")
    from personas import ios_pwa_page, ios_safari_page, chrome_ios_page, \\
        android_chrome_page, persona_report

Doctor (read-only preflight; exit 0 = worth driving):

    python3 .claude/skills/verify-snippets/scripts/personas.py doctor

Four capability personas, all on the Chromium (Blink) engine: ios-pwa,
ios-safari, and chrome-ios differ only in the standalone flag and Web
Speech availability; android-chrome is Blink for real (Chromium IS Blink),
so it is a faithful engine for Android Chrome, not a spoof. The personas
exercise the app's platform-conditional CODE (isIOS / isIOSStandalone /
Web Speech probe in src/hooks/use-speech.ts). They prove nothing about the
WebKit ENGINE — for real WebKit (all iOS browsers) use the WebKitGTK
harness in SKILL.md; for desktop Chrome use plain Chromium; desktop Firefox
(Gecko) is a gated lane (see SKILL.md), no engine installed here.
"""

import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

IOS_PWA_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 "
    "Mobile/15E148 Safari/604.1"
)
CHROME_IOS_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 "
    "Mobile/15E148 Safari/604.1"
)

# iPhone identity: what isIOS() reads (UA rides the context option).
_INIT_IPHONE = """
Object.defineProperty(navigator, 'platform', {get: () => 'iPhone', configurable: true});
Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 5, configurable: true});
"""

# Installed to the home screen: what isIOSStandalone() and any
# display-mode media query read. The matchMedia stub keeps the listener
# API shape so React effects that subscribe don't throw.
_INIT_STANDALONE = """
Object.defineProperty(navigator, 'standalone', {get: () => true, configurable: true});
const __mm = window.matchMedia.bind(window);
window.matchMedia = (q) => {
  if (/display-mode:\\s*standalone/.test(q)) {
    return {matches: true, media: q, onchange: null,
            addEventListener() {}, removeEventListener() {},
            addListener() {}, removeListener() {},
            dispatchEvent: () => false};
  }
  return __mm(q);
};
"""

# In-browser iOS (Safari tab / Chrome iOS): standalone exists and is false.
_INIT_BROWSER = """
Object.defineProperty(navigator, 'standalone', {get: () => false, configurable: true});
"""

# Chrome on iOS ships no Web Speech API; headless Chromium exposes both
# globals, so the persona must remove them or the app's engine probe lies.
_INIT_NO_WEB_SPEECH = """
Object.defineProperty(window, 'SpeechRecognition', {get: () => undefined, configurable: true});
Object.defineProperty(window, 'webkitSpeechRecognition', {get: () => undefined, configurable: true});
"""

ANDROID_CHROME_UA = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36"
)

# Android identity: isIOS() reads platform + touch and must come back false.
_INIT_ANDROID = """
Object.defineProperty(navigator, 'platform', {get: () => 'Linux armv8l', configurable: true});
Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 5, configurable: true});
"""

_VIEWPORT = {"width": 393, "height": 852}


def _page(browser, user_agent, scripts, viewport):
    context = browser.new_context(
        user_agent=user_agent,
        viewport=viewport or _VIEWPORT,
        device_scale_factor=3,
        is_mobile=True,
        has_touch=True,
    )
    for s in scripts:
        context.add_init_script(s)
    return context.new_page()


def ios_pwa_page(browser, viewport=None):
    """The installed home-screen PWA: Safari UA, standalone, display-mode standalone."""
    return _page(browser, IOS_PWA_UA, [_INIT_IPHONE, _INIT_STANDALONE], viewport)


def ios_safari_page(browser, viewport=None):
    """iOS Safari in a browser tab (not installed): Safari UA, standalone
    false, Web Speech present (iOS Safari has webkitSpeechRecognition). This
    is the third iOS profile — same WebKit engine as the PWA and iOS Chrome,
    differing only in the standalone flag and Web Speech availability."""
    return _page(browser, IOS_PWA_UA, [_INIT_IPHONE, _INIT_BROWSER], viewport)


def chrome_ios_page(browser, viewport=None):
    """Chrome on iOS: CriOS UA, not standalone, no Web Speech API."""
    return _page(
        browser, CHROME_IOS_UA, [_INIT_IPHONE, _INIT_BROWSER, _INIT_NO_WEB_SPEECH], viewport
    )


def android_chrome_page(browser, viewport=None):
    """Chrome on Android: real Blink engine (Chromium IS Blink, so this is a
    faithful engine, not a spoof), Android UA/platform, Web Speech present,
    touch. isIOS() reads false here."""
    return _page(browser, ANDROID_CHROME_UA, [_INIT_ANDROID], viewport)


_REPORT_JS = """() => ({
  ua: navigator.userAgent,
  platform: navigator.platform,
  touchPoints: navigator.maxTouchPoints,
  standalone: navigator.standalone,
  displayModeStandalone: matchMedia('(display-mode: standalone)').matches,
  webSpeech: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
})"""


def persona_report(page):
    """The persona as the app sees it — assert on this at the top of a proof."""
    return page.evaluate(_REPORT_JS)


# ── doctor ──────────────────────────────────────────────────────────────

def _check(label, ok, fix=""):
    print(("PASS  " if ok else "FAIL  ") + label + ("" if ok else f"  → {fix}"))
    return ok


def doctor(base="http://127.0.0.1:3000"):
    ok = True

    # 1. Server answering, with the app's signature redirect.
    try:
        r = urllib.request.urlopen(base + "/", timeout=5)
        ok &= _check(
            f"{base} answers and lands on /calendar (got {r.url})",
            r.status == 200 and r.url.endswith("/calendar"),
            "start it: node_modules/.bin/next start (via with_server.py)",
        )
    except (urllib.error.URLError, OSError) as e:
        ok &= _check(f"{base} answers", False, f"not running ({e}); see Launch in SKILL.md")

    # 2. Build freshness: verifying a stale build verifies old code.
    build_id = ".next/BUILD_ID"
    if os.path.exists(build_id):
        built = os.path.getmtime(build_id)
        newest = max(
            (os.path.getmtime(os.path.join(d, f))
             for d, _, fs in os.walk("src") for f in fs),
            default=0,
        )
        ok &= _check(
            ".next build is newer than everything in src/",
            built >= newest,
            "src changed after the build — rerun pnpm build",
        )
    else:
        ok &= _check(".next/BUILD_ID exists", False, "no production build — run pnpm build")

    # 3. Orphaned servers serve stale chunk manifests as mysterious 500s.
    orphans = subprocess.run(
        ["pgrep", "-f", "next[-]server"], capture_output=True, text=True
    ).stdout.split()
    _check(
        f"next-server process count is sane ({len(orphans)} running)",
        len(orphans) <= 1,
        'stranded servers — pkill -9 -f "next[-]server" and relaunch',
    )
    ok &= len(orphans) <= 1

    # 4. Every persona holds on a live page. `want` lists the exact
    #    persona_report values each profile must show.
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return _check("playwright importable", False, "pip install playwright==1.56.0") and ok

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, maker, want in (
            ("ios-pwa", ios_pwa_page,
             {"ua_has": "iPhone", "platform": "iPhone", "touchPoints": 5,
              "standalone": True, "displayModeStandalone": True, "webSpeech": True}),
            ("ios-safari", ios_safari_page,
             {"ua_has": "iPhone", "platform": "iPhone", "touchPoints": 5,
              "standalone": False, "displayModeStandalone": False, "webSpeech": True}),
            ("chrome-ios", chrome_ios_page,
             {"ua_has": "CriOS", "platform": "iPhone", "touchPoints": 5,
              "standalone": False, "displayModeStandalone": False, "webSpeech": False}),
            ("android-chrome", android_chrome_page,
             {"ua_has": "Android", "platform": "Linux armv8l", "touchPoints": 5,
              "standalone": None, "displayModeStandalone": False, "webSpeech": True}),
        ):
            page = maker(browser)
            page.goto("data:text/html,<title>persona</title>")
            rep = persona_report(page)
            good = (
                want["ua_has"] in rep["ua"]
                and rep["platform"] == want["platform"]
                and rep["touchPoints"] == want["touchPoints"]
                and rep["standalone"] == want["standalone"]
                and rep["displayModeStandalone"] == want["displayModeStandalone"]
                and rep["webSpeech"] == want["webSpeech"]
            )
            ok &= _check(f"persona {name} stubs hold", good, json.dumps(rep))
            page.context.close()
        browser.close()

    print("\ndoctor:", "OK — worth driving" if ok else "NOT healthy — fix the FAIL lines first")
    return ok


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "doctor":
        sys.exit(0 if doctor(os.environ.get("BASE_URL", "http://127.0.0.1:3000")) else 1)
    print(__doc__)
    sys.exit(0)
