---
name: verify-snippets
description: The single verification skill for Snippets — drive the app the way a reader does, across every surface it ships on, and prove behavior with evidence. Covers all three engines from this Linux sandbox — WebKit (iOS PWA/Safari/Chrome, real via WebKitGTK), Blink (Android and desktop Chrome), and Gecko (desktop Firefox, self-provisioned) — plus a real-iOS lane (device farm, Simulator, or a manual iPhone protocol) for what only exists on a device: touch-scroll momentum, jetsam, safe areas, dictation, install. Use for capture, book navigation, offline, sync/auth/encryption flows, cross-browser checks, and any platform-conditional code path before it ships.
---

# Verify Snippets

The one verification skill for this repo. It drives the app across the
surfaces readers use and captures evidence. Before adding a *second*
verify-* skill, extend this one instead — a new surface is a new persona
or lane here, not a new skill.

## Surfaces and engines — test the engine, not the marketing name

A spoofed user agent does not change the rendering engine, so the six
shipping surfaces collapse onto **three engines** plus a few capability
**personas**. Test where the app's code branches (`isIOS`,
`isIOSStandalone`, the Web Speech probe in `src/hooks/use-speech.ts`) and
where the engine differs — everything else is a viewport or UA variation.

| Surface | Engine | How this skill covers it |
| --- | --- | --- |
| iOS installed PWA | WebKit | `ios_pwa_page` persona for logic; `webkit_session.py` (real WebKit) for engine; device lane for momentum |
| iOS Safari (tab) | WebKit | `ios_safari_page` persona; `webkit_session.py` for the real engine |
| iOS Chrome | WebKit | `chrome_ios_page` persona (no Web Speech); `webkit_session.py` for the real engine |
| Android Chrome | Blink | `android_chrome_page` — **real engine**: Chromium IS Blink, so this is faithful, not a spoof |
| Desktop Chrome | Blink | plain `p.chromium.launch()`, no persona |
| Desktop Firefox | Gecko | `firefox_gecko.py` — real Gecko, self-provisions Firefox + geckodriver; verified on Firefox 154 |

Two things the personas do NOT give you: the WebKit engine (they are all
Blink — use WebKitGTK) and iOS touch physics (device only). The three iOS
personas differ only in the `standalone` flag and Web Speech availability;
they share one engine. This is the answer to "isn't six surfaces too many
to test": it is three engines and five personas, prioritized by where
readers are and where the app has platform-specific code — iOS WebKit
quirks are the repo's whole risk surface (see `CLAUDE.md`).

## Two sandbox harnesses — do not swap them

- **Playwright Chromium + personas** (`scripts/personas.py`) proves
  *correctness* of platform-conditional paths: what the app does when it
  believes it is the PWA, iOS Safari, iOS Chrome, or Android Chrome. Blink
  engine — never use it to price paint or scroll cost.
- **WebKitGTK MiniBrowser over raw WebDriver** is a *real WebKit engine*
  for perf, pathology A/Bs, and real scroll (it catches costs Blink
  hides). Raw W3C WebDriver has no pre-load script injection, so personas
  are unavailable there; it runs as desktop WebKit at a phone viewport.

## Scrolling (measured)

- **WebKitGTK scrolls the real book.** A trusted W3C WebDriver wheel
  action over a `[data-day]` card scrolls the feed (`[data-book-scroller]`)
  and drives the app's scroll logic — measured +16,000px, real scroll
  events, warm window following. `scripts/webkit_wheel_scroll.py`.
- **The Chromium persona synthesizes no scroll at all** (confirmed on a
  plain page, headless and headed, including `gpuBenchmarking`). Move the
  book there with `scrollTop`; drive dive/rise with taps.
- Read `SCHEDULE-MAP.md` (repo root) before any scroll work — it maps the
  app's scroll machinery (~17 guard flags, ~20 timers, one scroller).

## Performance and memory (what helps here, what misleads)

This app's dominant performance risk is iOS memory pressure — the FLAT-BOOK
jetsam class (`globals.css`, `SCHEDULE-MAP.md`). Profile accordingly:

- **Read the app's own instrumentation first.** It emits `performance.mark`
  / `performance.measure` (`zoom-run`, `fx:commitFlush`, `fz:loop`, …). These
  are engine-agnostic and what the authors trust — read them on WebKitGTK
  (`scripts/measure-webkit-spans.py`) and on-device, not just Blink.
