import { describe, expect, it } from "vitest";
import {
  KeyMismatchError,
  LockedError,
  PAYLOAD_FORMAT_PLAIN,
  PAYLOAD_FORMAT_SEALED,
  PAYLOAD_FORMAT_SEALED_AAD,
  RefusedRowError,
  adoptServerRow,
  fromWireRow,
  needsReseal,
  toWireChange,
  type WireRow,
} from "./sync-wire";
import { aadForRow, encryptJSON, generateBookKey } from "./crypto";
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

describe("wire codec — sealed with AAD (format 3, the only format written)", () => {
  it("seals content, emits format 3, and round-trips with the key", async () => {
    const key = await generateBookKey();
    const s = snippet();
    const change = await toWireChange(s, key);
    expect(change.payloadFormat).toBe(PAYLOAD_FORMAT_SEALED_AAD);
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
    // re-sealed under a new key elsewhere, and this device still holds
    // the old one. The engine must see a typed "unlock again" — never a
    // generic error it would retry forever.
    const a = await generateBookKey();
    const b = await generateBookKey();
    const s = snippet();
    const row = rowFromChange(s.id, await toWireChange(s, a));
    await expect(fromWireRow(row, b)).rejects.toBeInstanceOf(KeyMismatchError);
  });
});

describe("wire codec — the AAD binding (a moved or edited envelope fails)", () => {
  // Every mutation of the cleartext fields a hostile server could make
  // must break decryption: swapping an envelope onto another row,
  // rolling a row back to an earlier clock, flipping its tombstone, or
  // relabeling its format. The failure surfaces as KeyMismatchError —
  // the engine's loud "unlock again", never a silently rearranged book.
  async function tamperedRow(mutate: (row: WireRow) => void) {
    const key = await generateBookKey();
    const row = rowFromChange(
      snippet().id,
      await toWireChange(snippet(), key),
    );
    mutate(row);
    return { key, row };
  }

  it("fails when the envelope is moved onto another row id", async () => {
    const { key, row } = await tamperedRow((r) => {
      r.id = "01HZY3ULIDSTOLENID001";
    });
    await expect(fromWireRow(row, key)).rejects.toBeInstanceOf(KeyMismatchError);
  });

  it("fails when the clock is rolled back", async () => {
    const { key, row } = await tamperedRow((r) => {
      r.updatedAt = r.updatedAt - 1_000;
    });
    await expect(fromWireRow(row, key)).rejects.toBeInstanceOf(KeyMismatchError);
  });

  it("fails when a tombstone is flipped on", async () => {
    const { key, row } = await tamperedRow((r) => {
      r.deletedAt = r.updatedAt;
    });
    await expect(fromWireRow(row, key)).rejects.toBeInstanceOf(KeyMismatchError);
  });

  it("fails when a tombstone is flipped off (resurrection)", async () => {
    const key = await generateBookKey();
    const s = snippet({ deletedAt: 1_700_000_001_000 });
    const row = rowFromChange(s.id, await toWireChange(s, key));
    row.deletedAt = null;
    await expect(fromWireRow(row, key)).rejects.toBeInstanceOf(KeyMismatchError);
  });

  it("fails when format 3 is relabeled as format 2 (downgrade)", async () => {
    // relabeling would ask for an AAD-less decrypt of an AAD-bound
    // envelope — the tag can't verify, so the downgrade is loud
    const { key, row } = await tamperedRow((r) => {
      r.payloadFormat = PAYLOAD_FORMAT_SEALED;
    });
    await expect(fromWireRow(row, key)).rejects.toBeInstanceOf(KeyMismatchError);
  });
});

