# Snippets

[![public-ci](https://github.com/michael-samoilov/snippets-public/actions/workflows/public-ci.yml/badge.svg)](https://github.com/michael-samoilov/snippets-public/actions/workflows/public-ci.yml)

*A pocket notebook for the day's stories.*

Snippets is a journaling app for people who want to keep the small
moments of each day (a story, a joke, a line someone said) without
keeping a full diary. You speak or type a few words, and they land on
today's page in a book you can leaf back through by day, month, or
year. It runs in the browser, installs to a phone's home screen, works
offline, and keeps your entries on your device.

Live app: [www.snippets.ink](https://www.snippets.ink)

**Status:** Live, maintained solo; not accepting contributions.

It follows the **Homework for Life** practice from Matthew Dicks's
*Storyworthy*: at the end of each day, keep the most storyworthy moment
that happened. Do it for a month, and you find that an ordinary life is
full of stories.

<p align="center">
  <img src="docs/images/today-phone.webp" width="240" alt="Today's page on a phone: the date, a ruled line that reads 'Add something else from today…', and a blue wax-seal microphone button.">
  <img src="docs/images/month-phone.webp" width="240" alt="The October 2026 month calendar on a phone, with ink dots under each day that has entries.">
  <img src="docs/images/book-phone-lamplight.webp" width="240" alt="The book in the dark Lamplight theme on a phone: entries grouped under their dates from October 28 to November 1.">
</p>

![The book on a desktop browser: a paper sheet on a warm desk, with entries grouped under their dates from October 28 to November 1, 2026.](docs/images/book-desktop.webp)

The screenshots show invented sample entries from the app's built-in
seeder (`src/lib/dev-seed.ts`).

## Highlights

- **End-to-end encrypted sync.** Each entry is encrypted on the device
  before it leaves. The server cannot read an entry, or change one that
  a device holds ([`src/lib/crypto.ts`](src/lib/crypto.ts)).
- **Every privacy claim tied to code and a test.**
  [`SECURITY-STATE.md`](SECURITY-STATE.md) states what the app does with
  your data, names the test that proves each claim, and lists the known
  limits.
- **Live dictation with fallbacks.** Words appear as you speak. When one
  speech provider is unavailable, the next one takes over, down to the
  browser's own engine.
- **Local-first.** Entries live on the device, and the app works offline
  and without an account.

## What it does

- **Speak it or write it.** Tap the wax seal and talk. With a streaming
  speech key set, your words appear on the page as you speak, in any
  browser with a microphone. With a Whisper-compatible key instead, a
  recording becomes text about half a second after you stop. With no
  key, the browser's own speech engine streams the words (Chrome,
  Safari, Edge). Or type. Capture asks for no decisions.
- **Leaf back through.** Every entry sits in one book, grouped by day.
  Zoom out to a month calendar, where ink dots show how much you kept
  each day, or to a whole year. Search looks through every entry.
- **Yours alone.** Entries live in IndexedDB on your device, and you can
  export them to JSON or Markdown at any time. Typed entries stay on the
  device unless you sign in. Sign-in is optional and adds sync across
  devices: each entry is encrypted end to end on your device before it
  leaves, so the server holds only ciphertext that it can't read.
  Encryption is required at sign-in; there is no plaintext sync. Google
  Drive backup is opt-in and deliberately readable, as a safety net if
  you lose your key. Spoken audio leaves the device only to be
  transcribed.

## Start here

These files show how the app works:

- [`src/lib/crypto.ts`](src/lib/crypto.ts): end-to-end encryption, the book
  key, and the row fields bound into each encrypted entry.
- [`src/lib/sync.ts`](src/lib/sync.ts) with
  [`src/lib/merge.ts`](src/lib/merge.ts): the sync engine and the one merge
  rule that the client and the server share.
- [`SECURITY-STATE.md`](SECURITY-STATE.md): what the app does with user data,
  each claim tied to the code and test that prove it, and the known limits.
- [`src/lib/speech-providers.ts`](src/lib/speech-providers.ts): the one table
  of speech-provider facts that the CSP and the privacy page read.
- [`DESIGN.md`](DESIGN.md): the design system and the copy voice.
- [`docs/architecture.md`](docs/architecture.md): how the parts fit.

## Run it locally

You need Node 22 or 24 and pnpm 10 (`corepack enable` installs it).

```sh
pnpm install
pnpm dev            # http://localhost:3000
```

### Optional speech keys

Every key is optional; the app works with none of them.
[`.env.example`](.env.example) lists every variable that the app and its
tools read. Server-side
keys never reach the browser: the server mints a short-lived token for
each recording.

```sh
# Streaming providers: words appear as you speak. Set any subset.
# The default order is privacy-first: soniox, speechmatics, deepgram.
# The first provider with a key wins; the rest are automatic backups.

# Soniox (first by default): realtime and multilingual, switches
# language mid-sentence; audio is processed in memory, not stored, and
# not used for training. Token route: /api/soniox-token.
SONIOX_API_KEY=…
# SONIOX_MODEL=stt-rt-v5

# Speechmatics: realtime, stores neither audio nor transcript, EU
# endpoint; one language per session. Token route: /api/speechmatics-token.
SPEECHMATICS_API_KEY=…
# SPEECHMATICS_LANGUAGE=en

# Deepgram Nova-3: every request sends mip_opt_out=true, so audio is not
# kept for training. Token route: /api/deepgram-token.
DEEPGRAM_API_KEY=…
# DEEPGRAM_MODEL=nova-3
# DEEPGRAM_LANGUAGE=multi

# ElevenLabs Scribe v2 Realtime: outside the default order, because its
# zero-retention mode is enterprise-only. Token route: /api/scribe-token.
ELEVENLABS_API_KEY=…
# SCRIBE_MODEL=scribe_v2_realtime
# ELEVENLABS_BASE_URL=https://api.elevenlabs.io

# Provider order. Reorder and redeploy to switch; no code change.
# NEXT_PUBLIC_SPEECH_PROVIDERS=soniox,speechmatics,deepgram

# Batch fallback, used when no streaming key is set: any service that
# speaks the OpenAI Whisper API. The recording uploads when you stop.
# TRANSCRIBE_API_KEY=…
# TRANSCRIBE_BASE_URL=https://api.aquavoice.com/api/v1   # default: Aqua Avalon
# TRANSCRIBE_MODEL=avalon-v1.5
# (AQUA_API_KEY, AQUA_BASE_URL, and AQUA_MODEL still work as aliases.)
# Other Whisper-compatible services:
#   OpenAI  TRANSCRIBE_BASE_URL=https://api.openai.com/v1
#           TRANSCRIBE_MODEL=gpt-4o-transcribe
#   Groq    TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1
#           TRANSCRIBE_MODEL=whisper-large-v3-turbo
```

### Accounts, sync, and Drive backup (optional)

The app is complete without these. With them, signing in keeps an
encrypted copy of your entries on the server for sync across devices.
Entries are encrypted end to end on the device before they're sent, so
the server never holds readable text. Each signed-in device also writes
readable Markdown and a restorable JSON archive to a visible "Snippets"
folder in the user's own Google Drive. The server keeps the Drive
permission Google grants, encrypted, only until the device collects
it, and the files stay with the user even if the app goes away. Set
these environment variables:

```sh
DATABASE_URL=…          # Neon Postgres (pooled URL); run pnpm db:migrate once
BETTER_AUTH_SECRET=…    # openssl rand -base64 32
BETTER_AUTH_URL=…       # the canonical origin
GOOGLE_CLIENT_ID/SECRET # Google sign-in and the Drive grant
RESEND_API_KEY/FROM     # sign-in codes and backup-failure alerts
CRON_SECRET=…           # guards /api/cron/backup (vercel.json schedules it)
OPS_ALERT_EMAIL=…       # optional: database storage alerts
```

One-time setup outside the repo:

1. Create the Neon project and run `pnpm db:migrate`.
2. In Google Cloud, create an OAuth web client with the redirect
   `…/api/auth/callback/google`, enable the Drive API, and put
   `/privacy` on the consent screen.
3. Publish the OAuth app to **Production**. In Testing status, Google
   expires refresh tokens after seven days, which stops backups.
4. Verify the Resend sending domain.

Sign-in uses only basic scopes. The `drive.file` grant is a separate
one-tap consent in **Settings → Backup**.

### Production

```sh
pnpm build && pnpm start
```

Deploys as-is to Vercel or any Node host. On a phone, open the site and
choose **Add to Home Screen**; it then opens like an app, offline
included.

## The design

A desk under lamplight with one sheet of paper on it. Paper and ink
carry the words, and sealing-wax blue marks recording, the margin rule,
and today. The full system (tokens, type voices, motion budget, and
copy voice) is in [`DESIGN.md`](./DESIGN.md).

| | |
|---|---|
| Stack | Next.js 16 · React 19 · Tailwind v4 · Dexie · Web Speech API |
| Data | Local-first (IndexedDB), soft delete with undo, JSON and Markdown export |
| Sync (optional) | Better Auth · Neon Postgres with Drizzle · end-to-end encryption |
| Typography | Fraunces (display and prose) · IBM Plex Mono (metadata) |

## Known limits

- **One large file.** [`src/app/calendar/page.tsx`](src/app/calendar/page.tsx)
  has about 8,000 lines. It holds the book, the month and year views, and
  the today zone's scroll machinery.
- **One device without an account.** Without sign-in, entries stay in one
  browser's IndexedDB. Export them to JSON or Markdown to keep a copy.
- **Browser dictation leaves the app's control.** With no speech key set,
  the browser's own engine sends the audio to Google or Apple.
- **Device-only checks.** Some iOS behavior, such as scroll momentum and
  memory limits, shows only on a real iPhone, so those checks are manual.
- **Known security limits.** [`SECURITY-STATE.md`](SECURITY-STATE.md) lists
  them under "Known limits".

## About this repository

[github.com/michael-samoilov/snippets-public](https://github.com/michael-samoilov/snippets-public)
is the read-only public copy of a private working repository, updated
weekly. Branch names in the contributor docs refer to the private
repository. Commit IDs cited in the docs refer to the private working
repository. AI coding agents (Claude Code and Cursor) wrote the code
under my direction. Commits name the agent where the record shows which
one wrote them. About 100 commits name no agent; most are from June
2026, and agents wrote those too. The [`.claude/`](.claude/README.md)
folder holds the agents' instructions and tools. Privacy and security
changes are logged in the [`SECURITY-STATE.md`](SECURITY-STATE.md)
change log. The public copy runs lint, the unit tests, and a production
build on every update.

## License

Copyright (c) 2026 Michael Samoilov. All rights reserved. See [LICENSE](LICENSE).
The code is published for reading, not for reuse.
To report a vulnerability, see [SECURITY.md](SECURITY.md).
