import * as M from "../money/index";
import type { Money } from "../money/index";
import { TAX_CATEGORY, type FixedExpense, type VariableBudget } from "../domain/expense";
import type { Income } from "../domain/income";
import type { Certainty } from "../domain/certainty";
import { worstCertainty } from "../domain/certainty";
import type { FinancialTransaction } from "../domain/transaction";
import { isConsumptionLike } from "../domain/financial-effect";
import { breakdownEvent, type FinancialEvent } from "../domain/event";
import type { FinancialGoal } from "../domain/goal";
import type { ProtectedPreference } from "../domain/preference";
import type { InstallmentPlan } from "../domain/installment";
import { summarizeFutureInstallmentCommitments, type FutureCommitmentSummary } from "../domain/installment";
import { excludedTransactionIds, type ReconciliationLink } from "../domain/reconciliation";
import { amountsAreSimilar } from "../domain/recurring";
import type { FinancialPosition } from "../domain/position";
import { computeLiquidityAwareSafeToSpend, type LiquidityAwareSafeToSpend } from "../domain/position";
import { daysRemainingInMonth, isSameMonth, dayOfMonth } from "./date-utils";

/**
 * DEC-130 (corrected): removes the FIRST transaction in `pool` whose amount
 * is within tolerance of `expectedAmount` (reusing `amountsAreSimilar`'s
 * existing 10% band — never a bespoke threshold) and returns it, or
 * `undefined` if nothing matches. Mutates `pool` so the same real
 * transaction can never "realize" two different planned items. This is
 * deliberately amount-only (no description matching at all — never brittle
 * string comparison) and month-scoped by construction (`pool` is always
 * pre-filtered to `asOfDate`'s calendar month before this is called) — a
 * date proximity check beyond "same month" was considered and rejected:
 * the Founder's own early-salary example (expected day 20, received day
 * 15) must match despite a 5-day gap, and "same month" already bounds this
 * to a sane window without an arbitrary extra parameter.
 */
function matchAndConsume(
  expectedAmount: Money,
  pool: FinancialTransaction[],
): FinancialTransaction | undefined {
  const index = pool.findIndex((t) => amountsAreSimilar([expectedAmount, t.amount]));
  if (index === -1) return undefined;
  return pool.splice(index, 1)[0];
}

export interface FinancialSnapshotInput {
  readonly asOfDate: string;
  readonly income: readonly Income[];
  readonly fixedExpenses: readonly FixedExpense[];
  readonly variableBudgets: readonly VariableBudget[];
  readonly transactions: readonly FinancialTransaction[];
  readonly reconciliationLinks: readonly ReconciliationLink[];
  readonly events: readonly FinancialEvent[];
  readonly installmentPlans: readonly InstallmentPlan[];
  readonly goal: FinancialGoal;
  readonly protectedPreferences: readonly ProtectedPreference[];
  /** Optional real liquidity data. Omit to get an honest "unknown" liquidity read. */
  readonly position?: FinancialPosition;
}

export type FinancialConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface SafeToSpend {
  /** Total discretionary money safely available for the rest of the month. May be negative. */
  readonly total: Money;
  /** `total` spread evenly across the remaining days of the month, floored at zero. */
  readonly recommendedForToday: Money;
  readonly daysRemainingInMonth: number;
}

export interface FinancialSnapshotIncome {
  readonly gross: Money;
  readonly taxes: Money;
  readonly usable: Money;
}

export interface FinancialSnapshotCommitments {
  readonly fixed: Money;
  readonly variableBudgets: Money;
  readonly actualSpending: Money;
  readonly debtCommitments: Money;
  readonly futureConfirmed: Money;
  readonly futureEstimated: Money;
  readonly unknownLabels: readonly string[];
}

/**
 * One line of the Safe-to-Spend audit trail. `amount` is signed: negative
 * values are deductions, positive values are the starting resource. Summing
 * every component's `amount` must exactly equal `SafeToSpendBreakdown.total`
 * — see the reconciliation test in `snapshot.test.ts`.
 */
