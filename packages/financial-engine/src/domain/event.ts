import type { Id } from "@money-copilot/shared";
import type { Certainty } from "./certainty";
import type { Money } from "../money/index";
import * as M from "../money/index";

/**
 * Whether a planned event line item has already happened (money already
 * left the account) or is still a future reservation. Already-paid items
 * must be counted once, as actual spending, and never reserved again
 * against future safe-to-spend. See RULE #8 and Sprint 1 test "rodeo".
 */
export type EventLineItemStatus = "ALREADY_PAID" | "PLANNED";

export interface FinancialEventLineItem {
  readonly id: Id<"event-line-item">;
  readonly label: string;
  /** Null only when certainty is UNKNOWN. */
  readonly amount: Money | null;
  readonly certainty: Certainty;
  readonly status: EventLineItemStatus;
}

/**
 * A planned or ongoing real-world event with financial impact
 * (e.g. a trip), made up of one or more line items that may individually
 * be already-paid, confirmed, estimated, or entirely unknown in amount.
 */
export interface FinancialEvent {
  readonly id: Id<"financial-event">;
  readonly label: string;
  /** ISO 8601 dates. */
  readonly startDate: string;
  readonly endDate: string;
  readonly lineItems: readonly FinancialEventLineItem[];
}

export interface EventReserveBreakdown {
  /** Sum of ALREADY_PAID line items — actual spending, not a future reserve. */
  readonly alreadyPaid: Money;
  /** Sum of PLANNED line items with CONFIRMED or ACTUAL certainty. */
  readonly futureConfirmed: Money;
  /** Sum of PLANNED line items with ESTIMATED certainty. */
  readonly futureEstimated: Money;
  /** Labels of PLANNED line items whose amount is UNKNOWN. */
  readonly unknownLabels: readonly string[];
}

/**
 * Splits an event's line items into what's already spent vs. what still
 * needs to be reserved from future income, by certainty bucket.
 */
export function breakdownEvent(event: FinancialEvent): EventReserveBreakdown {
  const alreadyPaid: Money[] = [];
  const futureConfirmed: Money[] = [];
  const futureEstimated: Money[] = [];
  const unknownLabels: string[] = [];

  for (const item of event.lineItems) {
    if (item.status === "ALREADY_PAID") {
      if (item.amount) alreadyPaid.push(item.amount);
      continue;
    }
    // status === "PLANNED"
    if (item.certainty === "UNKNOWN" || item.amount === null) {
      unknownLabels.push(`${event.label}: ${item.label}`);
    } else if (item.certainty === "ESTIMATED") {
      futureEstimated.push(item.amount);
    } else {
      // ACTUAL or CONFIRMED planned items are treated as firm future reservations.
      futureConfirmed.push(item.amount);
    }
  }

  return {
    alreadyPaid: M.sum(alreadyPaid),
    futureConfirmed: M.sum(futureConfirmed),
    futureEstimated: M.sum(futureEstimated),
    unknownLabels,
  };
}