- **Frame budget (the 60fps target).** 60fps means the main thread must
  yield every 16.7ms. Any change to the reader's surfaces — capture, the
  book feed, dive/rise, scroll — must be checked for main-thread jank and
  guarded against regressions. `scripts/cdp_frames.py` records long tasks
  and rAF gaps while driving those interactions. It reports by default,
  because the worst long task is usually legitimate month-view mount cost
  (~130-160ms), not scroll — a real 60fps regression is a before/after
  delta, so gate with a baseline or an explicit `JANK_MS`. Honest scope: a
  long synchronous
  task stalls frames on any engine, so this catches jank regressions
  portably; it does NOT certify 60fps on an iPhone — GPU/compositor cost is
  WebKit-specific and headless Blink has no real vsync (its dropped-frame %
  is noise). The true 60fps sign-off is the app's `performance.measure`
  marks read on WebKitGTK plus the on-device pass.
- **CDP memory / leak checks are worth it.** `scripts/cdp_memory.py` stresses
  the book with N rise/dive/scroll cycles and watches CDP
  `Performance.getMetrics` — Nodes, JSEventListeners, JSHeapUsedSize — for
  per-cycle growth at a fixed view state. A JS leak (detached nodes, growing
  listener/timer sets — this app has ~17 guard flags and ~20 timers) ports
  across engines: it would leak on iOS too, so a Blink check is legitimate.
  Verified: listeners and nodes stay flat across cycles today.
- **Chromium CPU traces / flamegraphs mislead here — do not chase the jetsam
  bug with them.** The costs are WebKit-compositor-specific and Blink hides
  them; two optimization rounds tuned on throttled Chromium showed wins that
  never appeared on the iPhone (see `measure-webkit-spans.py`). Paint and
  compositor cost are the WebKitGTK harness's job, and the on-device pass's —
  never a Chromium CPU profile.
- **Full heap snapshots** (CDP `HeapProfiler`, detached-node analysis) are a
  deeper follow-up when `cdp_memory.py` flags growth and you need the
  retaining path; the getMetrics counters catch the regression first.

## Real device only, and the real-iOS lane

**Never claim these from the sandbox:** jetsam / memory kills (the
FLAT-BOOK LAW class), **iOS touch-scroll feel** (momentum, rubber-band —
touch-drag does not synthesize here, and WebKitGTK is desktop under Xvfb,
software-rendered, no idle rAF), `env(safe-area-inset-*)` (headless
reports 0), real Safari dictation, Add to Home Screen, manifest splash,
and keyboard-driven `visualViewport` resizes.

To verify those, use the real-iOS lane, in order of fidelity and effort:

1. **Cloud device farm (recommended for CI).** Drive real Mobile Safari
   or the PWA on a physical iPhone through Appium — genuine `UIScrollView`
   momentum. Reaches this sandbox over the HTTPS proxy; needs an account
   (BrowserStack / Sauce / LambdaTest). Set `APPIUM_URL` and run
   `scripts/appium_scroll.py`. Only this path exercises the momentum
   guard-flag logic and the jetsam class.
2. **iOS Simulator or the owner's iPhone (local, macOS).** The Simulator
   is macOS-only (no `xcrun`/`simctl` on this Linux host), so it runs on
   the owner's Mac via Appium/XCUITest, or a physical iPhone over
   `safaridriver`. Same `scripts/appium_scroll.py` with a local
   `APPIUM_URL`.
3. **Manual iPhone protocol (no account, today).** The owner runs it on a
   real iPhone; each step is an exact action and an unambiguous yes/no:
   1. Flick up, lift — momentum keeps moving and glides to a stop.
   2. No card jump or size-jitter as the fling settles.
   3. Sticky date header tracks month boundaries and lands correct.
   4. Fling to top and bottom — rubber-band settles, no white gap.
   5. Flick rapidly ~30 s on a deep book (`?seed=1200`) — stays
      responsive, never reloads or shows "A problem repeatedly occurred".
   6. Repeat from the installed PWA; then airplane-mode relaunch loads.

   Report the device model and iOS version — the jetsam ceiling is
   device-specific. Nothing in this lane runs in the sandbox by design;
   `appium_scroll.py` is written against the Appium protocol and the app's
   real selectors but is unrun here — first run is on the device/farm.

## Launch

The service worker registers in production builds only
(`src/components/providers.tsx`), and PWA/offline proofs need it, so
verify against a production build:

```sh
pnpm install --frozen-lockfile   # fresh checkouts ship no node_modules
pnpm build   # once per code change; also the de facto typecheck gate
python3 .claude/skills/webapp-testing/scripts/with_server.py \
  --server "node_modules/.bin/next start" --port 3000 -- \
  python3 <your-proof-script>.py
```

