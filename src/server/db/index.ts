/**
 * The server database handle. Absent DATABASE_URL the handle is null
 * and every account feature quietly reports itself unavailable — the
 * same optional-env contract as every other server capability here
 * (voice). The app itself never needs it.
 *
 * The WebSocket driver (Pool), not neon-http: the sync push handler
 * runs inside a real transaction holding `pg_advisory_xact_lock`, and
 * the stateless http driver can't carry either.
 */
import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

export const serverDb = url
  ? drizzle(new Pool({ connectionString: url }), { schema })
  : null;
export type ServerDb = NonNullable<typeof serverDb>;
export { schema };
