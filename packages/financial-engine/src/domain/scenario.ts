import type { Id } from "@money-copilot/shared";
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
