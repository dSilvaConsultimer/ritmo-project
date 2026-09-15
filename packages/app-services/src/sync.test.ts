import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile, ProviderError } from "@money-copilot/financial-engine";
import type {
  ExternalAccountInput,
  ExternalBillInput,
  ExternalTransactionInput,
} from "@money-copilot/financial-engine";
import type { OpenFinanceProvider, ExternalConnectionStatus } from "@money-copilot/open-finance";
import * as repo from "@money-copilot/persistence";
import { createId } from "@money-copilot/shared";
import {
  completeConnection,
  syncConnection,
  refetchTransactionsByExternalId,
  getInstallmentPlanMatchCandidates,
  reclassifyMisclassifiedCardPayments,
} from "./sync";
import { getFinancialSnapshot, getFinancialPosition, getCategoryTotals, getTransactions } from "./queries";
import { resetProviderRegistry, registerProvider } from "./provider-registry";
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

describe("syncConnection — provider still updating (DEC-128, decisions 1 & 2)", () => {
  it("never reports SUCCEEDED when the provider Item is still SYNCING and nothing was imported", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [], transactionsByAccount: new Map(), status: "SYNCING" });

    const connection = await setUpConnection(db);
    const run = await syncConnection(db, fixtureProfile.id, connection.id);

    expect(run.status).toBe("PENDING");
    expect(run.metrics.accountsDiscovered).toBe(0);
    expect(run.errors).toHaveLength(0);
  });

  it("does not advance lastSuccessfulSyncAt while the provider Item is still SYNCING", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [], transactionsByAccount: new Map(), status: "SYNCING" });

    const connection = await setUpConnection(db);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const updated = await repo.getProviderConnectionById(db, connection.id);
    expect(updated?.lastSuccessfulSyncAt).toBeUndefined();
    expect(updated?.status).toBe("SYNCING");
  });

  it("does not advance lastSuccessfulSyncAt for a connection that genuinely has zero accounts, even though nothing failed", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [], transactionsByAccount: new Map(), status: "CONNECTED" });

    const connection = await setUpConnection(db);
    const run = await syncConnection(db, fixtureProfile.id, connection.id);

    // Genuinely nothing to sync (not "still updating") — errors is empty and
    // this is not a failure, but decision 2 requires the watermark to only
    // ever advance once a real data sync actually succeeded, never merely
    // because nothing went wrong.
    expect(run.status).toBe("SUCCEEDED");
    const updated = await repo.getProviderConnectionById(db, connection.id);
    expect(updated?.lastSuccessfulSyncAt).toBeUndefined();
  });
});

