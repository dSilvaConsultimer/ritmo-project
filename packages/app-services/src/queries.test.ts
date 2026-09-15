import { afterEach, describe, expect, it } from "vitest";
import {
  fixtureProfile,
  categoryRules as fixtureCategoryRules,
  fromReais,
  type FinancialTransaction,
  type PaymentSource,
} from "@money-copilot/financial-engine";
import type { ExternalAccountInput } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { createId } from "@money-copilot/shared";
import {
  getFinancialPosition,
  getInstallmentCommitments,
  getConnections,
  getReconciliationCandidates,
  getLifestyleComparison,
  getRecurringCandidates,
  getRecurringIncomeCandidates,
  getRecurringFixedExpenseCandidates,
  getRealizedIncomeForProfile,
  getUncategorizedTransactions,
  getFixedExpensesForProfile,
  getCategoryRuleCount,
  getCategoryRulesList,
} from "./queries";
import { syncConnection } from "./sync";
import { resetProviderRegistry } from "./provider-registry";
import { freshSeededDb, installMockProvider } from "./test-helpers";

const ASOF = "2026-09-05";

afterEach(() => {
  resetProviderRegistry();
});

describe("getFinancialPosition", () => {
  it("is UNKNOWN coverage before any account is connected", async () => {
    const db = await freshSeededDb();
    const position = await getFinancialPosition(db, fixtureProfile.id, ASOF);
    expect(position.coverage).toBe("UNKNOWN");
  });

  it("derives a COMPLETE-coverage position from synced account balances", async () => {
    const db = await freshSeededDb();
    const account: ExternalAccountInput = {
      provider: "mock",
      externalAccountId: "mock-position-account-1",
      connectionExternalId: "mock-position-conn-1",
      kind: "BANK",
      displayName: "Mock Checking",
      currency: "BRL",
      balanceCents: 250_000,
      balanceCertainty: "ACTUAL",
      lastSyncedAt: "2026-09-05T00:00:00.000Z",
    };
    installMockProvider({ accounts: [account], transactionsByAccount: new Map() });
    const connection = {
      id: createId("provider-connection"),
      financialProfileId: fixtureProfile.id,
      provider: "mock" as const,
      externalConnectionId: account.connectionExternalId,
      status: "PENDING" as const,
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    };
    await repo.upsertProviderConnection(db, connection);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const position = await getFinancialPosition(db, fixtureProfile.id, ASOF);
    expect(position.coverage).toBe("COMPLETE");
    expect(position.cashBalance.amount?.cents).toBe(250_000);
  });
});

describe("getInstallmentCommitments", () => {
  it("reports the old debt's current-period amount and flags the incomplete schedule", async () => {
    const db = await freshSeededDb();
    const commitments = await getInstallmentCommitments(db, fixtureProfile.id, ASOF);
    expect(commitments.currentPeriodAmount.cents).toBe(140_000);
    expect(commitments.hasIncompleteData).toBe(true);
  });
});

describe("getConnections", () => {
  it("returns an empty list for a profile with no provider connections", async () => {
    const db = await freshSeededDb();
    expect(await getConnections(db, fixtureProfile.id)).toEqual([]);
  });
});

describe("getReconciliationCandidates", () => {
  it("is empty for the clean fixture (no unresolved possible duplicates)", async () => {
    const db = await freshSeededDb();
    expect(await getReconciliationCandidates(db, fixtureProfile.id, ASOF)).toEqual([]);
  });
});

describe("getRecurringCandidates", () => {
  it("finds no recurring pattern in the fixture's single-month transaction set", async () => {
    const db = await freshSeededDb();
    expect(await getRecurringCandidates(db, fixtureProfile.id, ASOF)).toEqual([]);
  });
});

describe("getFixedExpensesForProfile", () => {
  it("returns the fixture's confirmed recurring commitments, with dueDayOfMonth absent by default", async () => {
    const db = await freshSeededDb();
    const expenses = await getFixedExpensesForProfile(db, fixtureProfile.id, ASOF);
    expect(expenses.length).toBeGreaterThan(0);
    expect(expenses.some((e) => e.label.toLowerCase().includes("housing") || e.category === "Housing")).toBe(true);
    for (const expense of expenses) {
      expect(expense.dueDayOfMonth).toBeUndefined();
    }
  });
});

describe("getCategoryRuleCount", () => {
  it("matches the real global rule set, not a hardcoded number", async () => {
    const db = await freshSeededDb();
    expect(await getCategoryRuleCount(db)).toBe(fixtureCategoryRules.length);
  });
});

