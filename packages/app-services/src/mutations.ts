import { createId, type Id } from "@money-copilot/shared";
import {
  categorize,
  normalizeMerchant,
  type Certainty,
  type FinancialEvent,
  type FinancialEventLineItem,
  type FinancialTransaction,
  type FixedExpense,
  type Income,
  type Money,
  type PaymentSource,
} from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";

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
}

/**
 * Records a manually-reported expense. Deterministically categorizes it
 * through the SAME `categorize`/`normalizeMerchant` rules a provider import
 * uses — the AI never assigns the category itself. Because this is a
 * normal `FinancialTransaction` with `origin: "MANUAL"`, it automatically
 * flows through the existing snapshot math (`getFinancialSnapshot`,
 * `getSafeToSpend`) on the very next read, and remains reconcilable
 * against a later-imported equivalent provider transaction via the
 * existing `findTransactionDuplicates` reconciliation pass (Sprint 2/3) —
 * no new dedup logic needed.
 */
export async function recordManualTransaction(
  db: Database,
  financialProfileId: string,
  input: RecordManualTransactionInput,
): Promise<FinancialTransaction> {
  const { categoryRules, merchantRules } = await repo.loadRules(db);
  const paymentSource = await resolveManualPaymentSource(db, financialProfileId, input.paymentSourceLabel);
  const normalizedMerchant = normalizeMerchant(input.merchantOrDescription, merchantRules);

  const draft: FinancialTransaction = {
    id: createId("transaction"),
    financialProfileId: financialProfileId as Id<"financial-profile">,
    paymentSource,
    date: input.date,
    amount: input.amount,
    direction: "DEBIT",
    rawDescription: input.merchantOrDescription,
    normalizedDescription: input.merchantOrDescription,
    rawMerchant: input.merchantOrDescription,
    ...(normalizedMerchant ? { normalizedMerchant } : {}),
    status: "POSTED",
    certainty: input.certainty ?? "ACTUAL",
    financialEffect: "CONSUMPTION",
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