describe("syncConnection — self-healing a never-baselined payment source (DEC-128, decision 3)", () => {
  const salary: ExternalTransactionInput = {
    provider: "mock",
    externalTransactionId: "mock-tx-salary-1",
    paymentSourceExternalRef: mockNubankAccount.externalAccountId,
    amountCents: 850_000,
    direction: "CREDIT",
    financialEffect: "INCOME",
    certainty: "ACTUAL",
    date: "2026-09-05",
    rawDescription: "SALARIO EMPRESA XYZ LTDA",
    rawMerchant: "EMPRESA XYZ LTDA",
    status: "POSTED",
  };

  it("backfills a payment source's transactions on the very next sync, even though the connection's own watermark already advanced past their date", async () => {
    const db = await freshSeededDb();

    // First sync: the account itself is discovered (so `anySucceeded` is
    // true and the connection's watermark legitimately advances to "now"),
    // but the provider has not returned this account's transactions yet —
    // exactly the real-world Pluggy race this connection hit in staging.
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map(),
      status: "CONNECTED",
    });
    const connection = await setUpConnection(db);
    const firstRun = await syncConnection(db, fixtureProfile.id, connection.id);
    expect(firstRun.status).toBe("SUCCEEDED");
    const afterFirstSync = await repo.getProviderConnectionById(db, connection.id);
    expect(afterFirstSync?.lastSuccessfulSyncAt).toBeDefined();

    // The salary transaction (dated well before that stamped watermark) now
    // becomes available from the provider — simulating Pluggy finishing its
    // own backfill. A naive `since: lastSuccessfulSyncAt` sweep would never
    // see it again; the payment source has zero persisted transactions, so
    // it must get a full pull instead.
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [salary]]]),
      status: "CONNECTED",
    });
    await syncConnection(db, fixtureProfile.id, connection.id);

    const transactions = await getTransactions(db, fixtureProfile.id, "2026-09-30");
    const found = transactions.filter((t) => t.externalTransactionId === "mock-tx-salary-1");
    expect(found).toHaveLength(1);
    expect(found[0]?.amount.cents).toBe(850_000);
    expect(found[0]?.financialEffect).toBe("INCOME");
  });

  it("returns to normal incremental (since-filtered) behavior once the payment source has at least one real transaction", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [salary]]]),
      status: "CONNECTED",
    });
    const connection = await setUpConnection(db);
    await syncConnection(db, fixtureProfile.id, connection.id);

    // A transaction the provider has always had, dated long before any real
    // sync in this test could have run — if incremental filtering is
    // correctly back in effect now that a baseline exists, this must NOT
    // appear on the next sync.
    const veryOld: ExternalTransactionInput = {
      ...salary,
      externalTransactionId: "mock-tx-ancient",
      date: "2020-01-01",
      rawDescription: "TRANSACAO ANTIGA NAO RELACIONADA",
    };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [salary, veryOld]]]),
      status: "CONNECTED",
    });
    await syncConnection(db, fixtureProfile.id, connection.id);

    // Checked directly against persistence (not `getTransactions`, which
    // filters to the current month anyway) — this must reflect that the
    // sync itself never even asked the provider to re-import it.
    const salaryRow = await repo.findTransactionByExternalId(db, fixtureProfile.id, "mock", "mock-tx-salary-1");
    const ancientRow = await repo.findTransactionByExternalId(db, fixtureProfile.id, "mock", "mock-tx-ancient");
    expect(salaryRow).toBeDefined();
    expect(ancientRow).toBeUndefined();
  });
});

describe("syncConnection — transaction idempotency (DEC-128, decision 4 / acceptance)", () => {
  it("a repeated full sync, then a repeated incremental sync, never duplicates the same external transaction", async () => {
    const db = await freshSeededDb();
    const salary: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-salary-idempotent",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 850_000,
      direction: "CREDIT",
      financialEffect: "INCOME",
      certainty: "ACTUAL",
      date: "2026-09-05",
      rawDescription: "SALARIO EMPRESA XYZ LTDA",
      rawMerchant: "EMPRESA XYZ LTDA",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [salary]]]),
      status: "CONNECTED",
    });
    const connection = await setUpConnection(db);

    // sync #1 (full, no prior baseline) -> exists once.
    await syncConnection(db, fixtureProfile.id, connection.id);
    let transactions = await getTransactions(db, fixtureProfile.id, "2026-09-30");
    expect(transactions.filter((t) => t.externalTransactionId === "mock-tx-salary-idempotent")).toHaveLength(1);

    // sync #2 (full pipeline run again, same provider data) -> still once.
    await syncConnection(db, fixtureProfile.id, connection.id);
    transactions = await getTransactions(db, fixtureProfile.id, "2026-09-30");
    expect(transactions.filter((t) => t.externalTransactionId === "mock-tx-salary-idempotent")).toHaveLength(1);

    // sync #3 (now incremental, since a baseline exists) -> still once.
    await syncConnection(db, fixtureProfile.id, connection.id);
    transactions = await getTransactions(db, fixtureProfile.id, "2026-09-30");
    expect(transactions.filter((t) => t.externalTransactionId === "mock-tx-salary-idempotent")).toHaveLength(1);
  });
});

/**
 * Minimal `OpenFinanceProvider` that always throws from `listAccounts` — used
 * only to exercise `syncConnection`'s error path (DEC-128, decision 5)
 * without adding failure-injection knobs to the shared `MockProvider`.
 */
