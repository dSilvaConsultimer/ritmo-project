import { afterEach, describe, expect, it } from "vitest";
import {
  actual,
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
  getFinancialSnapshot,
  getInstallmentCommitments,
  getConnections,
  getReconciliationCandidates,
  getLifestyleComparison,
  getPlanningForecast,
  getRecurringCandidates,
  getRecurringIncomeCandidates,
  getRecurringFixedExpenseCandidates,
  getRealizedIncomeForProfile,
  getTransactionHistory,
  getUncategorizedTransactions,
  getFixedExpensesForProfile,
  getCategoryRuleCount,
  getCategoryRulesList,
} from "./queries";
import { syncConnection } from "./sync";
import { resetProviderRegistry } from "./provider-registry";
import { freshSeededDb, installMockProvider, seedSecondProfile } from "./test-helpers";

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

describe("getFinancialSnapshot — liquidity-aware wiring end-to-end (DEC-130)", () => {
  it("a freshly-provisioned profile (zero declared income/commitments) with a real synced balance gets a positive, LIQUIDITY_AWARE Safe-to-Spend — not the old empty-plan negative", async () => {
    const db = await freshSeededDb();
    const profileId = await seedSecondProfile(db);

    const checking: ExternalAccountInput = {
      provider: "mock",
      externalAccountId: "mock-liquidity-checking-1",
      connectionExternalId: "mock-liquidity-conn-1",
      kind: "BANK",
      displayName: "Mock Checking",
      currency: "BRL",
      balanceCents: 3_599_575, // R$ 35.995,75
      balanceCertainty: "ACTUAL",
      lastSyncedAt: "2026-09-05T00:00:00.000Z",
    };
    const card: ExternalAccountInput = {
      provider: "mock",
      externalAccountId: "mock-liquidity-card-1",
      connectionExternalId: "mock-liquidity-conn-1",
      kind: "CREDIT_CARD",
      displayName: "Mock Card",
      currency: "BRL",
      balanceCents: 96_195, // R$ 961,95
      balanceCertainty: "ACTUAL",
      lastSyncedAt: "2026-09-05T00:00:00.000Z",
    };
    installMockProvider({ accounts: [checking, card], transactionsByAccount: new Map() });
    const connection = {
      id: createId("provider-connection"),
      financialProfileId: profileId,
      provider: "mock" as const,
      externalConnectionId: checking.connectionExternalId,
      status: "PENDING" as const,
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    };
    await repo.upsertProviderConnection(db, connection);
    await syncConnection(db, profileId, connection.id);

    const snapshot = await getFinancialSnapshot(db, profileId, ASOF);

    // The old, still-present plan-based figure is exactly the DEC-130 bug:
    // zero declared income minus zero declared commitments is merely zero
    // here (this profile has no transactions at all), but it is NEVER
    // authoritative regardless — the point is what Home actually shows.
    expect(snapshot.income.gross.cents).toBe(0);
    expect(snapshot.liquidity.basis).toBe("LIQUIDITY_AWARE");
    expect(snapshot.liquidity.recommendedTotal.cents).toBe(3_503_380); // 3,599,575 - 96,195
  });
});

