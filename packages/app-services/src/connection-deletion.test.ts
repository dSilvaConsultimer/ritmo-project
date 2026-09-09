import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile, fromCents } from "@money-copilot/financial-engine";
import type {
  CreditCardBill,
  FinancialTransaction,
  InstallmentPlan,
  PaymentSource,
  ProviderConnection,
  ReconciliationLink,
} from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { createId, type Id } from "@money-copilot/shared";
import { disconnectConnection } from "./sync";
import { resetProviderRegistry } from "./provider-registry";
import { freshSeededDb, installMockProvider } from "./test-helpers";

/**
 * Regression test for a real Sprint 4.5 scenario: two separate live Pluggy
 * sandbox connections were created (a second sandbox Connect attempt
 * succeeded when the first appeared not to), each importing its own
 * accounts/transactions/bills. `findTransactionDuplicates` — entirely
 * correctly, and unrelated to any bug — cross-matched some of connection
 * B's transactions against connection A's as likely recurring duplicates,
 * producing reconciliation links that reference BOTH connections'
 * transactions. Deleting connection B therefore had to remove those
 * cross-connection links too, not just data exclusively "inside" B. See
 * docs/OPEN-FINANCE.md, "Connection deletion," DEC-050.
 */

afterEach(() => {
  resetProviderRegistry();
});

async function setUpConnection(
  db: Awaited<ReturnType<typeof freshSeededDb>>,
  externalConnectionId: string,
): Promise<ProviderConnection> {
  const connection: ProviderConnection = {
    id: createId("provider-connection"),
    financialProfileId: fixtureProfile.id,
    provider: "mock",
    externalConnectionId,
    status: "CONNECTED",
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  };
  await repo.upsertProviderConnection(db, connection);
  return connection;
}

function makePaymentSource(label: string, connectionId: Id<"provider-connection">): PaymentSource {
  return {
    id: createId("payment-source"),
    label,
    type: "CREDIT_CARD",
    provider: "mock",
    externalAccountId: createId("external-account"),
    connectionId,
  };
}

function makeTransaction(paymentSource: PaymentSource, rawDescription: string): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: fixtureProfile.id,
    externalProviderId: "mock",
    externalTransactionId: createId("external-transaction"),
    paymentSource,
    date: "2026-09-01",
    amount: fromCents(5590),
    direction: "DEBIT",
    rawDescription,
    normalizedDescription: rawDescription,
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: "Entertainment",
    origin: "IMPORTED",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

