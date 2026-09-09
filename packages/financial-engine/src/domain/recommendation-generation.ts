import type { Id } from "@money-copilot/shared";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import { annualImpactFromMonthly, classifyCadence, monthlyEquivalentAmount } from "./recommendation-cadence";
import { protectedCategories } from "./preference";
import type { FixedExpense } from "./expense";
import type { ProtectedPreference } from "./preference";
import { DEFAULT_RECOMMENDATION_POLICY, type RecommendationPolicy } from "./recommendation-policy";
import type { RecommendationEvidence, RecommendationType, RecurrenceCadence } from "./recommendation";
import { detectRecurringCandidates, type RecurringCandidateConfidence } from "./recurring";
import type { FinancialTransaction } from "./transaction";

/**
 * A freshly-detected opportunity, not yet a persisted `Recommendation` —
 * the application layer (`packages/app-services`) is what decides whether
 * to create a new PENDING recommendation for it, reuse an existing one by
 * `identityKey`, or leave a REJECTED one suppressed. See
 * docs/RECOMMENDATIONS.md, "Candidate generation."
 */
export interface RecommendationCandidate {
  readonly identityKey: string;
  readonly type: RecommendationType;
  readonly title: string;
  readonly description: string;
  readonly evidence: RecommendationEvidence;
  readonly projectedMonthlyImpact: Money;
  readonly projectedAnnualImpact: Money;
}

export interface GenerateRecommendationCandidatesInput {
  readonly financialProfileId: Id<"financial-profile">;
  readonly transactions: readonly FinancialTransaction[];
  readonly protectedPreferences: readonly ProtectedPreference[];
  readonly fixedExpenses: readonly FixedExpense[];
  readonly policy?: RecommendationPolicy;
}

const CONFIDENCE_RANK: Record<RecurringCandidateConfidence, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

function meetsConfidence(
  actual: RecurringCandidateConfidence,
  minimum: RecurringCandidateConfidence,
): boolean {
  return CONFIDENCE_RANK[actual] >= CONFIDENCE_RANK[minimum];
}

function amountBucket(amount: Money, bucketCents: number): number {
  return Math.round(amount.cents / bucketCents) * bucketCents;
}

/**
 * Deterministic identity of the underlying ECONOMIC opportunity — see
 * `Recommendation.identityKey`'s doc comment. Computed once from freshly
 * detected evidence every time generation runs; the application layer
 * matches this against each PERSISTED recommendation's own (immutable,
 * frozen-at-creation) `identityKey` field — never recomputed from a
 * recommendation's current (possibly user-MODIFIED) `type`, so a MODIFY
 * that changes the proposed action does not itself break idempotency.
 */
export function buildRecommendationIdentityKey(
  financialProfileId: string,
  type: RecommendationType,
  normalizedMerchant: string,
  representativeAmount: Money,
  cadence: RecurrenceCadence,
  paymentSourceId: string | undefined,
  policy: RecommendationPolicy,
): string {
  const bucket = amountBucket(representativeAmount, policy.identityAmountBucketCents);
  return [financialProfileId, type, normalizedMerchant, cadence, bucket, paymentSourceId ?? "any"].join(":");
}

/**
 * Pure, deterministic recommendation-opportunity discovery — the Sprint 5
 * counterpart to `detectRecurringCandidates` (which it reuses unchanged).
 * Never touches persisted `Recommendation` rows or decision history; see
 * docs/RECOMMENDATIONS.md, "Candidate generation," for the full policy this
 * implements (financial-effect eligibility, category/`ProtectedPreference`
 * exclusion evaluated BEFORE anything else, confidence gating, cadence
 * normalization).
 */
