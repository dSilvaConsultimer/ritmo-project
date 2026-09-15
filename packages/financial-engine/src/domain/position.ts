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
  /**
   * Usable cash across bank accounts — already fully resolved (DEC-130):
   * prefers each account's `availableBalance` when the provider reports one
   * (already excludes holds/reserves at the provider's own discretion), and
   * falls back to `balance` minus that account's own `reservedBalance` only
   * when no `availableBalance` exists (so reserved money is never
   * subtracted twice). See `buildFinancialPositionFromAccounts`.
   */
  readonly cashBalance: CertainAmount;
  readonly cardOutstandingBalance: CertainAmount;
  readonly otherLiabilities: CertainAmount;
  /**
   * DEC-130: informational aggregate of reserved/earmarked money across
   * bank accounts (e.g. goal-based "Caixinhas"), for explainability only —
   * NEVER re-subtracted anywhere else; `cashBalance` above has already
   * accounted for it exactly once where applicable.
   */
  readonly reservedBalance: CertainAmount;
  /**
   * DEC-130: informational aggregate of money automatically swept into an
   * auto-invest product across bank accounts. Captured but deliberately
   * NOT subtracted from `cashBalance` anywhere — see DEC-130 for why this
   * remains an open product decision.
   */
  readonly automaticallyInvestedBalance: CertainAmount;
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
    reservedBalance: unknownAmount(),
    automaticallyInvestedBalance: unknownAmount(),
    source: "none",
    coverage: "UNKNOWN",
  };
}

/** A known, non-UNKNOWN amount, or `null` if this specific `CertainAmount` isn't known. */
function knownAmountOrNull(value: CertainAmount | undefined): Money | null {
  if (!value || value.certainty === "UNKNOWN" || value.amount === null) return null;
  return value.amount;
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

  // DEC-130: per bank account, usable cash prefers `availableBalance`
  // (Pluggy's own "available balance," already excluding holds/reserves)
  // and falls back to `balance` minus THAT account's own `reservedBalance`
  // only when no `availableBalance` was reported — this is the one place
  // reserved money is ever subtracted, so it can never happen twice.
  let cashTotal = M.ZERO;
  let cashAnyKnown = false;
  let cashAnyUnknown = false;
  let reservedTotal = M.ZERO;
  let reservedAnyKnown = false;
  let investedTotal = M.ZERO;
  let investedAnyKnown = false;

  for (const a of bankAccounts) {
    const available = knownAmountOrNull(a.availableBalance);
    const raw = knownAmountOrNull(a.balance);
    const reserved = knownAmountOrNull(a.reservedBalance);
    const invested = knownAmountOrNull(a.automaticallyInvestedBalance);

    if (available !== null) {
      cashTotal = M.add(cashTotal, available);
      cashAnyKnown = true;
    } else if (raw !== null) {
      cashTotal = M.add(cashTotal, reserved !== null ? M.subtract(raw, reserved) : raw);
      cashAnyKnown = true;
    } else {
      cashAnyUnknown = true;
    }

    if (reserved !== null) {
      reservedTotal = M.add(reservedTotal, reserved);
      reservedAnyKnown = true;
    }
    if (invested !== null) {
      investedTotal = M.add(investedTotal, invested);
      investedAnyKnown = true;
    }
  }

  const cardKnown = { total: M.ZERO, anyUnknown: false, anyKnown: false };
  for (const a of cardAccounts) {
    const balance = knownAmountOrNull(a.balance);
    if (balance !== null) {
      cardKnown.total = M.add(cardKnown.total, balance);
      cardKnown.anyKnown = true;
    } else {
      cardKnown.anyUnknown = true;
    }
  }

  const cashBalance: CertainAmount =
    bankAccounts.length === 0
      ? unknownAmount()
      : cashAnyKnown
        ? { certainty: cashAnyUnknown ? "ESTIMATED" : "ACTUAL", amount: cashTotal }
        : unknownAmount();

  const cardOutstandingBalance: CertainAmount =
    cardAccounts.length === 0
      ? unknownAmount()
      : cardKnown.anyKnown
        ? { certainty: cardKnown.anyUnknown ? "ESTIMATED" : "ACTUAL", amount: cardKnown.total }
        : unknownAmount();

  const reservedBalance: CertainAmount = reservedAnyKnown
    ? { certainty: "ACTUAL", amount: reservedTotal }
    : unknownAmount();
  const automaticallyInvestedBalance: CertainAmount = investedAnyKnown
    ? { certainty: "ACTUAL", amount: investedTotal }
    : unknownAmount();

  const totalAccounts = accounts.length;
  const anyUnknownAtAll =
    cashAnyUnknown || cardKnown.anyUnknown || (bankAccounts.length === 0 && cardAccounts.length === 0);
  const coverage: LiquidityCoverage =
    totalAccounts === 0 ? "UNKNOWN" : anyUnknownAtAll ? "PARTIAL" : "COMPLETE";

  return {
    id: createId("financial-position"),
    financialProfileId,
    asOf,
    cashBalance,
    cardOutstandingBalance,
    otherLiabilities,
    reservedBalance,
    automaticallyInvestedBalance,
    source,
    coverage,
  };
}

