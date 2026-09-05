import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import { buildFinancialSnapshot } from "../snapshot/snapshot";
import { initialUserSnapshotInput } from "../fixtures/initial-user";
import { simulateExpense } from "./expense-simulation";

const snapshot = buildFinancialSnapshot(initialUserSnapshotInput);
// From snapshot.test.ts: safeToSpend.total = 217_111 cents; protectedSavings = 200_000 cents;
// discretionaryBeforeSavings = 417_111 cents (Sprint 2 fixture — see DEC-013 for the
// reconciliation of this value against Sprint 1's 247_890).

describe("simulateExpense", () => {
  it("classifies a within-budget expense as SAFE with no compensation required", () => {
    const result = simulateExpense(snapshot, {
      amount: M.fromCents(100_000),
      category: "Date night",
      date: "2026-09-05",
    });

    expect(result.status).toBe("SAFE");
    expect(result.compensationRequired.cents).toBe(0);
    expect(result.projectedSavingsBefore.cents).toBe(200_000);
    expect(result.projectedSavingsAfter.cents).toBe(200_000);
    expect(result.goalImpact.cents).toBe(0);
  });

  it("classifies a moderate overage as CAUTION (acceptable stretch)", () => {
    const result = simulateExpense(snapshot, {
      amount: M.fromCents(237_111),
      category: "Date night",
      date: "2026-09-05",
    });

    expect(result.status).toBe("CAUTION");
    expect(result.compensationRequired.cents).toBe(20_000);
    expect(result.projectedSavingsAfter.cents).toBe(180_000);
    expect(result.goalImpact.cents).toBe(-20_000);
  });

  it("classifies a large overage as HIGH_IMPACT, but never rejects the expense", () => {
    const result = simulateExpense(snapshot, {
      amount: M.fromCents(500_000),
      category: "Date night",
      date: "2026-09-05",
    });

    expect(result.status).toBe("HIGH_IMPACT");
    expect(result.compensationRequired.cents).toBe(282_889);
    expect(result.projectedSavingsAfter.cents).toBe(-82_889);
    // The simulation always returns a structured result — spending above the
    // recommendation is allowed, never blocked. See NON-NEGOTIABLE RULE #7.
    expect(result.requestedAmount.cents).toBe(500_000);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("reports the recommended limit and exposes before/after savings projections", () => {
    const result = simulateExpense(snapshot, {
      amount: M.fromCents(50_000),
      category: "Groceries",
      date: "2026-09-05",
    });

    expect(result.recommendedLimit.cents).toBe(217_111);
    expect(result.projectedSavingsBefore.cents).toBe(snapshot.projectedSavings.cents);
  });

  it("never produces non-integer cent values", () => {
    const result = simulateExpense(snapshot, {
      amount: M.fromCents(333_333),
      category: "Whatever",
      date: "2026-09-05",
    });
    for (const value of [
      result.requestedAmount,
      result.recommendedLimit,
      result.projectedSavingsBefore,
      result.projectedSavingsAfter,
      result.goalImpact,
      result.compensationRequired,
    ]) {
      expect(Number.isInteger(value.cents)).toBe(true);
    }
  });
});
