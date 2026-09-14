import { createDatabase, runMigrations, seed, schema, type Database } from "@money-copilot/persistence";
import * as repo from "@money-copilot/persistence";
import { MockProvider } from "@money-copilot/open-finance";
import type {
  ExternalAccountInput,
  ExternalTransactionInput,
  ExternalBillInput,
} from "@money-copilot/financial-engine";
import type { Id } from "@money-copilot/shared";
import { registerProvider, resetProviderRegistry } from "./provider-registry";

/** A fresh, migrated, seeded (founder fixture) in-memory database for tests. */
export async function freshSeededDb(): Promise<Database> {
  const db = await createDatabase();
  await runMigrations(db);
  await seed(db);
  return db;
}

/**
 * Sprint 9: a second, completely independent profile in the SAME database
 * as the founder fixture — the minimum needed for every two-profile
 * isolation regression test in this package (`*-isolation.test.ts`). Has no
 * transactions/income of its own; individual tests attach whatever specific
 * resource (a connection, a conversation, an alert, ...) they need to
 * verify isolation for. Goes through the SAME real `provisionProfileForOwner`
 * function `apps/ritmo`'s auth wiring uses for a genuinely new user's first
 * login (with a fake `ownerUserId`, since no real Better Auth user exists in
 * these tests) — this exercises that provisioning path (including the
 * placeholder `FinancialGoal` it creates, required by
 * `loadFinancialSnapshotInput`) rather than a parallel, hand-rolled one.
 * `financial_profiles.owner_user_id` has a real FK to Better Auth's `user`
 * table, so a minimal test-only `user` row is inserted directly first —
 * no real Better Auth signup flow runs in these tests, just enough of a
 * row to be a valid FK target.
 */
export async function seedSecondProfile(
  db: Database,
  label = "Second test profile (Sprint 9 isolation fixture)",
): Promise<Id<"financial-profile">> {
  const ownerUserId = `test-user-${Math.random().toString(36).slice(2)}`;
  const now = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(schema.user).values({
    id: ownerUserId,
    name: label,
    email: `${ownerUserId}@isolation-test.invalid`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });
  const profile = await repo.provisionProfileForOwner(db, ownerUserId, label, "2026-01-01");
  return profile.id as Id<"financial-profile">;
}

export function installMockProvider(options: {
  accounts: readonly ExternalAccountInput[];
  transactionsByAccount: ReadonlyMap<string, readonly ExternalTransactionInput[]>;
  billsByAccount?: ReadonlyMap<string, readonly ExternalBillInput[]>;
  clientUserIdByExternalConnectionId?: ReadonlyMap<string, string>;
}): MockProvider {
  resetProviderRegistry();
  const provider = new MockProvider(options);
  registerProvider("mock", provider);
  return provider;
}
