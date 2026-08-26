# Cross-browser and cross-platform

The app ships on six surfaces that reduce to three engines. This file is
the matrix: which persona or harness covers each, what is faithful, and
what is a stand-in. Do not test six surfaces as six harnesses — test the
engine and the capability profile.

## Sub-features (the surface matrix)

| Surface | Engine | Persona / harness | Fidelity |
| --- | --- | --- | --- |
| iOS installed PWA | WebKit | `ios_pwa_page` + WebKitGTK | logic faithful; engine real via WebKitGTK; momentum device-only |
| iOS Safari (tab) | WebKit | `ios_safari_page` + WebKitGTK | same as PWA, `standalone` false |
| iOS Chrome | WebKit | `chrome_ios_page` + WebKitGTK | same engine; no Web Speech |
| Android Chrome | Blink | `android_chrome_page` | faithful — Chromium **is** Blink |
| Desktop Chrome | Blink | `p.chromium.launch()` | faithful |
| Desktop Firefox | Gecko | gated (see below) | unverified here |

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
  cost), the persona is the wrong tool — use WebKitGTK.
- **Android Chrome is real Blink.** `android_chrome_page` on headless
  Chromium is the actual engine Android ships, so its rendering and scroll
  behavior are faithful (unlike the iOS personas, which only spoof
  identity over Blink).
- **Desktop Chrome** needs no persona: `p.chromium.launch()` with a
  desktop viewport (e.g. 1280×800) is the shipping engine.
- **Desktop Firefox (Gecko) is gated.** Playwright's Firefox build is not
  installed in this sandbox and downloads are blocked; there is no system
  Firefox either. To cover it: `playwright install firefox` where
  downloads are allowed, then `p.firefox.launch()` (real Gecko); or drive
  a system Firefox via geckodriver. Until one exists, report desktop-Gecko
  as unverified — never infer it from a Chromium run.

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