describe("getCategoryRulesList", () => {
  it("returns the same count as getCategoryRuleCount, sorted by descending priority", async () => {
    const db = await freshSeededDb();
    const rules = await getCategoryRulesList(db);
    expect(rules.length).toBe(fixtureCategoryRules.length);
    for (let i = 1; i < rules.length; i++) {
      expect(rules[i - 1]!.priority).toBeGreaterThanOrEqual(rules[i]!.priority);
    }
  });
});

describe("getUncategorizedTransactions", () => {
  it("flags the PagSeguro transaction as uncategorized", async () => {
    const db = await freshSeededDb();
    const uncategorized = await getUncategorizedTransactions(db, fixtureProfile.id, ASOF);
    expect(uncategorized).toHaveLength(1);
    expect(uncategorized[0]?.rawMerchant).toBe("PAGSEGURO");
  });
});

describe("getLifestyleComparison", () => {
  it("reports both current and independent-living scenarios as SUSTAINABLE for the fixture", async () => {
    const db = await freshSeededDb();
    const comparison = await getLifestyleComparison(db, fixtureProfile.id, ASOF);
    expect(comparison.currentViability).toBe("SUSTAINABLE");
    expect(comparison.independentViability).toBe("SUSTAINABLE");
  });
});

/**
 * Sprint 9 (DEC-127) — "Entradas do mês" bug fix regression suite. Builds
 * transactions directly (rather than via a full Pluggy sync) to isolate
 * exactly the query logic under test; reuses an existing fixture
 * `PaymentSource` (the FK just needs to be valid, its identity is
 * irrelevant here).
 */
async function fixturePaymentSource(db: Awaited<ReturnType<typeof freshSeededDb>>): Promise<PaymentSource> {
  const sources = await repo.listPaymentSourcesForProfile(db, fixtureProfile.id);
  return sources[0]!;
}

function buildTransaction(
  paymentSource: PaymentSource,
  overrides: Partial<FinancialTransaction> & Pick<FinancialTransaction, "date" | "amount" | "financialEffect">,
): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: fixtureProfile.id,
    paymentSource,
    direction: overrides.financialEffect === "INCOME" ? "CREDIT" : "DEBIT",
    rawDescription: "Test transaction",
    normalizedDescription: "Test transaction",
    normalizedMerchant: "TEST MERCHANT",
    status: "POSTED",
    certainty: "ACTUAL",
    category: null,
    origin: "IMPORTED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("getRealizedIncomeForProfile (DEC-127)", () => {
  it("an INCOME-effect transaction this month counts toward realized income", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, {
        date: "2026-09-05",
        amount: fromReais(8500),
        financialEffect: "INCOME",
        rawDescription: "SALARIO EMPRESA XYZ LTDA",
      }),
    );

    const realized = await getRealizedIncomeForProfile(db, fixtureProfile.id, ASOF);
    expect(realized.cents).toBe(850_000);
  });

  it("a DEBIT/CONSUMPTION transaction never counts toward realized income", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, {
        date: "2026-09-05",
        amount: fromReais(800),
        financialEffect: "CONSUMPTION",
        rawDescription: "CONDOMINIO EDIFICIO SOLAR",
      }),
    );

    const realized = await getRealizedIncomeForProfile(db, fixtureProfile.id, ASOF);
    expect(realized.cents).toBe(0);
  });

  it("an INCOME transaction from a DIFFERENT month never counts toward this month's realized income", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, {
        date: "2026-08-05",
        amount: fromReais(8500),
        financialEffect: "INCOME",
      }),
    );

    const realized = await getRealizedIncomeForProfile(db, fixtureProfile.id, ASOF);
    expect(realized.cents).toBe(0);
  });

  it("sums multiple INCOME transactions in the same month", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, { date: "2026-09-05", amount: fromReais(8500), financialEffect: "INCOME" }),
    );
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, { date: "2026-09-20", amount: fromReais(500), financialEffect: "INCOME" }),
    );

    const realized = await getRealizedIncomeForProfile(db, fixtureProfile.id, ASOF);
    expect(realized.cents).toBe(900_000);
  });

  it("never reads the declared `incomes` table — the exact bug being fixed", async () => {
    // The fixture profile already has a declared, non-zero recurring
    // Income (used elsewhere for Safe-to-Spend) — if this function read
    // that table by mistake, the result would be nonzero even with no
    // realized transaction for the month.
    const db = await freshSeededDb();
    const realized = await getRealizedIncomeForProfile(db, fixtureProfile.id, ASOF);
    expect(realized.cents).toBe(0);
  });
});

