/**
 * The server database handle. Absent DATABASE_URL the handle is null
 * and every account feature quietly reports itself unavailable — the
 * same optional-env contract as every other server capability here
 * (enrichment, voice). The app itself never needs it.
 */
import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;

export const serverDb = url ? drizzle(neon(url), { schema }) : null;
export type ServerDb = NonNullable<typeof serverDb>;
export { schema };
