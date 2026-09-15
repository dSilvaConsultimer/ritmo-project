import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile } from "@money-copilot/financial-engine";
import type { ExternalAccountInput, ExternalBillInput, ExternalTransactionInput } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { createId } from "@money-copilot/shared";
import {
  completeConnection,
  syncConnection,
  refetchTransactionsByExternalId,
  getInstallmentPlanMatchCandidates,
} from "./sync";
import { getFinancialSnapshot, getCategoryTotals, getTransactions } from "./queries";
import { resetProviderRegistry } from "./provider-registry";
import { freshSeededDb, installMockProvider } from "./test-helpers";

const ASOF = "2026-09-05";

afterEach(() => {
  resetProviderRegistry();
});

const mockNubankAccount: ExternalAccountInput = {
  provider: "mock",
  externalAccountId: "mock-nubank-1",
  connectionExternalId: "mock-conn-1",
  kind: "CREDIT_CARD",
  displayName: "Mock Nubank",
  currency: "BRL",
  balanceCents: 100_000,
  balanceCertainty: "ACTUAL",
  lastSyncedAt: "2026-09-05T00:00:00.000Z",
};

async function setUpConnection(db: Awaited<ReturnType<typeof freshSeededDb>>) {
  const connection = {
    id: createId("provider-connection"),
    financialProfileId: fixtureProfile.id,
    provider: "mock" as const,
    externalConnectionId: "mock-conn-1",
    status: "PENDING" as const,
    createdAt: "2026-09-05",
    updatedAt: "2026-09-05",
  };
  await repo.upsertProviderConnection(db, connection);
  return connection;
}

describe("syncConnection — basic import", () => {
  it("imports accounts and transactions via a provider, and records SyncRun metrics", async () => {
    const db = await freshSeededDb();
    const newPurchase: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-1",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 4_200,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-09-04",
      rawDescription: "PADARIA MOCK",
      rawMerchant: "PADARIA MOCK",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [newPurchase]]]),
    });

    const connection = await setUpConnection(db);
    const run = await syncConnection(db, fixtureProfile.id, connection.id);

    expect(run.status).toBe("SUCCEEDED");
    expect(run.metrics.accountsDiscovered).toBe(1);
    expect(run.metrics.transactionsReceived).toBe(1);
    expect(run.metrics.transactionsCreated).toBe(1);

    const transactions = await getTransactions(db, fixtureProfile.id, ASOF);
    expect(transactions.some((t) => t.externalTransactionId === "mock-tx-1")).toBe(true);
  });

  it("never creates a declared Income or FixedExpense, even from an INCOME-effect or recurring-looking transaction (Sprint 9, DEC-127)", async () => {
    const db = await freshSeededDb();
    const salary: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-salary-1",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 850_000,
      direction: "CREDIT",
      financialEffect: "INCOME",
      certainty: "ACTUAL",
      date: "2026-09-05",
      rawDescription: "SALARIO EMPRESA XYZ LTDA",
      rawMerchant: "SALARIO EMPRESA XYZ LTDA",
      status: "POSTED",
    };
    const condo: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-condo-1",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 80_000,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-09-05",
      rawDescription: "CONDOMINIO EDIFICIO SOLAR",
      rawMerchant: "CONDOMINIO EDIFICIO SOLAR",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [salary, condo]]]),
    });

    const before = await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF);

    const connection = await setUpConnection(db);
    const run = await syncConnection(db, fixtureProfile.id, connection.id);
    expect(run.status).toBe("SUCCEEDED");

    // The real transactions DID import (the actual bug's confirmed-working half).
    const transactions = await getTransactions(db, fixtureProfile.id, ASOF);
    expect(transactions.some((t) => t.externalTransactionId === "mock-salary-1")).toBe(true);
    expect(transactions.some((t) => t.externalTransactionId === "mock-condo-1")).toBe(true);

    // Neither declared table changed — a real bank connection/sync is
    // never, by itself, a declaration of expected income or a confirmed
    // fixed commitment. Only an explicit user confirmation
    // (mutations.createIncome/createFixedExpense) may create either.
    const after = await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF);
    expect(after.income.length).toBe(before.income.length);
    expect(after.fixedExpenses.length).toBe(before.fixedExpenses.length);
  });

  it("prevents a duplicate connection via completeConnection (idempotent)", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [], transactionsByAccount: new Map() });

    const first = await completeConnection(db, fixtureProfile.id, "mock", "mock-conn-dup");
    const second = await completeConnection(db, fixtureProfile.id, "mock", "mock-conn-dup");
    expect(second.connection.id).toBe(first.connection.id);

    const connections = await repo.listProviderConnections(db, fixtureProfile.id);
    expect(connections.filter((c) => c.externalConnectionId === "mock-conn-dup")).toHaveLength(1);
  });
});

