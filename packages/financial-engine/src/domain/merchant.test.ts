import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import { normalizeMerchant, type MerchantNormalizationRule } from "./merchant";

const rules: readonly MerchantNormalizationRule[] = [
  {
    id: createId("merchant-rule"),
    matchType: "CONTAINS",
    pattern: "LOCALIZA",
    normalizedMerchant: "LOCALIZA",
    priority: 100,
  },
];

describe("normalizeMerchant", () => {
  it("normalizes known Localiza variants to a single canonical merchant", () => {
    expect(normalizeMerchant("LOCALIZAGF42", rules)).toBe("LOCALIZA");
    expect(normalizeMerchant("LOCALIZA RAC", rules)).toBe("LOCALIZA");
    expect(normalizeMerchant("LOCALIZA RENT", rules)).toBe("LOCALIZA");
  });

  it("is case-insensitive", () => {
    expect(normalizeMerchant("localiza rac", rules)).toBe("LOCALIZA");
  });

  it("returns undefined (never fabricates a value) when no rule matches", () => {
    expect(normalizeMerchant("SOME UNKNOWN MERCHANT", rules)).toBeUndefined();
  });

  it("never destroys the raw source text — callers keep both", () => {
    const raw = "LOCALIZAGF42";
    const normalized = normalizeMerchant(raw, rules);
    expect(raw).toBe("LOCALIZAGF42");
    expect(normalized).toBe("LOCALIZA");
    expect(normalized).not.toBe(raw);
  });
});
