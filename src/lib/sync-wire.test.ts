import { describe, expect, it } from "vitest";
import {
  fromWireRow,
  toWireChange,
  KeyMismatchError,
  LockedError,
  PAYLOAD_FORMAT_PLAIN,
  PAYLOAD_FORMAT_SEALED,
  type WireRow,
} from "./sync-wire";
import { generateBookKey } from "./crypto";
import type { Snippet } from "./types";

const snippet = (over: Partial<Snippet> = {}): Snippet => ({
  id: "01HZY3ULIDEXAMPLE0001",
  text: "the moment most worth telling",
  title: "a small scene",
  kind: "story",
  tags: ["family"],
  attribution: undefined,
  capturedAt: 1_700_000_000_000,
  day: "2026-07-08",
  source: "typed",
  favorite: 0,
  updatedAt: 1_700_000_000_500,
  ...over,
});

function rowFromChange(id: string, c: Awaited<ReturnType<typeof toWireChange>>): WireRow {
  return {
    id,
    payloadFormat: c.payloadFormat,
    payload: c.payload,
    updatedAt: c.updatedAt,
    deletedAt: c.deletedAt,
    serverSeq: 1,
  };
}

describe("wire codec — plaintext (format 1)", () => {
  it("round-trips a snippet with no key", async () => {
    const s = snippet();
    const change = await toWireChange(s);
    expect(change.payloadFormat).toBe(PAYLOAD_FORMAT_PLAIN);
    const back = await fromWireRow(rowFromChange(s.id, change));
    expect(back.text).toBe(s.text);
    expect(back.title).toBe(s.title);
    expect(back._dirty).toBe(0);
  });
});

describe("wire codec — sealed (format 2)", () => {
  it("seals content and round-trips with the key", async () => {
    const key = await generateBookKey();
    const s = snippet();
    const change = await toWireChange(s, key);
    expect(change.payloadFormat).toBe(PAYLOAD_FORMAT_SEALED);
    // the words are not in the envelope
    expect(JSON.stringify(change.payload)).not.toContain("moment");
    expect(JSON.stringify(change.payload)).not.toContain("family");
    // identity + clocks stay outside the seal (the server merges on them)
    expect(change.updatedAt).toBe(s.updatedAt);

    const back = await fromWireRow(rowFromChange(s.id, change), key);
    expect(back.text).toBe(s.text);
    expect(back.tags).toEqual(s.tags);
    expect(back.day).toBe(s.day);
    expect(back.updatedAt).toBe(s.updatedAt);
  });

  it("a sealed row without the key throws LockedError (never partial plaintext)", async () => {
    const key = await generateBookKey();
    const s = snippet();
    const row = rowFromChange(s.id, await toWireChange(s, key));
    await expect(fromWireRow(row)).rejects.toBeInstanceOf(LockedError);
  });

  it("the wrong key fails as KeyMismatchError — the re-enrolled-elsewhere signal", async () => {
    // the exact situation of the stale-key trap: the account was
    // re-sealed under a new key (encryption off → on elsewhere), and
    // this device still holds the old one. The engine must see a typed
    // "unlock again" — never a generic error it would retry forever.
    const a = await generateBookKey();
    const b = await generateBookKey();
    const s = snippet();
    const row = rowFromChange(s.id, await toWireChange(s, a));
    await expect(fromWireRow(row, b)).rejects.toBeInstanceOf(KeyMismatchError);
  });
});

describe("wire codec — tombstones", () => {
  it("a scrubbed tombstone decodes to a deleted ghost, even sealed & keyless", async () => {
    const row: WireRow = {
      id: "01HZY3ULIDEXAMPLE0002",
      payloadFormat: PAYLOAD_FORMAT_SEALED,
      payload: null, // content scrubbed 30 days after deletion
      updatedAt: 1_700_000_000_000,
      deletedAt: 1_699_000_000_000,
      serverSeq: 9,
    };
    const back = await fromWireRow(row); // no key needed
    expect(back.deletedAt).toBe(1_699_000_000_000);
    expect(back.text).toBe("");
  });

  it("carries a live deletedAt through the seal", async () => {
    const key = await generateBookKey();
    const s = snippet({ deletedAt: 1_700_000_001_000 });
    const back = await fromWireRow(rowFromChange(s.id, await toWireChange(s, key)), key);
    expect(back.deletedAt).toBe(1_700_000_001_000);
  });
});
