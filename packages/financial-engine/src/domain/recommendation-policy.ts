import type { FinancialEffect } from "./financial-effect";
import type { RecurringCandidateConfidence } from "./recurring";

/**
 * Every configurable threshold the recommendation engine uses, centralized
 * so no magic number is scattered through generation/verification code —
 * see docs/RECOMMENDATIONS.md, "Recommendation policy." These are PRODUCT
 * DEFAULTS, not universal financial truth: a future sprint may make this
 * per-profile configurable without changing any engine code, since every
 * function that consumes a policy takes it as a plain parameter.
 */
export interface RecommendationPolicy {
  /** Minimum `detectRecurringCandidates` confidence to propose an outright CANCEL. Anything real but below this becomes REVIEW instead. */
  readonly minConfidenceForCancel: RecurringCandidateConfidence;
  /** Minimum confidence for ANY recommendation (CANCEL or REVIEW) — below this, no recommendation is generated at all. */
  readonly minConfidenceForReview: RecurringCandidateConfidence;
  /** Minimum observed occurrences before a recurring pattern is evidence enough to recommend anything. */
  readonly minEvidenceOccurrences: number;
  /**
   * A transaction's `financialEffect` must be in this set to be eligible
   * evidence at all. Deliberately excludes TRANSFER/CARD_PAYMENT/
   * DEBT_PAYMENT/REFUND/FEE/INCOME — none of those represent a discretionary
   * consumption choice the user could "cancel."
   */
  readonly eligibleFinancialEffects: readonly FinancialEffect[];
  /**
   * Transaction categories that never generate a cost-cutting recommendation
   * regardless of `ProtectedPreference` — a defense-in-depth product
   * default for essential-by-nature categories (on top of, never instead
   * of, actual `ProtectedPreference` exclusions, which are always
   * evaluated too).
   */
  readonly excludedCategories: readonly string[];
  /** Width (in cents) of the amount bucket used to build a recommendation's `identityKey` — mirrors `detectRecurringCandidates`'s own bucketing so a genuine price change earns a new identity rather than silently blending with the old one. */
  readonly identityAmountBucketCents: number;
  /** Days after `effectiveDate` before verification may render anything other than NOT_DUE. */
  readonly verificationGracePeriodDays: number;
  /** A connection's last successful sync must be within this many days of "now" for its silence (no matching charge) to count as evidence at all. */
  readonly maxSyncStalenessDaysForVerification: number;
  /** Ratio tolerance when matching an observed charge against a MODIFIED recommendation's `userTargetAmount` (e.g. 0.05 = within 5%). */
  readonly reductionAmountToleranceRatio: number;
}

/**
 * Sprint 5 (DEC-058) initial defaults. Documented rationale for each
 * non-obvious value lives in docs/RECOMMENDATIONS.md, "Recommendation
 * policy defaults" — treat these as a starting product policy, not as
 * derived from any financial law.
 */
export const DEFAULT_RECOMMENDATION_POLICY: RecommendationPolicy = {
  minConfidenceForCancel: "HIGH",
  minConfidenceForReview: "LOW",
  minEvidenceOccurrences: 2,
  eligibleFinancialEffects: ["CONSUMPTION"],
  excludedCategories: [
    "Housing",
    "Family Support",
    "Insurance",
    "Utilities",
    "Healthcare",
    "Taxes",
    "Debt",
  ],
  identityAmountBucketCents: 100,
  verificationGracePeriodDays: 45,
  maxSyncStalenessDaysForVerification: 10,
  reductionAmountToleranceRatio: 0.05,
};
