import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";
import type { FinancialProfile } from "@money-copilot/financial-engine";

/**
 * Sprint 9: resolves an authenticated Better Auth user to their
 * `FinancialProfile`, provisioning one on their very first successful
 * login. The ONLY supported way anywhere in this codebase that an
 * authenticated identity becomes a `financialProfileId` — see
 * `apps/ritmo/src/functions/profile-context.ts`, the sole caller. Never
 * exposed as a route/tool a client could invoke with an arbitrary
 * `ownerUserId` — the caller must have already verified it via a real
 * session.
 */
export async function resolveOrProvisionProfileForOwner(
  db: Database,
  ownerUserId: string,
  displayName: string,
): Promise<FinancialProfile> {
  const existing = await repo.getProfileByOwnerUserId(db, ownerUserId);
  if (existing) return existing;
  return repo.provisionProfileForOwner(db, ownerUserId, displayName, new Date().toISOString());
}
