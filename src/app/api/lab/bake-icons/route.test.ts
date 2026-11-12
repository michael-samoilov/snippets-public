import { describe, expect, it } from "vitest";
import { POST } from "./route";

/**
 * The dev-only icon writer. `pnpm dev` serves it on localhost, where any
 * site open in the same browser can POST to it. Every body here is
 * empty, so no case writes to the repo, even on a route without the
 * check.
 */
const SITE = "http://localhost:3000";

function post(headers: Record<string, string>): Request {
  return new Request(`${SITE}/api/lab/bake-icons`, {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "text/plain", ...headers },
    body: "{}",
  });
}

describe("POST /api/lab/bake-icons", () => {
  it("refuses another site's page", async () => {
    const res = await POST(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cross_site" });
  });

  it("refuses a POST with no Origin", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(403);
  });

  it("reaches the writer for the studio's own page", async () => {
    const res = await POST(post({ origin: SITE, "sec-fetch-site": "same-origin" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, wrote: [] });
  });
});
