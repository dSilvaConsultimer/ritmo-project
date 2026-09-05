import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import { buildFinancialSnapshot } from "../snapshot/snapshot";
import { initialUserSnapshotInput, transactions, reconciliationLinks } from "../fixtures/initial-user";
import { UNCATEGORIZED } from "../domain/category";
import {
  monthlyCategoryTotals,
  monthlyTransactionList,
  reconciliationCandidates,
  uncategorizedTransactions,
} from "./reporting";

const asOfDate = initialUserSnapshotInput.asOfDate;

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
    const food = totals.find((t) => t.category === "Food" && t.subcategory === undefined);
    expect(food?.total.cents).toBe(4_500);
  });

  it("keeps subcategories distinct", () => {
    const totals = monthlyCategoryTotals(transactions, reconciliationLinks, asOfDate);
    const fastFood = totals.find((t) => t.category === "Food" && t.subcategory === "Fast Food");
    const bar = totals.find((t) => t.category === "Food" && t.subcategory === "Bar");
    const convenience = totals.find((t) => t.category === "Food" && t.subcategory === "Convenience");
    expect(fastFood?.total.cents).toBe(2_600);
    expect(bar?.total.cents).toBe(5_550);
    expect(convenience?.total.cents).toBe(4_078);
  });

  it("does not include the reconciled rodeo ticket — it's already accounted for via the event", () => {
    const totals = monthlyCategoryTotals(transactions, reconciliationLinks, asOfDate);
    expect(totals.some((t) => t.category === "Entertainment")).toBe(false);
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
