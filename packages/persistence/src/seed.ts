import {
  fixtureProfile,
  pjRevenue,
  fixedExpenses,
  variableBudgets,
  transactions,
  events,
  installmentPlans,
  reconciliationLinks,
  reconciliationLinkPairKey,
  independentLivingGoal,
  protectedPreferences,
  currentLifestyleScenario,
  independentLivingScenario,
  merchantNormalizationRules,
  categoryRules,
  systemDefaultCategoryRules,
  baseCategories,
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
 *
 * ONE fixture value is deliberately NOT a stable literal:
 * `reconciliationLinks` is computed by calling
 * `findTransactionDuplicates`/`reconcileEventLineItems` at fixture-module
 * -evaluation time — by design, since those are the exact same general-
 * purpose functions a real sync uses, and a real sync must always be free
 * to generate a fresh `id` for a freshly-proposed candidate (see
 * `reconciliationLinkPairKey`'s doc comment). That means a fresh
 * evaluation of the fixtures module produces DIFFERENT link ids for the
 * SAME real link every time — this is `seed()`'s job to absorb, by
 * deduping on content (`reconciliationLinkPairKey`) before upserting,
 * exactly like `app-services/src/sync.ts`'s `reconcileProfile` already
 * does for real syncs. See docs/DECISIONS.md DEC-049.
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
  const existingLinks = await repo.listReconciliationLinksForProfile(db, fixtureProfile.id);
  const existingKeys = new Map(existingLinks.map((l) => [reconciliationLinkPairKey(l), l.id]));
  for (const link of reconciliationLinks) {
    const existingId = existingKeys.get(reconciliationLinkPairKey(link));
    await repo.upsertReconciliationLink(db, existingId ? { ...link, id: existingId } : link);
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

/**
 * DEC-134: the REAL global `SYSTEM_DEFAULT` category-rule baseline —
 * deliberately independent of `seed()` above, which is gated behind
 * `shouldSeedDatabase` (development/test only — "founder fixture data must
 * never reach a real user's database," DEC-090). A brand-new user in
 * staging/production must NOT start from zero categorization knowledge, so
 * this must run in EVERY environment, including production — see
 * `app-services/src/db.ts`'s `initializeDb`, the one place this is
 * actually called from app boot.
 *
 * Idempotent by construction: `repo.upsertCategoryRule` is an id-keyed
 * `ON CONFLICT DO UPDATE` and every rule here has a stable, hand-written id
 * (never `createId()`) — running this any number of times (every app boot,
 * concurrently across multiple instances) converges to the exact same
 * rows, never duplicates. Never touches a PERSONAL rule (this function
 * only ever upserts by these global rules' own fixed ids) — a user's
 * override always continues to win via `categorize`'s own precedence,
 * regardless of how many times or how this bootstrap has run since.
 */
export async function bootstrapSystemDefaultCategoryRules(db: Database): Promise<void> {
  for (const rule of systemDefaultCategoryRules) {
    await repo.upsertCategoryRule(db, rule);
  }
}

/**
 * DEC-135: the canonical BASE category taxonomy — same independence and
 * idempotency rationale as `bootstrapSystemDefaultCategoryRules` (stable
 * hand-written ids, id-keyed `ON CONFLICT DO UPDATE`, must run in every
 * environment including production, never gated behind `shouldSeedDatabase`).
 */
export async function bootstrapBaseCategories(db: Database): Promise<void> {
  for (const category of baseCategories) {
    await repo.upsertCategory(db, category);
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