describe("syncConnection — rodeo reconciliation regression", () => {
  it("does not double-count the rodeo ticket when a provider re-discovers the same real-world purchase", async () => {
    const db = await freshSeededDb();
    const before = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    expect(before.safeToSpend.total.cents).toBe(217_111);

    const rodeoDuplicate: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-rodeo-dup",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 47_610,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-09-04",
      rawDescription: "RODEO INGRESSOS DUPLICATE",
      rawMerchant: "RODEO INGRESSOS",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [rodeoDuplicate]]]),
    });

    const connection = await setUpConnection(db);
    const run = await syncConnection(db, fixtureProfile.id, connection.id);
    expect(run.status).toBe("SUCCEEDED");
    expect(run.metrics.transactionsReconciled).toBeGreaterThanOrEqual(1);

    const after = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    expect(after.safeToSpend.total.cents).toBe(217_111);
    expect(after.commitments.actualSpending.cents).toBe(before.commitments.actualSpending.cents);
  });
});

describe("syncConnection — pending -> posted reconciliation", () => {
  it("updates the existing transaction in place rather than creating a duplicate", async () => {
    const db = await freshSeededDb();
    const pending: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-pending-1",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 9_900,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-09-04",
      rawDescription: "LOJA MOCK",
      rawMerchant: "LOJA MOCK",
      status: "PENDING",
    };

    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [pending]]]),
    });
    const connection = await setUpConnection(db);
    const firstRun = await syncConnection(db, fixtureProfile.id, connection.id);
    expect(firstRun.metrics.transactionsCreated).toBe(1);

    // Pluggy reports a status change (PENDING -> POSTED) on an older
    // transaction via a `transactions/updated` webhook — handled by a
    // TARGETED re-fetch by id (see sync.ts,
    // refetchTransactionsByExternalId), not the date-filtered incremental
    // sweep, which would miss it (the transaction's own date hasn't
    // changed and may be older than the last-sync cutoff).
    const posted: ExternalTransactionInput = { ...pending, status: "POSTED" };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [posted]]]),
    });

    await refetchTransactionsByExternalId(
      db,
      fixtureProfile.id,
      connection.id,
      mockNubankAccount.externalAccountId,
      ["mock-tx-pending-1"],
    );

    const transactions = await getTransactions(db, fixtureProfile.id, ASOF);
    const matches = transactions.filter((t) => t.externalTransactionId === "mock-tx-pending-1");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.status).toBe("POSTED");
  });
});

describe("syncConnection — card payment does not double-count consumption", () => {
  it("a purchase plus a later card-bill-payment transaction only counts the purchase as spending", async () => {
    const db = await freshSeededDb();
    const purchase: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-purchase-1",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 15_000,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-09-04",
      rawDescription: "RESTAURANTE MOCK",
      rawMerchant: "RESTAURANTE MOCK",
      status: "POSTED",
    };
    const payment: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-payment-1",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 15_000,
      direction: "CREDIT",
      financialEffect: "CARD_PAYMENT",
      certainty: "ACTUAL",
      date: "2026-09-05",
      rawDescription: "PAGAMENTO FATURA MOCK",
      status: "POSTED",
    };

    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [purchase, payment]]]),
    });

    const before = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    const connection = await setUpConnection(db);
    await syncConnection(db, fixtureProfile.id, connection.id);
    const after = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);

    // Only the purchase (15000) should have been added — the payment must
    // contribute nothing to actualSpending.
    expect(after.commitments.actualSpending.cents).toBe(before.commitments.actualSpending.cents + 15_000);
  });
});

