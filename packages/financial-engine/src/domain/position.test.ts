import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "../money/index";
import { actual, unknownAmount } from "./certainty";
import {
  computeLiquidityAwareSafeToSpend,
  unknownFinancialPosition,
  type FinancialPosition,
} from "./position";

const profileId = createId("financial-profile");
const planSafeToSpend = M.fromReais(2_171.11);

describe("FinancialPosition — unknown liquidity", () => {
  it("never pretends the plan number is real cash when liquidity is unknown", () => {
    const position = unknownFinancialPosition(profileId, "2026-09-05");
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, position);
    expect(result.liquidityAwareSafeToSpend).toBeNull();
    expect(result.confidence).toBe("UNKNOWN");
    expect(result.planSafeToSpend.cents).toBe(planSafeToSpend.cents);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("FinancialPosition — known cash", () => {
  const knownPosition: FinancialPosition = {
    id: createId("financial-position"),
    financialProfileId: profileId,
    asOf: "2026-09-05",
    cashBalance: actual(M.fromReais(1_000)),
    cardOutstandingBalance: actual(M.fromReais(200)),
    otherLiabilities: actual(M.ZERO),
    source: "manual entry",
  };

  it("narrows Safe-to-Spend to the lower of plan vs. actual liquidity (low cash, healthy plan)", () => {
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, knownPosition);
    // Available liquidity: 1000 - 200 - 0 = 800 reais, well below the plan's ~2171.
    expect(result.liquidityAwareSafeToSpend?.cents).toBe(M.fromReais(800).cents);
    expect(result.confidence).toBe("KNOWN");
  });

  it("narrows Safe-to-Spend to the plan figure when liquidity is larger but already committed", () => {
    const flushPosition: FinancialPosition = {
      ...knownPosition,
      cashBalance: actual(M.fromReais(50_000)),
      cardOutstandingBalance: actual(M.ZERO),
    };
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, flushPosition);
    // Plenty of cash, but the monthly PLAN still constrains discretionary spend.
    expect(result.liquidityAwareSafeToSpend?.cents).toBe(planSafeToSpend.cents);
  });

  it("marks confidence PARTIAL and warns when card outstanding balance is unknown", () => {
    const partialPosition: FinancialPosition = {
      ...knownPosition,
      cardOutstandingBalance: unknownAmount(),
    };
    const result = computeLiquidityAwareSafeToSpend(planSafeToSpend, partialPosition);
    expect(result.confidence).toBe("PARTIAL");
    expect(result.liquidityAwareSafeToSpend).not.toBeNull();
    expect(result.warnings.some((w) => w.toLowerCase().includes("card"))).toBe(true);
  });
});
