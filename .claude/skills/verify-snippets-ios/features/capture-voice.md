# Voice capture

Tapping the wax seal to speak an entry. On iOS this is the most
persona-sensitive feature in the app: engine choice and failure copy
both branch on `isIOS()` / `isIOSStandalone()`
(`src/hooks/use-speech.ts`).

## Sub-features

- **Engine chain**: streaming providers (soniox → speechmatics →
  deepgram by default; table in `src/lib/speech-providers.ts`), then the
  batch proxy, then the browser's Web Speech API. Chosen by probing each
  provider's token route + `GET /api/transcribe`.
- **Live words**: partials land in the composer while listening
  (`interim`/`segments`); tap the seal again to stop.
- **Typed failure copy**: every `SpeechFailure` maps to specific copy in
  `copy.capture.voiceFailures` — including iOS-only variants.
- **Seal states**: aria-label walks "Speak today's entry" → "Stop
  listening" → "Setting your words".

## How to get to it (user POV)

Open `/calendar` with an empty composer; the wax seal shows the mic. Tap
it, grant the microphone, speak, tap again to stop. The words settle
into the composer; the seal (now quill) keeps them.

## Driving it with the Chromium personas + stubs

Server providers are unconfigured in this sandbox (no API keys), so
probes fail and the app falls to Web Speech — which is exactly the
iOS-shaped surface:

1. Stub **both** `window.SpeechRecognition` and
   `window.webkitSpeechRecognition` with one fake class via
   `add_init_script` *before* `goto` (Chromium exposes both; stubbing
   one leaves the real other). The fake fires `onresult` with synthetic
   transcripts, honors `.stop()` with `onend`.
2. On `ios_pwa_page`: tap `button[aria-label="Speak today's entry"]`,
   feed results, prove the words appear in the composer, stop, keep, and
   prove storage as in capture-typed.
3. On `chrome_ios_page` (persona removes Web Speech, as real Chrome iOS
   has none): prove the no-voice posture — the resting hint shows
   `copy.capture.noVoiceHint` behavior and the seal never enters
   listening.
4. Failure legs: make the fake's `.start()` throw or fire `onerror`, and
   assert the *specific* toast copy for the persona (see Gotchas).

`tests/e2e/speech_adapters.py` covers the streaming-provider wire; reach
for it when the change touches adapters rather than the hook.

## Gotchas

- The iOS failure copy is persona-branched: a `service` failure on the
  standalone PWA must show "iOS blocks voice inside installed web apps…"
  (`descriptionInstalledIOS`), in an iOS browser tab
  `descriptionIOSBrowser`, elsewhere `descriptionOtherwise`. Asserting
  the wrong variant passes on the wrong persona — always check the toast
  text against the persona you drove.
- Real dictation quality, mic permission prompts, and iOS's actual
  standalone speech blocking are real-device-only; the stubs prove the
  app's *handling*, not the OS.
- The seal is also the submit button; a tap with words present keeps
  instead of listening. Clear the composer before driving voice.
