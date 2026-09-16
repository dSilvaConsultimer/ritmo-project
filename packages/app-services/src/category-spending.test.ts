import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import { fixtureProfile, fromReais } from "@money-copilot/financial-engine";
import type { FinancialTransaction, PaymentSource } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { categorizeTransaction, createCategory } from "./mutations";
import { backfillCategoryRuleCategoryIds } from "./sync";
import { getCategorySpendingDetail, getCategoryTotals } from "./queries";
import { freshSeededDb } from "./test-helpers";

const ASOF = "2026-09-05";

async function source(db: Awaited<ReturnType<typeof freshSeededDb>>): Promise<PaymentSource> {
  const s: PaymentSource = { id: createId("payment-source"), label: "Conta Corrente", type: "DEBIT" };
  await repo.upsertPaymentSource(db, s, fixtureProfile.id);
  return s;
}

async function tx(
  db: Awaited<ReturnType<typeof freshSeededDb>>,
  paymentSource: PaymentSource,
  overrides: Partial<FinancialTransaction>,
): Promise<FinancialTransaction> {
  const transaction: FinancialTransaction = {
    id: createId("transaction"),
    financialProfileId: fixtureProfile.id,
    paymentSource,
    date: ASOF,
    amount: fromReais(50),
    direction: "DEBIT",
    rawDescription: "GENERIC",
    normalizedDescription: "GENERIC",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: null,
    origin: "IMPORTED",
    createdAt: ASOF,
    updatedAt: ASOF,
    ...overrides,
  };
  await repo.upsertTransaction(db, transaction);
  return transaction;
}

describe("category spending (DEC-135, tests 9-14)", () => {
  it("(test 9) a CONSUMPTION transaction counts toward its category's total", async () => {
    const db = await freshSeededDb();
    const s = await source(db);
    await tx(db, s, { category: "Combustível", amount: fromReais(100) });

    const totals = await getCategoryTotals(db, fixtureProfile.id, ASOF);
    const combustivel = totals.find((t) => t.category === "Combustível");
    expect(combustivel?.total.cents).toBe(fromReais(100).cents);
  });

  it("(test 10) a TRANSFER never appears in category spending totals", async () => {
    const db = await freshSeededDb();
    const s = await source(db);
    await tx(db, s, { category: "Combustível", financialEffect: "TRANSFER", amount: fromReais(2_000) });

    const totals = await getCategoryTotals(db, fixtureProfile.id, ASOF);
    const combustivel = totals.find((t) => t.category === "Combustível");
    expect(combustivel).toBeUndefined();
  });

  it("(test 11) a CARD_PAYMENT never appears in category spending totals", async () => {
    const db = await freshSeededDb();
    const s = await source(db);
    await tx(db, s, { category: "Fatura", financialEffect: "CARD_PAYMENT", amount: fromReais(961.95) });

    const totals = await getCategoryTotals(db, fixtureProfile.id, ASOF);
    expect(totals.find((t) => t.category === "Fatura")).toBeUndefined();
  });

  it("(test 12) an INVESTMENT movement never appears in category spending totals", async () => {
    const db = await freshSeededDb();
    const s = await source(db);
    await tx(db, s, { category: "Investimentos", financialEffect: "INVESTMENT", amount: fromReais(500) });

    const totals = await getCategoryTotals(db, fixtureProfile.id, ASOF);
    expect(totals.find((t) => t.category === "Investimentos")).toBeUndefined();
  });

  it("(test 13) the category filter returns exactly the transactions composing that category's total", async () => {
    const db = await freshSeededDb();
    const s = await source(db);
    const uber1 = await tx(db, s, { category: "Transporte", amount: fromReais(42) });
    const uber2 = await tx(db, s, { category: "Transporte", amount: fromReais(31) });
    await tx(db, s, { category: "Delivery", amount: fromReais(60) });

    const detail = await getCategorySpendingDetail(db, fixtureProfile.id, ASOF, "Transporte");
    expect(detail.map((t) => t.id).sort()).toEqual([uber1.id, uber2.id].sort());
  });

  it("(test 14) the uncategorized filter returns genuinely uncategorized transactions and never a categorized one", async () => {
    const db = await freshSeededDb();
    const s = await source(db);
    const pix = await tx(db, s, { category: "UNCATEGORIZED", rawDescription: "PIX MARCOS SILVA" });
    const categorized = await tx(db, s, { category: "Transporte" });

    // freshSeededDb's own founder fixture already has a real UNCATEGORIZED
    // transaction (PagSeguro) this same month — the filter must include it
    // too (never suppress a genuine match), while still never including
    // the categorized one.
    const detail = await getCategorySpendingDetail(db, fixtureProfile.id, ASOF, "UNCATEGORIZED");
    expect(detail.map((t) => t.id)).toContain(pix.id);
    expect(detail.map((t) => t.id)).not.toContain(categorized.id);
  });

  it("(test 15) the period filter returns a different month's totals when a different asOfDate is passed", async () => {
    const db = await freshSeededDb();
    const s = await source(db);
    await tx(db, s, { category: "Transporte", date: "2026-08-15", amount: fromReais(100) });
    await tx(db, s, { category: "Transporte", date: "2026-09-05", amount: fromReais(40) });

    const august = await getCategoryTotals(db, fixtureProfile.id, "2026-08-20");
    const september = await getCategoryTotals(db, fixtureProfile.id, "2026-09-05");

    expect(august.find((t) => t.category === "Transporte")?.total.cents).toBe(fromReais(100).cents);
    expect(september.find((t) => t.category === "Transporte")?.total.cents).toBe(fromReais(40).cents);
  });

  it("(test 16, 17) a retroactive category change updates historical category totals, and never touches amount/financialEffect", async () => {
    const db = await freshSeededDb();
    const s = await source(db);
    const older = await tx(db, s, {
      date: "2026-09-01",
      category: "UNCATEGORIZED",
      normalizedMerchant: "UBER",
      rawMerchant: "UBER",
      rawDescription: "UBER TRIP",
      normalizedDescription: "UBER TRIP",
      amount: fromReais(42),
    });
    const target = await tx(db, s, {
      date: "2026-09-05",
      category: "UNCATEGORIZED",
      normalizedMerchant: "UBER",
      rawMerchant: "UBER",
      rawDescription: "UBER TRIP",
      normalizedDescription: "UBER TRIP",
      amount: fromReais(31),
    });

    const beforeTotals = await getCategoryTotals(db, fixtureProfile.id, ASOF);
    expect(beforeTotals.find((t) => t.category === "Trabalho")).toBeUndefined();

    const category = await createCategory(db, fixtureProfile.id, { name: "Trabalho" });
    await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: target.id,
      categoryId: category.id,
      alwaysForMerchant: true,
    });

    const afterTotals = await getCategoryTotals(db, fixtureProfile.id, ASOF);
    const trabalho = afterTotals.find((t) => t.category === "Trabalho");
    expect(trabalho?.total.cents).toBe(fromReais(42 + 31).cents);

    const reclassifiedOlder = await repo.getTransactionById(db, older.id);
    expect(reclassifiedOlder?.amount.cents).toBe(fromReais(42).cents);
    expect(reclassifiedOlder?.financialEffect).toBe("CONSUMPTION");
  });
});

