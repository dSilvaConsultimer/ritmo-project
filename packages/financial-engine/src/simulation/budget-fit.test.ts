import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import type { SpendingEnvelope } from "./envelope";
import { deriveSearchCeiling, evaluateBudgetFit } from "./budget-fit";

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

describe("evaluateBudgetFit", () => {
  const env = envelope(300, 400); // recommended R$300, caution ceiling R$400

  it("(C) a candidate within the recommended amount -> WITHIN_RECOMMENDED", () => {
    const result = evaluateBudgetFit(env, { min: M.fromReais(150), max: M.fromReais(150) });
    expect(result.zone).toBe("WITHIN_RECOMMENDED");
  });

  it("(D) a candidate within the maximum but above recommended -> WITHIN_CAUTION", () => {
    const result = evaluateBudgetFit(env, { min: M.fromReais(350), max: M.fromReais(350) });
    expect(result.zone).toBe("WITHIN_CAUTION");
  });

  it("(E) a candidate above the caution ceiling -> HIGH_IMPACT", () => {
    const result = evaluateBudgetFit(env, { min: M.fromReais(500), max: M.fromReais(500) });
    expect(result.zone).toBe("HIGH_IMPACT");
  });

  it("(F) an unknown price -> UNKNOWN_COST, never presented as fitting", () => {
    const result = evaluateBudgetFit(env, null);
    expect(result.zone).toBe("UNKNOWN_COST");
    expect(result.minZone).toBe("UNKNOWN_COST");
    expect(result.maxZone).toBe("UNKNOWN_COST");
  });

  it("(G) a range whose lower bound fits but upper bound does not -> mixed result, conservative overall zone", () => {
    const result = evaluateBudgetFit(env, { min: M.fromReais(250), max: M.fromReais(350) });
    expect(result.minZone).toBe("WITHIN_RECOMMENDED");
    expect(result.maxZone).toBe("WITHIN_CAUTION");
    expect(result.zone).toBe("WITHIN_CAUTION"); // conservative (worse) of the two
  });

  it("(K) a generous user ceiling never erases a HIGH_IMPACT classification", () => {
    const result = evaluateBudgetFit(env, { min: M.fromReais(500), max: M.fromReais(500) }, M.fromReais(1000));
    expect(result.zone).toBe("HIGH_IMPACT");
  });

  it("a stricter user ceiling can classify an otherwise-safe amount as EXCEEDS_LIMIT", () => {
    const result = evaluateBudgetFit(env, { min: M.fromReais(150), max: M.fromReais(150) }, M.fromReais(100));
    expect(result.zone).toBe("EXCEEDS_LIMIT");
  });

  it("a user ceiling exactly at the amount does not trigger EXCEEDS_LIMIT (boundary is inclusive)", () => {
    const result = evaluateBudgetFit(env, { min: M.fromReais(150), max: M.fromReais(150) }, M.fromReais(150));
    expect(result.zone).toBe("WITHIN_RECOMMENDED");
  });
});

describe("deriveSearchCeiling", () => {
  const env = envelope(300, 400);

  it("(J) a user explicit budget lower than the envelope becomes the search constraint", () => {
    expect(deriveSearchCeiling(env, M.fromReais(200)).cents).toBe(M.fromReais(200).cents);
  });

  it("defaults to the caution ceiling (not just the recommended amount) when no user budget is given", () => {
    expect(deriveSearchCeiling(env).cents).toBe(M.fromReais(400).cents);
  });

  it("never loosens the search ceiling beyond the caution amount even for a generous user budget", () => {
    expect(deriveSearchCeiling(env, M.fromReais(1000)).cents).toBe(M.fromReais(400).cents);
  });
});
