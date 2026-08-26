---
name: verify-snippets-ios
description: Drive and verify the Snippets webapp as an iOS reader sees it — the installed home-screen PWA (Safari standalone) and Chrome on iOS — from this Linux sandbox. Use it to prove capture, book navigation, offline behavior, and any iOS-conditional code path before an on-device pass, and to price WebKit-specific costs on a real WebKit engine.
---

# Verify Snippets as an iOS PWA and on Chrome iOS

## What "iOS" means in this sandbox

There is no iOS Simulator here. Two facts make honest iOS verification
possible anyway:

1. **Every iOS browser is WebKit.** Apple requires it, so iOS Safari, the
   installed PWA, and Chrome on iOS share one engine. They differ in UI
   chrome and API surface (user agent, `navigator.standalone`, Web Speech
   availability), not in rendering.
2. **The app's iOS behavior is driven by observable inputs** you can stub:
   `navigator.userAgent`, `navigator.platform`, `navigator.maxTouchPoints`,
   `navigator.standalone`, and `matchMedia("(display-mode: standalone)")`.
   The canonical readers are `isIOS()` and `isIOSStandalone()` in
   `src/hooks/use-speech.ts:81`.

So this skill runs two harnesses with two distinct jobs. Do not swap them:

- **Playwright Chromium + persona init scripts** (`scripts/ios_personas.py`)
  proves *correctness* of iOS-conditional paths: what the app does when it
  believes it is the installed PWA, or Chrome on iOS. Blink engine —
  never use it to price paint or scroll cost.
- **WebKitGTK MiniBrowser over raw WebDriver** is a *real WebKit engine*
  for perf and pathology A/Bs (it has caught costs Blink hides). Raw W3C
  WebDriver has no pre-load script injection, so personas are unavailable
  there; it runs as plain desktop WebKit at a phone viewport.

**Scrolling works, but only on WebKitGTK (measured).** A trusted W3C
WebDriver wheel action scrolls the book feed on real WebKit and drives
the app's scroll logic (warm window follows). The Chromium persona
synthesizes no scroll at all — move the book there with `scrollTop`. Aim
the wheel at a `[data-day]` card, not the today-zone composer overlay.
See `features/book-navigation.md` and `scripts/webkit_wheel_scroll.py`.

**Real device only — never claim these from this sandbox:** jetsam /
memory kills (the FLAT-BOOK LAW class of bug), **iOS touch scroll feel —
momentum and rubber-band** (touch-drag does not synthesize on either
engine, and WebKitGTK is desktop, under Xvfb, software-rendered, no idle
rAF, so its wheel scroll carries no faithful iOS physics),
`env(safe-area-inset-*)` values (headless reports 0), real Safari
dictation, the Add to Home Screen flow, manifest splash screens, and
keyboard-driven `visualViewport` resizes. For those, hand the owner
numbered on-device steps per "Prove the fix" in `CLAUDE.md`.

## Toward true iOS thumb-scroll

Faithful thumb-scroll — iOS `UIScrollView` momentum, rubber-band, and
the memory pressure of flicking a deep book — cannot be produced in this
Linux sandbox. WebKitGTK wheel is the closest local approximation (real
engine, real scroll events, but no momentum). To verify the real thing,
in rough order of fidelity and effort:

1. **Cloud real-iOS device farm (recommended for CI).** Drive real
   Mobile Safari or the installed PWA on a physical iPhone through Appium
   (W3C touch actions → genuine `UIScrollView` momentum) on BrowserStack,
   Sauce Labs, or LambdaTest. Reaches this sandbox over the outbound
   HTTPS proxy; needs an account and credentials. This is the only path
   that exercises the app's momentum guard-flag logic (`SCHEDULE-MAP.md`)
   and the jetsam class of bug.
2. **Owner's own device or the iOS Simulator (local, high fidelity).**
   A physical iPhone over `safaridriver`, or Xcode's iOS Simulator via
   Appium/XCUITest — both real iOS scroll physics, both need macOS, so
   they run on the owner's machine, not here. Good for a pre-ship pass.
3. **WebKitGTK wheel (here, now — logic only).**
   `scripts/webkit_wheel_scroll.py` drives the real engine's scroll
   pipeline and the app's scroll-dependent logic, without momentum. Use
   it for scroll-position regressions between device passes.

