import type { Id } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import type { FinancialTransaction } from "../domain/transaction";
import { isConsumptionLike } from "../domain/financial-effect";
import { parseInstallmentMarker } from "../domain/installment";
import { excludedTransactionIds, type ReconciliationLink } from "../domain/reconciliation";
import { lastNCompletedMonthKeys, monthKey } from "../snapshot/date-utils";

/**
 * DEC-140: Planning's predictive forecasting layer — deliberately separate
 * from `snapshot.ts`'s Safe-to-Spend computation, which stays wired to
 * DECLARED `Income`/`FixedExpense` records exactly as before. These
 * functions answer "what does Ritmo expect a normal month to look like,"
 * for DISPLAY only; nothing here feeds the liquidity-aware Available
 * figure. See `home-planejamento-consistency.test.ts` for the regression
 * proof that the two stay independent (a realized salary this month still
 * shows in the forecast, but is never added twice to Safe-to-Spend).
 */

const INCOME_EVIDENCE_MONTHS = 3;

export type ForecastConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface ExpectedMonthlyIncome {
  /** Arithmetic mean of each evidence month's TOTAL eligible income — aggregate the month first, average second (see this file's own doc comment). */
  readonly expectedMonthlyIncome: Money;
  readonly evidenceMonths: readonly string[];
  /** Aligned 1:1 with `evidenceMonths` — the real per-month totals the average was built from, kept for drill-down/audit. */
  readonly monthlyTotals: readonly Money[];
  /** `LOW` when fewer than `INCOME_EVIDENCE_MONTHS` months have ANY real transaction activity at all — never hidden, but also never blocking a display value. */
  readonly confidence: ForecastConfidence;
}

/** True when `transactions` contains at least one row (any financial effect) dated in `month` — distinguishes "genuinely zero income that month" (real coverage, a valid data point) from "no data reaches back this far yet" (no coverage at all). */
function hasAnyActivity(transactions: readonly FinancialTransaction[], month: string): boolean {
  return transactions.some((t) => monthKey(t.date) === month);
}

/**
 * DEC-140: "Entradas previstas" — the expected NORMAL monthly income,
 * built the same way regardless of whether the user is salaried or
 * self-employed (never branches on employment type): for each of the last
 * `INCOME_EVIDENCE_MONTHS` (3) fully completed calendar months, sum every
 * genuine INCOME-effect transaction that month (transfers, refunds,
 * investment redemptions, and card payments are excluded by construction —
 * they are never `financialEffect: "INCOME"` in the first place, see
 * `domain/financial-effect.ts`); THEN average those monthly totals.
 * Aggregating first means a salary split across two deposits, or income
 * from several different clients in one month, is correctly treated as one
 * month's worth of income rather than several separate small ones.
 *
 * Uses only FULLY COMPLETED months (`lastNCompletedMonthKeys`) so an
 * incomplete current month never drags the average down. When fewer than
 * 3 months have any real transaction history at all, still returns a
 * best-effort average over the months that DO have data (or `ZERO` when
 * none do) rather than blocking the display — `confidence` reports the gap
 * instead of hiding the number (see NON-NEGOTIABLE: "prefer visible
 * uncertainty over silent incorrect financial arithmetic").
 */
export function computeExpectedMonthlyIncome(
  transactions: readonly FinancialTransaction[],
  asOfDate: string,
): ExpectedMonthlyIncome {
  const evidenceMonths = lastNCompletedMonthKeys(asOfDate, INCOME_EVIDENCE_MONTHS);
  const monthlyTotals = evidenceMonths.map((month) =>
    M.sum(
      transactions
        .filter((t) => t.financialEffect === "INCOME" && t.status !== "REVERSED" && monthKey(t.date) === month)
        .map((t) => t.amount),
    ),
  );
  const expectedMonthlyIncome = M.fromCents(
    Math.round(monthlyTotals.reduce((sum, a) => sum + a.cents, 0) / monthlyTotals.length),
  );
  const coveredMonths = evidenceMonths.filter((month) => hasAnyActivity(transactions, month));
  const confidence: ForecastConfidence =
    coveredMonths.length >= INCOME_EVIDENCE_MONTHS ? "HIGH" : coveredMonths.length > 0 ? "MEDIUM" : "LOW";

  return { expectedMonthlyIncome, evidenceMonths, monthlyTotals, confidence };
}

/**
 * DEC-140: "Gastos variáveis" — the residual, non-recurring, non-installment
 * portion of historical eligible consumption, averaged the same
 * aggregate-then-average way as income. Canonical definition (reusing
 * exactly the same eligibility rules `reporting.ts`'s
 * `monthlyCategoryTotals` already applies — CONSUMPTION/FEE only, never a
 * reconciled-away transaction — see that function's own doc comment):
 *
 *   historical eligible consumption
 *   - recognized recurring-fixed commitments (`recurringFixedTransactionIds`
 *     — the exact evidence transactions `detectRecurringFixedCommitments`
 *     already identified over the SAME 3-month window, never recomputed
 *     independently)
 *   - finite installments (`parseInstallmentMarker`)
 *   = variable consumption
 *
 * Explicit event expenses are already excluded via `excludedTransactionIds`
 * — a transaction reconciled to a `FinancialEvent` line item never reaches
 * "eligible" in the first place, the same exclusion every other spending
 * view in this engine already relies on.
 */
export function computeExpectedMonthlyVariableSpending(
  transactions: readonly FinancialTransaction[],
  reconciliationLinks: readonly ReconciliationLink[],
  asOfDate: string,
  recurringFixedTransactionIds: ReadonlySet<Id<"transaction">>,
): Money {
  const excluded = excludedTransactionIds(reconciliationLinks);
  const evidenceMonths = lastNCompletedMonthKeys(asOfDate, INCOME_EVIDENCE_MONTHS);

  const monthlyTotals = evidenceMonths.map((month) =>
    M.sum(
      transactions
        .filter(
          (t) =>
            !excluded.has(t.id) &&
            t.status !== "REVERSED" &&
            isConsumptionLike(t.financialEffect) &&
            monthKey(t.date) === month &&
            !recurringFixedTransactionIds.has(t.id) &&
            parseInstallmentMarker(t.normalizedDescription || t.rawDescription) === null,
        )
        .map((t) => t.amount),
    ),
  );

  return M.fromCents(Math.round(monthlyTotals.reduce((sum, a) => sum + a.cents, 0) / monthlyTotals.length));
}
