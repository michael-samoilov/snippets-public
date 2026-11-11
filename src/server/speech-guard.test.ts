import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gate in front of the routes that spend provider credit. Runs the
 * in-memory count (no database here); the Postgres statement was proven
 * against a real Postgres when it landed (see SECURITY-STATE.md).
 * Each case uses its own address so the shared count never leaks
 * between cases.
 */
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ serverDb: null, schema: {} }));

import { speechGuard, SPEECH_BUDGETS, tokenTtlSeconds } from "./speech-guard";
import { POST as transcribe } from "@/app/api/transcribe/route";
import { POST as deepgramToken } from "@/app/api/deepgram-token/route";

const SITE = "http://127.0.0.1:3000";

function call(
  path: string,
  ip: string,
  headers: Record<string, string> = {},
  body?: BodyInit,
): Request {
  return new Request(`${SITE}${path}`, {
    method: "POST",
    headers: {
      host: "127.0.0.1:3000",
      origin: SITE,
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": ip,
      ...headers,
    },
    body,
  });
}

describe("speechGuard — who may spend", () => {
  it("lets the app's own page through", async () => {
    expect(await speechGuard(call("/api/x", "10.0.0.1"), "token")).toBeNull();
  });

  it("refuses another site's page (Sec-Fetch-Site)", async () => {
    const res = await speechGuard(
      call("/api/x", "10.0.0.2", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }),
      "token",
    );
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "cross_site" });
  });

  it("refuses a same-site sibling too: only same-origin passes", async () => {
    const res = await speechGuard(
      call("/api/x", "10.0.0.3", { "sec-fetch-site": "same-site" }),
      "token",
    );
    expect(res?.status).toBe(403);
  });

  it("refuses a foreign Origin when the browser sends no Sec-Fetch-Site", async () => {
    const req = new Request(`${SITE}/api/x`, {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "https://evil.example", "x-forwarded-for": "10.0.0.4" },
    });
    expect((await speechGuard(req, "token"))?.status).toBe(403);
  });

  it("refuses a request with no Origin (every browser POST has one)", async () => {
    const req = new Request(`${SITE}/api/x`, {
      method: "POST",
      headers: { host: "127.0.0.1:3000", "x-forwarded-for": "10.0.0.5" },
    });
    expect((await speechGuard(req, "token"))?.status).toBe(403);
  });

  it("compares Origin with the forwarded host behind the platform proxy", async () => {
    const req = new Request("http://internal/api/x", {
      method: "POST",
      headers: {
        host: "internal",
        "x-forwarded-host": "www.snippets.ink",
        origin: "https://www.snippets.ink",
        "sec-fetch-site": "same-origin",
        "x-forwarded-for": "10.0.0.6",
      },
    });
    expect(await speechGuard(req, "token")).toBeNull();
  });
});

describe("speechGuard — how much", () => {
  it("allows the budget, then answers 429 with Retry-After", async () => {
    const { limit, windowMs } = SPEECH_BUDGETS.transcribe;
    for (let i = 0; i < limit; i++) {
      expect(await speechGuard(call("/api/x", "10.1.0.1"), "transcribe")).toBeNull();
    }
    const res = await speechGuard(call("/api/x", "10.1.0.1"), "transcribe");
    expect(res?.status).toBe(429);
    const retry = Number(res?.headers.get("retry-after"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(windowMs / 1000);
  });

  it("counts each address on its own", async () => {
    const { limit } = SPEECH_BUDGETS.token;
    for (let i = 0; i <= limit; i++) await speechGuard(call("/api/x", "10.1.0.2"), "token");
    expect(await speechGuard(call("/api/x", "10.1.0.3"), "token")).toBeNull();
  });

  describe("window end", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("opens a fresh window once the old one ends", async () => {
      const { limit, windowMs } = SPEECH_BUDGETS.token;
      for (let i = 0; i <= limit; i++) await speechGuard(call("/api/x", "10.1.0.4"), "token");
      expect((await speechGuard(call("/api/x", "10.1.0.4"), "token"))?.status).toBe(429);
      vi.advanceTimersByTime(windowMs);
      expect(await speechGuard(call("/api/x", "10.1.0.4"), "token")).toBeNull();
    });
  });
});

describe("tokenTtlSeconds — a leaked token stays good for 10 minutes at most", () => {
  it.each([
    [undefined, 300],
    ["120", 120],
    ["86400", 600],
    ["5", 60],
    ["not-a-number", 300],
  ])("%s → %d", (raw, want) => {
    expect(tokenTtlSeconds(raw)).toBe(want);
  });
});

describe("the routes run the gate before spending", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("transcribe refuses an oversized upload by its declared size, without reading it", async () => {
    vi.stubEnv("TRANSCRIBE_API_KEY", "test-key");
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    let pulled = false;
    // highWaterMark 0: the stream pulls only when someone reads it
    const body = new ReadableStream(
      {
        pull() {
          pulled = true;
          throw new Error("the body was read");
        },
      },
      { highWaterMark: 0 },
    );
    // a stream body needs duplex, which the DOM RequestInit type lacks
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: SITE,
        "sec-fetch-site": "same-origin",
        "x-forwarded-for": "10.2.0.1",
        "content-length": String(30 * 1024 * 1024),
        "content-type": "multipart/form-data; boundary=x",
      },
      body,
      duplex: "half",
    };
    const req = new Request(`${SITE}/api/transcribe`, init);
    const res = await transcribe(req);
    expect(res.status).toBe(413);
    expect(pulled).toBe(false);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("transcribe refuses a cross-site upload before the provider sees it", async () => {
    vi.stubEnv("TRANSCRIBE_API_KEY", "test-key");
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(1000)], { type: "audio/webm" }));
    const res = await transcribe(
      call("/api/transcribe", "10.2.0.2", { "sec-fetch-site": "cross-site", origin: "https://evil.example" }, form),
    );
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("transcribe passes a normal upload through to the provider", async () => {
    vi.stubEnv("TRANSCRIBE_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ text: "the quick brown fox" })),
    );
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(1000)], { type: "audio/webm" }));
    const res = await transcribe(call("/api/transcribe", "10.2.0.3", {}, form));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "the quick brown fox" });
  });

  it("a token route mints for the app, refuses a burst, and asks for a capped lifetime", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "test-key");
    const upstream = vi.fn(async (_url: string, init: RequestInit) => {
      const { ttl_seconds } = JSON.parse(String(init.body));
      return Response.json({ access_token: "jwt", expires_in: ttl_seconds });
    });
    vi.stubGlobal("fetch", upstream);
    const first = await deepgramToken(call("/api/deepgram-token", "10.2.0.4"));
    expect(first.status).toBe(200);
    expect((await first.json()).expiresIn).toBeLessThanOrEqual(600);

    const { limit } = SPEECH_BUDGETS.token;
    let last = first;
    for (let i = 1; i <= limit; i++) last = await deepgramToken(call("/api/deepgram-token", "10.2.0.4"));
    expect(last.status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(limit);
  });
});
