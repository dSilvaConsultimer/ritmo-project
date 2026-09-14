import { createId, type Id } from "@money-copilot/shared";
import {
  assessVerification,
  computeReductionImpact,
  generateRecommendationCandidates,
  DEFAULT_RECOMMENDATION_POLICY,
  type Money,
  type Recommendation,
  type RecommendationDecisionEvent,
  type RecommendationPolicy,
} from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import type { Database } from "@money-copilot/persistence";
import { assertOwnedByProfile } from "./ownership";

/**
 * Sprint 5 (DEC-059 onward): the application/orchestration layer for
 * recommendation discovery, decisions, and verification — the counterpart
 * to `sync.ts` for Open Finance. Never duplicates financial-engine logic;
 * every deterministic calculation (candidate generation, impact,
 * verification assessment) is a pure import from
 * `@money-copilot/financial-engine`. See docs/RECOMMENDATIONS.md.
 */

function nowIso(): string {
  return new Date().toISOString();
}

export interface RecommendationEvaluationSummary {
  readonly recommendationsEvaluated: number;
  readonly recommendationsCreated: number;
  readonly recommendationsReused: number;
  readonly recommendationsSuppressed: number;
}

/**
 * Deterministic candidate discovery + idempotent persistence. Never
 * updates an existing recommendation's row — a matching `identityKey`
 * (regardless of its current status, including REJECTED) means "nothing to
 * do here," which is what makes this both idempotent (DEC-059) and what
 * implements REJECTED suppression (a REJECTED row's `identityKey` simply
 * never gets a new PENDING sibling) — see docs/RECOMMENDATIONS.md,
 * "Identity and idempotency" / "Suppression."
 */
export async function evaluateRecommendations(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  policy: RecommendationPolicy = DEFAULT_RECOMMENDATION_POLICY,
): Promise<RecommendationEvaluationSummary> {
  const input = await repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate);
  const candidates = generateRecommendationCandidates({
    financialProfileId: financialProfileId as Id<"financial-profile">,
    transactions: input.transactions,
    protectedPreferences: input.protectedPreferences,
    fixedExpenses: input.fixedExpenses,
    policy,
  });

  let created = 0;
  let reused = 0;
  let suppressed = 0;

  for (const candidate of candidates) {
    const existing = await repo.findRecommendationByIdentityKey(db, financialProfileId, candidate.identityKey);
    if (existing) {
      if (existing.status === "REJECTED") suppressed += 1;
      else reused += 1;
      continue;
    }

    const now = nowIso();
    const recommendation: Recommendation = {
      id: createId("recommendation"),
      financialProfileId: financialProfileId as Id<"financial-profile">,
      type: candidate.type,
      identityKey: candidate.identityKey,
      title: candidate.title,
      description: candidate.description,
      evidence: candidate.evidence,
      projectedMonthlyImpact: candidate.projectedMonthlyImpact,
      projectedAnnualImpact: candidate.projectedAnnualImpact,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
      decisionHistory: [{ status: "PENDING", at: now }],
    };
    await repo.upsertRecommendation(db, recommendation);
    created += 1;
  }

  return {
    recommendationsEvaluated: candidates.length,
    recommendationsCreated: created,
    recommendationsReused: reused,
    recommendationsSuppressed: suppressed,
  };
}

function appendDecision(
  recommendation: Recommendation,
  event: RecommendationDecisionEvent,
): readonly RecommendationDecisionEvent[] {
  return [...recommendation.decisionHistory, event];
}

/**
 * Sprint 9: takes the CALLER's own `financialProfileId` — a guessed/leaked
 * `recommendationId` belonging to another profile throws the exact same
 * `ResourceNotFoundError` as a nonexistent one (see `ownership.ts`).
 */
async function requireRecommendation(
  db: Database,
  recommendationId: string,
  financialProfileId: string,
): Promise<Recommendation> {
  const recommendation = await repo.getRecommendationById(db, recommendationId);
  return assertOwnedByProfile(recommendation, financialProfileId, `recommendation ${recommendationId}`);
}

export interface AcceptRecommendationInput {
  readonly financialProfileId: string;
  readonly recommendationId: string;
  /** Defaults to "now" — accepting a cancellation with no stated delay means "starting now." Never invented beyond that reasonable operational default. */
  readonly effectiveDate?: string;
  readonly note?: string;
}

/**
 * ACCEPT — the user agreed with the proposed action AS PROPOSED. Only
 * valid from PENDING, and only for a concrete action type (CANCEL or an
 * already-set REDUCE) — a REVIEW_RECURRING_COST recommendation has no
 * single concrete action to accept; the caller must MODIFY it into a
 * concrete CANCEL/REDUCE first. See RULE (Sprint 5, section 10): this
 * NEVER touches Safe-to-Spend or any current-spendable-cash figure —
 * it only records intent and schedules verification.
 */
