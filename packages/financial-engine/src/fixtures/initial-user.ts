import type { Id } from "@money-copilot/shared";
import * as M from "../money/index";
import { TAX_CATEGORY, type FixedExpense, type VariableBudget } from "../domain/expense";
import type { Income } from "../domain/income";
import type { FinancialEvent } from "../domain/event";
import type { FinancialGoal } from "../domain/goal";
import type { ProtectedPreference } from "../domain/preference";
import type { LifestyleScenario } from "../domain/scenario";
import type { InstallmentPlan } from "../domain/installment";
import { reconcileEventLineItems, findTransactionDuplicates, type ReconciliationLink } from "../domain/reconciliation";
import type { FinancialSnapshotInput } from "../snapshot/snapshot";
import { FIXTURE_PROFILE_ID } from "./profile";
import { septemberTransactions } from "./transactions";

/**
 * "Today" for the fixture. Chosen so the rodeo event has already partly
 * happened and the beach trip (Sept 25-27) is still upcoming within the
 * same month, matching the scenario described when this fixture was built.
 */
export const FIXTURE_AS_OF_DATE = "2026-09-05";

// Every id below is a stable string literal, never `createId()` — see
// `transactions.ts`'s comment and docs/DECISIONS.md DEC-047. `createId()`
// embeds `Date.now()`, so a fresh evaluation of this module (a dev-server
// restart, or Next.js instantiating separate module registries per
// RSC/Route-Handler "layer" — both observed in Sprint 4.5's live
// validation) produces DIFFERENT ids for "the same" fixture entity every
// time, which silently defeats `seed()`'s upsert-by-id idempotency and
// piles up duplicate rows (and duplicate warnings) on every restart.

export const pjRevenue: Income = {
  id: "income_fixture-pj-revenue" as Id<"income">,
  label: "PJ gross revenue",
  grossAmount: M.fromReais(15_000),
  certainty: "CONFIRMED",
  recurring: true,
  source: "USER_DECLARED",
};

const taxes: FixedExpense = {
  id: "fixed-expense_fixture-taxes" as Id<"fixed-expense">,
  label: "Monthly taxes",
  category: TAX_CATEGORY,
  amount: M.fromReais(870),
  certainty: "ACTUAL",
  protected: false,
};

const housing: FixedExpense = {
  id: "fixed-expense_fixture-housing" as Id<"fixed-expense">,
  label: "Rent + condominium",
  category: "Housing",
  amount: M.fromReais(1_600),
  certainty: "ACTUAL",
  protected: false,
};

/** Protected and non-negotiable — see NON-NEGOTIABLE RULE #6. */
export const motherSupport: FixedExpense = {
  id: "fixed-expense_fixture-mother-support" as Id<"fixed-expense">,
  label: "Support to mother",
  category: "Family Support",
  amount: M.fromReais(1_000),
  certainty: "ACTUAL",
  protected: true,
};

const carSubscription: FixedExpense = {
  id: "fixed-expense_fixture-car-subscription" as Id<"fixed-expense">,
  label: "Localiza / Fiat Pulse subscription",
  category: "Transportation",
  amount: M.fromReais(2_715),
  certainty: "ACTUAL",
  protected: false,
};

const lifeInsurance: FixedExpense = {
  id: "fixed-expense_fixture-life-insurance" as Id<"fixed-expense">,
  label: "Life insurance",
  category: "Insurance",
  amount: M.fromReais(360),
  certainty: "ACTUAL",
  protected: false,
};

const gym: FixedExpense = {
  id: "fixed-expense_fixture-gym" as Id<"fixed-expense">,
  label: "Gym",
  category: "Health",
  amount: M.fromReais(150),
  certainty: "ACTUAL",
  protected: false,
};

const footvolley: FixedExpense = {
  id: "fixed-expense_fixture-footvolley" as Id<"fixed-expense">,
  label: "Footvolley",
  category: "Health",
  amount: M.fromReais(155),
  certainty: "ACTUAL",
  protected: false,
};

/**
 * Sprint 2: the old credit-card-debt installment (~BRL 1,400/month) is no
 * longer a flat `FixedExpense` — it's modeled as an `InstallmentPlan` (see
 * `installmentPlans` below) so it's correctly classified as DEBT_PAYMENT,
 * not fresh consumption, and so its (currently unknown) remaining schedule
 * is represented honestly rather than guessed. See DEC-011.
 */
export const fixedExpenses: readonly FixedExpense[] = [
  taxes,
  housing,
  motherSupport,
  carSubscription,
  lifeInsurance,
  gym,
  footvolley,
];

const foodBudget: VariableBudget = {
  id: "variable-budget_fixture-food" as Id<"variable-budget">,
  label: "Food",
  category: "Food",
  targetAmount: M.fromReais(1_500),
  certainty: "ESTIMATED",
};

export const variableBudgets: readonly VariableBudget[] = [foodBudget];

/**
 * The existing card debt: a known monthly amount but an unknown
 * installment number/total — Sprint 3 may replace this estimate with the
 * real schedule once real bank data is available. Modeling it with
 * `installmentNumber`/`totalInstallments` as `null` (rather than guessing)
 * demonstrates handling incomplete installment data with real fixture
 * data, per RULE #9/#16/#17.
 */
export const oldCreditCardDebtPlan: InstallmentPlan = {
  id: "installment-plan_fixture-old-card-debt" as Id<"installment-plan">,
  financialProfileId: FIXTURE_PROFILE_ID,
  description: "Existing credit card bill installment",
  totalOriginalAmount: null,
  installmentAmount: M.fromReais(1_400),
  installmentNumber: null,
  totalInstallments: null,
  firstDueDate: null,
  certainty: "ESTIMATED",
  status: "ACTIVE",
};

