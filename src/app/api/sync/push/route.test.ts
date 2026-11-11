import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The server side of "we cannot read your entries": the push route must
 * refuse plaintext no matter what the client says. These tests exercise
 * the enforcement that runs BEFORE the database transaction (formats,
 * envelope shape, size, auth), with the db and session mocked — the
 * merge/LWW behaviour behind the transaction has its own coverage in
 * merge.test.ts and the two-profile browser harness.
 */
vi.mock("@/server/db", () => ({
  serverDb: { transaction: vi.fn(async () => {}) },
  schema: { snippets: {} },
}));
vi.mock("@/server/auth", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

import { POST } from "./route";
import { getSession } from "@/server/auth";


const sealed = {
  v: 1,
  iv: "AAAAAAAAAAAAAAAA",
  ct: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
};

function push(changes: unknown[]): Request {
  return new Request("http://test/api/sync/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}

const base = {
  id: "01HZY3ULIDEXAMPLE0001",
  updatedAt: 1_700_000_000_500,
  deletedAt: null,
};

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({
    user: { id: "user-1" },
  } as Awaited<ReturnType<typeof getSession>>);
});

describe("push route — plaintext refusal", () => {
  it("refuses a format-1 (plaintext) push with the distinct 409", async () => {
    const res = await POST(
      push([{ ...base, payloadFormat: 1, payload: { text: "readable" } }]),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "encryption_required" });
  });

  it("refuses the 409 even when plaintext hides among sealed changes", async () => {
    const res = await POST(
      push([
        { ...base, payloadFormat: 3, payload: sealed },
        { ...base, id: "01HZY3ULIDEXAMPLE0002", payloadFormat: 1, payload: { text: "readable" } },
      ]),
    );
    expect(res.status).toBe(409);
  });

  it("refuses a sealed format wrapping plaintext fields (mislabeled) as malformed", async () => {
    const res = await POST(
      push([
        { ...base, payloadFormat: 3, payload: { text: "readable", day: "2026-07-23" } },
      ]),
    );
    expect(res.status).toBe(400);
  });

  it("refuses extra fields riding an otherwise-valid envelope", async () => {
    // .strict() on the envelope: nothing readable can hitchhike beside iv/ct
    const res = await POST(
      push([
        { ...base, payloadFormat: 3, payload: { ...sealed, text: "readable" } },
      ]),
    );
    expect(res.status).toBe(400);
  });

  it("refuses unknown future formats rather than storing them blind", async () => {
    const res = await POST(
      push([{ ...base, payloadFormat: 4, payload: sealed }]),
    );
    expect(res.status).toBe(400);
  });

  it("accepts format 3, the only format a current client writes", async () => {
    const res = await POST(push([{ ...base, payloadFormat: 3, payload: sealed }]));
    expect(res.status).toBe(200);
  });

  it("refuses the AAD-less legacy format 2, so every new row is bound", async () => {
    const res = await POST(push([{ ...base, payloadFormat: 2, payload: sealed }]));
    expect(res.status).toBe(400);
  });

  it("still answers 401 signed out and 413 oversized first", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(
      null as unknown as Awaited<ReturnType<typeof getSession>>,
    );
    const signedOut = await POST(
      push([{ ...base, payloadFormat: 3, payload: sealed }]),
    );
    expect(signedOut.status).toBe(401);

    const big = await POST(
      push([
        {
          ...base,
          payloadFormat: 3,
          payload: { ...sealed, ct: "A".repeat(70_000) },
        },
      ]),
    );
    expect(big.status).toBe(413);
  });
});
