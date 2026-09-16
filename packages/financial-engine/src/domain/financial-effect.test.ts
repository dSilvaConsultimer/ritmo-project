import { describe, expect, it } from "vitest";
import { defaultDirectionForManualEntry, isConsumptionLike } from "./financial-effect";

describe("isConsumptionLike (DEC-132)", () => {
  it("treats CONSUMPTION and FEE as real spending", () => {
    expect(isConsumptionLike("CONSUMPTION")).toBe(true);
    expect(isConsumptionLike("FEE")).toBe(true);
  });

  it("never treats an investment application as ordinary spending", () => {
    expect(isConsumptionLike("INVESTMENT")).toBe(false);
  });

  it("never treats an investment redemption as ordinary spending", () => {
    expect(isConsumptionLike("INVESTMENT_REDEMPTION")).toBe(false);
  });

  it("never treats a TRANSFER or CARD_PAYMENT as ordinary spending (unchanged pre-DEC-132 rule)", () => {
    expect(isConsumptionLike("TRANSFER")).toBe(false);
    expect(isConsumptionLike("CARD_PAYMENT")).toBe(false);
  });
});

describe("defaultDirectionForManualEntry (DEC-132)", () => {
  it("CONSUMPTION, TRANSFER, and INVESTMENT leave the account (DEBIT)", () => {
    expect(defaultDirectionForManualEntry("CONSUMPTION")).toBe("DEBIT");
    expect(defaultDirectionForManualEntry("TRANSFER")).toBe("DEBIT");
    expect(defaultDirectionForManualEntry("INVESTMENT")).toBe("DEBIT");
  });

  it("REFUND and INVESTMENT_REDEMPTION arrive into the account (CREDIT)", () => {
    expect(defaultDirectionForManualEntry("REFUND")).toBe("CREDIT");
    expect(defaultDirectionForManualEntry("INVESTMENT_REDEMPTION")).toBe("CREDIT");
  });
});
