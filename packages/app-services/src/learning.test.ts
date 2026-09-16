import { describe, expect, it } from "vitest";
import { createId, type Id } from "@money-copilot/shared";
import { categorize, fixtureProfile, fromCents, fromReais } from "@money-copilot/financial-engine";
import type { FinancialTransaction, PaymentSource } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import {
  categorizeTransaction,
  confirmRecurringFixedExpenseCandidate,
  confirmRecurringIncomeCandidate,
  createCategoryRule,
  deleteCategoryRule,
  recordManualTransaction,
  rejectRecurringCandidate,
} from "./mutations";
import {
  getPendingConfirmations,
  getRecurringFixedExpenseCandidates,
  getRecurringIncomeCandidates,
} from "./queries";
import { freshSeededDb } from "./test-helpers";

const ASOF = "2026-09-05";

async function checkingSource(db: Awaited<ReturnType<typeof freshSeededDb>>): Promise<PaymentSource> {
  const source: PaymentSource = {
    id: createId("payment-source"),
    label: "Conta Corrente",
    type: "DEBIT",
  };
  await repo.upsertPaymentSource(db, source, fixtureProfile.id);
  return source;
}

async function insertTransaction(
  db: Awaited<ReturnType<typeof freshSeededDb>>,
  paymentSource: PaymentSource,
  overrides: Partial<FinancialTransaction>,
): Promise<FinancialTransaction> {
  const transaction: FinancialTransaction = {
    id: createId("transaction"),
    financialProfileId: fixtureProfile.id,
    paymentSource,
    date: ASOF,
    amount: fromReais(250),
    direction: "DEBIT",
    rawDescription: "POSTO CAMPINAS",
    normalizedDescription: "POSTO CAMPINAS",
    rawMerchant: "POSTO CAMPINAS",
    normalizedMerchant: "POSTO CAMPINAS",
    status: "POSTED",
    certainty: "ACTUAL",
    financialEffect: "CONSUMPTION",
    category: null,
    origin: "IMPORTED",
    createdAt: ASOF,
    updatedAt: ASOF,
    ...overrides,
  };
  await repo.upsertTransaction(db, transaction);
  return transaction;
}

describe("getPendingConfirmations — uncategorized transactions (test 1)", () => {
  it("an uncategorized transaction surfaces as a pending UNCATEGORIZED_TRANSACTION question", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    await insertTransaction(db, source, { category: "UNCATEGORIZED" });

    const pending = await getPendingConfirmations(db, fixtureProfile.id, ASOF);
    expect(pending.some((p) => p.kind === "UNCATEGORIZED_TRANSACTION")).toBe(true);
  });

  it("a categorized transaction never appears as a pending question", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    const tx = await insertTransaction(db, source, { category: "Transporte" });

    const pending = await getPendingConfirmations(db, fixtureProfile.id, ASOF);
    expect(
      pending.some((p) => p.kind === "UNCATEGORIZED_TRANSACTION" && p.transactionId === tx.id),
    ).toBe(false);
  });
});

