import { getRequestHeaders } from "@tanstack/react-start/server";
import { resolveAppEnvironment, assertDevOnlyFlagNotInProduction } from "@money-copilot/config";
import { getAuth } from "./auth.server";

/**
 * Server-only UX-layer session check for route `beforeLoad` guards. This is
 * deliberately NOT the security boundary — the server functions themselves
 * independently resolve and verify the caller's session. The `.server.ts`
 * suffix signals to Vite's import protection that this is server-only.
 */
const DEV_AUTH_BYPASS_FLAG = "DEV_AUTH_BYPASS";

/**
 * Sprint 9 Phase 4 fix-up (docs/DECISIONS.md DEC-104): explicit
 * development/test allow-list, not `resolveAppEnvironment() !== "production"`
 * — the old condition let this bypass activate in a `staging` environment
 * too (never actually exercised, but a real gap against the brief's
 * "impossible in staging/production" requirement). `assertDevOnlyFlagNotInProduction`
 * below still independently fails closed for production specifically.
 */
function isDevOrTestEnvironment(): boolean {
  const environment = resolveAppEnvironment();
  return environment === "development" || environment === "test";
}

/**
 * Plain function holding the real logic. Can be called from both server
 * functions and directly from tests.
 */
export async function checkAuthenticatedHandler(): Promise<{ authenticated: boolean }> {
  assertDevOnlyFlagNotInProduction(DEV_AUTH_BYPASS_FLAG);
  if (isDevOrTestEnvironment() && process.env[DEV_AUTH_BYPASS_FLAG] === "true") {
    return { authenticated: true };
  }

  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  return { authenticated: session !== null };
}
