import { createId } from "@money-copilot/shared";
import type { MerchantNormalizationRule } from "../domain/merchant";
import type { CategoryRule } from "../domain/category";

/**
 * Deterministic merchant normalization rules. "LOCALIZAGF42", "LOCALIZA
 * RAC", "LOCALIZA RENT" all normalize to "LOCALIZA" — the canonical
 * example from the Sprint 2 brief. No fixture transaction below actually
 * uses a Localiza variant (the car subscription remains a recurring
 * `FixedExpense`, not a transaction, until real bank data replaces it in a
 * future sprint) — this rule exists so the normalization layer is exercised
 * directly by unit tests against exactly this scenario.
 */
export const merchantNormalizationRules: readonly MerchantNormalizationRule[] = [
  {
    id: createId("merchant-rule"),
    matchType: "CONTAINS",
    pattern: "LOCALIZA",
    normalizedMerchant: "LOCALIZA",
    priority: 100,
  },
  {
    id: createId("merchant-rule"),
    matchType: "CONTAINS",
    pattern: "IFOOD",
    normalizedMerchant: "IFOOD",
    priority: 100,
  },
  {
    id: createId("merchant-rule"),
    matchType: "EXACT",
    pattern: "MINEIROS DOG",
    normalizedMerchant: "MINEIROS DOG",
    priority: 100,
  },
  {
    id: createId("merchant-rule"),
    matchType: "CONTAINS",
    pattern: "ADEGA DO RAI",
    normalizedMerchant: "ADEGA DO RAI",
    priority: 100,
  },
  {
    id: createId("merchant-rule"),
    matchType: "CONTAINS",
    pattern: "OXXO",
    normalizedMerchant: "OXXO",
    priority: 100,
  },
  {
    id: createId("merchant-rule"),
    matchType: "CONTAINS",
    pattern: "TIKTOK",
    normalizedMerchant: "TIKTOK SHOP",
    priority: 100,
  },
  {
    id: createId("merchant-rule"),
    matchType: "CONTAINS",
    pattern: "RODEO",
    normalizedMerchant: "RODEO INGRESSOS",
    priority: 100,
  },
  // Deliberately NO rule for "PAGSEGURO" — it demonstrates a transaction
  // that stays UNCATEGORIZED rather than being guessed at (see RULE:
  // "do not guess aggressively").
];

/**
 * Deterministic categorization rules, evaluated by descending priority.
 * Matches the Sprint 2 brief's own examples (LOCALIZA -> Transport,
 * IFOOD -> Food, OXXO -> Food/Convenience).
 */
export const categoryRules: readonly CategoryRule[] = [
  {
    id: createId("category-rule"),
    matchType: "CONTAINS_MERCHANT",
    pattern: "LOCALIZA",
    category: "Transportation",
    subcategory: "Car Subscription",
    priority: 100,
  },
  {
    id: createId("category-rule"),
    matchType: "CONTAINS_MERCHANT",
    pattern: "IFOOD",
    category: "Food",
    priority: 100,
  },
  {
    id: createId("category-rule"),
    matchType: "EXACT_MERCHANT",
    pattern: "MINEIROS DOG",
    category: "Food",
    subcategory: "Fast Food",
    priority: 100,
  },
  {
    id: createId("category-rule"),
    matchType: "CONTAINS_MERCHANT",
    pattern: "ADEGA",
    category: "Food",
    subcategory: "Bar",
    priority: 100,
  },
  {
    id: createId("category-rule"),
    matchType: "CONTAINS_MERCHANT",
    pattern: "OXXO",
    category: "Food",
    subcategory: "Convenience",
    priority: 100,
  },
  {
    id: createId("category-rule"),
    matchType: "CONTAINS_MERCHANT",
    pattern: "TIKTOK",
    category: "Shopping",
    priority: 100,
  },
  {
    id: createId("category-rule"),
    matchType: "CONTAINS_MERCHANT",
    pattern: "RODEO",
    category: "Entertainment",
    priority: 100,
  },
  // No rule matches "PAGSEGURO" — it stays UNCATEGORIZED.
];
