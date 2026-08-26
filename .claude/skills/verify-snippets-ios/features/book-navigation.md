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

**Scrolling is programmatic, not a driven gesture (measured 2026-08-26).**
The book's scroll container is the `SheetScroll` div
(`app-shell.tsx:53`, `overflow-y-auto`), not the window. Move it by
setting `scrollTop` / `scrollTo` on that element and assert the
position-dependent logic (warm band, sticky date, anchor re-landing).
Do NOT try to scroll it with a gesture: a probe drove the same container
four ways — synthetic JS pointer drag, a real CDP
`Input.dispatchTouchEvent` flick, and `mouse.wheel` all moved it 0px;
only `scrollTo` moved it. A control proved the app is not the blocker
(`touch-action: auto`, no `preventDefault`) — raw CDP touch and wheel
just don't produce native scroll under headless mobile emulation, even
on a plain tall page. So the harness gives you scroll *position*, never
a thumb-driven gesture and never momentum.

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
  not reproducible here. The Chromium persona is Blink (its
  `userAgentData` brands leak `HeadlessChrome` through the iPhone UA
  spoof); the WebKitGTK harness is the real engine but desktop, under
  Xvfb, software-rendered with no idle rAF. Both are for logic and
  relative cost, not scroll physics — that is an on-device pass.
