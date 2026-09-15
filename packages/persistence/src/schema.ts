import { boolean, integer, pgTable, text, unique } from "drizzle-orm/pg-core";
export * from "./auth-schema";
import { user } from "./auth-schema";
import type {
  Certainty,
  EventLineItemStatus,
  FinancialEffect,
  IncomeSource,
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
  RecommendationType,
  RecurrenceCadence,
  RecurringCandidateConfidence,
  RecurringCandidateStatus,
  SyncRunStatus,
  TransactionDirection,
  TransactionOrigin,
  TransactionStatus,
  VerificationAssessment,
} from "@money-copilot/financial-engine";
import type { CategoryRuleMatchType } from "@money-copilot/financial-engine";
import type { ConversationStatus, MessageRole, ToolExecutionStatus } from "@money-copilot/ai";

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
  /**
   * Sprint 9: the authenticated identity that owns this profile — Better
   * Auth's `user.id` (DEC-089), never a second parallel identity. Nullable
   * because pre-Sprint-9 fixture/dev profiles have no owning user. Unique
   * (not just indexed) so one authenticated user can never end up owning
   * two profiles by accident — multiple NULLs are still allowed by
   * Postgres, so existing unowned profiles are unaffected. Deliberately NO
   * `onDelete: cascade` — matching every other `financial_profile_id`
   * reference in this schema, deletion of financial data is always an
   * explicit, audited, application-level operation (see
   * `disconnectConnection`'s own doc comment), never a DB-level side
   * effect. A future "delete account" feature (explicitly out of scope for
   * Sprint 9) decides deliberately what to do with the profile first; until
   * then Postgres simply blocks deleting a `user` row that still owns one.
   */
  ownerUserId: text("owner_user_id")
    .unique()
    .references(() => user.id),
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

/**
 * DEC-131: the unique constraint on (financialProfileId, provider,
 * externalAccountId) is the DB-level enforcement of the same canonical
 * provider-account identity `findPaymentSourceByExternalId` already keys
 * its lookups on — see docs/DECISIONS.md DEC-131. Standard Postgres
 * multi-column unique-constraint NULL semantics (each NULL is distinct)
 * mean this never restricts manually-entered payment sources, which always
 * have `provider`/`externalAccountId` both null.
 */
