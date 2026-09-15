import { describe, expect, it } from "vitest";
import { fixtureProfile } from "@money-copilot/financial-engine";
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
        "createFixedExpense",
        "createIncome",
        "createPlannedFinancialEvent",
        "dismissAlert",
        "markAlertSeen",
        "modifyRecommendation",
        "recordManualTransaction",
        "rejectRecommendation",
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

  it("createIncome (DEC-130) sets provenance to HISTORY_INFERRED when confirming a recurring pattern, and persists expectedDayOfMonth", async () => {
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
    expect(result.source).toBe("HISTORY_INFERRED");
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
});
