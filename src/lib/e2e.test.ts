/**
 * The enrollment probe is a security decision, not a convenience: the
 * sync engine pushes PLAINTEXT whenever it believes the account is not
 * enrolled. These tests pin the fallback rule — a cached "true" may
 * stand in during an outage (worst case: we lock, which is safe), but a
 * cached "false" never may (worst case: plaintext lands in a book that
 * was sealed elsewhere in the meantime).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  getMeta: vi.fn(async () => undefined),
  setMeta: vi.fn(async () => {}),
  deleteMeta: vi.fn(async () => {}),
  reencryptSweep: vi.fn(async () => {}),
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

/** e2e.ts caches enrollment in module state — start each test clean. */
async function freshE2E() {
  vi.resetModules();
  return import("./e2e");
}

const status = (code: number) => new Response(null, { status: code });

beforeEach(() => {
  fetchMock.mockReset();
});

describe("refreshEnrollment — the plaintext-push gate", () => {
  it("a clean 404 means not enrolled (plaintext sync may proceed)", async () => {
    const { refreshEnrollment } = await freshE2E();
    fetchMock.mockResolvedValueOnce(status(404));
    expect(await refreshEnrollment()).toBe(false);
  });

  it("a 200 means enrolled", async () => {
    const { refreshEnrollment } = await freshE2E();
    fetchMock.mockResolvedValueOnce(status(200));
    expect(await refreshEnrollment()).toBe(true);
  });

  it("a server error with nothing cached is unknown — refuse to guess", async () => {
    const { refreshEnrollment } = await freshE2E();
    fetchMock.mockResolvedValueOnce(status(500));
    expect(await refreshEnrollment()).toBe("unknown");
  });

  it("a network failure with nothing cached is unknown", async () => {
    const { refreshEnrollment } = await freshE2E();
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await refreshEnrollment()).toBe("unknown");
  });

  it("a cached TRUE survives an outage — failing toward locked is safe", async () => {
    const { refreshEnrollment } = await freshE2E();
    fetchMock.mockResolvedValueOnce(status(200));
    await refreshEnrollment();
    fetchMock.mockResolvedValueOnce(status(500));
    expect(await refreshEnrollment()).toBe(true);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await refreshEnrollment()).toBe(true);
  });

  it("a cached FALSE does NOT survive an outage — never a licence to push plaintext", async () => {
    const { refreshEnrollment } = await freshE2E();
    fetchMock.mockResolvedValueOnce(status(404));
    await refreshEnrollment(); // caches false
    fetchMock.mockResolvedValueOnce(status(500));
    expect(await refreshEnrollment()).toBe("unknown");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await refreshEnrollment()).toBe("unknown");
  });
});
