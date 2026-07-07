/**
 * The sync wire format, shared by the client engine and the API
 * routes. A snippet travels as identity + clocks + an opaque payload
 * envelope: everything except `id`/`updatedAt`/`deletedAt`/`_dirty`
 * lives inside `payload`, so a future end-to-end-encrypted format is
 * a `payloadFormat` bump — the protocol itself never changes shape.
 */
import type { Snippet } from "@/lib/types";

/** format 1: the payload is the snippet's content fields, plaintext JSON */
export const PAYLOAD_FORMAT_PLAIN = 1;

export type SnippetPayload = Omit<
  Snippet,
  "id" | "updatedAt" | "deletedAt" | "_dirty"
>;

export interface WireChange {
  id: string;
  payloadFormat: number;
  payload: SnippetPayload;
  updatedAt: number;
  deletedAt: number | null;
}

export interface WireRow {
  id: string;
  payloadFormat: number;
  /** null once a tombstone's content has been scrubbed (30 days after delete) */
  payload: SnippetPayload | null;
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

export function toWireChange(s: Snippet): WireChange {
  const { id, updatedAt, deletedAt, _dirty, ...payload } = s;
  void _dirty;
  return {
    id,
    payloadFormat: PAYLOAD_FORMAT_PLAIN,
    payload,
    updatedAt,
    deletedAt: deletedAt ?? null,
  };
}

export function fromWireRow(row: WireRow): Snippet {
  if (!row.payload) {
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
  return {
    ...row.payload,
    id: row.id,
    updatedAt: row.updatedAt,
    ...(row.deletedAt !== null ? { deletedAt: row.deletedAt } : {}),
    _dirty: 0,
  };
}
