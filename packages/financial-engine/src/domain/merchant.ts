import type { Id } from "@money-copilot/shared";

export type MerchantMatchType = "EXACT" | "CONTAINS" | "PREFIX";

/**
 * A deterministic rule mapping raw merchant/description text to a
 * canonical normalized merchant name. E.g. "LOCALIZAGF42", "LOCALIZA RAC",
 * "LOCALIZA RENT" all normalize to "LOCALIZA" via a single CONTAINS rule.
 * Normalization NEVER destroys the raw source text — callers must keep
 * both (`rawMerchant`/`rawDescription` alongside `normalizedMerchant`).
 */
export interface MerchantNormalizationRule {
  readonly id: Id<"merchant-rule">;
  readonly matchType: MerchantMatchType;
  /** Matched case-insensitively against the raw text. */
  readonly pattern: string;
  readonly normalizedMerchant: string;
  /** Higher priority is evaluated first; ties broken by array order. */
  readonly priority: number;
}

function normalizeForMatching(raw: string): string {
  return raw.trim().toUpperCase();
}

function ruleMatches(rule: MerchantNormalizationRule, subject: string): boolean {
  const pattern = rule.pattern.toUpperCase();
  switch (rule.matchType) {
    case "EXACT":
      return subject === pattern;
    case "PREFIX":
      return subject.startsWith(pattern);
    case "CONTAINS":
      return subject.includes(pattern);
    default:
      return false;
  }
}

/**
 * Applies the highest-priority matching rule to raw merchant/description
 * text. Returns `undefined` when no rule matches — callers should then fall
 * back to the raw text for display, but must not fabricate a normalized
 * value.
 */
export function normalizeMerchant(
  raw: string,
  rules: readonly MerchantNormalizationRule[],
): string | undefined {
  const subject = normalizeForMatching(raw);
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (ruleMatches(rule, subject)) {
      return rule.normalizedMerchant;
    }
  }
  return undefined;
}