class AlwaysFailingProvider implements OpenFinanceProvider {
  readonly name = "mock";
  async createConnectionToken(): Promise<never> {
    throw new Error("not used in this test");
  }
  async getConnection(externalConnectionId: string): Promise<ExternalConnectionStatus> {
    return { externalConnectionId, status: "CONNECTED" };
  }
  async listAccounts(): Promise<never> {
    throw new ProviderError("PROVIDER_UNAVAILABLE", "mock", "Simulated provider outage", { retryable: true });
  }
  async listTransactions(): Promise<never> {
    throw new Error("not used in this test");
  }
  async listBills(): Promise<never> {
    throw new Error("not used in this test");
  }
  async syncConnection(): Promise<void> {}
  async deleteConnection(): Promise<void> {}
}

describe("syncConnection — error handling and retry (DEC-128, decision 5)", () => {
  it("a provider outage returns a controlled FAILED SyncRun, is logged as an error, and never throws past syncConnection", async () => {
    const db = await freshSeededDb();
    resetProviderRegistry();
    registerProvider("mock", new AlwaysFailingProvider());
    const connection = await setUpConnection(db);

    const run = await syncConnection(db, fixtureProfile.id, connection.id);

    expect(run.status).toBe("FAILED");
    expect(run.errors.length).toBeGreaterThan(0);
    expect(run.errors[0]).not.toContain("undefined");
    // The failure is a persisted, queryable record — never just a swallowed
    // exception — so it is always available as an audit trail even without
    // a live log line.
    const persisted = await repo.listRecentSyncRunsForConnection(db, connection.id);
    expect(persisted.some((r) => r.status === "FAILED" && r.errors.length > 0)).toBe(true);
  });

  it("a failed sync does not delete previously-synchronized valid data, and a later successful sync can still recover", async () => {
    const db = await freshSeededDb();
    const priorTransaction: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-preexisting-1",
      paymentSourceExternalRef: mockNubankAccount.externalAccountId,
      amountCents: 12_000,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-09-04",
      rawDescription: "COMPRA ANTERIOR VALIDA",
      rawMerchant: "COMPRA ANTERIOR VALIDA",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([[mockNubankAccount.externalAccountId, [priorTransaction]]]),
      status: "CONNECTED",
    });
    const connection = await setUpConnection(db);
    await syncConnection(db, fixtureProfile.id, connection.id);
    const beforeFailure = await repo.findTransactionByExternalId(
      db,
      fixtureProfile.id,
      "mock",
      "mock-tx-preexisting-1",
    );
    expect(beforeFailure).toBeDefined();

    // Provider now fails outright — the connection must still be retryable,
    // and nothing already-imported may disappear.
    resetProviderRegistry();
    registerProvider("mock", new AlwaysFailingProvider());
    const failedRun = await syncConnection(db, fixtureProfile.id, connection.id);
    expect(failedRun.status).toBe("FAILED");

    const stillThere = await repo.findTransactionByExternalId(
      db,
      fixtureProfile.id,
      "mock",
      "mock-tx-preexisting-1",
    );
    expect(stillThere).toEqual(beforeFailure);

    // Provider recovers — the same connection, un-mutated, syncs normally
    // again. The payment source already has a baseline transaction, so this
    // sync is correctly incremental (`since: lastSuccessfulSyncAt` from the
    // FIRST successful sync, before the failed attempt) — the new
    // transaction must be dated on/after that watermark to be picked up,
    // exactly like a genuinely new real-world transaction would be.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const newTransaction: ExternalTransactionInput = {
      ...priorTransaction,
      externalTransactionId: "mock-tx-after-recovery-1",
      rawDescription: "COMPRA APOS RECUPERACAO",
      date: tomorrow,
    };
    installMockProvider({
      accounts: [mockNubankAccount],
      transactionsByAccount: new Map([
        [mockNubankAccount.externalAccountId, [priorTransaction, newTransaction]],
      ]),
      status: "CONNECTED",
    });
    const recoveredRun = await syncConnection(db, fixtureProfile.id, connection.id);
    expect(recoveredRun.status).toBe("SUCCEEDED");

    const recovered = await repo.findTransactionByExternalId(
      db,
      fixtureProfile.id,
      "mock",
      "mock-tx-after-recovery-1",
    );
    expect(recovered).toBeDefined();
  });
});

