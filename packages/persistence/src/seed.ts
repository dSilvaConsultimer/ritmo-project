import {
  fixtureProfile,
  pjRevenue,
  fixedExpenses,
  variableBudgets,
  transactions,
  events,
  installmentPlans,
  reconciliationLinks,
  independentLivingGoal,
  protectedPreferences,
  currentLifestyleScenario,
  independentLivingScenario,
  merchantNormalizationRules,
  categoryRules,
} from "@money-copilot/financial-engine";
import type { Database } from "./db";
import { createDatabase } from "./db";
import { runMigrations } from "./migrate";
import * as repo from "./repositories";

/**
 * Idempotent local seed: creates the founder's Sprint 1/2 fixture data
 * (profile, fixed commitments, protected mother support, current goal,
 * the rodeo/beach-trip events, the initial transaction set, payment
 * sources, categorization rules, and the old card-debt installment).
 * Running this any number of times leaves the database in the same state
 * — every write is an upsert keyed by the fixture's own stable ids.
 */
export async function seed(db: Database): Promise<void> {
  await repo.upsertProfile(db, fixtureProfile);

  const paymentSourcesById = new Map(transactions.map((t) => [t.paymentSource.id, t.paymentSource]));
  for (const paymentSource of paymentSourcesById.values()) {
    await repo.upsertPaymentSource(db, paymentSource, fixtureProfile.id);
  }

  await repo.upsertIncome(db, pjRevenue, fixtureProfile.id);

  for (const expense of fixedExpenses) {
    await repo.upsertFixedExpense(db, expense, fixtureProfile.id);
  }
  for (const budget of variableBudgets) {
    await repo.upsertVariableBudget(db, budget, fixtureProfile.id);
  }
  for (const transaction of transactions) {
    await repo.upsertTransaction(db, transaction);
  }
  for (const event of events) {
    await repo.upsertEvent(db, event, fixtureProfile.id);
  }
  for (const plan of installmentPlans) {
    await repo.upsertInstallmentPlan(db, plan);
  }
  for (const link of reconciliationLinks) {
    await repo.upsertReconciliationLink(db, link);
  }

  await repo.upsertGoal(db, independentLivingGoal, fixtureProfile.id);

  for (const preference of protectedPreferences) {
    await repo.upsertProtectedPreference(db, preference, fixtureProfile.id);
  }
  for (const scenario of [currentLifestyleScenario, independentLivingScenario]) {
    await repo.upsertLifestyleScenario(db, scenario, fixtureProfile.id);
  }
  for (const rule of merchantNormalizationRules) {
    await repo.upsertMerchantRule(db, rule);
  }
  for (const rule of categoryRules) {
    await repo.upsertCategoryRule(db, rule);
  }
}

/** CLI entry point: `pnpm --filter @money-copilot/persistence run db:seed`. */
async function main(): Promise<void> {
  const dataDir = process.env["MONEY_COPILOT_DB_PATH"] ?? "./.data/money-copilot.pglite";
  const db = await createDatabase(dataDir);
  await runMigrations(db);
  await seed(db);
  console.log(`Seed complete at ${dataDir}`);
}

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main()
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => {
      // PGlite's WASM instance keeps the event loop alive on a file-backed
      // store even after all work is done — exit explicitly rather than
      // hang. See docs/DECISIONS.md DEC-021.
      process.exit(process.exitCode ?? 0);
    });
}
