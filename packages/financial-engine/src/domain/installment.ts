import type { Id } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import type { Certainty } from "./certainty";

export type InstallmentPlanStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";

/**
 * An installment plan settles a liability (a past purchase paid over time,
 * or an existing debt) — it is DEBT_PAYMENT, never fresh consumption (see
 * `domain/financial-effect.ts`). Schedule data may be incomplete (e.g. the
 * founder's existing ~BRL 1,400/month card debt has a known monthly amount
 * but an unknown installment count) — `installmentNumber`/
 * `totalInstallments` are `null` in that case, and callers must represent
 * that incompleteness rather than guessing a number or treating it as zero.
 */
export interface InstallmentPlan {
  readonly id: Id<"installment-plan">;
  readonly financialProfileId: Id<"financial-profile">;
  readonly description: string;
  readonly originTransactionId?: Id<"transaction">;
  /** Total original purchase amount, if known. */
  readonly totalOriginalAmount: Money | null;
  /** The amount due per installment (this month's commitment when ACTIVE). */
  readonly installmentAmount: Money;
  /** e.g. 3 (of 10). Null when unknown. */
  readonly installmentNumber: number | null;
  /** e.g. 10. Null when unknown. */
  readonly totalInstallments: number | null;
  readonly firstDueDate: string | null;
  readonly certainty: Certainty;
  readonly status: InstallmentPlanStatus;
}

export interface InstallmentPlanRemaining {
  /** Installments still due strictly after the current one. Null if unknown. */
  readonly remainingInstallments: number | null;
  /** Amount of those remaining installments. Null if unknown. */
  readonly remainingAmount: Money | null;
}

/**
 * Computes what's left on a plan without ever multiplying/guessing when the
 * schedule is incomplete. `3/10` at BRL 200 means 7 installments (BRL
 * 1,400) remain after the current one — never re-derives the original
 * purchase total from that.
 */
export function remainingInstallments(plan: InstallmentPlan): InstallmentPlanRemaining {
  if (plan.installmentNumber === null || plan.totalInstallments === null) {
    return { remainingInstallments: null, remainingAmount: null };
  }
  const remaining = Math.max(0, plan.totalInstallments - plan.installmentNumber);
  return {
    remainingInstallments: remaining,
    remainingAmount: M.scale(plan.installmentAmount, remaining),
  };
}

const NEXT_30_DAYS_INSTALLMENTS = 1;
const NEXT_90_DAYS_INSTALLMENTS = 3;

export interface FutureCommitmentSummary {
  /** Sum of ACTIVE plans' current installment amount — this period's debt commitment. */
  readonly currentPeriodAmount: Money;
  readonly next30DaysCommitment: Money;
  readonly next90DaysCommitment: Money;
  /** True if any ACTIVE plan has an incomplete schedule (unknown remaining count). */
  readonly hasIncompleteData: boolean;
  readonly incompletePlanDescriptions: readonly string[];
}

/**
 * Read model answering "how much of my future income is already
 * committed via installments" — informational, NOT automatically deducted
 * from this month's Safe-to-Spend (a BRL 2,400 purchase in 12x is not
 * "BRL 200 this month" plus nothing else; the other BRL 2,200 is still
 * real future commitment, just not this month's cash need).
 */
export function summarizeFutureInstallmentCommitments(
  plans: readonly InstallmentPlan[],
): FutureCommitmentSummary {
  let currentPeriodAmount = M.ZERO;
  let next30 = M.ZERO;
  let next90 = M.ZERO;
  let hasIncompleteData = false;
  const incompletePlanDescriptions: string[] = [];

  for (const plan of plans) {
    if (plan.status !== "ACTIVE") continue;
    currentPeriodAmount = M.add(currentPeriodAmount, plan.installmentAmount);

    const { remainingInstallments: remaining } = remainingInstallments(plan);

    if (remaining === null) {
      // Unknown schedule: assume the plan continues through the projection
      // window rather than silently treating it as ending — see RULE #9/#17.
      hasIncompleteData = true;
      incompletePlanDescriptions.push(plan.description);
      next30 = M.add(next30, M.scale(plan.installmentAmount, NEXT_30_DAYS_INSTALLMENTS));
      next90 = M.add(next90, M.scale(plan.installmentAmount, NEXT_90_DAYS_INSTALLMENTS));
      continue;
    }

    // Installments still to be paid from now on, including the current one.
    const remainingFromNow = remaining + 1;
    next30 = M.add(
      next30,
      M.scale(plan.installmentAmount, Math.min(NEXT_30_DAYS_INSTALLMENTS, remainingFromNow)),
    );
    next90 = M.add(
      next90,
      M.scale(plan.installmentAmount, Math.min(NEXT_90_DAYS_INSTALLMENTS, remainingFromNow)),
    );
  }

  return {
    currentPeriodAmount,
    next30DaysCommitment: next30,
    next90DaysCommitment: next90,
    hasIncompleteData,
    incompletePlanDescriptions,
  };
}
