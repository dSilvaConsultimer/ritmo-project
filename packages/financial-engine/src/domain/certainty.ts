import type { Money } from "../money/index";

/**
 * Certainty distinguishes how reliable a financial figure is.
 * This is central to the product: unknown future commitments must be
 * visible, never silently treated as zero. See NON-NEGOTIABLE RULE #9, #16, #17.
 *
 * - ACTUAL: already happened; a fact (e.g. a paid ticket, a posted transaction).
 * - CONFIRMED: has not happened yet, but the amount is contractually/practically fixed
 *   (e.g. rent, a confirmed van fare).
 * - ESTIMATED: has not happened yet and the amount is an approximation
 *   (e.g. expected drinks spend, an approximate credit card bill).
 * - UNKNOWN: the commitment is confirmed to exist, but no amount has been assigned yet
 *   (e.g. a beach trip with no budget set). Must never be treated as zero.
 */
export type Certainty = "ACTUAL" | "CONFIRMED" | "ESTIMATED" | "UNKNOWN";

/**
 * A monetary amount paired with its certainty. `amount` is `null` only when
 * `certainty` is `UNKNOWN` — the amount genuinely has not been determined yet.
 */
export interface CertainAmount {
  readonly certainty: Certainty;
  readonly amount: Money | null;
}

export function actual(amount: Money): CertainAmount {
  return { certainty: "ACTUAL", amount };
}

export function confirmed(amount: Money): CertainAmount {
  return { certainty: "CONFIRMED", amount };
}

export function estimated(amount: Money): CertainAmount {
  return { certainty: "ESTIMATED", amount };
}

export function unknownAmount(): CertainAmount {
  return { certainty: "UNKNOWN", amount: null };
}

/** True when the amount is not yet known and must not be treated as zero. */
export function isUnknown(value: CertainAmount): boolean {
  return value.certainty === "UNKNOWN";
}

const CERTAINTY_RANK: Record<Certainty, number> = {
  ACTUAL: 0,
  CONFIRMED: 1,
  ESTIMATED: 2,
  UNKNOWN: 3,
};

/** The least-certain value among a set — used to label a derived/aggregate figure honestly. */
export function worstCertainty(values: readonly Certainty[]): Certainty {
  if (values.length === 0) return "ACTUAL";
  return values.reduce((worst, v) => (CERTAINTY_RANK[v] > CERTAINTY_RANK[worst] ? v : worst));
}
