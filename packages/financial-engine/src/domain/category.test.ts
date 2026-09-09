import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import { categoryRules } from "../fixtures/rules";
import type { FinancialTransaction, PaymentSource } from "./transaction";
import { categorize, UNCATEGORIZED, type CategoryRule } from "./category";

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
      { id: createId("category-rule"), matchType: "CONTAINS_MERCHANT", pattern: "IFOOD", category: "Food", priority: 100 },
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
      },
    ];
    const result = categorize(tx({ normalizedMerchant: "OXXO" }), rules);
    expect(result.category).toBe("Food");
    expect(result.subcategory).toBe("Convenience");
  });

  it("respects rule priority — the highest-priority matching rule wins", () => {
    const rules: CategoryRule[] = [
      { id: createId("category-rule"), matchType: "CONTAINS_MERCHANT", pattern: "IFOOD", category: "Generic", priority: 1 },
      { id: createId("category-rule"), matchType: "EXACT_MERCHANT", pattern: "IFOOD", category: "Food", priority: 100 },
    ];
    expect(categorize(tx(), rules).category).toBe("Food");
  });

  it("leaves an unmatched transaction UNCATEGORIZED rather than guessing", () => {
    const rules: CategoryRule[] = [
      { id: createId("category-rule"), matchType: "CONTAINS_MERCHANT", pattern: "IFOOD", category: "Food", priority: 100 },
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
