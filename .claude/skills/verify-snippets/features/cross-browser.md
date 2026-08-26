# Cross-browser and cross-platform

The app ships on six surfaces that reduce to three engines. This file is
the matrix: which persona or harness covers each, what is faithful, and
what is a stand-in. Do not test six surfaces as six harnesses — test the
engine and the capability profile.

## Sub-features (the surface matrix)

| Surface | Engine | Persona / harness | Fidelity |
| --- | --- | --- | --- |
| iOS installed PWA | WebKit | `ios_pwa_page` + `webkit_session.py` | logic faithful; engine real via WebKitGTK; momentum device-only |
| iOS Safari (tab) | WebKit | `ios_safari_page` + `webkit_session.py` | same as PWA, `standalone` false |
| iOS Chrome | WebKit | `chrome_ios_page` + `webkit_session.py` | same engine; no Web Speech |
| Android Chrome | Blink | `android_chrome_page` | **real engine** — Chromium **is** Blink |
| Desktop Chrome | Blink | `p.chromium.launch()` | real engine |
| Desktop Firefox | Gecko | `firefox_gecko.py` | real Gecko; self-provisions Firefox; verified on FF 154 |

## How to get to it (user POV)

Each surface is the same app at a different entry: an installed icon, a
Safari or Chrome tab on a phone, or a desktop browser window. The app
branches on `isIOS()` / `isIOSStandalone()` and the Web Speech probe
(`src/hooks/use-speech.ts`); everything else is layout responding to
viewport.

## Driving it

- **The three iOS personas share one WebKit engine.** They differ only in
  `standalone` (install state) and Web Speech availability. Pick by the
  code path under test: install-only copy → `ios_pwa_page`; the
  "open in Safari for voice" branch → `chrome_ios_page` vs
  `ios_safari_page`. For anything engine-shaped (paint, scroll, selector
  cost, layout), the persona is the wrong tool — drive real WebKit with
  `webkit_session.py` (WebKitGTK), which navigates, seeds, taps, and
  screenshots the app on the actual iOS engine.
- **Android Chrome is real Blink.** `android_chrome_page` on headless
  Chromium is the actual engine Android ships, so its rendering and scroll
  behavior are faithful (unlike the iOS personas, which only spoof
  identity over Blink). Not a gap.
- **Desktop Chrome** needs no persona: `p.chromium.launch()` with a
  desktop viewport (e.g. 1280×800) is the shipping engine.
- **Desktop Firefox (Gecko) — real lane, working.** `firefox_gecko.py`
  drives real Firefox via geckodriver and self-provisions both (geckodriver
  from GitHub, Firefox from Mozilla). Verified on Firefox 154 (36 seeded
  days). It needs two egress hosts allowlisted — `download.mozilla.org` and
  `download-installer.cdn.mozilla.net` (`download.mozilla.org` only
  redirects; the CDN serves the file). A 403 in a future session means the
  policy was reset; re-add both, or pass `FIREFOX_BIN=/path/to/firefox`.

Assert the persona at the top of every proof
(`persona_report(page)`), so a run can never silently verify the wrong
surface.

## Gotchas

- A UA string is not an engine. `ios_pwa_page` reports an iPhone UA but
  renders on Blink; its `userAgentData` brands still leak
  `HeadlessChrome`. Trust it for logic, never for WebKit rendering.
- Web Speech availability is a real product branch, and it differs by
  surface: present on iOS Safari, iOS PWA (though iOS blocks it inside the
  installed app at runtime), and Android Chrome; absent on iOS Chrome. The
  personas encode this — do not "fix" a persona to add it back.
- Priority, not completeness: verify where readers are and where the app
  branches. iOS WebKit is the repo's whole risk surface (`CLAUDE.md`);
  desktop Chrome rarely surprises. Spend the effort accordingly.
