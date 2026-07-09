import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DriveTokenRevoked,
  ensureFolder,
  upsertFile,
} from "./drive-client";

interface Call {
  url: string;
  method: string;
  body?: string;
  contentType?: string;
}

function stubFetch(handler: (call: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: Call = {
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
        contentType: headers["Content-Type"],
      };
      calls.push(call);
      const { status, json } = handler(call);
      return new Response(json === undefined ? "" : JSON.stringify(json), {
        status,
      });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("drive-client — folder", () => {
  it("reuses a known folder that still exists", async () => {
    const calls = stubFetch((c) => {
      if (c.url.includes("/files/FOLDER1")) return { status: 200, json: { id: "FOLDER1", trashed: false } };
      throw new Error(`unexpected ${c.url}`);
    });
    expect(await ensureFolder("tok", "FOLDER1")).toBe("FOLDER1");
    expect(calls[0].url).toContain("/files/FOLDER1");
  });

  it("creates the folder when none is found", async () => {
    const calls = stubFetch((c) => {
      if (c.method === "GET" && c.url.includes("q=")) return { status: 200, json: { files: [] } };
      if (c.method === "POST") return { status: 200, json: { id: "NEWFOLDER" } };
      throw new Error(`unexpected ${c.method} ${c.url}`);
    });
    expect(await ensureFolder("tok", null)).toBe("NEWFOLDER");
    const create = calls.find((c) => c.method === "POST")!;
    expect(JSON.parse(create.body!)).toMatchObject({
      name: "Snippets",
      mimeType: "application/vnd.google-apps.folder",
    });
  });
});

describe("drive-client — upsert", () => {
  it("creates a new file with a multipart body when none exists", async () => {
    const calls = stubFetch((c) => {
      if (c.method === "GET") return { status: 200, json: { files: [] } };
      if (c.method === "POST") return { status: 200, json: { id: "FILE1" } };
      throw new Error(`unexpected ${c.method}`);
    });
    const id = await upsertFile("tok", {
      knownId: null,
      name: "Snippets archive.json",
      parentId: "FOLDER1",
      mimeType: "text/plain",
      body: '{"app":"snippets"}',
    });
    expect(id).toBe("FILE1");
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.url).toContain("/upload/drive/v3/files?uploadType=multipart");
    expect(create.contentType).toContain("multipart/related");
    // metadata part names it into the folder; media part is text/plain
    expect(create.body).toContain('"name":"Snippets archive.json"');
    expect(create.body).toContain('"parents":["FOLDER1"]');
    expect(create.body).toContain("Content-Type: text/plain");
  });

  it("updates in place via PATCH and RE-SETS the mimeType (the app-preview fix)", async () => {
    const calls = stubFetch((c) => {
      if (c.url.includes("/files/FILE1?fields=id,trashed"))
        return { status: 200, json: { id: "FILE1", trashed: false } };
      if (c.method === "PATCH") return { status: 200, json: { id: "FILE1" } };
      throw new Error(`unexpected ${c.method} ${c.url}`);
    });
    const id = await upsertFile("tok", {
      knownId: "FILE1",
      name: "Snippets 2026.md",
      parentId: "FOLDER1",
      mimeType: "text/plain",
      body: "# Snippets 2026",
    });
    expect(id).toBe("FILE1");
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("/upload/drive/v3/files/FILE1?uploadType=multipart");
    // the metadata part carries the mimeType so an old-typed file gets corrected
    expect(patch.body).toContain('"mimeType":"text/plain"');
    expect(patch.body).toContain("# Snippets 2026");
  });

  it("maps a 401 to DriveTokenRevoked (reconnect, not a crash)", async () => {
    stubFetch(() => ({ status: 401 }));
    await expect(
      upsertFile("tok", {
        knownId: "FILE1",
        name: "x.json",
        parentId: "F",
        mimeType: "text/plain",
        body: "x",
      }),
    ).rejects.toBeInstanceOf(DriveTokenRevoked);
  });
});
