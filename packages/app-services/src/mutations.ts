import { createId, type Id } from "@money-copilot/shared";
import {
  categorize,
  defaultDirectionForManualEntry,
  normalizeMerchant,
  ruleMatchesTransaction,
  type CategoryRule,
  type CategoryRuleMatchType,
  type CategoryRuleOrigin,
  type Certainty,
  type FinancialEvent,
  type FinancialEventLineItem,
  type FinancialTransaction,
  type FixedExpense,
  type Income,
  type IncomeSource,
  type ManualEntryFinancialEffect,
  type Money,
  type PaymentSource,
  type RecurringExpenseCandidate,
} from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";
import { assertOwnedByProfile, ResourceNotFoundError } from "./ownership";

/**
 * State-changing application services. Every function here PERSISTS a
 * change — see docs/AI-COPILOT.md, "Explicit mutation policy": the AI
 * copilot tool loop must only invoke these when the user's own message
 * contains explicit action intent (e.g. "I just spent...", "Reserve
 * R$1,200 for the beach"), never for hypothetical/exploratory phrasing
 * ("What if I spent...", "How much should I reserve...").
 */

function nowIso(): string {
  return new Date().toISOString();
}

const MANUAL_PAYMENT_SOURCE_LABEL = "Manual entry";

/**
 * Finds (or lazily creates) a manually-entered `PaymentSource` for this
 * profile. Never fabricates a specific bank/card the user didn't mention —
 * when no `paymentSourceLabel` is supplied, everything falls under one
 * generic "Manual entry" source rather than guessing which real account
 * was used.
 */
async function resolveManualPaymentSource(
  db: Database,
  financialProfileId: string,
  paymentSourceLabel?: string,
): Promise<PaymentSource> {
  const targetLabel = paymentSourceLabel?.trim() || MANUAL_PAYMENT_SOURCE_LABEL;
  const existing = await repo.listPaymentSourcesForProfile(db, financialProfileId);
  const found = existing.find(
    (p) => p.provider === undefined && p.label.toLowerCase() === targetLabel.toLowerCase(),
  );
  if (found) return found;

  const created: PaymentSource = {
    id: createId("payment-source"),
    label: targetLabel,
    type: "OTHER",
  };
  await repo.upsertPaymentSource(db, created, financialProfileId);
  return created;
}

export interface RecordManualTransactionInput {
  readonly amount: Money;
  readonly merchantOrDescription: string;
  /** ISO 8601 date. Defaults to today (the conversation's asOfDate) when not stated explicitly. */
  readonly date: string;
  /** "I just spent" is an already-happened fact — defaults to ACTUAL. Never UNKNOWN (an amount is always known when the user reports a manual spend). */
  readonly certainty?: Exclude<Certainty, "UNKNOWN">;
  /** Never fabricated when the user didn't say how they paid. */
  readonly paymentSourceLabel?: string;
  /**
   * DEC-132: the caller (UI form or the AI copilot, having parsed the
   * user's own words) declares what kind of money movement this is —
   * defaults to `CONSUMPTION` (the historical, only behavior). This is
   * classification-by-explicit-declaration, not keyword-guessing: a
   * "Transferi 2 mil do Itaú para o Nubank" statement must be classified
   * TRANSFER by whoever parsed that sentence, never silently recorded as a
   * purchase. See `ManualEntryFinancialEffect`'s own doc comment for why
   * CARD_PAYMENT/DEBT_PAYMENT/INCOME are deliberately excluded here.
   */
  readonly financialEffect?: ManualEntryFinancialEffect;
}

/**
 * Records a manually-reported transaction. Deterministically categorizes it
 * through the SAME `categorize`/`normalizeMerchant` rules a provider import
 * uses — the AI never assigns the category itself. Because this is a
 * normal `FinancialTransaction` with `origin: "MANUAL"`, it automatically
 * flows through the existing snapshot math (`getFinancialSnapshot`,
 * `getSafeToSpend`) on the very next read, and remains reconcilable
 * against a later-imported equivalent provider transaction via the
 * existing `findTransactionDuplicates` reconciliation pass (Sprint 2/3) —
 * no new dedup logic needed. `direction` is ALWAYS derived from
 * `financialEffect` (`defaultDirectionForManualEntry`), never independently
 * guessed — see DEC-132.
 */
