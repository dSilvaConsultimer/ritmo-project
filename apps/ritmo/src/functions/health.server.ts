import { sql } from "drizzle-orm";
import { resolveAppEnvironment, requireEnv, EnvironmentConfigError } from "@money-copilot/config";
import { getDb } from "@money-copilot/app-services";

/**
 * Server-only operational health checks (Sprint 9 Phase 5 — see
 * docs/DECISIONS.md DEC-112), suitable for a future Railway deployment's
 * health-check configuration. Returns minimal, secret-free information —
 * never a hostname, credential, account id, or detailed internal error.
 */

export interface LiveResult {
  readonly status: "ok";
}

/** LIVE: "is the Node process/application alive?" — no dependency checks at all. */
export function checkLiveHandler(): LiveResult {
  return { status: "ok" };
}

export interface ReadyResult {
  readonly status: "ok" | "degraded";
  readonly checks: {
    readonly config: "ok" | "error";
    readonly database: "ok" | "error";
  };
}

/**
 * READY: "can this instance safely serve application traffic?" Checks
 * config validity and DB connectivity — deliberately never calls
 * OpenAI/Pluggy (brief §15: "Do NOT call OpenAI or Pluggy on every
 * readiness request" — those are optional/degraded features per DEC-113's
 * dependency classification, not boot/readiness requirements).
 */
export async function checkReadyHandler(): Promise<ReadyResult> {
  const environment = resolveAppEnvironment();

  let configStatus: "ok" | "error" = "ok";
  if (environment === "staging" || environment === "production") {
    try {
      requireEnv("DATABASE_URL");
      requireEnv("BETTER_AUTH_SECRET");
      requireEnv("BETTER_AUTH_URL");
    } catch (error) {
      if (error instanceof EnvironmentConfigError) configStatus = "error";
      else throw error;
    }
  }

  let databaseStatus: "ok" | "error" = "ok";
  try {
    // Sprint 9 Phase 6A: `getDb()` alone no longer proves real connectivity
    // for the Postgres path — `initializeDb()` stopped migrating on boot
    // (DEC-117), and `pg.Pool` connects lazily, so a bad `DATABASE_URL`
    // would otherwise go undetected until the first real request. A cheap
    // `select 1` forces one real round-trip, driver-neutral (works
    // identically against PGlite and Postgres).
    const db = await getDb();
    await db.execute(sql`select 1`);
  } catch {
    databaseStatus = "error";
  }

  const status: ReadyResult["status"] =
    configStatus === "ok" && databaseStatus === "ok" ? "ok" : "degraded";

  return { status, checks: { config: configStatus, database: databaseStatus } };
}
