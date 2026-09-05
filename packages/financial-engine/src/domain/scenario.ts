import type { Id } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";

export type LifestyleScenarioType = "CURRENT_LIFESTYLE" | "INDEPENDENT_LIVING";

/**
 * A single incremental monthly expense assumed to be added under a
 * scenario (e.g. taking on full responsibility for dinner). These are
 * assumptions, not confirmed facts, and are normally ESTIMATED.
 */
export interface LifestyleDelta {
  readonly id: Id<"lifestyle-delta">;
  readonly label: string;
  readonly amount: Money;
  readonly certainty: Certainty;
}

/**
 * A hypothetical lifestyle to simulate against the real financial data,
 * without mutating it. See RULE #13, #14.
 */
export interface LifestyleScenario {
  readonly id: Id<"lifestyle-scenario">;
  readonly type: LifestyleScenarioType;
  readonly label: string;
  /** Empty for CURRENT_LIFESTYLE. */
  readonly additionalMonthlyExpenses: readonly LifestyleDelta[];
}

/**
 * Sprint 2 replaces the Sprint 1 boolean `isIndependentLivingViable`
 * ("projected savings >= 0") with a tri-state read on plan health — see
 * DEC-010. No arbitrary income-percentage thresholds are introduced yet:
 *
 * - UNSUSTAINABLE: the scenario's projected result is negative.
 * - FRAGILE: non-negative, but the configured protected savings goal is
 *   not fully preserved.
 * - SUSTAINABLE: non-negative AND the protected savings goal is preserved.
 */
export type LifestyleViability = "UNSUSTAINABLE" | "FRAGILE" | "SUSTAINABLE";

/**
 * Classifies a scenario's result. `protectedSavingsTarget` is the
 * configured monthly goal (`FinancialGoal.monthlySavingsTarget`) — no
 * hardcoded income percentage is used.
 */
export function classifyLifestyleViability(
  projectedSavings: Money,
  protectedSavingsTarget: Money,
): LifestyleViability {
  if (M.isNegative(projectedSavings)) return "UNSUSTAINABLE";
  if (M.compare(projectedSavings, protectedSavingsTarget) < 0) return "FRAGILE";
  return "SUSTAINABLE";
}
