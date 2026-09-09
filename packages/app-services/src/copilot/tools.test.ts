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
        "createPlannedFinancialEvent",
        "modifyRecommendation",
        "recordManualTransaction",
        "rejectRecommendation",
        "replanAfterExpense",
        "reservePlanBudget",
        "saveConciergePlan",
        "updatePlannedFinancialEvent",
      ].sort(),
    );
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
});
