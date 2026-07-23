import type { NextConfig } from "next";
import { configuredSpeechProviders } from "./src/lib/speech-providers";

/**
 * The Content-Security-Policy is a PRIVACY surface, not just hardening:
 * its connect-src line is the complete, browser-enforced list of every
 * origin this app may contact — which is why /verify tells readers to
 * curl it. Keep it tight; every addition here widens where words can go
 * and must be reflected on /verify and the privacy page in the same
 * commit.
 *
 * The speech WebSocket origins come from the same provider table the
 * privacy page prints (src/lib/speech-providers.ts), so the header and
 * the prose can't drift apart. https://www.googleapis.com is the Drive
 * backup upload — the writer's device sends the files straight to their
 * own Drive; our server never carries them.
 *
 * script-src carries 'unsafe-inline' (the framework's hydration and
 * theme-boot scripts are inline; /verify is honest about it) and blob:
 * (the audio worklet module loads from a blob URL). Escape hatch:
 * CSP_REPORT_ONLY=1 switches to report-only without a code change.
 */
const speechOrigins = [
  ...new Set(configuredSpeechProviders().map((p) => p.wsOrigin)),
];

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  ["connect-src 'self'", "https://www.googleapis.com", ...speechOrigins].join(" "),
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  {
    key:
      process.env.CSP_REPORT_ONLY === "1"
        ? "Content-Security-Policy-Report-Only"
        : "Content-Security-Policy",
    value: csp,
  },
  // CSP never governs DNS; prefetch lookups could leak hostnames
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // outbound links (privacy pages of providers, etc.) carry no referrer
  { key: "Referrer-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "microphone=(self), camera=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    // dev tooling (overlay, fast refresh) needs looser rules — the
    // headers exist to be tight in the build people actually use
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
