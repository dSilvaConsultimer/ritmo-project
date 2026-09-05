import type { Id } from "@money-copilot/shared";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { Money } from "../money/index";
import type { FinancialTransaction } from "./transaction";

export type RecurringCandidateStatus = "CANDIDATE" | "CONFIRMED" | "REJECTED";
export type RecurringCandidateConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface RecurringCandidateEvidence {
  readonly occurrences: number;
  readonly transactionIds: readonly Id<"transaction">[];
  readonly averageAmount: Money;
  readonly averageIntervalDays: number | null;
}

/**
 * A detected pattern that MIGHT be a recurring expense (e.g. a
 * subscription) — never automatically declared one. A human confirms or
 * rejects it; a rejected candidate must not immediately reappear from the
 * same evidence (`evidenceKey` stays stable for the same merchant+amount
 * bucket, so callers can suppress it — see `detectRecurringCandidates`).
 */
export interface RecurringExpenseCandidate {
  readonly id: Id<"recurring-candidate">;
  readonly evidenceKey: string;
  readonly normalizedMerchant: string;
  readonly evidence: RecurringCandidateEvidence;
  readonly confidence: RecurringCandidateConfidence;
  readonly status: RecurringCandidateStatus;
  readonly createdAt: string;
}

export interface RecurringDecision {
  readonly evidenceKey: string;
  readonly status: "CONFIRMED" | "REJECTED";
}

const MIN_OCCURRENCES = 2;
const AMOUNT_TOLERANCE_RATIO = 0.1;
const MIN_CADENCE_DAYS = 20;
const MAX_CADENCE_DAYS = 40;
/** Cents bucket width used to build a stable evidence key across small price drift. */
const AMOUNT_BUCKET_CENTS = 100;

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(`${isoA}T00:00:00Z`);
  const b = Date.parse(`${isoB}T00:00:00Z`);
  return Math.abs(a - b) / (24 * 60 * 60 * 1000);
}

function amountsAreSimilar(amounts: readonly Money[]): boolean {
  const cents = amounts.map((a) => a.cents);
  const min = Math.min(...cents);
  const max = Math.max(...cents);
  if (min === 0) return max === 0;
  return (max - min) / min <= AMOUNT_TOLERANCE_RATIO;
}

function averageIntervalDays(dates: readonly string[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort();
  let total = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    total += daysBetween(sorted[i - 1]!, sorted[i]!);
  }
  return total / (sorted.length - 1);
}

/**
 * Groups transactions by (normalized merchant, amount bucket) — NOT by
 * merchant alone — and flags plausible recurring patterns (similar amount,
 * roughly monthly cadence, 2+ occurrences). Bucketing by amount up front
 * means a genuine price change (e.g. a subscription going from BRL 39.90 to
 * BRL 55.90) forms its own distinct evidence group rather than being
 * blended with the old price into one inconsistent-amount group. Candidates
 * whose `evidenceKey` matches a prior REJECTED decision are suppressed;
 * a materially different amount produces a different key and may resurface,
 * honoring "should not immediately reappear from the same evidence."
 */
export function detectRecurringCandidates(
  transactions: readonly FinancialTransaction[],
  priorDecisions: readonly RecurringDecision[] = [],
): RecurringExpenseCandidate[] {
  const rejectedKeys = new Set(
    priorDecisions.filter((d) => d.status === "REJECTED").map((d) => d.evidenceKey),
  );

  const groups = new Map<string, FinancialTransaction[]>();
  for (const t of transactions) {
    if (!t.normalizedMerchant) continue;
    const bucket = Math.round(t.amount.cents / AMOUNT_BUCKET_CENTS) * AMOUNT_BUCKET_CENTS;
    const key = `${t.normalizedMerchant}:${bucket}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const candidates: RecurringExpenseCandidate[] = [];

  for (const [evidenceKey, group] of groups) {
    if (group.length < MIN_OCCURRENCES) continue;
    const merchant = group[0]!.normalizedMerchant!;

    const amounts = group.map((t) => t.amount);
    const dates = group.map((t) => t.date);
    const similarAmounts = amountsAreSimilar(amounts);
    const interval = averageIntervalDays(dates);
    const monthlyCadence =
      interval !== null && interval >= MIN_CADENCE_DAYS && interval <= MAX_CADENCE_DAYS;

    const averageAmount = M.fromCents(
      Math.round(amounts.reduce((sum, a) => sum + a.cents, 0) / amounts.length),
    );
    if (rejectedKeys.has(evidenceKey)) continue;

    let confidence: RecurringCandidateConfidence;
    if (similarAmounts && monthlyCadence && group.length >= 3) {
      confidence = "HIGH";
    } else if (similarAmounts && (monthlyCadence || group.length >= 3)) {
      confidence = "MEDIUM";
    } else if (similarAmounts) {
      confidence = "LOW";
    } else {
      continue; // amounts too inconsistent to be meaningful evidence yet
    }

    candidates.push({
      id: createId("recurring-candidate"),
      evidenceKey,
      normalizedMerchant: merchant,
      evidence: {
        occurrences: group.length,
        transactionIds: group.map((t) => t.id),
        averageAmount,
        averageIntervalDays: interval,
      },
      confidence,
      status: "CANDIDATE",
      createdAt: group.map((t) => t.date).sort().at(-1)!,
    });
  }

  return candidates;
}
