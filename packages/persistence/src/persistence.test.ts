import { describe, expect, it, vi } from "vitest";
import { createId } from "@money-copilot/shared";
import {
  buildFinancialSnapshot,
  fromReais,
  initialUserSnapshotInput,
  fixtureProfile,
  type FixedExpense,
} from "@money-copilot/financial-engine";
import { createDatabase } from "./db";
import { runMigrations } from "./migrate";
import { seed } from "./seed";
import { loadFinancialSnapshotInput, upsertFixedExpense } from "./repositories";
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
   * Regression test for a real Sprint 4.5 bug (DEC-047/DEC-049): the tests
   * above only prove idempotency when `seed` and its fixture imports stay
   * in ONE already-running process — which is exactly what masked the bug
   * in the wild. `vi.resetModules()` + a fresh dynamic `import()` forces
   * the fixtures module to re-evaluate from scratch between seed calls,
   * the same as a real dev-server restart (or Next.js instantiating a
   * separate module registry per RSC-vs-Route-Handler "layer", both
   * observed live) — this is what actually caught the duplicate-row bug,
   * and (a second time) the `reconciliation_links` variant of it: those
   * links are computed via `findTransactionDuplicates`/
   * `reconcileEventLineItems` at fixture-evaluation time, which generate a
   * fresh `id` on every call by design (see `reconciliationLinkPairKey`'s
   * doc comment) — `seed()` must dedupe them by content, not by id.
   *
   * Three resets (not just two) so a would-be linear-growth bug (N rows
   * after N resets) is unambiguous rather than possibly masked by an
   * off-by-one in a two-call comparison.
   */
  it("stays idempotent — including reconciliation_links — across three fresh module re-evaluations", async () => {
    const db = await freshDb();
    const countsAfterEachReset: Record<string, number>[] = [];

    for (let i = 0; i < 3; i += 1) {
      vi.resetModules();
      const { seed: freshSeed } = await import("./seed");
      await freshSeed(db);

      countsAfterEachReset.push({
        events: (await db.select().from(schema.financialEvents)).length,
        installmentPlans: (await db.select().from(schema.installmentPlans)).length,
        fixedExpenses: (await db.select().from(schema.fixedExpenses)).length,
        reconciliationLinks: (await db.select().from(schema.reconciliationLinks)).length,
        goals: (await db.select().from(schema.financialGoals)).length,
        protectedPreferences: (await db.select().from(schema.protectedPreferences)).length,
        lifestyleScenarios: (await db.select().from(schema.lifestyleScenarios)).length,
      });
    }

    // Identical after every single reset — not just "eventually stable."
    expect(countsAfterEachReset[1]).toEqual(countsAfterEachReset[0]);
    expect(countsAfterEachReset[2]).toEqual(countsAfterEachReset[0]);

    expect(countsAfterEachReset[0]).toEqual({
      events: 2, // Rodeo + Beach trip, never duplicated.
      installmentPlans: 1,
      fixedExpenses: 7,
      reconciliationLinks: 1, // The rodeo-ticket link — this is what DEC-049 fixed.
      goals: 1,
      protectedPreferences: 1,
      lifestyleScenarios: 2,
    });
  });

  /**
   * Sprint 8 (Ritmo UI integration): `dueDayOfMonth` is a display-only,
   * genuinely-optional field — round-trips when present, and stays
   * `undefined` (never a fabricated `0`/`null`-as-a-real-value) when absent,
   * exactly like every other optional financial-engine field. See
   * `FixedExpense.dueDayOfMonth`'s doc comment.
   */
  it("round-trips FixedExpense.dueDayOfMonth when present, and leaves it undefined when absent", async () => {
    const db = await freshDb();
    await seed(db);

    const withDueDay: FixedExpense = {
      id: createId("fixed-expense"),
      label: "Aluguel",
      category: "Housing",
      amount: fromReais(1800),
      certainty: "ACTUAL",
      protected: false,
      dueDayOfMonth: 5,
    };
    const withoutDueDay: FixedExpense = {
      id: createId("fixed-expense"),
      label: "Internet",
      category: "Housing",
      amount: fromReais(120),
      certainty: "ACTUAL",
      protected: false,
    };

    await upsertFixedExpense(db, withDueDay, fixtureProfile.id);
    await upsertFixedExpense(db, withoutDueDay, fixtureProfile.id);

    const loaded = await loadFinancialSnapshotInput(db, fixtureProfile.id, initialUserSnapshotInput.asOfDate);
    const loadedWithDueDay = loaded.fixedExpenses.find((e) => e.id === withDueDay.id);
    const loadedWithoutDueDay = loaded.fixedExpenses.find((e) => e.id === withoutDueDay.id);

    expect(loadedWithDueDay?.dueDayOfMonth).toBe(5);
    expect(loadedWithoutDueDay?.dueDayOfMonth).toBeUndefined();

    // Never used in any calculation — adding it never changes Safe-to-Spend.
    const snapshot = buildFinancialSnapshot(loaded);
    const snapshotWithoutTheNewFields = buildFinancialSnapshot(initialUserSnapshotInput);
    expect(snapshot.commitments.fixed.cents).toBe(
      snapshotWithoutTheNewFields.commitments.fixed.cents + 180_000 + 12_000,
    );
  });
});
