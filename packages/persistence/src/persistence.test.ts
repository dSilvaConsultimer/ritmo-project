import { describe, expect, it } from "vitest";
import { buildFinancialSnapshot, initialUserSnapshotInput, fixtureProfile } from "@money-copilot/financial-engine";
import { createDatabase } from "./db";
import { runMigrations } from "./migrate";
import { seed } from "./seed";
import { loadFinancialSnapshotInput } from "./repositories";
import * as schema from "./schema";

async function freshDb() {
  const db = await createDatabase();
  await runMigrations(db);
  return db;
}

describe("persistence roundtrip", () => {
  it("reconstructs a FinancialSnapshotInput from the database that reproduces the exact Sprint 2 Safe-to-Spend", async () => {
    const db = await freshDb();
    await seed(db);

    const loaded = await loadFinancialSnapshotInput(db, fixtureProfile.id, initialUserSnapshotInput.asOfDate);
    const snapshotFromDb = buildFinancialSnapshot(loaded);
    const snapshotFromFixture = buildFinancialSnapshot(initialUserSnapshotInput);

    expect(snapshotFromDb.safeToSpend.total.cents).toBe(snapshotFromFixture.safeToSpend.total.cents);
    expect(snapshotFromDb.safeToSpend.total.cents).toBe(217_111);
    expect(snapshotFromDb.commitments.actualSpending.cents).toBe(82_889);
    expect(snapshotFromDb.commitments.debtCommitments.cents).toBe(140_000);
    expect(snapshotFromDb.commitments.unknownLabels).toEqual(
      snapshotFromFixture.commitments.unknownLabels,
    );
  });

  it("round-trips every transaction with its category and payment source intact", async () => {
    const db = await freshDb();
    await seed(db);

    const loaded = await loadFinancialSnapshotInput(db, fixtureProfile.id, initialUserSnapshotInput.asOfDate);
    const ifood = loaded.transactions.find((t) => t.normalizedMerchant === "IFOOD");
    expect(ifood?.category).toBe("Food");
    expect(ifood?.paymentSource.label).toBe("Nubank");
    expect(ifood?.paymentSource.type).toBe("CREDIT_CARD");

    const uncategorized = loaded.transactions.find((t) => t.normalizedMerchant === undefined);
    expect(uncategorized?.category).toBe("UNCATEGORIZED");
  });
});

describe("idempotent seed", () => {
  it("produces identical row counts and content when run twice", async () => {
    const db = await freshDb();

    await seed(db);
    const firstPass = {
      transactions: await db.select().from(schema.financialTransactions),
      fixedExpenses: await db.select().from(schema.fixedExpenses),
      events: await db.select().from(schema.financialEvents),
      lineItems: await db.select().from(schema.financialEventLineItems),
      links: await db.select().from(schema.reconciliationLinks),
      goals: await db.select().from(schema.financialGoals),
    };

    await seed(db);
    const secondPass = {
      transactions: await db.select().from(schema.financialTransactions),
      fixedExpenses: await db.select().from(schema.fixedExpenses),
      events: await db.select().from(schema.financialEvents),
      lineItems: await db.select().from(schema.financialEventLineItems),
      links: await db.select().from(schema.reconciliationLinks),
      goals: await db.select().from(schema.financialGoals),
    };

    expect(secondPass.transactions).toHaveLength(firstPass.transactions.length);
    expect(secondPass.fixedExpenses).toHaveLength(firstPass.fixedExpenses.length);
    expect(secondPass.events).toHaveLength(firstPass.events.length);
    expect(secondPass.lineItems).toHaveLength(firstPass.lineItems.length);
    expect(secondPass.links).toHaveLength(firstPass.links.length);
    expect(secondPass.goals).toHaveLength(firstPass.goals.length);

    // Content is identical too, not just counts.
    expect(secondPass.transactions).toEqual(firstPass.transactions);
    expect(secondPass.goals).toEqual(firstPass.goals);
  });

  it("running seed three times still yields exactly one goal row for the profile", async () => {
    const db = await freshDb();
    await seed(db);
    await seed(db);
    await seed(db);
    const goals = await db.select().from(schema.financialGoals);
    expect(goals).toHaveLength(1);
  });
});
