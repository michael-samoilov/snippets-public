import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/security-headers";

/**
 * Security headers are built and tested in src/lib/security-headers.ts
 * (so security-invariants.test.ts can check the CSP against the code's
 * real egress). This file just applies them in production; dev tooling
 * (overlay, fast refresh) needs looser rules, so the headers ride the
 * build people actually use.
 */
const nextConfig: NextConfig = {
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: buildSecurityHeaders() }];
  },
};

export default nextConfig;
