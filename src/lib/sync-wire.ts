/**
 * The sync wire format, shared by the client engine and the API
 * routes. A snippet travels as identity + clocks + an opaque payload
 * envelope: everything except `id`/`updatedAt`/`deletedAt`/`_dirty`
 * lives inside `payload`, so a future end-to-end-encrypted format is
 * a `payloadFormat` bump — the protocol itself never changes shape.
 */
import type { Snippet } from "@/lib/types";
import {
  decryptJSON,
  encryptJSON,
  isEncryptedPayload,
  type EncryptedPayload,
} from "@/lib/crypto";

/** format 1: the payload is the snippet's content fields, plaintext JSON */
export const PAYLOAD_FORMAT_PLAIN = 1;
/** format 2: the payload is an AES-GCM envelope only the writer's devices can open */
export const PAYLOAD_FORMAT_SEALED = 2;

export type SnippetPayload = Omit<
  Snippet,
  "id" | "updatedAt" | "deletedAt" | "_dirty"
>;

export interface WireChange {
  id: string;
  payloadFormat: number;
  payload: SnippetPayload | EncryptedPayload;
  updatedAt: number;
  deletedAt: number | null;
}

export interface WireRow {
  id: string;
  payloadFormat: number;
  /** null once a tombstone's content has been scrubbed (30 days after delete) */
  payload: SnippetPayload | EncryptedPayload | null;
  updatedAt: number;
  deletedAt: number | null;
  serverSeq: number;
}

export type PushResult =
  | { id: string; outcome: "applied" }
  | {
      /** the server's copy won; here it is — adopt it */
      id: string;
      outcome: "superseded";
      row: WireRow;
    };

export interface PushResponse {
  results: PushResult[];
  serverNow: number;
  maxSeq: number;
}

export interface PullResponse {
  rows: WireRow[];
  nextCursor: number;
  hasMore: boolean;
}

export interface BackupStatusSummary {
  state: "active" | "disconnected" | "error";
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

export interface StatusResponse {
  /** non-deleted rows on the server */
  entryCount: number;
  maxSeq: number;
  backup: BackupStatusSummary | null;
}

/** Thrown when a sealed row arrives and this device holds no key. */
export class LockedError extends Error {
  constructor() {
    super("the book key is not on this device");
    this.name = "LockedError";
  }
}

/**
 * Encode a snippet for the wire. With a book key, the content fields
 * seal into an AES-GCM envelope (format 2); without, plaintext
 * (format 1). Identity and the sync clocks stay outside either way —
 * they're what the server merges on.
 */
export async function toWireChange(
  s: Snippet,
  key?: CryptoKey,
): Promise<WireChange> {
  const { id, updatedAt, deletedAt, _dirty, ...payload } = s;
  void _dirty;
  return {
    id,
    payloadFormat: key ? PAYLOAD_FORMAT_SEALED : PAYLOAD_FORMAT_PLAIN,
    payload: key ? await encryptJSON(key, payload) : payload,
    updatedAt,
    deletedAt: deletedAt ?? null,
  };
}

function ghostTombstone(row: WireRow): Snippet {
  // a scrubbed tombstone: identity and clocks only, content long gone.
  // It exists locally just to keep the deletion; every read filters it.
  return {
    id: row.id,
    text: "",
    kind: null,
    tags: [],
    capturedAt: row.updatedAt,
    day: "",
    source: "typed",
    favorite: 0,
    enriched: "off",
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt ?? row.updatedAt,
    _dirty: 0,
  };
}

/** Decode a wire row; sealed rows need the book key or LockedError. */
export async function fromWireRow(
  row: WireRow,
  key?: CryptoKey,
): Promise<Snippet> {
  if (!row.payload) return ghostTombstone(row);

  let payload: SnippetPayload;
  if (row.payloadFormat === PAYLOAD_FORMAT_SEALED || isEncryptedPayload(row.payload)) {
    if (!key) throw new LockedError();
    payload = await decryptJSON<SnippetPayload>(
      key,
      row.payload as EncryptedPayload,
    );
  } else {
    payload = row.payload as SnippetPayload;
  }
  return {
    ...payload,
    id: row.id,
    updatedAt: row.updatedAt,
    ...(row.deletedAt !== null ? { deletedAt: row.deletedAt } : {}),
    _dirty: 0,
  };
}
