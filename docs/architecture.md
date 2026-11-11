# Architecture

Snippets is a local-first progressive web app. Entries live on the device,
and accounts, sync, speech, and backup are optional layers on top. This page
summarizes how the parts fit. [`SECURITY-STATE.md`](../SECURITY-STATE.md) is
the authoritative record of what the app does with user data.

## Stack

- Next.js 16 with the App Router and Turbopack, React 19, and Tailwind CSS 4.
- The design tokens live in `@theme inline` in
  [`src/app/globals.css`](../src/app/globals.css).
  [`DESIGN.md`](../DESIGN.md) explains them.
- `src/components/ui/` holds shadcn components that are copied in and
  restyled. They are edited in place, not fetched again.

## Data on the device

- Entries are stored in IndexedDB through Dexie. The schema and every query
  are in [`src/lib/db.ts`](../src/lib/db.ts), and the types are in
  [`src/lib/types.ts`](../src/lib/types.ts). Every write goes through
  `db.ts`, which marks the row for sync.
- Day keys (`YYYY-MM-DD`) use the device's local time
  ([`src/lib/dates.ts`](../src/lib/dates.ts)).
- A deletion is soft (`deletedAt`) and can be undone. The app purges a
  deleted entry after 30 days.
- `favorite` is `0` or `1`, because IndexedDB cannot index a boolean.
- The UI reads live queries through `dexie-react-hooks` in
  [`src/hooks/use-snippets.ts`](../src/hooks/use-snippets.ts).

## Speech capture

[`src/hooks/use-speech.ts`](../src/hooks/use-speech.ts) is one hook behind
the wax-seal button on today's page. It tries engines in this order:

1. **A streaming provider.** Each provider is a small adapter on shared
   microphone, worklet, and downsampling code.
   [`src/lib/speech-providers.ts`](../src/lib/speech-providers.ts) is the one
   table of provider facts: labels, privacy links, the WebSocket origins that
   the Content-Security-Policy allows, and the retention lines that the
   privacy page prints. `NEXT_PUBLIC_SPEECH_PROVIDERS` sets the order, by
   default `soniox,speechmatics,deepgram`. The first provider with an API key
   wins, and the others are backups. ElevenLabs Scribe is wired but outside
   the default order, because its zero-retention mode is enterprise-only.
   The server mints a short-lived token for each recording, so no API key
   reaches the browser.
2. **A batch transcription service.**
   [`src/app/api/transcribe/route.ts`](../src/app/api/transcribe/route.ts)
   forwards a finished recording to any service that speaks the OpenAI
   Whisper API. The text arrives about half a second after the recording
   stops.
3. **The browser's Web Speech API.** This is the browser's own dictation, so
   the audio goes to Google or Apple, outside the app's CSP. The privacy page
   says so.

The app picks an engine by probing each provider's token route. Every
failure has a typed reason (`SpeechFailure`) that maps to specific copy.

## Accounts and sync

Sign-in is optional. Better Auth handles Google and email codes (sent
through Resend), on Neon Postgres with Drizzle. The schema is in
[`src/server/db/schema.ts`](../src/server/db/schema.ts), and the migrations
are in [`drizzle/`](../drizzle). Without `DATABASE_URL` and
`BETTER_AUTH_SECRET`, the auth routes answer 503 and the app stays
device-only.

Sync is a pull and push protocol in [`src/app/api/sync/`](../src/app/api/sync)
with a client engine in [`src/lib/sync.ts`](../src/lib/sync.ts). Each row
merges by one rule that the client and the server share,
[`src/lib/merge.ts`](../src/lib/merge.ts): the newer `updatedAt` wins, a tie
changes nothing, and the server's verdict is final. Deletion markers stay on
the server, and a device purges only the ones that the server has
acknowledged. Erasing a synced book soft-deletes every entry, so the
deletion reaches the other devices.

## End-to-end encryption

Encryption is required at sign-in, and there is no unencrypted sync.