export type SafeToSpendComponentType =
  | "USABLE_INCOME"
  | "FIXED_COMMITMENTS"
  | "VARIABLE_BUDGETS"
  | "ACTUAL_SPENDING"
  | "DEBT_COMMITMENTS"
  | "FUTURE_CONFIRMED"
  | "FUTURE_ESTIMATED"
  | "PROTECTED_SAVINGS";

export interface SafeToSpendComponent {
  readonly label: string;
  readonly type: SafeToSpendComponentType;
  readonly amount: Money;
  readonly certainty: Certainty;
}

export interface SafeToSpendBreakdown {
  readonly components: readonly SafeToSpendComponent[];
  /** Must exactly equal `safeToSpend.total`. */
  readonly total: Money;
  /** Commitments that exist but have no amount yet — excluded above, listed here instead of as zero. */
  readonly unknownLabels: readonly string[];
}

export interface FinancialSnapshot {
  readonly asOfDate: string;
  readonly income: FinancialSnapshotIncome;
  readonly commitments: FinancialSnapshotCommitments;
  readonly protectedSavings: Money;
  /** Cash left after all commitments, before allocating to protected savings. */
  readonly discretionaryBeforeSavings: Money;
  /** Projected end-of-month discretionary cash flow (not a bank balance — no starting balance is modeled here; see `liquidity`). */
  readonly projectedMonthEndCash: Money;
  /** What will actually be saved toward the goal if no further discretionary spending occurs. */
  readonly projectedSavings: Money;
  readonly safeToSpend: SafeToSpend;
  readonly safeToSpendBreakdown: SafeToSpendBreakdown;
  readonly futureInstallmentCommitments: FutureCommitmentSummary;
  /** Plan Safe-to-Spend narrowed by real liquidity, when available — see `docs/FINANCIAL-ENGINE.md`. */
  readonly liquidity: LiquidityAwareSafeToSpend;
  /**
   * DEC-130: the canonical "Já comprometido" figure — `liquidity.
   * committedForwardTotal` when real liquidity is authoritative, otherwise
   * the unchanged plan-based `commitments.fixed`. Home (or any other
   * single-figure consumer) should read this directly rather than deciding
   * between the two itself.
   */
  readonly recommendedCommittedTotal: Money;
  readonly confidence: FinancialConfidence;
  readonly warnings: readonly string[];
}

function computeConfidence(hasEstimated: boolean, hasUnknown: boolean): FinancialConfidence {
  if (hasUnknown) return "LOW";
  if (hasEstimated) return "MEDIUM";
  return "HIGH";
}