describe("getFinancialSnapshot — reconciled recurring-fixed commitments reduce liquidity (DEC-141)", () => {
  function tx(
    financialProfileId: string,
    source: PaymentSource,
    overrides: Partial<FinancialTransaction>,
  ): FinancialTransaction {
    return {
      id: createId("transaction"),
      financialProfileId: financialProfileId as never,
      paymentSource: source,
      date: "2026-08-05",
      amount: fromReais(100),
      direction: "DEBIT",
      rawDescription: "GENERIC",
      normalizedDescription: "GENERIC",
      status: "POSTED",
      certainty: "ACTUAL",
      financialEffect: "CONSUMPTION",
      category: null,
      origin: "IMPORTED",
      createdAt: "2026-08-05",
      updatedAt: "2026-08-05",
      ...overrides,
    };
  }

  it("(section 9) reconciles rent (already paid), condominium and electricity (unpaid) — only the unpaid remainder reduces Disponível, reproducing the exact reference arithmetic", async () => {
    const db = await freshSeededDb();
    const profileId = await seedSecondProfile(db);

    const checking: PaymentSource = {
      id: createId("payment-source"),
      label: "Conta Corrente",
      type: "DEBIT",
      subtype: "CHECKING_ACCOUNT",
      provider: "pluggy",
      externalAccountId: "acc-checking-dec141",
      balance: actual(fromReais(28_059.56)),
      availableBalance: actual(fromReais(28_059.56)),
    };
    const card: PaymentSource = {
      id: createId("payment-source"),
      label: "Cartão",
      type: "CREDIT_CARD",
      subtype: "CREDIT_CARD",
      provider: "pluggy",
      externalAccountId: "acc-card-dec141",
      balance: actual(fromReais(670.8)),
    };
    await repo.upsertPaymentSource(db, checking, profileId);
    await repo.upsertPaymentSource(db, card, profileId);

    const rows: FinancialTransaction[] = [
      // Rent — recurring, and ALREADY paid this month (September).
      tx(profileId, checking, { normalizedMerchant: "ALUGUEL", date: "2026-06-01", amount: fromReais(1500) }),
      tx(profileId, checking, { normalizedMerchant: "ALUGUEL", date: "2026-07-01", amount: fromReais(1500) }),
      tx(profileId, checking, { normalizedMerchant: "ALUGUEL", date: "2026-08-01", amount: fromReais(1500) }),
      tx(profileId, checking, { normalizedMerchant: "ALUGUEL", date: "2026-09-01", amount: fromReais(1500) }),
      // Condominium — recurring, NOT yet paid this month.
      tx(profileId, checking, { normalizedMerchant: "CONDOMINIO", date: "2026-06-05", amount: fromReais(450) }),
      tx(profileId, checking, { normalizedMerchant: "CONDOMINIO", date: "2026-07-05", amount: fromReais(450) }),
      tx(profileId, checking, { normalizedMerchant: "CONDOMINIO", date: "2026-08-05", amount: fromReais(450) }),
      // Electricity — recurring, VARYING amount, NOT yet paid this month.
      tx(profileId, checking, { normalizedMerchant: "ENERGIA", date: "2026-06-10", amount: fromReais(180) }),
      tx(profileId, checking, { normalizedMerchant: "ENERGIA", date: "2026-07-10", amount: fromReais(235) }),
      tx(profileId, checking, { normalizedMerchant: "ENERGIA", date: "2026-08-10", amount: fromReais(207) }),
    ];
    for (const row of rows) await repo.upsertTransaction(db, row);

    const snapshot = await getFinancialSnapshot(db, profileId, ASOF);

    expect(snapshot.liquidity.basis).toBe("LIQUIDITY_AWARE");
    // 28,059.56 - 670.80 (card) - (450 + 207.33 condo+electricity remaining,
    // rent excluded — already realized this month) = 26,731.43.
    expect(snapshot.liquidity.recommendedTotal.cents).toBe(2_673_143);

    const upcomingFixed = snapshot.liquidity.components.find((c) => c.type === "UPCOMING_FIXED_COMMITMENTS");
    expect(Math.abs(upcomingFixed?.amount.cents ?? 0)).toBe(45_000 + 20_733);
  });

  it("never double-counts a declared FixedExpense that already represents the same identity", async () => {
    const db = await freshSeededDb();
    const profileId = await seedSecondProfile(db);

    const checking: PaymentSource = {
      id: createId("payment-source"),
      label: "Conta Corrente",
      type: "DEBIT",
      subtype: "CHECKING_ACCOUNT",
      provider: "pluggy",
      externalAccountId: "acc-checking-dec141-dedup",
      balance: actual(fromReais(10_000)),
      availableBalance: actual(fromReais(10_000)),
    };
    await repo.upsertPaymentSource(db, checking, profileId);

    const rows: FinancialTransaction[] = [
      tx(profileId, checking, { normalizedMerchant: "ALUGUEL", date: "2026-06-01", amount: fromReais(1500) }),
      tx(profileId, checking, { normalizedMerchant: "ALUGUEL", date: "2026-07-01", amount: fromReais(1500) }),
      tx(profileId, checking, { normalizedMerchant: "ALUGUEL", date: "2026-08-01", amount: fromReais(1500) }),
    ];
    for (const row of rows) await repo.upsertTransaction(db, row);
    await repo.upsertFixedExpense(
      db,
      {
        id: createId("fixed-expense"),
        label: "Aluguel",
        category: "Moradia",
        amount: fromReais(1500),
        certainty: "CONFIRMED",
        protected: false,
        source: "USER_DECLARED",
      },
      profileId,
    );

    const snapshot = await getFinancialSnapshot(db, profileId, ASOF);
    // The DECLARED FixedExpense already contributes 1500 to
    // `unrealizedFixed` (unpaid this month) via the pre-existing DEC-130
    // reconciliation — the HISTORY_INFERRED "ALUGUEL" pattern must add
    // NOTHING on top of that (never a second obligation for the same rent).
    // 10,000 - 1,500 = 8,500.
    expect(snapshot.liquidity.recommendedTotal.cents).toBe(fromReais(8_500).cents);
  });

  it("(test F) historical variable-spending average is displayed by Planning's forecast but never automatically treated as a committed liability", async () => {
    const db = await freshSeededDb();
    const profileId = await seedSecondProfile(db);
    const checking: PaymentSource = {
      id: createId("payment-source"),
      label: "Conta Corrente",
      type: "DEBIT",
      subtype: "CHECKING_ACCOUNT",
      provider: "pluggy",
      externalAccountId: "acc-checking-dec141-variable",
      balance: actual(fromReais(10_000)),
      availableBalance: actual(fromReais(10_000)),
    };
    await repo.upsertPaymentSource(db, checking, profileId);

    const rows: FinancialTransaction[] = [
      tx(profileId, checking, { normalizedMerchant: "MERCADO A", date: "2026-06-10", amount: fromReais(600) }),
      tx(profileId, checking, { normalizedMerchant: "PADARIA", date: "2026-07-10", amount: fromReais(700) }),
      tx(profileId, checking, { normalizedMerchant: "FARMACIA", date: "2026-08-10", amount: fromReais(500) }),
    ];
    for (const row of rows) await repo.upsertTransaction(db, row);

    const forecast = await getPlanningForecast(db, profileId, ASOF);
    expect(forecast.expectedMonthlyVariableSpending.cents).toBeGreaterThan(0);

    const withHistory = await getFinancialSnapshot(db, profileId, ASOF);
    const withoutHistoryDb = await freshSeededDb();
    const withoutHistoryProfile = await seedSecondProfile(withoutHistoryDb);
    await repo.upsertPaymentSource(withoutHistoryDb, checking, withoutHistoryProfile);
    const withoutHistory = await getFinancialSnapshot(withoutHistoryDb, withoutHistoryProfile, ASOF);

    // Same starting cash, no declared VariableBudget in either case — the
    // historical variable-spending average must never silently become a
    // liquidity deduction.
    expect(withHistory.liquidity.recommendedTotal.cents).toBe(withoutHistory.liquidity.recommendedTotal.cents);
    expect(withHistory.liquidity.components.some((c) => c.type === "VARIABLE_BUDGETS")).toBe(false);
  });

  it("(test G) an autonomous worker's historical income average is displayed by Planning's forecast but never automatically added to Safe-to-Spend", async () => {
    const db = await freshSeededDb();
    const profileId = await seedSecondProfile(db);
    const checking: PaymentSource = {
      id: createId("payment-source"),
      label: "Conta Corrente",
      type: "DEBIT",
      subtype: "CHECKING_ACCOUNT",
      provider: "pluggy",
      externalAccountId: "acc-checking-dec141-income",
      balance: actual(fromReais(10_000)),
      availableBalance: actual(fromReais(10_000)),
    };
    await repo.upsertPaymentSource(db, checking, profileId);

    const rows: FinancialTransaction[] = [
      tx(profileId, checking, { direction: "CREDIT", financialEffect: "INCOME", date: "2026-06-10", amount: fromReais(3000), rawDescription: "CLIENT A" }),
      tx(profileId, checking, { direction: "CREDIT", financialEffect: "INCOME", date: "2026-06-20", amount: fromReais(2000), rawDescription: "CLIENT B" }),
      tx(profileId, checking, { direction: "CREDIT", financialEffect: "INCOME", date: "2026-07-10", amount: fromReais(4000), rawDescription: "CLIENT C" }),
      tx(profileId, checking, { direction: "CREDIT", financialEffect: "INCOME", date: "2026-08-10", amount: fromReais(4500), rawDescription: "CLIENT A" }),
    ];
    for (const row of rows) await repo.upsertTransaction(db, row);
    // No declared Income record at all — this is the whole point of the test.

    const forecast = await getPlanningForecast(db, profileId, ASOF);
    expect(forecast.expectedMonthlyIncome.cents).toBeGreaterThan(0);

    const snapshot = await getFinancialSnapshot(db, profileId, ASOF);
    // No declared Income -> FUTURE_CONFIRMED_INCOME never fires — the
    // historical average must never silently enter liquidity.
    expect(snapshot.liquidity.recommendedTotal.cents).toBe(fromReais(10_000).cents);
    expect(snapshot.liquidity.components.some((c) => c.type === "FUTURE_CONFIRMED_INCOME")).toBe(false);
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
    expect(await getCategoryRuleCount(db, fixtureProfile.id)).toBe(fixtureCategoryRules.length);
  });
});

