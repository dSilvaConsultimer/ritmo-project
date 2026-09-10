import { describe, expect, it } from "vitest";
import { fromReais } from "../money/money";
import type { SpendingEnvelope } from "../simulation/envelope";
import type { EventReserveBreakdown, FinancialEvent } from "./event";
import { DEFAULT_ALERT_POLICY } from "./alert-policy";
import {
  evaluateConnectionAttention,
  evaluateEventPressure,
  evaluateLiquidityCoverageChange,
  evaluateSafeToSpendChange,
  hasEventPassed,
  hasSafeToSpendRecovered,
} from "./alert-signal";

function envelope(recommendedReais: number, cautionReais: number): SpendingEnvelope {
  return {
    recommendedAmount: fromReais(recommendedReais),
    cautionAmount: fromReais(cautionReais),
    highImpactThreshold: fromReais(cautionReais),
    monthlySafeToSpendRemaining: fromReais(recommendedReais),
    protectedSavingsStatus: { target: fromReais(0), projected: fromReais(0), atRisk: false },
    warnings: [],
    confidence: "HIGH",
    relevantEventReservations: [],
  };
}

describe("evaluateSafeToSpendChange", () => {
  it("(A) a minor fluctuation is not material", () => {
    const result = evaluateSafeToSpendChange(100_000, 98_000, DEFAULT_ALERT_POLICY);
    expect(result.material).toBe(false);
    expect(result.reasonCode).toBe("NONE");
  });

  it("no baseline yet (bootstrap) is never material", () => {
    const result = evaluateSafeToSpendChange(null, 0, DEFAULT_ALERT_POLICY);
    expect(result.material).toBe(false);
  });

  it("(B) a relative drop >= threshold is material", () => {
    const result = evaluateSafeToSpendChange(100_000, 80_000, DEFAULT_ALERT_POLICY);
    expect(result.material).toBe(true);
    expect(result.reasonCode).toBe("RELATIVE_DROP");
    expect(result.relativeDropRatio).toBeCloseTo(0.2);
  });

  it("an absolute drop >= threshold is material even with a small relative ratio", () => {
    const result = evaluateSafeToSpendChange(10_000_000, 9_970_000, DEFAULT_ALERT_POLICY);
    expect(result.relativeDropRatio).toBeLessThan(DEFAULT_ALERT_POLICY.safeToSpendMaterialRelativeDropRatio);
    expect(result.material).toBe(true);
    expect(result.reasonCode).toBe("ABSOLUTE_DROP");
  });

  it("crossing from non-negative into a genuine deficit is always material — the zone-crossing signal", () => {
    const result = evaluateSafeToSpendChange(5_000, -1_000, DEFAULT_ALERT_POLICY);
    expect(result.material).toBe(true);
    expect(result.reasonCode).toBe("CROSSED_INTO_DEFICIT");
  });

  it("an increase (or unchanged value) is never material", () => {
    const result = evaluateSafeToSpendChange(80_000, 100_000, DEFAULT_ALERT_POLICY);
    expect(result.material).toBe(false);
    expect(result.absoluteDropCents).toBe(0);
  });

  it("already in deficit and getting slightly worse but not re-crossing is evaluated on ratio/absolute rules only", () => {
    const result = evaluateSafeToSpendChange(-1_000, -1_500, DEFAULT_ALERT_POLICY);
    expect(result.reasonCode).not.toBe("CROSSED_INTO_DEFICIT");
  });
});

describe("hasSafeToSpendRecovered", () => {
  it("(F) recovers once back within the hysteresis band of the original baseline", () => {
    expect(hasSafeToSpendRecovered(100_000, 96_000, DEFAULT_ALERT_POLICY)).toBe(true);
  });

  it("does not report recovered while still materially below baseline", () => {
    expect(hasSafeToSpendRecovered(100_000, 80_000, DEFAULT_ALERT_POLICY)).toBe(false);
  });

  it("never recovered while still in deficit", () => {
    expect(hasSafeToSpendRecovered(100_000, -1, DEFAULT_ALERT_POLICY)).toBe(false);
  });
});

function buildEvent(startDate: string, endDate: string, lineItems: FinancialEvent["lineItems"]): FinancialEvent {
  return { id: "event-1" as FinancialEvent["id"], label: "Trip", startDate, endDate, lineItems };
}

const emptyBreakdown: EventReserveBreakdown = {
  alreadyPaid: fromReais(0),
  futureConfirmed: fromReais(0),
  futureEstimated: fromReais(0),
  unknownLabels: [],
};

