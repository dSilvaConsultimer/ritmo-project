import * as M from "../money/index";
import type { Money } from "../money/index";
import type { VariableBudget } from "../domain/expense";
import type { FinancialGoal } from "../domain/goal";
import type { FinancialTransaction } from "../domain/transaction";
import type { ReconciliationLink } from "../domain/reconciliation";
import type { FinancialSnapshot } from "../snapshot/snapshot";
import { monthlyCategoryTotals } from "./reporting";

export interface CategoryBudgetStatus {
  readonly category: string;
  readonly target: Money;
  readonly spent: Money;
  /** target - spent. May be negative when already over budget — never hidden. */
  readonly remaining: Money;
  readonly overBudget: boolean;
}

/**
 * Deterministic per-category budget status for the given month, pairing
 * each `VariableBudget` target with actual net spend from
 * `monthlyCategoryTotals`. A category with a budget but zero transactions
 * still appears (spent = 0); a category with spend but no budget is
 * omitted here — see `monthlyCategoryTotals` for the raw, budget-agnostic
 * totals.
 */
export function getCategoryBudgetStatus(
  variableBudgets: readonly VariableBudget[],
  transactions: readonly FinancialTransaction[],
  reconciliationLinks: readonly ReconciliationLink[],
  asOfDate: string,
): readonly CategoryBudgetStatus[] {
  const totals = monthlyCategoryTotals(transactions, reconciliationLinks, asOfDate);
  const spentByCategory = new Map<string, Money>();
  for (const t of totals) {
    const existing = spentByCategory.get(t.category) ?? M.ZERO;
    spentByCategory.set(t.category, M.add(existing, t.total));
  }

  return variableBudgets.map((budget) => {
    const spent = spentByCategory.get(budget.category) ?? M.ZERO;
    const remaining = M.subtract(budget.targetAmount, spent);
    return {
      category: budget.category,
      target: budget.targetAmount,
      spent,
      remaining,
      overBudget: M.isNegative(remaining),
    };
  });
}

export interface GoalStatus {
  readonly label: string;
  readonly monthlySavingsTarget: Money;
  readonly projectedSavingsThisMonth: Money;
  /** monthlySavingsTarget - projectedSavingsThisMonth, floored at zero. */
  readonly monthlyGap: Money;
  readonly monthlyTargetMet: boolean;
  /**
   * Only present when the goal has a `targetReserveAmount` (e.g. a total
   * independent-living reserve). No progress-toward-reserve figure is
   * returned: this codebase does not track an accumulated reserve balance
   * anywhere, so claiming a percentage or MET/IN_PROGRESS status would be
   * invented, not deterministic. A future sprint that wants that must add
   * an explicit accumulated-reserve data model first.
   */
  readonly targetReserveAmount?: Money;
}

/**
 * Deterministic goal-progress read. Never invents a reserve target or a
 * reserve-progress status: if the `FinancialGoal` has no
 * `targetReserveAmount`, it is simply omitted rather than guessed. See
 * NON-NEGOTIABLE (Sprint 4): the LLM must not invent a target reserve or
 * claim readiness on its own.
 */
export function getGoalStatus(goal: FinancialGoal, snapshot: FinancialSnapshot): GoalStatus {
  const monthlyGap = M.floorAtZero(M.subtract(goal.monthlySavingsTarget, snapshot.projectedSavings));
  const monthlyTargetMet = M.isZero(monthlyGap);

  return {
    label: goal.label,
    monthlySavingsTarget: goal.monthlySavingsTarget,
    projectedSavingsThisMonth: snapshot.projectedSavings,
    monthlyGap,
    monthlyTargetMet,
    ...(goal.targetReserveAmount !== undefined ? { targetReserveAmount: goal.targetReserveAmount } : {}),
  };
}
