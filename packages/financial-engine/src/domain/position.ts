import type { Id } from "@money-copilot/shared";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import { type CertainAmount, unknownAmount } from "./certainty";

/**
 * A point-in-time snapshot of actual liquidity — distinct from the
 * "Financial Plan" (the monthly income/commitments model in
 * `FinancialSnapshot`). A user can have a healthy monthly plan but
 * temporarily low cash, or a large balance that's already mostly
 * committed — the plan and the position answer different questions.
 */
export interface FinancialPosition {
  readonly id: Id<"financial-position">;
  readonly financialProfileId: Id<"financial-profile">;
  /** ISO date/time this position was known to be accurate as of. */
  readonly asOf: string;
  readonly cashBalance: CertainAmount;
  readonly cardOutstandingBalance: CertainAmount;
  readonly otherLiabilities: CertainAmount;
  /** e.g. "manual entry" in Sprint 2; a provider name once Sprint 3 lands. */
  readonly source: string;
}

/** A position with everything UNKNOWN — the honest default when no real data exists yet. */
export function unknownFinancialPosition(
  financialProfileId: Id<"financial-profile">,
  asOf: string,
): FinancialPosition {
  return {
    id: createId("financial-position"),
    financialProfileId,
    asOf,
    cashBalance: unknownAmount(),
    cardOutstandingBalance: unknownAmount(),
    otherLiabilities: unknownAmount(),
    source: "none",
  };
}

export type LiquidityConfidence = "KNOWN" | "PARTIAL" | "UNKNOWN";

export interface LiquidityAwareSafeToSpend {
  /** The monthly-plan Safe-to-Spend, unchanged — always available. */
  readonly planSafeToSpend: Money;
  /**
   * The plan figure narrowed by actual known liquidity. `null` when cash
   * balance itself is unknown — never presented as if it were real cash
   * available (RULE #9/#17).
   */
  readonly liquidityAwareSafeToSpend: Money | null;
  readonly confidence: LiquidityConfidence;
  readonly warnings: readonly string[];
}

/**
 * Narrows the monthly-plan Safe-to-Spend by real, known liquidity. Returns
 * the more conservative of "what the monthly plan allows" and "what's
 * actually liquid right now" — covering both failure modes: a healthy plan
 * with low cash, and a large balance that's already spoken for.
 */
export function computeLiquidityAwareSafeToSpend(
  planSafeToSpend: Money,
  position: FinancialPosition,
): LiquidityAwareSafeToSpend {
  const warnings: string[] = [];

  if (position.cashBalance.certainty === "UNKNOWN" || position.cashBalance.amount === null) {
    return {
      planSafeToSpend,
      liquidityAwareSafeToSpend: null,
      confidence: "UNKNOWN",
      warnings: [
        "Real-time liquidity is unknown — Safe-to-Spend reflects the monthly plan only, not actual cash on hand.",
      ],
    };
  }

  let confidence: LiquidityConfidence = "KNOWN";
  let deductions = M.ZERO;

  if (position.cardOutstandingBalance.certainty === "UNKNOWN" || position.cardOutstandingBalance.amount === null) {
    confidence = "PARTIAL";
    warnings.push(
      "Card outstanding balance is unknown — liquidity-aware Safe-to-Spend may overstate what's really available.",
    );
  } else {
    deductions = M.add(deductions, position.cardOutstandingBalance.amount);
  }

  if (position.otherLiabilities.certainty === "UNKNOWN" || position.otherLiabilities.amount === null) {
    confidence = "PARTIAL";
    warnings.push(
      "Other liabilities are unknown — liquidity-aware Safe-to-Spend may overstate what's really available.",
    );
  } else {
    deductions = M.add(deductions, position.otherLiabilities.amount);
  }

  const availableLiquidity = M.subtract(position.cashBalance.amount, deductions);
  const liquidityAwareSafeToSpend = M.min(planSafeToSpend, availableLiquidity);

  return { planSafeToSpend, liquidityAwareSafeToSpend, confidence, warnings };
}
