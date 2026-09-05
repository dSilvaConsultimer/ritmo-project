import type { Id } from "@money-copilot/shared";
import * as M from "@money-copilot/financial-engine";
import type {
  Income,
  FixedExpense,
  VariableBudget,
  PaymentSource,
  FinancialTransaction,
  FinancialEvent,
  FinancialEventLineItem,
  InstallmentPlan,
  ReconciliationLink,
  FinancialGoal,
  ProtectedPreference,
  LifestyleScenario,
  LifestyleDelta,
  FinancialPosition,
  MerchantNormalizationRule,
  CategoryRule,
} from "@money-copilot/financial-engine";
import * as schema from "./schema";

type PaymentSourceRow = typeof schema.paymentSources.$inferSelect;
type IncomeRow = typeof schema.incomes.$inferSelect;
type FixedExpenseRow = typeof schema.fixedExpenses.$inferSelect;
type VariableBudgetRow = typeof schema.variableBudgets.$inferSelect;
type TransactionRow = typeof schema.financialTransactions.$inferSelect;
type EventRow = typeof schema.financialEvents.$inferSelect;
type EventLineItemRow = typeof schema.financialEventLineItems.$inferSelect;
type InstallmentPlanRow = typeof schema.installmentPlans.$inferSelect;
type ReconciliationLinkRow = typeof schema.reconciliationLinks.$inferSelect;
type GoalRow = typeof schema.financialGoals.$inferSelect;
type ProtectedPreferenceRow = typeof schema.protectedPreferences.$inferSelect;
type LifestyleScenarioRow = typeof schema.lifestyleScenarios.$inferSelect;
type LifestyleDeltaRow = typeof schema.lifestyleDeltas.$inferSelect;
type PositionRow = typeof schema.financialPositions.$inferSelect;
type MerchantRuleRow = typeof schema.merchantNormalizationRules.$inferSelect;
type CategoryRuleRow = typeof schema.categoryRules.$inferSelect;

// ---------- PaymentSource ----------

export function paymentSourceToRow(
  p: PaymentSource,
  financialProfileId: string,
): typeof schema.paymentSources.$inferInsert {
  return { id: p.id, financialProfileId, label: p.label, type: p.type };
}

export function rowToPaymentSource(row: PaymentSourceRow): PaymentSource {
  return { id: row.id as Id<"payment-source">, label: row.label, type: row.type };
}

// ---------- Income ----------

export function incomeToRow(i: Income, financialProfileId: string): typeof schema.incomes.$inferInsert {
  return {
    id: i.id,
    financialProfileId,
    label: i.label,
    grossAmountCents: i.grossAmount.cents,
    certainty: i.certainty,
    recurring: i.recurring,
  };
}

export function rowToIncome(row: IncomeRow): Income {
  return {
    id: row.id as Id<"income">,
    label: row.label,
    grossAmount: M.fromCents(row.grossAmountCents),
    certainty: row.certainty,
    recurring: row.recurring,
  };
}

// ---------- FixedExpense ----------

export function fixedExpenseToRow(
  e: FixedExpense,
  financialProfileId: string,
): typeof schema.fixedExpenses.$inferInsert {
  return {
    id: e.id,
    financialProfileId,
    label: e.label,
    category: e.category,
    amountCents: e.amount.cents,
    certainty: e.certainty,
    protected: e.protected,
  };
}

export function rowToFixedExpense(row: FixedExpenseRow): FixedExpense {
  return {
    id: row.id as Id<"fixed-expense">,
    label: row.label,
    category: row.category,
    amount: M.fromCents(row.amountCents),
    certainty: row.certainty,
    protected: row.protected,
  };
}

// ---------- VariableBudget ----------

export function variableBudgetToRow(
  b: VariableBudget,
  financialProfileId: string,
): typeof schema.variableBudgets.$inferInsert {
  return {
    id: b.id,
    financialProfileId,
    label: b.label,
    category: b.category,
    targetAmountCents: b.targetAmount.cents,
    certainty: b.certainty,
  };
}