describe("getRecurringIncomeCandidates (DEC-127)", () => {
  it("detects a recurring INCOME pattern from real transactions, as evidence only", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    for (const date of ["2026-07-05", "2026-08-05", "2026-09-05"]) {
      await repo.upsertTransaction(
        db,
        buildTransaction(paymentSource, {
          date,
          amount: fromReais(8500),
          financialEffect: "INCOME",
          normalizedMerchant: "EMPRESA XYZ LTDA",
        }),
      );
    }

    const candidates = await getRecurringIncomeCandidates(db, fixtureProfile.id, ASOF);
    expect(candidates.some((c) => c.normalizedMerchant === "EMPRESA XYZ LTDA")).toBe(true);
  });

  it("never includes a CONSUMPTION-effect pattern, even a strongly recurring one", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    for (const date of ["2026-07-05", "2026-08-05", "2026-09-05"]) {
      await repo.upsertTransaction(
        db,
        buildTransaction(paymentSource, {
          date,
          amount: fromReais(800),
          financialEffect: "CONSUMPTION",
          normalizedMerchant: "CONDOMINIO SOLAR",
        }),
      );
    }

    const candidates = await getRecurringIncomeCandidates(db, fixtureProfile.id, ASOF);
    expect(candidates.some((c) => c.normalizedMerchant === "CONDOMINIO SOLAR")).toBe(false);
  });

  it("is evidence only — calling it never persists anything to `incomes`", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    for (const date of ["2026-07-05", "2026-08-05", "2026-09-05"]) {
      await repo.upsertTransaction(
        db,
        buildTransaction(paymentSource, { date, amount: fromReais(8500), financialEffect: "INCOME" }),
      );
    }

    const before = await getRealizedIncomeForProfile(db, fixtureProfile.id, ASOF);
    await getRecurringIncomeCandidates(db, fixtureProfile.id, ASOF);
    const snapshotInput = await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF);
    // Declared income (`incomes` table) is unchanged by merely detecting a
    // candidate — only an explicit `mutations.createIncome` call changes it.
    const declaredIncomeCount = snapshotInput.income.length;
    await getRecurringIncomeCandidates(db, fixtureProfile.id, ASOF);
    const snapshotInputAfter = await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF);
    expect(snapshotInputAfter.income.length).toBe(declaredIncomeCount);
    expect(before.cents).toBeGreaterThan(0);
  });
});

describe("getRecurringFixedExpenseCandidates (DEC-127)", () => {
  it("detects a recurring CONSUMPTION pattern from real transactions, as evidence only", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    for (const date of ["2026-07-05", "2026-08-05", "2026-09-05"]) {
      await repo.upsertTransaction(
        db,
        buildTransaction(paymentSource, {
          date,
          amount: fromReais(800),
          financialEffect: "CONSUMPTION",
          normalizedMerchant: "CONDOMINIO SOLAR",
        }),
      );
    }

    const candidates = await getRecurringFixedExpenseCandidates(db, fixtureProfile.id, ASOF);
    expect(candidates.some((c) => c.normalizedMerchant === "CONDOMINIO SOLAR")).toBe(true);
  });

  it("never includes an INCOME-effect pattern", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    for (const date of ["2026-07-05", "2026-08-05", "2026-09-05"]) {
      await repo.upsertTransaction(
        db,
        buildTransaction(paymentSource, {
          date,
          amount: fromReais(8500),
          financialEffect: "INCOME",
          normalizedMerchant: "EMPRESA XYZ LTDA",
        }),
      );
    }

    const candidates = await getRecurringFixedExpenseCandidates(db, fixtureProfile.id, ASOF);
    expect(candidates.some((c) => c.normalizedMerchant === "EMPRESA XYZ LTDA")).toBe(false);
  });

  it("is evidence only — calling it never persists anything to `fixed_expenses`", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    for (const date of ["2026-07-05", "2026-08-05", "2026-09-05"]) {
      await repo.upsertTransaction(
        db,
        buildTransaction(paymentSource, { date, amount: fromReais(800), financialEffect: "CONSUMPTION" }),
      );
    }

    const before = (await getFixedExpensesForProfile(db, fixtureProfile.id, ASOF)).length;
    await getRecurringFixedExpenseCandidates(db, fixtureProfile.id, ASOF);
    const after = (await getFixedExpensesForProfile(db, fixtureProfile.id, ASOF)).length;
    expect(after).toBe(before);
  });
});
