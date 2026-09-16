import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createId, type Id } from "@money-copilot/shared";
import { fromCents } from "@money-copilot/financial-engine";
import type { CategoryRule, RecurringExpenseCandidate } from "@money-copilot/financial-engine";
import { createDatabase } from "./db";
import { runMigrations } from "./migrate";
import * as repo from "./repositories";

async function freshDb() {
  const db = await createDatabase();
  await runMigrations(db);
  return db;
}

async function seedProfile(db: Awaited<ReturnType<typeof freshDb>>) {
  const profileId = createId("financial-profile");
  await repo.upsertProfile(db, { id: profileId, label: "Test", createdAt: "2026-09-05" });
  return profileId;
}

describe("CategoryRule — provenance round-trip and deletion (DEC-132)", () => {
  it("persists and reads back a user-declared rule's origin", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const rule: CategoryRule = {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "POSTO CAMPINAS",
      category: "Combustível",
      priority: 50,
      origin: "USER_DECLARED",
    };
    await repo.upsertCategoryRule(db, rule);

    const { categoryRules } = await repo.loadRules(db, profileId);
    const found = categoryRules.find((r) => r.id === rule.id);
    expect(found?.origin).toBe("USER_DECLARED");
  });

  it("defaults a legacy rule (no origin ever written) to SYSTEM_DEFAULT, never guessed as anything else", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    // Simulates a rule row from before DEC-132 — write directly, omitting
    // `origin` entirely.
    await db.execute(
      sql`insert into category_rules (id, match_type, pattern, category, priority)
          values ('legacy-rule-1', 'CONTAINS_MERCHANT', 'LEGACY', 'Other', 10)`,
    );
    const { categoryRules } = await repo.loadRules(db, profileId);
    const found = categoryRules.find((r) => r.id === "legacy-rule-1");
    expect(found?.origin).toBe("SYSTEM_DEFAULT");
  });

  it("deletes a rule by id", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const rule: CategoryRule = {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "TEMP",
      category: "Other",
      priority: 1,
      origin: "USER_DECLARED",
    };
    await repo.upsertCategoryRule(db, rule);
    await repo.deleteCategoryRule(db, rule.id);

    const { categoryRules } = await repo.loadRules(db, profileId);
    expect(categoryRules.find((r) => r.id === rule.id)).toBeUndefined();
  });
});

describe("CategoryRule — personal-rule ownership and conflict-safe upsert (DEC-133)", () => {
  function personalRule(financialProfileId: string, overrides: Partial<CategoryRule> = {}): CategoryRule {
    return {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Trabalho",
      priority: 200,
      origin: "USER_DECLARED",
      financialProfileId: financialProfileId as Id<"financial-profile">,
      ...overrides,
    };
  }

  it("(test 4, 6) correcting the same merchant twice for one profile updates the existing personal rule — never a duplicate", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);

    const first = await repo.upsertPersonalCategoryRule(db, personalRule(profileId));
    const second = await repo.upsertPersonalCategoryRule(
      db,
      personalRule(profileId, { category: "Transporte pessoal" }),
    );

    expect(second.id).toBe(first.id);
    const { categoryRules } = await repo.loadRules(db, profileId);
    const uberRules = categoryRules.filter((r) => r.pattern === "UBER" && r.financialProfileId === profileId);
    expect(uberRules).toHaveLength(1);
    expect(uberRules[0]?.category).toBe("Transporte pessoal");
  });

  it("(test 4) two different profiles each get their own independent personal rule for the same merchant", async () => {
    const db = await freshDb();
    const profileA = await seedProfile(db);
    const profileB = await seedProfile(db);

    await repo.upsertPersonalCategoryRule(db, personalRule(profileA, { category: "Trabalho" }));
    await repo.upsertPersonalCategoryRule(db, personalRule(profileB, { category: "Lazer" }));

    const rulesForA = (await repo.loadRules(db, profileA)).categoryRules.filter((r) => r.pattern === "UBER");
    const rulesForB = (await repo.loadRules(db, profileB)).categoryRules.filter((r) => r.pattern === "UBER");
    expect(rulesForA.map((r) => r.category)).toEqual(["Trabalho"]);
    expect(rulesForB.map((r) => r.category)).toEqual(["Lazer"]);
  });

  it("refuses to upsert a rule with no financialProfileId as a personal rule", async () => {
    const db = await freshDb();
    const globalRule: CategoryRule = {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Transporte",
      priority: 100,
      origin: "SYSTEM_DEFAULT",
    };
    await expect(repo.upsertPersonalCategoryRule(db, globalRule)).rejects.toThrow();
  });
});

describe("RecurringExpenseCandidate persistence — conflict-safe upsert (DEC-132)", () => {
  function candidate(overrides: Partial<RecurringExpenseCandidate> = {}): RecurringExpenseCandidate {
    return {
      id: createId("recurring-candidate"),
      evidenceKey: "NETFLIX:5590",
      normalizedMerchant: "NETFLIX",
      evidence: {
        occurrences: 3,
        transactionIds: [],
        averageAmount: fromCents(5_590),
        averageIntervalDays: 30,
      },
      confidence: "HIGH",
      status: "CANDIDATE",
      createdAt: "2026-09-01",
      ...overrides,
    };
  }

  it("re-detecting the same evidence twice never creates a second row — updates evidence in place", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);

    const first = await repo.upsertRecurringCandidate(db, candidate(), profileId, "FIXED_EXPENSE");
    const second = await repo.upsertRecurringCandidate(
      db,
      candidate({ evidence: { ...candidate().evidence, occurrences: 4 } }),
      profileId,
      "FIXED_EXPENSE",
    );

    expect(second.id).toBe(first.id);
    const listed = await repo.listRecurringCandidatesForProfile(db, profileId, "FIXED_EXPENSE");
    expect(listed).toHaveLength(1);
    expect(listed[0]?.evidence.occurrences).toBe(4);
  });

  it("never resets a CONFIRMED/REJECTED candidate's status back to CANDIDATE on re-detection", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);

    const saved = await repo.upsertRecurringCandidate(db, candidate(), profileId, "INCOME");
    await repo.updateRecurringCandidateStatus(db, saved.id, "CONFIRMED");

    const reDetected = await repo.upsertRecurringCandidate(db, candidate(), profileId, "INCOME");
    expect(reDetected.status).toBe("CONFIRMED");
    expect(reDetected.id).toBe(saved.id);
  });

  it("the same evidenceKey is independent across INCOME and FIXED_EXPENSE kinds for the same profile", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);

    await repo.upsertRecurringCandidate(db, candidate(), profileId, "INCOME");
    await repo.upsertRecurringCandidate(db, candidate(), profileId, "FIXED_EXPENSE");

    expect(await repo.listRecurringCandidatesForProfile(db, profileId, "INCOME")).toHaveLength(1);
    expect(await repo.listRecurringCandidatesForProfile(db, profileId, "FIXED_EXPENSE")).toHaveLength(1);
  });
});
