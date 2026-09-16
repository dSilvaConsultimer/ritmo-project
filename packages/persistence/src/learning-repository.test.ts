import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createId, type Id } from "@money-copilot/shared";
import { categorize, fromCents } from "@money-copilot/financial-engine";
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
    // DEC-134: a USER_DECLARED rule MUST carry a financialProfileId — the
    // DB's own ownership CHECK constraint now enforces this, not just
    // application code — so this exercises the real personal-rule path.
    const rule: CategoryRule = {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "POSTO CAMPINAS",
      category: "Combustível",
      priority: 50,
      origin: "USER_DECLARED",
      financialProfileId: profileId as Id<"financial-profile">,
    };
    await repo.upsertPersonalCategoryRule(db, rule);

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
      financialProfileId: profileId as Id<"financial-profile">,
    };
    await repo.upsertPersonalCategoryRule(db, rule);
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

describe("CategoryRule — DB-level uniqueness per tier (DEC-134)", () => {
  it("(test 1) two identical SYSTEM_DEFAULT rows for the same (matchType, pattern) cannot both exist — the DB itself rejects the second", async () => {
    const db = await freshDb();
    await db.execute(
      sql`insert into category_rules (id, match_type, pattern, category, priority, origin)
          values ('global-uber-1', 'CONTAINS_MERCHANT', 'UBER', 'Transporte', 100, 'SYSTEM_DEFAULT')`,
    );
    await expect(
      db.execute(
        sql`insert into category_rules (id, match_type, pattern, category, priority, origin)
            values ('global-uber-2', 'CONTAINS_MERCHANT', 'UBER', 'Transporte', 100, 'SYSTEM_DEFAULT')`,
      ),
    ).rejects.toThrow();
  });

  it("(test 2) two different profiles may each have their own identical personal matcher (same matchType+pattern)", async () => {
    const db = await freshDb();
    const profileA = await seedProfile(db);
    const profileB = await seedProfile(db);

    await expect(
      repo.upsertPersonalCategoryRule(db, {
        id: createId("category-rule"),
        matchType: "CONTAINS_MERCHANT",
        pattern: "UBER",
        category: "Trabalho",
        priority: 200,
        origin: "USER_DECLARED",
        financialProfileId: profileA as Id<"financial-profile">,
      }),
    ).resolves.toBeDefined();
    await expect(
      repo.upsertPersonalCategoryRule(db, {
        id: createId("category-rule"),
        matchType: "CONTAINS_MERCHANT",
        pattern: "UBER",
        category: "Lazer",
        priority: 200,
        origin: "USER_DECLARED",
        financialProfileId: profileB as Id<"financial-profile">,
      }),
    ).resolves.toBeDefined();
  });

  it("(test 3) the same profile cannot duplicate a personal matcher via a raw insert bypassing the upsert helper", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    await repo.upsertPersonalCategoryRule(db, {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Trabalho",
      priority: 200,
      origin: "USER_DECLARED",
      financialProfileId: profileId as Id<"financial-profile">,
    });

    await expect(
      db.execute(
        sql`insert into category_rules (id, match_type, pattern, category, priority, origin, financial_profile_id)
            values (${createId("category-rule")}, 'CONTAINS_MERCHANT', 'UBER', 'Outro', 200, 'USER_DECLARED', ${profileId})`,
      ),
    ).rejects.toThrow();
  });

  it("(test 4) a personal rule and the global default for the same matcher may coexist without conflict", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    const globalRule = {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT" as const,
      pattern: "UBER",
      category: "Transporte",
      priority: 100,
      origin: "SYSTEM_DEFAULT" as const,
    };
    await repo.upsertCategoryRule(db, globalRule);
    const personalRule = await repo.upsertPersonalCategoryRule(db, {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Trabalho",
      priority: 200,
      origin: "USER_DECLARED",
      financialProfileId: profileId as Id<"financial-profile">,
    });

    const { categoryRules } = await repo.loadRules(db, profileId);
    expect(categoryRules.some((r) => r.id === globalRule.id)).toBe(true);
    expect(categoryRules.some((r) => r.id === personalRule.id)).toBe(true);
  });

  it("(test 5) personal still wins during categorization even with both rows coexisting in the loaded rule set", async () => {
    const db = await freshDb();
    const profileId = await seedProfile(db);
    await repo.upsertCategoryRule(db, {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Transporte",
      priority: 100,
      origin: "SYSTEM_DEFAULT",
    });
    await repo.upsertPersonalCategoryRule(db, {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Trabalho",
      priority: 1, // deliberately lower — precedence must still favor personal
      origin: "USER_DECLARED",
      financialProfileId: profileId as Id<"financial-profile">,
    });

    const { categoryRules } = await repo.loadRules(db, profileId);
    const transaction = {
      id: createId("transaction"),
      financialProfileId: profileId as Id<"financial-profile">,
      paymentSource: { id: createId("payment-source"), label: "Nubank", type: "CREDIT_CARD" as const },
      date: "2026-09-05",
      amount: fromCents(3_000),
      direction: "DEBIT" as const,
      rawDescription: "UBER TRIP",
      normalizedDescription: "UBER TRIP",
      rawMerchant: "UBER",
      normalizedMerchant: "UBER",
      status: "POSTED" as const,
      certainty: "ACTUAL" as const,
      financialEffect: "CONSUMPTION" as const,
      category: null,
      origin: "IMPORTED" as const,
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    };
    expect(categorize(transaction, categoryRules).category).toBe("Trabalho");
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
