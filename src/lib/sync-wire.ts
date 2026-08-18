/**
 * The sync wire format, shared by the client engine and the API
 * routes. A snippet travels as identity + clocks + an opaque payload
 * envelope: everything except `id`/`updatedAt`/`deletedAt`/`_dirty`
 * lives inside `payload`, so a future end-to-end-encrypted format is
 * a `payloadFormat` bump — the protocol itself never changes shape.
 */
import type { Snippet } from "@/lib/types";
import {
  aadForRow,
  decryptJSON,
  encryptJSON,
  isEncryptedPayload,
  type EncryptedPayload,
} from "@/lib/crypto";

/** format 1: the payload is the snippet's content fields, plaintext JSON.
    Legacy — the client no longer writes it and the server refuses it on
    push; it survives here only so old server rows still open on pull. */
export const PAYLOAD_FORMAT_PLAIN = 1;
/** format 2: an AES-GCM envelope only the writer's devices can open.
    Legacy — readable, never written; re-sealed as format 3 on next push. */
export const PAYLOAD_FORMAT_SEALED = 2;
/** format 3: format 2 plus the row's cleartext fields (`id`, `updatedAt`,
    `deletedAt`, `payloadFormat`) bound into the cipher as AES-GCM AAD, so
    a moved, rolled-back, or resurrected envelope fails to open. */
export const PAYLOAD_FORMAT_SEALED_AAD = 3;

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

/**
 * A row still resting on the server in an older format (plaintext 1 or
 * AAD-less 2) must be re-dirtied on pull, so its own next push re-seals
 * it as format 3. A scrubbed tombstone (`payload: null`) has nothing to
 * re-seal. This is the one rule behind the legacy books converging on
 * format 3, so it lives here with the format constants rather than as a
 * comparison a caller has to remember.
 */
export function needsReseal(row: WireRow): boolean {
  return row.payload !== null && row.payloadFormat < PAYLOAD_FORMAT_SEALED_AAD;
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
  /** the book has moved past the last delivered seq — a stale ledger matters
      only while this is true (a dormant book is allowed to rest) */
  behind: boolean;
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
 * Thrown when a sealed row won't open under the key this device holds —
 * the account was re-encrypted elsewhere (encryption turned off and back
 * on), so the key here is stale. The sync engine treats it as "this
 * device must unlock again", never as a transient snag to retry forever.
 */
export class KeyMismatchError extends Error {
  constructor() {
    super("the book key on this device no longer opens the account's entries");
    this.name = "KeyMismatchError";
  }
}

/**
 * Encode a snippet for the wire: the content fields seal into an
 * AES-GCM envelope with the row's identity and clocks bound in as AAD
 * (format 3). Identity and the sync clocks stay outside — they're what
 * the server merges on — but the AAD binding means they can't be
 * *changed* without the envelope refusing to open. There is no
 * plaintext branch: the key is required, so a plaintext push is a
 * compile error, not a runtime path.
 */
export async function toWireChange(
  s: Snippet,
  key: CryptoKey,
): Promise<WireChange> {
  const { id, updatedAt, deletedAt, _dirty, ...payload } = s;
  void _dirty;
  const clocks = { id, updatedAt, deletedAt: deletedAt ?? null };
  return {
    ...clocks,
    payloadFormat: PAYLOAD_FORMAT_SEALED_AAD,
    payload: await encryptJSON(
      key,
      payload,
      aadForRow({ ...clocks, payloadFormat: PAYLOAD_FORMAT_SEALED_AAD }),
    ),
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
  if (
    row.payloadFormat === PAYLOAD_FORMAT_SEALED ||
    row.payloadFormat === PAYLOAD_FORMAT_SEALED_AAD ||
    isEncryptedPayload(row.payload)
  ) {
    if (!key) throw new LockedError();
    try {
      payload = await decryptJSON<SnippetPayload>(
        key,
        row.payload as EncryptedPayload,
        // format 3 recomputes the AAD from the wire row's own cleartext
        // fields — if the server moved, rolled back, or resurrected the
        // envelope, the recomputed AAD differs and decryption fails.
        // Legacy format-2 seals carry no AAD.
        row.payloadFormat === PAYLOAD_FORMAT_SEALED_AAD
          ? aadForRow({
              id: row.id,
              updatedAt: row.updatedAt,
              deletedAt: row.deletedAt,
              payloadFormat: row.payloadFormat,
            })
          : undefined,
      );
    } catch {
      // a key we hold that doesn't open the row = the account was
      // re-sealed under a new key elsewhere, OR (format 3) the row's
      // cleartext fields no longer match what was sealed — a tampered
      // envelope. Either way: fail as "unlock again", loud, never a
      // garbled row or an endless retry.
      throw new KeyMismatchError();
    }
  } else {
    payload = row.payload as SnippetPayload;
  }
  // old server rows may still carry the retired `enriched` field inside
  // their payload — drop it so it never re-enters the local model
  const { enriched, ...clean } = payload as SnippetPayload & {
    enriched?: unknown;
  };
  void enriched;
  return {
    ...clean,
    id: row.id,
    updatedAt: row.updatedAt,
    ...(row.deletedAt !== null ? { deletedAt: row.deletedAt } : {}),
    _dirty: 0,
  };
}