If you set up option 1, add a `verify-snippets-ios-device` companion
skill (or a mode here) that speaks the device-farm's Appium endpoint;
keep this skill for the sandbox-local coverage.

## Launch

The service worker registers in production builds only
(`src/components/providers.tsx`), and PWA/offline proofs need it, so
always verify against a production build:

```sh
pnpm install --frozen-lockfile   # fresh checkouts ship no node_modules
pnpm build   # once per code change; also the de facto typecheck gate
python3 .claude/skills/webapp-testing/scripts/with_server.py \
  --server "node_modules/.bin/next start" --port 3000 -- \
  python3 <your-proof-script>.py
```

Check the build's own exit code, not a piped tail of its output — on a
missing install, `pnpm build` prints `next: not found` and a pipe can
mask the failure. The doctor below catches the resulting stale-or-absent
`.next` either way. Playwright for Python: `pip install
playwright==1.56.0` (this sandbox pins Chromium 1194 at
`/opt/pw-browsers`; never `playwright install`).

`with_server.py` waits for the port, runs your script, and kills the
server it started. Ready = port 3000 answers; `/` redirects (307) to
`/calendar`.

Teardown is automatic. If a previous run stranded a server (symptom:
mysterious 500s from stale chunk manifests), clean up with
`pkill -9 -f "next[-]server"` — the brackets stop pkill matching itself.

**Isolation:** every Playwright context is a fresh profile (fresh
IndexedDB), so parallel pages never share a book. The port is the only
shared resource: if 3000 is already owned by a server you did not start,
run on `--port 3010` instead of killing it.

## Doctor

Before driving anything, or whenever behavior looks wrong:

```sh
python3 .claude/skills/verify-snippets-ios/scripts/ios_personas.py doctor
```

Read-only. It reports: whether the port answers and redirects correctly,
whether `.next/BUILD_ID` is stale against `src/` (a stale build silently
verifies old code), whether a `next-server` orphan exists, and whether
both persona stubs hold on a live page (user agent, platform,
`standalone`, display-mode, Web Speech presence). Any FAIL line names its
fix. Exit code 0 = worth driving.

## Drive

### Personas

```python
import sys; sys.path.insert(0, ".claude/skills/verify-snippets-ios/scripts")
from ios_personas import ios_pwa_page, chrome_ios_page

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = ios_pwa_page(browser)      # or chrome_ios_page(browser)
    page.goto("http://127.0.0.1:3000/calendar?seed=40&years=1", wait_until="load")
```

- `ios_pwa_page`: iPhone Safari UA, platform `iPhone`, 5 touch points,
  `navigator.standalone === true`, `display-mode: standalone` matches,
  393×852 at 3× with touch. This is the installed home-screen app.
- `chrome_ios_page`: `CriOS` UA, same platform/touch, `standalone` false,
  browser display-mode, and **Web Speech removed** — Chrome on iOS has no
  `SpeechRecognition`, and headless Chromium would otherwise leak both
  globals into the persona.

Both accept `viewport=`, and stack extra `page.add_init_script(...)`
calls (speech stubs, failure injection) after creation.

### Seeding a book

`/calendar?seed=N&years=Y` builds an N-entry book over Y years, then
strips the param (`src/lib/dev-seed.ts`; refuses to run on the prod
domain; a real book is never replaced without `&force`; `?seed=clear`
wipes). Two waits matter:

- After `goto`, wait ~6 s (or poll `[data-day]` counts) before driving —
  the seed writes land asynchronously.
- The IndexedDB writes lag the paint: navigating away too early reloads
  into an EMPTY book. Poll counts, then settle ~10 s before any
  navigation (see `scripts/measure-webkit-spans.py`).

### Selectors that hold

Prefer these stable handles; never coordinates or tab order.

| Handle | What it is |
| --- | --- |
| `textarea[aria-label^="Write an entry for"]` | Today-zone composer (`copy.todayZone.ariaWriteFor`) |
| `button[aria-label="Keep today's entry"]` | The wax seal once words exist (submit) |
| `button[aria-label="Speak today's entry"]` | The wax seal at rest (starts voice) |
| `[aria-label="Stop listening"]` / `[aria-label="Setting your words"]` | Seal while listening / transcribing |
| Backfill textarea: placeholder matches `/Add a story\|Add something from today/` | The inline invite composer |
| `[aria-label="Keep this"]` | The backfill composer's keep stamp |
| `[data-day]`, `[data-entry]`, `[data-day][data-warm]` | Book sections, entries, warm render band |
| `[data-cal-title]` | Calendar title — tap to rise to month view |
| `[data-layer="month"] button[data-day-key="YYYY-MM-DD"]` | A day in month view — tap to dive |