describe("wire codec — rows no client writes are refused on pull", () => {
  const plainPayload = () => {
    const { id, updatedAt, deletedAt, _dirty, ...payload } = snippet();
    void id;
    void updatedAt;
    void deletedAt;
    void _dirty;
    return payload;
  };
  const refusal = (row: WireRow, key?: CryptoKey) =>
    fromWireRow(row, key).then(
      () => "opened",
      (e: unknown) => (e instanceof RefusedRowError ? e.reason : String(e)),
    );

  it("a plaintext (format 1) row is refused: a server can't plant a readable entry", async () => {
    const row: WireRow = {
      id: snippet().id,
      payloadFormat: PAYLOAD_FORMAT_PLAIN,
      payload: plainPayload(),
      updatedAt: 1_700_000_000_500,
      deletedAt: null,
      serverSeq: 1,
    };
    expect(await refusal(row, await generateBookKey())).toBe("plaintext");
  });

  it("an unknown format is refused, not decrypted without its AAD", async () => {
    const key = await generateBookKey();
    const row: WireRow = {
      id: snippet().id,
      payloadFormat: 7,
      payload: await encryptJSON(key, plainPayload()),
      updatedAt: 1_700_000_000_500,
      deletedAt: null,
      serverSeq: 1,
    };
    expect(await refusal(row, key)).toBe("unknown-format");
  });

  it("a sealed label on a non-envelope is refused, not read as a stale key", async () => {
    const row: WireRow = {
      id: snippet().id,
      payloadFormat: PAYLOAD_FORMAT_SEALED_AAD,
      payload: plainPayload(),
      updatedAt: 1_700_000_000_500,
      deletedAt: null,
      serverSeq: 1,
    };
    expect(await refusal(row, await generateBookKey())).toBe("not-an-envelope");
  });

  it("a payload-less row that isn't a deletion is refused", async () => {
    const row: WireRow = {
      id: snippet().id,
      payloadFormat: PAYLOAD_FORMAT_SEALED_AAD,
      payload: null,
      updatedAt: 1_700_000_000_500,
      deletedAt: null,
      serverSeq: 1,
    };
    expect(await refusal(row)).toBe("empty-live-row");
  });

  it("an AAD-less sealed (format 2) row still decrypts with the key", async () => {
    // legacy rows written before 2026-07-23 rest as format 2 until a
    // device re-seals them; adoptServerRow decides where they may land
    const key = await generateBookKey();
    const s = snippet();
    const row: WireRow = {
      id: s.id,
      payloadFormat: PAYLOAD_FORMAT_SEALED,
      payload: await encryptJSON(key, plainPayload()), // no AAD — the legacy seal
      updatedAt: s.updatedAt,
      deletedAt: null,
      serverSeq: 1,
    };
    const back = await fromWireRow(row, key);
    expect(back.text).toBe(s.text);
    expect(back.tags).toEqual(s.tags);
  });
});

