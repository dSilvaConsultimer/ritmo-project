import { eq, inArray } from "drizzle-orm";
import type {
  FinancialEvent,
  FinancialGoal,
  FinancialProfile,
  FinancialSnapshotInput,
  FixedExpense,
  Income,
  InstallmentPlan,
  LifestyleScenario,
  PaymentSource,
  ProtectedPreference,
  ReconciliationLink,
  VariableBudget,
  CategoryRule,
  MerchantNormalizationRule,
  FinancialTransaction,
  FinancialPosition,
} from "@money-copilot/financial-engine";
import type { Database } from "./db";
import * as schema from "./schema";
import * as mappers from "./mappers";

/**
 * Every upsert in this module is idempotent by primary key
 * (`onConflictDoUpdate`) — running the seed script (or any of these) twice
 * never duplicates a row. See `seed.ts` and its "idempotent seed" test.
 */

export async function upsertProfile(db: Database, profile: FinancialProfile): Promise<void> {
  await db
    .insert(schema.financialProfiles)
    .values(profile)
    .onConflictDoUpdate({ target: schema.financialProfiles.id, set: profile });
}

export async function upsertPaymentSource(
  db: Database,
  paymentSource: PaymentSource,
  financialProfileId: string,
): Promise<void> {
  const row = mappers.paymentSourceToRow(paymentSource, financialProfileId);
  await db.insert(schema.paymentSources).values(row).onConflictDoUpdate({
    target: schema.paymentSources.id,
    set: row,
  });
}

export async function upsertIncome(db: Database, income: Income, financialProfileId: string): Promise<void> {
  const row = mappers.incomeToRow(income, financialProfileId);
  await db.insert(schema.incomes).values(row).onConflictDoUpdate({ target: schema.incomes.id, set: row });
}

export async function upsertFixedExpense(
  db: Database,
  expense: FixedExpense,
  financialProfileId: string,
): Promise<void> {
  const row = mappers.fixedExpenseToRow(expense, financialProfileId);
  await db
    .insert(schema.fixedExpenses)
    .values(row)
    .onConflictDoUpdate({ target: schema.fixedExpenses.id, set: row });
}

export async function upsertVariableBudget(
  db: Database,
  budget: VariableBudget,
  financialProfileId: string,
): Promise<void> {
  const row = mappers.variableBudgetToRow(budget, financialProfileId);
  await db
    .insert(schema.variableBudgets)
    .values(row)
    .onConflictDoUpdate({ target: schema.variableBudgets.id, set: row });
}

export async function upsertTransaction(db: Database, transaction: FinancialTransaction): Promise<void> {
  const row = mappers.transactionToRow(transaction);
  await db
    .insert(schema.financialTransactions)
    .values(row)
    .onConflictDoUpdate({ target: schema.financialTransactions.id, set: row });
}

export async function upsertEvent(db: Database, event: FinancialEvent, financialProfileId: string): Promise<void> {
  const row = mappers.eventToRow(event, financialProfileId);
  await db
    .insert(schema.financialEvents)
    .values(row)
    .onConflictDoUpdate({ target: schema.financialEvents.id, set: row });
  for (const item of event.lineItems) {
    const itemRow = mappers.lineItemToRow(item, event.id);
    await db
      .insert(schema.financialEventLineItems)
      .values(itemRow)
      .onConflictDoUpdate({ target: schema.financialEventLineItems.id, set: itemRow });
  }
}

export async function upsertInstallmentPlan(db: Database, plan: InstallmentPlan): Promise<void> {
  const row = mappers.installmentPlanToRow(plan);
  await db
    .insert(schema.installmentPlans)
    .values(row)
    .onConflictDoUpdate({ target: schema.installmentPlans.id, set: row });
}

export async function upsertReconciliationLink(db: Database, link: ReconciliationLink): Promise<void> {
  const row = mappers.reconciliationLinkToRow(link);
  await db
    .insert(schema.reconciliationLinks)
    .values(row)
    .onConflictDoUpdate({ target: schema.reconciliationLinks.id, set: row });
}

export async function upsertGoal(db: Database, goal: FinancialGoal, financialProfileId: string): Promise<void> {
  const row = mappers.goalToRow(goal, financialProfileId);
  await db
    .insert(schema.financialGoals)
    .values(row)
    .onConflictDoUpdate({ target: schema.financialGoals.id, set: row });
}

export async function upsertProtectedPreference(
  db: Database,
  preference: ProtectedPreference,
  financialProfileId: string,
): Promise<void> {
  const row = mappers.protectedPreferenceToRow(preference, financialProfileId);
  await db
    .insert(schema.protectedPreferences)
    .values(row)
    .onConflictDoUpdate({ target: schema.protectedPreferences.id, set: row });
}

export async function upsertLifestyleScenario(
  db: Database,
  scenario: LifestyleScenario,
  financialProfileId: string,
): Promise<void> {
  const row = mappers.lifestyleScenarioToRow(scenario, financialProfileId);
  await db
    .insert(schema.lifestyleScenarios)
    .values(row)
    .onConflictDoUpdate({ target: schema.lifestyleScenarios.id, set: row });
  for (const delta of scenario.additionalMonthlyExpenses) {
    const deltaRow = mappers.lifestyleDeltaToRow(delta, scenario.id);
    await db
      .insert(schema.lifestyleDeltas)
      .values(deltaRow)
      .onConflictDoUpdate({ target: schema.lifestyleDeltas.id, set: deltaRow });
  }
}

export async function upsertPosition(db: Database, position: FinancialPosition): Promise<void> {
  const row = mappers.positionToRow(position);
  await db
    .insert(schema.financialPositions)
    .values(row)
    .onConflictDoUpdate({ target: schema.financialPositions.id, set: row });
}

