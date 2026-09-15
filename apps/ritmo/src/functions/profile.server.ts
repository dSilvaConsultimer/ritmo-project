import { getRequestHeaders } from "@tanstack/react-start/server";
import { getDb, resolveOrProvisionProfileForOwner } from "@money-copilot/app-services";
import { resolveAppEnvironment, assertDevOnlyFlagNotInProduction } from "@money-copilot/config";
import { getAuth } from "./auth.server";

/**
 * Server-only profile/session resolution. This file imports
 * `@tanstack/react-start/server` and must never be imported from
 * client-context code. The `.server.ts` suffix signals this to Vite's
 * import protection.
 *
 * This is the single seam every Ritmo server function goes through to learn
 * WHICH financial profile it's acting on — never `DEMO_PROFILE_ID` imported
 * ad hoc in individual server functions.
 *
 * CRITICAL (Sprint 9 "Authorization boundary"): this function — not
 * TanStack Router's `beforeLoad` — is the actual security boundary. Every
 * server function calls this itself and never accepts a caller-supplied
 * `financialProfileId`; `beforeLoad`-based route protection is a UX layer
 * on top that prevents a content flash before redirect, nothing more. A
 * request that reaches a server function directly — bypassing the router
 * entirely — gets exactly the same enforcement here.
 */
export interface ProfileContext {
  readonly financialProfileId: string;
  /** The user's own real name (Better Auth's `user.name`) */
  readonly displayName: string;
  /** The user's own real email (Better Auth's `user.email`) — never fabricated. */
  readonly email: string;
  /** ISO 8601. Better Auth's `user.createdAt` — real account-creation time. */
  readonly createdAt: string;
}

/** Thrown whenever no valid authenticated session exists */
export class UnauthenticatedError extends Error {
  constructor() {
    super("No authenticated session.");
    this.name = "UnauthenticatedError";
  }
}

const DEV_AUTH_BYPASS_FLAG = "DEV_AUTH_BYPASS";

/**
 * Sprint 9 Phase 4 fix-up (docs/DECISIONS.md DEC-104): explicit
 * development/test allow-list, not `resolveAppEnvironment() !== "production"`
 * — see `session.server.ts`'s identical helper for the full rationale (a
 * `staging` environment must never honor this flag either).
 */
function isDevOrTestEnvironment(): boolean {
  const environment = resolveAppEnvironment();
  return environment === "development" || environment === "test";
}

export async function getCurrentProfileContext(): Promise<ProfileContext> {
  assertDevOnlyFlagNotInProduction(DEV_AUTH_BYPASS_FLAG);
  if (isDevOrTestEnvironment() && process.env[DEV_AUTH_BYPASS_FLAG] === "true") {
    const { DEMO_PROFILE_ID } = await import("@money-copilot/app-services");
    return {
      financialProfileId: DEMO_PROFILE_ID,
      displayName: "Douglas (dev bypass)",
      email: "dev-bypass@ritmo.local",
      createdAt: new Date(0).toISOString(),
    };
  }

  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: getRequestHeaders() });
  if (!session) {
    throw new UnauthenticatedError();
  }

  const db = await getDb();
  const displayName = session.user.name || session.user.email;
  const profile = await resolveOrProvisionProfileForOwner(db, session.user.id, displayName);

  return {
    financialProfileId: profile.id,
    displayName,
    email: session.user.email,
    createdAt: new Date(session.user.createdAt).toISOString(),
  };
}