Check the build's own exit code, not a piped tail — on a missing install
`pnpm build` prints `next: not found` and a pipe can mask it. The doctor
catches a stale-or-absent `.next` either way. Playwright for Python:
`pip install playwright==1.56.0` (this sandbox pins Chromium 1194 at
`/opt/pw-browsers`; never `playwright install`).

`with_server.py` waits for the port, runs your script, and kills the
server it started. Ready = port 3000 answers; `/` redirects (307) to
`/calendar`. Strand cleanup: `pkill -9 -f "next[-]server"` (the brackets
stop pkill matching itself). Each Playwright context is a fresh profile
(fresh IndexedDB), so parallel pages never share a book; if 3000 is owned
by a server you did not start, use `--port 3010`.

## Doctor

```sh
python3 .claude/skills/verify-snippets/scripts/personas.py doctor
```

Read-only. Reports whether the port answers and redirects, whether
`.next/BUILD_ID` is stale against `src/`, whether a `next-server` orphan
exists, and whether all four persona stubs hold on a live page. Any FAIL
names its fix; exit 0 = worth driving.

## Drive

### Personas

```python
import sys; sys.path.insert(0, ".claude/skills/verify-snippets/scripts")
from personas import (ios_pwa_page, ios_safari_page, chrome_ios_page,
                      android_chrome_page, persona_report)

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = ios_pwa_page(browser)   # or ios_safari_page / chrome_ios_page / android_chrome_page
    page.goto("http://127.0.0.1:3000/calendar?seed=40&years=1", wait_until="load")
    assert persona_report(page)["standalone"] is True   # assert the persona at the top of a proof
```

- `ios_pwa_page` — installed home-screen app: Safari UA, `standalone`
  true, display-mode standalone, Web Speech present.
- `ios_safari_page` — Safari tab: same UA, `standalone` false, Web Speech
  present.
- `chrome_ios_page` — iOS Chrome: `CriOS` UA, `standalone` false, **Web
  Speech removed** (iOS Chrome has none; headless Chromium would leak it).
- `android_chrome_page` — Android Chrome on real Blink: Android UA,
  `platform` `Linux armv8l`, Web Speech present, `isIOS()` false.
- **Desktop Chrome** — no persona; `p.chromium.launch()` with a desktop
  viewport is the real Blink engine.
- **Desktop Firefox (Gecko) — real lane, working.**
  `scripts/firefox_gecko.py` drives the app on real Firefox via
  geckodriver and self-provisions both: geckodriver from GitHub and
  Firefox from Mozilla. Verified — drove the app on Firefox 154, 36 seeded
  days. It needs two egress hosts allowlisted, `download.mozilla.org` and
  `download-installer.cdn.mozilla.net` (added to the environment's network
  policy 2026-08-26); a 403 in a future session means the policy was
  reset — re-add those two hosts, or pass `FIREFOX_BIN=/path/to/firefox`.

Personas accept `viewport=` and stack extra `page.add_init_script(...)`
(speech stubs, failure injection) after creation.

### Real WebKit driving (iOS Safari / iOS PWA / iOS Chrome engine)

The personas are Blink; every iOS browser is WebKit. For iOS *engine*
correctness — layout, selectors, scroll, anything the renderer decides —
drive real WebKit with `scripts/webkit_session.py` (WebKitGTK MiniBrowser
over W3C WebDriver, phone viewport). It navigates, seeds, runs JS, taps,
and screenshots:

```python
from webkit_session import WebKitSession
with WebKitSession() as wk:
    wk.open("/calendar", seed=40, years=1)
    wk.tap("[data-cal-title]")                       # rise to month view
    assert wk.js('return !!document.querySelector("[data-layer=\\"month\\"]")')
```

Needs the driver up (see "The WebKit engine harness" below). Use personas
for identity-conditional CODE, this for the WebKit ENGINE.

### Seeding a book

`/calendar?seed=N&years=Y` builds an N-entry book over Y years, then
strips the param (`src/lib/dev-seed.ts`; refuses on the prod domain; never
replaces a real book without `&force`; `?seed=clear` wipes). After `goto`,
wait ~6 s (or poll `[data-day]` counts) before driving — seed writes land
asynchronously — and settle ~10 s before any navigation, or the reload
comes back to an EMPTY book.

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
| `[data-book-scroller]` | The book feed's scroll container (`data-layer="schedule"`) |
| `[data-day]`, `[data-entry]`, `[data-day][data-warm]` | Book sections, entries, warm render band |
| `[data-cal-title]` | Calendar title — tap to rise to month view |
| `[data-layer="month"] button[data-day-key="YYYY-MM-DD"]` | A day in month view — tap to dive |

