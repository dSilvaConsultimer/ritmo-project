import type { Id } from "@money-copilot/shared";
import type { FinancialTransaction } from "./transaction";

export const UNCATEGORIZED = "UNCATEGORIZED" as const;

/**
 * DEC-135: the canonical category identity — previously a completely dead
 * type/table (zero reads or writes anywhere in this codebase). Revived
 * rather than replaced: same shape, ownership semantics now mirror
 * `CategoryRule`'s own DEC-133 model exactly.
 * - `financialProfileId` absent: a BASE category, available to every
 *   profile (e.g. "Transporte," "Assinaturas").
 * - `financialProfileId` present: a PERSONAL category, created by and
 *   visible only to that profile (e.g. Douglas's "Trabalho").
 * `name` is the single source of truth a `CategoryRule`/`FinancialTransaction`
 * ultimately displays — see `CategoryRule.categoryId`'s own doc comment for
 * why transactions/rules still store the resolved name string rather than
 * a foreign key, and what that scoping decision does and doesn't cover.
 */
export interface Category {
  readonly id: Id<"category">;
  readonly name: string;
  readonly financialProfileId?: Id<"financial-profile">;
}

export type CategoryRuleMatchType =
  | "EXACT_MERCHANT"
  | "CONTAINS_MERCHANT"
  | "CONTAINS_DESCRIPTION"
  | "REGEX_DESCRIPTION";

/**
 * DEC-132: where a categorization rule came from — the same provenance
 * discipline as `Income.source` (DEC-130), generalized to rules. A rule
 * created by explicit user correction must never be silently overwritten by
 * a later system inference, and the UI must be able to show the user WHY a
 * rule exists.
 * - SYSTEM_DEFAULT: shipped with the app (e.g. `fixtures/rules.ts`), never
 *   authored by this specific user.
 * - USER_DECLARED: the user explicitly created or confirmed this rule (e.g.
 *   "always classify X as Y").
 * - HISTORY_INFERRED: Ritmo inferred this rule from repeated history but the
 *   user has not confirmed it — never authoritative on its own.
 * - USER_CONFIRMED_HISTORY: inferred from history AND the user confirmed it.
 */
export type CategoryRuleOrigin =
  | "SYSTEM_DEFAULT"
  | "USER_DECLARED"
  | "HISTORY_INFERRED"
  | "USER_CONFIRMED_HISTORY";

/**
 * A deterministic categorization rule — no LLM, no guessing. Rules are
 * evaluated by descending `priority` WITHIN their scope tier, but a
 * profile-scoped (personal) rule always wins over a global one regardless
 * of priority number — see `categorize`'s own doc comment. A transaction
 * matching no rule stays `UNCATEGORIZED` rather than being force-fit into a
 * guessed category (RULE: "do not guess aggressively").
 *
 * DEC-133: `financialProfileId` is the ownership boundary — absent
 * (`undefined`) means a GLOBAL `SYSTEM_DEFAULT` rule (the baseline
 * knowledge every profile gets automatically, e.g. "UBER -> Transporte");
 * present means a PERSONAL override scoped to exactly that profile
 * (`USER_DECLARED`/`HISTORY_INFERRED`/`USER_CONFIRMED_HISTORY`). Only
 * `SYSTEM_DEFAULT` may ever be global — every other origin MUST carry a
 * `financialProfileId`. This is the same invariant DEC-131 established for
 * `PaymentSource` identity, applied here to rule ownership instead.
 */
