import * as M from "../money/index";
import type { Money } from "../money/index";
import type { FinancialTransaction } from "../domain/transaction";
import { isConsumptionLike } from "../domain/financial-effect";
import { UNCATEGORIZED } from "../domain/category";
import { excludedTransactionIds, type ReconciliationLink } from "../domain/reconciliation";
import { isSameMonth } from "../snapshot/date-utils";

/**
 * All transactions attributed to the given month, in date order — the raw
 * material for a "Transactions" view. Includes every status (PENDING,
 * POSTED, REVERSED) so nothing is hidden; consumers needing "what actually
 * counts as spending" should use `monthlyCategoryTotals` instead.
 */
export function monthlyTransactionList(
  transactions: readonly FinancialTransaction[],
  asOfDate: string,
): readonly FinancialTransaction[] {
  return transactions
    .filter((t) => isSameMonth(t.date, asOfDate))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
}

function relevantForConsumption(
  transactions: readonly FinancialTransaction[],
  reconciliationLinks: readonly ReconciliationLink[],
  asOfDate: string,
): readonly FinancialTransaction[] {
  const excluded = excludedTransactionIds(reconciliationLinks);
  return transactions.filter(
    (t) => !excluded.has(t.id) && t.status !== "REVERSED" && isSameMonth(t.date, asOfDate),
  );
}

export interface CategoryTotal {
  /**
   * DEC-136: the canonical grouping identity — a real `Category.id` when
   * the transaction has one, the literal `UNCATEGORIZED` sentinel for
   * genuinely uncategorized transactions, or a `legacy:<name>` synthetic
   * key ONLY for a transaction categorized before `categoryId` existed and
   * not yet linked by `backfillTransactionCategoryIds` (see that
   * function's own doc comment). Grouping is ALWAYS by this field, never by
   * `categoryName` — two transactions named "Transporte"/"transporte"
   * never fragment into separate rows as long as they share a real
   * `categoryId`, and a renamed `Category` never splits its own history.
   */
  readonly categoryId: string;
  /** LEGACY / DENORMALIZED display text resolved from the grouped transactions' own `category` string — never the grouping key. */
  readonly categoryName: string;
  readonly subcategory?: string;
  readonly total: Money;
  readonly transactionCount: number;
}

/**
 * Net spend per category this month: CONSUMPTION/FEE add, REFUND subtracts,
 * and TRANSFER/CARD_PAYMENT/DEBT_PAYMENT/INCOME never appear here — they
 * are not fresh consumption (see `domain/financial-effect.ts`). This is why
 * the old credit-card debt installment (modeled as an `InstallmentPlan`,
 * not a transaction) never inflates any category total here — it has no
 * corresponding transaction to group by category in the first place.
 *
 * DEC-136: groups by `categoryId` (see `CategoryTotal.categoryId`'s own
 * doc comment) — never by the raw `category` display string.
 */
export function monthlyCategoryTotals(
  transactions: readonly FinancialTransaction[],
  reconciliationLinks: readonly ReconciliationLink[],
  asOfDate: string,
): readonly CategoryTotal[] {
  const relevant = relevantForConsumption(transactions, reconciliationLinks, asOfDate).filter(
    (t) => isConsumptionLike(t.financialEffect) || t.financialEffect === "REFUND",
  );

  const totals = new Map<
    string,
    { categoryId: string; categoryName: string; subcategory?: string; total: Money; count: number }
  >();

  for (const t of relevant) {
    const categoryId = categoryGroupId(t);
    const categoryName = t.category ?? UNCATEGORIZED;
    const key = `${categoryId}:${t.subcategory ?? ""}`;
    const signedAmount = t.financialEffect === "REFUND" ? M.negate(t.amount) : t.amount;
    const existing = totals.get(key);
    if (existing) {
      totals.set(key, { ...existing, total: M.add(existing.total, signedAmount), count: existing.count + 1 });
    } else {
      totals.set(key, {
        categoryId,
        categoryName,
        ...(t.subcategory !== undefined ? { subcategory: t.subcategory } : {}),
        total: signedAmount,
        count: 1,
      });
    }
  }

  return [...totals.values()].map((v) => ({
    categoryId: v.categoryId,
    categoryName: v.categoryName,
    ...(v.subcategory !== undefined ? { subcategory: v.subcategory } : {}),
    total: v.total,
    transactionCount: v.count,
  }));
}

/**
 * DEC-136: the same canonical grouping key `monthlyCategoryTotals`/
 * `categorySpendingTransactions` use — see `CategoryTotal.categoryId`'s doc
 * comment. Exported so callers (and tests) never need to hardcode the
 * `legacy:` synthetic-key format themselves.
 */
export function categoryGroupId(t: FinancialTransaction): string {
  if (t.categoryId !== undefined) return t.categoryId;
  if (t.category === null || t.category === UNCATEGORIZED) return UNCATEGORIZED;
  return `legacy:${t.category}`;
}

/**
 * DEC-135/136: the actual transactions behind one bucket of
 * `monthlyCategoryTotals` — same filtering (same month, not reversed, not a
 * reconciled duplicate, CONSUMPTION/FEE/REFUND only), so a drill-down list
 * always sums to the total shown alongside it. `categoryId` accepts the
 * literal `UNCATEGORIZED` sentinel to drill into what's still unclassified
 * — see `uncategorizedTransactions` for the analogous "still pending"
 * concept (that one is not month-scoped the same way; kept separate on
 * purpose, see that function's own callers).
 */
export function categorySpendingTransactions(
  transactions: readonly FinancialTransaction[],
  reconciliationLinks: readonly ReconciliationLink[],
  asOfDate: string,
  categoryId: string,
): readonly FinancialTransaction[] {
  const relevant = relevantForConsumption(transactions, reconciliationLinks, asOfDate).filter(
    (t) => isConsumptionLike(t.financialEffect) || t.financialEffect === "REFUND",
  );
  return relevant
    .filter((t) => categoryGroupId(t) === categoryId)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Transactions still awaiting categorization this month. */
export function uncategorizedTransactions(
  transactions: readonly FinancialTransaction[],
  reconciliationLinks: readonly ReconciliationLink[],
  asOfDate: string,
): readonly FinancialTransaction[] {
  return relevantForConsumption(transactions, reconciliationLinks, asOfDate).filter(
    (t) => t.category === null || t.category === UNCATEGORIZED,
  );
}

/** Reconciliation links still awaiting a human decision — possible duplicates, not auto-merged. */
export function reconciliationCandidates(
  links: readonly ReconciliationLink[],
): readonly ReconciliationLink[] {
  return links.filter((l) => l.status === "CANDIDATE");
}
