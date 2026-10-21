import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The token exchange tells the device WHY Google refused, because the
 * device's failure line (and with it the cause Settings and the email
 * print) is built from this answer. Session mocked; Google's token
 * endpoint stubbed with its documented error bodies.
 */
vi.mock("@/server/auth", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

import { POST } from "./route";
import { getSession } from "@/server/auth";

function refresh(): Request {
  return new Request("http://test/api/backup/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: "1//refresh-token-example" }),
  });
}

function google(status: number, body: object) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  vi.mocked(getSession).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof getSession>>);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("refresh route — Google's verdict travels back", () => {
  it("invalid_grant → 401 revoked, with Google's code and words", async () => {
    google(400, {
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    });
    const res = await POST(refresh());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "revoked",
      google: "invalid_grant",
      description: "Token has been expired or revoked.",
    });
  });

  it("invalid_client → 502 that names it (our configuration, not the grant)", async () => {
    google(401, {
      error: "invalid_client",
      error_description: "The OAuth client was not found.",
    });
    const res = await POST(refresh());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({
      error: "refresh failed",
      google: "invalid_client",
    });
  });

  it("a body-less Google failure still names its HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>oops</html>", { status: 500 })),
    );
    const res = await POST(refresh());
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ google: "http 500" });
  });

  it("success returns the access token only", async () => {
    google(200, { access_token: "ya29.example", expires_in: 3599 });
    const res = await POST(refresh());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      accessToken: "ya29.example",
      expiresIn: 3599,
    });
  });

  it("an expired Snippets session is a different 401: no `revoked`", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await POST(refresh());
    expect(res.status).toBe(401);
    // the device deletes its Drive token only on error === "revoked"
    expect(await res.json()).toEqual({ error: "signed out" });
  });
});
