import * as M from "../money/index";
import type { Money } from "../money/index";
import type { FinancialSnapshot } from "../snapshot/snapshot";

export type SpendStatus = "SAFE" | "CAUTION" | "HIGH_IMPACT";

export interface ExpenseSimulationInput {
  readonly amount: Money;
  readonly category: string;
  /** ISO 8601 date. */
  readonly date: string;
}

export interface ExpenseSimulationResult {
  readonly requestedAmount: Money;
  /** The recommended safe limit for this spend (never negative). */
  readonly recommendedLimit: Money;
  readonly status: SpendStatus;
  readonly projectedSavingsBefore: Money;
  readonly projectedSavingsAfter: Money;
  /** projectedSavingsAfter - projectedSavingsBefore. Zero or negative. */
  readonly goalImpact: Money;
  /** Amount that would need to be found/cut elsewhere to still hit the savings target. Never negative. */
  readonly compensationRequired: Money;
  readonly warnings: readonly string[];
}

/**
 * Policy knobs for classifying spend impact into the three-zone model
 * (SAFE / CAUTION / HIGH_IMPACT). Kept separate from the calculation so
 * future sprints can evolve the policy without touching the domain model.
 * See docs/FINANCIAL-ENGINE.md.
 */
export interface SpendPolicy {
  /**
   * Fraction of the protected savings target that may be put at risk
   * and still be considered an "acceptable stretch" (CAUTION) rather than
   * a material impact (HIGH_IMPACT).
   */
  readonly cautionCompensationRatio: number;
}

export const DEFAULT_SPEND_POLICY: SpendPolicy = {
  cautionCompensationRatio: 0.15,
};

function classify(compensationRequired: Money, protectedSavings: Money, policy: SpendPolicy): SpendStatus {
  if (M.isZero(compensationRequired) || M.isNegative(compensationRequired)) return "SAFE";
  const cautionCeiling = M.scale(protectedSavings, policy.cautionCompensationRatio);
  if (M.compare(compensationRequired, cautionCeiling) <= 0) return "CAUTION";
  return "HIGH_IMPACT";
}

/**
 * Simulates the impact of a hypothetical expense against a snapshot,
 * without mutating the snapshot or requiring any real transaction to be
 * recorded. The user is never blocked — this only explains impact. See
 * NON-NEGOTIABLE RULE #7.
 */
export function simulateExpense(
  snapshot: FinancialSnapshot,
  input: ExpenseSimulationInput,
  policy: SpendPolicy = DEFAULT_SPEND_POLICY,
): ExpenseSimulationResult {
  const recommendedLimit = M.floorAtZero(snapshot.safeToSpend.total);
  const projectedSavingsBefore = snapshot.projectedSavings;

  const discretionaryAfter = M.subtract(snapshot.discretionaryBeforeSavings, input.amount);
  const projectedSavingsAfter = M.min(snapshot.protectedSavings, discretionaryAfter);

  const goalImpact = M.subtract(projectedSavingsAfter, projectedSavingsBefore);
  const compensationRequired = M.floorAtZero(
    M.subtract(snapshot.protectedSavings, projectedSavingsAfter),
  );

  const status = classify(compensationRequired, snapshot.protectedSavings, policy);

  const warnings: string[] = [];
  if (status !== "SAFE") {
    warnings.push(
      `Requested amount (${M.format(input.amount)}) exceeds the recommended safe-to-spend limit of ${M.format(recommendedLimit)}.`,
    );
  }
  if (M.isPositive(compensationRequired)) {
    warnings.push(
      `To keep the ${M.format(snapshot.protectedSavings)} savings goal on track, ${M.format(compensationRequired)} would need to be found or cut elsewhere this month.`,
    );
  }
  if (status === "HIGH_IMPACT") {
    warnings.push(
      `This is a material impact to this month's savings goal for the "${input.category}" category.`,
    );
  }

  return {
    requestedAmount: input.amount,
    recommendedLimit,
    status,
    projectedSavingsBefore,
    projectedSavingsAfter,
    goalImpact,
    compensationRequired,
    warnings,
  };
}
