import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import { TAX_CATEGORY, type FixedExpense, type VariableBudget } from "../domain/expense";
import type { Income } from "../domain/income";
import type { FinancialTransaction, PaymentSource } from "../domain/transaction";
import type { FinancialEvent } from "../domain/event";
import type { FinancialGoal } from "../domain/goal";
import type { ProtectedPreference } from "../domain/preference";
import type { LifestyleScenario } from "../domain/scenario";
import type { FinancialSnapshotInput } from "../snapshot/snapshot";

/**
 * "Today" for the fixture. Chosen so the rodeo event has already partly
 * happened and the beach trip (Sept 25-27) is still upcoming within the
 * same month, matching the scenario described when this fixture was built.
 */
export const FIXTURE_AS_OF_DATE = "2026-09-05";

export const pjRevenue: Income = {
  id: createId("income"),
  label: "PJ gross revenue",
  grossAmount: M.fromReais(15_000),
  certainty: "CONFIRMED",
  recurring: true,
};

const taxes: FixedExpense = {
  id: createId("fixed-expense"),
  label: "Monthly taxes",
  category: TAX_CATEGORY,
  amount: M.fromReais(870),
  certainty: "ACTUAL",
  protected: false,
};

const housing: FixedExpense = {
  id: createId("fixed-expense"),
  label: "Rent + condominium",
  category: "Housing",
  amount: M.fromReais(1_600),
  certainty: "ACTUAL",
  protected: false,
};

/** Protected and non-negotiable — see NON-NEGOTIABLE RULE #6. */
export const motherSupport: FixedExpense = {
  id: createId("fixed-expense"),
  label: "Support to mother",
  category: "Family Support",
  amount: M.fromReais(1_000),
  certainty: "ACTUAL",
  protected: true,
};

const carSubscription: FixedExpense = {
  id: createId("fixed-expense"),
  label: "Localiza / Fiat Pulse subscription",
  category: "Transportation",
  amount: M.fromReais(2_715),
  certainty: "ACTUAL",
  protected: false,
};

const creditCardBillInstallment: FixedExpense = {
  id: createId("fixed-expense"),
  label: "Existing credit card bill installment",
  category: "Debt",
  amount: M.fromReais(1_400),
  certainty: "ESTIMATED",
  protected: false,
};

const lifeInsurance: FixedExpense = {
  id: createId("fixed-expense"),
  label: "Life insurance",
  category: "Insurance",
  amount: M.fromReais(360),
  certainty: "ACTUAL",
  protected: false,
};

const gym: FixedExpense = {
  id: createId("fixed-expense"),
  label: "Gym",
  category: "Health",
  amount: M.fromReais(150),
  certainty: "ACTUAL",
  protected: false,
};

const footvolley: FixedExpense = {
  id: createId("fixed-expense"),
  label: "Footvolley",
  category: "Health",
  amount: M.fromReais(155),
  certainty: "ACTUAL",
  protected: false,
};

export const fixedExpenses: readonly FixedExpense[] = [
  taxes,
  housing,
  motherSupport,
  carSubscription,
  creditCardBillInstallment,
  lifeInsurance,
  gym,
  footvolley,
];

const foodBudget: VariableBudget = {
  id: createId("variable-budget"),
  label: "Food",
  category: "Food",
  targetAmount: M.fromReais(1_500),
  certainty: "ESTIMATED",
};

export const variableBudgets: readonly VariableBudget[] = [foodBudget];

const nubankCreditCard: PaymentSource = {
  id: createId("payment-source"),
  label: "Nubank",
  type: "CREDIT_CARD",
};

/**
 * Demonstrates RULE #4: Nubank is the payment rail, "Food" is the category.
 * Nubank's bill is never itself modeled as an expense category — its
 * underlying transactions (like this one) are categorized individually.
 */
export const transactions: readonly FinancialTransaction[] = [
  {
    id: createId("transaction"),
    description: "iFood dinner",
    amount: M.fromReais(45),
    kind: "EXPENSE",
    category: "Food",
    paymentSource: nubankCreditCard,
    date: FIXTURE_AS_OF_DATE,
    certainty: "ACTUAL",
  },
];

/**
 * Rodeo: the ticket has already been paid (counted once, as actual
 * spending — never reserved again). Transportation is a confirmed future
 * cost; drinks are an estimated future cost.
 */
const rodeo: FinancialEvent = {
  id: createId("financial-event"),
  label: "Rodeo",
  startDate: "2026-09-06",
  endDate: "2026-09-06",
  lineItems: [
    {
      id: createId("event-line-item"),
      label: "Ticket",
      amount: M.fromReais(476.1),
      certainty: "ACTUAL",
      status: "ALREADY_PAID",
    },
    {
      id: createId("event-line-item"),
      label: "Transportation / van",
      amount: M.fromReais(100),
      certainty: "CONFIRMED",
      status: "PLANNED",
    },
    {
      id: createId("event-line-item"),
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
  id: createId("financial-event"),
  label: "Beach trip (Sep 25-27)",
  startDate: "2026-09-25",
  endDate: "2026-09-27",
  lineItems: [
    {
      id: createId("event-line-item"),
      label: "Trip budget",
      amount: null,
      certainty: "UNKNOWN",
      status: "PLANNED",
    },
  ],
};

export const events: readonly FinancialEvent[] = [rodeo, beachTrip];

export const independentLivingGoal: FinancialGoal = {
  id: createId("financial-goal"),
  label: "Become financially ready to live independently",
  monthlySavingsTarget: M.fromReais(2_000),
};

export const motherSupportPreference: ProtectedPreference = {
  id: createId("protected-preference"),
  label: "Never reduce support to mother",
  scope: { type: "EXPENSE", expenseId: motherSupport.id },
  reason: "Non-negotiable family commitment.",
};

export const protectedPreferences: readonly ProtectedPreference[] = [motherSupportPreference];

export const currentLifestyleScenario: LifestyleScenario = {
  id: createId("lifestyle-scenario"),
  type: "CURRENT_LIFESTYLE",
  label: "Current lifestyle (living with mother)",
  additionalMonthlyExpenses: [],
};

/**
 * Estimated incremental costs of moving out. These are assumptions, not
 * confirmed facts — see RULE #13, #14 and docs/PRODUCT.md.
 */
export const independentLivingScenario: LifestyleScenario = {
  id: createId("lifestyle-scenario"),
  type: "INDEPENDENT_LIVING",
  label: "Independent living simulation",
  additionalMonthlyExpenses: [
    {
      id: createId("lifestyle-delta"),
      label: "Additional dinner/food responsibility",
      amount: M.fromReais(500),
      certainty: "ESTIMATED",
    },
    {
      id: createId("lifestyle-delta"),
      label: "Cleaning",
      amount: M.fromReais(300),
      certainty: "ESTIMATED",
    },
    {
      id: createId("lifestyle-delta"),
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
  events,
  goal: independentLivingGoal,
  protectedPreferences,
};