describe("categorizeTransaction (tests 2, 3, 4, 11, 12)", () => {
  it("test 2: a one-time correction changes only the transaction — no permanent rule is created", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    const tx = await insertTransaction(db, source, { category: "UNCATEGORIZED" });

    const result = await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: tx.id,
      category: "Combustível",
      alwaysForMerchant: false,
    });

    expect(result.transaction.category).toBe("Combustível");
    expect(result.createdRule).toBeUndefined();
    const { categoryRules } = await repo.loadRules(db, fixtureProfile.id);
    expect(categoryRules.some((r) => r.pattern === "POSTO CAMPINAS")).toBe(false);
  });

  it("test 3: choosing 'always' creates a durable USER_DECLARED CategoryRule", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    const tx = await insertTransaction(db, source, { category: "UNCATEGORIZED" });

    const result = await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: tx.id,
      category: "Combustível",
      alwaysForMerchant: true,
    });

    expect(result.createdRule?.origin).toBe("USER_DECLARED");
    expect(result.createdRule?.matchType).toBe("CONTAINS_MERCHANT");
    expect(result.createdRule?.pattern).toBe("POSTO CAMPINAS");
    // DEC-133: the created rule is a PERSONAL override, scoped to this profile.
    expect(result.createdRule?.financialProfileId).toBe(fixtureProfile.id);
    const { categoryRules } = await repo.loadRules(db, fixtureProfile.id);
    expect(categoryRules.some((r) => r.id === result.createdRule?.id)).toBe(true);
  });

  it("test 4: the next transaction from the same merchant is categorized automatically by the new rule", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    const tx = await insertTransaction(db, source, { category: "UNCATEGORIZED" });
    await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: tx.id,
      category: "Combustível",
      alwaysForMerchant: true,
    });

    const { categoryRules } = await repo.loadRules(db, fixtureProfile.id);
    const nextTransaction = await insertTransaction(db, source, {
      id: createId("transaction"),
      category: null,
    });
    const result = categorize(nextTransaction, categoryRules);
    expect(result.category).toBe("Combustível");
  });

  it("(DEC-133, test 7) 'all past and future' retroactively reclassifies matching historical transactions for this profile", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    const tx1 = await insertTransaction(db, source, {
      id: createId("transaction"),
      date: "2026-08-01",
      category: "UNCATEGORIZED",
    });
    const tx2 = await insertTransaction(db, source, {
      id: createId("transaction"),
      date: "2026-08-15",
      category: "UNCATEGORIZED",
    });
    const tx3 = await insertTransaction(db, source, {
      id: createId("transaction"),
      date: "2026-09-01",
      category: "UNCATEGORIZED",
    });

    const result = await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: tx3.id,
      category: "Combustível",
      alwaysForMerchant: true,
    });

    expect(result.retroactivelyReclassifiedCount).toBe(2);
    const [reclassified1, reclassified2] = await Promise.all([
      repo.getTransactionById(db, tx1.id),
      repo.getTransactionById(db, tx2.id),
    ]);
    expect(reclassified1?.category).toBe("Combustível");
    expect(reclassified2?.category).toBe("Combustível");
  });

  it("(DEC-133, test 8) unrelated historical transactions (different merchant) are never touched by a retroactive reclassification", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    const unrelated = await insertTransaction(db, source, {
      id: createId("transaction"),
      date: "2026-08-01",
      normalizedMerchant: "IFOOD",
      rawMerchant: "IFOOD",
      rawDescription: "IFOOD BR",
      normalizedDescription: "IFOOD BR",
      category: "Food",
    });
    const target = await insertTransaction(db, source, { category: "UNCATEGORIZED" });

    await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: target.id,
      category: "Combustível",
      alwaysForMerchant: true,
    });

    const stillUnrelated = await repo.getTransactionById(db, unrelated.id);
    expect(stillUnrelated?.category).toBe("Food");
  });

  it("(DEC-133, test 10) a retroactive category change never alters financialEffect or amount — only category-derived analytics change", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    const historical = await insertTransaction(db, source, {
      id: createId("transaction"),
      date: "2026-08-01",
      category: "UNCATEGORIZED",
      financialEffect: "CONSUMPTION",
      amount: fromReais(50),
    });
    const target = await insertTransaction(db, source, {
      category: "UNCATEGORIZED",
      financialEffect: "CONSUMPTION",
      amount: fromReais(50),
    });

    await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: target.id,
      category: "Trabalho",
      alwaysForMerchant: true,
    });

    const reclassified = await repo.getTransactionById(db, historical.id);
    expect(reclassified?.category).toBe("Trabalho");
    expect(reclassified?.financialEffect).toBe("CONSUMPTION");
    expect(reclassified?.amount.cents).toBe(fromReais(50).cents);
  });

  it("(DEC-133, test 11) SYSTEM_DEFAULT rules remain immutable through the categorization flow — a personal override never overwrites the global default", async () => {
    const db = await freshSeededDb();
    // Seed a real global SYSTEM_DEFAULT rule directly — `createCategoryRule`
    // (the mutation every UI/AI flow goes through) can NEVER create one;
    // its `origin` type deliberately excludes SYSTEM_DEFAULT.
    const globalRule = {
      id: createId("category-rule"),
      matchType: "CONTAINS_MERCHANT" as const,
      pattern: "POSTO CAMPINAS",
      category: "Transporte",
      priority: 100,
      origin: "SYSTEM_DEFAULT" as const,
    };
    await repo.upsertCategoryRule(db, globalRule);

    const source = await checkingSource(db);
    const tx = await insertTransaction(db, source, { category: "UNCATEGORIZED" });
    await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: tx.id,
      category: "Trabalho",
      alwaysForMerchant: true,
    });

    const stillGlobal = await repo.getCategoryRuleById(db, globalRule.id);
    expect(stillGlobal?.origin).toBe("SYSTEM_DEFAULT");
    expect(stillGlobal?.category).toBe("Transporte");
    expect(stillGlobal?.financialProfileId).toBeUndefined();

    // Attempting to delete it (e.g. a confused UI call) must be a no-op.
    await deleteCategoryRule(db, fixtureProfile.id, globalRule.id);
    const afterDeleteAttempt = await repo.getCategoryRuleById(db, globalRule.id);
    expect(afterDeleteAttempt).toBeDefined();
  });

  it("(DEC-133, test 12) a transaction matching a system default is categorized automatically and never appears as a pending question", async () => {
    const db = await freshSeededDb();
    const transaction = await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromReais(45),
      merchantOrDescription: "IFOOD BR",
      date: ASOF,
    });
    expect(transaction.category).not.toBe("UNCATEGORIZED");

    const pending = await getPendingConfirmations(db, fixtureProfile.id, ASOF);
    expect(pending.some((p) => p.kind === "UNCATEGORIZED_TRANSACTION" && p.transactionId === transaction.id)).toBe(
      false,
    );
  });

  it("test 11: a TRANSFER can be given a display category without ever becoming CONSUMPTION", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    const transfer = await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromReais(2_000),
      merchantOrDescription: "Transferência Itaú -> Nubank",
      date: ASOF,
      financialEffect: "TRANSFER",
    });
    expect(transfer.financialEffect).toBe("TRANSFER");
    expect(transfer.direction).toBe("DEBIT");

    const result = await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: transfer.id,
      category: "Transferências",
      alwaysForMerchant: true,
    });
    expect(result.transaction.category).toBe("Transferências");
    expect(result.transaction.financialEffect).toBe("TRANSFER");
    void source;
  });

  it("test 12: a CARD_PAYMENT can be given a display category without ever becoming CONSUMPTION", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    const billPayment = await insertTransaction(db, source, {
      rawDescription: "PAGAMENTO FATURA CARTAO",
      normalizedDescription: "PAGAMENTO FATURA CARTAO",
      financialEffect: "CARD_PAYMENT",
      category: "UNCATEGORIZED",
    });

    const result = await categorizeTransaction(db, fixtureProfile.id, {
      transactionId: billPayment.id,
      category: "Fatura do cartão",
    });
    expect(result.transaction.category).toBe("Fatura do cartão");
    expect(result.transaction.financialEffect).toBe("CARD_PAYMENT");
  });

  it("test 13 (financial-effect level, cross-checked here): an INVESTMENT manual entry never becomes ordinary consumption", async () => {
    const db = await freshSeededDb();
    const investment = await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromReais(500),
      merchantOrDescription: "Aplicação CDB",
      date: ASOF,
      financialEffect: "INVESTMENT",
    });
    expect(investment.financialEffect).toBe("INVESTMENT");
    expect(investment.direction).toBe("DEBIT");
  });
});