export type LiquidityConfidence = "KNOWN" | "PARTIAL" | "UNKNOWN";

/**
 * DEC-130: which of the two Safe-to-Spend computations is authoritative for
 * "how much can I spend" right now. `LIQUIDITY_AWARE` starts from real
 * current account balances (the answer to "from now until period end");
 * `PLAN_BASED` is the declared-income/declared-commitments monthly plan,
 * unchanged from before this DEC — the honest fallback when no reliable
 * current balance exists at all.
 */
export type SafeToSpendBasis = "LIQUIDITY_AWARE" | "PLAN_BASED";

export type LiquiditySafeToSpendComponentType =
  | "CURRENT_AVAILABLE_CASH"
  | "CARD_OBLIGATIONS"
  | "OTHER_LIABILITIES"
  | "UPCOMING_COMMITMENTS"
  | "UPCOMING_EVENT_RESERVATIONS"
  | "DEBT_COMMITMENTS"
  | "FUTURE_CONFIRMED_INCOME"
  | "PROTECTED_SAVINGS";

/**
 * One line of the liquidity-aware audit trail — same signed-amount
 * convention as `SafeToSpendComponent` in `snapshot.ts` (negative =
 * deduction, positive = addition). Summing every component's `amount` must
 * exactly equal `LiquidityAwareSafeToSpend.liquidityAwareSafeToSpend` — see
 * the reconciliation test in `position.test.ts`.
 */
export interface LiquiditySafeToSpendComponent {
  readonly label: string;
  readonly type: LiquiditySafeToSpendComponentType;
  readonly amount: Money;
}

/**
 * DEC-130: the forward-looking deltas `computeLiquidityAwareSafeToSpend`
 * needs but does not itself derive — `snapshot.ts` computes these from
 * `Income`/`FixedExpense`/`FinancialEvent`/installment data (domains this
 * module deliberately does not depend on, keeping it balance-only) and
 * passes them in as plain, pre-aggregated `Money` values. Every figure here
 * must already exclude anything that happened ON OR BEFORE `asOfDate` —
 * that money is, by construction, already reflected in the current
 * balance.
 */
export interface LiquidityForwardAdjustments {
  /** Declared fixed/variable commitments not yet due this cycle (`dueDayOfMonth` still ahead of today, or unknown timing). */
  readonly upcomingCommitments: Money;
  /** Future (not-yet-paid) event line items — CONFIRMED/ESTIMATED — whose event falls within the current planning horizon only. */
  readonly upcomingEventReservations: Money;
  /** This period's not-yet-paid installment/debt obligation. */
  readonly debtCommitments: Money;
  /** Reliable future income expected before period end, not yet received (see `Income.expectedDayOfMonth`). */
  readonly futureIncome: Money;
  /** The monthly protected-savings goal — never spendable, liquidity-aware or not. */
  readonly protectedSavings: Money;
}

export interface LiquidityAwareSafeToSpend {
  readonly basis: SafeToSpendBasis;
  /** The monthly-plan Safe-to-Spend, unchanged — always available regardless of `basis`. */
  readonly planSafeToSpend: Money;
  /**
   * The liquidity-based result. `null` only when `basis` is `PLAN_BASED`
   * (cash balance itself unknown) — never presented as if it were real cash
   * available (RULE #9/#17).
   */
  readonly liquidityAwareSafeToSpend: Money | null;
  /** Explainability breakdown — empty when `basis` is `PLAN_BASED` (use `SafeToSpendBreakdown` instead in that case). */
  readonly components: readonly LiquiditySafeToSpendComponent[];
  /**
   * The one number Home (or any other single-figure consumer) should show:
   * `liquidityAwareSafeToSpend` when `basis` is `LIQUIDITY_AWARE`,
   * otherwise `planSafeToSpend`. Computed here, once, so no call site needs
   * its own "which one do I show" logic.
   */
  readonly recommendedTotal: Money;
  readonly confidence: LiquidityConfidence;
  readonly warnings: readonly string[];
}

const ZERO_ADJUSTMENTS: LiquidityForwardAdjustments = {
  upcomingCommitments: M.ZERO,
  upcomingEventReservations: M.ZERO,
  debtCommitments: M.ZERO,
  futureIncome: M.ZERO,
  protectedSavings: M.ZERO,
};

