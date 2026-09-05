import { boolean, integer, pgTable, text, unique } from "drizzle-orm/pg-core";
import type {
  Certainty,
  EventLineItemStatus,
  FinancialEffect,
  InstallmentPlanStatus,
  LifestyleScenarioType,
  LiquidityCoverage,
  MatchConfidence,
  MerchantMatchType,
  PaymentSourceType,
  ProviderConnectionStatus,
  ReconciliationLinkType,
  ReconciliationMethod,
  ReconciliationStatus,
  RecommendationStatus,
  RecurringCandidateConfidence,
  RecurringCandidateStatus,
  SyncRunStatus,
  TransactionDirection,
  TransactionOrigin,
  TransactionStatus,
} from "@money-copilot/financial-engine";
import type { CategoryRuleMatchType } from "@money-copilot/financial-engine";

/**
 * All monetary columns are integer cents (`*_cents`) — never floating
 * point. All date/date-time columns are ISO 8601 text — Sprint 2 keeps
 * this simple rather than fighting timezone-aware SQL date types; every
 * date in this domain is treated as an explicit calendar string end-to-end
 * (see `packages/financial-engine/src/snapshot/date-utils.ts`).
 *
 * Every table carries `financialProfileId` (see DEC-014: no auth yet, but
 * every row belongs to a profile from day one).
 */

export const financialProfiles = pgTable("financial_profiles", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Metadata about an external financial-data connection (e.g. a Pluggy
 * Item). Never stores banking login credentials — only provider-side
 * identifiers and sync bookkeeping (DEC-023). The unique constraint on
 * (financialProfileId, provider, externalConnectionId) is what prevents a
 * duplicate connection from being created for the same real-world Item.
 */
export const providerConnections = pgTable(
  "provider_connections",
  {
    id: text("id").primaryKey(),
    financialProfileId: text("financial_profile_id")
      .notNull()
      .references(() => financialProfiles.id),
    provider: text("provider").notNull(),
    externalConnectionId: text("external_connection_id").notNull(),
    status: text("status").$type<ProviderConnectionStatus>().notNull(),
    connectorId: text("connector_id"),
    connectorName: text("connector_name"),
    lastSuccessfulSyncAt: text("last_successful_sync_at"),
    lastAttemptedSyncAt: text("last_attempted_sync_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    consentExpiresAt: text("consent_expires_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [unique().on(table.financialProfileId, table.provider, table.externalConnectionId)],
);

export const paymentSources = pgTable("payment_sources", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  label: text("label").notNull(),
  type: text("type").$type<PaymentSourceType>().notNull(),
  subtype: text("subtype"),
  provider: text("provider"),
  externalAccountId: text("external_account_id"),
  connectionId: text("connection_id").references(() => providerConnections.id),
  currency: text("currency"),
  balanceCertainty: text("balance_certainty").$type<Certainty>(),
  balanceCents: integer("balance_cents"),
  creditLimitCents: integer("credit_limit_cents"),
  availableCreditLimitCents: integer("available_credit_limit_cents"),
  creditClosingDate: text("credit_closing_date"),
  creditDueDate: text("credit_due_date"),
  minimumPaymentCents: integer("minimum_payment_cents"),
  lastSyncedAt: text("last_synced_at"),
});

export const incomes = pgTable("incomes", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  label: text("label").notNull(),
  grossAmountCents: integer("gross_amount_cents").notNull(),
  certainty: text("certainty").$type<Certainty>().notNull(),
  recurring: boolean("recurring").notNull(),
});

export const fixedExpenses = pgTable("fixed_expenses", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  label: text("label").notNull(),
  category: text("category").notNull(),
  amountCents: integer("amount_cents").notNull(),
  certainty: text("certainty").$type<Certainty>().notNull(),
  protected: boolean("protected").notNull(),
});

export const variableBudgets = pgTable("variable_budgets", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  label: text("label").notNull(),
  category: text("category").notNull(),
  targetAmountCents: integer("target_amount_cents").notNull(),
  certainty: text("certainty").$type<Certainty>().notNull(),
});

/**
 * Sprint 2 folds transaction classification (financial effect, category,
 * certainty) directly onto the transaction row rather than a separate
 * "TransactionClassification" table — there is exactly one current
 * classification per transaction and no history requirement yet. See
 * DEC-015 (documented simplification).
 */
