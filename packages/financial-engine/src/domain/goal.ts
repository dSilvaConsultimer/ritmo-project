import type { Id } from "@money-copilot/shared";
import type { Money } from "../money/index";

/**
 * A financial goal driving the plan. Sprint 1 supports a single monthly
 * savings target; `targetReserveAmount` is an optional longer-horizon
 * target (e.g. total reserve needed to live independently) that later
 * sprints can use for multi-month projections.
 */
export interface FinancialGoal {
  readonly id: Id<"financial-goal">;
  readonly label: string;
  readonly monthlySavingsTarget: Money;
  readonly targetReserveAmount?: Money;
}
