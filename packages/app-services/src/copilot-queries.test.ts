import { describe, expect, it } from "vitest";
import { fixtureProfile, fromCents } from "@money-copilot/financial-engine";
import { freshSeededDb } from "./test-helpers";
import {
  getCategoryBudgetStatusForProfile,
  getDailyGuidanceForProfile,
  getGoalStatusForProfile,
  getRecentSpendingSummaryForProfile,
  getSafeToSpend,
  getSpendingEnvelopeForProfile,
  getUpcomingFinancialEventsForProfile,
  simulateExpenseForProfile,
} from "./queries";

const ASOF = "2026-09-05";
// This is the exact fixture used across Sprint 1-3 fixtures/tests: Safe-to-Spend
// total = 217_111 cents. See docs/PROJECT_STATE.md and
// packages/financial-engine/src/simulation/expense-simulation.test.ts.

describe("getSafeToSpend (Sprint 4 regression)", () => {
  it("still returns 217_111 cents against the seeded fixture data", async () => {
    const db = await freshSeededDb();
    const safeToSpend = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(safeToSpend.total.cents).toBe(217_111);
  });
});

describe("getSpendingEnvelopeForProfile", () => {
  it("matches the deterministic financial-engine envelope for the same snapshot", async () => {
    const db = await freshSeededDb();
    const envelope = await getSpendingEnvelopeForProfile(db, fixtureProfile.id, ASOF);
    expect(envelope.recommendedAmount.cents).toBe(217_111);
    expect(envelope.cautionAmount.cents).toBe(247_111);
  });

  it("surfaces the beach trip's unknown budget as a relevant event reservation", async () => {
    const db = await freshSeededDb();
    const envelope = await getSpendingEnvelopeForProfile(db, fixtureProfile.id, ASOF);
    expect(envelope.relevantEventReservations.some((l) => l.includes("Beach trip"))).toBe(true);
    expect(envelope.confidence).toBe("LOW");
  });
});

describe("getDailyGuidanceForProfile", () => {
  it("never claims false certainty when a planned event has an unknown budget", async () => {
    const db = await freshSeededDb();
    const guidance = await getDailyGuidanceForProfile(db, fixtureProfile.id, ASOF);
    expect(guidance.confidence).toBe("LOW");
    expect(guidance.warnings.some((w) => w.toLowerCase().includes("unknown"))).toBe(true);
  });
});

describe("simulateExpenseForProfile", () => {
  it("classifies a large expense as HIGH_IMPACT without blocking it", async () => {
    const db = await freshSeededDb();
    const result = await simulateExpenseForProfile(db, fixtureProfile.id, ASOF, {
      amount: fromCents(500_000),
      category: "Date night",
      date: ASOF,
    });
    expect(result.status).toBe("HIGH_IMPACT");
    expect(result.requestedAmount.cents).toBe(500_000);
  });
});

describe("getGoalStatusForProfile", () => {
  it("reports the monthly savings target from the seeded goal", async () => {
    const db = await freshSeededDb();
    const status = await getGoalStatusForProfile(db, fixtureProfile.id, ASOF);
    expect(status.monthlySavingsTarget.cents).toBe(200_000);
  });
});

describe("getCategoryBudgetStatusForProfile", () => {
  it("returns the seeded Food budget status", async () => {
    const db = await freshSeededDb();
    const statuses = await getCategoryBudgetStatusForProfile(db, fixtureProfile.id, ASOF);
    const food = statuses.find((s) => s.category === "Food");
    expect(food).toBeDefined();
    expect(food?.target.cents).toBe(150_000);
  });
});

describe("getUpcomingFinancialEventsForProfile", () => {
  it("includes the beach trip with its UNKNOWN budget line item, never invented as zero", async () => {
    const db = await freshSeededDb();
    const events = await getUpcomingFinancialEventsForProfile(db, fixtureProfile.id, ASOF);
    const beach = events.find((e) => e.event.label.includes("Beach"));
    expect(beach).toBeDefined();
    expect(beach?.breakdown.unknownLabels.length).toBeGreaterThan(0);
  });
});

describe("getRecentSpendingSummaryForProfile", () => {
  it("never returns the user's entire transaction history — only a bounded recent window", async () => {
    const db = await freshSeededDb();
    const summary = await getRecentSpendingSummaryForProfile(db, fixtureProfile.id, ASOF, 7);
    expect(summary.fromDate).toBe("2026-08-29");
    expect(summary.toDate).toBe(ASOF);
  });
});
