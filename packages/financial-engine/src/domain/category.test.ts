import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import { categoryRules } from "../fixtures/rules";
import type { FinancialTransaction, PaymentSource } from "./transaction";
import { categorize, isBaseCategory, UNCATEGORIZED, type Category, type CategoryRule } from "./category";

const nubank: PaymentSource = { id: createId("payment-source"), label: "Nubank", type: "CREDIT_CARD" };

function tx(overrides: Partial<FinancialTransaction> = {}): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: createId("financial-profile"),
    paymentSource: nubank,
    date: "2026-09-04",
    amount: M.fromReais(50),
    direction: "DEBIT",
    rawDescription: "IFOOD BR",
    normalizedDescription: "IFOOD BR",
    rawMerchant: "IFOOD BR",
    normalizedMerchant: "IFOOD",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: null,
    origin: "MANUAL",
    createdAt: "2026-09-04",
    updatedAt: "2026-09-04",
    ...overrides,
  };
}

describe("categorize", () => {
  it("matches IFOOD -> Food via CONTAINS_MERCHANT", () => {
    const rules: CategoryRule[] = [
      {
        id: createId("category-rule"),
        matchType: "CONTAINS_MERCHANT",
        pattern: "IFOOD",
        category: "Food",
        priority: 100,
        origin: "SYSTEM_DEFAULT",
      },
    ];
    expect(categorize(tx(), rules).category).toBe("Food");
  });

  it("matches OXXO -> Food/Convenience via CONTAINS_MERCHANT with a subcategory", () => {
    const rules: CategoryRule[] = [
      {
        id: createId("category-rule"),
        matchType: "CONTAINS_MERCHANT",
        pattern: "OXXO",
        category: "Food",
        subcategory: "Convenience",
        priority: 100,
        origin: "SYSTEM_DEFAULT",
      },
    ];
    const result = categorize(tx({ normalizedMerchant: "OXXO" }), rules);
    expect(result.category).toBe("Food");
    expect(result.subcategory).toBe("Convenience");
  });

  it("respects rule priority — the highest-priority matching rule wins", () => {
    const rules: CategoryRule[] = [
      {
        id: createId("category-rule"),
        matchType: "CONTAINS_MERCHANT",
        pattern: "IFOOD",
        category: "Generic",
        priority: 1,
        origin: "SYSTEM_DEFAULT",
      },
      {
        id: createId("category-rule"),
        matchType: "EXACT_MERCHANT",
        pattern: "IFOOD",
        category: "Food",
        priority: 100,
        origin: "SYSTEM_DEFAULT",
      },
    ];
    expect(categorize(tx(), rules).category).toBe("Food");
  });

  it("leaves an unmatched transaction UNCATEGORIZED rather than guessing", () => {
    const rules: CategoryRule[] = [
      {
        id: createId("category-rule"),
        matchType: "CONTAINS_MERCHANT",
        pattern: "IFOOD",
        category: "Food",
        priority: 100,
        origin: "SYSTEM_DEFAULT",
      },
    ];
    const result = categorize(tx({ normalizedMerchant: "PAGSEGURO", rawMerchant: "PAGSEGURO" }), rules);
    expect(result.category).toBe(UNCATEGORIZED);
    expect(result.matchedRuleId).toBeUndefined();
  });

  it("supports a bounded REGEX_DESCRIPTION rule", () => {
    const rules: CategoryRule[] = [
      {
        id: createId("category-rule"),
        matchType: "REGEX_DESCRIPTION",
        pattern: "^IFOOD",
        category: "Food",
        priority: 100,
        origin: "SYSTEM_DEFAULT",
      },
    ];
    expect(categorize(tx(), rules).category).toBe("Food");
  });

  it("never throws on a malformed regex pattern — falls through safely", () => {
    const rules: CategoryRule[] = [
      {
        id: createId("category-rule"),
        matchType: "REGEX_DESCRIPTION",
        pattern: "(unterminated[",
        category: "Food",
        priority: 100,
        origin: "SYSTEM_DEFAULT",
      },
    ];
    expect(() => categorize(tx(), rules)).not.toThrow();
    expect(categorize(tx(), rules).category).toBe(UNCATEGORIZED);
  });

  it("(Sprint 5, DEC-063) categorizes real Pluggy sandbox streaming merchants instead of leaving them UNCATEGORIZED", () => {
    // Sprint 4.5's live sandbox validation imported real NETFLIX.COM/SPOTIFY
    // AB charges, but no category rule matched them — they stayed
    // UNCATEGORIZED, which silently made them invisible to Sprint 5's
    // recommendation engine (RULE: never recommend against an ambiguous/
    // uncategorized transaction). Fixed by adding merchant + category
    // rules for both, matching the exact real merchant strings observed.
    expect(categorize(tx({ normalizedMerchant: "NETFLIX", rawMerchant: "NETFLIX.COM" }), categoryRules).category).toBe(
      "Entertainment",
    );
    expect(categorize(tx({ normalizedMerchant: "SPOTIFY", rawMerchant: "SPOTIFY AB" }), categoryRules).category).toBe(
      "Entertainment",
    );
  });
});