React-controlled textareas ignore `.value =`; set through the prototype
setter then dispatch `input` (pattern in `tests/e2e/backfill_keep.py:29`).
Ground truth for storage is IndexedDB: database `snippets`, store
`snippets`, text in `.text` (readout snippet in `backfill_keep.py:38`).

### The WebKit engine harness

For anything where the *engine* is the question (selector scans, paint
cost, pointer-events compositing, layout flush timing):

```sh
apt-get install -y webkit2gtk-driver xvfb          # once per sandbox
xvfb-run -a /usr/bin/WebKitWebDriver --port=4599 &  # keep running
```

`scripts/measure-webkit-spans.py` (repo root) is the complete working
reference: raw W3C WebDriver over stdlib urllib — session capabilities,
phone-sized window, seeding, synthetic touch taps, span readouts. Model
new WebKit proofs on it. For real scroll, `scripts/webkit_wheel_scroll.py`
(in this skill) drives a trusted wheel action over a book card and
asserts the warm window follows — the honest "scroll like the iOS engine"
path, since the Chromium persona synthesizes no scroll. Caveats: one session at a time (on "session
already exists": `pkill -9 -f WebKitWebDriver; pkill -9 -f MiniBrowser`,
restart the driver); software-rendered, so paint costs read ~5× a real
iPhone — use for relative A/Bs, not absolute numbers; no rAF ticks while
idle under Xvfb, so rAF-deferred work needs synthetic activity.

## Evidence

Every proof writes to `${EVIDENCE_DIR:-/tmp/verify-snippets-ios}/<run-name>/`
(create it first; it survives all cleanup below). Standards:

- Exercise the real user path — the composer and the seal, never `db.ts`
  setters or a test-only endpoint.
- Capture the action *and* the resulting state: screenshot after the
  keep, plus the IndexedDB readout proving the row exists (or, for a
  failure leg, proving it does not).
- Verify side effects alongside the visible: stored rows, service-worker
  cache contents, console errors collected during the run.
- Screenshot at 393×852; for UI-affecting changes, both themes
  (`localStorage.setItem('theme','dark')` + reload) per `CLAUDE.md`.
- Mocks only at production boundaries the app already isolates: the
  Web Speech globals (stub both `window.SpeechRecognition` and
  `window.webkitSpeechRecognition` via `add_init_script` — Chromium
  exposes both) and provider token routes. Never mock Dexie writes
  except to *inject* failure (the QuotaExceeded pattern in
  `backfill_keep.py:82`).

## Cleanup

- `with_server.py` kills the server it started; kill only what you
  started, by PID — the one sanctioned name-kill is the
  `pkill -9 -f "next[-]server"` orphan idiom above, and only after a
  doctor run shows the orphan is real.
- WebKit runs: delete the WebDriver session (`DELETE /session/<id>`);
  kill the `WebKitWebDriver`/`MiniBrowser` pair you spawned when done.
- Seeded books live in throwaway browser profiles; nothing to clean.
- Cleanup never touches `EVIDENCE_DIR` — proofs outlive the teardown,
  and the run's closing report names the files it left there.

## Helpers

- `scripts/ios_personas.py` — importable personas + `doctor` mode
  (invocations above). Executable; `--help` prints the same.
- `scripts/webkit_wheel_scroll.py` — trusted wheel scroll of the book
  feed on real WebKit, asserting the warm window follows. Executable;
  needs the WebKitGTK driver and app server up (see Drive).
- `scripts/probe_scroll.py`, `scripts/probe_scroll_control.py` — the
  Chromium-persona probes that established no synthetic scroll works
  there. Run under `with_server.py`; kept as reproducing evidence.

## Feature map

`features/README.md` indexes the mapped user-facing features (capture,
voice, book navigation, offline PWA) and names the surfaces the map does
not yet cover. A proof that drives one convenient entry point is
incomplete when the map lists others — check the feature's file for its
sub-features and gotchas first. Keep the map honest with
`/maintain-verification-skill` as the app changes.
