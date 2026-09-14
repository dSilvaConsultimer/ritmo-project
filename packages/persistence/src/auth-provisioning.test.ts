import { describe, expect, it } from "vitest";
import { createDatabase } from "./db";
import { runMigrations } from "./migrate";
import * as schema from "./schema";
import { getProfileByOwnerUserId, provisionProfileForOwner } from "./repositories";

async function freshDb() {
  const db = await createDatabase();
  await runMigrations(db);
  return db;
}

async function insertTestUser(db: Awaited<ReturnType<typeof freshDb>>, id: string) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  await db.insert(schema.user).values({
    id,
    name: "Test User",
    email: `${id}@provisioning-test.invalid`,
    emailVerified: false,
    createdAt: now,
    updatedAt: now,
  });
}

describe("provisionProfileForOwner (Sprint 9)", () => {
  it("creates exactly one FinancialProfile and one placeholder FinancialGoal for a brand-new owner", async () => {
    const db = await freshDb();
    await insertTestUser(db, "user-1");

    const profile = await provisionProfileForOwner(db, "user-1", "Test User", "2026-01-01");

    const allGoals = await db.select().from(schema.financialGoals);
    const ownGoal = allGoals.find((g) => g.financialProfileId === profile.id);
    expect(ownGoal).toBeDefined();
    expect(ownGoal?.monthlySavingsTargetCents).toBe(0);
  });

  it("is idempotent — a second call for the same owner returns the SAME profile, never a second one", async () => {
    const db = await freshDb();
    await insertTestUser(db, "user-2");

    const first = await provisionProfileForOwner(db, "user-2", "Test User", "2026-01-01");
    const second = await provisionProfileForOwner(db, "user-2", "Test User", "2026-01-01");

    expect(second.id).toBe(first.id);

    const allProfiles = await db.select().from(schema.financialProfiles);
    expect(allProfiles.filter((p) => p.ownerUserId === "user-2")).toHaveLength(1);

    // Only ONE goal was created — the second call must not create a duplicate.
    const allGoals = await db.select().from(schema.financialGoals);
    expect(allGoals.filter((g) => g.financialProfileId === first.id)).toHaveLength(1);
  });

  it("rejects an owner_user_id with no matching Better Auth user row (real FK enforcement)", async () => {
    const db = await freshDb();
    await expect(
      provisionProfileForOwner(db, "no-such-user", "Test User", "2026-01-01"),
    ).rejects.toThrow();
  });

  it("getProfileByOwnerUserId finds the provisioned profile and returns undefined for an unknown owner", async () => {
    const db = await freshDb();
    await insertTestUser(db, "user-3");
    const profile = await provisionProfileForOwner(db, "user-3", "Test User", "2026-01-01");

    expect((await getProfileByOwnerUserId(db, "user-3"))?.id).toBe(profile.id);
    expect(await getProfileByOwnerUserId(db, "user-nonexistent")).toBeUndefined();
  });
});
