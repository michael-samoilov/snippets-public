/**
 * True when a request did not come from a page on this app's own
 * origin. Same-origin means: `Sec-Fetch-Site` is absent or
 * `same-origin`, and `Origin` is present and names the host the request
 * was sent to. A missing `Origin` fails: every browser sends it on a
 * POST, so only a script leaves it out. A page on another site cannot
 * forge either header, but a script can, so this check stops other
 * sites' pages, not scripts.
 */
export function isCrossSite(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return true;
  const origin = headers.get("origin");
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))
    ?.split(",")[0]
    .trim();
  if (!origin || !host) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
