import type { Id } from "@money-copilot/shared";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import { type CertainAmount, unknownAmount } from "./certainty";
import type { PaymentSource } from "./transaction";

/**
 * How much of the user's real accounts we actually have data for. Distinct
 * from the certainty of any single figure — a position can be arithmetically
 * "KNOWN" from the accounts we see and still be `PARTIAL` coverage if we
 * know only some of the user's real accounts exist (e.g. one connected
 * card but a bank account we've never been told about). Never invented —
 * see NON-NEGOTIABLE: "do not silently treat a subset of connected accounts
 * as the user's complete cash position."
 */
export type LiquidityCoverage = "COMPLETE" | "PARTIAL" | "UNKNOWN";

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
  readonly coverage: LiquidityCoverage;
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
    coverage: "UNKNOWN",
  };
}

/**
 * Aggregates known account balances (from `PaymentSource.balance`, already
 * sign-interpreted by the provider adapter — see
 * `packages/open-finance`) into a `FinancialPosition`. `otherLiabilities`
 * is never inferred from accounts (no connected-account type represents a
 * personal loan, say) — pass a manually-entered figure if one exists.
 * Coverage is COMPLETE only when every discovered account reports a known
 * balance; PARTIAL when some do and some don't; UNKNOWN when there are no
 * accounts at all yet.
 */
export function buildFinancialPositionFromAccounts(
  accounts: readonly PaymentSource[],
  financialProfileId: Id<"financial-profile">,
  asOf: string,
  source: string,
  otherLiabilities: CertainAmount = unknownAmount(),
): FinancialPosition {
  const bankAccounts = accounts.filter((a) => a.type !== "CREDIT_CARD");
  const cardAccounts = accounts.filter((a) => a.type === "CREDIT_CARD");

  const sumKnown = (list: readonly PaymentSource[]): { total: Money; anyUnknown: boolean; anyKnown: boolean } => {
    let total = M.ZERO;
    let anyUnknown = false;
    let anyKnown = false;
    for (const a of list) {
      if (a.balance && a.balance.certainty !== "UNKNOWN" && a.balance.amount !== null) {
        total = M.add(total, a.balance.amount);
        anyKnown = true;
      } else {
        anyUnknown = true;
      }
    }
    return { total, anyUnknown, anyKnown };
  };

  const bank = sumKnown(bankAccounts);
  const card = sumKnown(cardAccounts);

  const cashBalance: CertainAmount =
    bankAccounts.length === 0
      ? unknownAmount()
      : bank.anyKnown
        ? { certainty: bank.anyUnknown ? "ESTIMATED" : "ACTUAL", amount: bank.total }
        : unknownAmount();

  const cardOutstandingBalance: CertainAmount =
    cardAccounts.length === 0
      ? unknownAmount()
      : card.anyKnown
        ? { certainty: card.anyUnknown ? "ESTIMATED" : "ACTUAL", amount: card.total }
        : unknownAmount();

  const totalAccounts = accounts.length;
  const anyUnknownAtAll = bank.anyUnknown || card.anyUnknown || (bankAccounts.length === 0 && cardAccounts.length === 0);
  const coverage: LiquidityCoverage =
    totalAccounts === 0 ? "UNKNOWN" : anyUnknownAtAll ? "PARTIAL" : "COMPLETE";

  return {
    id: createId("financial-position"),
    financialProfileId,
    asOf,
    cashBalance,
    cardOutstandingBalance,
    otherLiabilities,
    source,
    coverage,
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

  if (position.coverage !== "COMPLETE" && confidence === "KNOWN") {
    confidence = "PARTIAL";
    warnings.push(
      position.coverage === "UNKNOWN"
        ? "No accounts are connected — liquidity coverage is unknown."
        : "Not all of the user's accounts are connected — liquidity coverage is incomplete.",
    );
  }

  const availableLiquidity = M.subtract(position.cashBalance.amount, deductions);
  const liquidityAwareSafeToSpend = M.min(planSafeToSpend, availableLiquidity);

  return { planSafeToSpend, liquidityAwareSafeToSpend, confidence, warnings };
}