describe("getCategoryRulesList", () => {
  it("returns the same count as getCategoryRuleCount, sorted by descending priority", async () => {
    const db = await freshSeededDb();
    const rules = await getCategoryRulesList(db, fixtureProfile.id);
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

describe("getTransactionHistory (DEC-129 — Extrato)", () => {
  it("lists transactions newest-first, unlike getTransactions which is current-month only", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, {
        date: "2026-01-10",
        amount: fromReais(50),
        financialEffect: "CONSUMPTION",
        rawDescription: "COMPRA ANTIGA JANEIRO",
      }),
    );
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, {
        date: "2026-09-05",
        amount: fromReais(8500),
        financialEffect: "INCOME",
        rawDescription: "SALARIO EMPRESA XYZ LTDA",
      }),
    );

    const history = await getTransactionHistory(db, fixtureProfile.id, ASOF);
    const januaryIndex = history.findIndex((t) => t.rawDescription === "COMPRA ANTIGA JANEIRO");
    const septemberIndex = history.findIndex((t) => t.rawDescription === "SALARIO EMPRESA XYZ LTDA");
    expect(septemberIndex).toBeGreaterThanOrEqual(0);
    expect(januaryIndex).toBeGreaterThan(septemberIndex);
  });

  it("reports direction and amount correctly for both an entrada (CREDIT) and a saída (DEBIT)", async () => {
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
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, {
        date: "2026-09-05",
        amount: fromReais(800),
        financialEffect: "CONSUMPTION",
        rawDescription: "CONDOMINIO EDIFICIO SOLAR",
      }),
    );

    const history = await getTransactionHistory(db, fixtureProfile.id, ASOF);
    const salary = history.find((t) => t.rawDescription === "SALARIO EMPRESA XYZ LTDA");
    const condo = history.find((t) => t.rawDescription === "CONDOMINIO EDIFICIO SOLAR");
    expect(salary?.direction).toBe("CREDIT");
    expect(salary?.amount.cents).toBe(850_000);
    expect(condo?.direction).toBe("DEBIT");
    expect(condo?.amount.cents).toBe(80_000);
  });

  it("includes category and subcategory when the transaction has both", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, {
        date: "2026-09-05",
        amount: fromReais(800),
        financialEffect: "CONSUMPTION",
        rawDescription: "CONDOMINIO EDIFICIO SOLAR",
        category: "Moradia",
        subcategory: "Condomínio",
      }),
    );

    const history = await getTransactionHistory(db, fixtureProfile.id, ASOF);
    const condo = history.find((t) => t.rawDescription === "CONDOMINIO EDIFICIO SOLAR");
    expect(condo?.category).toBe("Moradia");
    expect(condo?.subcategory).toBe("Condomínio");
  });

  it("works correctly when a transaction has a category but no subcategory", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, {
        date: "2026-09-05",
        amount: fromReais(120),
        financialEffect: "CONSUMPTION",
        rawDescription: "FARMACIA MOCK",
        category: "Saúde",
      }),
    );

    const history = await getTransactionHistory(db, fixtureProfile.id, ASOF);
    const pharmacy = history.find((t) => t.rawDescription === "FARMACIA MOCK");
    expect(pharmacy?.category).toBe("Saúde");
    expect(pharmacy?.subcategory).toBeUndefined();
  });

  it("never reads or is affected by another profile's transactions (see two-profile-isolation.test.ts (Q) for the full cross-profile assertion)", async () => {
    const db = await freshSeededDb();
    const paymentSource = await fixturePaymentSource(db);
    await repo.upsertTransaction(
      db,
      buildTransaction(paymentSource, {
        date: "2026-09-05",
        amount: fromReais(100),
        financialEffect: "CONSUMPTION",
        rawDescription: "TESTE ISOLAMENTO",
      }),
    );
    const history = await getTransactionHistory(db, fixtureProfile.id, ASOF);
    expect(history.every((t) => t.financialProfileId === fixtureProfile.id)).toBe(true);
  });
});