export const installmentPlans: readonly InstallmentPlan[] = [oldCreditCardDebtPlan];

/**
 * Demonstrates RULE #4: Nubank is the payment rail, "Food" is the category.
 * Nubank's bill is never itself modeled as an expense category — its
 * underlying transactions (like these) are categorized individually via
 * deterministic rules (`fixtures/rules.ts`), not hand-assigned. See
 * `fixtures/transactions.ts` for the raw September transaction set,
 * including the rodeo ticket purchase that must reconcile with the rodeo
 * event's ALREADY_PAID line item below (never counted twice).
 */
export const transactions = septemberTransactions;

/**
 * Rodeo: the ticket has already been paid (counted once, as actual
 * spending — never reserved again). Transportation is a confirmed future
 * cost; drinks are an estimated future cost. The ticket amount also exists
 * as a raw transaction (`septemberTransactions`) — `reconciliationLinks`
 * below links the two so the snapshot counts it exactly once.
 */
const rodeo: FinancialEvent = {
  id: "financial-event_fixture-rodeo" as Id<"financial-event">,
  label: "Rodeo",
  startDate: "2026-09-04",
  endDate: "2026-09-04",
  lineItems: [
    {
      id: "event-line-item_fixture-rodeo-ticket" as Id<"event-line-item">,
      label: "Ticket",
      amount: M.fromReais(476.1),
      certainty: "ACTUAL",
      status: "ALREADY_PAID",
    },
    {
      id: "event-line-item_fixture-rodeo-transportation" as Id<"event-line-item">,
      label: "Transportation / van",
      amount: M.fromReais(100),
      certainty: "CONFIRMED",
      status: "PLANNED",
    },
    {
      id: "event-line-item_fixture-rodeo-drinks" as Id<"event-line-item">,
      label: "Drinks",
      amount: M.fromReais(150),
      certainty: "ESTIMATED",
      status: "PLANNED",
    },
  ],
};

/**
 * Beach trip: the event's existence is confirmed, but the budget is not
 * yet known. This must surface as a warning, never as an implicit zero —
 * see NON-NEGOTIABLE RULE #9.
 */
const beachTrip: FinancialEvent = {
  id: "financial-event_fixture-beach-trip" as Id<"financial-event">,
  label: "Beach trip (Sep 25-27)",
  startDate: "2026-09-25",
  endDate: "2026-09-27",
  lineItems: [
    {
      id: "event-line-item_fixture-beach-trip-budget" as Id<"event-line-item">,
      label: "Trip budget",
      amount: null,
      certainty: "UNKNOWN",
      status: "PLANNED",
    },
  ],
};

export const events: readonly FinancialEvent[] = [rodeo, beachTrip];

/**
 * Reconciliation links computed the same way a real pipeline would: the
 * rodeo ticket transaction is matched against the rodeo event's
 * ALREADY_PAID line item (same amount, same date window), and the full
 * transaction set is scanned for likely duplicates (none expected here —
 * every fixture transaction is financially distinct).
 */
export const reconciliationLinks: readonly ReconciliationLink[] = [
  ...reconcileEventLineItems(events, transactions),
  ...findTransactionDuplicates(transactions),
];

export const independentLivingGoal: FinancialGoal = {
  id: "financial-goal_fixture-independent-living" as Id<"financial-goal">,
  label: "Become financially ready to live independently",
  monthlySavingsTarget: M.fromReais(2_000),
};

export const motherSupportPreference: ProtectedPreference = {
  id: "protected-preference_fixture-mother-support" as Id<"protected-preference">,
  label: "Never reduce support to mother",
  scope: { type: "EXPENSE", expenseId: motherSupport.id },
  reason: "Non-negotiable family commitment.",
};

export const protectedPreferences: readonly ProtectedPreference[] = [motherSupportPreference];

export const currentLifestyleScenario: LifestyleScenario = {
  id: "lifestyle-scenario_fixture-current" as Id<"lifestyle-scenario">,
  type: "CURRENT_LIFESTYLE",
  label: "Current lifestyle (living with mother)",
  additionalMonthlyExpenses: [],
};

/**
 * Estimated incremental costs of moving out. These are assumptions, not
 * confirmed facts — see RULE #13, #14 and docs/PRODUCT.md.
 */
export const independentLivingScenario: LifestyleScenario = {
  id: "lifestyle-scenario_fixture-independent-living" as Id<"lifestyle-scenario">,
  type: "INDEPENDENT_LIVING",
  label: "Independent living simulation",
  additionalMonthlyExpenses: [
    {
      id: "lifestyle-delta_fixture-food" as Id<"lifestyle-delta">,
      label: "Additional dinner/food responsibility",
      amount: M.fromReais(500),
      certainty: "ESTIMATED",
    },
    {
      id: "lifestyle-delta_fixture-cleaning" as Id<"lifestyle-delta">,
      label: "Cleaning",
      amount: M.fromReais(300),
      certainty: "ESTIMATED",
    },
    {
      id: "lifestyle-delta_fixture-household-supplies" as Id<"lifestyle-delta">,
      label: "Household supplies",
      amount: M.fromReais(125),
      certainty: "ESTIMATED",
    },
  ],
};

export const initialUserSnapshotInput: FinancialSnapshotInput = {
  asOfDate: FIXTURE_AS_OF_DATE,
  income: [pjRevenue],
  fixedExpenses,
  variableBudgets,
  transactions,
  reconciliationLinks,
  events,
  installmentPlans,
  goal: independentLivingGoal,
  protectedPreferences,
  // No real liquidity data yet — see FinancialPosition, DEC-012.
};
