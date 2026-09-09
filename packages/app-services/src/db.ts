import { createDatabase, runMigrations, seed, type Database } from "@money-copilot/persistence";
import { fixtureProfile } from "@money-copilot/financial-engine";

/**
 * Sprint 4.5 (DEC-052): a plain module-level `let cachedDb` is NOT
 * actually one shared singleton under Next.js's Turbopack dev server —
 * React Server Components and Route Handlers are compiled as separate
 * module "layers" and can each get their OWN evaluation of this module,
 * each with its own `cachedDb`. This was found live: a real Pluggy
 * connection persisted via a Route Handler (`POST /api/connections`) was
 * invisible to the RSC homepage (`getDb()` called from `page.tsx`) even
 * after `router.refresh()` — the RSC layer's singleton had opened the
 * database at an earlier point and never saw the later write.
 *
 * `globalThis` is the actual JS realm global object — shared across
 * module registries within the same Node.js process, unlike a
 * module-level variable — so caching there instead is what makes this a
 * REAL singleton regardless of which layer calls `getDb()` first. This is
 * the same fix commonly used for the analogous Prisma Client Next.js
 * dev-mode issue, applied here for the same underlying reason.
 */
declare global {
  // `var` is required for ambient global augmentation — `let`/`const` are not valid here.
  var __moneyCopilotDb: Promise<Database> | undefined;
}

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
  if (!globalThis.__moneyCopilotDb) {
    globalThis.__moneyCopilotDb = initializeDb();
  }
  return globalThis.__moneyCopilotDb;
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
  globalThis.__moneyCopilotDb = undefined;
}

export const DEMO_PROFILE_ID = fixtureProfile.id;
