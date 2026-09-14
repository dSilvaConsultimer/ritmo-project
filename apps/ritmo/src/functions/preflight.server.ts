import { resolveAppEnvironment, type AppEnvironment } from "@money-copilot/config";
import { isTransactionalEmailConfigured } from "./email.server";

/**
 * Server-only deterministic production preflight (Sprint 9 Phase 5 — see
 * docs/DECISIONS.md DEC-113). Distinguishes ERROR ("cannot safely run" —
 * the process should refuse to boot/serve) from WARNING ("boots fine, but
 * this is a public-launch blocker" — brief §16's own example: a missing
 * transactional-email provider). Never returns a secret VALUE, only names
 * of what's missing/misconfigured. `env` is injectable for deterministic
 * tests — defaults to `process.env`.
 */

export interface PreflightFinding {
  readonly level: "error" | "warning";
  readonly code: string;
  readonly message: string;
}

export interface PreflightReport {
  readonly environment: AppEnvironment;
  readonly ok: boolean;
  readonly findings: readonly PreflightFinding[];
}

/**
 * Sprint 9 Phase 6A (docs/DECISIONS.md DEC-118): access control for the
 * route. Even secret-VALUE-free, this report reveals WHICH checks are
 * configured/misconfigured (e.g. "DEV_AUTH_BYPASS_ENABLED") — real, if
 * bounded, information disclosure the Phase 5 review flagged as unsolved.
 * Development/test: always allowed (no operational secret exists there,
 * and it's local-only). Staging/production: allowed ONLY with a matching
 * `PREFLIGHT_SECRET` operational secret, supplied as an
 * `X-Preflight-Secret` header. **Unavailable by default** — if
 * `PREFLIGHT_SECRET` is not configured at all in a live tier, the route
 * refuses every request, including one bearing a header value, rather than
 * silently comparing against `undefined`.
 */
export function isPreflightAccessAllowed(
  providedSecret: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
  environment: AppEnvironment = resolveAppEnvironment(env),
): boolean {
  if (environment === "development" || environment === "test") return true;
  const configuredSecret = env["PREFLIGHT_SECRET"];
  if (!configuredSecret) return false;
  return providedSecret === configuredSecret;
}

function requiredButMissing(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): boolean {
  const value = env[name];
  return value === undefined || value.trim() === "";
}

export function runPreflightChecks(
  env: Readonly<Record<string, string | undefined>> = process.env,
  environment: AppEnvironment = resolveAppEnvironment(env),
): PreflightReport {
  const findings: PreflightFinding[] = [];
  const isLiveTier = environment === "staging" || environment === "production";

  if (isLiveTier) {
    // Sprint 9 Phase 6A (DEC-119): DATABASE_DIRECT_URL is never read by the
    // running application itself (only by the separate migration CLI —
    // migrate.ts's resolveMigrationConnectionString) but its absence fails
    // the release/migration step, which blocks deployment just as surely
    // as a missing DATABASE_URL would — an ERROR here, not a warning.
    for (const name of [
      "DATABASE_URL",
      "DATABASE_DIRECT_URL",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
    ]) {
      if (requiredButMissing(env, name)) {
        findings.push({
          level: "error",
          code: `MISSING_${name}`,
          message: `${name} is required in ${environment} and is not set.`,
        });
      }
    }

    // Dev-only flags must be verifiably off — a live tier with either
    // explicitly enabled cannot safely run (DEC-104/DEC-087's own
    // fail-closed guards would already refuse at boot; preflight catches
    // it BEFORE deploy, not after a crash).
    if (env["DEV_AUTH_BYPASS"] === "true") {
      findings.push({
        level: "error",
        code: "DEV_AUTH_BYPASS_ENABLED",
        message: `DEV_AUTH_BYPASS is "true" in ${environment} — this must never be set outside development/test.`,
      });
    }

    // A placeholder/localhost value slipping into a live BETTER_AUTH_URL is
    // a real, easy-to-make mistake (copy-pasted from a local .env.local).
    const baseURL = env["BETTER_AUTH_URL"];
    if (baseURL && /localhost|127\.0\.0\.1/i.test(baseURL)) {
      findings.push({
        level: "error",
        code: "UNSAFE_BASE_URL",
        message: `BETTER_AUTH_URL ("${baseURL.replace(/^https?:\/\//, "")}") looks like a local/placeholder address, not a real ${environment} URL.`,
      });
    }

    if (
      env["OPENAI_API_KEY"] &&
      /^(sk-)?placeholder|changeme|your[-_]?key/i.test(env["OPENAI_API_KEY"])
    ) {
      findings.push({
        level: "error",
        code: "PLACEHOLDER_OPENAI_API_KEY",
        message: "OPENAI_API_KEY looks like a placeholder value, not a real key.",
      });
    }

    // NODE_ENV powers some third-party library internals (verified for
    // Better Auth's own default rate-limit `enabled` check and TanStack
    // Start's own dev/prod branching) independently of this app's own
    // APP_ENV-based resolveAppEnvironment() — a live tier should have both
    // aligned, not just APP_ENV.
    if (env["NODE_ENV"] !== "production") {
      findings.push({
        level: "warning",
        code: "NODE_ENV_MISMATCH",
        message: `Resolved environment is "${environment}" but NODE_ENV is "${env["NODE_ENV"] ?? "unset"}" — some third-party libraries (Better Auth's own rate-limiter default, TanStack Start's dev/prod branching) key off NODE_ENV directly. Set NODE_ENV=production for a live tier.`,
      });
    }
  } else {
    // Development/test: a live-tier variable present here is not unsafe by
    // itself, but is worth a warning — it usually means a leaked/misplaced
    // .env value, not a real requirement.
    if (env["DATABASE_URL"]) {
      findings.push({
        level: "warning",
        code: "UNEXPECTED_DATABASE_URL",
        message: `DATABASE_URL is set in ${environment} but is never used there — development/test always use file-backed PGlite.`,
      });
    }
  }

  // GO_LIVE_REQUIRED, not BOOT_REQUIRED (brief §16's own example) — the app
  // boots and every other screen works; only password recovery is affected.
  if (!isTransactionalEmailConfigured(env)) {
    findings.push({
      level: "warning",
      code: "NO_TRANSACTIONAL_EMAIL_PROVIDER",
      message:
        "No transactional-email provider is configured — password recovery is unavailable outside development/test. This is a public-launch blocker, not a boot failure.",
    });
  }

  const ok = findings.every((f) => f.level !== "error");
  return { environment, ok, findings };
}
