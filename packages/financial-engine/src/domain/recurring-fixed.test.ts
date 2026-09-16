import { describe, expect, it } from "vitest";
import { createId, type Id } from "@money-copilot/shared";
import * as M from "../money/index";
import type { FinancialTransaction, PaymentSource } from "./transaction";
import { detectRecurringFixedCommitments } from "./recurring-fixed";

const ASOF = "2026-09-15"; // completed months: 2026-06, 2026-07, 2026-08
const source: PaymentSource = { id: createId("payment-source"), label: "Conta", type: "DEBIT" };

function tx(overrides: Partial<FinancialTransaction> = {}): FinancialTransaction {
  return {
    id: createId("transaction"),
    financialProfileId: createId("financial-profile"),
    paymentSource: source,
    date: "2026-08-05",
    amount: M.fromReais(100),
    direction: "DEBIT",
    rawDescription: "GENERIC",
    normalizedDescription: "GENERIC",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: null,
    origin: "IMPORTED",
    createdAt: "2026-08-05",
    updatedAt: "2026-08-05",
    ...overrides,
  };
}

describe("detectRecurringFixedCommitments (DEC-140)", () => {
  it("(test A) rent — same identity, same amount, 3 consecutive completed months — is recognized as a recurring fixed commitment", () => {
    const transactions = [
      tx({ id: createId("transaction"), normalizedMerchant: "ALUGUEL", date: "2026-06-01", amount: M.fromReais(1500) }),
      tx({ id: createId("transaction"), normalizedMerchant: "ALUGUEL", date: "2026-07-01", amount: M.fromReais(1500) }),
      tx({ id: createId("transaction"), normalizedMerchant: "ALUGUEL", date: "2026-08-01", amount: M.fromReais(1500) }),
    ];
    const result = detectRecurringFixedCommitments(transactions, [], ASOF);
    const aluguel = result.find((c) => c.identity === "ALUGUEL");
    expect(aluguel).toBeDefined();
    expect(aluguel?.predictedAmount.cents).toBe(M.fromReais(1500).cents);
    expect(aluguel?.evidenceMonths).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(aluguel?.origin).toBe("HISTORY_INFERRED");
  });

  it("(test B) electricity — same identity, DIFFERENT amounts each month — is still recognized, with the average as the predicted amount", () => {
    const transactions = [
      tx({ id: createId("transaction"), normalizedMerchant: "CPFL", date: "2026-06-10", amount: M.fromReais(180) }),
      tx({ id: createId("transaction"), normalizedMerchant: "CPFL", date: "2026-07-10", amount: M.fromReais(235) }),
      tx({ id: createId("transaction"), normalizedMerchant: "CPFL", date: "2026-08-10", amount: M.fromReais(207) }),
    ];
    const result = detectRecurringFixedCommitments(transactions, [], ASOF);
    const cpfl = result.find((c) => c.identity === "CPFL");
    expect(cpfl).toBeDefined();
    // (180 + 235 + 207) / 3 = 207.3333... -> 20733 cents rounded.
    expect(cpfl?.predictedAmount.cents).toBe(20_733);
  });

  it("(test C) a one-off home purchase (single occurrence) is NOT classified as fixed, regardless of its category", () => {
    const transactions = [
      tx({
        normalizedMerchant: "LOJA MOVEIS",
        date: "2026-08-15",
        amount: M.fromReais(2000),
        categoryId: "category_personal-despesas-casa" as Id<"category">,
      }),
    ];
    const result = detectRecurringFixedCommitments(transactions, [], ASOF);
    expect(result.find((c) => c.identity === "LOJA MOVEIS")).toBeUndefined();
  });

  it("(test D) a card installment ('LOJA X 3/12'-style markers) is NEVER classified as an indefinite recurring fixed commitment", () => {
    const transactions = [
      tx({
        normalizedMerchant: "LOJA X",
        rawDescription: "LOJA X 3/12",
        normalizedDescription: "LOJA X 3/12",
        date: "2026-06-20",
        amount: M.fromReais(200),
      }),
      tx({
        normalizedMerchant: "LOJA X",
        rawDescription: "LOJA X 4/12",
        normalizedDescription: "LOJA X 4/12",
        date: "2026-07-20",
        amount: M.fromReais(200),
      }),
      tx({
        normalizedMerchant: "LOJA X",
        rawDescription: "LOJA X 5/12",
        normalizedDescription: "LOJA X 5/12",
        date: "2026-08-20",
        amount: M.fromReais(200),
      }),
    ];
    const result = detectRecurringFixedCommitments(transactions, [], ASOF);
    expect(result.find((c) => c.identity === "LOJA X")).toBeUndefined();
  });

  it("(test E) a recurring card subscription with NO installment marker (Netflix) is recognized as recurring fixed", () => {
    const transactions = [
      tx({ id: createId("transaction"), normalizedMerchant: "NETFLIX", date: "2026-06-05", amount: M.fromReais(39.9) }),
      tx({ id: createId("transaction"), normalizedMerchant: "NETFLIX", date: "2026-07-05", amount: M.fromReais(39.9) }),
      tx({ id: createId("transaction"), normalizedMerchant: "NETFLIX", date: "2026-08-05", amount: M.fromReais(39.9) }),
    ];
    const result = detectRecurringFixedCommitments(transactions, [], ASOF);
    expect(result.find((c) => c.identity === "NETFLIX")).toBeDefined();
  });

  it("(test J) multiple independently-recurring identities inside the SAME category are each recognized on their own — never inferred from the category as a whole", () => {
    const despesasDeCasa = "category_personal-despesas-casa" as Id<"category">;
    const transactions = [
      // ALUGUEL: recurring.
      tx({ id: createId("transaction"), normalizedMerchant: "ALUGUEL", date: "2026-06-01", amount: M.fromReais(1500), categoryId: despesasDeCasa }),
      tx({ id: createId("transaction"), normalizedMerchant: "ALUGUEL", date: "2026-07-01", amount: M.fromReais(1500), categoryId: despesasDeCasa }),
      tx({ id: createId("transaction"), normalizedMerchant: "ALUGUEL", date: "2026-08-01", amount: M.fromReais(1500), categoryId: despesasDeCasa }),
      // CONDOMINIO: recurring.
      tx({ id: createId("transaction"), normalizedMerchant: "CONDOMINIO", date: "2026-06-05", amount: M.fromReais(450), categoryId: despesasDeCasa }),
      tx({ id: createId("transaction"), normalizedMerchant: "CONDOMINIO", date: "2026-07-05", amount: M.fromReais(450), categoryId: despesasDeCasa }),
      tx({ id: createId("transaction"), normalizedMerchant: "CONDOMINIO", date: "2026-08-05", amount: M.fromReais(450), categoryId: despesasDeCasa }),
      // ENERGIA: recurring, varying amount.
      tx({ id: createId("transaction"), normalizedMerchant: "ENERGIA", date: "2026-06-10", amount: M.fromReais(180), categoryId: despesasDeCasa }),
      tx({ id: createId("transaction"), normalizedMerchant: "ENERGIA", date: "2026-07-10", amount: M.fromReais(235), categoryId: despesasDeCasa }),
      tx({ id: createId("transaction"), normalizedMerchant: "ENERGIA", date: "2026-08-10", amount: M.fromReais(207), categoryId: despesasDeCasa }),
      // A genuinely one-off purchase in the SAME category — must not be swept in.
      tx({ id: createId("transaction"), normalizedMerchant: "LOJA MOVEIS", date: "2026-08-15", amount: M.fromReais(2000), categoryId: despesasDeCasa }),
    ];
    const result = detectRecurringFixedCommitments(transactions, [], ASOF);
    const identities = result.map((c) => c.identity).sort();
    expect(identities).toEqual(["ALUGUEL", "CONDOMINIO", "ENERGIA"]);
    expect(result.every((c) => c.categoryId === despesasDeCasa)).toBe(true);
  });

  it("never classifies a merchant present in only 2 of the last 3 completed months", () => {
    const transactions = [
      tx({ id: createId("transaction"), normalizedMerchant: "GYM", date: "2026-07-01", amount: M.fromReais(120) }),
      tx({ id: createId("transaction"), normalizedMerchant: "GYM", date: "2026-08-01", amount: M.fromReais(120) }),
    ];
    const result = detectRecurringFixedCommitments(transactions, [], ASOF);
    expect(result.find((c) => c.identity === "GYM")).toBeUndefined();
  });

  it("ignores the current (incomplete) month entirely — a September occurrence never substitutes for a missing completed month", () => {
    const transactions = [
      tx({ id: createId("transaction"), normalizedMerchant: "GYM", date: "2026-07-01", amount: M.fromReais(120) }),
      tx({ id: createId("transaction"), normalizedMerchant: "GYM", date: "2026-08-01", amount: M.fromReais(120) }),
      tx({ id: createId("transaction"), normalizedMerchant: "GYM", date: "2026-09-05", amount: M.fromReais(120) }),
    ];
    const result = detectRecurringFixedCommitments(transactions, [], ASOF);
    expect(result.find((c) => c.identity === "GYM")).toBeUndefined();
  });
});
