import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import { fixtureProfile, fromReais } from "@money-copilot/financial-engine";
import type { FinancialTransaction, PaymentSource } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { freshSeededDb } from "../test-helpers";
import { findTool, TOOL_REGISTRY } from "./tools";

const ASOF = "2026-09-05";

describe("TOOL_REGISTRY", () => {
  it("has no duplicate tool names", () => {
    const names = TOOL_REGISTRY.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes every required Sprint 4 tool", () => {
    const names = new Set(TOOL_REGISTRY.map((t) => t.name));
    for (const required of [
      "getFinancialSnapshot",
      "getSafeToSpend",
      "getSafeToSpendBreakdown",
      "getFinancialPosition",
      "getLifestyleComparison",
      "getGoalStatus",
      "simulateExpense",
      "getSpendingEnvelope",
      "recordManualTransaction",
      "createPlannedFinancialEvent",
      "updatePlannedFinancialEvent",
      "getUpcomingFinancialEvents",
      "getCategoryBudgetStatus",
      "getRecentSpendingSummary",
      "replanAfterExpense",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it("includes every required Sprint 5 recommendation tool", () => {
    const names = new Set(TOOL_REGISTRY.map((t) => t.name));
    for (const required of [
      "getRecommendations",
      "getRecommendationDetails",
      "acceptRecommendation",
      "modifyRecommendation",
      "rejectRecommendation",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it("includes every required Sprint 6 concierge tool", () => {
    const names = new Set(TOOL_REGISTRY.map((t) => t.name));
    for (const required of [
      "getConciergeBudget",
      "searchPlaces",
      "buildConciergePlans",
      "evaluateConciergePlan",
      "saveConciergePlan",
      "reservePlanBudget",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it("classifies exactly the state-changing tools as MUTATION", () => {
    const mutationNames = TOOL_REGISTRY.filter((t) => t.kind === "MUTATION").map((t) => t.name).sort();
    expect(mutationNames).toEqual(
      [
        "acceptRecommendation",
        "categorizeTransaction",
        "confirmRecurringFixedExpenseCandidate",
        "confirmRecurringIncomeCandidate",
        "createCategoryRule",
        "createFixedExpense",
        "createIncome",
        "createPlannedFinancialEvent",
        "dismissAlert",
        "markAlertSeen",
        "modifyRecommendation",
        "recordManualTransaction",
        "rejectRecommendation",
        "rejectRecurringCandidate",
        "replanAfterExpense",
        "reservePlanBudget",
        "saveConciergePlan",
        "updateNotificationPreference",
        "updatePlannedFinancialEvent",
      ].sort(),
    );
  });

  it("includes every required Sprint 7 alert tool", () => {
    const names = new Set(TOOL_REGISTRY.map((t) => t.name));
    for (const required of [
      "getAlerts",
      "getAlertDetails",
      "markAlertSeen",
      "dismissAlert",
      "reevaluateAlertContext",
      "updateNotificationPreference",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  it("classifies getAlerts, getAlertDetails, and reevaluateAlertContext as READ", () => {
    expect(findTool("getAlerts")?.kind).toBe("READ");
    expect(findTool("getAlertDetails")?.kind).toBe("READ");
    expect(findTool("reevaluateAlertContext")?.kind).toBe("READ");
  });

  it("classifies getRecommendations and getRecommendationDetails as READ", () => {
    expect(findTool("getRecommendations")?.kind).toBe("READ");
    expect(findTool("getRecommendationDetails")?.kind).toBe("READ");
  });

  it("classifies getConciergeBudget, searchPlaces, buildConciergePlans, and evaluateConciergePlan as READ", () => {
    expect(findTool("getConciergeBudget")?.kind).toBe("READ");
    expect(findTool("searchPlaces")?.kind).toBe("READ");
    expect(findTool("buildConciergePlans")?.kind).toBe("READ");
    expect(findTool("evaluateConciergePlan")?.kind).toBe("READ");
  });

  it("classifies getSafeToSpend, simulateExpense, and getSpendingEnvelope as READ", () => {
    expect(findTool("getSafeToSpend")?.kind).toBe("READ");
    expect(findTool("simulateExpense")?.kind).toBe("READ");
    expect(findTool("getSpendingEnvelope")?.kind).toBe("READ");
  });

  it("includes every required Sprint 9 recurring-income/fixed-expense tool, correctly classified (DEC-127)", () => {
    const names = new Set(TOOL_REGISTRY.map((t) => t.name));
    for (const required of [
      "getRecurringIncomeCandidates",
      "getRecurringFixedExpenseCandidates",
      "createIncome",
      "createFixedExpense",
    ]) {
      expect(names.has(required)).toBe(true);
    }
    // READ tools (pattern detection) execute unconditionally; MUTATION
    // tools are gated by hasExplicitMutationIntent — never the reverse,
    // since a candidate must never be silently treated as confirmed.
    expect(findTool("getRecurringIncomeCandidates")?.kind).toBe("READ");
    expect(findTool("getRecurringFixedExpenseCandidates")?.kind).toBe("READ");
    expect(findTool("createIncome")?.kind).toBe("MUTATION");
    expect(findTool("createFixedExpense")?.kind).toBe("MUTATION");
  });
});

describe("findTool", () => {
  it("returns undefined for an unregistered tool name — never falls back to an arbitrary function", () => {
    expect(findTool("dropAllTables")).toBeUndefined();
    expect(findTool("queryDatabaseDirectly")).toBeUndefined();
  });
});

describe("tool execution against seeded data", () => {
  it("getSafeToSpend returns the regression-tested 217_111 cents", async () => {
    const db = await freshSeededDb();
    const tool = findTool("getSafeToSpend")!;
    const args = tool.schema.parse({});
    const result = (await tool.execute({ db, financialProfileId: fixtureProfile.id, asOfDate: ASOF }, args)) as {
      total: { cents: number };
    };
    expect(result.total.cents).toBe(217_111);
  });

  it("rejects invalid simulateExpense arguments before ever touching the database", () => {
    const tool = findTool("simulateExpense")!;
    expect(() => tool.schema.parse({ amountReais: -5, category: "Food" })).toThrow();
    expect(() => tool.schema.parse({ category: "Food" })).toThrow();
  });

  it("simulateExpense executes and returns a structured, never-blocking result", async () => {
    const db = await freshSeededDb();
    const tool = findTool("simulateExpense")!;
    const args = tool.schema.parse({ amountReais: 5000, category: "Date night" });
    const result = (await tool.execute(
      { db, financialProfileId: fixtureProfile.id, asOfDate: ASOF },
      args,
    )) as { status: string };
    expect(result.status).toBe("HIGH_IMPACT");
  });

  it("createIncome (DEC-127) persists a real Income only via the tool's own execute — never as a side effect of the READ candidate tool", async () => {
    const db = await freshSeededDb();
    const readTool = findTool("getRecurringIncomeCandidates")!;
    await readTool.execute({ db, financialProfileId: fixtureProfile.id, asOfDate: ASOF }, {});

    const createTool = findTool("createIncome")!;
    const args = createTool.schema.parse({ label: "Salário", grossAmountReais: 8500 });
    const result = (await createTool.execute(
      { db, financialProfileId: fixtureProfile.id, asOfDate: ASOF },
      args,
    )) as { grossAmount: { cents: number }; recurring: boolean };
    expect(result.grossAmount.cents).toBe(850_000);
    expect(result.recurring).toBe(true);
  });

  it("createIncome (DEC-130) defaults provenance to USER_DECLARED when fromRecurringPattern is omitted", async () => {
    const db = await freshSeededDb();
    const createTool = findTool("createIncome")!;
    const args = createTool.schema.parse({ label: "Salário", grossAmountReais: 8500 });
    const result = (await createTool.execute(
      { db, financialProfileId: fixtureProfile.id, asOfDate: ASOF },
      args,
    )) as { source: string };
    expect(result.source).toBe("USER_DECLARED");
  });

  it("createIncome (DEC-130 corrected) sets provenance to USER_CONFIRMED_HISTORY when confirming a recurring pattern, never the bare HISTORY_INFERRED state, and persists expectedDayOfMonth", async () => {
    const db = await freshSeededDb();
    const createTool = findTool("createIncome")!;
    const args = createTool.schema.parse({
      label: "Salário",
      grossAmountReais: 8500,
      expectedDayOfMonth: 5,
      fromRecurringPattern: true,
    });
    const result = (await createTool.execute(
      { db, financialProfileId: fixtureProfile.id, asOfDate: ASOF },
      args,
    )) as { source: string; expectedDayOfMonth?: number };
    expect(result.source).toBe("USER_CONFIRMED_HISTORY");
    expect(result.expectedDayOfMonth).toBe(5);
  });

  it("createFixedExpense (DEC-127) persists a real FixedExpense only via the tool's own execute", async () => {
    const db = await freshSeededDb();
    const tool = findTool("createFixedExpense")!;
    const args = tool.schema.parse({ label: "Condomínio", category: "Moradia", amountReais: 800 });
    const result = (await tool.execute(
      { db, financialProfileId: fixtureProfile.id, asOfDate: ASOF },
      args,
    )) as { amount: { cents: number } };
    expect(result.amount.cents).toBe(80_000);
  });

  it("(DEC-132, test 10) recordManualTransaction classifies a TRANSFER from the AI's own declared financialEffect, never as CONSUMPTION", async () => {
    const db = await freshSeededDb();
    const tool = findTool("recordManualTransaction")!;
    const args = tool.schema.parse({
      amountReais: 2_000,
      merchantOrDescription: "Transferência Itaú -> Nubank",
      financialEffect: "TRANSFER",
    });
    const result = (await tool.execute(
      { db, financialProfileId: fixtureProfile.id, asOfDate: ASOF },
      args,
    )) as { financialEffect: string; direction: string };
    expect(result.financialEffect).toBe("TRANSFER");
    expect(result.direction).toBe("DEBIT");
  });

  it("(DEC-132, test 10) createCategoryRule and categorizeTransaction's 'always' path both create a rule usable by categorize() — the same canonical domain the AI and the UI share", async () => {
    const db = await freshSeededDb();
    const tool = findTool("createCategoryRule")!;
    const args = tool.schema.parse({ matchType: "CONTAINS_MERCHANT", pattern: "UBER", category: "Transporte" });
    const result = (await tool.execute({ db, financialProfileId: fixtureProfile.id, asOfDate: ASOF }, args)) as {
      origin: string;
    };
    expect(result.origin).toBe("USER_DECLARED");
  });

  it("(DEC-132, test 10) confirmRecurringFixedExpenseCandidate creates a FixedExpense with USER_CONFIRMED_HISTORY provenance via the SAME mutation the UI uses", async () => {
    const db = await freshSeededDb();
    const source: PaymentSource = { id: createId("payment-source"), label: "Conta Corrente", type: "DEBIT" };
    await repo.upsertPaymentSource(db, source, fixtureProfile.id);
    for (const date of ["2026-07-10", "2026-08-10", "2026-09-05"]) {
      const tx: FinancialTransaction = {
        id: createId("transaction"),
        financialProfileId: fixtureProfile.id,
        paymentSource: source,
        date,
        amount: fromReais(119.9),
        direction: "DEBIT",
        rawDescription: "SMART FIT",
        normalizedDescription: "SMART FIT",
        rawMerchant: "SMART FIT",
        normalizedMerchant: "SMART FIT",
        status: "POSTED",
        certainty: "ACTUAL",
        financialEffect: "CONSUMPTION",
        category: null,
        origin: "IMPORTED",
        createdAt: date,
        updatedAt: date,
      };
      await repo.upsertTransaction(db, tx);
    }

    const readTool = findTool("getRecurringFixedExpenseCandidates")!;
    const candidates = (await readTool.execute(
      { db, financialProfileId: fixtureProfile.id, asOfDate: ASOF },
      {},
    )) as readonly { id: string }[];
    expect(candidates.length).toBeGreaterThan(0);

    const confirmTool = findTool("confirmRecurringFixedExpenseCandidate")!;
    const args = confirmTool.schema.parse({
      candidateId: candidates[0]!.id,
      label: "Academia",
      category: "Saúde",
    });
    const result = (await confirmTool.execute(
      { db, financialProfileId: fixtureProfile.id, asOfDate: ASOF },
      args,
    )) as { source: string };
    expect(result.source).toBe("USER_CONFIRMED_HISTORY");
  });
});
