import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The status route turns the ledger's raw failure line into the cause
 * Settings prints. Every sync cycle calls this route, so these tests run
 * the real handler; only the database and session are mocked.
 */
const rows = vi.hoisted(() => ({
  counts: [{ entryCount: 12, maxSeq: 40 }] as object[],
  backup: [] as object[],
}));

vi.mock("@/server/db", () => {
  // each select().from().where() resolves to the next result set: the
  // counts query first, then the ledger row
  const select = vi.fn(() => {
    const result = select.mock.calls.length % 2 === 1 ? rows.counts : rows.backup;
    return { from: () => ({ where: async () => result }) };
  });
  return {
    serverDb: { select },
    schema: {
      snippets: { userId: {} },
      backupStatus: { userId: {}, provider: {} },
    },
  };
});
vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof import("drizzle-orm")>()),
  eq: vi.fn(),
  and: vi.fn(),
}));
vi.mock("@/server/auth", () => ({
  getSession: vi.fn(async () => ({ user: { id: "user-1" } })),
}));

import { GET } from "./route";
import { serverDb } from "@/server/db";

const ledger = {
  state: "active",
  lastSuccessAt: new Date("2026-10-17T03:05:00Z"),
  consecutiveFailures: 0,
  lastBackedUpSeq: 39,
  lastError: null as string | null,
};

async function status() {
  const res = await GET(new Request("http://test/api/sync/status"));
  expect(res.status).toBe(200);
  return (await res.json()) as {
    backup: { failure: string | null; failureDetail: string | null; behind: boolean };
  };
}

beforeEach(() => {
  vi.mocked(serverDb!.select).mockClear();
});

describe("status route — the ledger's cause", () => {
  it("a reported failure arrives classified, with the line verbatim", async () => {
    const line =
      "drive 403 storageQuotaExceeded: The user's Drive storage quota has been exceeded.";
    rows.backup = [{ ...ledger, state: "error", lastError: line }];
    const { backup } = await status();
    expect(backup.failure).toBe("storage");
    expect(backup.failureDetail).toBe(line);
    expect(backup.behind).toBe(true);
  });

  it("a line written by an older device still classifies", async () => {
    rows.backup = [{ ...ledger, state: "error", lastError: "Load failed" }];
    expect((await status()).backup.failure).toBe("network");
  });

  it("an active ledger carries no cause, even with an old error line", async () => {
    rows.backup = [{ ...ledger, lastError: "grant revoked" }];
    const { backup } = await status();
    expect(backup.failure).toBeNull();
    expect(backup.failureDetail).toBeNull();
  });
});
