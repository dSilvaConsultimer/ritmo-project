import { and, desc, eq, inArray } from "drizzle-orm";
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
  ProviderConnection,
  SyncRun,
  CreditCardBill,
} from "@money-copilot/financial-engine";
import type { AIRequestLog, AIToolExecution, Conversation, ConversationMessage } from "@money-copilot/ai";
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

/**
 * Looks up a profile by id — used by connection recovery (Sprint 4.5) to
 * validate that a Pluggy Item's `clientUserId` corresponds to a real,
 * known profile before attributing a connection to it, rather than
 * trusting the value blindly. See `app-services/src/sync.ts`,
 * `recoverOrphanedConnection`.
 */
export async function getProfileById(db: Database, id: string): Promise<FinancialProfile | undefined> {
  const [row] = await db.select().from(schema.financialProfiles).where(eq(schema.financialProfiles.id, id));
  return row as FinancialProfile | undefined;
}

/**
 * Finds a previously-synced payment source by its provider + external
 * account id — used by the sync pipeline to decide whether to update an
 * existing `PaymentSource` row or create a new one (provider accounts have
 * no stable *internal* id until the first sync creates one).
 */
export async function findPaymentSourceByExternalId(
  db: Database,
  financialProfileId: string,
  provider: string,
  externalAccountId: string,
): Promise<PaymentSource | undefined> {
  const [row] = await db
    .select()
    .from(schema.paymentSources)
    .where(
      and(
        eq(schema.paymentSources.financialProfileId, financialProfileId),
        eq(schema.paymentSources.provider, provider),
        eq(schema.paymentSources.externalAccountId, externalAccountId),
      ),
    );
  return row ? mappers.rowToPaymentSource(row) : undefined;
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

export async function listPaymentSourcesForProfile(
  db: Database,
  financialProfileId: string,
): Promise<PaymentSource[]> {
  const rows = await db
    .select()
    .from(schema.paymentSources)
    .where(eq(schema.paymentSources.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToPaymentSource);
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

/** Finds a previously-imported transaction by provider + external transaction id. */
export async function findTransactionByExternalId(
  db: Database,
  financialProfileId: string,
  provider: string,
  externalTransactionId: string,
): Promise<FinancialTransaction | undefined> {
  const [row] = await db
    .select()
    .from(schema.financialTransactions)
    .where(
      and(
        eq(schema.financialTransactions.financialProfileId, financialProfileId),
        eq(schema.financialTransactions.externalProviderId, provider),
        eq(schema.financialTransactions.externalTransactionId, externalTransactionId),
      ),
    );
  if (!row) return undefined;
  const [paymentSourceRow] = await db
    .select()
    .from(schema.paymentSources)
    .where(eq(schema.paymentSources.id, row.paymentSourceId));
  if (!paymentSourceRow) return undefined;
  return mappers.rowToTransaction(row, mappers.rowToPaymentSource(paymentSourceRow));
}

export async function markTransactionReversed(db: Database, transactionId: string, updatedAt: string): Promise<void> {
  await db
    .update(schema.financialTransactions)
    .set({ status: "REVERSED", updatedAt })
    .where(eq(schema.financialTransactions.id, transactionId));
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

/**
 * All reconciliation links currently persisted. NOTE: `reconciliation_links`
 * has no `financialProfileId` column of its own (Sprint 2 schema) — this
 * is global across every profile. Harmless with today's single demo
 * profile; revisit if/when multi-profile support is added. See
 * docs/PROJECT_STATE.md, "Technical debt."
 */
export async function listAllReconciliationLinks(db: Database): Promise<ReconciliationLink[]> {
  const rows = await db.select().from(schema.reconciliationLinks);
  return rows.map(mappers.rowToReconciliationLink);
}

export async function listInstallmentPlansForProfile(
  db: Database,
  financialProfileId: string,
): Promise<InstallmentPlan[]> {
  const rows = await db
    .select()
    .from(schema.installmentPlans)
    .where(eq(schema.installmentPlans.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToInstallmentPlan);
}

export async function findInstallmentPlanByOriginTransactionId(
  db: Database,
  originTransactionId: string,
): Promise<InstallmentPlan | undefined> {
  const [row] = await db
    .select()
    .from(schema.installmentPlans)
    .where(eq(schema.installmentPlans.originTransactionId, originTransactionId));
  return row ? mappers.rowToInstallmentPlan(row) : undefined;
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

// ---------- ProviderConnection ----------

export async function upsertProviderConnection(db: Database, connection: ProviderConnection): Promise<void> {
  const row = mappers.providerConnectionToRow(connection);
  await db
    .insert(schema.providerConnections)
    .values(row)
    .onConflictDoUpdate({ target: schema.providerConnections.id, set: row });
}

/**
 * Finds an existing connection for this (profile, provider, external id)
 * triple — the check that avoids creating a duplicate connection when the
 * same real-world Item is connected more than once. See RULE (Sprint 3):
 * "avoid duplicate provider connections where possible."
 */
export async function findProviderConnection(
  db: Database,
  financialProfileId: string,
  provider: string,
  externalConnectionId: string,
): Promise<ProviderConnection | undefined> {
  const [row] = await db
    .select()
    .from(schema.providerConnections)
    .where(
      and(
        eq(schema.providerConnections.financialProfileId, financialProfileId),
        eq(schema.providerConnections.provider, provider),
        eq(schema.providerConnections.externalConnectionId, externalConnectionId),
      ),
    );
  return row ? mappers.rowToProviderConnection(row) : undefined;
}

export async function listProviderConnections(
  db: Database,
  financialProfileId: string,
): Promise<ProviderConnection[]> {
  const rows = await db
    .select()
    .from(schema.providerConnections)
    .where(eq(schema.providerConnections.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToProviderConnection);
}

export async function getProviderConnectionById(
  db: Database,
  id: string,
): Promise<ProviderConnection | undefined> {
  const [row] = await db.select().from(schema.providerConnections).where(eq(schema.providerConnections.id, id));
  return row ? mappers.rowToProviderConnection(row) : undefined;
}

/**
 * Finds a connection by provider + external id ALONE (no profile filter) —
 * used by webhook processing, which only knows the provider's own
 * `itemId`, not which internal profile it belongs to.
 */
export async function findProviderConnectionByExternalId(
  db: Database,
  provider: string,
  externalConnectionId: string,
): Promise<ProviderConnection | undefined> {
  const [row] = await db
    .select()
    .from(schema.providerConnections)
    .where(
      and(
        eq(schema.providerConnections.provider, provider),
        eq(schema.providerConnections.externalConnectionId, externalConnectionId),
      ),
    );
  return row ? mappers.rowToProviderConnection(row) : undefined;
}

// ---------- Bills ----------

export async function upsertBill(db: Database, bill: CreditCardBill): Promise<void> {
  const row = mappers.billToRow(bill);
  await db.insert(schema.bills).values(row).onConflictDoUpdate({ target: schema.bills.id, set: row });
}

/**
 * Finds a previously-imported bill by provider + external bill id — used
 * by the sync pipeline to reuse the existing internal id (matching the
 * `findTransactionByExternalId`/`findPaymentSourceByExternalId` pattern)
 * rather than creating a duplicate row on every sync. See DEC-048.
 */
export async function findBillByExternalId(
  db: Database,
  provider: string,
  externalBillId: string,
): Promise<CreditCardBill | undefined> {
  const [row] = await db
    .select()
    .from(schema.bills)
    .where(and(eq(schema.bills.provider, provider), eq(schema.bills.externalBillId, externalBillId)));
  return row ? mappers.rowToBill(row) : undefined;
}

export async function listBillsForPaymentSource(
  db: Database,
  paymentSourceId: string,
): Promise<CreditCardBill[]> {
  const rows = await db.select().from(schema.bills).where(eq(schema.bills.paymentSourceId, paymentSourceId));
  return rows.map(mappers.rowToBill);
}

export async function listBillsForProfile(db: Database, financialProfileId: string): Promise<CreditCardBill[]> {
  const rows = await db.select().from(schema.bills).where(eq(schema.bills.financialProfileId, financialProfileId));
  return rows.map(mappers.rowToBill);
}

// ---------- SyncRun ----------

export async function upsertSyncRun(db: Database, run: SyncRun): Promise<void> {
  const row = mappers.syncRunToRow(run);
  await db.insert(schema.syncRuns).values(row).onConflictDoUpdate({ target: schema.syncRuns.id, set: row });
}

export async function getLatestSyncRun(db: Database, connectionId: string): Promise<SyncRun | undefined> {
  const [row] = await db
    .select()
    .from(schema.syncRuns)
    .where(eq(schema.syncRuns.connectionId, connectionId))
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(1);
  return row ? mappers.rowToSyncRun(row) : undefined;
}

// ---------- Webhook idempotency ----------

export type WebhookInsertResult = "INSERTED" | "ALREADY_PROCESSED";

/**
 * Attempts to claim a webhook event id for processing. Returns
 * `ALREADY_PROCESSED` (without throwing) when a row for this `eventId`
 * already exists — the `INSERT ... ON CONFLICT DO NOTHING` + row-count
 * check IS the entire idempotency mechanism (see schema.ts,
 * `webhookEvents`). Callers must skip processing when this returns
 * `ALREADY_PROCESSED`.
 */
export async function claimWebhookEvent(
  db: Database,
  eventId: string,
  provider: string,
  event: string,
  receivedAt: string,
  payloadSummary: Record<string, unknown>,
): Promise<WebhookInsertResult> {
  const result = await db
    .insert(schema.webhookEvents)
    .values({
      id: eventId,
      provider,
      event,
      receivedAt,
      status: "RECEIVED",
      payloadSummary: JSON.stringify(payloadSummary),
    })
    .onConflictDoNothing({ target: schema.webhookEvents.id })
    .returning({ id: schema.webhookEvents.id });

  return result.length > 0 ? "INSERTED" : "ALREADY_PROCESSED";
}

export async function markWebhookEventProcessed(
  db: Database,
  eventId: string,
  processedAt: string,
): Promise<void> {
  await db
    .update(schema.webhookEvents)
    .set({ status: "PROCESSED", processedAt })
    .where(eq(schema.webhookEvents.id, eventId));
}

export async function markWebhookEventFailed(
  db: Database,
  eventId: string,
  processedAt: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(schema.webhookEvents)
    .set({ status: "FAILED", processedAt, errorMessage })
    .where(eq(schema.webhookEvents.id, eventId));
}

// ---------- AI Copilot: Conversation / ConversationMessage / AIToolExecution / AIRequestLog ----------

export async function upsertConversation(db: Database, conversation: Conversation): Promise<void> {
  const row = mappers.conversationToRow(conversation);
  await db
    .insert(schema.conversations)
    .values(row)
    .onConflictDoUpdate({ target: schema.conversations.id, set: row });
}

export async function getConversationById(db: Database, id: string): Promise<Conversation | undefined> {
  const [row] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, id));
  return row ? mappers.rowToConversation(row) : undefined;
}

export async function listConversationsForProfile(
  db: Database,
  financialProfileId: string,
): Promise<Conversation[]> {
  const rows = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.financialProfileId, financialProfileId))
    .orderBy(desc(schema.conversations.updatedAt));
  return rows.map(mappers.rowToConversation);
}

export async function insertConversationMessage(db: Database, message: ConversationMessage): Promise<void> {
  const row = mappers.conversationMessageToRow(message);
  await db
    .insert(schema.conversationMessages)
    .values(row)
    .onConflictDoUpdate({ target: schema.conversationMessages.id, set: row });
}

/** Full message history for a conversation, oldest first — the exact input the tool loop reconstructs each turn from. */
export async function listConversationMessages(
  db: Database,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const rows = await db
    .select()
    .from(schema.conversationMessages)
    .where(eq(schema.conversationMessages.conversationId, conversationId))
    .orderBy(schema.conversationMessages.createdAt);
  return rows.map(mappers.rowToConversationMessage);
}

export async function insertAIToolExecution(db: Database, execution: AIToolExecution): Promise<void> {
  const row = mappers.aiToolExecutionToRow(execution);
  await db
    .insert(schema.aiToolExecutions)
    .values(row)
    .onConflictDoUpdate({ target: schema.aiToolExecutions.id, set: row });
}

export async function listAIToolExecutionsForConversation(
  db: Database,
  conversationId: string,
): Promise<AIToolExecution[]> {
  const rows = await db
    .select()
    .from(schema.aiToolExecutions)
    .where(eq(schema.aiToolExecutions.conversationId, conversationId));
  return rows.map(mappers.rowToAIToolExecution);
}

export async function insertAIRequestLog(db: Database, log: AIRequestLog): Promise<void> {
  const row = mappers.aiRequestToRow(log);
  await db.insert(schema.aiRequests).values(row).onConflictDoUpdate({ target: schema.aiRequests.id, set: row });
}

export async function listAIRequestLogsForConversation(
  db: Database,
  conversationId: string,
): Promise<AIRequestLog[]> {
  const rows = await db
    .select()
    .from(schema.aiRequests)
    .where(eq(schema.aiRequests.conversationId, conversationId));
  return rows.map(mappers.rowToAIRequest);
}
