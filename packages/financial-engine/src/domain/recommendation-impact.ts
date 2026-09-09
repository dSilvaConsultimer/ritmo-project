import * as M from "../money/index";
import type { Money } from "../money/index";
import { annualImpactFromMonthly } from "./recommendation-cadence";

export interface RecommendationImpact {
  readonly projectedMonthlyImpact: Money;
  readonly projectedAnnualImpact: Money;
}

/**
 * Deterministic impact for a REDUCE_RECURRING_COST recommendation — see
 * docs/RECOMMENDATIONS.md, "Impact calculation." `targetMonthlyAmount` must
 * already be a user-provided or otherwise deterministic monthly-equivalent
 * amount; this function never invents one.
 *
 * Returns `null` when `targetMonthlyAmount >= currentMonthlyEquivalent` —
 * per the Sprint 5 brief, that is explicitly NOT a savings recommendation
 * (RULE: "never allow negative savings"), so the caller must not present
 * any impact figure at all in that case rather than showing a zero/negative
 * one.
 */
export function computeReductionImpact(
  currentMonthlyEquivalent: Money,
  targetMonthlyAmount: Money,
): RecommendationImpact | null {
  if (targetMonthlyAmount.cents >= currentMonthlyEquivalent.cents) return null;
  const projectedMonthlyImpact = M.subtract(currentMonthlyEquivalent, targetMonthlyAmount);
  return {
    projectedMonthlyImpact,
    projectedAnnualImpact: annualImpactFromMonthly(projectedMonthlyImpact),
  };
}