export function buildFinancialSnapshot(input: FinancialSnapshotInput): FinancialSnapshot {
  const warnings: string[] = [];
  let hasEstimated = false;
  let hasUnknown = false;
  const currentDayOfMonth = dayOfMonth(input.asOfDate);

  // --- Reconciled transactions this month: consumption-like effects only, refunds net against them ---
  // Computed early — the DEC-130 reconciliation pass below (Income/
  // FixedExpense vs. real transactions) needs this same month-scoped,
  // already-excluded-links transaction list.
  const excludedIds = excludedTransactionIds(input.reconciliationLinks);
  const monthlyTransactions = input.transactions.filter(
    (t) =>
      !excludedIds.has(t.id) &&
      t.status !== "REVERSED" &&
      isSameMonth(t.date, input.asOfDate),
  );
  const consumptionSum = M.sum(
    monthlyTransactions.filter((t) => isConsumptionLike(t.financialEffect)).map((t) => t.amount),
  );
  const refundSum = M.sum(
    monthlyTransactions.filter((t) => t.financialEffect === "REFUND").map((t) => t.amount),
  );
  const transactionsActualSpending = M.subtract(consumptionSum, refundSum);

  // --- Income ---
  const gross = M.sum(input.income.map((i) => i.grossAmount));
  const taxExpenses = input.fixedExpenses.filter((e) => e.category === TAX_CATEGORY);
  const taxes = M.sum(taxExpenses.map((e) => e.amount));
  const usable = M.subtract(gross, taxes);
  const incomeCertainty = worstCertainty(input.income.map((i) => i.certainty));

  for (const incomeItem of input.income) {
    if (incomeItem.certainty === "ESTIMATED") hasEstimated = true;
    if (incomeItem.certainty === "UNKNOWN") hasUnknown = true;
  }

  // DEC-130 (corrected): a planned date is never proof that money actually
  // moved. Reconcile each declared Income against real INCOME-effect
  // transactions this month BEFORE deciding whether it's still "future":
  //   - REALIZED (a real transaction of a similar amount already exists
  //     this month, regardless of whether that happened before or after
  //     `expectedDayOfMonth` — e.g. a salary expected the 20th but paid
  //     early on the 15th) -> already inside the current balance -> NEVER
  //     added to the forward total, full stop.
  //   - EXPECTED (`expectedDayOfMonth` still ahead of today, unrealized,
  //     reliable certainty, and NOT the bare unconfirmed HISTORY_INFERRED
  //     provenance) -> added to the forward total.
  //   - OVERDUE/UNRESOLVED (`expectedDayOfMonth` already passed, still
  //     unrealized) -> conservatively NOT added (never assume it'll still
  //     arrive this period) — flagged with a warning instead of silently
  //     dropped.
  // Only USER_DECLARED/USER_CONFIRMED_HISTORY may ever reach the forward
  // total — an Income record left in the unconfirmed HISTORY_INFERRED
  // state must never become authoritative planned money on its own.
  const incomeTransactionPool = monthlyTransactions.filter((t) => t.financialEffect === "INCOME").slice();
  const futureIncomeItems: Income[] = [];
  for (const incomeItem of input.income) {
    const realized = matchAndConsume(incomeItem.grossAmount, incomeTransactionPool);
    if (realized) continue; // already inside the current balance — never added again.

    const reliableSource = incomeItem.source !== "HISTORY_INFERRED";
    const reliableCertainty = incomeItem.certainty === "CONFIRMED" || incomeItem.certainty === "ACTUAL";
    if (incomeItem.expectedDayOfMonth === undefined) continue; // timing unknown — plan-based total only.

    if (incomeItem.expectedDayOfMonth > currentDayOfMonth && reliableSource && reliableCertainty) {
      futureIncomeItems.push(incomeItem);
    } else if (incomeItem.expectedDayOfMonth <= currentDayOfMonth) {
      warnings.push(
        `Expected income "${incomeItem.label}" has not been confirmed as received yet — not added to Safe-to-Spend.`,
      );
    }
  }
  const futureIncome = M.sum(futureIncomeItems.map((i) => i.grossAmount));

  // --- Fixed commitments (excluding tax, which is already netted out of income) ---
  const nonTaxFixed = input.fixedExpenses.filter((e) => e.category !== TAX_CATEGORY);
  const fixed = M.sum(nonTaxFixed.map((e) => e.amount));
  const fixedCertainty = worstCertainty(nonTaxFixed.map((e) => e.certainty));
  for (const expense of [...taxExpenses, ...nonTaxFixed]) {
    if (expense.certainty === "ESTIMATED") hasEstimated = true;
    if (expense.certainty === "UNKNOWN") hasUnknown = true;
  }

  // --- Variable budgets (targets, e.g. food) ---
  const variableBudgetsTotal = M.sum(input.variableBudgets.map((b) => b.targetAmount));
  const variableBudgetsCertainty = worstCertainty(input.variableBudgets.map((b) => b.certainty));
  for (const budget of input.variableBudgets) {
    if (budget.certainty === "ESTIMATED") hasEstimated = true;
    if (budget.certainty === "UNKNOWN") hasUnknown = true;
  }

  // DEC-130 (corrected): the SAME reconciliation principle applied to
  // FixedExpense — a due day already passed is NOT proof of payment (an
  // overdue, unmatched bill must stay counted as an obligation, never
  // silently assumed paid), and a due day still ahead is NOT proof of
  // non-payment (a bill paid early must reconcile and drop out, or it
  // would be double-subtracted against a balance that already paid it).
  // The only signal that actually matters is whether a real consumption-
  // like transaction of a similar amount exists THIS month — `dueDayOfMonth`
  // itself no longer gates this decision at all (see its own doc comment).
  const consumptionTransactionPool = monthlyTransactions
    .filter((t) => isConsumptionLike(t.financialEffect))
    .slice();
  const unrealizedFixed = nonTaxFixed.filter((e) => !matchAndConsume(e.amount, consumptionTransactionPool));
  const upcomingFixedCommitments = M.sum(unrealizedFixed.map((e) => e.amount));

  // --- Planned events: already-paid, future-confirmed, future-estimated, unknown ---
  let eventAlreadyPaid = M.ZERO;
  let futureConfirmed = M.ZERO;
  let futureEstimated = M.ZERO;
  const unknownLabels: string[] = [];

  for (const event of input.events) {
    const breakdown = breakdownEvent(event);
    eventAlreadyPaid = M.add(eventAlreadyPaid, breakdown.alreadyPaid);
    futureConfirmed = M.add(futureConfirmed, breakdown.futureConfirmed);
    futureEstimated = M.add(futureEstimated, breakdown.futureEstimated);
    unknownLabels.push(...breakdown.unknownLabels);
  }

  if (M.isPositive(futureEstimated)) hasEstimated = true;
  if (unknownLabels.length > 0) {
    hasUnknown = true;
    for (const label of unknownLabels) {
      warnings.push(
        `Safe-to-Spend has reduced confidence because the budget for "${label}" is still unknown.`,
      );
    }
  }

  const actualSpending = M.add(transactionsActualSpending, eventAlreadyPaid);

  // DEC-130: unlike the plan-based `futureConfirmed`/`futureEstimated` above
  // (which reserve for every known future event regardless of when it
  // happens — a broader "financial plan" view), the liquidity-aware forward
  // total is explicitly scoped to the CURRENT planning horizon only (this
  // calendar month) — an event six months out must not reduce what's safe
  // to spend today.
  let upcomingEventReservationsThisMonth = M.ZERO;
  for (const event of input.events) {
    if (!isSameMonth(event.startDate, input.asOfDate)) continue;
    const breakdown = breakdownEvent(event);
    upcomingEventReservationsThisMonth = M.add(
      upcomingEventReservationsThisMonth,
      M.add(breakdown.futureConfirmed, breakdown.futureEstimated),
    );
  }

  // --- Debt / installment commitments (never counted as fresh category consumption) ---
  const futureInstallmentCommitments = summarizeFutureInstallmentCommitments(input.installmentPlans);
  const debtCommitments = futureInstallmentCommitments.currentPeriodAmount;
  const activeInstallmentCertainties = input.installmentPlans
    .filter((p) => p.status === "ACTIVE")
    .map((p) => p.certainty);
  for (const c of activeInstallmentCertainties) {
    if (c === "ESTIMATED") hasEstimated = true;
    if (c === "UNKNOWN") hasUnknown = true;
  }
  if (futureInstallmentCommitments.hasIncompleteData) {
    hasEstimated = true;
    for (const label of futureInstallmentCommitments.incompletePlanDescriptions) {
      warnings.push(
        `Installment plan "${label}" has an incomplete schedule — future commitment projections beyond this month are estimates.`,
      );
    }
  }

  // --- Protected savings goal ---
  const protectedSavings = input.goal.monthlySavingsTarget;

  // --- Aggregate discretionary math ---
  const committedTotal = M.sum([
    fixed,
    variableBudgetsTotal,
    actualSpending,
    futureConfirmed,
    futureEstimated,
    debtCommitments,
  ]);
  const discretionaryBeforeSavings = M.subtract(usable, committedTotal);
  const projectedMonthEndCash = discretionaryBeforeSavings;
  const projectedSavings = M.min(protectedSavings, discretionaryBeforeSavings);
  const safeTotal = M.subtract(discretionaryBeforeSavings, protectedSavings);

  const days = daysRemainingInMonth(input.asOfDate);
  const recommendedForToday = M.scale(M.floorAtZero(safeTotal), 1 / days);

  if (M.isNegative(safeTotal)) {
    warnings.push(
      "Safe-to-Spend is negative: spending as currently committed would require cutting into protected savings.",
    );
  }
  if (M.compare(projectedSavings, protectedSavings) < 0) {
    warnings.push(
      `Projected savings (${M.format(projectedSavings)}) are below the ${M.format(protectedSavings)} target for this month.`,
    );
  }

  const confidence = computeConfidence(hasEstimated, hasUnknown);

  const actualSpendingCertainty = worstCertainty(
    monthlyTransactions.length > 0 ? monthlyTransactions.map((t) => t.certainty) : ["ACTUAL"],
  );
  const debtCertainty = worstCertainty(activeInstallmentCertainties.length > 0 ? activeInstallmentCertainties : ["ACTUAL"]);

  const components: SafeToSpendComponent[] = [
    { label: "Usable income", type: "USABLE_INCOME", amount: usable, certainty: incomeCertainty },
    {
      label: "Fixed commitments",
      type: "FIXED_COMMITMENTS",
      amount: M.negate(fixed),
      certainty: fixedCertainty,
    },
    {
      label: "Variable budgets",
      type: "VARIABLE_BUDGETS",
      amount: M.negate(variableBudgetsTotal),
      certainty: variableBudgetsCertainty,
    },
    {
      label: "Actual spending this month",
      type: "ACTUAL_SPENDING",
      amount: M.negate(actualSpending),
      certainty: actualSpendingCertainty,
    },
    {
      label: "Debt / installment commitments",
      type: "DEBT_COMMITMENTS",
      amount: M.negate(debtCommitments),
      certainty: debtCertainty,
    },
    {
      label: "Future confirmed event reservations",
      type: "FUTURE_CONFIRMED",
      amount: M.negate(futureConfirmed),
      certainty: "CONFIRMED",
    },
    {
      label: "Future estimated event reservations",
      type: "FUTURE_ESTIMATED",
      amount: M.negate(futureEstimated),
      certainty: "ESTIMATED",
    },
    {
      label: "Protected savings target",
      type: "PROTECTED_SAVINGS",
      amount: M.negate(protectedSavings),
      certainty: "CONFIRMED",
    },
  ];
  const breakdownTotal = M.sum(components.map((c) => c.amount));

  const safeToSpendBreakdown: SafeToSpendBreakdown = {
    components,
    total: breakdownTotal,
    unknownLabels,
  };

  const position = input.position;
  const liquidity: LiquidityAwareSafeToSpend = position
    ? computeLiquidityAwareSafeToSpend(safeTotal, position, {
        upcomingFixedCommitments,
        variableBudgets: variableBudgetsTotal,
        upcomingEventReservations: upcomingEventReservationsThisMonth,
        debtCommitments,
        futureIncome,
        protectedSavings,
      })
    : {
        basis: "PLAN_BASED",
        planSafeToSpend: safeTotal,
        liquidityAwareSafeToSpend: null,
        components: [],
        recommendedTotal: safeTotal,
        committedForwardTotal: null,
        confidence: "UNKNOWN",
        warnings: [
          "Real-time liquidity is unknown — Safe-to-Spend reflects the monthly plan only, not actual cash on hand.",
        ],
      };
  warnings.push(...liquidity.warnings);

  // DEC-130: "Já comprometido" — the ONE canonical figure any single-figure
  // consumer (Home) should read, computed here (never re-derived in
  // apps/ritmo): the liquidity-aware committed total when real liquidity is
  // authoritative, otherwise the unchanged plan-based `fixed` commitments
  // figure (already what Home showed before this DEC when no real balance
  // existed).
  const recommendedCommittedTotal = liquidity.committedForwardTotal ?? fixed;

  return {
    asOfDate: input.asOfDate,
    income: { gross, taxes, usable },
    commitments: {
      fixed,
      variableBudgets: variableBudgetsTotal,
      actualSpending,
      debtCommitments,
      futureConfirmed,
      futureEstimated,
      unknownLabels,
    },
    protectedSavings,
    discretionaryBeforeSavings,
    projectedMonthEndCash,
    projectedSavings,
    safeToSpend: {
      total: safeTotal,
      recommendedForToday,
      daysRemainingInMonth: days,
    },
    safeToSpendBreakdown,
    futureInstallmentCommitments,
    liquidity,
    recommendedCommittedTotal,
    confidence,
    warnings,
  };
}
