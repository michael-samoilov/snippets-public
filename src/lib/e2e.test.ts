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

describe("enroll — the recovery code survives everything past the commit", () => {
  /** the module under test plus the SAME mocked db instance it imported */
  async function freshEnroll() {
    vi.resetModules();
    const e2e = await import("./e2e");
    const db = await import("@/lib/db");
    // the mock factory's fn instances persist across resetModules — start
    // each test with clean call records or assertions read earlier tests
    vi.mocked(db.setMeta).mockClear();
    vi.mocked(db.reencryptSweep).mockClear();
    return { e2e, db };
  }
  // five dash-joined groups of five, in crypto.ts's CODE_ALPHABET
  const CODE_SHAPE = /^[A-Z0-9]{5}(-[A-Z0-9]{5}){4}$/;

  it("returns the code and installs the key when everything lands", async () => {
    const { e2e, db } = await freshEnroll();
    fetchMock.mockResolvedValueOnce(status(200));
    const sealed = await e2e.enroll("a strong enough passphrase");
    expect(sealed.device).toBe("unlocked");
    expect(sealed.recoveryCode).toMatch(CODE_SHAPE);
    expect(vi.mocked(db.setMeta)).toHaveBeenCalledWith(
      "e2e:bookKey",
      expect.any(CryptoKey),
    );
  });

  it("still returns the code when the re-encryption sweep fails", async () => {
    // the sweep flag was never set, so maybeAadSweep re-runs it next cycle —
    // but the code has no second chance, so it must come back regardless
    const { e2e, db } = await freshEnroll();
    vi.mocked(db.reencryptSweep).mockRejectedValueOnce(new Error("tx died"));
    fetchMock.mockResolvedValueOnce(status(200));
    const sealed = await e2e.enroll("a strong enough passphrase");
    expect(sealed.recoveryCode).toMatch(CODE_SHAPE);
    expect(sealed.device).toBe("unlocked");
  });

  it("still returns the code when the local key install fails", async () => {
    // the account is sealed either way; the device lands in the ordinary
    // locked state, whose unlock form takes the passphrase just typed
    const { e2e, db } = await freshEnroll();
    vi.mocked(db.setMeta).mockRejectedValueOnce(new Error("quota"));
    fetchMock.mockResolvedValueOnce(status(200));
    const sealed = await e2e.enroll("a strong enough passphrase");
    expect(sealed.recoveryCode).toMatch(CODE_SHAPE);
    expect(sealed.device).toBe("keyPending");
  });

  it("returns no code when the PUT did not commit", async () => {
    // the inverse hazard: never show a code for an account that is not sealed
    const { e2e, db } = await freshEnroll();
    fetchMock.mockResolvedValueOnce(status(500));
    await expect(e2e.enroll("a strong enough passphrase")).rejects.toThrow(
      "keys 500",
    );
    expect(vi.mocked(db.setMeta)).not.toHaveBeenCalled();
    expect(vi.mocked(db.reencryptSweep)).not.toHaveBeenCalled();
  });

  it("a 409 is its own error, so the retry dead end can say something true", async () => {
    const { e2e } = await freshEnroll();
    fetchMock.mockResolvedValueOnce(status(409));
    await expect(e2e.enroll("a strong enough passphrase")).rejects.toBeInstanceOf(
      e2e.AlreadyEnrolledError,
    );
  });
});
