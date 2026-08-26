# Book navigation

Reading the book: scrolling the schedule feed, rising to month view,
diving into a day. This is where iOS-specific performance bugs have
actually lived (the FLAT-BOOK LAW in `globals.css`), so correctness and
cost are separate proofs on separate harnesses.

## Sub-features

- **Schedule feed**: every entry mounts a live card (`[data-day]`
  sections, `[data-entry]` cards); a render window keeps only a warm
  band laid out (`[data-day][data-warm]`).
- **Rise**: tap the calendar title (`[data-cal-title]`) → month view.
- **Dive**: tap a day in month view
  (`[data-layer="month"] button[data-day-key]`) → that day's page.
- **Zoom relief**: pinch state handling on iPhones
  (`src/hooks/use-zoom-relief.ts`).

## How to get to it (user POV)

Open `/calendar` with a seeded book (`?seed=1200` for a years-deep one).
Scroll the feed; tap the title to rise; tap a day to dive; tap the title
to rise again.

## Driving it with the harnesses

**Correctness (Chromium personas):** seed, poll `[data-day]` counts
until stable, then tap and assert state: after a dive the target day's
entries are on screen; after a rise the month layer is; the warm band
tracks the viewport. Use synthetic `PointerEvent` taps with
`pointerType: 'touch'` (dispatch pattern in
`scripts/measure-webkit-spans.py:68`) — the app distinguishes touch.
Taps work because they finish with a real `.click()`; a synthetic
pointer *drag* does not, so use taps, not gesture scrolling.

**How to scroll the book (measured 2026-08-26). The engine decides.**
The book feed is the scroll-parent of the `[data-day]` cards — the
`-mx-2 … overflow-y-auto overscroll-contain` `SheetScroll` div
(`app-shell.tsx:53`). The page shell is `overflow-hidden`; there is also
a second, taller `overflow-y-auto` layer. **Find the feed by walking up
from a `[data-day]` card, never by "largest scrollHeight"** — that picks
the wrong layer. The today-zone composer overlays the lower-middle of
the viewport and owns its own scroll ancestor, so a wheel aimed there
misses the feed. Verify your wheel point hits the feed
(`elementFromPoint` → ancestor has your feed marker) before trusting a
result; `scripts/webkit_wheel_scroll.py` does this correctly.

- **WebKitGTK — real scroll works (use this for scroll logic).** A
  trusted W3C WebDriver *wheel* action over a card scrolls the feed and
  drives the app's scroll-dependent logic. Measured: two wheel actions
  moved the book +16,000px, fired 3 real `scroll` events, and the warm
  window followed 2021→2024. Touch-drag actions do not synthesize a
  scroll here; wheel is the lever.
- **Chromium persona (Blink) — no synthetic scroll at all.** Synthetic
  JS pointer drag, a real CDP `Input.dispatchTouchEvent` flick,
  `mouse.wheel`, and Chrome's `gpuBenchmarking` momentum fling each
  moved a plain 20,000px page 0px, headless and headed-under-Xvfb alike.
  This sandbox's Chromium has no compositor that applies synthetic
  scroll. On the persona, move the book with `scrollTop`/`scrollTo` and
  assert position-dependent logic; drive dive/rise with taps.

So real scroll verification lives on the WebKitGTK harness (wheel), and
the Chromium persona covers tap correctness plus programmatic position.
What neither reproduces: iOS **touch** momentum and rubber-band, and the
memory pressure of flicking a deep book (the FLAT-BOOK jetsam class) —
WebKitGTK is desktop, under Xvfb, software-rendered, no idle rAF. Those
stay an on-device pass.

**Cost (WebKitGTK — the engine iOS actually runs):**
`scripts/measure-webkit-spans.py [seed]` measures the dive/rise setup
spans end to end and is the model for new measurements; the
`scripts/measure-*.py` family covers scroll drift, stall immunity,
first motion, and more. Price every setup-cost hypothesis here before
shipping — two optimization rounds tuned on Chromium once produced wins
that never materialized on the owner's iPhone.

## Gotchas

- Seed writes lag paint: poll section counts after seeding, then settle
  ~10 s before navigating, or the reload comes back empty.
- Sections ≈ 0.55 × entries at default densities — the poll target in
  `measure-webkit-spans.py:53`.
- Under Xvfb, WebKit fires no rAF while idle: rAF-deferred dive work
  does not run during synthetic dwells; dive numbers are the no-dwell
  worst case, the rise is faithful.
- Never "verify" a per-card paint change (blend, isolation, blurred
  shadow) as safe from this sandbox — memory-pressure kills are
  real-device-only; the law stands regardless of what headless numbers
  say.
- iOS scroll *feel* — momentum, rubber-band overscroll, and the
  memory pressure that thumb-flicking a years-deep book triggers — is
  not reproducible here, even though WebKitGTK scrolls the feed by
  wheel. The Chromium persona is Blink (its `userAgentData` brands leak
  `HeadlessChrome` through the iPhone UA spoof); WebKitGTK is the real
  engine but desktop, under Xvfb, software-rendered with no idle rAF. Use
  them for scroll *logic* and relative cost, not for physics — that is an
  on-device pass.
- Do NOT pick the book scroller by largest `scrollHeight`; two
  `overflow-y-auto` layers overlap and that heuristic grabs the wrong
  one. Walk up from a `[data-day]` card instead, and confirm your wheel
  coordinates hit that element (the today-zone composer overlays the
  lower-middle viewport with its own scroll ancestor). A wheel result of
  0px usually means the point missed the feed, not that the app blocks
  scrolling.
