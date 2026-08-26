---
name: verify-snippets-ios-device
description: Verify Snippets behavior that only exists on real iOS — true thumb-scroll (momentum, rubber-band), the flick-a-deep-book memory/jetsam class, safe-area layout, real Safari dictation, and the Add to Home Screen / PWA install flow. Two lanes: a numbered manual protocol you run on your iPhone, and an Appium scaffold for a real-iOS device farm or the iOS Simulator. Companion to verify-snippets-ios, which covers everything reproducible in the Linux sandbox.
---

# Verify Snippets on real iOS

`verify-snippets-ios` proves everything a Linux sandbox can: iOS-conditional
code paths (Chromium personas), engine cost and wheel-driven scroll
(WebKitGTK). It cannot produce iOS `UIScrollView` momentum, rubber-band,
or the memory pressure of flicking a deep book — those need real iOS.
This skill covers that gap.

**Reach for this when the claim is one of:** true thumb-scroll feel
(momentum and its decel curve, rubber-band overscroll), scroll *stall* or
a crash under a deep-book fling (the FLAT-BOOK LAW jetsam class:
"A problem repeatedly occurred"), `env(safe-area-inset-*)` layout under
the notch / home indicator, real Safari dictation, or the installed-PWA
launch (splash, standalone chrome, offline relaunch).

Read `SCHEDULE-MAP.md` (repo root) first. The book scroller carries ~17
guard flags and ~20 timers whose whole job is to attribute iOS-caused
scrolls — momentum flings, caret auto-scroll, keyboard avoidance. That
logic only fully exercises under a real fling, which is why this lane
exists. The book scroller's stable handle is `[data-book-scroller]`
(under `data-layer="schedule"`).

## Lane A — manual protocol (no account, runs today)

The owner runs this on a physical iPhone. Each step names an exact action
and an unambiguous yes/no observation. Report each as PASS/FAIL with what
you saw.

**Setup.** On the iPhone, open Safari to the deploy URL, seed a deep book
by visiting `/calendar?seed=1200&years=5` (dev/preview only — never the
prod domain; it refuses there), wait until the book fills, then for the
PWA legs add Snippets to the Home Screen and launch it from there.

1. **Momentum exists and decelerates.** Flick up through history, lift
   your thumb. PASS: the book keeps moving after your thumb leaves and
   glides to a smooth stop. FAIL: it stops dead on lift.
2. **No jump or jitter during/after the fling** (SCHEDULE-MAP's core
   complaint). Watch the cards as the fling settles. PASS: no card
   suddenly resizes, and the scroll position does not lurch backward or
   forward as it lands. FAIL: a visible jump or size-jitter.
3. **Sticky date tracks the fling.** As you pass month boundaries, the
   pinned date header updates to the month under the top edge. PASS: it
   keeps up and lands correct. FAIL: it lags, sticks, or shows the wrong
   day at rest.
4. **Rubber-band settles.** Fling hard to the very top (oldest) and to
   the bottom (today). PASS: it overscrolls, bounces, and settles with no
   blank gap and no stuck offset. FAIL: a white gap, a stuck position, or
   the today zone misplaced.
5. **Deep-book endurance (the jetsam test).** Fling rapidly up and down
   many times for ~30 s on the years-deep book. PASS: scrolling stays
   responsive; the app never reloads itself or shows "A problem
   repeatedly occurred". FAIL: momentum stalls, the page blanks/reloads,
   or Safari kills it. (This is the FLAT-BOOK LAW class — report the
   device model and iOS version.)
6. **Installed-PWA legs.** Repeat 1–5 from the Home Screen app. PASS:
   identical behavior in standalone chrome. Then airplane-mode relaunch:
   PASS: it opens and the book renders offline.

State the device model and iOS version with the results — the jetsam
ceiling is device-specific.

## Lane B — automated (Appium; a device farm or the Simulator)

`scripts/appium_scroll.py` drives real Mobile Safari through Appium and
checks the observable state Lane A checks by eye: the warm-window day set
moves after a fling, and no jump lands. It runs against either target;
set the endpoint by environment:

- **Cloud farm (recommended for CI, real devices):**
  `APPIUM_URL=https://<user>:<key>@hub-cloud.browserstack.com/wd/hub`
  plus the farm's device capabilities (a real iPhone, Safari). Reaches
  out over this sandbox's HTTPS proxy. Needs a BrowserStack / Sauce /
  LambdaTest account.
- **Local iOS Simulator (macOS only):** run `appium` locally with the
  XCUITest driver, `APPIUM_URL=http://127.0.0.1:4723`. Real iOS scroll
  physics; runs on the owner's Mac, not in this sandbox.

```sh
pip install Appium-Python-Client==4.*
APPIUM_URL=... APP_URL=https://<deploy>/calendar \
  python3 .claude/skills/verify-snippets-ios-device/scripts/appium_scroll.py
```

The script uses W3C touch actions (`mobile: scroll` / a pointer fling),
not a wheel — on real iOS that produces genuine momentum. It asserts the
`[data-book-scroller]` warm window advances and reads back scrollTop
stability across the settle. Momentum *curve* fidelity and the jetsam
ceiling still want Lane A's human eye on a real device; the automation
catches regressions in the observable scroll-logic outcomes.

**Honesty note:** nothing in this skill can be verified from the Linux
sandbox — that is the point of it. The scaffold is written against the
Appium W3C protocol and the app's real selectors, but it has not been run
here. First execution is on the owner's device or farm; expect to adjust
the device capabilities and the settle timings to the target.

## Cleanup

Lane A leaves a seeded book on the device — reseed with
`?seed=clear` or the owner's real book syncs back. Lane B: the Appium
`driver.quit()` in the scaffold ends the session; a cloud farm reclaims
the device. Evidence (screenshots, the warm-window readouts) goes to
`${EVIDENCE_DIR:-/tmp/verify-snippets-ios}/device/` and survives cleanup.

## Feature map

The `verify-snippets-ios/features/` map applies here too; this skill is
the real-iOS execution lane for its scroll and install rows. Keep both
honest with `/maintain-verification-skill`.
