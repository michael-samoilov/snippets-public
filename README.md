# Snippets

*A pocket notebook for the day's stories.* Catch the stories, jokes, quotes, and stray
thoughts of your day before they evaporate — by voice, in one breath.

Built in the spirit of **Homework for Life** (Matthew Dicks,
*Storyworthy*): at the end of every day, keep the most storyworthy
moment that happened. Do it for a month and you discover your mundane
life is full of stories.

## What it does

- **Speak it or write it.** Tap the wax seal and talk. With a streaming
  key configured, your words appear on the page as you speak, live, in
  any browser with a microphone. The default order is privacy-first:
  Soniox, then Speechmatics, then Deepgram (the first one whose key is
  set wins; the rest are automatic backups), with ElevenLabs Scribe
  supported outside that order. With a Whisper-dialect key instead,
  recordings transcribe about half a second after you stop. With no
  key, the browser's own speech engine streams words live (Chrome,
  Safari, Edge). Or just type. Nothing is asked of you at the moment of
  capture.
- **Leaf back through.** A searchable collection grouped by day, a
  calendar ledger with ink-dot density, and *On this day* resurfacing
  what you kept a month and a year ago.
- **Yours alone.** Everything lives in IndexedDB on your device.
  Installable PWA, works offline, exports to JSON and Markdown anytime.
  Typing never touches the network. Sign-in is optional and adds
  cross-device sync: entries are encrypted end-to-end on your device
  before they leave, so the server holds only ciphertext it cannot read
  (encryption is required at sign-in; there is no plaintext-sync path).
  Google Drive backup is opt-in and deliberately readable, your safety
  net if you ever lose your key. Only spoken audio leaves for
  transcription, and only encrypted entries leave for sync.

## Running it

```sh
pnpm install
pnpm dev            # http://localhost:3000
```

### Optional keys

Both are optional; the app is fully functional with neither.

```sh
# Live voice transcription: words stream onto the page as you speak, in
# any browser with a microphone. Four streaming providers are supported;
# the key never reaches the browser (the server mints a short-lived token
# per recording). Set any subset. The default order is privacy-first:
# soniox, speechmatics, deepgram (the first one with a key wins; the rest
# are automatic backups). ElevenLabs Scribe is supported outside that order.

# Soniox (default first choice): realtime, multilingual with mid-sentence
# code-switching; memory-only and no-training at the self-serve tier.
# Token via /api/soniox-token.
SONIOX_API_KEY=…
# SONIOX_MODEL=stt-rt-v5

# Speechmatics: realtime, stores nothing by architecture, EU endpoint; one
# language per session (no code-switching). Token via /api/speechmatics-token.
SPEECHMATICS_API_KEY=…
# SPEECHMATICS_LANGUAGE=en

# Deepgram Nova-3: lowest latency; language=multi accepts any language and
# switches mid-sentence. Every request sends mip_opt_out=true (no training).
# Token via /api/deepgram-token.
DEEPGRAM_API_KEY=…
# DEEPGRAM_MODEL=nova-3
# DEEPGRAM_LANGUAGE=multi

# ElevenLabs Scribe v2 Realtime: broadest language coverage (90+). Out of
# the default order (zero-retention is enterprise-only there); wired for
# explicit use. Token via /api/scribe-token.
ELEVENLABS_API_KEY=…
# SCRIBE_MODEL=scribe_v2_realtime
# ELEVENLABS_BASE_URL=https://api.elevenlabs.io

# Provider preference (default + backup order). First available wins;
# reorder and redeploy to switch, no code change.
# NEXT_PUBLIC_SPEECH_PROVIDERS=soniox,speechmatics,deepgram

# Batch fallback (used when no streaming key is set): a proxy that
# speaks the OpenAI Whisper dialect — recordings upload when you stop.
# TRANSCRIBE_API_KEY=…
# TRANSCRIBE_BASE_URL=https://api.aqua.sh/v1   # default: Aqua's Avalon
# TRANSCRIBE_MODEL=avalon-1
# (the older AQUA_API_KEY / AQUA_BASE_URL / AQUA_MODEL names still work)
# Any Whisper-compatible provider is a two-line swap:
#   OpenAI  TRANSCRIBE_BASE_URL=https://api.openai.com/v1
#           TRANSCRIBE_MODEL=gpt-4o-transcribe
#   Groq    TRANSCRIBE_BASE_URL=https://api.groq.com/openai/v1
#           TRANSCRIBE_MODEL=whisper-large-v3-turbo
#
# With no key, voice falls back to the browser's own speech engine
# (Chrome, Safari, Edge); typing works everywhere regardless.
```

### Accounts, sync, and Drive backup (optional, like everything)

The app is whole with none of this. With it, signing in keeps an
encrypted copy of your entries on the server (cross-device sync):
entries are sealed end-to-end on the device before they are sent, so
the server never holds readable text, and encryption is required at
sign-in. Each signed-in device also delivers readable Markdown plus a
restorable JSON archive straight into a visible "Snippets" folder in
the user's own Google Drive (the server keeps no Drive tokens), theirs
even if this app disappears. See `.env.example` for the variables; the
moving parts:

```sh
DATABASE_URL=…          # Neon Postgres (pooled URL); pnpm db:migrate once
BETTER_AUTH_SECRET=…    # openssl rand -base64 32
BETTER_AUTH_URL=…       # the canonical origin
GOOGLE_CLIENT_ID/SECRET # Google sign-in + the Drive grant
RESEND_API_KEY/FROM     # sign-in codes + backup-failure alerts
CRON_SECRET=…           # guards /api/cron/backup (vercel.json schedules it)
```

One-time setup outside the repo: create the Neon project and run
`pnpm db:migrate`; in Google Cloud make an OAuth Web client
(redirect `…/api/auth/callback/google`), enable the Drive API, put
`/privacy` on the consent screen, and **publish the OAuth app to
Production** — in Testing status Google expires refresh tokens after
seven days, which would quietly kill backups. Verify the Resend
sending domain. Sign-in uses only basic scopes; the `drive.file`
grant is a separate one-tap consent in Settings → Backup.

### Production

```sh
pnpm build && pnpm start
```

Deploys as-is to Vercel or any Node host. On your phone: open it,
"Add to Home Screen", and it behaves like an app — offline included.

## The design

Paper and ink, a faded red margin rule, printers' marks in the margin,
sealing-wax red reserved for the act of recording. The whole system —
tokens, type voices, motion budget, copy voice — is documented in
[`DESIGN.md`](./DESIGN.md), and enforced for agentic contributors by the
skills in [`.claude/skills/`](./.claude/skills/).

| | |
|---|---|
| Stack | Next.js 16 · React 19 · Tailwind v4 · Dexie · Web Speech API |
| Data | Local-first (IndexedDB), soft-delete + undo, JSON/Markdown export |
| Typography | Fraunces (display + prose) · IBM Plex Mono (meta) |