export async function upsertMerchantRule(db: Database, rule: MerchantNormalizationRule): Promise<void> {
  const row = mappers.merchantRuleToRow(rule);
  await db
    .insert(schema.merchantNormalizationRules)
    .values(row)
    .onConflictDoUpdate({ target: schema.merchantNormalizationRules.id, set: row });
}

export async function upsertCategoryRule(db: Database, rule: CategoryRule): Promise<void> {
  const row = mappers.categoryRuleToRow(rule);
  await db
    .insert(schema.categoryRules)
    .values(row)
    .onConflictDoUpdate({ target: schema.categoryRules.id, set: row });
}

// ---------- Loading a full FinancialSnapshotInput back out ----------

export async function loadFinancialSnapshotInput(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
): Promise<FinancialSnapshotInput> {
  const [incomeRows, fixedExpenseRows, variableBudgetRows, goalRows, preferenceRows, transactionRows, paymentSourceRows, eventRows, installmentPlanRows, linkRows, positionRows] =
    await Promise.all([
      db.select().from(schema.incomes).where(eq(schema.incomes.financialProfileId, financialProfileId)),
      db.select().from(schema.fixedExpenses).where(eq(schema.fixedExpenses.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.variableBudgets)
        .where(eq(schema.variableBudgets.financialProfileId, financialProfileId)),
      db.select().from(schema.financialGoals).where(eq(schema.financialGoals.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.protectedPreferences)
        .where(eq(schema.protectedPreferences.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.financialTransactions)
        .where(eq(schema.financialTransactions.financialProfileId, financialProfileId)),
      db.select().from(schema.paymentSources).where(eq(schema.paymentSources.financialProfileId, financialProfileId)),
      db.select().from(schema.financialEvents).where(eq(schema.financialEvents.financialProfileId, financialProfileId)),
      db
        .select()
        .from(schema.installmentPlans)
        .where(eq(schema.installmentPlans.financialProfileId, financialProfileId)),
      db.select().from(schema.reconciliationLinks),
      db
        .select()
        .from(schema.financialPositions)
        .where(eq(schema.financialPositions.financialProfileId, financialProfileId)),
    ]);

  const paymentSourceById = new Map(paymentSourceRows.map((r) => [r.id, mappers.rowToPaymentSource(r)]));

  const eventIds = eventRows.map((e) => e.id);
  const lineItemRows = eventIds.length
    ? await db
        .select()
        .from(schema.financialEventLineItems)
        .where(inArray(schema.financialEventLineItems.financialEventId, eventIds))
    : [];

  const events = eventRows.map((row) =>
    mappers.rowsToEvent(
      row,
      lineItemRows.filter((li) => li.financialEventId === row.id),
    ),
  );

  const transactions = transactionRows.map((row) => {
    const paymentSource = paymentSourceById.get(row.paymentSourceId);
    if (!paymentSource) {
      throw new Error(`Transaction ${row.id} references unknown payment source ${row.paymentSourceId}`);
    }
    return mappers.rowToTransaction(row, paymentSource);
  });

  if (goalRows.length === 0 || goalRows[0] === undefined) {
    throw new Error(`No FinancialGoal found for profile ${financialProfileId}`);
  }

  return {
    asOfDate,
    income: incomeRows.map(mappers.rowToIncome),
    fixedExpenses: fixedExpenseRows.map(mappers.rowToFixedExpense),
    variableBudgets: variableBudgetRows.map(mappers.rowToVariableBudget),
    transactions,
    reconciliationLinks: linkRows.map(mappers.rowToReconciliationLink),
    events,
    installmentPlans: installmentPlanRows.map(mappers.rowToInstallmentPlan),
    goal: mappers.rowToGoal(goalRows[0]),
    protectedPreferences: preferenceRows.map(mappers.rowToProtectedPreference),
    ...(positionRows[0] ? { position: mappers.rowToPosition(positionRows[0]) } : {}),
  };
}

/** Loads the CURRENT_LIFESTYLE and INDEPENDENT_LIVING scenarios for a profile, if present. */
export async function loadLifestyleScenarios(
  db: Database,
  financialProfileId: string,
): Promise<{ current: LifestyleScenario | undefined; independent: LifestyleScenario | undefined }> {
  const scenarioRows = await db
    .select()
    .from(schema.lifestyleScenarios)
    .where(eq(schema.lifestyleScenarios.financialProfileId, financialProfileId));

  const scenarioIds = scenarioRows.map((r) => r.id);
  const deltaRows = scenarioIds.length
    ? await db
        .select()
        .from(schema.lifestyleDeltas)
        .where(inArray(schema.lifestyleDeltas.lifestyleScenarioId, scenarioIds))
    : [];

  const scenarios = scenarioRows.map((row) =>
    mappers.rowsToLifestyleScenario(
      row,
      deltaRows.filter((d) => d.lifestyleScenarioId === row.id),
    ),
  );

  return {
    current: scenarios.find((s) => s.type === "CURRENT_LIFESTYLE"),
    independent: scenarios.find((s) => s.type === "INDEPENDENT_LIVING"),
  };
}

/** Loads merchant normalization and categorization rules (global, not per-profile). */
export async function loadRules(
  db: Database,
): Promise<{ merchantRules: MerchantNormalizationRule[]; categoryRules: CategoryRule[] }> {
  const [merchantRuleRows, categoryRuleRows] = await Promise.all([
    db.select().from(schema.merchantNormalizationRules),
    db.select().from(schema.categoryRules),
  ]);
  return {
    merchantRules: merchantRuleRows.map(mappers.rowToMerchantRule),
    categoryRules: categoryRuleRows.map(mappers.rowToCategoryRule),
  };
}
