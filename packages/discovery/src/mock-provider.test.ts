import { describe, expect, it } from "vitest";
import { MockDiscoveryProvider } from "./mock-provider";

describe("MockDiscoveryProvider", () => {
  it("returns only venues matching the requested activity type", async () => {
    const provider = new MockDiscoveryProvider();
    const results = await provider.searchPlaces({ activityType: "DINING", location: "Campinas" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((v) => v.category === "DINING")).toBe(true);
  });

  it("returns lodging venues for LODGING", async () => {
    const provider = new MockDiscoveryProvider();
    const results = await provider.searchPlaces({ activityType: "LODGING", location: "Campinas" });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((v) => v.category === "LODGING")).toBe(true);
  });

  it("includes a venue with no price evidence at all — unknown price is a real possibility", async () => {
    const provider = new MockDiscoveryProvider();
    const results = await provider.searchPlaces({ activityType: "DINING", location: "Campinas" });
    expect(results.some((v) => v.priceEvidence.length === 0)).toBe(true);
  });

  it("getPlaceDetails returns the exact venue by provider + externalPlaceId", async () => {
    const provider = new MockDiscoveryProvider();
    const details = await provider.getPlaceDetails({ provider: "mock", externalPlaceId: "mock-dining-1" });
    expect(details?.name).toBe("Generic Bistro");
  });

  it("getPlaceDetails returns undefined for an unknown id rather than guessing", async () => {
    const provider = new MockDiscoveryProvider();
    const details = await provider.getPlaceDetails({ provider: "mock", externalPlaceId: "does-not-exist" });
    expect(details).toBeUndefined();
  });

  it("is deterministic — repeated searches return the same candidates", async () => {
    const provider = new MockDiscoveryProvider();
    const first = await provider.searchPlaces({ activityType: "DINING", location: "Campinas" });
    const second = await provider.searchPlaces({ activityType: "DINING", location: "Campinas" });
    expect(first.map((v) => v.externalPlaceId)).toEqual(second.map((v) => v.externalPlaceId));
  });
});
