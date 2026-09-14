import { describe, expect, it } from "vitest";
import { fixtureProfile, fromReais } from "@money-copilot/financial-engine";
import type { FinancialTransaction, PaymentSource, ReconciliationLink } from "@money-copilot/financial-engine";
import { createId } from "@money-copilot/shared";
import { createDatabase } from "./db";
import { runMigrations } from "./migrate";
import { seed } from "./seed";
import * as repo from "./repositories";

async function freshSeededDb() {
  const db = await createDatabase();
  await runMigrations(db);
  await seed(db);
  return db;
}

function buildTransaction(financialProfileId: string, paymentSource: PaymentSource): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: financialProfileId as FinancialTransaction["financialProfileId"],
    paymentSource,
    date: "2026-09-04",
    amount: fromReais(50),
    direction: "DEBIT",
    rawDescription: "TEST",
    normalizedDescription: "TEST",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: "Food",
    origin: "MANUAL",
    createdAt: "2026-09-04",
    updatedAt: "2026-09-04",
  };
}

function buildLink(
  financialProfileId: string,
  primaryTransactionId: string,
): ReconciliationLink {
  return {
    id: createId("reconciliation-link"),
    financialProfileId: financialProfileId as ReconciliationLink["financialProfileId"],
    type: "TRANSACTION_TRANSACTION",
    primaryTransactionId: primaryTransactionId as ReconciliationLink["primaryTransactionId"],
    confidence: "HIGH",
    method: "FINGERPRINT",
    status: "CONFIRMED",
    createdAt: "2026-09-04",
  };
}

describe("reconciliation_links profile isolation (Sprint 9, DEC-091)", () => {
  it("round-trips financialProfileId on a reconciliation link", async () => {
    const db = await freshSeededDb();
    const paymentSource: PaymentSource = { id: createId("payment-source"), label: "Nubank", type: "CREDIT_CARD" };
    await repo.upsertPaymentSource(db, paymentSource, fixtureProfile.id);
    const transaction = buildTransaction(fixtureProfile.id, paymentSource);
    await repo.upsertTransaction(db, transaction);

    const link = buildLink(fixtureProfile.id, transaction.id);
    await repo.upsertReconciliationLink(db, link);

    const links = await repo.listReconciliationLinksForProfile(db, fixtureProfile.id);
    expect(links.some((l) => l.id === link.id && l.financialProfileId === fixtureProfile.id)).toBe(true);
  });

  it("never returns another profile's reconciliation links (cross-tenant isolation)", async () => {
    const db = await freshSeededDb();
    const otherProfileId = createId("financial-profile");
    await repo.upsertProfile(db, { id: otherProfileId, label: "Other user", createdAt: "2026-09-01" });

    const paymentSourceA: PaymentSource = { id: createId("payment-source"), label: "A", type: "CREDIT_CARD" };
    const paymentSourceB: PaymentSource = { id: createId("payment-source"), label: "B", type: "CREDIT_CARD" };
    await repo.upsertPaymentSource(db, paymentSourceA, fixtureProfile.id);
    await repo.upsertPaymentSource(db, paymentSourceB, otherProfileId);

    const txA = buildTransaction(fixtureProfile.id, paymentSourceA);
    const txB = buildTransaction(otherProfileId, paymentSourceB);
    await repo.upsertTransaction(db, txA);
    await repo.upsertTransaction(db, txB);

    const linkA = buildLink(fixtureProfile.id, txA.id);
    const linkB = buildLink(otherProfileId, txB.id);
    await repo.upsertReconciliationLink(db, linkA);
    await repo.upsertReconciliationLink(db, linkB);

    const profileALinks = await repo.listReconciliationLinksForProfile(db, fixtureProfile.id);
    const profileBLinks = await repo.listReconciliationLinksForProfile(db, otherProfileId);

    expect(profileALinks.some((l) => l.id === linkB.id)).toBe(false);
    expect(profileBLinks.some((l) => l.id === linkA.id)).toBe(false);
    expect(profileBLinks.map((l) => l.id)).toEqual([linkB.id]);
  });
});