describe("evaluateEventPressure", () => {
  it("(K) an event far in the future produces no pressure regardless of cost", () => {
    const event = buildEvent("2026-10-01", "2026-10-03", []);
    const breakdown = { ...emptyBreakdown, futureConfirmed: fromReais(100_000) };
    const result = evaluateEventPressure(event, breakdown, envelope(100, 150), "2026-09-05", DEFAULT_ALERT_POLICY);
    expect(result.pressure).toBe(false);
    expect(result.unknownCostPlanning).toBe(false);
  });

  it("(L) an event near but financially comfortable produces no pressure", () => {
    const event = buildEvent("2026-09-07", "2026-09-09", []);
    const breakdown = { ...emptyBreakdown, futureConfirmed: fromReais(50) };
    const result = evaluateEventPressure(event, breakdown, envelope(500, 700), "2026-09-05", DEFAULT_ALERT_POLICY);
    expect(result.pressure).toBe(false);
  });

  it("(M) an event near AND financially pressuring produces pressure", () => {
    const event = buildEvent("2026-09-07", "2026-09-09", []);
    const breakdown = { ...emptyBreakdown, futureConfirmed: fromReais(600) };
    const result = evaluateEventPressure(event, breakdown, envelope(500, 700), "2026-09-05", DEFAULT_ALERT_POLICY);
    expect(result.pressure).toBe(true);
  });

  it("(N) an event near with an UNKNOWN-cost line item produces a planning signal, not automatically a spending-pressure one", () => {
    const event = buildEvent("2026-09-07", "2026-09-09", []);
    const breakdown = { ...emptyBreakdown, unknownLabels: ["Trip: Hotel"] };
    const result = evaluateEventPressure(event, breakdown, envelope(500, 700), "2026-09-05", DEFAULT_ALERT_POLICY);
    expect(result.unknownCostPlanning).toBe(true);
    expect(result.pressure).toBe(false);
  });

  it("an event that already started (negative days-until) is never treated as upcoming pressure", () => {
    const event = buildEvent("2026-09-01", "2026-09-03", []);
    const breakdown = { ...emptyBreakdown, futureConfirmed: fromReais(100_000) };
    const result = evaluateEventPressure(event, breakdown, envelope(100, 150), "2026-09-05", DEFAULT_ALERT_POLICY);
    expect(result.pressure).toBe(false);
    expect(result.daysUntilStart).toBeLessThan(0);
  });
});

describe("hasEventPassed", () => {
  it("(V, W) an event whose window has ended is considered passed", () => {
    expect(hasEventPassed(buildEvent("2026-09-01", "2026-09-03", []), "2026-09-05")).toBe(true);
    expect(hasEventPassed(buildEvent("2026-09-10", "2026-09-12", []), "2026-09-05")).toBe(false);
  });
});

describe("evaluateLiquidityCoverageChange", () => {
  it("(O) COMPLETE -> PARTIAL is a degradation", () => {
    expect(evaluateLiquidityCoverageChange("COMPLETE", "PARTIAL")).toEqual({ degraded: true, improved: false });
  });

  it("(P) an unchanged coverage is neither degraded nor improved", () => {
    expect(evaluateLiquidityCoverageChange("PARTIAL", "PARTIAL")).toEqual({ degraded: false, improved: false });
  });

  it("(Q) PARTIAL -> COMPLETE is an improvement (resolves an existing alert)", () => {
    expect(evaluateLiquidityCoverageChange("PARTIAL", "COMPLETE")).toEqual({ degraded: false, improved: true });
  });

  it("no baseline yet is never a degradation", () => {
    expect(evaluateLiquidityCoverageChange(null, "UNKNOWN")).toEqual({ degraded: false, improved: false });
  });
});

describe("evaluateConnectionAttention", () => {
  it("(R) a single transient error does not need attention", () => {
    const result = evaluateConnectionAttention("LOGIN_ERROR", 1, null, DEFAULT_ALERT_POLICY);
    expect(result.needsAttention).toBe(false);
  });

  it("(S) repeated consecutive failures need attention", () => {
    const result = evaluateConnectionAttention("LOGIN_ERROR", 2, null, DEFAULT_ALERT_POLICY);
    expect(result.needsAttention).toBe(true);
    expect(result.reasonCode).toBe("REPEATED_SYNC_FAILURE");
  });

  it("a CONNECTED but long-stale connection needs attention even with a healthy status", () => {
    const result = evaluateConnectionAttention("CONNECTED", 0, 30, DEFAULT_ALERT_POLICY);
    expect(result.needsAttention).toBe(true);
    expect(result.reasonCode).toBe("STALE_SYNC");
  });

  it("(T) a healthy, recently-synced connection never needs attention", () => {
    const result = evaluateConnectionAttention("CONNECTED", 0, 1, DEFAULT_ALERT_POLICY);
    expect(result.needsAttention).toBe(false);
  });

  it("a DISCONNECTED connection never needs attention — it's an explicit user action, not a fault", () => {
    const result = evaluateConnectionAttention("DISCONNECTED", 5, 999, DEFAULT_ALERT_POLICY);
    expect(result.needsAttention).toBe(false);
  });
});