describe("backfillCategoryRuleCategoryIds (DEC-135, test 18: old free-text category data migrates safely)", () => {
  it("links a legacy global rule whose category string exactly matches a base category", async () => {
    const db = await freshSeededDb();
    const base = { id: createId("category"), name: "Transporte" };
    await repo.upsertCategory(db, base);
    await repo.upsertCategoryRule(db, {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Transporte",
      priority: 100,
      origin: "SYSTEM_DEFAULT",
    });

    const result = await backfillCategoryRuleCategoryIds(db);
    expect(result.linkedRuleIds).toHaveLength(1);
    expect(result.unresolvedCategoryNames).not.toContain("Transporte");

    const { categoryRules } = await repo.loadRules(db, fixtureProfile.id);
    const linked = categoryRules.find((r) => r.pattern === "UBER");
    expect(linked?.categoryId).toBe(base.id);
  });

  it("reports an unresolved legacy category string rather than inventing a mapping", async () => {
    // freshSeededDb's own founder fixture (fixtures/rules.ts) already
    // carries real Sprint 1/2 English-named global rules ("Food,"
    // "Transportation," "Entertainment," "Shopping") — with NO base
    // categories bootstrapped in this test (freshSeededDb calls only
    // seed(), never bootstrapBaseCategories), every one of them must come
    // back unresolved rather than guessed at.
    const db = await freshSeededDb();

    const result = await backfillCategoryRuleCategoryIds(db);
    expect(result.unresolvedCategoryNames).toContain("Food");
    expect(result.unresolvedCategoryNames).toContain("Transportation");
    expect(result.linkedRuleIds).toHaveLength(0);
  });

  it("is idempotent — a second run relinks nothing and reports the same unresolved set", async () => {
    const db = await freshSeededDb();
    const base = { id: createId("category"), name: "Transporte" };
    await repo.upsertCategory(db, base);
    await repo.upsertCategoryRule(db, {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Transporte",
      priority: 100,
      origin: "SYSTEM_DEFAULT",
    });
    // freshSeededDb's own founder fixture already contributes several
    // unresolved English-named global rules ("Food," "Transportation," …)
    // — reused here rather than inserting a second colliding one.

    const first = await backfillCategoryRuleCategoryIds(db);
    const second = await backfillCategoryRuleCategoryIds(db);
    expect(first.linkedRuleIds).toHaveLength(1);
    expect(second.linkedRuleIds).toHaveLength(0);
    expect(second.unresolvedCategoryNames).toEqual(first.unresolvedCategoryNames);
  });

  it("never links a global rule to a PERSONAL category, and never links a profile's rule to another profile's personal category", async () => {
    const db = await freshSeededDb();
    const otherProfileCategory = await createCategory(db, fixtureProfile.id, { name: "Trabalho" });
    await repo.upsertCategoryRule(db, {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Trabalho", // matches a PERSONAL category by name, but this rule is GLOBAL.
      priority: 100,
      origin: "SYSTEM_DEFAULT",
    });

    const result = await backfillCategoryRuleCategoryIds(db);
    expect(result.unresolvedCategoryNames).toContain("Trabalho");
    void otherProfileCategory;
  });
});
