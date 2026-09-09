import { describe, expect, it } from "vitest";
import * as M from "../money/index";
import { computeReductionImpact } from "./recommendation-impact";
import { annualImpactFromMonthly, classifyCadence, monthlyEquivalentAmount } from "./recommendation-cadence";

describe("computeReductionImpact", () => {
  it("(J) modifying a recurring cost from X to Y calculates exactly X - Y", () => {
    const impact = computeReductionImpact(M.fromReais(100), M.fromReais(60));
    expect(impact?.projectedMonthlyImpact.cents).toBe(4000);
    expect(impact?.projectedAnnualImpact.cents).toBe(4000 * 12);
  });

  it("(K) a target equal to the current amount produces no savings recommendation (null)", () => {
    expect(computeReductionImpact(M.fromReais(100), M.fromReais(100))).toBeNull();
  });

  it("(K) a target greater than the current amount produces no savings recommendation (null)", () => {
    expect(computeReductionImpact(M.fromReais(100), M.fromReais(150))).toBeNull();
  });
});

describe("cadence normalization", () => {
  it("classifies a ~30-day interval as MONTHLY", () => {
    expect(classifyCadence(30)).toBe("MONTHLY");
  });

  it("classifies a ~7-day interval as WEEKLY", () => {
    expect(classifyCadence(7)).toBe("WEEKLY");
  });

  it("classifies a ~365-day interval as YEARLY", () => {
    expect(classifyCadence(365)).toBe("YEARLY");
  });

  it("classifies an irregular interval as UNKNOWN rather than guessing", () => {
    expect(classifyCadence(13)).toBe("UNKNOWN");
    expect(classifyCadence(null)).toBe("UNKNOWN");
  });

  it("never returns a monthly-equivalent amount for an UNKNOWN cadence", () => {
    expect(monthlyEquivalentAmount(M.fromReais(50), "UNKNOWN")).toBeNull();
  });

  it("converts a yearly amount to its monthly equivalent by dividing by 12", () => {
    const monthly = monthlyEquivalentAmount(M.fromReais(1200), "YEARLY");
    expect(monthly?.cents).toBe(10000);
  });

  it("annual impact is always monthly impact times 12", () => {
    expect(annualImpactFromMonthly(M.fromReais(59.9)).cents).toBe(5990 * 12);
  });
});