export async function acceptRecommendation(
  db: Database,
  input: AcceptRecommendationInput,
): Promise<Recommendation> {
  const recommendation = await requireRecommendation(db, input.recommendationId, input.financialProfileId);
  if (recommendation.status !== "PENDING") {
    throw new Error(`Recommendation ${recommendation.id} is ${recommendation.status}, not PENDING — cannot ACCEPT`);
  }
  if (recommendation.type === "REVIEW_RECURRING_COST") {
    throw new Error(
      `Recommendation ${recommendation.id} is a REVIEW_RECURRING_COST — it has no single concrete action to accept. Use modifyRecommendation to state a concrete target/action first.`,
    );
  }

  const now = nowIso();
  const effectiveDate = input.effectiveDate ?? now.slice(0, 10);
  const updated: Recommendation = {
    ...recommendation,
    status: "ACCEPTED",
    effectiveDate,
    updatedAt: now,
    decisionHistory: appendDecision(recommendation, { status: "ACCEPTED", at: now, ...(input.note ? { note: input.note } : {}) }),
  };
  await repo.upsertRecommendation(db, updated);
  return updated;
}

export interface ModifyRecommendationInput {
  readonly financialProfileId: string;
  readonly recommendationId: string;
  /** Present for a REDUCE — the user's own explicit target monthly amount. Never invented. */
  readonly targetAmount?: Money;
  readonly effectiveDate?: string;
  readonly note?: string;
}

/**
 * MODIFY — the user accepted the concept but changed an actionable detail
 * (a reduction target and/or a delayed effective date). Valid from
 * PENDING, ACCEPTED, or MODIFIED (re-modifying is allowed — e.g. changing
 * the target amount again before verification). `targetAmount`, when
 * given, must already be a deterministic amount the USER stated — this
 * function only recalculates impact from it (`computeReductionImpact`),
 * it never invents or lowers a price itself.
 */
export async function modifyRecommendation(
  db: Database,
  input: ModifyRecommendationInput,
): Promise<Recommendation> {
  const recommendation = await requireRecommendation(db, input.recommendationId, input.financialProfileId);
  if (!["PENDING", "ACCEPTED", "MODIFIED"].includes(recommendation.status)) {
    throw new Error(`Recommendation ${recommendation.id} is ${recommendation.status} — cannot MODIFY`);
  }

  const now = nowIso();
  const effectiveDate = input.effectiveDate ?? recommendation.effectiveDate ?? now.slice(0, 10);

  let type = recommendation.type;
  let projectedMonthlyImpact = recommendation.projectedMonthlyImpact;
  let projectedAnnualImpact = recommendation.projectedAnnualImpact;
  let userTargetAmount = recommendation.userTargetAmount;

  if (input.targetAmount) {
    const currentMonthlyEquivalent = recommendation.evidence.monthlyEquivalentAmount;
    if (!currentMonthlyEquivalent) {
      throw new Error(
        `Recommendation ${recommendation.id} has no deterministic monthly-equivalent amount (cadence UNKNOWN) — cannot compute a reduction target.`,
      );
    }
    const impact = computeReductionImpact(currentMonthlyEquivalent, input.targetAmount);
    if (!impact) {
      throw new Error(
        `Target amount (${input.targetAmount.cents} cents) is not less than the current amount (${currentMonthlyEquivalent.cents} cents) — this would not be a savings recommendation.`,
      );
    }
    type = "REDUCE_RECURRING_COST";
    projectedMonthlyImpact = impact.projectedMonthlyImpact;
    projectedAnnualImpact = impact.projectedAnnualImpact;
    userTargetAmount = input.targetAmount;
  }

  const updated: Recommendation = {
    ...recommendation,
    type,
    projectedMonthlyImpact,
    projectedAnnualImpact,
    ...(userTargetAmount ? { userTargetAmount } : {}),
    effectiveDate,
    status: "MODIFIED",
    updatedAt: now,
    decisionHistory: appendDecision(recommendation, {
      status: "MODIFIED",
      at: now,
      ...(input.note ? { note: input.note } : {}),
      ...(userTargetAmount ? { targetAmount: userTargetAmount } : {}),
    }),
  };
  await repo.upsertRecommendation(db, updated);
  return updated;
}

/**
 * REJECT — the user explicitly does not want this recommendation. This is
 * ALSO the entire suppression mechanism: `evaluateRecommendations` never
 * creates a new row for an `identityKey` that already has one, REJECTED or
 * not, so this same unchanged opportunity never resurfaces. It becomes
 * eligible again only when the underlying evidence changes enough to
 * produce a genuinely different `identityKey` (RULE, Sprint 5 section 12).
 */
