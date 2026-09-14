import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzleNodePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Driver-neutral — every query/repository function in this package is typed
 * against this, and works identically regardless of which concrete driver
 * `getDb()` (in `@money-copilot/app-services`) chose. Only the two creation
 * functions below (and their matching migrators in `migrate.ts`) are
 * driver-specific; nothing else in this codebase needs to know or care
 * which one is live in a given process. See docs/DECISIONS.md DEC-090.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * PGlite-backed — development/test only (DEC-090: file-backed PGlite has no
 * real multi-process story and is never used in staging/production). Pass a
 * filesystem path (e.g. `./money-copilot.pglite`) for a persistent local
 * database, or omit it (or pass `"memory://"`) for an in-memory instance —
 * the default, and what every automated test uses.
 */
export async function createDatabase(dataDir?: string): Promise<PgliteDatabase<typeof schema>> {
  if (dataDir && dataDir !== "memory://") {
    // PGlite does not create missing parent directories itself.
    mkdirSync(dirname(dataDir), { recursive: true });
  }
  const client = new PGlite(dataDir ?? "memory://");
  return drizzlePglite(client, { schema });
}

/**
 * node-postgres-backed — staging/production (DEC-090: Neon Postgres, plain
 * TCP over a pooled connection since the deployment target is a normal
 * long-lived Node server, not an edge/Workers runtime that would need
 * Neon's HTTP driver instead). `max` is deliberately modest — a single
 * long-lived Node process, not a serverless-per-request function that would
 * risk a connection storm.
 */
export function createPostgresDatabase(connectionString: string): NodePgDatabase<typeof schema> {
  const pool = new Pool({ connectionString, max: 10 });
  return drizzleNodePg(pool, { schema });
}