describe("recurring candidates -> pending confirmations -> planning knowledge (tests 5, 6, 7, 8)", () => {
  it("test 8: one isolated transaction never creates a recurring candidate", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    await insertTransaction(db, source, {
      financialEffect: "INCOME",
      direction: "CREDIT",
      normalizedMerchant: "EMPRESA XYZ",
      amount: fromReais(8_500),
    });

    const candidates = await getRecurringIncomeCandidates(db, fixtureProfile.id, ASOF);
    expect(candidates).toHaveLength(0);
  });

  it("test 5: repeated history creates a persisted candidate with a stable id across reads", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    for (const date of ["2026-07-10", "2026-08-10", "2026-09-05"]) {
      await insertTransaction(db, source, {
        id: createId("transaction"),
        date,
        financialEffect: "CONSUMPTION",
        normalizedMerchant: "SMART FIT",
        amount: fromReais(119.9),
      });
    }

    const first = await getRecurringFixedExpenseCandidates(db, fixtureProfile.id, ASOF);
    expect(first).toHaveLength(1);
    const second = await getRecurringFixedExpenseCandidates(db, fixtureProfile.id, ASOF);
    expect(second[0]?.id).toBe(first[0]?.id);
  });

  it("test 6: a LOW-confidence candidate still surfaces as pending — never silently forced into a category or plan", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    // Same amount (same bucket), but no monthly cadence and only 2
    // occurrences -> LOW confidence, not HIGH/MEDIUM.
    await insertTransaction(db, source, {
      id: createId("transaction"),
      date: "2026-07-01",
      financialEffect: "CONSUMPTION",
      normalizedMerchant: "LOJA X",
      amount: fromReais(100),
    });
    await insertTransaction(db, source, {
      id: createId("transaction"),
      date: "2026-07-05",
      financialEffect: "CONSUMPTION",
      normalizedMerchant: "LOJA X",
      amount: fromReais(100),
    });

    const candidates = await getRecurringFixedExpenseCandidates(db, fixtureProfile.id, ASOF);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.confidence).toBe("LOW");

    const pending = await getPendingConfirmations(db, fixtureProfile.id, ASOF);
    expect(pending.some((p) => p.kind === "RECURRING_EXPENSE_CANDIDATE")).toBe(true);

    const { fixedExpenses } = await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF);
    expect(fixedExpenses.some((e) => e.label.includes("LOJA X"))).toBe(false);
  });

  it("test 7: confirming a recurring income candidate creates real Income with USER_CONFIRMED_HISTORY provenance, and it stops reappearing as pending", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    for (const date of ["2026-07-05", "2026-08-05", "2026-09-05"]) {
      await insertTransaction(db, source, {
        id: createId("transaction"),
        date,
        financialEffect: "INCOME",
        direction: "CREDIT",
        normalizedMerchant: "EMPRESA XYZ",
        amount: fromReais(8_500),
      });
    }

    const candidates = await getRecurringIncomeCandidates(db, fixtureProfile.id, ASOF);
    expect(candidates).toHaveLength(1);

    const income = await confirmRecurringIncomeCandidate(db, fixtureProfile.id, {
      candidateId: candidates[0]!.id,
      label: "Salário",
      expectedDayOfMonth: 5,
    });
    expect(income.source).toBe("USER_CONFIRMED_HISTORY");
    expect(income.grossAmount.cents).toBe(fromCents(850_000).cents);

    const afterConfirm = await getRecurringIncomeCandidates(db, fixtureProfile.id, ASOF);
    expect(afterConfirm).toHaveLength(0);
    const pending = await getPendingConfirmations(db, fixtureProfile.id, ASOF);
    expect(pending.some((p) => p.kind === "RECURRING_INCOME_CANDIDATE")).toBe(false);
  });

  it("test 7 (expense variant): confirming a recurring fixed-expense candidate creates a FixedExpense with USER_CONFIRMED_HISTORY provenance", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    for (const date of ["2026-07-10", "2026-08-10", "2026-09-10"]) {
      await insertTransaction(db, source, {
        id: createId("transaction"),
        date,
        financialEffect: "CONSUMPTION",
        normalizedMerchant: "SMART FIT",
        amount: fromReais(119.9),
      });
    }
    const candidates = await getRecurringFixedExpenseCandidates(db, fixtureProfile.id, ASOF);

    const expense = await confirmRecurringFixedExpenseCandidate(db, fixtureProfile.id, {
      candidateId: candidates[0]!.id,
      label: "Academia",
      category: "Saúde",
      dueDayOfMonth: 10,
    });
    expect(expense.source).toBe("USER_CONFIRMED_HISTORY");
    expect(expense.category).toBe("Saúde");
  });

  it("rejecting a candidate dismisses it without creating any planning knowledge, and it stays suppressed", async () => {
    const db = await freshSeededDb();
    const source = await checkingSource(db);
    for (const date of ["2026-07-10", "2026-08-10", "2026-09-10"]) {
      await insertTransaction(db, source, {
        id: createId("transaction"),
        date,
        financialEffect: "CONSUMPTION",
        normalizedMerchant: "SMART FIT",
        amount: fromReais(119.9),
      });
    }
    const candidates = await getRecurringFixedExpenseCandidates(db, fixtureProfile.id, ASOF);
    await rejectRecurringCandidate(db, fixtureProfile.id, candidates[0]!.id, "FIXED_EXPENSE");

    const afterReject = await getRecurringFixedExpenseCandidates(db, fixtureProfile.id, ASOF);
    expect(afterReject).toHaveLength(0);
    const { fixedExpenses } = await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF);
    expect(fixedExpenses.some((e) => e.label === "Academia")).toBe(false);
  });
});

