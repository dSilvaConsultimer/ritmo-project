import {
  bootstrapSystemDefaultCategoryRules,
  createDatabase,
  createPostgresDatabase,
  runMigrations,
  seed,
  type Database,
} from "@money-copilot/persistence";
import { fixtureProfile } from "@money-copilot/financial-engine";
import { requireEnv, resolveAppEnvironment, type AppEnvironment } from "@money-copilot/config";

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
 * Sprint 9 (DEC-090): staging/production use real Postgres; only
 * development/test ever use file-backed PGlite, which has no real
 * multi-process story and is not production infrastructure.
 */
export function shouldUsePostgres(environment: AppEnvironment): boolean {
  return environment === "staging" || environment === "production";
}

/**
 * Sprint 9 (DEC-090, brief §31): Founder fixture data must never reach a
 * real user's database. A pure, directly-testable predicate — see
 * `db.test.ts` — rather than an inline check buried in `initializeDb`.
 */
export function shouldSeedDatabase(environment: AppEnvironment): boolean {
  return environment === "development" || environment === "test";
}

/**
 * Lazily creates, migrates, and (development/test only) seeds a single
 * database instance shared across every call in this process — this is the
 * "application/query service boundary" the Sprint 3 brief asks for: no
 * React/TanStack component or route ever imports `@money-copilot/persistence`
 * directly. Driver and seeding behavior are both environment-gated (Sprint
 * 9, DEC-090/DEC-091) — see `shouldUsePostgres`/`shouldSeedDatabase`.
 */
export function getDb(): Promise<Database> {
  if (!globalThis.__moneyCopilotDb) {
    globalThis.__moneyCopilotDb = initializeDb();
  }
  return globalThis.__moneyCopilotDb;
}

async function initializeDb(): Promise<Database> {
  const environment = resolveAppEnvironment();

  if (shouldUsePostgres(environment)) {
    const connectionString = requireEnv("DATABASE_URL");
    const db = createPostgresDatabase(connectionString);
    // Sprint 9 Phase 6A (DEC-117): migrations are NO LONGER applied here.
    // Running `runPostgresMigrations` on every ordinary app boot would race
    // when multiple staging/production instances start concurrently — the
    // explicit `pnpm --filter @money-copilot/persistence run
    // db:migrate:postgres` command (a Railway release-command / one-shot
    // pre-deploy step) is now the ONLY place migrations are applied against
    // a real Postgres database. A boot against a database whose schema
    // isn't current will fail loudly on first query, which is correct:
    // never silently serve traffic against a stale/partial schema.
    // shouldSeedDatabase(environment) is always false here — Founder fixture
    // data must never reach staging/production (brief §31, DEC-090).
    // DEC-134: the global SYSTEM_DEFAULT category-rule baseline is NOT
    // founder fixture data (it's generic product configuration every real
    // user needs) — it runs here UNCONDITIONALLY, unlike `seed()` above.
    // Safe under concurrent instance startup: every upsert here is
    // id-keyed `ON CONFLICT DO UPDATE` against a handful of stable ids,
    // never DDL, so this carries none of the migration race risk the
    // comment above describes.
    await bootstrapSystemDefaultCategoryRules(db);
    return db;
  }

  const dataDir = process.env["MONEY_COPILOT_DB_PATH"] ?? "./.data/money-copilot.pglite";
  const db = await createDatabase(dataDir);
  await runMigrations(db);
  if (shouldSeedDatabase(environment)) {
    await seed(db); // idempotent — safe to run on every process start.
  }
  await bootstrapSystemDefaultCategoryRules(db);
  return db;
}

/** Test-only: forces the next `getDb()` call to build a fresh instance. */
export function resetDbCache(): void {
  globalThis.__moneyCopilotDb = undefined;
}

export const DEMO_PROFILE_ID = fixtureProfile.id;
