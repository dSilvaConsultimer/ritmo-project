import type { BudgetFitZone } from "@money-copilot/financial-engine";
import type { VenueCandidate } from "@money-copilot/discovery";
import type { ConciergeIntent } from "./types";

/**
 * Every weight the concierge ranking uses, centralized — see Sprint 6
 * brief, "Ranking": "do not scatter arbitrary weights... initial weights
 * are product policy defaults, not universal truth." See
 * docs/CONCIERGE.md, "Ranking policy."
 */
export interface ConciergeRankingPolicy {
  readonly budgetFitWeight: number;
  readonly preferenceMatchWeight: number;
  readonly ratingWeight: number;
  readonly priceConfidenceWeight: number;
}

export const DEFAULT_CONCIERGE_RANKING_POLICY: ConciergeRankingPolicy = {
  budgetFitWeight: 100,
  preferenceMatchWeight: 20,
  ratingWeight: 10,
  priceConfidenceWeight: 10,
};

/** Higher is better — budget fit dominates ranking per the Sprint 6 brief's explicit "budget fit should dominate." */
const ZONE_SCORE: Record<BudgetFitZone, number> = {
  WITHIN_RECOMMENDED: 1,
  WITHIN_CAUTION: 0.6,
  UNKNOWN_COST: 0.4,
  HIGH_IMPACT: 0.2,
  EXCEEDS_LIMIT: 0,
};

const CONFIDENCE_SCORE: Record<"HIGH" | "MEDIUM" | "LOW", number> = { HIGH: 1, MEDIUM: 0.6, LOW: 0.3 };

export interface RankingFactors {
  readonly budgetFitScore: number;
  readonly preferenceMatchScore: number;
  readonly ratingScore: number;
  readonly priceConfidenceScore: number;
}

export interface RankedVenue {
  readonly venue: VenueCandidate;
  readonly totalScore: number;
  readonly factors: RankingFactors;
}

function preferenceMatchRatio(venue: VenueCandidate, preferences: readonly string[] | undefined): number {
  if (!preferences || preferences.length === 0) return 0;
  const haystack = `${venue.name} ${venue.category} ${venue.neighborhood ?? ""}`.toLowerCase();
  const matches = preferences.filter((p) => haystack.includes(p.toLowerCase())).length;
  return matches / preferences.length;
}

function bestPriceConfidence(venue: VenueCandidate): number {
  if (venue.priceEvidence.length === 0) return 0;
  return Math.max(...venue.priceEvidence.map((p) => CONFIDENCE_SCORE[p.confidence]));
}

/**
 * Ranks venue candidates for ONE component (e.g. all DINING candidates)
 * using explicit, inspectable factors — never one opaque AI score (Sprint
 * 6 brief, "Ranking"). `zoneForVenue` lets the caller pre-compute each
 * venue's own `BudgetFitZone` (from `evaluateBudgetFit`) — this module
 * never calculates budget fit itself, only consumes it.
 */
export function rankVenueCandidates(
  candidates: readonly VenueCandidate[],
  intent: Pick<ConciergeIntent, "preferences">,
  zoneForVenue: (venue: VenueCandidate) => BudgetFitZone,
  policy: ConciergeRankingPolicy = DEFAULT_CONCIERGE_RANKING_POLICY,
): readonly RankedVenue[] {
  const ranked = candidates.map((venue) => {
    const factors: RankingFactors = {
      budgetFitScore: ZONE_SCORE[zoneForVenue(venue)] * policy.budgetFitWeight,
      preferenceMatchScore: preferenceMatchRatio(venue, intent.preferences) * policy.preferenceMatchWeight,
      ratingScore: ((venue.rating ?? 0) / 5) * policy.ratingWeight,
      priceConfidenceScore: bestPriceConfidence(venue) * policy.priceConfidenceWeight,
    };
    const totalScore = factors.budgetFitScore + factors.preferenceMatchScore + factors.ratingScore + factors.priceConfidenceScore;
    return { venue, totalScore, factors };
  });

  return [...ranked].sort((a, b) => b.totalScore - a.totalScore);
}
