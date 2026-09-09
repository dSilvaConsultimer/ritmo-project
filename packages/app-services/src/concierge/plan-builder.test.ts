import { describe, expect, it } from "vitest";
import * as M from "@money-copilot/financial-engine";
import type { SpendingEnvelope } from "@money-copilot/financial-engine";
import type { VenueCandidate } from "@money-copilot/discovery";
import {
  buildConciergePlans,
  resolvePartyMultiplier,
  sumCostRangesCents,
  venueCostRangeCents,
} from "./plan-builder";
import type { ConciergeIntent } from "./types";

function envelope(recommendedReais: number, cautionReais: number): SpendingEnvelope {
  return {
    recommendedAmount: M.fromReais(recommendedReais),
    cautionAmount: M.fromReais(cautionReais),
    highImpactThreshold: M.fromReais(cautionReais),
    monthlySafeToSpendRemaining: M.fromReais(recommendedReais),
    protectedSavingsStatus: { target: M.fromReais(2000), projected: M.fromReais(2000), atRisk: false },
    warnings: [],
    confidence: "HIGH",
    relevantEventReservations: [],
  };
}

function venue(overrides: Partial<VenueCandidate> = {}): VenueCandidate {
  return {
    provider: "mock",
    externalPlaceId: overrides.externalPlaceId ?? "v1",
    name: overrides.name ?? "Test Venue",
    category: overrides.category ?? "DINING",
    openingStatus: "OPEN",
    priceEvidence: overrides.priceEvidence ?? [
      { priceType: "RANGE", minAmountCents: 12000, maxAmountCents: 16000, currency: "BRL", basis: "PER_PERSON", source: "mock", observedAt: "2026-09-09T00:00:00.000Z", confidence: "MEDIUM" },
    ],
    sourceReferences: [],
    retrievedAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  };
}

const baseIntent: ConciergeIntent = {
  requiredComponents: ["DINING"],
  optionalComponents: [],
  paymentResponsibility: "SELF_ONLY",
};

describe("resolvePartyMultiplier", () => {
  it("(M) FULL_PARTY multiplies by party size", () => {
    expect(resolvePartyMultiplier("FULL_PARTY", 2)).toBe(2);
  });
  it("SELF_ONLY never multiplies, regardless of party size", () => {
    expect(resolvePartyMultiplier("SELF_ONLY", 2)).toBe(1);
  });
  it("UNKNOWN never assumes a full-party multiplier", () => {
    expect(resolvePartyMultiplier("UNKNOWN", 4)).toBe(1);
  });
});

describe("venueCostRangeCents", () => {
  it("multiplies a PER_PERSON range by the party multiplier", () => {
    const v = venue({
      priceEvidence: [{ priceType: "RANGE", minAmountCents: 10000, maxAmountCents: 15000, currency: "BRL", basis: "PER_PERSON", source: "mock", observedAt: "x", confidence: "HIGH" }],
    });
    expect(venueCostRangeCents(v, 2)).toEqual({ min: 20000, max: 30000 });
  });

  it("never multiplies a TOTAL price by party size", () => {
    const v = venue({
      priceEvidence: [{ priceType: "STARTING_AT", amountCents: 10000, currency: "BRL", basis: "TOTAL", source: "mock", observedAt: "x", confidence: "MEDIUM" }],
    });
    expect(venueCostRangeCents(v, 2)).toEqual({ min: 10000, max: 10000 });
  });

  it("(F) returns null for a venue with no price evidence at all", () => {
    const v = venue({ priceEvidence: [] });
    expect(venueCostRangeCents(v, 1)).toBeNull();
  });

  it("never converts a PRICE_LEVEL indicator into a BRL amount", () => {
    const v = venue({
      priceEvidence: [{ priceType: "PRICE_LEVEL", priceLevel: 2, currency: "BRL", basis: "UNKNOWN_BASIS", source: "mock", observedAt: "x", confidence: "LOW" }],
    });
    expect(venueCostRangeCents(v, 1)).toBeNull();
  });
});

describe("sumCostRangesCents", () => {
  it("(H) sums two components deterministically", () => {
    expect(sumCostRangesCents([{ min: 12000, max: 16000 }, { min: 10000, max: 10000 }])).toEqual({
      min: 22000,
      max: 26000,
    });
  });

  it("(N) any missing component price makes the combined total unknown, not silently zero", () => {
    expect(sumCostRangesCents([{ min: 12000, max: 16000 }, null])).toBeNull();
  });
});

describe("buildConciergePlans", () => {
  const dining = venue({ externalPlaceId: "d1", category: "DINING", name: "Dinner Place" });
  const lodgingKnown = venue({
    externalPlaceId: "l1",
    category: "LODGING",
    name: "Motel Known",
    priceEvidence: [{ priceType: "STARTING_AT", amountCents: 10000, currency: "BRL", basis: "TOTAL", source: "mock", observedAt: "x", confidence: "MEDIUM" }],
  });
  const env = envelope(300, 400);

  it("(I) the base plan's cost never includes an optional component's cost", () => {
    const candidates = new Map([
      ["DINING", [dining]],
      ["LODGING", [lodgingKnown]],
    ]);
    const plans = buildConciergePlans(
      { ...baseIntent, optionalComponents: ["LODGING"] },
      env,
      candidates as ReadonlyMap<"DINING" | "LODGING", readonly VenueCandidate[]>,
    );
    const basePlan = plans.find((p) => p.components.every((c) => c.required));
    expect(basePlan?.totalCostRangeCents).toEqual(basePlan?.baseCostRangeCents);
    const withOptional = plans.find((p) => p.components.some((c) => !c.required));
    expect(withOptional!.totalCostRangeCents!.min).toBeGreaterThan(basePlan!.baseCostRangeCents!.min);
  });

  it("(H) produces exactly 2 plans for 1 required + 1 optional component", () => {
    const candidates = new Map([
      ["DINING", [dining]],
      ["LODGING", [lodgingKnown]],
    ]);
    const plans = buildConciergePlans(
      { ...baseIntent, optionalComponents: ["LODGING"] },
      env,
      candidates as ReadonlyMap<"DINING" | "LODGING", readonly VenueCandidate[]>,
    );
    expect(plans).toHaveLength(2);
  });

  it("(N) an optional component with no price evidence makes the WITH-optional plan's fit UNKNOWN_COST, not SAFE", () => {
    const lodgingUnknown = venue({ externalPlaceId: "l2", category: "LODGING", name: "Motel Unknown", priceEvidence: [] });
    const candidates = new Map([
      ["DINING", [dining]],
      ["LODGING", [lodgingUnknown]],
    ]);
    const plans = buildConciergePlans(
      { ...baseIntent, optionalComponents: ["LODGING"] },
      env,
      candidates as ReadonlyMap<"DINING" | "LODGING", readonly VenueCandidate[]>,
    );
    const withOptional = plans.find((p) => p.components.some((c) => !c.required));
    expect(withOptional!.totalBudgetFit.zone).toBe("UNKNOWN_COST");
    // The base (dinner-only) plan is unaffected — it still has real evidence.
    const basePlan = plans.find((p) => p.components.every((c) => c.required));
    expect(basePlan!.baseBudgetFit.zone).not.toBe("UNKNOWN_COST");
  });

  it("produces exactly 1 plan when there are no optional components", () => {
    const candidates = new Map([["DINING", [dining]]]);
    const plans = buildConciergePlans(baseIntent, env, candidates as ReadonlyMap<"DINING", readonly VenueCandidate[]>);
    expect(plans).toHaveLength(1);
  });
});
