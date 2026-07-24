import type { NextConfig } from "next";
import createMDX from "@next/mdx";
import { buildSecurityHeaders } from "./src/lib/security-headers";

/**
 * Security headers are built and tested in src/lib/security-headers.ts
 * (so security-invariants.test.ts can check the CSP against the code's
 * real egress). This file just applies them in production; dev tooling
 * (overlay, fast refresh) needs looser rules, so the headers ride the
 * build people actually use.
 *
 * The policy pages (privacy, terms, verify) are authored in Markdown
 * (.mdx) so their prose can be edited without touching JSX — see
 * `mdx-components.tsx` (Markdown → the design system) and
 * `src/components/policy-mdx.tsx` (the structured pieces). `mdx` is in
 * pageExtensions so `.mdx` modules compile; content files are named
 * `content.mdx` (not `page.mdx`), so they're imported, never routed.
 */
const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [{ source: "/:path*", headers: buildSecurityHeaders() }];
  },
};

const withMDX = createMDX({
  options: {
    // strings, not imported functions: Turbopack serializes the MDX
    // config to its Rust side, so plugins must be referenced by name.
    remarkPlugins: [["remark-smartypants", {}]], // straight quotes → curly, -- → em dash
    rehypePlugins: [["rehype-slug", {}]], // every heading gets an id from its text
  },
});

export default withMDX(nextConfig);