React-controlled textareas ignore `.value =`; set through the prototype
setter then dispatch `input` (pattern in `tests/e2e/backfill_keep.py:29`).
Ground truth for storage is IndexedDB: database `snippets`, store
`snippets`, text in `.text` (readout in `backfill_keep.py:38`).

### The WebKit engine harness

For the *engine* (selector scans, paint cost, pointer-events compositing,
layout flush, real scroll):

```sh
apt-get install -y webkit2gtk-driver xvfb          # once per sandbox
xvfb-run -a /usr/bin/WebKitWebDriver --port=4599 &  # keep running
```

`scripts/measure-webkit-spans.py` (repo root) is the complete reference:
raw W3C WebDriver over stdlib urllib. For real scroll,
`scripts/webkit_wheel_scroll.py` drives a trusted wheel over a card and
asserts the warm window follows. Caveats: one session at a time (on
"session already exists": `pkill -9 -f WebKitWebDriver; pkill -9 -f
MiniBrowser`, restart); software-rendered, so paint reads ~5× a real
iPhone (relative A/Bs only); no idle rAF under Xvfb.

## Evidence

Every proof writes to `${EVIDENCE_DIR:-/tmp/verify-snippets}/<run-name>/`
(create it first; it survives cleanup). Standards:

- Find what actually changed before you verify. Diff the served tree
  against `HEAD` (`git status`, `git diff HEAD -- src`) and verify the
  invariants that change touches, not only the concerns the request
  names — a blind eval shipped a planted `.book-card` paint regression
  because the run checked capture, memory, and scroll but never the paint
  invariant the CSS edit broke (see `features/book-navigation.md`).
- Exercise the real user path — the composer and the seal, never `db.ts`
  setters or a test-only endpoint.
- Capture the action *and* the resulting state: a screenshot plus the
  IndexedDB readout proving the row exists (or, for a failure leg, that it
  does not).
- Verify side effects alongside the visible: stored rows, service-worker
  cache contents, console errors collected during the run.
- Screenshot at 393×852; for UI changes, both themes
  (`localStorage.setItem('theme','dark')` + reload) per `CLAUDE.md`.
- Mocks only at boundaries the app already isolates: the Web Speech
  globals and provider token routes. Never mock Dexie writes except to
  *inject* failure (the QuotaExceeded pattern in `backfill_keep.py:82`).

## Cleanup

- `with_server.py` kills the server it started; otherwise kill only what
  you started, by PID. The one sanctioned name-kill is `pkill -9 -f
  "next[-]server"`, after a doctor run shows the orphan is real.
- WebKit runs: `DELETE /session/<id>`, then kill the
  `WebKitWebDriver`/`MiniBrowser` pair you spawned.
- Seeded books live in throwaway profiles; nothing to clean.
- Cleanup never touches `EVIDENCE_DIR` — proofs outlive teardown.

## Helpers

- `scripts/personas.py` — the four personas + `persona_report` + `doctor`
  mode. Executable.
- `scripts/webkit_wheel_scroll.py` — trusted wheel scroll of the book feed
  on real WebKit, asserting the warm window follows. Needs the WebKitGTK
  driver and app server up.
- `scripts/webkit_session.py` — drive the app on the real WebKit engine
  (iOS Safari/PWA/Chrome share it): open/seed, js, tap, screenshot.
  Executable; needs the WebKitGTK driver up.
- `scripts/firefox_gecko.py` — the desktop-Gecko lane via geckodriver.
  Self-bootstraps geckodriver; runs against a Firefox binary
  (`FIREFOX_BIN`) when one is present, else reports the egress block.
- `scripts/cdp_memory.py` — memory-leak regression guard: stresses the
  book and watches CDP `Performance.getMetrics` (Nodes, JSEventListeners,
  JS heap) for per-cycle growth. Run under `with_server.py` or a live :3000.
- `scripts/cdp_frames.py` — frame-budget / main-thread-jank guard for the
  60fps target: long tasks + rAF gaps during the reader's interactions.
  Gates on main-thread blocks; frame-% is informational (headless has no
  vsync). Real 60fps is WebKitGTK marks + on-device.
- `scripts/appium_scroll.py` — the real-iOS lane: a genuine touch fling on
  a device farm or Simulator (`APPIUM_URL`). Unrun in the sandbox by
  design.
- `scripts/probe_scroll.py`, `scripts/probe_scroll_control.py` — the
  Chromium-persona probes that established no synthetic scroll works there.
  Kept as reproducing evidence.

## Feature map

`features/README.md` indexes the mapped features (capture, voice, book
navigation, offline PWA, cross-browser) and names what the map does not
cover. A proof that drives one entry point is incomplete when the map
lists others — read the feature's file first. Keep the map honest with
`/maintain-verification-skill`.
