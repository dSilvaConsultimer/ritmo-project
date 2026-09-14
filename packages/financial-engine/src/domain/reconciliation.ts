import type { Id } from "@money-copilot/shared";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import type { FinancialTransaction } from "./transaction";
import type { FinancialEvent, FinancialEventLineItem } from "./event";

/**
 * How confident a match between two records is. HIGH and MEDIUM matches may
 * be auto-reconciled; LOW matches must surface as a candidate for a human
 * to confirm or reject — never silently merged (RULE #12, and the Sprint 2
 * "manual vs. later-imported" scenario).
 */
export type MatchConfidence = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export type ReconciliationMethod =
  | "PROVIDER_ID"
  | "STABLE_SOURCE_ID"
  | "FINGERPRINT"
  | "MANUAL";

export type ReconciliationLinkType = "TRANSACTION_TRANSACTION" | "TRANSACTION_EVENT_LINE_ITEM";

export type ReconciliationStatus = "CONFIRMED" | "CANDIDATE" | "REJECTED";

/**
 * Links two records that represent the same real-world financial movement
 * so it is never counted twice. See RULE #12 and the rodeo-ticket /
 * manual-vs-imported scenarios in `docs/FINANCIAL-ENGINE.md`.
 */
export interface ReconciliationLink {
  readonly id: Id<"reconciliation-link">;
  /**
   * Sprint 9: reconciliation must never compare/merge economic data across
   * profiles — this is what makes the link's own persistence and every
   * lookup of it profile-scoped rather than global. Always the SAME
   * profile as `primaryTransactionId` (and `linkedTransactionId`/
   * `linkedEventLineItemId`, when present) — never stamped independently.
   */
  readonly financialProfileId: Id<"financial-profile">;
  readonly type: ReconciliationLinkType;
  /** The record retained as the source of truth for downstream calculations. */
  readonly primaryTransactionId: Id<"transaction">;
  readonly linkedTransactionId?: Id<"transaction">;
  readonly linkedEventLineItemId?: Id<"event-line-item">;
  readonly confidence: MatchConfidence;
  readonly method: ReconciliationMethod;
  readonly status: ReconciliationStatus;
  readonly createdAt: string;
}

/**
 * The content identity of a reconciliation link — independent of its own
 * `id`, which `findTransactionDuplicates`/`reconcileEventLineItems`
 * generate fresh (via `createId()`) on every call, by design: a real sync
 * re-scans the full transaction set every time and must be free to
 * propose the same candidate again without caring what id a previous
 * proposal used. A caller that persists these links (e.g.
 * `app-services/src/sync.ts`'s `reconcileProfile`, or `persistence`'s
 * `seed()`) MUST dedupe by this key before upserting — matching on `id`
 * alone is not sufficient, since two calls describing the SAME real-world
 * link will have DIFFERENT `id`s. See docs/DECISIONS.md DEC-049.
 */
export function reconciliationLinkPairKey(link: ReconciliationLink): string {
  return `${link.financialProfileId}:${link.type}:${link.primaryTransactionId}:${link.linkedTransactionId ?? link.linkedEventLineItemId ?? ""}`;
}

const FINGERPRINT_DATE_TOLERANCE_DAYS = 3;

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(`${isoA}T00:00:00Z`);
  const b = Date.parse(`${isoB}T00:00:00Z`);
  return Math.abs(a - b) / (24 * 60 * 60 * 1000);
}

function normalizedKey(t: FinancialTransaction): string | undefined {
  return t.normalizedMerchant ?? (t.normalizedDescription || undefined);
}

/**
 * A deterministic fallback identity for a transaction, used when no
 * provider identifier is available. Never used alone to auto-merge with
 * high confidence unless every component matches exactly — see
 * `matchTransactions`.
 */
export function computeFingerprint(t: FinancialTransaction): string {
  return [t.paymentSource.type, t.amount.cents, t.date, normalizedKey(t) ?? "", t.direction].join(
    "|",
  );
}

/**
 * Compares two transactions and returns how confident the match is, and by
 * what method. Preferred order (per RULE #12): provider identifier, then
 * stable source identifier, then a deterministic fingerprint (exact or
 * date-tolerant), then no match.
 */
