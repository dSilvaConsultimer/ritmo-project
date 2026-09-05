import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "./schema";

export type Database = PgliteDatabase<typeof schema>;

/**
 * Creates a PGlite-backed Postgres-compatible database — no hosted
 * Supabase/Postgres credentials required for local dev or automated tests
 * (per Sprint 2 brief: "Local development and automated tests MUST NOT
 * require hosted Supabase credentials"). Pass a filesystem path (e.g.
 * `./money-copilot.pglite`) for a persistent local database, or omit it
 * (or pass `"memory://"`) for an in-memory instance — the default, and
 * what every automated test uses.
 */
export async function createDatabase(dataDir?: string): Promise<Database> {
  if (dataDir && dataDir !== "memory://") {
    // PGlite does not create missing parent directories itself.
    mkdirSync(dirname(dataDir), { recursive: true });
  }
  const client = new PGlite(dataDir ?? "memory://");
  return drizzle(client, { schema });
}
