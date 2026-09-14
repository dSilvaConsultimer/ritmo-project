import { APIError } from "better-auth";
import { resolveAppEnvironment } from "@money-copilot/config";
import { getAuth } from "./auth.server";

/**
 * Server-only, development/test-only idempotent provisioning for a
 * repeatable local test login (Sprint 9 Phase 4 fix-up — see
 * docs/DECISIONS.md DEC-104). Uses Better Auth's REAL sign-up API — no
 * fake authentication, no shortcut around `getCurrentProfileContext()`.
 * This account's `FinancialProfile` is provisioned the exact same way any
 * real user's is (`resolveOrProvisionProfileForOwner`, first triggered on
 * this account's first real login) — lazily, with zero connections and no
 * Founder/demo fixture data, never something this file writes directly.
 *
 * The fixed password is acceptable ONLY because this function refuses to
 * run outside development/test — there is no path by which this account
 * can be created in staging/production.
 */
export const DEV_TEST_USER = {
  email: "teste@ritmo.local",
  password: "RitmoTeste123!",
  name: "Teste Ritmo",
} as const;

export class DevSeedProductionRefusalError extends Error {
  constructor(environment: string) {
    super(
      `ensureDevTestUser refuses to run outside development/test (resolved environment: "${environment}").`,
    );
    this.name = "DevSeedProductionRefusalError";
  }
}

/**
 * Plain function holding the real logic — callable from the dev-only route
 * (`routes/api/dev-seed.ts`) and directly from tests.
 */
export async function ensureDevTestUserHandler(): Promise<{ readonly created: boolean }> {
  const environment = resolveAppEnvironment();
  if (environment !== "development" && environment !== "test") {
    throw new DevSeedProductionRefusalError(environment);
  }

  const auth = await getAuth();
  try {
    await auth.api.signUpEmail({
      body: {
        email: DEV_TEST_USER.email,
        password: DEV_TEST_USER.password,
        name: DEV_TEST_USER.name,
      },
    });
    return { created: true };
  } catch (error) {
    // Idempotent: a second call finds the account already exists and treats
    // that as success rather than an error — never a special "already
    // provisioned" code path duplicating Better Auth's own uniqueness check.
    if (error instanceof APIError && error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      return { created: false };
    }
    throw error;
  }
}