describe("createCategoryRule (test 9: manual creation uses the same canonical domain)", () => {
  it("a manually-created rule is immediately usable by categorize()", async () => {
    const db = await freshSeededDb();
    const rule = await createCategoryRule(db, fixtureProfile.id, {
      matchType: "CONTAINS_MERCHANT",
      pattern: "UBER",
      category: "Transporte",
      origin: "USER_DECLARED",
    });

    const { categoryRules } = await repo.loadRules(db, fixtureProfile.id);
    expect(categoryRules.some((r) => r.id === rule.id)).toBe(true);

    const source: PaymentSource = { id: createId("payment-source"), label: "Nubank", type: "CREDIT_CARD" };
    const tx: FinancialTransaction = {
      id: createId("transaction"),
      financialProfileId: fixtureProfile.id as Id<"financial-profile">,
      paymentSource: source,
      date: ASOF,
      amount: fromReais(30),
      direction: "DEBIT",
      rawDescription: "UBER TRIP",
      normalizedDescription: "UBER TRIP",
      rawMerchant: "UBER",
      normalizedMerchant: "UBER",
      status: "POSTED",
      certainty: "ACTUAL",
      financialEffect: "CONSUMPTION",
      category: null,
      origin: "IMPORTED",
      createdAt: ASOF,
      updatedAt: ASOF,
    };
    expect(categorize(tx, categoryRules).category).toBe("Transporte");
  });
});