export function generateRecommendationCandidates(
  input: GenerateRecommendationCandidatesInput,
): RecommendationCandidate[] {
  const policy = input.policy ?? DEFAULT_RECOMMENDATION_POLICY;
  const protectedCats = protectedCategories(input.protectedPreferences, input.fixedExpenses);

  const eligible = input.transactions.filter((t) => {
    if (!policy.eligibleFinancialEffects.includes(t.financialEffect)) return false;
    if (t.category === null) return false; // ambiguous/uncategorized — never a confirmed opportunity
    if (protectedCats.has(t.category)) return false; // RULE #5/#11 — evaluated before anything else
    if (policy.excludedCategories.includes(t.category)) return false;
    return true;
  });

  const recurring = detectRecurringCandidates(eligible);
  const candidates: RecommendationCandidate[] = [];

  for (const recurringCandidate of recurring) {
    if (recurringCandidate.evidence.occurrences < policy.minEvidenceOccurrences) continue;
    if (!meetsConfidence(recurringCandidate.confidence, policy.minConfidenceForReview)) continue;

    const groupTransactions = eligible.filter((t) =>
      recurringCandidate.evidence.transactionIds.includes(t.id),
    );
    const category = groupTransactions.find((t) => t.category !== null)?.category ?? null;
    const paymentSourceIds = new Set(groupTransactions.map((t) => t.paymentSource.id));
    const paymentSourceId = paymentSourceIds.size === 1 ? [...paymentSourceIds][0] : undefined;

    const cadence = classifyCadence(recurringCandidate.evidence.averageIntervalDays);
    const monthlyEquivalent = monthlyEquivalentAmount(recurringCandidate.evidence.averageAmount, cadence);

    const canCancel =
      cadence !== "UNKNOWN" &&
      monthlyEquivalent !== null &&
      meetsConfidence(recurringCandidate.confidence, policy.minConfidenceForCancel);

    const type: RecommendationType = canCancel ? "CANCEL_RECURRING_COST" : "REVIEW_RECURRING_COST";
    const projectedMonthlyImpact = monthlyEquivalent ?? M.ZERO;
    const projectedAnnualImpact = annualImpactFromMonthly(projectedMonthlyImpact);

    const evidence: RecommendationEvidence = {
      normalizedMerchant: recurringCandidate.normalizedMerchant,
      category,
      cadence,
      observedAmount: recurringCandidate.evidence.averageAmount,
      monthlyEquivalentAmount: monthlyEquivalent,
      occurrences: recurringCandidate.evidence.occurrences,
      transactionIds: recurringCandidate.evidence.transactionIds,
      ...(paymentSourceId !== undefined ? { paymentSourceId } : {}),
      confidence: recurringCandidate.confidence,
    };

    const identityKey = buildRecommendationIdentityKey(
      input.financialProfileId,
      type,
      recurringCandidate.normalizedMerchant,
      monthlyEquivalent ?? recurringCandidate.evidence.averageAmount,
      cadence,
      paymentSourceId,
      policy,
    );

    const title =
      type === "CANCEL_RECURRING_COST"
        ? `Recurring subscription: ${recurringCandidate.normalizedMerchant}`
        : `Recurring cost to review: ${recurringCandidate.normalizedMerchant}`;
    const description =
      type === "CANCEL_RECURRING_COST"
        ? `Detected ${evidence.occurrences} recurring charges of ~${M.format(evidence.observedAmount)} from "${evidence.normalizedMerchant}" (${cadence.toLowerCase()}). Canceling would free up ~${M.format(projectedMonthlyImpact)}/month.`
        : `Detected a recurring pattern from "${evidence.normalizedMerchant}" (${evidence.occurrences} occurrences), but confidence isn't high enough yet to confidently recommend cancellation. Impact shown, when available, is informational only — not a guaranteed saving.`;

    candidates.push({
      identityKey,
      type,
      title,
      description,
      evidence,
      projectedMonthlyImpact,
      projectedAnnualImpact,
    });
  }

  return candidates;
}

/** Test/documentation convenience — re-exported so callers never need to hand-roll an id for a brand-new recommendation row. */
export function newRecommendationId(): Id<"recommendation"> {
  return createId("recommendation");
}
