import type { Id } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import type { FixedExpense } from "./expense";
import type { FinancialTransaction } from "./transaction";
import { isConsumptionLike } from "./financial-effect";
import { isPaymentSourceCoveredByCardBalance, parseInstallmentMarker } from "./installment";
import { excludedTransactionIds, type ReconciliationLink } from "./reconciliation";
import { lastNCompletedMonthKeys, dayOfMonth, monthKey } from "../snapshot/date-utils";

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
  /**
   * The most recent evidence transaction's payment source — informational/
   * drill-down only (e.g. "this is usually charged to card X"). Never used
   * by `reconcileRecurringFixedCommitments` to decide card coverage — a
   * known CURRENT balance on this HISTORICAL card is not proof a future,
   * not-yet-posted charge is already inside it (see that function's own
   * doc comment, DEC-142). Coverage is decided from the ACTUAL transaction
   * that realizes this month's occurrence, not from history.
   */
  readonly paymentSourceId?: Id<"payment-source">;
  /** Arithmetic mean of the observed amount across `evidenceMonths` — see this module's own doc comment: varying amounts are expected, not a disqualifier. */
  readonly predictedAmount: Money;
  /**
   * DEC-141: the median day-of-month across evidence occurrences — a
   * robust, simple V1 "expected occurrence day" that never requires exact
   * date equality (rent on the 10th/10th/11th -> ~10; electricity on the
   * 18th/20th/19th -> ~19). Informational/drill-down only for now — the
   * current-month reconciliation (`reconcileRecurringFixedCommitments`)
   * decides "realized or not" purely from whether the identity has ALREADY
   * occurred this month, never from comparing today's date against this
   * expected day.
   */
  readonly expectedDayOfMonth: number;
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

function mostRecent(transactions: readonly FinancialTransaction[]): FinancialTransaction {
  return [...transactions].sort((a, b) => b.date.localeCompare(a.date))[0]!;
}

/** DEC-141: the median day-of-month across `dates` — see `RecurringFixedCommitment.expectedDayOfMonth`'s own doc comment. */
function medianDayOfMonth(dates: readonly string[]): number {
  const days = dates.map((d) => dayOfMonth(d)).sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  return days.length % 2 === 0 ? Math.round((days[mid - 1]! + days[mid]!) / 2) : days[mid]!;
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

    const { categoryId, paymentSource } = mostRecent(group);
    commitments.push({
      identity,
      ...(categoryId !== undefined ? { categoryId } : {}),
      paymentSourceId: paymentSource.id,
      predictedAmount,
      expectedDayOfMonth: medianDayOfMonth(group.map((t) => t.date)),
      evidenceMonths: requiredMonths,
      transactionIds: group.map((t) => t.id),
      origin: "HISTORY_INFERRED",
    });
  }

  return commitments;
}

export interface ReconciledFixedCommitment {
  readonly identity: string;
  readonly predictedAmount: Money;
  /** `ZERO` when deduped against a declared `FixedExpense`, covered by a known card balance, or already realized this month — `predictedAmount` otherwise. This is the ONLY field that may ever reduce liquidity. */
  readonly remainingAmount: Money;
  readonly realizedThisMonth: boolean;
  readonly dedupedAgainstDeclared: boolean;
  readonly coveredByCardBalance: boolean;
}

export interface ReconciledFixedCommitments {
  /** Sum of every entry's `remainingAmount` — feeds `FinancialSnapshotInput.inferredUpcomingFixedCommitments`, nothing else. */
  readonly total: Money;
  readonly entries: readonly ReconciledFixedCommitment[];
}

function normalizeIdentityText(text: string): string {
  return text.trim().toUpperCase();
}

/**
 * DEC-141: conservative, bidirectional containment match between a
 * DECLARED `FixedExpense.label` (free text the user typed, e.g. "Aluguel")
 * and a detected pattern's `identity` (a normalized merchant/description,
 * e.g. "ALUGUEL APTO 302") — exact match after normalizing is the common
 * case, containment either direction covers a label that's a short form of
 * a longer identity (or vice versa). Deliberately never compares against
 * `Category.name` — a category is presentation, not identity (see this
 * module's own top-of-file doc comment).
 */