export interface CategoryRule {
  readonly id: Id<"category-rule">;
  readonly matchType: CategoryRuleMatchType;
  readonly pattern: string;
  /**
   * DEC-136: LEGACY / DENORMALIZED display text, NOT the business identity
   * of the category this rule resolves to — `categoryId` (below) is. Kept
   * in sync with the resolved `Category.name` at write time purely so a
   * rule that predates `categoryId` (never backfilled — see
   * `backfillCategoryRuleCategoryIds`'s unresolved report) still has
   * *something* readable/displayable, and so `ruleMatchesTransaction`
   * (which only ever reads `pattern`/`matchType`, never this field) stays
   * unaffected. Never use this string as identity for new code — resolve
   * via `categoryId` and `Category.name` instead.
   */
  readonly category: string;
  readonly subcategory?: string;
  readonly priority: number;
  readonly origin: CategoryRuleOrigin;
  readonly financialProfileId?: Id<"financial-profile">;
  /**
   * DEC-135/136: the canonical `Category` this rule resolves to — CATEGORY
   * IDENTITY = categoryId, `category` (above) is legacy display data only.
   * Optional only because a rule can predate this field and not yet have
   * been linked by `backfillCategoryRuleCategoryIds`'s conservative,
   * exact-match-only migration (unresolved names are reported, never
   * guessed). Every rule created or updated through
   * `mutations.createCategoryRule` — the only write path for personal
   * rules — always sets it; `fixtures/system-default-category-rules.ts`
   * (the real global `SYSTEM_DEFAULT` baseline) always sets it too. Only
   * the pre-DEC-135 founder fixture (`fixtures/rules.ts`, Sprint 1/2,
   * test-only) may still lack it.
   */
  readonly categoryId?: Id<"category">;
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

/**
 * Exported (DEC-133) so retroactive reclassification
 * (`mutations.categorizeTransaction`'s "all past and future" path) can find
 * every historical transaction a rule applies to using the EXACT SAME
 * matcher `categorize` itself uses — never a separate/looser substring
 * heuristic.
 */
export function ruleMatchesTransaction(rule: CategoryRule, t: FinancialTransaction): boolean {
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
  /**
   * DEC-136: the authoritative result when the matched rule has one (every
   * rule created from this decision forward always does — see
   * `CategoryRule.categoryId`). Callers persisting a freshly-categorized
   * transaction MUST write this to `FinancialTransaction.categoryId`, never
   * only the string below.
   */
  readonly categoryId?: Id<"category">;
  /**
   * DEC-136: LEGACY / DENORMALIZED display text — kept for the rare rule
   * that predates `categoryId` and hasn't been backfilled yet (see
   * `CategoryRule.category`'s own doc comment). Still always populated
   * (mirrors `categoryId` when present) so every existing display/reporting
   * consumer keeps working, but it is never the authoritative value.
   */
  readonly category: string;
  readonly subcategory?: string;
  readonly matchedRuleId?: Id<"category-rule">;
}

/** DEC-135: true for a global BASE category (available to every profile). */
export function isBaseCategory(category: Category): boolean {
  return category.financialProfileId === undefined;
}

function bestMatch(
  transaction: FinancialTransaction,
  rules: readonly CategoryRule[],
): CategoryRule | undefined {
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);
  return sorted.find((rule) => ruleMatchesTransaction(rule, transaction));
}

/**
 * Categorizes a transaction deterministically. DEC-133 precedence: a
 * PERSONAL rule (`rule.financialProfileId === transaction.financialProfileId`)
 * always wins over a GLOBAL `SYSTEM_DEFAULT` one
 * (`rule.financialProfileId === undefined`), regardless of `priority` —
 * priority only breaks ties WITHIN each tier. A rule belonging to a
 * DIFFERENT profile is never even considered (never leaks another user's
 * override or gets accidentally applied to someone else's transaction).
 * Falls back to `UNCATEGORIZED` when nothing in either tier matches — never
 * force-fit into a guessed category (RULE: "do not guess aggressively").
 */
export function categorize(
  transaction: FinancialTransaction,
  rules: readonly CategoryRule[],
): CategorizationResult {
  const personalRules = rules.filter(
    (r) => r.financialProfileId !== undefined && r.financialProfileId === transaction.financialProfileId,
  );
  const globalRules = rules.filter((r) => r.financialProfileId === undefined);

  const match = bestMatch(transaction, personalRules) ?? bestMatch(transaction, globalRules);
  if (!match) return { category: UNCATEGORIZED };

  return {
    category: match.category,
    ...(match.subcategory !== undefined ? { subcategory: match.subcategory } : {}),
    matchedRuleId: match.id,
    ...(match.categoryId !== undefined ? { categoryId: match.categoryId } : {}),
  };
}