describe("categorize — DEC-133 personal-rule-vs-system-default precedence", () => {
  const profileA = createId("financial-profile");
  const profileB = createId("financial-profile");

  const systemDefault: CategoryRule = {
    id: createId("category-rule"),
    matchType: "CONTAINS_MERCHANT",
    pattern: "UBER",
    category: "Transporte",
    priority: 100,
    origin: "SYSTEM_DEFAULT",
    // no financialProfileId — global.
  };

  it("(test 1) a global SYSTEM_DEFAULT rule categorizes a transaction with no user interaction", () => {
    const t = tx({ financialProfileId: profileA, normalizedMerchant: "UBER" });
    expect(categorize(t, [systemDefault]).category).toBe("Transporte");
  });

  it("(test 2) a different profile with no override receives the exact same system default", () => {
    const t = tx({ financialProfileId: profileB, normalizedMerchant: "UBER" });
    expect(categorize(t, [systemDefault]).category).toBe("Transporte");
  });

  it("(test 3) a profile-specific override beats the system default, even with a LOWER priority number", () => {
    const personalOverride: CategoryRule = {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Trabalho",
      priority: 1, // deliberately lower than the system default's 100
      origin: "USER_DECLARED",
      financialProfileId: profileA,
    };
    const t = tx({ financialProfileId: profileA, normalizedMerchant: "UBER" });
    expect(categorize(t, [systemDefault, personalOverride]).category).toBe("Trabalho");
  });

  it("(test 4) Profile A's override never affects Profile B's transactions — Profile B still gets the system default", () => {
    const personalOverrideForA: CategoryRule = {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Trabalho",
      priority: 200,
      origin: "USER_DECLARED",
      financialProfileId: profileA,
    };
    const t = tx({ financialProfileId: profileB, normalizedMerchant: "UBER" });
    expect(categorize(t, [systemDefault, personalOverrideForA]).category).toBe("Transporte");
  });

  it("a personal rule for a DIFFERENT merchant never blocks the system default for this one", () => {
    const unrelatedPersonalRule: CategoryRule = {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT",
      pattern: "NETFLIX",
      category: "Assinaturas",
      priority: 200,
      origin: "USER_DECLARED",
      financialProfileId: profileA,
    };
    const t = tx({ financialProfileId: profileA, normalizedMerchant: "UBER" });
    expect(categorize(t, [systemDefault, unrelatedPersonalRule]).category).toBe("Transporte");
  });

  it("(DEC-135) surfaces the matched rule's canonical categoryId, when it has one", () => {
    const ruleWithCategoryId: CategoryRule = {
      ...systemDefault,
      id: createId("category-rule"),
      categoryId: createId("category"),
    };
    const t = tx({ financialProfileId: profileA, normalizedMerchant: "UBER" });
    const result = categorize(t, [ruleWithCategoryId]);
    expect(result.categoryId).toBe(ruleWithCategoryId.categoryId);
  });

  it("(DEC-135) omits categoryId entirely for a legacy rule that predates it", () => {
    const t = tx({ financialProfileId: profileA, normalizedMerchant: "UBER" });
    const result = categorize(t, [systemDefault]);
    expect(result.categoryId).toBeUndefined();
  });
});

describe("isBaseCategory (DEC-135)", () => {
  it("is true for a category with no financialProfileId", () => {
    const base: Category = { id: createId("category"), name: "Transporte" };
    expect(isBaseCategory(base)).toBe(true);
  });

  it("is false for a category scoped to a profile", () => {
    const personal: Category = {
      id: createId("category"),
      name: "Trabalho",
      financialProfileId: createId("financial-profile"),
    };
    expect(isBaseCategory(personal)).toBe(false);
  });
});