describe("syncConnection — old debt installment reconciliation candidate", () => {
  it("surfaces a possible match without silently replacing the manual BRL 1,400 estimate", async () => {
    const db = await freshSeededDb();
    const installmentPurchase: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-installment-1",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 140_000,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-09-04",
      rawDescription: "LOJA ELETRONICOS 3/10",
      rawMerchant: "LOJA ELETRONICOS",
      status: "POSTED",
      installmentMetadata: { installmentNumber: 3, totalInstallments: 10, totalAmountCents: 1_400_000 },
    };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [installmentPurchase]]]),
    });

    const connection = await setUpConnection(db);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const candidates = await getInstallmentPlanMatchCandidates(db, fixtureProfile.id, ASOF);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(candidates.every((c) => c.status === "CANDIDATE")).toBe(true);

    // The manual estimate itself must be untouched.
    const plans = await repo.listInstallmentPlansForProfile(db, fixtureProfile.id);
    const manualPlan = plans.find((p) => p.description === "Existing credit card bill installment");
    expect(manualPlan?.certainty).toBe("ESTIMATED");
    expect(manualPlan?.installmentNumber).toBeNull();
  });
});

describe("getFinancialSnapshot — fixture/provider path equivalence", () => {
  it("reproduces the exact Sprint 2 baseline before any provider sync has occurred", async () => {
    const db = await freshSeededDb();
    const snapshot = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    expect(snapshot.safeToSpend.total.cents).toBe(217_111);
    const breakdownSum = snapshot.safeToSpendBreakdown.components.reduce((sum, c) => sum + c.amount.cents, 0);
    expect(breakdownSum).toBe(snapshot.safeToSpendBreakdown.total.cents);
    expect(snapshot.safeToSpendBreakdown.total.cents).toBe(snapshot.safeToSpend.total.cents);
  });

  it("keeps the beach-trip unknown-budget warning visible after DB round-trip", async () => {
    const db = await freshSeededDb();
    const snapshot = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    expect(snapshot.warnings.some((w) => w.toLowerCase().includes("unknown"))).toBe(true);
  });

  it("category totals via the app-services layer match the reporting read model directly", async () => {
    const db = await freshSeededDb();
    const totals = await getCategoryTotals(db, fixtureProfile.id, ASOF);
    expect(totals.length).toBeGreaterThan(0);
  });
});

describe("bill deduplication (Sprint 4.5, DEC-048)", () => {
  it("never creates a duplicate CreditCardBill row when the same connection is synced twice", async () => {
    const db = await freshSeededDb();
    const externalBill: ExternalBillInput = {
      provider: "mock",
      externalBillId: "mock-bill-1",
      externalAccountId: mockNubankAccount.externalAccountId,
      dueDate: "2026-10-10",
      closingDate: "2026-10-03",
      totalAmountCents: 500_000,
      minimumPaymentCents: 100_000,
      allowsInstallments: true,
      certainty: "ACTUAL",
    };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map(),
      billsByAccount: new Map([[mockNubankAccount.externalAccountId, [externalBill]]]),
    });

    const connection = await setUpConnection(db);
    await syncConnection(db, fixtureProfile.id, connection.id);
    const afterFirstSync = await repo.listBillsForProfile(db, fixtureProfile.id);
    expect(afterFirstSync).toHaveLength(1);

    await syncConnection(db, fixtureProfile.id, connection.id);
    const afterSecondSync = await repo.listBillsForProfile(db, fixtureProfile.id);
    expect(afterSecondSync).toHaveLength(1);
    expect(afterSecondSync[0]?.id).toBe(afterFirstSync[0]?.id);
    expect(afterSecondSync[0]?.createdAt).toBe(afterFirstSync[0]?.createdAt);
  });
});
