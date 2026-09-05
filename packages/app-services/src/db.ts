import { createDatabase, runMigrations, seed, type Database } from "@money-copilot/persistence";
import { fixtureProfile } from "@money-copilot/financial-engine";

let cachedDb: Promise<Database> | undefined;

/**
 * Lazily creates, migrates, and (if empty) seeds a single database instance
 * shared across every call in this process — this is the "application/
 * query service boundary" the Sprint 3 brief asks for: no React component
 * or Next.js route ever imports `@money-copilot/persistence` directly.
 * File-backed by default (`MONEY_COPILOT_DB_PATH`, defaulting to
 * `.data/money-copilot.pglite`) so data survives across requests/restarts;
 * pass `"memory://"` (or set the env var to it) for a fully in-memory
 * instance, e.g. in tests.
 */
export function getDb(): Promise<Database> {
  if (!cachedDb) {
    cachedDb = initializeDb();
  }
  return cachedDb;
}

async function initializeDb(): Promise<Database> {
  const dataDir = process.env["MONEY_COPILOT_DB_PATH"] ?? "./.data/money-copilot.pglite";
  const db = await createDatabase(dataDir);
  await runMigrations(db);
  await seed(db); // idempotent — safe to run on every process start.
  return db;
}

/** Test-only: forces the next `getDb()` call to build a fresh instance. */
export function resetDbCache(): void {
  cachedDb = undefined;
}

export const DEMO_PROFILE_ID = fixtureProfile.id;
