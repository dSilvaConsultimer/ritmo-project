import { requireEnv, resolveAppEnvironment, type AppEnvironment } from "@money-copilot/config";

/**
 * Server-only Better Auth secret/base-URL resolution (Sprint 9 Phase 3
 * fix-up — see docs/DECISIONS.md DEC-097). `betterAuth({...})` (auth.server.ts)
 * previously passed neither `secret` nor `baseURL`, so Better Auth fell back
 * to its own internal defaults: an implicit, fixed insecure secret
 * ("better-auth-secret-12345678901234567890") unless `NODE_ENV==="production"`
 * (Better Auth's own check — it knows nothing about this codebase's `APP_ENV`
 * or "staging" tier), and a `baseURL` silently derived from each incoming
 * request when unset. Neither of those matches this codebase's "fail closed
 * in staging/production, explicit everywhere else" discipline (`@money-copilot/config`,
 * used identically for `DATABASE_URL` in `packages/app-services/src/db.ts`).
 *
 * Both functions below are pure and take `environment` explicitly so they're
 * directly unit-testable (`auth-config.server.test.ts`) without touching
 * global `process.env` — the same shape as `shouldUsePostgres`/`shouldSeedDatabase`.
 */

/**
 * Explicit, documented, dev/test-only fallback — never Better Auth's own
 * implicit default, and never used past the staging/production gate below.
 * Not a secret in any sense that matters: it is checked into source control
 * on purpose, so "which secret is dev actually using" always has an
 * inspectable answer.
 */
const DEV_ONLY_INSECURE_SECRET =
  "money-copilot-dev-only-insecure-secret-never-use-in-staging-or-production";

export function resolveBetterAuthSecret(
  environment: AppEnvironment,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (environment === "staging" || environment === "production") {
    return requireEnv("BETTER_AUTH_SECRET", env);
  }
  return env["BETTER_AUTH_SECRET"] ?? DEV_ONLY_INSECURE_SECRET;
}

export function resolveBetterAuthBaseURL(
  environment: AppEnvironment,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (environment === "staging" || environment === "production") {
    return requireEnv("BETTER_AUTH_URL", env);
  }
  // Optional in development/test — Better Auth derives the origin from the
  // incoming request when unset, which is fine for a single local dev host.
  return env["BETTER_AUTH_URL"];
}

/** Convenience wrapper used by `auth.server.ts` — resolves the environment once. */
export function resolveBetterAuthRuntimeConfig(
  environment: AppEnvironment = resolveAppEnvironment(),
): { readonly secret: string; readonly baseURL: string | undefined } {
  return {
    secret: resolveBetterAuthSecret(environment),
    baseURL: resolveBetterAuthBaseURL(environment),
  };
}