- Each entry's content is encrypted with AES-GCM under a per-user book key.
  The row's clear fields (`id`, `updatedAt`, `deletedAt`, and
  `payloadFormat`) are bound in as additional authenticated data
  (`aadForRow` in [`src/lib/crypto.ts`](../src/lib/crypto.ts)). A moved,
  rolled-back, revived, or downgraded row fails to decrypt.
- The push route accepts format 3 only. It refuses format 1 with
  `409 encryption_required` and format 2 with `400`.
- Pull refuses plaintext, an unknown format, and a live row with no
  payload ([`src/lib/sync-wire.ts`](../src/lib/sync-wire.ts)). For an entry
  that a device already holds, it refuses an older copy and an envelope
  without bound fields (format 2). A deletion with no payload hides the
  entry and keeps its words on the device for 30 days.
- A format-2 row still opens for an entry that the device does not hold,
  and the device re-encrypts it to format 3.
- The book key is wrapped twice, under the passphrase and under a recovery
  code. The server stores only the wrapped copies (`/api/keys`), once, and
  never replaces them through the API. On the device, the key is a
  non-extractable `CryptoKey`.
- A signed-in device without a key pauses sync and keeps capture working.
  A key that no longer opens the server's rows is forgotten, and the device
  asks for the passphrase again.
- [`tests/e2e/forced_e2e.py`](../tests/e2e/forced_e2e.py) observes that no
  unencrypted row leaves the device.

## Drive backup

Each signed-in device can write a readable copy of the book to a visible
folder in the user's own Google Drive.

- The device renders the files itself
  ([`src/lib/render-book.ts`](../src/lib/render-book.ts)), as Markdown and a
  JSON archive that Restore from JSON reads, and uploads them after each
  sync ([`src/lib/backup-client.ts`](../src/lib/backup-client.ts)).
- A Google sign-in stores no token. The server holds a Drive refresh token
  only until a device collects it from `/api/backup/adopt`, and OAuth tokens
  are encrypted at rest.
- Adoption records the token's SHA-256 with the account in a `drive_grant`
  table. The device then exchanges its token through `/api/backup/refresh`
  for a short-lived access token. That route stores no token and refuses
  any other account.
- Account deletion revokes the Drive token that the deleting device sends,
  and that account's tokens are never exchanged again.
- The device reports each delivery and each failure, with Google's own error
  code. Settings names the cause and the one action that fixes it.
- A daily cron job emails the user when a backup falls behind while the book
  changes. It also clears old deletion markers and warns the operator before
  the database fills.
- The Drive files are not encrypted on purpose. They are the safety net if
  the user loses the key.

## Rendering budget

The book view mounts a card for every entry in the reader's history. Any
paint effect on a card, such as a blend mode, `isolation: isolate`, or a
blurred `box-shadow`, costs once per entry. On iOS, that cost grows with the
book until the system ends the page. Book cards therefore use only flat
fills, hairlines, and an unblurred highlight. The rule and its history are on
`.book-card` in [`src/app/globals.css`](../src/app/globals.css).

## Vendored code

- [`src/vendor/paper-shaders/`](../src/vendor/paper-shaders) is a copy of the
  PaperTexture code from paper-design/shaders, under the PolyForm Shield
  License 1.0.0 in its `LICENSE` file. The notice ships in strings that the
  minifier keeps. The app ships baked textures from `public/textures`.
- `tools/oxlint/anti-slop` holds lint rules that `pnpm lint:slop` runs.

## Progressive web app and CSP

- [`src/app/manifest.ts`](../src/app/manifest.ts) and a hand-written service
  worker, [`public/sw.js`](../public/sw.js), make the app installable and
  usable offline.
- Every page sends a strict Content-Security-Policy from
  [`next.config.ts`](../next.config.ts). Its `connect-src` lists every origin
  that the app may send data to, and the `/verify` page tells readers how to
  check it.
