import type { Id } from "@money-copilot/shared";
import type { FinancialTransaction } from "./transaction";

export const UNCATEGORIZED = "UNCATEGORIZED" as const;

export interface Category {
  readonly id: Id<"category">;
  readonly name: string;
}

export type CategoryRuleMatchType =
  | "EXACT_MERCHANT"
  | "CONTAINS_MERCHANT"
  | "CONTAINS_DESCRIPTION"
  | "REGEX_DESCRIPTION";

/**
 * A deterministic categorization rule — no LLM, no guessing. Rules are
 * evaluated by descending `priority`; the first match wins. A transaction
 * matching no rule stays `UNCATEGORIZED` rather than being force-fit into a
 * guessed category (RULE: "do not guess aggressively").
 */
export interface CategoryRule {
  readonly id: Id<"category-rule">;
  readonly matchType: CategoryRuleMatchType;
  readonly pattern: string;
  readonly category: string;
  readonly subcategory?: string;
  readonly priority: number;
}

/**
 * Safety caps for REGEX_DESCRIPTION rules. This is a pragmatic guard
 * (length limits + try/catch), not a formal ReDoS proof — regex rules
 * should stay simple and be reviewed when added. See docs/FINANCIAL-ENGINE.md.
 */
const MAX_REGEX_PATTERN_LENGTH = 200;
const MAX_MATCH_SUBJECT_LENGTH = 500;

function safeRegexTest(pattern: string, subject: string): boolean {
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) return false;
  const boundedSubject = subject.slice(0, MAX_MATCH_SUBJECT_LENGTH);
  try {
    return new RegExp(pattern, "i").test(boundedSubject);
  } catch {
    return false;
  }
}

function ruleMatches(rule: CategoryRule, t: FinancialTransaction): boolean {
  const merchant = (t.normalizedMerchant ?? "").toUpperCase();
  const description = (t.normalizedDescription || t.rawDescription).toUpperCase();
  const pattern = rule.pattern.toUpperCase();

  switch (rule.matchType) {
    case "EXACT_MERCHANT":
      return merchant !== "" && merchant === pattern;
    case "CONTAINS_MERCHANT":
      return merchant !== "" && merchant.includes(pattern);
    case "CONTAINS_DESCRIPTION":
      return description.includes(pattern);
    case "REGEX_DESCRIPTION":
      return safeRegexTest(rule.pattern, description);
    default:
      return false;
  }
}

export interface CategorizationResult {
  readonly category: string;
  readonly subcategory?: string;
  readonly matchedRuleId?: Id<"category-rule">;
}

/**
 * Categorizes a transaction deterministically against a prioritized rule
 * set. Falls back to `UNCATEGORIZED` when nothing matches.
 */
export function categorize(
  transaction: FinancialTransaction,
  rules: readonly CategoryRule[],
): CategorizationResult {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  for (const rule of sorted) {
    if (ruleMatches(rule, transaction)) {
      return {
        category: rule.category,
        ...(rule.subcategory !== undefined ? { subcategory: rule.subcategory } : {}),
        matchedRuleId: rule.id,
      };
    }
  }
  return { category: UNCATEGORIZED };
}
