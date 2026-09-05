import * as M from "../money/index";
import type { Money } from "../money/index";
import type { FinancialSnapshot } from "../snapshot/snapshot";

/**
 * Input for replanning after an expense that has already happened —
 * typically deviating from an earlier recommendation
 * (`simulateExpense`/`getSpendingEnvelope`). The caller is responsible for
 * recording the actual transaction and rebuilding the snapshot BEFORE
 * calling this (see `docs/AI-COPILOT.md`, "replanAfterExpense") — this
 * function performs no persistence and no recalculation of its own beyond
 * comparing the two already-deterministic numbers it's given.
 */
export interface ReplanInput {
  /** What was previously recommended (e.g. a prior `recommendedLimit`/`recommendedAmount`). */
  readonly previousTarget: Money;
  readonly actualExpenseAmount: Money;
  /** The snapshot AFTER the actual expense has been recorded and the snapshot rebuilt. */
  readonly snapshotAfter: FinancialSnapshot;
}

export interface ReplanResult {
  readonly previousTarget: Money;
  readonly actualExpense: Money;
  readonly newSafeToSpend: Money;
  readonly newProjectedSavings: Money;
  /** protectedSavings - newProjectedSavings, floored at zero. */
  readonly goalGap: Money;
  /** Same as `goalGap` — money that would need to be found or cut elsewhere to still hit the savings target. */
  readonly compensationRequired: Money;
  readonly remainingDiscretionaryBudget: Money;
  readonly remainingDailyGuidance: Money;
  readonly warnings: readonly string[];
}

/**
 * Deterministically re-derives guidance after the user reports they already
 * spent more (or less) than a prior recommendation. Never judges the user —
 * see `docs/PRODUCT.md` principle #4 ("spending above a recommendation is
 * allowed"). Deliberately does NOT invent cost-cutting suggestions (e.g.
 * "cancel Netflix") — that's Sprint 5's Recommendation Engine. Only exposes
 * the facts: new Safe-to-Spend, new projected savings, and the compensation
 * gap, if any.
 */
export function replanAfterExpense(input: ReplanInput): ReplanResult {
  const { previousTarget, actualExpenseAmount, snapshotAfter } = input;

  const goalGap = M.floorAtZero(
    M.subtract(snapshotAfter.protectedSavings, snapshotAfter.projectedSavings),
  );

  const warnings = [...snapshotAfter.warnings];
  if (M.compare(actualExpenseAmount, previousTarget) > 0) {
    warnings.push(
      `Actual spend (${M.format(actualExpenseAmount)}) exceeded the previous recommendation of ${M.format(previousTarget)}.`,
    );
  }
  if (M.isPositive(goalGap)) {
    warnings.push(
      `To keep the ${M.format(snapshotAfter.protectedSavings)} savings goal on track, ${M.format(goalGap)} would need to be found or cut elsewhere this month.`,
    );
  }

  return {
    previousTarget,
    actualExpense: actualExpenseAmount,
    newSafeToSpend: snapshotAfter.safeToSpend.total,
    newProjectedSavings: snapshotAfter.projectedSavings,
    goalGap,
    compensationRequired: goalGap,
    remainingDiscretionaryBudget: M.floorAtZero(snapshotAfter.safeToSpend.total),
    remainingDailyGuidance: snapshotAfter.safeToSpend.recommendedForToday,
    warnings,
  };
}
