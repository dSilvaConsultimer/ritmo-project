import type { Money } from "../money/index";
import { DEFAULT_RECOMMENDATION_POLICY, type RecommendationPolicy } from "./recommendation-policy";
import type { RecommendationType, VerificationAssessment } from "./recommendation";

/**
 * Accepts EITHER a plain "YYYY-MM-DD" date or a full ISO timestamp (e.g. a
 * `ProviderConnection.lastSuccessfulSyncAt`) — appending a synthetic
 * midnight time to an already-full timestamp would produce an invalid,
 * silently-NaN date string, which previously made the sync-staleness check
 * a no-op (any comparison against NaN is false) rather than correctly
 * flagging stale evidence as INCONCLUSIVE. Sprint 5 (DEC-061).
 */
function toEpochMillis(iso: string): number {
  return Date.parse(iso.includes("T") ? iso : `${iso}T00:00:00Z`);
}

function daysBetween(isoA: string, isoB: string): number {
  return Math.abs(toEpochMillis(isoB) - toEpochMillis(isoA)) / (24 * 60 * 60 * 1000);
}

function withinTolerance(observed: Money, target: Money, ratio: number): boolean {
  const base = Math.max(target.cents, 1);
  return Math.abs(observed.cents - target.cents) / base <= ratio;
}

export interface AssessVerificationInput {
  readonly type: RecommendationType;
  /** The originally observed per-charge (or monthly-equivalent) amount, for distinguishing "still the old price" from "an unrelated new price." */
  readonly previousObservedAmount: Money;
  /** Required for REDUCE_RECURRING_COST; ignored otherwise. */
  readonly userTargetAmount?: Money;
  readonly effectiveDate: string;
  /**
   * Transactions matching this recommendation's `normalizedMerchant` (and,
   * when known, `paymentSourceId`) dated strictly after `effectiveDate` —
   * the caller is responsible for this matching (reusing existing merchant
   * normalization/PaymentSource identity, per docs/RECOMMENDATIONS.md,
   * "Transaction matching" — this function never re-implements it).
   */
  readonly matchingTransactionAmountsAfterEffectiveDate: readonly Money[];
  readonly asOfDate: string;
  /** `null` when there is no provider connection backing this evidence at all (e.g. manual-only data) — staleness then never blocks verification. */
  readonly lastSuccessfulSyncAt: string | null;
  readonly policy?: RecommendationPolicy;
}

/**
 * Deterministic verification assessment — see `VerificationAssessment`'s
 * doc comment for what each outcome means and docs/RECOMMENDATIONS.md,
 * "Verification," for the full policy. Only ever called by the application
 * layer for a recommendation currently ACCEPTED or MODIFIED; the caller
 * decides whether a `CONFIRMED_SUCCESS`/`CONFIRMED_FAILURE` result should
 * transition the recommendation's lifecycle `status` — this function never
 * touches persisted state itself.
 */
export function assessVerification(input: AssessVerificationInput): VerificationAssessment {
  const policy = input.policy ?? DEFAULT_RECOMMENDATION_POLICY;

  const daysSinceEffective = daysBetween(input.effectiveDate, input.asOfDate);
  if (daysSinceEffective < policy.verificationGracePeriodDays) return "NOT_DUE";

  if (input.lastSuccessfulSyncAt !== null) {
    const daysSinceSync = daysBetween(input.lastSuccessfulSyncAt, input.asOfDate);
    if (daysSinceSync > policy.maxSyncStalenessDaysForVerification) return "INCONCLUSIVE";
  }

  const matches = input.matchingTransactionAmountsAfterEffectiveDate;

  if (input.type === "CANCEL_RECURRING_COST") {
    return matches.length === 0 ? "CONFIRMED_SUCCESS" : "CONFIRMED_FAILURE";
  }

  if (input.type === "REDUCE_RECURRING_COST") {
    if (!input.userTargetAmount) return "INCONCLUSIVE"; // should never happen — defensive only
    if (matches.length === 0) return "INCONCLUSIVE"; // absence is not proof of a REDUCE outcome specifically
    const mostRecent = matches.at(-1)!;
    if (withinTolerance(mostRecent, input.userTargetAmount, policy.reductionAmountToleranceRatio)) {
      return "CONFIRMED_SUCCESS";
    }
    if (withinTolerance(mostRecent, input.previousObservedAmount, policy.reductionAmountToleranceRatio)) {
      return "CONFIRMED_FAILURE";
    }
    return "INCONCLUSIVE"; // neither the old nor the target amount — ambiguous, do not force a binary call
  }

  return "INCONCLUSIVE"; // REVIEW_RECURRING_COST is never expected to reach verification directly
}