export async function rejectRecommendation(
  db: Database,
  financialProfileId: string,
  recommendationId: string,
  reason?: string,
): Promise<Recommendation> {
  const recommendation = await requireRecommendation(db, recommendationId, financialProfileId);
  if (recommendation.status !== "PENDING") {
    throw new Error(`Recommendation ${recommendation.id} is ${recommendation.status}, not PENDING — cannot REJECT`);
  }

  const now = nowIso();
  const updated: Recommendation = {
    ...recommendation,
    status: "REJECTED",
    ...(reason ? { rejectionReason: reason } : {}),
    updatedAt: now,
    decisionHistory: appendDecision(recommendation, { status: "REJECTED", at: now, ...(reason ? { note: reason } : {}) }),
  };
  await repo.upsertRecommendation(db, updated);
  return updated;
}

export interface VerificationEvaluationSummary {
  readonly verificationsEvaluated: number;
  readonly verified: number;
  readonly failed: number;
  readonly inconclusive: number;
}

/**
 * Deterministic verification pass over every ACCEPTED/MODIFIED
 * recommendation — see docs/RECOMMENDATIONS.md, "Verification." Only ever
 * called for a profile after a sync (or on demand); never touches
 * VERIFIED/FAILED recommendations again (they are terminal), which is what
 * makes repeated calls idempotent (Sprint 5 section 16 — three identical
 * syncs must never repeatedly transition VERIFIED -> VERIFIED).
 */
export async function evaluateRecommendationVerifications(
  db: Database,
  financialProfileId: string,
  asOfDate: string,
  policy: RecommendationPolicy = DEFAULT_RECOMMENDATION_POLICY,
): Promise<VerificationEvaluationSummary> {
  const [recommendations, input, connections, paymentSources] = await Promise.all([
    repo.listRecommendationsForProfile(db, financialProfileId),
    repo.loadFinancialSnapshotInput(db, financialProfileId, asOfDate),
    repo.listProviderConnections(db, financialProfileId),
    repo.listPaymentSourcesForProfile(db, financialProfileId),
  ]);

  const connectionById = new Map(connections.map((c) => [c.id, c]));
  const paymentSourceById = new Map(paymentSources.map((p) => [p.id, p]));

  const pending = recommendations.filter((r) => r.status === "ACCEPTED" || r.status === "MODIFIED");

  let verified = 0;
  let failed = 0;
  let inconclusive = 0;

  for (const recommendation of pending) {
    if (!recommendation.effectiveDate) {
      inconclusive += 1;
      continue;
    }

    const matches = input.transactions.filter((t) => {
      if (t.normalizedMerchant !== recommendation.evidence.normalizedMerchant) return false;
      if (recommendation.evidence.paymentSourceId && t.paymentSource.id !== recommendation.evidence.paymentSourceId) {
        return false;
      }
      return t.date > recommendation.effectiveDate!;
    });

    let lastSuccessfulSyncAt: string | null = null;
    if (recommendation.evidence.paymentSourceId) {
      const paymentSource = paymentSourceById.get(recommendation.evidence.paymentSourceId);
      const connection = paymentSource?.connectionId ? connectionById.get(paymentSource.connectionId) : undefined;
      lastSuccessfulSyncAt = connection?.lastSuccessfulSyncAt ?? null;
    }

    const assessment = assessVerification({
      type: recommendation.type,
      previousObservedAmount: recommendation.evidence.observedAmount,
      ...(recommendation.userTargetAmount ? { userTargetAmount: recommendation.userTargetAmount } : {}),
      effectiveDate: recommendation.effectiveDate,
      matchingTransactionAmountsAfterEffectiveDate: matches.map((t) => t.amount),
      asOfDate,
      lastSuccessfulSyncAt,
      policy,
    });

    const now = nowIso();
    if (assessment === "CONFIRMED_SUCCESS" || assessment === "CONFIRMED_FAILURE") {
      const newStatus = assessment === "CONFIRMED_SUCCESS" ? "VERIFIED" : "FAILED";
      if (newStatus === "VERIFIED") verified += 1;
      else failed += 1;
      await repo.upsertRecommendation(db, {
        ...recommendation,
        status: newStatus,
        lastVerificationAssessment: assessment,
        lastVerificationCheckedAt: now,
        updatedAt: now,
        decisionHistory: appendDecision(recommendation, { status: newStatus, at: now }),
      });
    } else {
      if (assessment === "INCONCLUSIVE") inconclusive += 1;
      await repo.upsertRecommendation(db, {
        ...recommendation,
        lastVerificationAssessment: assessment,
        lastVerificationCheckedAt: now,
        updatedAt: now,
      });
    }
  }

  return {
    verificationsEvaluated: pending.length,
    verified,
    failed,
    inconclusive,
  };
}
