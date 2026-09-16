import type { Id } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import type { FinancialTransaction } from "./transaction";
import { isConsumptionLike } from "./financial-effect";
import { parseInstallmentMarker } from "./installment";
import { excludedTransactionIds, type ReconciliationLink } from "./reconciliation";
import { lastNCompletedMonthKeys, monthKey } from "../snapshot/date-utils";

/**
 * DEC-140: "fixed" means PREDICTABLE/RECURRING, never "same amount every
 * time" — rent is fixed even though it's always BRL 1,500; electricity is
 * equally fixed even though it's BRL 180 one month and BRL 240 the next.
 * Category is presentation, never recurrence evidence: a category like
 * "Despesas de casa" may contain several INDEPENDENTLY recurring
 * identities (rent, condo fee, electricity) alongside genuinely one-off
 * purchases — each transaction identity is evaluated on its own history,
 * never inferred from the category it happens to carry.
 */
export type RecurringFixedOrigin = "HISTORY_INFERRED" | "USER_CONFIRMED_HISTORY" | "USER_DECLARED";

export interface RecurringFixedCommitment {
  /** The normalized merchant (preferred) or normalized/raw description this pattern was detected under — see `recurrenceIdentity`. */
  readonly identity: string;
  /** The most recent evidence transaction's category, when it has one — informational only, never used to decide recurrence. */
  readonly categoryId?: Id<"category">;
  /** Arithmetic mean of the observed amount across `evidenceMonths` — see this module's own doc comment: varying amounts are expected, not a disqualifier. */
  readonly predictedAmount: Money;
  readonly evidenceMonths: readonly string[];
  readonly transactionIds: readonly Id<"transaction">[];
  /** V1: always `HISTORY_INFERRED` — a caller that has independently confirmed or declared this pattern may relabel it (see `RecurringFixedOrigin`'s own doc comment); this detector never fabricates the stronger provenances itself. */
  readonly origin: RecurringFixedOrigin;
}

const MIN_CONSECUTIVE_MONTHS = 3;

/** Prefers the normalized merchant; falls back to the normalized (or raw) description — the same merchant-then-description fallback `ruleMatchesTransaction` already uses, so an identity that predates a distinct merchant field is still recognized rather than silently skipped. */
function recurrenceIdentity(t: FinancialTransaction): string {
  if (t.normalizedMerchant) return t.normalizedMerchant;
  return (t.normalizedDescription || t.rawDescription).toUpperCase();
}

function mostRecentCategoryId(transactions: readonly FinancialTransaction[]): Id<"category"> | undefined {
  const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  return sorted[0]?.categoryId;
}

/**
 * DEC-140: detects PREDICTABLE recurring commitments from real transaction
 * behavior — never from category, never from amount equality. A pattern
 * qualifies when the SAME identity (merchant, or description when no
 * merchant is known) has at least one eligible transaction in EACH of the
 * last `MIN_CONSECUTIVE_MONTHS` (3) fully completed calendar months
 * (`lastNCompletedMonthKeys` — the current, possibly partial month is
 * never evidence). Amounts are averaged, never required to match — see
 * `RecurringFixedCommitment.predictedAmount`.
 *
 * Excludes:
 * - anything already reconciled away (`excludedTransactionIds` — the same
 *   exclusion `monthlyCategoryTotals`/`reporting.ts` already applies, so a
 *   transaction absorbed into an event's own reservation is never
 *   double-counted as a personal recurring pattern too);
 * - anything not consumption-like (`isConsumptionLike` — CONSUMPTION/FEE
 *   only, the same rule every other spending view in this engine uses);
 * - anything carrying a finite installment marker (`parseInstallmentMarker`)
 *   — an installment is a FINITE forward obligation already represented by
 *   the canonical card-balance/`InstallmentPlan` machinery, never an
 *   indefinitely-repeating "fixed commitment." A genuine subscription
 *   charged to a card (e.g. Netflix) carries no such marker and is
 *   evaluated normally.
 */
export function detectRecurringFixedCommitments(
  transactions: readonly FinancialTransaction[],
  reconciliationLinks: readonly ReconciliationLink[],
  asOfDate: string,
): readonly RecurringFixedCommitment[] {
  const excluded = excludedTransactionIds(reconciliationLinks);
  const requiredMonths = lastNCompletedMonthKeys(asOfDate, MIN_CONSECUTIVE_MONTHS);
  const requiredMonthSet = new Set(requiredMonths);

  const eligible = transactions.filter(
    (t) =>
      !excluded.has(t.id) &&
      t.status !== "REVERSED" &&
      isConsumptionLike(t.financialEffect) &&
      requiredMonthSet.has(monthKey(t.date)) &&
      parseInstallmentMarker(t.normalizedDescription || t.rawDescription) === null,
  );

  const groups = new Map<string, FinancialTransaction[]>();
  for (const t of eligible) {
    const identity = recurrenceIdentity(t);
    const list = groups.get(identity) ?? [];
    list.push(t);
    groups.set(identity, list);
  }

  const commitments: RecurringFixedCommitment[] = [];
  for (const [identity, group] of groups) {
    const presentMonths = new Set(group.map((t) => monthKey(t.date)));
    if (!requiredMonths.every((mk) => presentMonths.has(mk))) continue;

    const perMonthTotals = requiredMonths.map((mk) =>
      M.sum(group.filter((t) => monthKey(t.date) === mk).map((t) => t.amount)),
    );
    const predictedAmount = M.fromCents(
      Math.round(perMonthTotals.reduce((sum, a) => sum + a.cents, 0) / perMonthTotals.length),
    );

    const categoryId = mostRecentCategoryId(group);
    commitments.push({
      identity,
      ...(categoryId !== undefined ? { categoryId } : {}),
      predictedAmount,
      evidenceMonths: requiredMonths,
      transactionIds: group.map((t) => t.id),
      origin: "HISTORY_INFERRED",
    });
  }

  return commitments;
}
