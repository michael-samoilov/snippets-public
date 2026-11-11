/**
 * The sync wire format, shared by the client engine and the API
 * routes. A snippet travels as identity + clocks + an opaque payload
 * envelope: everything except `id`/`updatedAt`/`deletedAt`/`_dirty`
 * lives inside `payload`, so a future end-to-end-encrypted format is
 * a `payloadFormat` bump — the protocol itself never changes shape.
 */
import type { Snippet } from "@/lib/types";
import type { BackupFailure } from "@/lib/backup-shared";
import { bumpClock, incomingWins } from "@/lib/merge";
import {
  aadForRow,
  decryptJSON,
  encryptJSON,
  isEncryptedPayload,
  type EncryptedPayload,
} from "@/lib/crypto";

/** format 1: the payload is the snippet's content fields, plaintext JSON.
    Retired: the server has refused it on push since 2026-07-23, and a
    device refuses it on pull, so a server can't plant a readable entry. */
export const PAYLOAD_FORMAT_PLAIN = 1;
/** format 2: an AES-GCM envelope only the writer's devices can open, with
    no AAD. Legacy — nothing writes it (the server refuses it on push). A
    device opens it only for an entry it doesn't hold yet, and re-seals it
    as format 3 on its next push (see `adoptServerRow`). */
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
 * A row still resting on the server in the AAD-less format 2 must be
 * re-dirtied on pull, so its own next push re-seals it as format 3. A
 * scrubbed tombstone (`payload: null`) has nothing to re-seal, and a
 * format-1 row never gets this far (`fromWireRow` refuses it). This is
 * the one rule behind legacy books converging on format 3, so it lives
 * here with the format constants rather than as a comparison a caller
 * has to remember.
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
  /** why the last delivery failed, read from the device's report; null
      unless state is "error" */
  failure: BackupFailure | null;
  /** that report verbatim, for the cause Snippets doesn't recognize */
  failureDetail: string | null;
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
 * Thrown for a server row that no current client writes, so a device
 * refuses to store it: plaintext (format 1), an unknown format, a sealed
 * format whose payload isn't an envelope, or a row with no payload that
 * isn't a deletion. Such a row can only come from a server writing
 * something on its own. The pull applier skips it and the push path
 * re-asserts the device's own copy; it is never a lock or a retry loop.
 */
export class RefusedRowError extends Error {
  constructor(
    readonly reason:
      | "plaintext"
      | "unknown-format"
      | "not-an-envelope"
      | "empty-live-row",
  ) {
    super(`refused server row: ${reason}`);
    this.name = "RefusedRowError";
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

function ghostTombstone(row: WireRow, deletedAt: number): Snippet {
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
    deletedAt,
    _dirty: 0,
  };
}

/**
 * Decode a wire row. Sealed rows need the book key or LockedError; a row
 * no current client writes throws RefusedRowError (see there).
 */
export async function fromWireRow(
  row: WireRow,
  key?: CryptoKey,
): Promise<Snippet> {
  if (row.payload === null) {
    // the cron nulls a payload only on a row deleted 30+ days ago, so a
    // payload-less LIVE row is something no server rule produces
    if (row.deletedAt === null) throw new RefusedRowError("empty-live-row");
    return ghostTombstone(row, row.deletedAt);
  }
  if (
    row.payloadFormat !== PAYLOAD_FORMAT_SEALED &&
    row.payloadFormat !== PAYLOAD_FORMAT_SEALED_AAD
  )
    throw new RefusedRowError(
      row.payloadFormat === PAYLOAD_FORMAT_PLAIN ? "plaintext" : "unknown-format",
    );
  // a sealed label on a non-envelope is refused here, before decryption,
  // so it can't pass for a stale key and wipe this device's key
  if (!isEncryptedPayload(row.payload))
    throw new RefusedRowError("not-an-envelope");
  if (!key) throw new LockedError();

  let payload: SnippetPayload;
  try {
    payload = await decryptJSON<SnippetPayload>(
      key,
      row.payload,
      // format 3 recomputes the AAD from the wire row's own cleartext
      // fields — if the server moved the envelope or changed its clocks,
      // the recomputed AAD differs and decryption fails. Legacy format-2
      // seals carry no AAD; adoptServerRow keeps them off held entries.
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

/**
 * What a device stores for a decoded server row, given its own copy of
 * the entry (`local`), or null to keep that copy. AAD stops a server
 * from moving an envelope or editing its clocks, but not from resending
 * an envelope under the clocks it was sealed with. Three rules close
 * that gap for every entry a device already holds:
 *   - never go back: a copy older than the device's is refused, so an
 *     earlier version or a pre-deletion copy can't be replayed onto it;
 *   - an AAD-less format-2 envelope can't replace a held copy: nothing
 *     writes format 2 any more, so on a held entry it can only be a replay;
 *   - a deletion with no payload (a tombstone the cron scrubbed 30 days
 *     after the delete) carries no proof, so it hides the entry but keeps
 *     its words on the device, restorable from Settings for 30 days.
 * `contested` means the local copy is an unsent edit, which the server
 * row must beat by clock (the shared merge); otherwise an equal clock
 * re-applies, as a re-delivered row must.
 */
export function adoptServerRow(
  row: WireRow,
  decoded: Snippet,
  local: Snippet | undefined,
  contested: boolean,
  now: number,
): Snippet | null {
  if (local) {
    const current = contested
      ? incomingWins(local, row)
      : row.updatedAt >= local.updatedAt;
    if (!current) return null;
    if (row.payload === null)
      return {
        ...local,
        deletedAt: local.deletedAt ?? now,
        updatedAt: row.updatedAt,
        _dirty: 0,
      };
    if (row.payloadFormat !== PAYLOAD_FORMAT_SEALED_AAD) return null;
  }
  return needsReseal(row)
    ? { ...decoded, _dirty: 1, updatedAt: bumpClock(decoded.updatedAt) }
    : decoded;
}
