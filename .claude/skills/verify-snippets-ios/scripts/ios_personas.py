#!/usr/bin/env python3
"""iOS personas for driving Snippets with Playwright Chromium, plus a doctor.

Import (from the repo root):

    import sys; sys.path.insert(0, ".claude/skills/verify-snippets-ios/scripts")
    from ios_personas import ios_pwa_page, chrome_ios_page, persona_report

Doctor (read-only preflight; exit 0 = worth driving):

    python3 .claude/skills/verify-snippets-ios/scripts/ios_personas.py doctor

Why stubs and not a simulator: every iOS browser is WebKit, and the app's
iOS-conditional behavior keys off navigator.userAgent / platform /
maxTouchPoints / standalone and the display-mode media query (readers:
isIOS / isIOSStandalone in src/hooks/use-speech.ts). Chromium with these
inputs stubbed proves those code paths; it proves nothing about WebKit
paint cost — use the WebKitGTK harness in SKILL.md for that.
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


def chrome_ios_page(browser, viewport=None):
    """Chrome on iOS: CriOS UA, not standalone, no Web Speech API."""
    return _page(
        browser, CHROME_IOS_UA, [_INIT_IPHONE, _INIT_BROWSER, _INIT_NO_WEB_SPEECH], viewport
    )


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

    # 4. Both personas hold on a live page.
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return _check("playwright importable", False, "pip install playwright==1.56.0") and ok

    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name, maker, want in (
            ("ios-pwa", ios_pwa_page,
             {"standalone": True, "displayModeStandalone": True, "webSpeech": True}),
            ("chrome-ios", chrome_ios_page,
             {"standalone": False, "displayModeStandalone": False, "webSpeech": False}),
        ):
            page = maker(browser)
            page.goto("data:text/html,<title>persona</title>")
            rep = persona_report(page)
            good = (
                "iPhone" in rep["ua"]
                and rep["platform"] == "iPhone"
                and rep["touchPoints"] == 5
                and all(rep[k] == v for k, v in want.items())
                and (("CriOS" in rep["ua"]) == (name == "chrome-ios"))
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
