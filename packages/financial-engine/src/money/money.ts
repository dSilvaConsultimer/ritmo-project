/**
 * Money is always represented internally as an integer number of cents.
 * Floating-point arithmetic must never be used for monetary values —
 * see docs/DECISIONS.md DEC-002 and NON-NEGOTIABLE PRODUCT RULE #3.
 */
export interface Money {
  readonly cents: number;
  readonly __brand: "Money";
}

function assertInteger(cents: number): void {
  if (!Number.isInteger(cents)) {
    throw new TypeError(`Money must be an integer number of cents, received ${cents}`);
  }
  if (!Number.isFinite(cents)) {
    throw new TypeError(`Money must be finite, received ${cents}`);
  }
}

/** Construct Money from an already-integer cent amount. Preferred constructor. */
export function fromCents(cents: number): Money {
  assertInteger(cents);
  return { cents, __brand: "Money" };
}

/**
 * Construct Money from a decimal reais amount (e.g. 476.10).
 * Only intended for literal constants in fixtures/tests/UI input parsing —
 * never for chaining computed floating-point values. Rounds to the nearest cent.
 */
export function fromReais(reais: number): Money {
  return fromCents(Math.round(reais * 100));
}

export const ZERO: Money = fromCents(0);

export function add(...values: Money[]): Money {
  return fromCents(values.reduce((total, v) => total + v.cents, 0));
}

export function subtract(a: Money, b: Money): Money {
  return fromCents(a.cents - b.cents);
}

export function negate(a: Money): Money {
  return fromCents(-a.cents);
}

export function abs(a: Money): Money {
  return fromCents(Math.abs(a.cents));
}

/**
 * Scales Money by a dimensionless factor (e.g. a ratio or percentage).
 * Rounds to the nearest cent — the only point where rounding is introduced.
 */
export function scale(a: Money, factor: number): Money {
  return fromCents(Math.round(a.cents * factor));
}

export function sum(values: Money[]): Money {
  return add(...values);
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  if (a.cents < b.cents) return -1;
  if (a.cents > b.cents) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.cents === b.cents;
}

export function isNegative(a: Money): boolean {
  return a.cents < 0;
}

export function isPositive(a: Money): boolean {
  return a.cents > 0;
}

export function isZero(a: Money): boolean {
  return a.cents === 0;
}

export function max(...values: Money[]): Money {
  if (values.length === 0) {
    throw new RangeError("max() requires at least one Money value");
  }
  return values.reduce((m, v) => (v.cents > m.cents ? v : m));
}

export function min(...values: Money[]): Money {
  if (values.length === 0) {
    throw new RangeError("min() requires at least one Money value");
  }
  return values.reduce((m, v) => (v.cents < m.cents ? v : m));
}

/** Floors Money at zero — never returns a negative amount. */
export function floorAtZero(a: Money): Money {
  return max(a, ZERO);
}

/** Converts to a decimal reais number. Display/debugging only — never re-enter calculations with this. */
export function toReais(a: Money): number {
  return a.cents / 100;
}

/** Formats as a pt-BR currency string, e.g. "R$ 1.500,00". */
export function format(a: Money, locale = "pt-BR", currency = "BRL"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(toReais(a));
}