/**
 * DEC-130: computes Safe-to-Spend starting from CURRENT real liquidity, not
 * the declared monthly plan — "how much can I safely spend from now until
 * period end without failing known obligations or touching protected
 * money." Falls back to the unchanged `planSafeToSpend` (`basis:
 * "PLAN_BASED"`) only when the cash balance itself is unknown; there is
 * deliberately no `min(plan, liquidity)` blend anymore — that was the exact
 * mechanism that let an empty declared-income plan (`planSafeToSpend`
 * deeply negative) win over healthy real liquidity (see docs/DECISIONS.md
 * DEC-130 for the concrete bug this replaces). Never touches
 * `actualSpending`/real transactions directly: every past-realized
 * movement (income received, money already spent, a card bill already
 * paid) is, by construction, already netted into `position.cashBalance`/
 * `position.cardOutstandingBalance` — re-subtracting or re-adding any of it
 * here would double count.
 */
export function computeLiquidityAwareSafeToSpend(
  planSafeToSpend: Money,
  position: FinancialPosition,
  forward: LiquidityForwardAdjustments = ZERO_ADJUSTMENTS,
): LiquidityAwareSafeToSpend {
  const warnings: string[] = [];

  if (position.cashBalance.certainty === "UNKNOWN" || position.cashBalance.amount === null) {
    return {
      basis: "PLAN_BASED",
      planSafeToSpend,
      liquidityAwareSafeToSpend: null,
      components: [],
      recommendedTotal: planSafeToSpend,
      confidence: "UNKNOWN",
      warnings: [
        "Real-time liquidity is unknown — Safe-to-Spend reflects the monthly plan only, not actual cash on hand.",
      ],
    };
  }

  let confidence: LiquidityConfidence = "KNOWN";
  const components: LiquiditySafeToSpendComponent[] = [
    {
      label: "Current available cash",
      type: "CURRENT_AVAILABLE_CASH",
      amount: position.cashBalance.amount,
    },
  ];

  if (position.cardOutstandingBalance.certainty === "UNKNOWN" || position.cardOutstandingBalance.amount === null) {
    confidence = "PARTIAL";
    warnings.push(
      "Card outstanding balance is unknown — liquidity-aware Safe-to-Spend may overstate what's really available.",
    );
  } else if (M.isPositive(position.cardOutstandingBalance.amount)) {
    components.push({
      label: "Card obligations",
      type: "CARD_OBLIGATIONS",
      amount: M.negate(position.cardOutstandingBalance.amount),
    });
  }

  if (position.otherLiabilities.certainty === "UNKNOWN" || position.otherLiabilities.amount === null) {
    confidence = "PARTIAL";
    warnings.push(
      "Other liabilities are unknown — liquidity-aware Safe-to-Spend may overstate what's really available.",
    );
  } else if (M.isPositive(position.otherLiabilities.amount)) {
    components.push({
      label: "Other liabilities",
      type: "OTHER_LIABILITIES",
      amount: M.negate(position.otherLiabilities.amount),
    });
  }

  if (position.coverage !== "COMPLETE" && confidence === "KNOWN") {
    confidence = "PARTIAL";
    warnings.push(
      position.coverage === "UNKNOWN"
        ? "No accounts are connected — liquidity coverage is unknown."
        : "Not all of the user's accounts are connected — liquidity coverage is incomplete.",
    );
  }

  if (M.isPositive(forward.upcomingCommitments)) {
    components.push({
      label: "Upcoming commitments",
      type: "UPCOMING_COMMITMENTS",
      amount: M.negate(forward.upcomingCommitments),
    });
  }
  if (M.isPositive(forward.upcomingEventReservations)) {
    components.push({
      label: "Upcoming event reservations",
      type: "UPCOMING_EVENT_RESERVATIONS",
      amount: M.negate(forward.upcomingEventReservations),
    });
  }
  if (M.isPositive(forward.debtCommitments)) {
    components.push({
      label: "Debt / installment commitments",
      type: "DEBT_COMMITMENTS",
      amount: M.negate(forward.debtCommitments),
    });
  }
  if (M.isPositive(forward.futureIncome)) {
    components.push({
      label: "Future confirmed income",
      type: "FUTURE_CONFIRMED_INCOME",
      amount: forward.futureIncome,
    });
  }
  if (M.isPositive(forward.protectedSavings)) {
    components.push({
      label: "Protected savings target",
      type: "PROTECTED_SAVINGS",
      amount: M.negate(forward.protectedSavings),
    });
  }

  const liquidityAwareSafeToSpend = M.sum(components.map((c) => c.amount));

  return {
    basis: "LIQUIDITY_AWARE",
    planSafeToSpend,
    liquidityAwareSafeToSpend,
    components,
    recommendedTotal: liquidityAwareSafeToSpend,
    confidence,
    warnings,
  };
}
