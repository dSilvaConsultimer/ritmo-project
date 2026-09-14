import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";
import { requireEnv } from "@money-copilot/config";
import { createPostgresDatabase } from "./db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(__dirname, "..", "migrations");

/**
 * Applies every pending SQL migration in `migrations/` against a PGlite
 * (development/test) database. Safe to call repeatedly. Each driver has its
 * own migrator function with its own driver-specific parameter type (Drizzle
 * doesn't offer a driver-neutral migrator) — see `runPostgresMigrations` for
 * the staging/production counterpart. Both apply the exact same SQL files.
 */
export async function runMigrations(db: PgliteDatabase<typeof schema>): Promise<void> {
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/** Applies every pending SQL migration in `migrations/` against a real Postgres database. */
export async function runPostgresMigrations(db: NodePgDatabase<typeof schema>): Promise<void> {
  await migrateNodePg(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

/**
 * Sprint 9 Phase 6A (docs/DECISIONS.md DEC-117/DEC-119): resolves the
 * connection string this CLI uses — deliberately `DATABASE_DIRECT_URL`,
 * NEVER the same `DATABASE_URL` the running application uses. Neon's own
 * pooled connection (what `DATABASE_URL` holds — see DEC-119) is documented
 * as less predictable for DDL/migration workloads than a direct connection;
 * splitting them means a pooler quirk can never affect either the app's
 * normal query path or the migration step. Exported (not just used
 * internally) so this exact resolution — which env var name, the fail-
 * closed behavior — is directly unit-testable without a real database.
 */
export function resolveMigrationConnectionString(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return requireEnv("DATABASE_DIRECT_URL", env);
}

/**
 * Explicit staging/production migration entry point — a real, standalone
 * CLI, run via `pnpm run db:migrate:postgres` (mirrors `seed.ts`'s own
 * `db:seed` CLI pattern exactly, including its main-module guard). This is
 * now the ONLY place `runPostgresMigrations` is ever called for a real
 * Postgres database — `packages/app-services/src/db.ts`'s `initializeDb()`
 * no longer calls it on ordinary app boot (see that file's own comment and
 * DEC-117), specifically so that multiple staging/production instances
 * booting concurrently never race applying the same migration. Railway's
 * "Pre-Deploy Command" (or an equivalent one-shot pre-deploy step on another
 * host) is where this belongs — it runs once, before new instances start
 * receiving traffic, never per-instance.
 *
 * Idempotent (Drizzle's own migration-tracking table skips already-applied
 * files), never seeds, never resets/drops anything — `runPostgresMigrations`
 * only ever calls Drizzle's own migrator, which only ever applies pending
 * `migrations/*.sql` files in order.
 */
async function migratePostgresCli(): Promise<void> {
  const connectionString = resolveMigrationConnectionString();
  const db = createPostgresDatabase(connectionString);
  console.log("[migrate] Applying pending Postgres migrations...");
  await runPostgresMigrations(db);
  console.log("[migrate] Done — schema is up to date.");
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  migratePostgresCli()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      // Never print the connection string/DATABASE_DIRECT_URL value — only
      // the driver's own error, which does not include it.
      console.error("[migrate] FAILED:", error);
      process.exit(1);
    });
}
