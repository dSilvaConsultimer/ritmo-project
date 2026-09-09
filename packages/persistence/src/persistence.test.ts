import { describe, expect, it, vi } from "vitest";
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

  /**
   * Regression test for a real Sprint 4.5 bug (DEC-047): the tests above
   * only prove idempotency when `seed` and its fixture imports stay in ONE
   * already-running process — which is exactly what masked the bug in the
   * wild. `vi.resetModules()` + a fresh dynamic `import()` forces the
   * fixtures module to re-evaluate from scratch between seed calls, the
   * same as a real dev-server restart (or Next.js instantiating a separate
   * module registry per RSC-vs-Route-Handler "layer", both observed live)
   * — this is what actually caught the duplicate-row bug.
   */
  it("stays idempotent even when the fixtures module is freshly re-evaluated between seed calls", async () => {
    const db = await freshDb();

    vi.resetModules();
    const { seed: seedFirst } = await import("./seed");
    await seedFirst(db);

    vi.resetModules();
    const { seed: seedSecond } = await import("./seed");
    await seedSecond(db);

    const events = await db.select().from(schema.financialEvents);
    expect(events).toHaveLength(2); // Rodeo + Beach trip, not 4.

    const installmentPlans = await db.select().from(schema.installmentPlans);
    expect(installmentPlans).toHaveLength(1);

    const fixedExpenses = await db.select().from(schema.fixedExpenses);
    expect(fixedExpenses).toHaveLength(7);

    const goals = await db.select().from(schema.financialGoals);
    expect(goals).toHaveLength(1);
  });
});
