import * as M from "../money/index";
import type { Money } from "../money/index";
import { TAX_CATEGORY, type FixedExpense, type VariableBudget } from "../domain/expense";
import type { Income } from "../domain/income";
import type { FinancialTransaction } from "../domain/transaction";
import { breakdownEvent, type FinancialEvent } from "../domain/event";
import type { FinancialGoal } from "../domain/goal";
import type { ProtectedPreference } from "../domain/preference";
import { daysRemainingInMonth, isSameMonth } from "./date-utils";

export interface FinancialSnapshotInput {
  readonly asOfDate: string;
  readonly income: readonly Income[];
  readonly fixedExpenses: readonly FixedExpense[];
  readonly variableBudgets: readonly VariableBudget[];
  readonly transactions: readonly FinancialTransaction[];
  readonly events: readonly FinancialEvent[];
  readonly goal: FinancialGoal;
  readonly protectedPreferences: readonly ProtectedPreference[];
}

export type FinancialConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface SafeToSpend {
  /** Total discretionary money safely available for the rest of the month. May be negative. */
  readonly total: Money;
  /** `total` spread evenly across the remaining days of the month, floored at zero. */
  readonly recommendedForToday: Money;
  readonly daysRemainingInMonth: number;
}

export interface FinancialSnapshotIncome {
  readonly gross: Money;
  readonly taxes: Money;
  readonly usable: Money;
}

export interface FinancialSnapshotCommitments {
  readonly fixed: Money;
  readonly variableBudgets: Money;
  readonly actualSpending: Money;
  readonly futureConfirmed: Money;
  readonly futureEstimated: Money;
  readonly unknownLabels: readonly string[];
}

export interface FinancialSnapshot {
  readonly asOfDate: string;
  readonly income: FinancialSnapshotIncome;
  readonly commitments: FinancialSnapshotCommitments;
  readonly protectedSavings: Money;
  /** Cash left after all commitments, before allocating to protected savings. */
  readonly discretionaryBeforeSavings: Money;
  /** Projected end-of-month discretionary cash flow (not a bank balance — Sprint 1 models no starting balance). */
  readonly projectedMonthEndCash: Money;
  /** What will actually be saved toward the goal if no further discretionary spending occurs. */
  readonly projectedSavings: Money;
  readonly safeToSpend: SafeToSpend;
  readonly confidence: FinancialConfidence;
  readonly warnings: readonly string[];
}

function computeConfidence(
  hasEstimated: boolean,
  hasUnknown: boolean,
): FinancialConfidence {
  if (hasUnknown) return "LOW";
  if (hasEstimated) return "MEDIUM";
  return "HIGH";
}

export function buildFinancialSnapshot(input: FinancialSnapshotInput): FinancialSnapshot {
  const warnings: string[] = [];
  let hasEstimated = false;
  let hasUnknown = false;

  // --- Income ---
  const gross = M.sum(input.income.map((i) => i.grossAmount));
  const taxExpenses = input.fixedExpenses.filter((e) => e.category === TAX_CATEGORY);
  const taxes = M.sum(taxExpenses.map((e) => e.amount));
  const usable = M.subtract(gross, taxes);

  for (const incomeItem of input.income) {
    if (incomeItem.certainty === "ESTIMATED") hasEstimated = true;
    if (incomeItem.certainty === "UNKNOWN") hasUnknown = true;
  }

  // --- Fixed commitments (excluding tax, which is already netted out of income) ---
  const nonTaxFixed = input.fixedExpenses.filter((e) => e.category !== TAX_CATEGORY);
  const fixed = M.sum(nonTaxFixed.map((e) => e.amount));
  for (const expense of [...taxExpenses, ...nonTaxFixed]) {
    if (expense.certainty === "ESTIMATED") hasEstimated = true;
    if (expense.certainty === "UNKNOWN") hasUnknown = true;
  }

  // --- Variable budgets (targets, e.g. food) ---
  const variableBudgetsTotal = M.sum(input.variableBudgets.map((b) => b.targetAmount));
  for (const budget of input.variableBudgets) {
    if (budget.certainty === "ESTIMATED") hasEstimated = true;
    if (budget.certainty === "UNKNOWN") hasUnknown = true;
  }

  // --- Actual spending this month (posted transactions + already-paid event items) ---
  const monthlyExpenseTransactions = input.transactions.filter(
    (t) => t.kind === "EXPENSE" && isSameMonth(t.date, input.asOfDate),
  );
  const transactionsActualSpending = M.sum(monthlyExpenseTransactions.map((t) => t.amount));

  // --- Planned events: already-paid, future-confirmed, future-estimated, unknown ---
  let eventAlreadyPaid = M.ZERO;
  let futureConfirmed = M.ZERO;
  let futureEstimated = M.ZERO;
  const unknownLabels: string[] = [];

  for (const event of input.events) {
    const breakdown = breakdownEvent(event);
    eventAlreadyPaid = M.add(eventAlreadyPaid, breakdown.alreadyPaid);
    futureConfirmed = M.add(futureConfirmed, breakdown.futureConfirmed);
    futureEstimated = M.add(futureEstimated, breakdown.futureEstimated);
    unknownLabels.push(...breakdown.unknownLabels);
  }

  if (M.isPositive(futureEstimated)) hasEstimated = true;
  if (unknownLabels.length > 0) {
    hasUnknown = true;
    for (const label of unknownLabels) {
      warnings.push(
        `Safe-to-Spend has reduced confidence because the budget for "${label}" is still unknown.`,
      );
    }
  }

  const actualSpending = M.add(transactionsActualSpending, eventAlreadyPaid);

  // --- Protected savings goal ---
  const protectedSavings = input.goal.monthlySavingsTarget;

  // --- Aggregate discretionary math ---
  const committedTotal = M.sum([
    fixed,
    variableBudgetsTotal,
    actualSpending,
    futureConfirmed,
    futureEstimated,
  ]);
  const discretionaryBeforeSavings = M.subtract(usable, committedTotal);
  const projectedMonthEndCash = discretionaryBeforeSavings;
  const projectedSavings = M.min(protectedSavings, discretionaryBeforeSavings);
  const safeTotal = M.subtract(discretionaryBeforeSavings, protectedSavings);

  const days = daysRemainingInMonth(input.asOfDate);
  const recommendedForToday = M.scale(M.floorAtZero(safeTotal), 1 / days);

  if (M.isNegative(safeTotal)) {
    warnings.push(
      "Safe-to-Spend is negative: spending as currently committed would require cutting into protected savings.",
    );
  }
  if (M.compare(projectedSavings, protectedSavings) < 0) {
    warnings.push(
      `Projected savings (${M.format(projectedSavings)}) are below the ${M.format(protectedSavings)} target for this month.`,
    );
  }

  const confidence = computeConfidence(hasEstimated, hasUnknown);

  return {
    asOfDate: input.asOfDate,
    income: { gross, taxes, usable },
    commitments: {
      fixed,
      variableBudgets: variableBudgetsTotal,
      actualSpending,
      futureConfirmed,
      futureEstimated,
      unknownLabels,
    },
    protectedSavings,
    discretionaryBeforeSavings,
    projectedMonthEndCash,
    projectedSavings,
    safeToSpend: {
      total: safeTotal,
      recommendedForToday,
      daysRemainingInMonth: days,
    },
    confidence,
    warnings,
  };
}
