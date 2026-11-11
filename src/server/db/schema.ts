/**
 * The server half of the book. Postgres (Neon) via Drizzle; migrations
 * live in /drizzle as plain SQL, generated with `pnpm db:generate`.
 *
 * Auth tables mirror Better Auth's canonical model shapes exactly
 * (property names must match its field names — the drizzle adapter
 * resolves columns through them). App tables carry the synced copy of
 * each writer's book and the backup ledger.
 */
import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ── Better Auth core ────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  // Google's tokens land here — this is the Drive backup's token store
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Better Auth's rate limiter, persisted — in-memory counters reset on
 *  every serverless invocation, so the database is the only real store. */
export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ── The synced book ─────────────────────────────────────────────

/**
 * One global monotonic sequence stamps every accepted write. Global
 * monotonic ⇒ per-user monotonic, which is all the pull cursor needs.
 * Gap-safety (a later-committed smaller seq slipping under an already
 * -read cursor) is closed structurally: every writer takes
 * `pg_advisory_xact_lock(hashtext(user_id))`, so writes for one user
 * are serial.
 */
export const snippetsSeq = pgSequence("snippets_seq");

/**
 * A row per snippet per user. `payload` is a versioned envelope the
 * sync machinery never parses — everything except identity and sync
 * clocks lives inside, so a future end-to-end-encrypted format is a
 * `payloadFormat` bump, not a migration. Tombstones (deletedAt set)
 * are kept forever; their payload is nulled 30 days after deletion.
 */
export const snippets = pgTable(
  "snippets",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** client-minted ULID — identity is born on the device */
    id: text("id").notNull(),
    payload: jsonb("payload"),
    payloadFormat: smallint("payload_format").notNull().default(1),
    /** the client's LWW clock, epoch ms */
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    /** tombstone marker, epoch ms */
    deletedAt: bigint("deleted_at", { mode: "number" }),
    /** change-feed position, from snippets_seq */
    serverSeq: bigint("server_seq", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    uniqueIndex("snippets_user_seq").on(t.userId, t.serverSeq),
  ],
);

// ── End-to-end encryption ───────────────────────────────────────

/**
 * The user's book key, wrapped twice — once by a key derived from
 * their passphrase, once by their recovery code. The server stores
 * only these sealed envelopes; unwrapping happens exclusively on the
 * user's devices. Envelope JSON: { v, kdf, iterations, salt, iv, ct }.
 */
export const userKeys = pgTable("user_keys", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  passphraseKey: jsonb("passphrase_key").notNull(),
  recoveryKey: jsonb("recovery_key").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ── Backup ledger ───────────────────────────────────────────────

/**
 * One row per (user, channel). Adding a new destination later (email
 * digest, Dropbox) is a new `provider` value plus a new BackupChannel
 * implementation — no schema change.
 */
export const backupStatus = pgTable(
  "backup_status",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("google-drive"),
    /** 'active' | 'disconnected' | 'error' */
    state: text("state").notNull(),
    driveFolderId: text("drive_folder_id"),
    jsonFileId: text("json_file_id"),
    /** { "2026": "<driveFileId>", ... } */
    mdFileIds: jsonb("md_file_ids"),
    lastBackedUpSeq: bigint("last_backed_up_seq", { mode: "number" })
      .notNull()
      .default(0),
    lastSuccessAt: timestamp("last_success_at"),
    lastAttemptAt: timestamp("last_attempt_at"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastError: text("last_error"),
    /** set when the failure alert email goes out; cleared on success */
    failureNotifiedAt: timestamp("failure_notified_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.provider] })],
);

// ── Abuse limits ────────────────────────────────────────────────

/**
 * Fixed-window request counts for the voice routes
 * (src/server/speech-guard.ts). `key` is "<bucket>:<keyed hash of the
 * caller's IP>", never the address. A table of its own because Better
 * Auth prunes every row of `rate_limit` that has been idle past its own
 * longest window, which would reset these counts. The daily cron
 * deletes rows older than a day.
 */
export const speechRateLimit = pgTable("speech_rate_limit", {
  key: text("key").primaryKey(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: integer("count").notNull(),
});
