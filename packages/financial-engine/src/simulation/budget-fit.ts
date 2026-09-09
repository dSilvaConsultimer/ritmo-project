import * as M from "../money/index";
import type { Money } from "../money/index";
import type { SpendingEnvelope } from "./envelope";

/**
 * The zone a candidate/plan cost falls into relative to an existing,
 * already-computed `SpendingEnvelope` — the Sprint 6 counterpart to
 * `SpendStatus` (SAFE/CAUTION/HIGH_IMPACT), deliberately reusing the SAME
 * two boundaries (`recommendedAmount`, `cautionAmount`) rather than
 * inventing a second, conflicting zone model. See docs/CONCIERGE.md,
 * "Budget fit."
 *
 * WITHIN_RECOMMENDED — at or under the envelope's recommended amount.
 * WITHIN_CAUTION     — over recommended but at or under the caution ceiling.
 * HIGH_IMPACT        — over the caution ceiling (matches `SpendStatus`'s
 *                       own HIGH_IMPACT, unbounded above).
 * EXCEEDS_LIMIT       — over the USER'S OWN explicit stated budget ceiling
 *                       specifically — a distinct, stricter concept from
 *                       HIGH_IMPACT: this can fire even for an amount the
 *                       financial engine would otherwise call SAFE, if the
 *                       user said they don't want to spend that much. It
 *                       never LOOSENS a HIGH_IMPACT classification — a
 *                       generous user ceiling can never turn a genuinely
 *                       high-impact amount into something safer.
 * UNKNOWN_COST        — no usable cost estimate exists at all; never
 *                       presented as "fits."
 */
export type BudgetFitZone = "WITHIN_RECOMMENDED" | "WITHIN_CAUTION" | "HIGH_IMPACT" | "EXCEEDS_LIMIT" | "UNKNOWN_COST";

/** A cost estimate's lower/upper bound — pass the same `Money` for both when the amount is exact. */
export interface CostRange {
  readonly min: Money;
  readonly max: Money;
}

export interface BudgetFitResult {
  /** The conservative (worst-case) zone across the full cost range — what callers should treat as authoritative. */
  readonly zone: BudgetFitZone;
  /** The zone at the lower bound of the cost estimate. */
  readonly minZone: BudgetFitZone;
  /** The zone at the upper bound of the cost estimate. */
  readonly maxZone: BudgetFitZone;
}

const ZONE_SEVERITY: Record<Exclude<BudgetFitZone, "UNKNOWN_COST">, number> = {
  WITHIN_RECOMMENDED: 0,
  WITHIN_CAUTION: 1,
  HIGH_IMPACT: 2,
  EXCEEDS_LIMIT: 3,
};

function classifyAmount(
  envelope: SpendingEnvelope,
  amount: Money,
  userCeiling: Money | undefined,
): Exclude<BudgetFitZone, "UNKNOWN_COST"> {
  if (userCeiling && M.compare(amount, userCeiling) > 0) return "EXCEEDS_LIMIT";
  if (M.compare(amount, envelope.recommendedAmount) <= 0) return "WITHIN_RECOMMENDED";
  if (M.compare(amount, envelope.cautionAmount) <= 0) return "WITHIN_CAUTION";
  return "HIGH_IMPACT";
}

/**
 * Deterministic budget-fit classification — the LLM never decides this.
 * `cost` is `null` for an unknown price (always resolves to
 * `UNKNOWN_COST`, never treated as "fits"). `userCeiling`, when given, can
 * only make the result STRICTER (see `EXCEEDS_LIMIT`'s doc comment) — it
 * never overrides a HIGH_IMPACT classification into something safer, and a
 * user ceiling higher than what's financially healthy never erases the
 * engine's own impact classification (Sprint 6 brief, "user-specified
 * limit override").
 */
export function evaluateBudgetFit(
  envelope: SpendingEnvelope,
  cost: CostRange | null,
  userCeiling?: Money,
): BudgetFitResult {
  if (cost === null) {
    return { zone: "UNKNOWN_COST", minZone: "UNKNOWN_COST", maxZone: "UNKNOWN_COST" };
  }

  const minZone = classifyAmount(envelope, cost.min, userCeiling);
  const maxZone = classifyAmount(envelope, cost.max, userCeiling);
  const zone = ZONE_SEVERITY[maxZone] >= ZONE_SEVERITY[minZone] ? maxZone : minZone;

  return { zone, minZone, maxZone };
}

/**
 * The search ceiling the concierge should pass to a discovery provider —
 * NEVER the user's raw Safe-to-Spend/income (see docs/CONCIERGE.md,
 * "Privacy boundary"), just a derived amount. Search is allowed to surface
 * options up to the CAUTION ceiling (not just the recommended amount) so
 * attractive-but-costlier options are never silently hidden (Sprint 6
 * brief, "budget fit should dominate... but do not hide attractive
 * options merely because they cost more") — a user-stated explicit budget
 * can only tighten this further, never loosen it beyond the caution
 * ceiling.
 */
export function deriveSearchCeiling(envelope: SpendingEnvelope, userExplicitBudget?: Money): Money {
  if (userExplicitBudget && M.compare(userExplicitBudget, envelope.cautionAmount) < 0) {
    return userExplicitBudget;
  }
  return envelope.cautionAmount;
}
