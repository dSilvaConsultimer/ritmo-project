import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import { buildFinancialSnapshot } from "../snapshot/snapshot";
import { initialUserSnapshotInput, transactions, reconciliationLinks } from "../fixtures/initial-user";
import { UNCATEGORIZED } from "../domain/category";
import {
  categorySpendingTransactions,
  monthlyCategoryTotals,
  monthlyTransactionList,
  reconciliationCandidates,
  uncategorizedTransactions,
} from "./reporting";

const asOfDate = initialUserSnapshotInput.asOfDate;
// Sprint 1/2 fixture rules (`fixtures/rules.ts`) predate `categoryId` — every
// transaction they classify groups under this `legacy:<name>` synthetic key
// (see `categoryGroupId`'s own doc comment in reporting.ts), never the raw
// name alone.
const legacyFood = "legacy:Food";
const legacyEntertainment = "legacy:Entertainment";

describe("monthlyTransactionList", () => {
  it("lists every September transaction in date order", () => {
    const list = monthlyTransactionList(transactions, asOfDate);
    expect(list).toHaveLength(transactions.length);
    const dates = list.map((t) => t.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe("monthlyCategoryTotals", () => {
  it("groups spend by category, netting refunds and excluding non-consumption effects", () => {
    const totals = monthlyCategoryTotals(transactions, reconciliationLinks, asOfDate);
    // Only iFood has category "Food" with no subcategory; Mineiros Dog is
    // Food/Fast Food, Adega do Rai is Food/Bar, OXXO is Food/Convenience —
    // each rule assigns its own subcategory (see fixtures/rules.ts).
    const food = totals.find((t) => t.categoryId === legacyFood && t.subcategory === undefined);
    expect(food?.total.cents).toBe(4_500);
  });

  it("keeps subcategories distinct", () => {
    const totals = monthlyCategoryTotals(transactions, reconciliationLinks, asOfDate);
    const fastFood = totals.find((t) => t.categoryId === legacyFood && t.subcategory === "Fast Food");
    const bar = totals.find((t) => t.categoryId === legacyFood && t.subcategory === "Bar");
    const convenience = totals.find((t) => t.categoryId === legacyFood && t.subcategory === "Convenience");
    expect(fastFood?.total.cents).toBe(2_600);
    expect(bar?.total.cents).toBe(5_550);
    expect(convenience?.total.cents).toBe(4_078);
  });

  it("does not include the reconciled rodeo ticket — it's already accounted for via the event", () => {
    const totals = monthlyCategoryTotals(transactions, reconciliationLinks, asOfDate);
    expect(totals.some((t) => t.categoryId === legacyEntertainment)).toBe(false);
  });

  it("never lets the old credit-card debt installment inflate any category total (RULE: no double counting)", () => {
    const totals = monthlyCategoryTotals(transactions, reconciliationLinks, asOfDate);
    const sumOfCategoryTotals = M.sum(totals.map((t) => t.total));
    const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);
    // Category totals only cover raw transactions; the rodeo ticket (already
    // counted via the event) and the debt installment (not a transaction at
    // all) are outside this view by construction.
    const eventAlreadyPaidTicket = M.fromReais(476.1);
    expect(sumOfCategoryTotals.cents).toBe(
      snapshot.commitments.actualSpending.cents - eventAlreadyPaidTicket.cents,
    );
  });
});

describe("uncategorizedTransactions", () => {
  it("flags the PagSeguro transaction as uncategorized (no rule matches it)", () => {
    const uncategorized = uncategorizedTransactions(transactions, reconciliationLinks, asOfDate);
    expect(uncategorized).toHaveLength(1);
    expect(uncategorized[0]?.category).toBe(UNCATEGORIZED);
    expect(uncategorized[0]?.rawMerchant).toBe("PAGSEGURO");
  });
});

describe("reconciliationCandidates", () => {
  it("returns no unresolved candidates for the clean initial fixture", () => {
    expect(reconciliationCandidates(reconciliationLinks)).toHaveLength(0);
  });
});

describe("categorySpendingTransactions (DEC-135, tests 9-14)", () => {
  it("(test 13) a category filter returns exactly the transactions summing to that category's monthlyCategoryTotals bucket", () => {
    const totals = monthlyCategoryTotals(transactions, reconciliationLinks, asOfDate);
    const fastFood = totals.find((t) => t.categoryId === legacyFood && t.subcategory === "Fast Food")!;

    const detail = categorySpendingTransactions(transactions, reconciliationLinks, asOfDate, legacyFood);
    // "Food" alone (no subcategory distinction at the filter level) —
    // aggregate every "Food" transaction's amount and compare to the sum of
    // every "Food"-prefixed bucket (with-and-without-subcategory).
    const foodBuckets = totals.filter((t) => t.categoryId === legacyFood);
    const expectedTotalCents = foodBuckets.reduce((sum, b) => sum + b.total.cents, 0);
    const actualTotalCents = detail.reduce((sum, t) => sum + t.amount.cents, 0);
    expect(actualTotalCents).toBe(expectedTotalCents);
    expect(detail.some((t) => t.subcategory === fastFood.subcategory)).toBe(true);
  });

  it("(test 14) the UNCATEGORIZED sentinel filters to exactly the same set uncategorizedTransactions reports for this month", () => {
    const detail = categorySpendingTransactions(transactions, reconciliationLinks, asOfDate, UNCATEGORIZED);
    const uncategorized = uncategorizedTransactions(transactions, reconciliationLinks, asOfDate);
    expect(detail.map((t) => t.id).sort()).toEqual(uncategorized.map((t) => t.id).sort());
  });

  it("(test 10, 11, 12) never includes a TRANSFER, CARD_PAYMENT, or INVESTMENT transaction even if one happened to share a category string", () => {
    const withNonConsumption = [
      ...transactions,
      {
        ...transactions[0]!,
        id: "tx-transfer-test" as (typeof transactions)[0]["id"],
        financialEffect: "TRANSFER" as const,
        category: "Food",
      },
      {
        ...transactions[0]!,
        id: "tx-cardpayment-test" as (typeof transactions)[0]["id"],
        financialEffect: "CARD_PAYMENT" as const,
        category: "Food",
      },
      {
        ...transactions[0]!,
        id: "tx-investment-test" as (typeof transactions)[0]["id"],
        financialEffect: "INVESTMENT" as const,
        category: "Food",
      },
    ];
    const detail = categorySpendingTransactions(withNonConsumption, reconciliationLinks, asOfDate, "Food");
    expect(detail.some((t) => t.id === "tx-transfer-test")).toBe(false);
    expect(detail.some((t) => t.id === "tx-cardpayment-test")).toBe(false);
    expect(detail.some((t) => t.id === "tx-investment-test")).toBe(false);
  });
});
