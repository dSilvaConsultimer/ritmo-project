import * as M from "../money/index";
import type { Money } from "../money/index";
import type { FinancialConfidence, FinancialSnapshot } from "../snapshot/snapshot";
import { DEFAULT_SPEND_POLICY, type SpendPolicy } from "./expense-simulation";

/**
 * Optional category-scoped headroom, when the caller already knows which
 * category the user is asking about (e.g. "Food"). Never computed by
 * guessing — the caller supplies the category's target/spent-so-far,
 * typically from `reporting.monthlyCategoryTotals` + the matching
 * `VariableBudget`.
 */
export interface CategoryHeadroom {
  readonly category: string;
  readonly target: Money;
  readonly spent: Money;
  /** target - spent. May be negative if already over budget — never hidden. */
  readonly remaining: Money;
}

export interface ProtectedSavingsStatus {
  readonly target: Money;
  readonly projected: Money;
  /** True when projected < target — the goal is not fully on track. */
  readonly atRisk: boolean;
}

/**
 * The deterministic answer to "how much can I spend?" when the user gives
 * no specific amount — e.g. "I'm going on a date tonight, how much can I
 * spend?" The LLM must never derive these numbers itself; it only reads
 * this structure and explains it. See NON-NEGOTIABLE (Sprint 4): "the LLM
 * does not calculate financial values."
 *
 * `recommendedAmount`/`cautionAmount`/`highImpactThreshold` are the exact
 * spend-amount boundaries that would make `simulateExpense` return SAFE /
 * CAUTION / HIGH_IMPACT respectively for the SAME snapshot and policy —
 * see `envelope.test.ts` for the cross-check.
 */
export interface SpendingEnvelope {
  /** The largest amount that keeps the spend fully SAFE (never negative). */
  readonly recommendedAmount: Money;
  /** The largest amount still classified as CAUTION ("acceptable stretch"). */
  readonly cautionAmount: Money;
  /** Where HIGH_IMPACT begins — identical value to `cautionAmount`, named for clarity in prose. */
  readonly highImpactThreshold: Money;
  /** The plan's raw Safe-to-Spend for the rest of the month (may be negative — a real deficit). */
  readonly monthlySafeToSpendRemaining: Money;
  readonly protectedSavingsStatus: ProtectedSavingsStatus;
  readonly warnings: readonly string[];
  readonly confidence: FinancialConfidence;
  /** Labels of planned commitments with an unknown budget (e.g. "Beach trip: Trip budget") — never silently zero. */
  readonly relevantEventReservations: readonly string[];
  readonly relevantCategoryHeadroom?: CategoryHeadroom;
}

/**
 * Deterministic "how much can I spend" envelope, derived from the exact
 * same policy `simulateExpense` uses — never a separate/divergent
 * calculation. Respects the configurable, still-temporary
 * `cautionCompensationRatio` (see docs/DECISIONS.md DEC-005/DEC-018).
 */
export function getSpendingEnvelope(
  snapshot: FinancialSnapshot,
  policy: SpendPolicy = DEFAULT_SPEND_POLICY,
  categoryHeadroom?: CategoryHeadroom,
): SpendingEnvelope {
  const recommendedAmountRaw = snapshot.safeToSpend.total;
  const cautionCeiling = M.scale(snapshot.protectedSavings, policy.cautionCompensationRatio);
  const cautionAmountRaw = M.add(recommendedAmountRaw, cautionCeiling);

  const recommendedAmount = M.floorAtZero(recommendedAmountRaw);
  const cautionAmount = M.floorAtZero(cautionAmountRaw);

  return {
    recommendedAmount,
    cautionAmount,
    highImpactThreshold: cautionAmount,
    monthlySafeToSpendRemaining: snapshot.safeToSpend.total,
    protectedSavingsStatus: {
      target: snapshot.protectedSavings,
      projected: snapshot.projectedSavings,
      atRisk: M.compare(snapshot.projectedSavings, snapshot.protectedSavings) < 0,
    },
    warnings: snapshot.warnings,
    confidence: snapshot.confidence,
    relevantEventReservations: snapshot.commitments.unknownLabels,
    ...(categoryHeadroom ? { relevantCategoryHeadroom: categoryHeadroom } : {}),
  };
}

export interface DailyGuidance {
  readonly recommendedDiscretionarySpendToday: Money;
  readonly daysRemainingInMonth: number;
  readonly monthlySafeToSpendRemaining: Money;
  readonly confidence: FinancialConfidence;
  readonly warnings: readonly string[];
}

/**
 * Wraps the snapshot's already-computed daily figure
 * (`safeToSpend.recommendedForToday`) with its confidence/warnings —
 * no new arithmetic, just packaging what `buildFinancialSnapshot` already
 * derived. Never claims false certainty: if an event (e.g. the beach trip)
 * has an UNKNOWN budget, `confidence` is already `LOW` and `warnings`
 * already names it — this function does not strip that context out.
 */
export function getDailyGuidance(snapshot: FinancialSnapshot): DailyGuidance {
  return {
    recommendedDiscretionarySpendToday: snapshot.safeToSpend.recommendedForToday,
    daysRemainingInMonth: snapshot.safeToSpend.daysRemainingInMonth,
    monthlySafeToSpendRemaining: snapshot.safeToSpend.total,
    confidence: snapshot.confidence,
    warnings: snapshot.warnings,
  };
}