describe("disconnectConnection", () => {
  it("removes exactly one connection's data, including cross-connection reconciliation links, and leaves the kept connection fully intact", async () => {
    const db = await freshSeededDb();
    installMockProvider({ accounts: [], transactionsByAccount: new Map() });

    const keptConnection = await setUpConnection(db, "kept-external-id");
    const discardedConnection = await setUpConnection(db, "discarded-external-id");

    const keptPaymentSource = makePaymentSource("Kept Credit Card", keptConnection.id);
    const discardedPaymentSource = makePaymentSource("Discarded Credit Card", discardedConnection.id);
    await repo.upsertPaymentSource(db, keptPaymentSource, fixtureProfile.id);
    await repo.upsertPaymentSource(db, discardedPaymentSource, fixtureProfile.id);

    const keptTransaction = makeTransaction(keptPaymentSource, "NETFLIX.COM");
    const discardedTransaction = makeTransaction(discardedPaymentSource, "NETFLIX.COM");
    await repo.upsertTransaction(db, keptTransaction);
    await repo.upsertTransaction(db, discardedTransaction);

    // A cross-connection link — exactly what findTransactionDuplicates
    // produced live: primary belongs to the connection being KEPT, linked
    // belongs to the connection being DISCARDED.
    const crossConnectionLink: ReconciliationLink = {
      id: createId("reconciliation-link"),
      type: "TRANSACTION_TRANSACTION",
      primaryTransactionId: keptTransaction.id,
      linkedTransactionId: discardedTransaction.id,
      confidence: "HIGH",
      method: "FINGERPRINT",
      status: "CONFIRMED",
      createdAt: "2026-09-01T00:00:00.000Z",
    };
    await repo.upsertReconciliationLink(db, crossConnectionLink);

    const discardedBill: CreditCardBill = {
      id: createId("credit-card-bill"),
      financialProfileId: fixtureProfile.id,
      paymentSourceId: discardedPaymentSource.id,
      provider: "mock",
      externalBillId: "discarded-bill-1",
      dueDate: "2026-10-01",
      totalAmount: fromCents(500_000),
      certainty: "ACTUAL",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    };
    await repo.upsertBill(db, discardedBill);

    const discardedInstallmentPlan: InstallmentPlan = {
      id: createId("installment-plan"),
      financialProfileId: fixtureProfile.id,
      description: "NETFLIX.COM",
      originTransactionId: discardedTransaction.id,
      paymentSourceId: discardedPaymentSource.id,
      totalOriginalAmount: null,
      installmentAmount: discardedTransaction.amount,
      installmentNumber: null,
      totalInstallments: null,
      firstDueDate: null,
      certainty: "ACTUAL",
      status: "ACTIVE",
    };
    await repo.upsertInstallmentPlan(db, discardedInstallmentPlan);

    const result = await disconnectConnection(db, discardedConnection.id);

    expect(result.deletedPaymentSourceCount).toBe(1);
    expect(result.deletedTransactionCount).toBe(1);
    expect(result.deletedBillCount).toBe(1);
    expect(result.deletedInstallmentPlanCount).toBe(1);
    expect(result.deletedReconciliationLinkCount).toBe(1);

    // Exactly one ProviderConnection remains — the kept one.
    const remainingConnections = await repo.listProviderConnections(db, fixtureProfile.id);
    expect(remainingConnections.map((c) => c.id)).toEqual([keptConnection.id]);

    // No orphaned payment sources referencing the deleted connection.
    const remainingPaymentSources = await repo.listPaymentSourcesForProfile(db, fixtureProfile.id);
    expect(remainingPaymentSources.some((p) => p.id === discardedPaymentSource.id)).toBe(false);
    expect(remainingPaymentSources.some((p) => p.id === keptPaymentSource.id)).toBe(true);

    // No orphaned bills.
    const remainingBills = await repo.listBillsForProfile(db, fixtureProfile.id);
    expect(remainingBills.some((b) => b.id === discardedBill.id)).toBe(false);

    // The cross-connection reconciliation link is gone — it referenced a
    // now-deleted transaction, so it could not remain valid.
    const remainingLinks = await repo.listAllReconciliationLinks(db);
    expect(remainingLinks.some((l) => l.id === crossConnectionLink.id)).toBe(false);

    // The kept transaction (which was the "primary" side of that link) is untouched.
    const keptTxStillPresent = await repo.findTransactionByExternalId(
      db,
      fixtureProfile.id,
      "mock",
      keptTransaction.externalTransactionId!,
    );
    expect(keptTxStillPresent?.id).toBe(keptTransaction.id);

    // No orphaned installment plan.
    const remainingPlans = await repo.listInstallmentPlansForProfile(db, fixtureProfile.id);
    expect(remainingPlans.some((p) => p.id === discardedInstallmentPlan.id)).toBe(false);
  });

  it("is idempotent-safe: never throws for a connection with no imported data at all", async () => {
    const db = await freshSeededDb();
    const emptyConnection = await setUpConnection(db, "empty-external-id");

    const result = await disconnectConnection(db, emptyConnection.id);

    expect(result.deletedPaymentSourceCount).toBe(0);
    expect(result.deletedTransactionCount).toBe(0);
    const remaining = await repo.listProviderConnections(db, fixtureProfile.id);
    expect(remaining.some((c) => c.id === emptyConnection.id)).toBe(false);
  });

  it("throws for an unknown connectionId rather than silently no-op-ing", async () => {
    const db = await freshSeededDb();
    await expect(disconnectConnection(db, "does-not-exist")).rejects.toThrow();
  });
});