function matchesDeclaredLabel(identity: string, label: string): boolean {
  const a = normalizeIdentityText(identity);
  const b = normalizeIdentityText(label);
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * DEC-141/DEC-142: reconciles DETECTED recurring-fixed commitments
 * (HISTORY_INFERRED, from `detectRecurringFixedCommitments`) against the
 * CURRENT month's real transactions and against DECLARED planning
 * knowledge, to answer "how much of this profile's predicted monthly
 * fixed spending is still a real, unpaid, forward obligation right now" —
 * the ONLY number from this module that may ever reduce liquidity (see
 * `FinancialSnapshotInput.inferredUpcomingFixedCommitments`). The MONTHLY
 * FORECAST itself (`RecurringFixedCommitment.predictedAmount`, what
 * Planning's "Compromissos fixos" card shows) is completely untouched by
 * this function — a deduped/realized pattern still shows its normal
 * predicted amount there, it just contributes `ZERO` here.
 *
 * Checked in this order:
 * 1. **Precedence over declared knowledge**: a declared `FixedExpense`
 *    whose `label` plausibly names the SAME real-world obligation
 *    (`matchesDeclaredLabel`) means the user (or a prior confirmed
 *    inference) already established this as planning knowledge —
 *    `USER_DECLARED`/`USER_CONFIRMED_HISTORY` always outrank a bare
 *    `HISTORY_INFERRED` guess. That declared record has its OWN
 *    reconciliation already (`snapshot.ts`'s `unrealizedFixed`) — this
 *    function contributes nothing for it, never a second obligation.
 * 2. **Not yet realized this month → the full predicted amount is still
 *    owed, PERIOD** — this holds EVEN WHEN the pattern's usual payment
 *    source is a credit card with a currently-known balance (DEC-142
 *    correction: an unposted future charge is never already inside a
 *    balance that only reflects what has ALREADY posted — a known
 *    CURRENT card balance is never proof a FUTURE, not-yet-charged
 *    transaction is already counted inside it). "Realized this month" is
 *    decided purely by whether a transaction with this SAME identity
 *    (`recurrenceIdentity` — never `Category.name`, never a separate
 *    heuristic) has posted in `asOfDate`'s own calendar month; it never
 *    requires the current date to have passed `expectedDayOfMonth` (a
 *    bill due later this month is still a real forward obligation today).
 * 3. **Realized this month, on a NON-card account** → the money already
 *    left that account and is already reflected in the current cash
 *    balance — contributes `ZERO`.
 * 4. **Realized this month, on a CREDIT CARD whose balance is currently
 *    KNOWN** → the obligation has moved from "inferred future commitment"
 *    to "already inside `CARD_OBLIGATIONS`" (the exact same coverage rule
 *    `isInstallmentCoveredByCardBalance` already applies to installments,
 *    via the shared `isPaymentSourceCoveredByCardBalance`) — contributes
 *    `ZERO`, since counting it again here would double it.
 * 5. **Realized this month, on a credit card whose balance is UNKNOWN** →
 *    conservative fallback: the obligation must never simply disappear
 *    just because it moved payment rails — it stays counted as owed.
 */
export function reconcileRecurringFixedCommitments(
  commitments: readonly RecurringFixedCommitment[],
  declaredFixedExpenses: readonly FixedExpense[],
  transactions: readonly FinancialTransaction[],
  asOfDate: string,
  cardPaymentSourceIds: ReadonlySet<Id<"payment-source">>,
  cardBalanceKnown: boolean,
): ReconciledFixedCommitments {
  const currentMonth = monthKey(asOfDate);
  const eligibleThisMonth = transactions.filter(
    (t) => monthKey(t.date) === currentMonth && isConsumptionLike(t.financialEffect) && t.status !== "REVERSED",
  );
  // First match per identity — if more than one transaction shares an
  // identity this month, which one "represents" the realization doesn't
  // change the outcome for any of the card-vs-not-card branches below in
  // practice, so the first is a reasonable, deterministic choice.
  const realizedTransactionByIdentity = new Map<string, FinancialTransaction>();
  for (const t of eligibleThisMonth) {
    const identity = recurrenceIdentity(t);
    if (!realizedTransactionByIdentity.has(identity)) {
      realizedTransactionByIdentity.set(identity, t);
    }
  }

  const entries: ReconciledFixedCommitment[] = commitments.map((commitment) => {
    const dedupedAgainstDeclared = declaredFixedExpenses.some((e) =>
      matchesDeclaredLabel(commitment.identity, e.label),
    );

    const realizedTransaction = realizedTransactionByIdentity.get(commitment.identity);
    const realizedThisMonth = realizedTransaction !== undefined;

    let remainingAmount: Money;
    let coveredByCardBalance = false;

    if (dedupedAgainstDeclared) {
      remainingAmount = M.ZERO;
    } else if (!realizedThisMonth) {
      // Not yet posted — still owed, regardless of which payment source it
      // usually posts to. See this function's own doc comment, point 2.
      remainingAmount = commitment.predictedAmount;
    } else if (realizedTransaction.paymentSource.type !== "CREDIT_CARD") {
      remainingAmount = M.ZERO;
    } else {
      coveredByCardBalance = isPaymentSourceCoveredByCardBalance(
        realizedTransaction.paymentSource.id,
        cardPaymentSourceIds,
        cardBalanceKnown,
      );
      remainingAmount = coveredByCardBalance ? M.ZERO : commitment.predictedAmount;
    }

    return {
      identity: commitment.identity,
      predictedAmount: commitment.predictedAmount,
      remainingAmount,
      realizedThisMonth,
      dedupedAgainstDeclared,
      coveredByCardBalance,
    };
  });

  return { total: M.sum(entries.map((e) => e.remainingAmount)), entries };
}