export const paymentSources = pgTable(
  "payment_sources",
  {
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
    // DEC-130: reserved/available/invested balances — see PaymentSource's own
    // doc comments in packages/financial-engine for exact semantics. All
    // three share `balanceCertainty` (always known together, from the same
    // sync moment) rather than each needing its own certainty column.
    availableBalanceCents: integer("available_balance_cents"),
    reservedBalanceCents: integer("reserved_balance_cents"),
    automaticallyInvestedBalanceCents: integer("automatically_invested_balance_cents"),
    creditLimitCents: integer("credit_limit_cents"),
    availableCreditLimitCents: integer("available_credit_limit_cents"),
    creditClosingDate: text("credit_closing_date"),
    creditDueDate: text("credit_due_date"),
    minimumPaymentCents: integer("minimum_payment_cents"),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => [unique().on(table.financialProfileId, table.provider, table.externalAccountId)],
);

export const incomes = pgTable("incomes", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  label: text("label").notNull(),
  grossAmountCents: integer("gross_amount_cents").notNull(),
  certainty: text("certainty").$type<Certainty>().notNull(),
  recurring: boolean("recurring").notNull(),
  // DEC-130: nullable at the DB level (existing rows predate this field) —
  // `rowToIncome` defaults a null `source` to `"USER_DECLARED"`, since every
  // Income before DEC-130 was, in fact, entered as a direct user statement
  // (createIncome always required explicit confirmation — see DEC-127).
  source: text("source").$type<IncomeSource>(),
  expectedDayOfMonth: integer("expected_day_of_month"),
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
  /**
   * Sprint 8: display-only due-day-of-month (1-31), never used in any
   * calculation. Null means genuinely unknown — never guessed. See
   * `FixedExpense.dueDayOfMonth`'s doc comment.
   */
  dueDayOfMonth: integer("due_day_of_month"),
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
  // Sprint 9 (DEC-091): was global across all profiles until this column —
  // reconciliation must never compare/merge economic data cross-profile.
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
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

/**
 * Sprint 5 (DEC-059): full recommendation discovery/lifecycle persistence.
 * `identityKey` is the deterministic economic-opportunity identity (see
 * `Recommendation.identityKey`'s doc comment) — the unique constraint below
 * is what makes generation idempotent at the database level, mirroring
 * DEC-023's `ProviderConnection` uniqueness pattern. `evidenceTransactionIds`
 * and `decisionHistory` are JSON-encoded text, following the existing
 * `SyncRun.errors`/`AIRequestLog.toolNames` convention (never a raw
 * provider payload — see docs/RECOMMENDATIONS.md, "Evidence").
 */
export const recommendations = pgTable(
  "recommendations",
  {
    id: text("id").primaryKey(),
    financialProfileId: text("financial_profile_id")
      .notNull()
      .references(() => financialProfiles.id),
    type: text("type").$type<RecommendationType>().notNull(),
    identityKey: text("identity_key").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    evidenceNormalizedMerchant: text("evidence_normalized_merchant").notNull(),
    evidenceCategory: text("evidence_category"),
    evidenceCadence: text("evidence_cadence").$type<RecurrenceCadence>().notNull(),
    evidenceObservedAmountCents: integer("evidence_observed_amount_cents").notNull(),
    evidenceMonthlyEquivalentAmountCents: integer("evidence_monthly_equivalent_amount_cents"),
    evidenceOccurrences: integer("evidence_occurrences").notNull(),
    /** JSON-encoded `Id<"transaction">[]`. */
    evidenceTransactionIds: text("evidence_transaction_ids").notNull(),
    evidencePaymentSourceId: text("evidence_payment_source_id"),
    evidenceConfidence: text("evidence_confidence").$type<RecurringCandidateConfidence>().notNull(),
    projectedMonthlyImpactCents: integer("projected_monthly_impact_cents").notNull(),
    projectedAnnualImpactCents: integer("projected_annual_impact_cents").notNull(),
    status: text("status").$type<RecommendationStatus>().notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    userTargetAmountCents: integer("user_target_amount_cents"),
    effectiveDate: text("effective_date"),
    rejectionReason: text("rejection_reason"),
    lastVerificationAssessment: text("last_verification_assessment").$type<VerificationAssessment>(),
    lastVerificationCheckedAt: text("last_verification_checked_at"),
    /** JSON-encoded `RecommendationDecisionEvent[]` — append-only, never rewritten in place. */
    decisionHistory: text("decision_history").notNull(),
    supersedesRecommendationId: text("supersedes_recommendation_id"),
  },
  (table) => [unique().on(table.financialProfileId, table.identityKey)],
);

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
  // DEC-130.
  reservedBalanceCertainty: text("reserved_balance_certainty").$type<Certainty>(),
  reservedBalanceCents: integer("reserved_balance_cents"),
  automaticallyInvestedBalanceCertainty: text("automatically_invested_balance_certainty").$type<Certainty>(),
  automaticallyInvestedBalanceCents: integer("automatically_invested_balance_cents"),
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
/**
 * Sprint 4: the AI copilot's own conversation history. Money Copilot owns
 * this — no AI provider's hosted state is ever the source of truth (see
 * `docs/AI-COPILOT.md`, "No provider-locked conversation memory").
 */
export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  title: text("title"),
  status: text("status").$type<ConversationStatus>().notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const conversationMessages = pgTable("conversation_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: text("role").$type<MessageRole>().notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Audit trail of every tool the AI invoked. `argumentsJson` holds the
 * ALREADY-VALIDATED arguments, never raw unchecked model output.
 * `resultSummaryJson` is a small structured reference, never a full raw
 * tool/provider payload — see NON-NEGOTIABLE (Sprint 4): "avoid storing
 * massive raw tool responses where a structured audit reference
 * suffices." Never stores provider secrets.
 */
export const aiToolExecutions = pgTable("ai_tool_executions", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  requestMessageId: text("request_message_id")
    .notNull()
    .references(() => conversationMessages.id),
  toolName: text("tool_name").notNull(),
  argumentsJson: text("arguments_json").notNull(),
  status: text("status").$type<ToolExecutionStatus>().notNull(),
  resultSummaryJson: text("result_summary_json"),
  errorCategory: text("error_category"),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
});

/**
 * One AI provider call's observability record. Never logs the API key,
 * full banking payloads, or unnecessary financial history — see
 * NON-NEGOTIABLE (Sprint 4) "AI observability."
 */
export const aiRequests = pgTable("ai_requests", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversations.id),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  latencyMs: integer("latency_ms"),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  toolNames: text("tool_names"), // JSON-encoded string[]
  success: boolean("success").notNull(),
  errorCode: text("error_code"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  groundingStatus: text("grounding_status").$type<"PASSED" | "FAILED" | "NOT_APPLICABLE">(),
  providerResponseId: text("provider_response_id"),
});

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

/**
 * Sprint 6: records enough to answer "por que você me recomendou isso?"
 * and "esse orçamento ainda é válido?" — the exact envelope figures used
 * are captured at creation time so staleness can be detected later by
 * comparing against a freshly-computed envelope (see
 * `reevaluateConciergePlan`, docs/CONCIERGE.md, "Stale financial context").
 * `intentJson`/(on `saved_concierge_plans`) `planJson` are normalized
 * domain data, never a raw provider payload.
 */
export const conciergeSessions = pgTable("concierge_sessions", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  intentJson: text("intent_json").notNull(),
  envelopeRecommendedAmountCents: integer("envelope_recommended_amount_cents").notNull(),
  envelopeCautionAmountCents: integer("envelope_caution_amount_cents").notNull(),
  envelopeAsOfDate: text("envelope_as_of_date").notNull(),
  /**
   * JSON-encoded `OutingPlan[]` — every plan this session proposed, so
   * `saveConciergePlan(sessionId, planId)` can look one up by id without
   * requiring the LLM to echo back a complex nested object it received
   * earlier (unreliable tool-calling ergonomics) — it only ever needs to
   * pass back the short id string from the prior `buildConciergePlans`
   * tool result.
   */
  plansJson: text("plans_json").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Saving a plan is intent, never spending — no `financial_transactions`
 * row is ever created here (see docs/CONCIERGE.md, "Plan vs. actual
 * spending"). `planId` (the `OutingPlan`'s own id) is unique per profile so
 * saving the identical already-returned plan twice never duplicates a row.
 */
export const savedConciergePlans = pgTable(
  "saved_concierge_plans",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => conciergeSessions.id),
    financialProfileId: text("financial_profile_id")
      .notNull()
      .references(() => financialProfiles.id),
    planId: text("plan_id").notNull(),
    planJson: text("plan_json").notNull(),
    status: text("status").$type<"SELECTED">().notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [unique().on(table.financialProfileId, table.planId)],
);

/**
 * Sprint 7: like `concierge_sessions`/`saved_concierge_plans`, `Alert` is an
 * APPLICATION-layer type (`packages/app-services/src/alerts/types.ts`), not
 * a `financial-engine` domain type — its `relatedEntityType`/
 * `relatedEntityId` can point at an app-services-only concept (a saved
 * concierge plan), so persistence works with a plain JSON-blob row shape
 * here too, exactly like DEC-068. No unique constraint on `identityKey`:
 * unlike a `Recommendation`, an alert IDENTITY can have more than one
 * historical EPISODE over time (an old one RESOLVED, at most one other
 * non-terminal) — the app-service layer decides reuse-vs-new-episode by
 * querying the most recent row for a given `identityKey`, not by relying on
 * a DB constraint. See docs/ALERTS-NOTIFICATIONS.md, "Episode identity."
 */
export const alerts = pgTable("alerts", {
  id: text("id").primaryKey(),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  type: text("type").notNull(),
  status: text("status").notNull(),
  severity: text("severity").notNull(),
  identityKey: text("identity_key").notNull(),
  title: text("title").notNull(),
  reasonCode: text("reason_code").notNull(),
  createdAt: text("created_at").notNull(),
  firstTriggeredAt: text("first_triggered_at").notNull(),
  lastTriggeredAt: text("last_triggered_at").notNull(),
  resolvedAt: text("resolved_at"),
  seenAt: text("seen_at"),
  dismissedAt: text("dismissed_at"),
  /** JSON-encoded, per-type plain object — see `AlertEvidence`. Never a raw provider/AI payload. */
  evidenceJson: text("evidence_json").notNull(),
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: text("related_entity_id"),
  policyVersion: integer("policy_version").notNull(),
  /** JSON-encoded `AlertTransitionEvent[]` — append-only, mirrors `Recommendation.decisionHistory`. */
  transitionsJson: text("transitions_json").notNull(),
});

/**
 * One row per profile — the deterministic baseline Safe-to-Spend/liquidity
 * change detection compares against. See docs/ALERTS-NOTIFICATIONS.md,
 * "Baseline/checkpoint storage" / "Bootstrap semantics." Deliberately
 * minimal: only what a comparison needs, never a duplicate full snapshot.
 */
export const alertEvaluationCheckpoints = pgTable(
  "alert_evaluation_checkpoints",
  {
    id: text("id").primaryKey(),
    financialProfileId: text("financial_profile_id")
      .notNull()
      .references(() => financialProfiles.id),
    safeToSpendCents: integer("safe_to_spend_cents").notNull(),
    liquidityAwareSafeToSpendCents: integer("liquidity_aware_safe_to_spend_cents"),
    liquidityCoverage: text("liquidity_coverage").$type<LiquidityCoverage>().notNull(),
    /** The baseline value a currently-ACTIVE SAFE_TO_SPEND_MATERIAL_DROP episode was first triggered against — null when no such episode is active. Used for `hasSafeToSpendRecovered`'s hysteresis check, kept separate from the live-fluctuating `safeToSpendCents` above. */
    activeDropEpisodeBaselineCents: integer("active_drop_episode_baseline_cents"),
    evaluatedAt: text("evaluated_at").notNull(),
    policyVersion: integer("policy_version").notNull(),
  },
  (table) => [unique().on(table.financialProfileId)],
);

/**
 * One row per profile — Sprint 7 in-app notification preferences. Minimal
 * V1 shape per-category booleans plus quiet hours/privacy — architected so
 * a future channel (push/email) or delivery-frequency setting can be added
 * as new columns, never a schema replacement. See docs/ALERTS-
 * NOTIFICATIONS.md, "Notification preferences."
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: text("id").primaryKey(),
    financialProfileId: text("financial_profile_id")
      .notNull()
      .references(() => financialProfiles.id),
    inAppEnabled: boolean("in_app_enabled").notNull().default(true),
    financialChangeEnabled: boolean("financial_change_enabled").notNull().default(true),
    plannedEventsEnabled: boolean("planned_events_enabled").notNull().default(true),
    recommendationsEnabled: boolean("recommendations_enabled").notNull().default(true),
    connectionHealthEnabled: boolean("connection_health_enabled").notNull().default(true),
    conciergeEnabled: boolean("concierge_enabled").notNull().default(true),
    /** "HH:MM" 24h local strings; both null means no quiet hours configured. */
    quietHoursStart: text("quiet_hours_start"),
    quietHoursEnd: text("quiet_hours_end"),
    privacyMode: text("privacy_mode").$type<"GENERIC" | "AMOUNT_ALLOWED">().notNull().default("AMOUNT_ALLOWED"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [unique().on(table.financialProfileId)],
);

/**
 * One row per delivery ATTEMPT of one alert through one channel — never a
 * full re-render of the notification content (that's derived at delivery
 * time from the `Alert` row itself). See docs/ALERTS-NOTIFICATIONS.md,
 * "Notification delivery model."
 */
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: text("id").primaryKey(),
  alertId: text("alert_id")
    .notNull()
    .references(() => alerts.id),
  financialProfileId: text("financial_profile_id")
    .notNull()
    .references(() => financialProfiles.id),
  channel: text("channel").notNull(),
  status: text("status").$type<"PENDING" | "DELIVERED" | "FAILED" | "SUPPRESSED">().notNull(),
  attemptedAt: text("attempted_at").notNull(),
  deliveredAt: text("delivered_at"),
  failureReasonCode: text("failure_reason_code"),
});