export function rowToVariableBudget(row: VariableBudgetRow): VariableBudget {
  return {
    id: row.id as Id<"variable-budget">,
    label: row.label,
    category: row.category,
    targetAmount: M.fromCents(row.targetAmountCents),
    certainty: row.certainty,
  };
}

// ---------- FinancialTransaction ----------

export function transactionToRow(
  t: FinancialTransaction,
): typeof schema.financialTransactions.$inferInsert {
  return {
    id: t.id,
    financialProfileId: t.financialProfileId,
    externalProviderId: t.externalProviderId ?? null,
    externalTransactionId: t.externalTransactionId ?? null,
    paymentSourceId: t.paymentSource.id,
    date: t.date,
    authorizationDate: t.authorizationDate ?? null,
    postingDate: t.postingDate ?? null,
    amountCents: t.amount.cents,
    direction: t.direction,
    rawDescription: t.rawDescription,
    normalizedDescription: t.normalizedDescription,
    rawMerchant: t.rawMerchant ?? null,
    normalizedMerchant: t.normalizedMerchant ?? null,
    status: t.status,
    certainty: t.certainty,
    financialEffect: t.financialEffect,
    category: t.category,
    subcategory: t.subcategory ?? null,
    origin: t.origin,
    metadata: t.metadata ? JSON.stringify(t.metadata) : null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function rowToTransaction(
  row: TransactionRow,
  paymentSource: PaymentSource,
): FinancialTransaction {
  return {
    id: row.id as Id<"transaction">,
    financialProfileId: row.financialProfileId as Id<"financial-profile">,
    ...(row.externalProviderId ? { externalProviderId: row.externalProviderId } : {}),
    ...(row.externalTransactionId ? { externalTransactionId: row.externalTransactionId } : {}),
    paymentSource,
    date: row.date,
    ...(row.authorizationDate ? { authorizationDate: row.authorizationDate } : {}),
    ...(row.postingDate ? { postingDate: row.postingDate } : {}),
    amount: M.fromCents(row.amountCents),
    direction: row.direction,
    rawDescription: row.rawDescription,
    normalizedDescription: row.normalizedDescription,
    ...(row.rawMerchant ? { rawMerchant: row.rawMerchant } : {}),
    ...(row.normalizedMerchant ? { normalizedMerchant: row.normalizedMerchant } : {}),
    status: row.status,
    certainty: row.certainty,
    financialEffect: row.financialEffect,
    category: row.category,
    ...(row.subcategory ? { subcategory: row.subcategory } : {}),
    origin: row.origin,
    ...(row.metadata ? { metadata: JSON.parse(row.metadata) as Record<string, unknown> } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------- FinancialEvent ----------

export function eventToRow(e: FinancialEvent, financialProfileId: string): typeof schema.financialEvents.$inferInsert {
  return { id: e.id, financialProfileId, label: e.label, startDate: e.startDate, endDate: e.endDate };
}

export function lineItemToRow(
  item: FinancialEventLineItem,
  financialEventId: string,
): typeof schema.financialEventLineItems.$inferInsert {
  return {
    id: item.id,
    financialEventId,
    label: item.label,
    amountCents: item.amount?.cents ?? null,
    certainty: item.certainty,
    status: item.status,
  };
}

export function rowsToEvent(row: EventRow, lineItemRows: readonly EventLineItemRow[]): FinancialEvent {
  return {
    id: row.id as Id<"financial-event">,
    label: row.label,
    startDate: row.startDate,
    endDate: row.endDate,
    lineItems: lineItemRows.map(
      (li): FinancialEventLineItem => ({
        id: li.id as Id<"event-line-item">,
        label: li.label,
        amount: li.amountCents === null ? null : M.fromCents(li.amountCents),
        certainty: li.certainty,
        status: li.status,
      }),
    ),
  };
}

// ---------- InstallmentPlan ----------

export function installmentPlanToRow(p: InstallmentPlan): typeof schema.installmentPlans.$inferInsert {
  return {
    id: p.id,
    financialProfileId: p.financialProfileId,
    description: p.description,
    originTransactionId: p.originTransactionId ?? null,
    totalOriginalAmountCents: p.totalOriginalAmount?.cents ?? null,
    installmentAmountCents: p.installmentAmount.cents,
    installmentNumber: p.installmentNumber,
    totalInstallments: p.totalInstallments,
    firstDueDate: p.firstDueDate,
    certainty: p.certainty,
    status: p.status,
  };
}

export function rowToInstallmentPlan(row: InstallmentPlanRow): InstallmentPlan {
  return {
    id: row.id as Id<"installment-plan">,
    financialProfileId: row.financialProfileId as Id<"financial-profile">,
    description: row.description,
    ...(row.originTransactionId
      ? { originTransactionId: row.originTransactionId as Id<"transaction"> }
      : {}),
    totalOriginalAmount:
      row.totalOriginalAmountCents === null ? null : M.fromCents(row.totalOriginalAmountCents),
    installmentAmount: M.fromCents(row.installmentAmountCents),
    installmentNumber: row.installmentNumber,
    totalInstallments: row.totalInstallments,
    firstDueDate: row.firstDueDate,
    certainty: row.certainty,
    status: row.status,
  };
}

// ---------- ReconciliationLink ----------

export function reconciliationLinkToRow(
  l: ReconciliationLink,
): typeof schema.reconciliationLinks.$inferInsert {
  return {
    id: l.id,
    type: l.type,
    primaryTransactionId: l.primaryTransactionId,
    linkedTransactionId: l.linkedTransactionId ?? null,
    linkedEventLineItemId: l.linkedEventLineItemId ?? null,
    confidence: l.confidence,
    method: l.method,
    status: l.status,
    createdAt: l.createdAt,
  };
}

export function rowToReconciliationLink(row: ReconciliationLinkRow): ReconciliationLink {
  return {
    id: row.id as Id<"reconciliation-link">,
    type: row.type,
    primaryTransactionId: row.primaryTransactionId as Id<"transaction">,
    ...(row.linkedTransactionId
      ? { linkedTransactionId: row.linkedTransactionId as Id<"transaction"> }
      : {}),
    ...(row.linkedEventLineItemId
      ? { linkedEventLineItemId: row.linkedEventLineItemId as Id<"event-line-item"> }
      : {}),
    confidence: row.confidence,
    method: row.method,
    status: row.status,
    createdAt: row.createdAt,
  };
}

// ---------- FinancialGoal ----------

export function goalToRow(g: FinancialGoal, financialProfileId: string): typeof schema.financialGoals.$inferInsert {
  return {
    id: g.id,
    financialProfileId,
    label: g.label,
    monthlySavingsTargetCents: g.monthlySavingsTarget.cents,
    targetReserveAmountCents: g.targetReserveAmount?.cents ?? null,
  };
}

export function rowToGoal(row: GoalRow): FinancialGoal {
  return {
    id: row.id as Id<"financial-goal">,
    label: row.label,
    monthlySavingsTarget: M.fromCents(row.monthlySavingsTargetCents),
    ...(row.targetReserveAmountCents !== null
      ? { targetReserveAmount: M.fromCents(row.targetReserveAmountCents) }
      : {}),
  };
}

// ---------- ProtectedPreference ----------

export function protectedPreferenceToRow(
  p: ProtectedPreference,
  financialProfileId: string,
): typeof schema.protectedPreferences.$inferInsert {
  return {
    id: p.id,
    financialProfileId,
    label: p.label,
    scopeType: p.scope.type,
    scopeExpenseId: p.scope.type === "EXPENSE" ? p.scope.expenseId : null,
    scopeCategory: p.scope.type === "CATEGORY" ? p.scope.category : null,
    reason: p.reason ?? null,
  };
}

export function rowToProtectedPreference(row: ProtectedPreferenceRow): ProtectedPreference {
  return {
    id: row.id as Id<"protected-preference">,
    label: row.label,
    scope:
      row.scopeType === "EXPENSE"
        ? { type: "EXPENSE", expenseId: row.scopeExpenseId as Id<"fixed-expense"> }
        : { type: "CATEGORY", category: row.scopeCategory! },
    ...(row.reason ? { reason: row.reason } : {}),
  };
}

// ---------- LifestyleScenario ----------

export function lifestyleScenarioToRow(
  s: LifestyleScenario,
  financialProfileId: string,
): typeof schema.lifestyleScenarios.$inferInsert {
  return { id: s.id, financialProfileId, type: s.type, label: s.label };
}

export function lifestyleDeltaToRow(
  d: LifestyleDelta,
  lifestyleScenarioId: string,
): typeof schema.lifestyleDeltas.$inferInsert {
  return {
    id: d.id,
    lifestyleScenarioId,
    label: d.label,
    amountCents: d.amount.cents,
    certainty: d.certainty,
  };
}

export function rowsToLifestyleScenario(
  row: LifestyleScenarioRow,
  deltaRows: readonly LifestyleDeltaRow[],
): LifestyleScenario {
  return {
    id: row.id as Id<"lifestyle-scenario">,
    type: row.type,
    label: row.label,
    additionalMonthlyExpenses: deltaRows.map(
      (d): LifestyleDelta => ({
        id: d.id as Id<"lifestyle-delta">,
        label: d.label,
        amount: M.fromCents(d.amountCents),
        certainty: d.certainty,
      }),
    ),
  };
}

// ---------- FinancialPosition ----------

export function positionToRow(p: FinancialPosition): typeof schema.financialPositions.$inferInsert {
  return {
    id: p.id,
    financialProfileId: p.financialProfileId,
    asOf: p.asOf,
    cashBalanceCertainty: p.cashBalance.certainty,
    cashBalanceCents: p.cashBalance.amount?.cents ?? null,
    cardOutstandingCertainty: p.cardOutstandingBalance.certainty,
    cardOutstandingCents: p.cardOutstandingBalance.amount?.cents ?? null,
    otherLiabilitiesCertainty: p.otherLiabilities.certainty,
    otherLiabilitiesCents: p.otherLiabilities.amount?.cents ?? null,
    source: p.source,
  };
}

export function rowToPosition(row: PositionRow): FinancialPosition {
  return {
    id: row.id as Id<"financial-position">,
    financialProfileId: row.financialProfileId as Id<"financial-profile">,
    asOf: row.asOf,
    cashBalance: {
      certainty: row.cashBalanceCertainty,
      amount: row.cashBalanceCents === null ? null : M.fromCents(row.cashBalanceCents),
    },
    cardOutstandingBalance: {
      certainty: row.cardOutstandingCertainty,
      amount: row.cardOutstandingCents === null ? null : M.fromCents(row.cardOutstandingCents),
    },
    otherLiabilities: {
      certainty: row.otherLiabilitiesCertainty,
      amount: row.otherLiabilitiesCents === null ? null : M.fromCents(row.otherLiabilitiesCents),
    },
    source: row.source,
  };
}

// ---------- MerchantNormalizationRule / CategoryRule ----------

export function merchantRuleToRow(
  r: MerchantNormalizationRule,
): typeof schema.merchantNormalizationRules.$inferInsert {
  return {
    id: r.id,
    matchType: r.matchType,
    pattern: r.pattern,
    normalizedMerchant: r.normalizedMerchant,
    priority: r.priority,
  };
}

export function rowToMerchantRule(row: MerchantRuleRow): MerchantNormalizationRule {
  return {
    id: row.id as Id<"merchant-rule">,
    matchType: row.matchType,
    pattern: row.pattern,
    normalizedMerchant: row.normalizedMerchant,
    priority: row.priority,
  };
}

export function categoryRuleToRow(r: CategoryRule): typeof schema.categoryRules.$inferInsert {
  return {
    id: r.id,
    matchType: r.matchType,
    pattern: r.pattern,
    category: r.category,
    subcategory: r.subcategory ?? null,
    priority: r.priority,
  };
}

export function rowToCategoryRule(row: CategoryRuleRow): CategoryRule {
  return {
    id: row.id as Id<"category-rule">,
    matchType: row.matchType,
    pattern: row.pattern,
    category: row.category,
    ...(row.subcategory ? { subcategory: row.subcategory } : {}),
    priority: row.priority,
  };
}
