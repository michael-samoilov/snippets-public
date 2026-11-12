# Feature map — Snippets

One file per user-facing feature. Each answers, from the reader's point
of view: what it is, how to reach it, how to drive it with this skill's
harnesses, and what observable end state proves it works. A proof that
drives one convenient entry point is incomplete when the file lists
others.

| Feature | File | Primary harness |
| --- | --- | --- |
| Typed capture (today + backfill) | [capture-typed.md](capture-typed.md) | Chromium personas |
| Voice capture | [capture-voice.md](capture-voice.md) | Chromium personas + speech stubs |
| Book navigation (dive / rise / scroll) | [book-navigation.md](book-navigation.md) | Chromium for taps/position, WebKitGTK wheel for real scroll |
| Offline PWA (service worker) | [pwa-offline.md](pwa-offline.md) | Chromium ios-pwa persona |
| Cross-browser / cross-platform | [cross-browser.md](cross-browser.md) | Four personas + WebKitGTK; the surface→engine matrix |

## Not yet mapped

Real surfaces the map does not cover; extend it here before claiming
them verified:

- **Sign-in, sync, encryption, enrollment** — need `DATABASE_URL` etc.;
  the observed no-plaintext proof is `tests/e2e/forced_e2e.py` (run via
  `with_server.py`), not this skill.
- **Settings** (theme, sync/backup status lines, unlock) — drive at
  `/settings`; copy is linter-governed (`pnpm check:copy`).
- **Search** (`copy.search.entriesLabel` surfaces in `calendar/page.tsx`).
- **Drive backup** — device-delivered; needs real Google tokens.
- **True iOS thumb-scroll and other device-only behavior** (touch
  momentum, rubber-band, deep-book jetsam, safe areas, dictation, install
  flow) — the real-iOS lane in `SKILL.md` covers these (device farm,
  Simulator, or the manual iPhone protocol). WebKitGTK wheel scrolls the
  feed and drives its scroll logic here, but carries no iOS momentum, and
  the guard-flag logic (`docs/schedule-map.md`) only fully exercises
  under a real fling.
