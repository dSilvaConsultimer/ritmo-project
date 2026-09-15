import { describe, expect, it } from "vitest";
import { resolveConnectBankBackTo } from "./connect-bank-navigation";

/**
 * Regression coverage for the Bank Connection screen's contextual Back
 * navigation — the exact four scenarios the fix was requested for.
 */
describe("resolveConnectBankBackTo", () => {
  it("onboarding -> connect -> back = /onboarding", () => {
    expect(resolveConnectBankBackTo("onboarding", false)).toBe("/onboarding");
    // Origin wins even if the profile already has a connection by the time
    // Back is pressed (e.g. reconnecting from onboarding somehow) — the
    // explicit origin is always authoritative over the fallback.
    expect(resolveConnectBankBackTo("onboarding", true)).toBe("/onboarding");
  });

  it("mais -> connect -> back = /mais", () => {
    expect(resolveConnectBankBackTo("mais", true)).toBe("/mais");
    expect(resolveConnectBankBackTo("mais", false)).toBe("/mais");
  });

  it("direct access with zero connections falls back to /onboarding", () => {
    expect(resolveConnectBankBackTo(undefined, false)).toBe("/onboarding");
  });

  it("direct access with an existing connection falls back to /mais", () => {
    expect(resolveConnectBankBackTo(undefined, true)).toBe("/mais");
  });
});
