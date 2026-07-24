/**
 * The one table of truth about streaming speech providers — who they
 * are, where their sockets live, and what they do with audio — consumed
 * by the privacy page (named providers + links), Settings copy, and the
 * CSP builder in next.config.ts (the connect-src allowlist). Pure
 * constants, importable from server and client alike: when the provider
 * order changes via NEXT_PUBLIC_SPEECH_PROVIDERS, every surface that
 * names a provider stays truthful without a code change.
 *
 * The retention lines are load-bearing privacy copy (STE register).
 * They state each provider's verified posture as of 2026-07; if a
 * provider's terms change, this file and the privacy page's date move
 * in the same commit.
 */

export interface SpeechProviderInfo {
  name: "soniox" | "speechmatics" | "deepgram" | "scribe";
  label: string;
  privacyUrl: string;
  /** the WebSocket origin the browser connects to (env-overridable) —
      this is what the CSP's connect-src must list */
  wsOrigin: string;
  tokenPath: string;
  /** one plain sentence on what happens to audio there */
  retentionLine: string;
}

const wsOrigin = (env: string | undefined, fallback: string): string => {
  try {
    return new URL((env ?? fallback).replace(/^ws/, "http")).origin.replace(
      /^http/,
      "ws",
    );
  } catch {
    return fallback;
  }
};

export const SPEECH_PROVIDERS: Record<
  SpeechProviderInfo["name"],
  SpeechProviderInfo
> = {
  soniox: {
    name: "soniox",
    label: "Soniox",
    privacyUrl: "https://soniox.com/docs/security-and-privacy",
    wsOrigin: wsOrigin(process.env.SONIOX_WS_URL, "wss://stt-rt.soniox.com"),
    tokenPath: "/api/soniox-token",
    retentionLine:
      "Soniox turns audio into text in memory. It does not store the audio and does not use it to train models.",
  },
  speechmatics: {
    name: "speechmatics",
    label: "Speechmatics",
    privacyUrl:
      "https://docs.speechmatics.com/administration/security-and-compliance",
    wsOrigin: wsOrigin(
      process.env.SPEECHMATICS_WS_URL,
      "wss://eu2.rt.speechmatics.com",
    ),
    tokenPath: "/api/speechmatics-token",
    retentionLine:
      "Speechmatics does not store the audio or the transcript. Both are discarded when the stream ends.",
  },
  deepgram: {
    name: "deepgram",
    label: "Deepgram",
    privacyUrl: "https://deepgram.com/privacy",
    wsOrigin: wsOrigin(process.env.DEEPGRAM_WS_URL, "wss://api.deepgram.com"),
    tokenPath: "/api/deepgram-token",
    retentionLine:
      "Deepgram processes audio to transcribe it. Every request opts out of its model-improvement program, so the audio is not kept to train models.",
  },
  scribe: {
    name: "scribe",
    label: "ElevenLabs",
    privacyUrl: "https://elevenlabs.io/privacy",
    wsOrigin: wsOrigin(
      process.env.ELEVENLABS_BASE_URL?.replace(/^http/, "ws"),
      "wss://api.elevenlabs.io",
    ),
    tokenPath: "/api/scribe-token",
    retentionLine:
      "ElevenLabs may keep request data for a time under its own policy.",
  },
};

/**
 * The configured order (streaming names only; the batch aliases are the
 * upload proxy's business). Default: privacy-first providers ahead of
 * Deepgram — first AVAILABLE wins at runtime, so entries here without
 * an API key configured simply stand aside.
 */
export function configuredSpeechProviders(): SpeechProviderInfo[] {
  return (process.env.NEXT_PUBLIC_SPEECH_PROVIDERS ?? "soniox,speechmatics,deepgram")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SpeechProviderInfo["name"] => s in SPEECH_PROVIDERS)
    .map((s) => SPEECH_PROVIDERS[s]);
}

/**
 * The providers that can actually receive audio on THIS deployment —
 * the configured order filtered to names whose API key is present.
 * Server-side only (the keys aren't NEXT_PUBLIC): this is what the
 * privacy page prints, so it never names a service audio can't reach.
 */
export function activeSpeechProviders(): SpeechProviderInfo[] {
  const keyed: Record<SpeechProviderInfo["name"], boolean> = {
    soniox: Boolean(process.env.SONIOX_API_KEY),
    speechmatics: Boolean(process.env.SPEECHMATICS_API_KEY),
    deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    scribe: Boolean(process.env.ELEVENLABS_API_KEY),
  };
  return configuredSpeechProviders().filter((p) => keyed[p.name]);
}
