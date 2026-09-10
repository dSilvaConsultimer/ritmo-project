import { afterEach, describe, expect, it } from "vitest";
import { DiscoveryError } from "@money-copilot/discovery";
import { getDiscoveryProvider, registerDiscoveryProvider, resetDiscoveryProviderRegistry } from "./discovery-provider-registry";

/**
 * Sprint 7 (Section 71-I: "Mock discovery data cannot appear in production
 * mode"): `MockDiscoveryProvider` is obviously-synthetic and must never be
 * what a production deployment presents as a real search result — see
 * docs/CONCIERGE.md, "Discovery degradation."
 */
describe("getDiscoveryProvider — production safety", () => {
  afterEach(() => resetDiscoveryProviderRegistry());

  it("resolves the mock provider normally outside production", () => {
    expect(() => getDiscoveryProvider("mock", "development")).not.toThrow();
    expect(() => getDiscoveryProvider("mock", "test")).not.toThrow();
    expect(() => getDiscoveryProvider("mock", undefined)).not.toThrow();
  });

  it("refuses to resolve the mock provider when the environment is production", () => {
    let caught: unknown;
    try {
      getDiscoveryProvider("mock", "production");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DiscoveryError);
    expect((caught as DiscoveryError).code).toBe("PROVIDER_NOT_CONFIGURED_FOR_PRODUCTION");
  });

  it("a test-injected provider (already registered) is still usable regardless of environment", () => {
    resetDiscoveryProviderRegistry();
    const fixture = { name: "mock", searchPlaces: async () => [], getPlaceDetails: async () => undefined };
    // registerDiscoveryProvider bypasses the production check entirely — this is a deliberate test-only escape hatch.
    registerDiscoveryProvider("mock", fixture);
    expect(getDiscoveryProvider("mock", "production")).toBe(fixture);
  });
});