export async function recordManualTransaction(
  db: Database,
  financialProfileId: string,
  input: RecordManualTransactionInput,
): Promise<FinancialTransaction> {
  const { categoryRules, merchantRules } = await repo.loadRules(db, financialProfileId);
  const paymentSource = await resolveManualPaymentSource(db, financialProfileId, input.paymentSourceLabel);
  const normalizedMerchant = normalizeMerchant(input.merchantOrDescription, merchantRules);
  const financialEffect = input.financialEffect ?? "CONSUMPTION";

  const draft: FinancialTransaction = {
    id: createId("transaction"),
    financialProfileId: financialProfileId as Id<"financial-profile">,
    paymentSource,
    date: input.date,
    amount: input.amount,
    direction: defaultDirectionForManualEntry(financialEffect),
    rawDescription: input.merchantOrDescription,
    normalizedDescription: input.merchantOrDescription,
    rawMerchant: input.merchantOrDescription,
    ...(normalizedMerchant ? { normalizedMerchant } : {}),
    status: "POSTED",
    certainty: input.certainty ?? "ACTUAL",
    financialEffect,
    category: null,
    origin: "MANUAL",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  const { category, subcategory } = categorize(draft, categoryRules);
  const finalTransaction: FinancialTransaction = {
    ...draft,
    category,
    ...(subcategory !== undefined ? { subcategory } : {}),
  };

  await repo.upsertTransaction(db, finalTransaction);
  return finalTransaction;
}

const BUDGET_LINE_ITEM_LABEL = "Budget";

export interface CreatePlannedFinancialEventInput {
  readonly label: string;
  readonly startDate: string;
  readonly endDate: string;
  /** Omit when the budget is not yet known — creates the event with an honest UNKNOWN line item rather than inventing a number. */
  readonly budgetAmount?: Money;
  readonly budgetCertainty?: Exclude<Certainty, "UNKNOWN">;
}

/**
 * Creates a new planned event (e.g. a trip). When `budgetAmount` is
 * omitted, the event is created with an UNKNOWN-certainty line item — see
 * NON-NEGOTIABLE (Sprint 4): never invent a budget; Safe-to-Spend
 * confidence is reduced by the existing snapshot logic until a real
 * budget is provided via `updatePlannedFinancialEvent`.
 */
export async function createPlannedFinancialEvent(
  db: Database,
  financialProfileId: string,
  input: CreatePlannedFinancialEventInput,
): Promise<FinancialEvent> {
  const budgetLineItem: FinancialEventLineItem =
    input.budgetAmount !== undefined
      ? {
          id: createId("event-line-item"),
          label: BUDGET_LINE_ITEM_LABEL,
          amount: input.budgetAmount,
          certainty: input.budgetCertainty ?? "CONFIRMED",
          status: "PLANNED",
        }
      : {
          id: createId("event-line-item"),
          label: BUDGET_LINE_ITEM_LABEL,
          amount: null,
          certainty: "UNKNOWN",
          status: "PLANNED",
        };

  const event: FinancialEvent = {
    id: createId("financial-event"),
    label: input.label,
    startDate: input.startDate,
    endDate: input.endDate,
    lineItems: [budgetLineItem],
  };

  await repo.upsertEvent(db, event, financialProfileId);
  return event;
}

export interface CreateFixedExpenseInput {
  readonly label: string;
  readonly category: string;
  readonly amount: Money;
  readonly certainty?: Certainty;
  /** Never a fabricated protection — defaults to false (a normal, reducible commitment). */
  readonly protected?: boolean;
  /** Day of month (1-31), when actually known — never guessed. See `FixedExpense.dueDayOfMonth`. */
  readonly dueDayOfMonth?: number;
  /** DEC-132: see `FixedExpense.source`'s own doc comment. Defaults to `USER_DECLARED` when the caller doesn't specify one — a copilot/UI flow confirming a `RecurringExpenseCandidate` should pass `USER_CONFIRMED_HISTORY` explicitly. */
  readonly source?: IncomeSource;
}

/**
 * Creates a new recurring monthly commitment (e.g. rent, a subscription).
 * Mirrors `createPlannedFinancialEvent`'s shape for the one-off case —
 * same file, same mutation-policy discipline (see this file's own
 * top-of-file doc comment), same persistence primitive
 * (`repo.upsertFixedExpense`) `seed.ts` already uses for fixture data. Every
 * fixed expense is treated as committed for the current month regardless of
 * `dueDayOfMonth` (display-only — see `FixedExpense`'s own doc comment);
 * there is no notion of "starts next month" here.
 */
export async function createFixedExpense(
  db: Database,
  financialProfileId: string,
  input: CreateFixedExpenseInput,
): Promise<FixedExpense> {
  const expense: FixedExpense = {
    id: createId("fixed-expense"),
    label: input.label,
    category: input.category,
    amount: input.amount,
    certainty: input.certainty ?? "CONFIRMED",
    protected: input.protected ?? false,
    ...(input.dueDayOfMonth !== undefined ? { dueDayOfMonth: input.dueDayOfMonth } : {}),
    source: input.source ?? "USER_DECLARED",
  };

  await repo.upsertFixedExpense(db, expense, financialProfileId);
  return expense;
}

export interface CreateIncomeInput {
  readonly label: string;
  /** Gross monthly amount, before taxes — must come from the user's own explicit confirmation, never inferred from a transaction. */
  readonly grossAmount: Money;
  readonly certainty?: Certainty;
  /** Whether this recurs monthly. An explicit declared income defaults to recurring — see `Income.recurring`'s own doc comment. */
  readonly recurring?: boolean;
  /**
   * DEC-130: where this knowledge came from — see `IncomeSource`. Defaults
   * to `USER_DECLARED` (a direct statement) when the caller doesn't specify
   * one; a copilot flow confirming a `RecurringExpenseCandidate` should
   * pass `HISTORY_INFERRED` or `USER_CONFIRMED_HISTORY` explicitly.
   */
  readonly source?: IncomeSource;
  /** DEC-130: day of the month (1-31) this income is typically received, when known — see `Income.expectedDayOfMonth`. */
  readonly expectedDayOfMonth?: number;
}

/**
 * Declares a confirmed recurring/expected income (Sprint 9, DEC-127) —
 * mirrors `createFixedExpense`'s shape exactly (same file, same
 * mutation-policy discipline, same `repo.upsert*` primitive). This is the
 * ONLY way an `Income` row is ever created outside of `seed.ts` fixture
 * data — in particular, `syncConnection` importing a real bank transaction
 * (even one tagged `financialEffect: "INCOME"`) never calls this. A real
 * transaction is evidence a human can be asked to confirm
 * (`getRecurringIncomeCandidates`); it is never itself a declaration.
 */
export async function createIncome(
  db: Database,
  financialProfileId: string,
  input: CreateIncomeInput,
): Promise<Income> {
  const income: Income = {
    id: createId("income"),
    label: input.label,
    grossAmount: input.grossAmount,
    certainty: input.certainty ?? "CONFIRMED",
    recurring: input.recurring ?? true,
    source: input.source ?? "USER_DECLARED",
    ...(input.expectedDayOfMonth !== undefined ? { expectedDayOfMonth: input.expectedDayOfMonth } : {}),
  };

  await repo.upsertIncome(db, income, financialProfileId);
  return income;
}

export interface UpdateIncomeInput {
  /** Obtained from a prior read (e.g. the profile's snapshot income list) — never guessed. */
  readonly incomeId: string;
  readonly label?: string;
  readonly grossAmount?: Money;
  readonly certainty?: Certainty;
  readonly recurring?: boolean;
  /** DEC-130: never silently changed by history alone — only ever set via an explicit caller-supplied value (see `Income.source`'s own doc comment on conflicting history). */
  readonly source?: IncomeSource;
  readonly expectedDayOfMonth?: number;
}

/**
 * Updates an existing declared `Income` — e.g. a raise, or correcting a
 * mistaken entry. Mirrors `updatePlannedFinancialEvent`'s exact
 * lookup-by-id-via-snapshot-input pattern (the same architectural
 * justification applies: `Income` has no dedicated single-row getter, and
 * `loadFinancialSnapshotInput` already loads every income for the
 * profile). Only the fields supplied are changed.
 */
export async function updateIncome(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  input: UpdateIncomeInput,
): Promise<Income> {
  const snapshotInput = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const existing = snapshotInput.income.find((i) => i.id === input.incomeId);
  if (!existing) {
    throw new Error(`No Income ${input.incomeId} found for profile ${financialProfileId}`);
  }

  const updated: Income = {
    ...existing,
    ...(input.label ? { label: input.label } : {}),
    ...(input.grossAmount !== undefined ? { grossAmount: input.grossAmount } : {}),
    ...(input.certainty ? { certainty: input.certainty } : {}),
    ...(input.recurring !== undefined ? { recurring: input.recurring } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.expectedDayOfMonth !== undefined ? { expectedDayOfMonth: input.expectedDayOfMonth } : {}),
  };

  await repo.upsertIncome(db, updated, financialProfileId);
  return updated;
}

export interface UpdatePlannedFinancialEventInput {
  /** Obtained from a prior `getUpcomingFinancialEvents` call — never guessed/fuzzy-matched by the AI. */
  readonly eventId: string;
  /**
   * Which line item to update. Optional when the event has an
   * unambiguous single budget slot to fill (the common "Reserve R$X for
   * the trip" case) — see `resolveBudgetLineItemId`. Required (and must
   * be supplied by the caller from a prior `getUpcomingFinancialEvents`
   * read) when the event has multiple PLANNED line items, since guessing
   * which one the user meant would not be deterministic.
   */
  readonly lineItemId?: string;
  readonly budgetAmount?: Money;
  readonly budgetCertainty?: Exclude<Certainty, "UNKNOWN">;
  readonly label?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

/**
 * Deterministically identifies which line item a budget update applies to,
 * without any fuzzy/string-label matching. Prefers an explicit
 * `lineItemId`; otherwise requires exactly one unambiguous PLANNED line
 * item (preferring an UNKNOWN one — the common "budget not yet set" case)
 * and throws rather than guess when the event has more than one.
 */
function resolveBudgetLineItemId(event: FinancialEvent, explicitLineItemId?: string): string {
  if (explicitLineItemId !== undefined) {
    const found = event.lineItems.find((li) => li.id === explicitLineItemId);
    if (!found) {
      throw new Error(`Event ${event.id} has no line item ${explicitLineItemId}`);
    }
    return found.id;
  }

  const planned = event.lineItems.filter((li) => li.status === "PLANNED");
  const unknownPlanned = planned.filter((li) => li.certainty === "UNKNOWN");
  if (unknownPlanned.length === 1) return unknownPlanned[0]!.id;
  if (planned.length === 1) return planned[0]!.id;

  throw new Error(
    `Event ${event.id} has ${planned.length} planned line items — an explicit lineItemId is required to update its budget unambiguously.`,
  );
}

/**
 * Updates an existing planned event, most commonly to set a previously
 * UNKNOWN budget (e.g. "Reserve R$1,200 for the beach trip"). Only the
 * fields supplied are changed; everything else is left exactly as it was.
 */
export async function updatePlannedFinancialEvent(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  input: UpdatePlannedFinancialEventInput,
): Promise<FinancialEvent> {
  const snapshotInput = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const existing = snapshotInput.events.find((e) => e.id === input.eventId);
  if (!existing) {
    throw new Error(`No FinancialEvent ${input.eventId} found for profile ${financialProfileId}`);
  }

  const newBudgetAmount = input.budgetAmount;
  const lineItems =
    newBudgetAmount !== undefined
      ? (() => {
          const targetId = resolveBudgetLineItemId(existing, input.lineItemId);
          return existing.lineItems.map((item) =>
            item.id === targetId
              ? { ...item, amount: newBudgetAmount, certainty: input.budgetCertainty ?? "CONFIRMED" }
              : item,
          );
        })()
      : existing.lineItems;

  const updated: FinancialEvent = {
    ...existing,
    ...(input.label ? { label: input.label } : {}),
    ...(input.startDate ? { startDate: input.startDate } : {}),
    ...(input.endDate ? { endDate: input.endDate } : {}),
    lineItems,
  };

  await repo.upsertEvent(db, updated, financialProfileId);
  return updated;
}

// ---------- Category rules / learning (DEC-132) ----------

/**
 * Priority given to a rule created from an explicit user action (a
 * one-time correction turned "always," or direct manual rule creation) —
 * deliberately higher than every `fixtures/rules.ts` `SYSTEM_DEFAULT` rule
 * (priority 100), so an explicit user decision always wins if a future
 * system-default rule is ever added for the same pattern.
 */
const USER_RULE_PRIORITY = 200;

export interface CreateCategoryRuleInput {
  readonly matchType: CategoryRuleMatchType;
  readonly pattern: string;
  readonly category: string;
  readonly subcategory?: string;
  readonly priority?: number;
  /** Always a personal-override origin — see `createCategoryRule`'s own doc comment for why `SYSTEM_DEFAULT` can never be passed here. */
  readonly origin?: Exclude<CategoryRuleOrigin, "SYSTEM_DEFAULT">;
}

/**
 * DEC-133: creates or UPDATES a PERSONAL (profile-scoped) categorization
 * rule — Planning's "Regras e categorias" manual creation, the AI
 * copilot's equivalent tool, and `categorizeTransaction`'s "all past and
 * future" path all funnel through this ONE function, so there is exactly
 * one rule-creation/update code path regardless of how the rule was
 * authored. Can NEVER create/touch a global `SYSTEM_DEFAULT` rule — "users
 * do not edit the global default itself; if they disagree, they create a
 * personal override" (DEC-133). Uses `repo.upsertPersonalCategoryRule`'s
 * conflict-safe upsert on `(financialProfileId, matchType, pattern)` — a
 * second correction for the same merchant UPDATES the existing personal
 * rule rather than creating a duplicate.
 */
export async function createCategoryRule(
  db: Database,
  financialProfileId: string,
  input: CreateCategoryRuleInput,
): Promise<CategoryRule> {
  const rule: CategoryRule = {
    id: createId("category-rule"),
    matchType: input.matchType,
    pattern: input.pattern,
    category: input.category,
    ...(input.subcategory !== undefined ? { subcategory: input.subcategory } : {}),
    priority: input.priority ?? USER_RULE_PRIORITY,
    origin: input.origin ?? "USER_DECLARED",
    financialProfileId: financialProfileId as Id<"financial-profile">,
  };
  return repo.upsertPersonalCategoryRule(db, rule);
}

/**
 * DEC-133: deletes a rule ONLY when it is a personal rule OWNED by this
 * profile — never a global `SYSTEM_DEFAULT` (immutable through every user
 * flow) and never another profile's personal rule. Silently no-ops for
 * anything else, matching `assertOwnedByProfile`'s "never leak whether
 * another user's resource exists" posture rather than throwing a
 * distinguishable error.
 */
export async function deleteCategoryRule(db: Database, financialProfileId: string, id: string): Promise<void> {
  const rule = await repo.getCategoryRuleById(db, id);
  if (!rule || rule.origin === "SYSTEM_DEFAULT" || rule.financialProfileId !== financialProfileId) {
    return;
  }
  await repo.deleteCategoryRule(db, id);
}

export interface CategorizeTransactionInput {
  readonly transactionId: string;
  readonly category: string;
  readonly subcategory?: string;
  /**
   * When true, ALSO creates/updates a durable PERSONAL `CategoryRule`
   * (origin `USER_DECLARED`) so every matching transaction — past AND
   * future — uses it automatically ("Todas, passadas e futuras" in the UI).
   * Defaults to false ("Só esta"): a one-time correction changes only this
   * transaction and never creates a rule or touches any other transaction.
   */
  readonly alwaysForMerchant?: boolean;
}

export interface CategorizeTransactionResult {
  readonly transaction: FinancialTransaction;
  readonly createdRule?: CategoryRule;
  /**
   * How many OTHER historical transactions for this profile were
   * reclassified to the new category because they matched the same rule —
   * always 0 when `alwaysForMerchant` is false/omitted.
   */
  readonly retroactivelyReclassifiedCount: number;
}

/**
 * Resolves a pending "what was this?" classification question
 * (`queries.getPendingConfirmations`'s `UNCATEGORIZED_TRANSACTION` items) —
 * or any other manual re-categorization. Deliberately touches ONLY
 * `category`/`subcategory`, never `financialEffect` or `amount` — a
 * TRANSFER, CARD_PAYMENT, INVESTMENT, or INVESTMENT_REDEMPTION transaction
 * can be given a display category without ever being reinterpreted as
 * ordinary consumption or a different financial truth (DEC-132/133 safety
 * rule: financial effect is decided before, and independently of,
 * category — a retroactive category change is never a retroactive
 * financial-effect change).
 *
 * DEC-133 "all past and future": when `alwaysForMerchant` is true, this
 * ALSO retroactively reclassifies every OTHER historical transaction for
 * THIS profile that the new personal rule matches — using
 * `ruleMatchesTransaction`, the EXACT SAME matcher `categorize` itself
 * uses (never a separate substring heuristic), scoped to this profile's
 * own transactions only (`repo.loadFinancialSnapshotInput` is already
 * profile-scoped — never touches another user's data).
 */
export async function categorizeTransaction(
  db: Database,
  financialProfileId: string,
  input: CategorizeTransactionInput,
): Promise<CategorizeTransactionResult> {
  const transaction = assertOwnedByProfile(
    await repo.getTransactionById(db, input.transactionId),
    financialProfileId,
    `transaction ${input.transactionId}`,
  );

  const updatedTransaction: FinancialTransaction = {
    ...transaction,
    category: input.category,
    ...(input.subcategory !== undefined ? { subcategory: input.subcategory } : {}),
  };
  await repo.upsertTransaction(db, updatedTransaction);

  if (!input.alwaysForMerchant) {
    return { transaction: updatedTransaction, retroactivelyReclassifiedCount: 0 };
  }

  const matchType: CategoryRuleMatchType = transaction.normalizedMerchant
    ? "CONTAINS_MERCHANT"
    : "CONTAINS_DESCRIPTION";
  const pattern =
    transaction.normalizedMerchant ?? (transaction.normalizedDescription || transaction.rawDescription);
  const createdRule = await createCategoryRule(db, financialProfileId, {
    matchType,
    pattern,
    category: input.category,
    ...(input.subcategory !== undefined ? { subcategory: input.subcategory } : {}),
  });

  const { transactions } = await repo.loadFinancialSnapshotInput(db, financialProfileId, nowIso().slice(0, 10));
  const matchingHistorical = transactions.filter(
    (t) => t.id !== updatedTransaction.id && ruleMatchesTransaction(createdRule, t),
  );
  for (const t of matchingHistorical) {
    await repo.upsertTransaction(db, {
      ...t,
      category: input.category,
      ...(input.subcategory !== undefined ? { subcategory: input.subcategory } : {}),
    });
  }

  return {
    transaction: updatedTransaction,
    createdRule,
    retroactivelyReclassifiedCount: matchingHistorical.length,
  };
}

// ---------- Recurring candidate confirmation (DEC-132) ----------

async function requireOwnedRecurringCandidate(
  db: Database,
  financialProfileId: string,
  candidateId: string,
  kind: "INCOME" | "FIXED_EXPENSE",
): Promise<RecurringExpenseCandidate> {
  const candidates = await repo.listRecurringCandidatesForProfile(db, financialProfileId, kind);
  const found = candidates.find((c) => c.id === candidateId);
  if (!found) {
    throw new ResourceNotFoundError(`recurring ${kind.toLowerCase()} candidate ${candidateId}`);
  }
  return found;
}

export interface ConfirmRecurringIncomeCandidateInput {
  /** Obtained from a prior `getPendingConfirmations`/`getRecurringIncomeCandidates` read — never guessed. */
  readonly candidateId: string;
  readonly label: string;
  readonly expectedDayOfMonth?: number;
}

/**
 * Converts a still-pending income recurrence candidate into real planning
 * knowledge — creates an `Income` via the SAME `createIncome` canonical
 * mutation manual/AI declaration uses, with `source: "USER_CONFIRMED_HISTORY"`
 * (DEC-130: inferred from history AND explicitly confirmed — never silently
 * treated as a bare `USER_DECLARED` statement). The candidate itself is
 * marked CONFIRMED so `detectRecurringCandidates` never re-surfaces it as a
 * fresh pending question (DEC-132 fix, `recurring.ts`).
 */
export async function confirmRecurringIncomeCandidate(
  db: Database,
  financialProfileId: string,
  input: ConfirmRecurringIncomeCandidateInput,
): Promise<Income> {
  const candidate = await requireOwnedRecurringCandidate(db, financialProfileId, input.candidateId, "INCOME");
  const income = await createIncome(db, financialProfileId, {
    label: input.label,
    grossAmount: candidate.evidence.averageAmount,
    certainty: "ESTIMATED",
    recurring: true,
    source: "USER_CONFIRMED_HISTORY",
    ...(input.expectedDayOfMonth !== undefined ? { expectedDayOfMonth: input.expectedDayOfMonth } : {}),
  });
  await repo.updateRecurringCandidateStatus(db, candidate.id, "CONFIRMED");
  return income;
}

export interface ConfirmRecurringFixedExpenseCandidateInput {
  /** Obtained from a prior `getPendingConfirmations`/`getRecurringFixedExpenseCandidates` read — never guessed. */
  readonly candidateId: string;
  readonly label: string;
  /** A `RecurringExpenseCandidate` carries no category of its own — the confirming caller supplies it (from the transaction's own category, or the user's choice). */
  readonly category: string;
  readonly dueDayOfMonth?: number;
}

/**
 * Converts a still-pending fixed-expense recurrence candidate into real
 * planning knowledge — mirrors `confirmRecurringIncomeCandidate` exactly,
 * via the SAME `createFixedExpense` canonical mutation, with
 * `source: "USER_CONFIRMED_HISTORY"`.
 */
export async function confirmRecurringFixedExpenseCandidate(
  db: Database,
  financialProfileId: string,
  input: ConfirmRecurringFixedExpenseCandidateInput,
): Promise<FixedExpense> {
  const candidate = await requireOwnedRecurringCandidate(
    db,
    financialProfileId,
    input.candidateId,
    "FIXED_EXPENSE",
  );
  const expense = await createFixedExpense(db, financialProfileId, {
    label: input.label,
    category: input.category,
    amount: candidate.evidence.averageAmount,
    certainty: "ESTIMATED",
    source: "USER_CONFIRMED_HISTORY",
    ...(input.dueDayOfMonth !== undefined ? { dueDayOfMonth: input.dueDayOfMonth } : {}),
  });
  await repo.updateRecurringCandidateStatus(db, candidate.id, "CONFIRMED");
  return expense;
}

/**
 * Dismisses a pending recurring candidate without creating any planning
 * knowledge — `detectRecurringCandidates` suppresses its `evidenceKey` from
 * then on (DEC-132 fix, `recurring.ts`), so it does not immediately
 * reappear from the same evidence.
 */
export async function rejectRecurringCandidate(
  db: Database,
  financialProfileId: string,
  candidateId: string,
  kind: "INCOME" | "FIXED_EXPENSE",
): Promise<void> {
  await requireOwnedRecurringCandidate(db, financialProfileId, candidateId, kind);
  await repo.updateRecurringCandidateStatus(db, candidateId, "REJECTED");
}
