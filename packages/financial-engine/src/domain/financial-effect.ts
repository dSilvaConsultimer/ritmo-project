/**
 * The financial MEANING of a transaction, independent of its raw cash
 * direction. This is what prevents double counting (Sprint 2 NON-NEGOTIABLE
 * RULE): a bank transaction is not automatically an expense, a card bill
 * payment is not a second expense, and a transfer is not consumption.
 *
 * - CONSUMPTION: an actual purchase of goods/services — counts against a
 *   spending category.
 * - INCOME: money received (salary, reimbursement, etc).
 * - TRANSFER: money moved between the user's own accounts/sources — never
 *   consumption.
 * - CARD_PAYMENT: paying off a credit card bill. The underlying purchases
 *   that made up the bill are (or will be) already represented as their own
 *   CONSUMPTION transactions — the payment itself is a cash movement, not a
 *   second expense.
 * - DEBT_PAYMENT: settling a liability/installment that is not itself this
 *   month's fresh consumption (e.g. paying down an old purchase over time).
 * - REFUND: money returned for a prior CONSUMPTION transaction — nets
 *   against that category's spend.
 * - FEE: a bank/service fee — counts against cash flow but is its own
 *   category of "spending," not general consumption misattributed elsewhere.
 * - INVESTMENT: money moved INTO an investment/application product — never
 *   ordinary spending (DEC-132).
 * - INVESTMENT_REDEMPTION: money moved back OUT of an investment product —
 *   never ordinary income (DEC-132).
 */
export type FinancialEffect =
  | "CONSUMPTION"
  | "INCOME"
  | "TRANSFER"
  | "CARD_PAYMENT"
  | "DEBT_PAYMENT"
  | "REFUND"
  | "FEE"
  | "INVESTMENT"
  | "INVESTMENT_REDEMPTION";

/**
 * Effects that represent real economic spending against a budget/category
 * this month. TRANSFER, CARD_PAYMENT, INVESTMENT, and INVESTMENT_REDEMPTION
 * are deliberately excluded — the money they move is either already (or
 * will be) represented by underlying CONSUMPTION/DEBT_PAYMENT transactions,
 * or is capital movement rather than spending. REFUND is handled separately
 * (it nets against consumption rather than adding to it).
 */
export const CONSUMPTION_LIKE_EFFECTS: ReadonlySet<FinancialEffect> = new Set([
  "CONSUMPTION",
  "FEE",
]);

export function isConsumptionLike(effect: FinancialEffect): boolean {
  return CONSUMPTION_LIKE_EFFECTS.has(effect);
}

/**
 * DEC-132: financial effects a human or the AI copilot may explicitly
 * declare for a MANUALLY-entered transaction (never provider-imported,
 * which always goes through `classifyFinancialEffect`). Deliberately
 * excludes CARD_PAYMENT/DEBT_PAYMENT (those are provider-classification-only
 * concepts tied to a specific bill/installment record, not something a
 * free-text manual entry should self-declare) and INCOME (planned income
 * belongs in the `Income` domain, not a manual transaction record).
 */
export type ManualEntryFinancialEffect =
  | "CONSUMPTION"
  | "TRANSFER"
  | "REFUND"
  | "INVESTMENT"
  | "INVESTMENT_REDEMPTION";

/**
 * The natural cash `TransactionDirection` for a manually-declared financial
 * effect, absent any other signal — money leaving the account for
 * CONSUMPTION/TRANSFER/INVESTMENT, money arriving for
 * REFUND/INVESTMENT_REDEMPTION. Exported so `mutations.recordManualTransaction`
 * never re-derives this decision independently.
 */
export function defaultDirectionForManualEntry(
  effect: ManualEntryFinancialEffect,
): "DEBIT" | "CREDIT" {
  return effect === "REFUND" || effect === "INVESTMENT_REDEMPTION" ? "CREDIT" : "DEBIT";
}