export const financialTransactions = pgTable("financial_transactions", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  externalProviderId: text("external_provider_id"),
  externalTransactionId: text("external_transaction_id"),
  paymentSourceId: text("payment_source_id")
    .notNull()
    .references(() => paymentSources.id),
  date: text("date").notNull(),
  authorizationDate: text("authorization_date"),
  postingDate: text("posting_date"),
  amountCents: integer("amount_cents").notNull(),
  direction: text("direction").$type<TransactionDirection>().notNull(),
  rawDescription: text("raw_description").notNull(),
  normalizedDescription: text("normalized_description").notNull(),
  rawMerchant: text("raw_merchant"),
  normalizedMerchant: text("normalized_merchant"),
  status: text("status").$type<TransactionStatus>().notNull(),
  certainty: text("certainty").$type<Certainty>().notNull(),
  financialEffect: text("financial_effect").$type<FinancialEffect>().notNull(),
  category: text("category"),
  subcategory: text("subcategory"),
  origin: text("origin").$type<TransactionOrigin>().notNull(),
  metadata: text("metadata"), // JSON-encoded; never used in calculations.
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const financialEvents = pgTable("financial_events", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  label: text("label").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
});

export const financialEventLineItems = pgTable("financial_event_line_items", {
  id: text("id").primaryKey(),
  financialEventId: text("financial_event_id")
    .notNull()
    .references(() => financialEvents.id),
  label: text("label").notNull(),
  amountCents: integer("amount_cents"), // null when certainty is UNKNOWN
  certainty: text("certainty").$type<Certainty>().notNull(),
  status: text("status").$type<EventLineItemStatus>().notNull(),
});

/**
 * Only the aggregate plan is persisted in Sprint 2 — individual future
 * `Installment` occurrences (per-due-date rows) are not yet materialized;
 * `summarizeFutureInstallmentCommitments` derives the 30/90-day view from
 * the plan's amount + known/unknown schedule instead. See DEC-016.
 */
export const installmentPlans = pgTable("installment_plans", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  description: text("description").notNull(),
  originTransactionId: text("origin_transaction_id").references(() => financialTransactions.id),
  paymentSourceId: text("payment_source_id").references(() => paymentSources.id),
  totalOriginalAmountCents: integer("total_original_amount_cents"),
  installmentAmountCents: integer("installment_amount_cents").notNull(),
  installmentNumber: integer("installment_number"),
  totalInstallments: integer("total_installments"),
  firstDueDate: text("first_due_date"),
  certainty: text("certainty").$type<Certainty>().notNull(),
  status: text("status").$type<InstallmentPlanStatus>().notNull(),
});

export const reconciliationLinks = pgTable("reconciliation_links", {
  id: text("id").primaryKey(),
  type: text("type").$type<ReconciliationLinkType>().notNull(),
  primaryTransactionId: text("primary_transaction_id")
    .notNull()
    .references(() => financialTransactions.id),
  linkedTransactionId: text("linked_transaction_id").references(() => financialTransactions.id),
  linkedEventLineItemId: text("linked_event_line_item_id").references(
    () => financialEventLineItems.id,
  ),
  confidence: text("confidence").$type<MatchConfidence>().notNull(),
  method: text("method").$type<ReconciliationMethod>().notNull(),
  status: text("status").$type<ReconciliationStatus>().notNull(),
  createdAt: text("created_at").notNull(),
});

export const financialGoals = pgTable("financial_goals", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  label: text("label").notNull(),
  monthlySavingsTargetCents: integer("monthly_savings_target_cents").notNull(),
  targetReserveAmountCents: integer("target_reserve_amount_cents"),
});

export const protectedPreferences = pgTable("protected_preferences", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  label: text("label").notNull(),
  scopeType: text("scope_type").$type<"EXPENSE" | "CATEGORY">().notNull(),
  scopeExpenseId: text("scope_expense_id").references(() => fixedExpenses.id),
  scopeCategory: text("scope_category"),
  reason: text("reason"),
});

/** Lifecycle persistence only — recommendation discovery is future work. */
export const recommendations = pgTable("recommendations", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  title: text("title").notNull(),
  description: text("description"),
  estimatedMonthlySavingsCents: integer("estimated_monthly_savings_cents").notNull(),
  status: text("status").$type<RecommendationStatus>().notNull(),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
  modifiedMonthlySavingsCents: integer("modified_monthly_savings_cents"),
  rejectionReason: text("rejection_reason"),
  verifiedAt: text("verified_at"),
  actualMonthlySavingsCents: integer("actual_monthly_savings_cents"),
  supersedesRecommendationId: text("supersedes_recommendation_id"),
});

export const lifestyleScenarios = pgTable("lifestyle_scenarios", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  type: text("type").$type<LifestyleScenarioType>().notNull(),
  label: text("label").notNull(),
});

export const lifestyleDeltas = pgTable("lifestyle_deltas", {
  id: text("id").primaryKey(),
  lifestyleScenarioId: text("lifestyle_scenario_id")
    .notNull()
    .references(() => lifestyleScenarios.id),
  label: text("label").notNull(),
  amountCents: integer("amount_cents").notNull(),
  certainty: text("certainty").$type<Certainty>().notNull(),
});

