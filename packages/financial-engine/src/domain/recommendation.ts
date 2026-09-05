import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";

/**
 * Recommendation lifecycle. Discovery of recommendations is NOT implemented
 * in Sprint 1 — this models the shape future sprints will populate.
 *
 * PENDING   — surfaced to the user, awaiting a decision.
 * ACCEPTED  — user agreed to act on it as proposed.
 * MODIFIED  — user agreed to a variant (e.g. a different amount).
 * REJECTED  — user declined it; must not repeatedly resurface (RULE #11)
 *             unless material context changes.
 * VERIFIED  — later imported financial data confirmed the expected effect.
 * FAILED    — later imported financial data showed the expected effect did
 *             not materialize.
 */
export type RecommendationStatus =
  | "PENDING"
  | "ACCEPTED"
  | "MODIFIED"
  | "REJECTED"
  | "VERIFIED"
  | "FAILED";

export interface RecommendationVerification {
  readonly verifiedAt: string;
  readonly actualMonthlySavings: Money;
}

export interface Recommendation {
  readonly id: Id<"recommendation">;
  readonly title: string;
  readonly description?: string;
  readonly estimatedMonthlySavings: Money;
  readonly status: RecommendationStatus;
  readonly createdAt: string;
  readonly decidedAt?: string;
  /** Set when status is MODIFIED — the savings amount the user actually agreed to. */
  readonly modifiedMonthlySavings?: Money;
  readonly rejectionReason?: string;
  readonly verification?: RecommendationVerification;
  /**
   * When a rejected recommendation's context materially changes, a new
   * recommendation should be created rather than resurfacing the old one.
   * This links the new one back to what it supersedes.
   */
  readonly supersedesRecommendationId?: Id<"recommendation">;
}