describe("reclassifyMisclassifiedCardPayments (DEC-130, test 11: stale CARD_PAYMENT classification)", () => {
  const mockChecking: ExternalAccountInput = {
    provider: "mock",
    externalAccountId: "mock-checking-reclassify-1",
    connectionExternalId: "mock-conn-reclassify-1",
    kind: "BANK",
    displayName: "Mock Checking",
    currency: "BRL",
    balanceCents: 3_000_000,
    balanceCertainty: "ACTUAL",
    lastSyncedAt: "2026-09-05T00:00:00.000Z",
  };

  it("reclassifies a stale, misclassified checking-account card-bill-payment transaction, and never touches a genuine consumption transaction", async () => {
    const db = await freshSeededDb();
    // Simulates data imported BEFORE the mapper fix: a real card bill
    // payment that was, at the time, wrongly stored as CONSUMPTION.
    const staleCardPayment: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-stale-card-payment-1",
      paymentSourceExternalRef: mockChecking.externalAccountId,
      amountCents: 29_115,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION", // the bug — should have been CARD_PAYMENT
      certainty: "ACTUAL",
      date: "2026-08-31",
      rawDescription: "PAGAMENTO FATURA CARTAO VISA",
      rawMerchant: "PAGAMENTO FATURA CARTAO VISA",
      status: "POSTED",
    };
    const genuineConsumption: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-genuine-consumption-1",
      paymentSourceExternalRef: mockChecking.externalAccountId,
      amountCents: 12_000,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-08-20",
      rawDescription: "VIVO SERVICOS E COMERCIO",
      rawMerchant: "VIVO SERVICOS E COMERCIO",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockChecking],
      transactionsByAccount: new Map([
        [mockChecking.externalAccountId, [staleCardPayment, genuineConsumption]],
      ]),
    });
    const connection = {
      id: createId("provider-connection"),
      financialProfileId: fixtureProfile.id,
      provider: "mock" as const,
      externalConnectionId: mockChecking.connectionExternalId,
      status: "PENDING" as const,
      createdAt: "2026-08-31",
      updatedAt: "2026-08-31",
    };
    await repo.upsertProviderConnection(db, connection);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const result = await reclassifyMisclassifiedCardPayments(db, fixtureProfile.id);
    expect(result.reclassified).toBe(1);
    expect(result.reclassifiedTransactionIds).toHaveLength(1);

    const reclassified = await repo.findTransactionByExternalId(
      db,
      fixtureProfile.id,
      "mock",
      "mock-tx-stale-card-payment-1",
    );
    expect(reclassified?.financialEffect).toBe("CARD_PAYMENT");

    const untouched = await repo.findTransactionByExternalId(
      db,
      fixtureProfile.id,
      "mock",
      "mock-tx-genuine-consumption-1",
    );
    expect(untouched?.financialEffect).toBe("CONSUMPTION");
  });

  it("is idempotent — running it twice reclassifies nothing the second time", async () => {
    const db = await freshSeededDb();
    const staleCardPayment: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-stale-card-payment-2",
      paymentSourceExternalRef: mockChecking.externalAccountId,
      amountCents: 16_770,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-07-31",
      rawDescription: "PAGAMENTO DE FATURA CARTAO",
      rawMerchant: "PAGAMENTO DE FATURA CARTAO",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockChecking],
      transactionsByAccount: new Map([[mockChecking.externalAccountId, [staleCardPayment]]]),
    });
    const connection = {
      id: createId("provider-connection"),
      financialProfileId: fixtureProfile.id,
      provider: "mock" as const,
      externalConnectionId: mockChecking.connectionExternalId,
      status: "PENDING" as const,
      createdAt: "2026-07-31",
      updatedAt: "2026-07-31",
    };
    await repo.upsertProviderConnection(db, connection);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const first = await reclassifyMisclassifiedCardPayments(db, fixtureProfile.id);
    expect(first.reclassified).toBe(1);
    const second = await reclassifyMisclassifiedCardPayments(db, fixtureProfile.id);
    expect(second.reclassified).toBe(0);
  });

  it("never touches a transaction whose description doesn't match the canonical card-payment pattern, even with a similar amount", async () => {
    const db = await freshSeededDb();
    const unrelatedDebit: ExternalTransactionInput = {
      provider: "mock",
      externalTransactionId: "mock-tx-unrelated-1",
      paymentSourceExternalRef: mockChecking.externalAccountId,
      amountCents: 29_115,
      direction: "DEBIT",
      financialEffect: "CONSUMPTION",
      certainty: "ACTUAL",
      date: "2026-08-31",
      rawDescription: "SUPERMERCADO EXTRA",
      rawMerchant: "SUPERMERCADO EXTRA",
      status: "POSTED",
    };
    installMockProvider({
      accounts: [mockChecking],
      transactionsByAccount: new Map([[mockChecking.externalAccountId, [unrelatedDebit]]]),
    });
    const connection = {
      id: createId("provider-connection"),
      financialProfileId: fixtureProfile.id,
      provider: "mock" as const,
      externalConnectionId: mockChecking.connectionExternalId,
      status: "PENDING" as const,
      createdAt: "2026-08-31",
      updatedAt: "2026-08-31",
    };
    await repo.upsertProviderConnection(db, connection);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const result = await reclassifyMisclassifiedCardPayments(db, fixtureProfile.id);
    expect(result.reclassified).toBe(0);
  });
});