export const financialPositions = pgTable("financial_positions", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  asOf: text("as_of").notNull(),
  cashBalanceCertainty: text("cash_balance_certainty").$type<Certainty>().notNull(),
  cashBalanceCents: integer("cash_balance_cents"),
  cardOutstandingCertainty: text("card_outstanding_certainty").$type<Certainty>().notNull(),
  cardOutstandingCents: integer("card_outstanding_cents"),
  otherLiabilitiesCertainty: text("other_liabilities_certainty").$type<Certainty>().notNull(),
  otherLiabilitiesCents: integer("other_liabilities_cents"),
  source: text("source").notNull(),
  coverage: text("coverage").$type<LiquidityCoverage>().notNull(),
});

export const merchantNormalizationRules = pgTable("merchant_normalization_rules", {
  id: text("id").primaryKey(),
  matchType: text("match_type").$type<MerchantMatchType>().notNull(),
  pattern: text("pattern").notNull(),
  normalizedMerchant: text("normalized_merchant").notNull(),
  priority: integer("priority").notNull(),
});

export const categories = pgTable("categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
});

export const categoryRules = pgTable("category_rules", {
  id: text("id").primaryKey(),
  matchType: text("match_type").$type<CategoryRuleMatchType>().notNull(),
  pattern: text("pattern").notNull(),
  category: text("category").notNull(),
  subcategory: text("subcategory"),
  priority: integer("priority").notNull(),
});

export const recurringCandidates = pgTable("recurring_candidates", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  evidenceKey: text("evidence_key").notNull(),
  normalizedMerchant: text("normalized_merchant").notNull(),
  occurrences: integer("occurrences").notNull(),
  averageAmountCents: integer("average_amount_cents").notNull(),
  averageIntervalDays: integer("average_interval_days"),
  confidence: text("confidence").$type<RecurringCandidateConfidence>().notNull(),
  status: text("status").$type<RecurringCandidateStatus>().notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * A credit card bill/invoice. Never fed into snapshot math — see
 * `@money-copilot/financial-engine`'s `domain/bill.ts` doc comment: "Bills
 * are not a second copy of consumption."
 */
export const bills = pgTable("bills", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  paymentSourceId: text("payment_source_id")
    .notNull()
    .references(() => paymentSources.id),
  provider: text("provider"),
  externalBillId: text("external_bill_id"),
  dueDate: text("due_date").notNull(),
  closingDate: text("closing_date"),
  totalAmountCents: integer("total_amount_cents").notNull(),
  minimumPaymentCents: integer("minimum_payment_cents"),
  allowsInstallments: boolean("allows_installments"),
  certainty: text("certainty").$type<Certainty>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * One observable synchronization attempt for a connection. Must never
 * silently swallow a partial failure — `errors` always explains a
 * `PARTIAL`/`FAILED` run. See docs/OPEN-FINANCE.md, "Sync model."
 */
export const syncRuns = pgTable("sync_runs", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id")
    .notNull()
    .references(() => providerConnections.id),
  status: text("status").$type<SyncRunStatus>().notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  accountsDiscovered: integer("accounts_discovered").notNull().default(0),
  transactionsReceived: integer("transactions_received").notNull().default(0),
  transactionsCreated: integer("transactions_created").notNull().default(0),
  transactionsUpdated: integer("transactions_updated").notNull().default(0),
  transactionsReconciled: integer("transactions_reconciled").notNull().default(0),
  transactionsIgnoredDuplicates: integer("transactions_ignored_duplicates").notNull().default(0),
  billsReceived: integer("bills_received").notNull().default(0),
  errors: text("errors"), // JSON-encoded string[]; never used in calculations.
  providerCursor: text("provider_cursor"),
});

/**
 * A processed (or in-flight) webhook delivery, keyed by the PROVIDER'S OWN
 * event id — inserting a row with `id = eventId` before processing, and
 * checking for a pre-existing row first, is the entire idempotency
 * mechanism: a duplicate delivery of the same `eventId` is detected by a
 * primary-key conflict rather than any extra bookkeeping. Only a narrow,
 * sanitized summary is stored (`payloadSummary`) — never the full raw
 * webhook payload. See docs/OPEN-FINANCE.md, "Webhooks" and "raw payload
 * retention policy."
 */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(), // the provider's eventId
  provider: text("provider").notNull(),
  event: text("event").notNull(),
  receivedAt: text("received_at").notNull(),
  processedAt: text("processed_at"),
  status: text("status").$type<"RECEIVED" | "PROCESSED" | "FAILED">().notNull(),
  payloadSummary: text("payload_summary"), // small JSON: event/itemId/accountId/counts only
  errorMessage: text("error_message"),
});