describe("wire codec — tombstones", () => {
  it("a scrubbed tombstone decodes to a deleted ghost, even sealed & keyless", async () => {
    const row: WireRow = {
      id: "01HZY3ULIDEXAMPLE0002",
      payloadFormat: PAYLOAD_FORMAT_SEALED_AAD,
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

describe("adoptServerRow — a server can't rearrange the entries a device holds", () => {
  const NOW = 1_800_000_000_000;
  const held = snippet({ text: "the version this device holds", _dirty: 0 });

  async function sealedAt(over: Partial<Snippet>, format = PAYLOAD_FORMAT_SEALED_AAD) {
    const key = await generateBookKey();
    const s = snippet(over);
    const { id, updatedAt, deletedAt, _dirty, ...payload } = s;
    void _dirty;
    const clocks = { id, updatedAt, deletedAt: deletedAt ?? null };
    const row: WireRow = {
      ...clocks,
      payloadFormat: format,
      payload: await encryptJSON(
        key,
        payload,
        format === PAYLOAD_FORMAT_SEALED_AAD
          ? aadForRow({ ...clocks, payloadFormat: format })
          : undefined,
      ),
      serverSeq: 1,
    };
    return { row, decoded: await fromWireRow(row, key) };
  }

  it("refuses an older copy, though its AAD verifies (a replayed version)", async () => {
    const { row, decoded } = await sealedAt({
      text: "an earlier version",
      updatedAt: held.updatedAt - 1_000,
    });
    expect(adoptServerRow(row, decoded, held, false, NOW)).toBeNull();
  });

  it("refuses a pre-deletion copy replayed onto a deleted entry", async () => {
    const deleted = { ...held, deletedAt: held.updatedAt };
    const { row, decoded } = await sealedAt({ updatedAt: held.updatedAt - 1 });
    expect(adoptServerRow(row, decoded, deleted, false, NOW)).toBeNull();
  });

  it("takes a newer format-3 copy, and re-applies an equal clock", async () => {
    const newer = await sealedAt({ text: "edited elsewhere", updatedAt: held.updatedAt + 1 });
    expect(adoptServerRow(newer.row, newer.decoded, held, false, NOW)?.text).toBe(
      "edited elsewhere",
    );
    const same = await sealedAt({ updatedAt: held.updatedAt });
    expect(adoptServerRow(same.row, same.decoded, held, false, NOW)).not.toBeNull();
  });

  it("a contested (unsent) edit needs a strictly newer server copy", async () => {
    const dirty = { ...held, _dirty: 1 as const };
    const tie = await sealedAt({ updatedAt: held.updatedAt });
    expect(adoptServerRow(tie.row, tie.decoded, dirty, true, NOW)).toBeNull();
    const newer = await sealedAt({ updatedAt: held.updatedAt + 1 });
    expect(adoptServerRow(newer.row, newer.decoded, dirty, true, NOW)).not.toBeNull();
  });

  it("refuses an AAD-less format-2 envelope on a held entry, even with a newer clock", async () => {
    const { row, decoded } = await sealedAt(
      { text: "words moved here from another entry", updatedAt: held.updatedAt + 5_000 },
      PAYLOAD_FORMAT_SEALED,
    );
    expect(adoptServerRow(row, decoded, held, false, NOW)).toBeNull();
  });

  it("takes a format-2 entry the device doesn't hold, dirty for its re-seal", async () => {
    const { row, decoded } = await sealedAt({ updatedAt: 1_690_000_000_000 }, PAYLOAD_FORMAT_SEALED);
    const stored = adoptServerRow(row, decoded, undefined, false, NOW);
    expect(stored?._dirty).toBe(1);
    expect(stored!.updatedAt).toBeGreaterThan(row.updatedAt);
  });

  it("a payload-less deletion hides a held entry but keeps its words for 30 days", async () => {
    const row: WireRow = {
      id: held.id,
      payloadFormat: PAYLOAD_FORMAT_SEALED_AAD,
      payload: null,
      updatedAt: held.updatedAt + 1,
      deletedAt: 1_600_000_000_000, // a clock the server chose — not trusted
      serverSeq: 2,
    };
    const stored = adoptServerRow(row, await fromWireRow(row), held, false, NOW);
    expect(stored?.text).toBe(held.text);
    // the 30-day local recovery window starts now, not at the server's clock
    expect(stored?.deletedAt).toBe(NOW);
    expect(stored?.updatedAt).toBe(row.updatedAt);
    expect(stored?._dirty).toBe(0);
  });

  it("a payload-less deletion of an entry the device doesn't hold stores a ghost", async () => {
    const row: WireRow = {
      id: held.id,
      payloadFormat: PAYLOAD_FORMAT_SEALED_AAD,
      payload: null,
      updatedAt: held.updatedAt,
      deletedAt: held.updatedAt - 1,
      serverSeq: 2,
    };
    const stored = adoptServerRow(row, await fromWireRow(row), undefined, false, NOW);
    expect(stored?.text).toBe("");
    expect(stored?.deletedAt).toBe(held.updatedAt - 1);
  });
});

describe("needsReseal — which pulled rows re-dirty for their own re-seal", () => {
  const at = (payloadFormat: number, payload: unknown): WireRow => ({
    id: "01HZY3ULIDEXAMPLE0003",
    payloadFormat,
    payload: payload as WireRow["payload"],
    updatedAt: 1_700_000_000_000,
    deletedAt: null,
    serverSeq: 1,
  });
  const sealedShape = { v: 1, iv: "AA==", ct: "AA==" };

  it("format 2 (AAD-less envelope) re-seals", () => {
    expect(needsReseal(at(2, sealedShape))).toBe(true);
  });
  it("format 3 rests as it is", () => {
    expect(needsReseal(at(3, sealedShape))).toBe(false);
  });
  it("a scrubbed tombstone has nothing to re-seal, whatever its format", () => {
    expect(needsReseal(at(1, null))).toBe(false);
    expect(needsReseal(at(3, null))).toBe(false);
  });
});