describe("DEC-130 follow-up — sync identity & idempotency (checking-balance double-counting bug)", () => {
  // Mirrors the real staging payload: balance === availableBalance (Pluggy's
  // `closingBalance`), with a genuine reservation on top — see
  // `packages/open-finance/src/pluggy/dec130-full-pipeline.test.ts`.
  const dupAccount: ExternalAccountInput = {
    provider: "mock",
    externalAccountId: "mock-checking-dup-1",
    connectionExternalId: "mock-conn-dup-1",
    kind: "BANK",
    displayName: "Mock Checking",
    currency: "BRL",
    balanceCents: 3_599_575,
    balanceCertainty: "ACTUAL",
    availableBalanceCents: 3_599_575,
    reservedBalanceCents: 100_004,
    lastSyncedAt: "2026-09-15T00:00:00.000Z",
  };
  const dupCard: ExternalAccountInput = {
    provider: "mock",
    externalAccountId: "mock-card-dup-1",
    connectionExternalId: "mock-conn-dup-1",
    kind: "CREDIT_CARD",
    displayName: "Mock Card",
    currency: "BRL",
    balanceCents: 96_195,
    balanceCertainty: "ACTUAL",
    lastSyncedAt: "2026-09-15T00:00:00.000Z",
  };
  const EXPECTED_CASH_ONCE = 3_499_571; // 35,995.75 - 1,000.04

  async function setUpNamedConnection(db: Awaited<ReturnType<typeof freshSeededDb>>, externalConnectionId: string) {
    const connection = {
      id: createId("provider-connection"),
      financialProfileId: fixtureProfile.id,
      provider: "mock" as const,
      externalConnectionId,
      status: "PENDING" as const,
      createdAt: "2026-09-15",
      updatedAt: "2026-09-15",
    };
    await repo.upsertProviderConnection(db, connection);
    return connection;
  }

  it("test 1: syncing the same Item twice produces exactly one PaymentSource for its account, never two", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [dupAccount], transactionsByAccount: new Map() });
    const connection = await setUpNamedConnection(db, dupAccount.connectionExternalId);

    await syncConnection(db, fixtureProfile.id, connection.id);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const sources = await repo.listPaymentSourcesForProfile(db, fixtureProfile.id);
    expect(sources.filter((s) => s.externalAccountId === dupAccount.externalAccountId)).toHaveLength(1);
  });

  it("test 2: a repeated sync after the account's balance changes updates the existing record instead of duplicating it", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [dupAccount], transactionsByAccount: new Map() });
    const connection = await setUpNamedConnection(db, dupAccount.connectionExternalId);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const changedBalance: ExternalAccountInput = {
      ...dupAccount,
      balanceCents: 4_000_000,
      availableBalanceCents: 4_000_000,
    };
    installMockProvider({ accounts: [changedBalance], transactionsByAccount: new Map() });
    await syncConnection(db, fixtureProfile.id, connection.id);

    const sources = await repo.listPaymentSourcesForProfile(db, fixtureProfile.id);
    const matching = sources.filter((s) => s.externalAccountId === dupAccount.externalAccountId);
    expect(matching).toHaveLength(1);
    expect(matching[0]?.balance?.amount?.cents).toBe(4_000_000);
  });

  it("test 3: an account reporting both balance and a distinct availableBalance contributes cash exactly once, never balance+availableBalance summed", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [dupAccount], transactionsByAccount: new Map() });
    const connection = await setUpNamedConnection(db, dupAccount.connectionExternalId);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const position = await getFinancialPosition(db, fixtureProfile.id, ASOF);
    expect(position.cashBalance.amount?.cents).toBe(EXPECTED_CASH_ONCE);
  });

  it("test 4: two genuinely different accounts both legitimately contribute to cash, even with identical balances (never deduplicated by amount)", async () => {
    const db = await freshSeededDb();
    const { availableBalanceCents: _availableBalanceCents, reservedBalanceCents: _reservedBalanceCents, ...dupAccountBase } = dupAccount;
    const secondGenuineAccount: ExternalAccountInput = {
      ...dupAccountBase,
      externalAccountId: "mock-checking-dup-2",
    };
    installMockProvider({
      accounts: [dupAccount, secondGenuineAccount],
      transactionsByAccount: new Map(),
    });
    const connection = await setUpNamedConnection(db, dupAccount.connectionExternalId);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const sources = await repo.listPaymentSourcesForProfile(db, fixtureProfile.id);
    expect(sources.filter((s) => s.provider === "mock" && s.type !== "CREDIT_CARD")).toHaveLength(2);

    const position = await getFinancialPosition(db, fixtureProfile.id, ASOF);
    expect(position.cashBalance.amount?.cents).toBe(EXPECTED_CASH_ONCE + 3_599_575);
  });

  it("test 5: the same externalAccountId reported under two different ProviderConnections cannot inflate Safe-to-Spend — the second sync updates the same record", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [dupAccount], transactionsByAccount: new Map() });
    const connectionA = await setUpNamedConnection(db, "mock-conn-dup-a");
    const connectionB = await setUpNamedConnection(db, "mock-conn-dup-b");

    await syncConnection(db, fixtureProfile.id, connectionA.id);
    await syncConnection(db, fixtureProfile.id, connectionB.id);

    const sources = await repo.listPaymentSourcesForProfile(db, fixtureProfile.id);
    expect(sources.filter((s) => s.externalAccountId === dupAccount.externalAccountId)).toHaveLength(1);

    const position = await getFinancialPosition(db, fixtureProfile.id, ASOF);
    expect(position.cashBalance.amount?.cents).toBe(EXPECTED_CASH_ONCE);
  });

  it("test 6: reservedBalance remains deducted exactly once end-to-end through the full snapshot pipeline", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [dupAccount], transactionsByAccount: new Map() });
    const connection = await setUpNamedConnection(db, dupAccount.connectionExternalId);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const snapshot = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    const cashComponent = snapshot.liquidity.components.find((c) => c.type === "CURRENT_AVAILABLE_CASH");
    expect(cashComponent?.amount.cents).toBe(EXPECTED_CASH_ONCE);
  });

  it("test 7: the card's outstanding balance remains counted exactly once — never once as a card obligation and again as a separate debt", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [dupAccount, dupCard], transactionsByAccount: new Map() });
    const connection = await setUpNamedConnection(db, dupAccount.connectionExternalId);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const snapshot = await getFinancialSnapshot(db, fixtureProfile.id, ASOF);
    // The seeded founder fixture already carries its own plan-based
    // commitments (fixed expenses, etc.) — this asserts only that the
    // synced card's own outstanding balance appears as a SINGLE
    // CARD_OBLIGATIONS component, never duplicated into a second entry.
    const cardComponents = snapshot.liquidity.components.filter((c) => c.type === "CARD_OBLIGATIONS");
    expect(cardComponents).toHaveLength(1);
    expect(cardComponents[0]?.amount.cents).toBe(-96_195);
  });
});