export function matchTransactions(
  a: FinancialTransaction,
  b: FinancialTransaction,
): { confidence: MatchConfidence; method: ReconciliationMethod } {
  if (
    a.externalProviderId &&
    b.externalProviderId &&
    a.externalProviderId === b.externalProviderId &&
    a.externalTransactionId &&
    b.externalTransactionId &&
    a.externalTransactionId === b.externalTransactionId
  ) {
    return { confidence: "HIGH", method: "PROVIDER_ID" };
  }

  if (
    a.externalTransactionId &&
    b.externalTransactionId &&
    a.externalTransactionId === b.externalTransactionId &&
    a.paymentSource.id === b.paymentSource.id
  ) {
    return { confidence: "HIGH", method: "STABLE_SOURCE_ID" };
  }

  const sameCore =
    M.equals(a.amount, b.amount) &&
    a.direction === b.direction &&
    a.paymentSource.type === b.paymentSource.type;

  if (!sameCore) {
    return { confidence: "NONE", method: "FINGERPRINT" };
  }

  const keyA = normalizedKey(a);
  const keyB = normalizedKey(b);
  const sameMerchant = keyA !== undefined && keyA === keyB;
  const dateDelta = daysBetween(a.date, b.date);

  if (sameMerchant && dateDelta === 0) {
    return { confidence: "HIGH", method: "FINGERPRINT" };
  }
  if (sameMerchant && dateDelta <= FINGERPRINT_DATE_TOLERANCE_DAYS) {
    return { confidence: "MEDIUM", method: "FINGERPRINT" };
  }
  // Amount/direction/source agree but merchant identity is uncertain or
  // dates are far apart: a plausible but unconfirmed duplicate.
  return { confidence: "LOW", method: "FINGERPRINT" };
}

function statusForConfidence(confidence: MatchConfidence): ReconciliationStatus {
  return confidence === "HIGH" || confidence === "MEDIUM" ? "CONFIRMED" : "CANDIDATE";
}

/**
 * Scans a list of transactions for likely duplicates (e.g. a manual entry
 * later confirmed by an imported record) and proposes links. HIGH/MEDIUM
 * confidence links are auto-CONFIRMED; LOW confidence becomes a CANDIDATE
 * that a human must resolve — never silently merged.
 */
export function findTransactionDuplicates(
  transactions: readonly FinancialTransaction[],
): ReconciliationLink[] {
  const links: ReconciliationLink[] = [];
  const linked = new Set<string>();

  for (let i = 0; i < transactions.length; i += 1) {
    const a = transactions[i]!;
    if (linked.has(a.id)) continue;
    for (let j = i + 1; j < transactions.length; j += 1) {
      const b = transactions[j]!;
      if (linked.has(b.id)) continue;
      const { confidence, method } = matchTransactions(a, b);
      if (confidence === "NONE") continue;

      const status = statusForConfidence(confidence);
      links.push({
        id: createId("reconciliation-link"),
        financialProfileId: a.financialProfileId,
        type: "TRANSACTION_TRANSACTION",
        primaryTransactionId: a.id,
        linkedTransactionId: b.id,
        confidence,
        method,
        status,
        createdAt: a.createdAt,
      });
      if (status === "CONFIRMED") {
        linked.add(a.id);
        linked.add(b.id);
      }
      break;
    }
  }

  return links;
}

/**
 * Links ALREADY_PAID event line items to the transaction that actually
 * represents them (e.g. the rodeo ticket), so the amount is counted once —
 * from the transaction going forward — instead of once from the event and
 * once from the transaction. Only links when exactly one unambiguous
 * candidate transaction exists for a line item; otherwise leaves it
 * unlinked rather than guessing.
 */
export function reconcileEventLineItems(
  events: readonly FinancialEvent[],
  transactions: readonly FinancialTransaction[],
): ReconciliationLink[] {
  const links: ReconciliationLink[] = [];
  const claimed = new Set<string>();

  for (const event of events) {
    for (const item of event.lineItems) {
      if (item.status !== "ALREADY_PAID" || item.amount === null) continue;

      const candidates = transactions.filter(
        (t) =>
          !claimed.has(t.id) &&
          M.equals(t.amount, item.amount as NonNullable<FinancialEventLineItem["amount"]>) &&
          t.direction === "DEBIT" &&
          daysBetween(t.date, event.startDate) <= FINGERPRINT_DATE_TOLERANCE_DAYS,
      );

      if (candidates.length === 1) {
        const transaction = candidates[0]!;
        claimed.add(transaction.id);
        links.push({
          id: createId("reconciliation-link"),
          financialProfileId: transaction.financialProfileId,
          type: "TRANSACTION_EVENT_LINE_ITEM",
          primaryTransactionId: transaction.id,
          linkedEventLineItemId: item.id,
          confidence: "HIGH",
          method: "FINGERPRINT",
          status: "CONFIRMED",
          createdAt: transaction.createdAt,
        });
      }
    }
  }

  return links;
}

/**
 * The set of transaction ids that must be EXCLUDED from a fresh
 * actual-spending sum because a CONFIRMED reconciliation link already
 * accounts for them elsewhere (via the event breakdown, or via their
 * paired primary transaction).
 */
export function excludedTransactionIds(links: readonly ReconciliationLink[]): ReadonlySet<string> {
  const excluded = new Set<string>();
  for (const link of links) {
    if (link.status !== "CONFIRMED") continue;
    if (link.type === "TRANSACTION_EVENT_LINE_ITEM") {
      excluded.add(link.primaryTransactionId);
    } else if (link.type === "TRANSACTION_TRANSACTION" && link.linkedTransactionId) {
      // Keep the primary, exclude the linked duplicate.
      excluded.add(link.linkedTransactionId);
    }
  }
  return excluded;
}
