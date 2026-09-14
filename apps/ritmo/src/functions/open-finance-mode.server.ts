import { resolveAppEnvironment } from "@money-copilot/config";

/**
 * Founder Local Live Bank Pilot — explicit Open Finance mode.
 *
 * `"sandbox"` (the default everywhere, including staging/production once
 * those exist) uses Pluggy's sandbox connectors only. `"live"` uses real
 * financial institution connectors and is reachable ONLY for a single,
 * narrow, explicitly-consented local scenario: the Founder personally
 * piloting Ritmo against their own real bank, on their own machine, with the
 * app still talking to local PGlite (never a deployed environment).
 *
 * Deliberately a separate axis from `AppEnvironment` (development | test |
 * staging | production) rather than a fifth environment value — "live Open
 * Finance data" and "which tier is running" are independent questions, and
 * conflating them would make it impossible to later run a real staging
 * deployment against sandbox connectors (the actual near-term plan).
 */
export type OpenFinanceMode = "sandbox" | "live";

const OPEN_FINANCE_MODE_FLAG = "OPEN_FINANCE_MODE";
const FOUNDER_LIVE_BANK_PILOT_FLAG = "FOUNDER_LIVE_BANK_PILOT";

/**
 * Resolves to `"live"` only when ALL THREE of the following hold — any one
 * missing fails closed to `"sandbox"`:
 *
 *  1. The resolved `AppEnvironment` is exactly `"development"` — staging and
 *     production can never activate this mode no matter what the other two
 *     variables say (there is no environment-variable combination that
 *     escapes this check, unlike `DEV_AUTH_BYPASS`'s single explicit-flag
 *     gate — this one is structurally impossible to trigger outside a
 *     developer's own machine because staging/production deployments don't
 *     control `APP_ENV`).
 *  2. `OPEN_FINANCE_MODE=live` is explicitly set (any other value, including
 *     unset, stays `"sandbox"` — there is no implicit opt-in).
 *  3. `FOUNDER_LIVE_BANK_PILOT=true` is explicitly set — a second, distinct
 *     flag so that a stray `OPEN_FINANCE_MODE=live` alone (e.g. copy-pasted
 *     from another `.env` file) can never silently activate real-bank
 *     behavior; two independent, deliberate opt-ins are required together.
 */
export function resolveOpenFinanceMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OpenFinanceMode {
  const environment = resolveAppEnvironment(env);
  if (environment !== "development") return "sandbox";
  if (env[OPEN_FINANCE_MODE_FLAG] !== "live") return "sandbox";
  if (env[FOUNDER_LIVE_BANK_PILOT_FLAG] !== "true") return "sandbox";
  return "live";
}

export function isFounderLiveBankPilotActive(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return resolveOpenFinanceMode(env) === "live";
}
