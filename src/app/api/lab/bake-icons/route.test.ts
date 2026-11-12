import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dev-only icon writer. `pnpm dev` serves it on localhost, where any
 * site open in the same browser can POST to it. The file system is
 * mocked, so no case writes to the repo.
 */
vi.mock("server-only", () => ({}));
const fs = vi.hoisted(() => ({ writeFile: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs/promises", () => fs);

import { POST } from "./route";

const SITE = "http://localhost:3000";
const BODY = JSON.stringify({
  spec: { size: 1 },
  files: [{ file: "src/app/icon.png", dataUrl: "data:image/png;base64,AA==" }],
});

function post(headers: Record<string, string>): Request {
  return new Request(`${SITE}/api/lab/bake-icons`, {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "text/plain", ...headers },
    body: BODY,
  });
}

describe("POST /api/lab/bake-icons", () => {
  beforeEach(() => fs.writeFile.mockReset());

  it("refuses another site's page and writes nothing", async () => {
    const res = await POST(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "cross_site" });
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("refuses a POST with no Origin and writes nothing", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(403);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("writes for the studio's own page", async () => {
    const res = await POST(post({ origin: SITE, "sec-fetch-site": "same-origin" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, wrote: ["src/app/icon.png"] });
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
  });
});
