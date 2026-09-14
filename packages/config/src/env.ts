/**
 * Central environment-tier resolution and fail-closed config helpers.
 * Deliberately its own package, not part of `@money-copilot/shared` — this
 * reads `process.env`, a hard Node dependency, and `@money-copilot/financial-engine`
 * (via `shared`) is deliberately usable without Node/any framework at all
 * (see docs/ARCHITECTURE.md, "Why this split"). Only Node-context packages
 * (persistence, app-services, apps/ritmo's server functions) depend on this.
 * Every later Sprint 9 rule ("never seed Founder fixture data in production,"
 * "never boot production against file-backed PGlite," "never enable a dev
 * auth bypass in production") is built on top of
 * `resolveAppEnvironment`/`requireEnv` from this one module, so there is
 * exactly one place that decides what environment a process is running in
 * and exactly one way to fail closed on missing config.
 */

export type AppEnvironment = "development" | "test" | "staging" | "production";

const KNOWN_ENVIRONMENTS: readonly AppEnvironment[] = [
  "development",
  "test",
  "staging",
  "production",
];

function isAppEnvironment(value: string): value is AppEnvironment {
  return (KNOWN_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * `APP_ENV` is authoritative when set (it's the only variable that can express
 * "staging", which `NODE_ENV` has no standard value for). Falls back to the
 * conventional `NODE_ENV` values, defaulting to `"development"` — never
 * defaulting to `"production"`, so a misconfigured deployment fails the
 * requiredness checks below loudly instead of silently behaving as
 * development.
 */
export function resolveAppEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AppEnvironment {
  const explicit = env["APP_ENV"]?.trim().toLowerCase();
  if (explicit && isAppEnvironment(explicit)) return explicit;

  const nodeEnv = env["NODE_ENV"]?.trim().toLowerCase();
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";
  return "development";
}

export function isProductionEnvironment(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return resolveAppEnvironment(env) === "production";
}

/** Thrown by every fail-closed config check in this module — never a silent fallback. */
export class EnvironmentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentConfigError";
  }
}

/** Reads a required environment variable, or throws — never returns an empty string as if it were set. */
export function requireEnv(
  name: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new EnvironmentConfigError(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Fails closed when a flag meant only for local productivity (e.g. a dev auth
 * bypass) is set in production — the boot-time guard callers should invoke
 * before ever honoring such a flag. Never silently ignores the flag; refuses
 * to start instead, per Sprint 9's "no accidental production bypass" rule.
 */
export function assertDevOnlyFlagNotInProduction(
  flagName: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (isProductionEnvironment(env) && env[flagName] === "true") {
    throw new EnvironmentConfigError(
      `${flagName} is set to "true" but the resolved environment is production — refusing to start. ` +
        `This flag exists only for local development productivity.`,
    );
  }
}
