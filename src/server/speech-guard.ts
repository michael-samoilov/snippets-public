/**
 * The gate in front of every route that spends a speech provider's
 * credit for a caller: the four token mints and the transcription
 * proxy. Capture without an account is the product, so the gate cannot
 * ask for a session. It asks two other things.
 *
 * 1. Same origin. A browser's POST carries `Origin` (and, in current
 *    browsers, `Sec-Fetch-Site`), and a page on another site cannot
 *    forge either. That stops another site from spending this app's
 *    credit through its visitors' browsers. A script can forge both
 *    headers, so this check is not the limit.
 * 2. A per-network budget: a fixed window per bucket, counted in
 *    Postgres so every serverless instance shares one count. A network
 *    is one IPv4 address or one IPv6 /64. The database stores a keyed
 *    hash of the network, never the address. Without the database
 *    and the auth secret (local runs, device-only deploys), or when a
 *    query fails, a count in this process stands in: weaker across
 *    instances, and never a reason to refuse voice.
 *
 * The budget bounds how many provider sessions one network can open.
 * It does not bound how long a session runs once a provider accepts
 * its token; the providers' own spend limits are the backstop for that.
 */
import "server-only";
import { createHmac } from "node:crypto";
import { isIPv6 } from "node:net";
import { sql } from "drizzle-orm";
import { serverDb, schema } from "./db";

export type SpeechBucket = "token" | "transcribe";

interface Budget {
  limit: number;
  windowMs: number;
}

/**
 * Requests one network may make per window. A writer mints one token
 * per page load and one per take, and uploads one recording per take
 * (two when the first upload fails), so these sit far above real use
 * and far below what a script would want. All four token routes share
 * one bucket: falling back to another provider does not buy a fresh
 * budget.
 */
export const SPEECH_BUDGETS = {
  token: { limit: 30, windowMs: 10 * 60_000 },
  transcribe: { limit: 20, windowMs: 10 * 60_000 },
} satisfies Record<SpeechBucket, Budget>;

/** Rows older than this are dead windows; the daily cron deletes them. */
export const SPEECH_LIMIT_ROW_TTL_MS = 24 * 60 * 60 * 1000;

const TOKEN_TTL = { fallback: 300, min: 60, max: 600 };

/**
 * A provider token's lifetime in seconds from its env override: the
 * fallback when unset or not a number, else clamped to 60..600. The
 * client refreshes 15 s before expiry, so the floor keeps a warm token
 * usable; the ceiling caps how long a leaked token stays good.
 */
export function tokenTtlSeconds(raw: string | undefined): number {
  const n = Number(raw ?? TOKEN_TTL.fallback);
  if (!Number.isFinite(n)) return TOKEN_TTL.fallback;
  return Math.min(Math.max(Math.round(n), TOKEN_TTL.min), TOKEN_TTL.max);
}

/** Null lets the request through; a Response is the refusal to return. */
export async function speechGuard(
  request: Request,
  bucket: SpeechBucket,
): Promise<Response | null> {
  if (isCrossSite(request.headers)) {
    return Response.json({ error: "cross_site" }, { status: 403 });
  }
  const { limit, windowMs } = SPEECH_BUDGETS[bucket];
  const now = Date.now();
  const window = await countHit(`${bucket}:${callerId(request.headers)}`, now, windowMs);
  if (window.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((window.start + windowMs - now) / 1000));
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/**
 * Same-origin means: `Sec-Fetch-Site` is absent or `same-origin`, and
 * `Origin` is present and names the host the request was sent to. A
 * missing `Origin` fails: every browser sends it on a POST, so only a
 * script leaves it out.
 */
function isCrossSite(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return true;
  const origin = headers.get("origin");
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))
    ?.split(",")[0]
    .trim();
  if (!origin || !host) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Keys the address hash, so a stored row cannot be reversed to an IP. */
const hashKey = process.env.BETTER_AUTH_SECRET;

/**
 * The caller's network, from the address the platform's proxy reports
 * (Vercel overwrites both headers, so a client cannot choose its own),
 * reduced to a keyed hash. Requests with no address share one bucket.
 */
function callerId(headers: Headers): string {
  const ip =
    headers.get("x-real-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    "unknown";
  return createHmac("sha256", hashKey ?? "snippets-speech-guard")
    .update(budgetNetwork(ip))
    .digest("base64url")
    .slice(0, 22);
}

/**
 * The network one budget covers. An IPv4 address counts alone. An IPv6
 * address counts as its /64: one home or one server usually holds a
 * whole /64, so a budget per full address would hand a script 2^64
 * fresh budgets. An IPv4-mapped IPv6 address counts as its IPv4
 * address, and a zone index is dropped.
 */
function budgetNetwork(raw: string): string {
  const ip = raw
    .replace(/%.*$/, "")
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  return isIPv6(ip) ? `${ipv6Prefix64(ip)}::/64` : ip;
}

/**
 * The first four groups of a valid IPv6 address, expanded from `::`
 * and without leading zeros, so every spelling of one /64 gives one
 * string. A dotted IPv4 tail fills the last two groups.
 */
function ipv6Prefix64(ip: string): string {
  const groupsOf = (part: string) =>
    part ? part.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g])) : [];
  const [head, tail = ""] = ip.split("::");
  const left = groupsOf(head);
  const right = groupsOf(tail);
  const groups = ip.includes("::")
    ? [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right]
    : left;
  return groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(":");
}

interface Window {
  start: number;
  count: number;
}

/** Records one hit and returns the window it landed in. */
async function countHit(key: string, now: number, windowMs: number): Promise<Window> {
  if (serverDb && hashKey) {
    try {
      return await countInDatabase(serverDb, key, now, windowMs);
    } catch (error) {
      console.warn("speech guard: database count failed, counting in memory", error);
    }
  }
  return countInMemory(key, now, windowMs);
}

const SPEECH_RATE_LIMIT_DDL = sql`create table if not exists "speech_rate_limit" (
  "key" text primary key not null,
  "window_start" bigint not null,
  "count" integer not null
)`;

let tableReady: Promise<unknown> | null = null;

/**
 * One statement, atomic under concurrency: the insert claims a new
 * key, and the conflict branch either opens a fresh window (the stored
 * one has ended) or adds one to the current window. The table is
 * created on first use as well as by migration 0002, so a deploy that
 * lands before the migration runs still counts in Postgres.
 */
async function countInDatabase(
  db: NonNullable<typeof serverDb>,
  key: string,
  now: number,
  windowMs: number,
): Promise<Window> {
  tableReady ??= db.execute(SPEECH_RATE_LIMIT_DDL).catch((error: Error) => {
    tableReady = null;
    throw error;
  });
  await tableReady;
  const t = schema.speechRateLimit;
  const expired = sql`${t.windowStart} <= ${now - windowMs}`;
  const [row] = await db
    .insert(t)
    .values({ key, windowStart: now, count: 1 })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        windowStart: sql`case when ${expired} then ${now} else ${t.windowStart} end`,
        count: sql`case when ${expired} then 1 else ${t.count} + 1 end`,
      },
    })
    .returning({ start: t.windowStart, count: t.count });
  return row;
}

const memory = new Map<string, Window>();

function countInMemory(key: string, now: number, windowMs: number): Window {
  if (memory.size > 10_000) {
    for (const [k, w] of memory) if (w.start + windowMs <= now) memory.delete(k);
  }
  const current = memory.get(key);
  const next =
    current && current.start + windowMs > now
      ? { start: current.start, count: current.count + 1 }
      : { start: now, count: 1 };
  memory.set(key, next);
  return next;
}
