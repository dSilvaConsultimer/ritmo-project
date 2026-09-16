import type { Id } from "@money-copilot/shared";
import type { CategoryRule } from "../domain/category";
import {
  baseCategoryTransporte,
  baseCategoryAssinaturas,
  baseCategoryDelivery,
  baseCategoryAcademia,
  baseCategoryCombustivel,
} from "./base-categories";

/**
 * DEC-134/135: the REAL global `SYSTEM_DEFAULT` baseline — deliberately
 * separate from `rules.ts`'s `categoryRules`, which are Sprint 1/2 fixture
 * data discovered from the FOUNDER's own real transaction history
 * (`fixtures/transactions.ts`'s own comments confirm several of those
 * patterns — "Mineiros Dog," "Adega do Rai," "Rodeo Ingressos" — are
 * hyper-local businesses tied to one person's history, not safe universal
 * defaults for an arbitrary new user anywhere in Brazil).
 *
 * This file is what `persistence`'s `bootstrapSystemDefaultCategoryRules`
 * actually seeds into EVERY environment (including production) — see that
 * function's own doc comment for why this must never be gated behind
 * `shouldSeedDatabase` the way the founder fixture is.
 *
 * PRECISION OVER COVERAGE (explicit product requirement): every entry here
 * is a merchant/pattern where the category is unambiguous to a reasonable
 * human with no other context — a well-known subscription service, a
 * well-known ride-hailing app, a well-known named fuel brand. Deliberately
 * NOT included, and left for `CONTAINS_MERCHANT`-style guessing later
 * (or user teaching): "99" (the ride-hailing app) — no verified real-world
 * raw Pluggy description string was available to encode a safe pattern for
 * it without risking a substring collision (e.g. a numeric amount or an
 * unrelated merchant name containing "99"); a generic bare "POSTO" pattern
 * for fuel stations (matches almost any small gas station by name — see
 * DEC-132/133's own "POSTO CAMPINAS" example, which must stay a genuine
 * pending question, not a guessed default); any bank/PIX counterparty name
 * pattern (a person's name is never a safe global default).
 *
 * `CONTAINS_DESCRIPTION` is used throughout (matches
 * `normalizedDescription || rawDescription` directly) rather than
 * `CONTAINS_MERCHANT`, so a real transaction is categorized correctly even
 * when a provider doesn't report a distinct, separately-normalized
 * merchant field — no companion merchant-normalization rule is required
 * for these to work.
 *
 * Priority 100 — same tier as `rules.ts`'s fixture rules; a personal
 * override always wins over this tier regardless of the number (see
 * `categorize`'s own precedence doc comment, DEC-133/134).
 *
 * DEC-135: `categoryId` now points at the exact canonical `baseCategories`
 * row with the matching name — `category` (the string) is kept in sync,
 * never independently invented, so `categorize`'s existing string-based
 * return value is completely unaffected.
 */
export const systemDefaultCategoryRules: readonly CategoryRule[] = [
  {
    id: "category-rule_system-default-uber" as Id<"category-rule">,
    matchType: "CONTAINS_DESCRIPTION",
    pattern: "UBER",
    category: baseCategoryTransporte.name,
    categoryId: baseCategoryTransporte.id,
    priority: 100,
    origin: "SYSTEM_DEFAULT",
  },
  {
    id: "category-rule_system-default-netflix" as Id<"category-rule">,
    matchType: "CONTAINS_DESCRIPTION",
    pattern: "NETFLIX",
    category: baseCategoryAssinaturas.name,
    categoryId: baseCategoryAssinaturas.id,
    priority: 100,
    origin: "SYSTEM_DEFAULT",
  },
  {
    id: "category-rule_system-default-spotify" as Id<"category-rule">,
    matchType: "CONTAINS_DESCRIPTION",
    pattern: "SPOTIFY",
    category: baseCategoryAssinaturas.name,
    categoryId: baseCategoryAssinaturas.id,
    priority: 100,
    origin: "SYSTEM_DEFAULT",
  },
  {
    id: "category-rule_system-default-ifood" as Id<"category-rule">,
    matchType: "CONTAINS_DESCRIPTION",
    pattern: "IFOOD",
    category: baseCategoryDelivery.name,
    categoryId: baseCategoryDelivery.id,
    priority: 100,
    origin: "SYSTEM_DEFAULT",
  },
  {
    id: "category-rule_system-default-smartfit" as Id<"category-rule">,
    matchType: "CONTAINS_DESCRIPTION",
    pattern: "SMART FIT",
    category: baseCategoryAcademia.name,
    categoryId: baseCategoryAcademia.id,
    priority: 100,
    origin: "SYSTEM_DEFAULT",
  },
  // Named national fuel brands — high-confidence "Combustível," unlike a
  // generic "POSTO" (gas station) substring, which is NOT safe (see this
  // file's own top comment).
  {
    id: "category-rule_system-default-ipiranga" as Id<"category-rule">,
    matchType: "CONTAINS_DESCRIPTION",
    pattern: "IPIRANGA",
    category: baseCategoryCombustivel.name,
    categoryId: baseCategoryCombustivel.id,
    priority: 100,
    origin: "SYSTEM_DEFAULT",
  },
  {
    id: "category-rule_system-default-shell" as Id<"category-rule">,
    matchType: "CONTAINS_DESCRIPTION",
    pattern: "SHELL",
    category: baseCategoryCombustivel.name,
    categoryId: baseCategoryCombustivel.id,
    priority: 100,
    origin: "SYSTEM_DEFAULT",
  },
];
