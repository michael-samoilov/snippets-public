/**
 * The security headers, as a TESTED value rather than a config-file
 * string — so `security-invariants.test.ts` can assert the CSP against
 * the code's real egress, and next.config.ts stays a thin caller. This
 * is the "derive, don't duplicate" tier of drift-prevention: the CSP's
 * connect-src is BUILT from the speech provider table, so the header and
 * the privacy page that names those providers can't disagree.
 *
 * connect-src is a PRIVACY surface: it is the complete, browser-enforced
 * list of every origin this app may send data to. Widening it is a
 * privacy event — update /verify and the privacy page in the same commit,
 * and the egress test will make you keep the origin registry honest.
 */
// relative, not the "@/lib" alias: next.config.ts imports this file and the
// config transpiler doesn't resolve tsconfig path aliases (vitest + the app
// resolve both; relative works everywhere)
import { configuredSpeechProviders } from "./speech-providers";

/**
 * Fixed browser-egress origins that are NOT the app's own and NOT speech
 * providers. Today: the Drive backup upload (the writer's device sends
 * backup files straight to their own Google Drive). Anything added here
 * must also be classified in the egress test's ORIGIN_REGISTRY.
 */
export const FIXED_CONNECT_ORIGINS = ["https://www.googleapis.com"] as const;

/** Every external origin the browser may open a connection to: the fixed
 *  set plus the configured speech WebSocket origins (deduped). 'self' is
 *  added by the CSP itself and is not listed here. */
export function connectOrigins(): string[] {
  const speech = configuredSpeechProviders().map((p) => p.wsOrigin);
  return [...new Set([...FIXED_CONNECT_ORIGINS, ...speech])];
}

export function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    ["connect-src 'self'", ...connectOrigins()].join(" "),
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
  ].join("; ");
}

export function buildSecurityHeaders(): { key: string; value: string }[] {
  return [
    {
      key:
        process.env.CSP_REPORT_ONLY === "1"
          ? "Content-Security-Policy-Report-Only"
          : "Content-Security-Policy",
      value: buildCsp(),
    },
    // CSP never governs DNS; prefetch lookups could leak hostnames
    { key: "X-DNS-Prefetch-Control", value: "off" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // outbound links (providers' privacy pages, etc.) carry no referrer
    { key: "Referrer-Policy", value: "same-origin" },
    {
      key: "Permissions-Policy",
      value: "microphone=(self), camera=(), geolocation=(), payment=()",
    },
  ];
}
