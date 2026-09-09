import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";
import type { RecurringCandidateConfidence } from "./recurring";

/**
 * Recommendation lifecycle. Discovery of recommendations was NOT implemented
 * until Sprint 5 (`recommendation-generation.ts`) — this file originally only
 * modeled the shape (Sprint 1). See docs/RECOMMENDATIONS.md for the full
 * architecture.
 *
 * PENDING   — surfaced to the user, awaiting a decision.
 * ACCEPTED  — user agreed to act on it as proposed.
 * MODIFIED  — user agreed to a variant (e.g. a different target amount).
 * REJECTED  — user declined it; must not repeatedly resurface (RULE #11)
 *             unless material context changes (see `identityKey`).
 * VERIFIED  — later imported financial data CONFIRMED the expected effect —
 *             only ever set from a `CONFIRMED_SUCCESS` `VerificationAssessment`.
 * FAILED    — later imported financial data CONFIRMED the expected effect
 *             did NOT materialize — only ever set from `CONFIRMED_FAILURE`.
 */
export type RecommendationStatus =
  | "PENDING"
  | "ACCEPTED"
  | "MODIFIED"
  | "REJECTED"
  | "VERIFIED"
  | "FAILED";

/**
 * What kind of action the recommendation proposes. See
 * docs/RECOMMENDATIONS.md, "Recommendation types," for the exact V1
 * generation rules for each.
 */
export type RecommendationType =
  | "CANCEL_RECURRING_COST"
  | "REDUCE_RECURRING_COST"
  | "REVIEW_RECURRING_COST";

/**
 * How often the underlying charge recurs, normalized so impact math never
 * multiplies a weekly/yearly amount as if it were monthly. `UNKNOWN` means
 * the observed interval didn't fall cleanly into a recognized cadence — the
 * engine must not guess a monthly-equivalent amount in that case (see
 * `recommendation-cadence.ts`).
 */
export type RecurrenceCadence = "WEEKLY" | "MONTHLY" | "YEARLY" | "UNKNOWN";

/**
 * The deterministic, auditable "why" behind a recommendation — never a raw
 * provider payload. Answers "Por que você está me recomendando isso?"
 * without needing the LLM to reconstruct or restate anything itself.
 */
export interface RecommendationEvidence {
  readonly normalizedMerchant: string;
  /** The transaction category at generation time, if categorized. */
  readonly category: string | null;
  readonly cadence: RecurrenceCadence;
  /** The actual per-charge amount observed (before cadence normalization). */
  readonly observedAmount: Money;
  /**
   * `observedAmount` normalized to a monthly figure — `null` when `cadence`
   * is `UNKNOWN`, since there is no deterministic way to project a monthly
   * equivalent from an unrecognized interval.
   */
  readonly monthlyEquivalentAmount: Money | null;
  readonly occurrences: number;
  readonly transactionIds: readonly Id<"transaction">[];
  readonly paymentSourceId?: Id<"payment-source">;
  readonly confidence: RecurringCandidateConfidence;
}

/**
 * One entry in a recommendation's append-only decision/verification history
 * — prior states are never overwritten or lost (see docs/RECOMMENDATIONS.md,
 * "Decision history").
 */
export interface RecommendationDecisionEvent {
  readonly status: RecommendationStatus;
  readonly at: string;
  readonly note?: string;
  /** Present for MODIFIED events that set/changed a reduction target. */
  readonly targetAmount?: Money;
}

/**
 * Sprint 5 (DEC-056): an internal, deterministic verification READ, kept
 * separate from `RecommendationStatus` so "we checked and the evidence
 * doesn't yet prove anything" is representable without corrupting the
 * lifecycle status itself. Only `CONFIRMED_SUCCESS`/`CONFIRMED_FAILURE` ever
 * cause a status transition (to VERIFIED/FAILED, respectively) — see
 * `recommendation-verification.ts`.
 *
 * NOT_DUE            — the observation/grace window has not elapsed yet.
 * INCONCLUSIVE       — the window elapsed but evidence is insufficient to
 *                       decide (e.g. stale sync, missing PaymentSource
 *                       coverage) — absence of data is NOT proof.
 * CONFIRMED_SUCCESS  — deterministic evidence confirms the expected change.
 * CONFIRMED_FAILURE  — deterministic evidence confirms it did NOT happen.
 */
export type VerificationAssessment =
  | "NOT_DUE"
  | "INCONCLUSIVE"
  | "CONFIRMED_SUCCESS"
  | "CONFIRMED_FAILURE";

export interface Recommendation {
  readonly id: Id<"recommendation">;
  readonly financialProfileId: Id<"financial-profile">;
  readonly type: RecommendationType;
  /**
   * Deterministic identity of the underlying ECONOMIC opportunity — never a
   * random id. Two evaluations over unchanged data produce the identical
   * `identityKey`, which is what makes generation idempotent and what makes
   * a REJECTED recommendation's suppression automatically lift when the
   * opportunity becomes materially different (a new key). See
   * `recommendation-generation.ts`'s `buildIdentityKey` and
   * docs/RECOMMENDATIONS.md, "Identity and idempotency."
   */
  readonly identityKey: string;
  readonly title: string;
  readonly description?: string;
  readonly evidence: RecommendationEvidence;
  readonly projectedMonthlyImpact: Money;
  readonly projectedAnnualImpact: Money;
  readonly status: RecommendationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Set on MODIFIED (REDUCE_RECURRING_COST only) — the user's explicit
   * target monthly amount. Never invented by the engine or the LLM.
   */
  readonly userTargetAmount?: Money;
  /** Optional user-stated or system-computed date the change should take effect. */
  readonly effectiveDate?: string;
  readonly rejectionReason?: string;
  readonly lastVerificationAssessment?: VerificationAssessment;
  readonly lastVerificationCheckedAt?: string;
  /** Append-only — see `RecommendationDecisionEvent`. Never rewritten in place. */
  readonly decisionHistory: readonly RecommendationDecisionEvent[];
  /**
   * When a REJECTED recommendation's context materially changes, a NEW
   * recommendation (new `identityKey`) is created rather than resurfacing
   * the old one — this links the new one back to what it supersedes.
   */
  readonly supersedesRecommendationId?: Id<"recommendation">;
}
