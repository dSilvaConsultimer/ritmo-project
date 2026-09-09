import { describe, expect, it } from "vitest";
import type { VenueCandidate } from "@money-copilot/discovery";
import { rankVenueCandidates } from "./ranking";

function venue(id: string, rating: number): VenueCandidate {
  return {
    provider: "mock",
    externalPlaceId: id,
    name: id,
    category: "DINING",
    rating,
    openingStatus: "OPEN",
    priceEvidence: [],
    sourceReferences: [],
    retrievedAt: "2026-09-09T00:00:00.000Z",
  };
}

describe("rankVenueCandidates", () => {
  it("(23) budget fit dominates — a lower-rated but WITHIN_RECOMMENDED venue outranks a higher-rated HIGH_IMPACT one", () => {
    const cheap = venue("cheap", 3.5);
    const expensive = venue("expensive", 4.9);

    const ranked = rankVenueCandidates([expensive, cheap], {}, (v) =>
      v.externalPlaceId === "cheap" ? "WITHIN_RECOMMENDED" : "HIGH_IMPACT",
    );

    expect(ranked[0]!.venue.externalPlaceId).toBe("cheap");
  });

  it("returns inspectable, structured factors rather than one opaque score", () => {
    const ranked = rankVenueCandidates([venue("a", 4)], {}, () => "WITHIN_RECOMMENDED");
    expect(ranked[0]!.factors).toEqual(
      expect.objectContaining({
        budgetFitScore: expect.any(Number),
        preferenceMatchScore: expect.any(Number),
        ratingScore: expect.any(Number),
        priceConfidenceScore: expect.any(Number),
      }),
    );
  });

  it("a matching preference increases the score over an otherwise-identical candidate", () => {
    const matching = { ...venue("bistro-quiet", 4), name: "Quiet Bistro" };
    const nonMatching = { ...venue("loud-place", 4), name: "Loud Place" };

    const ranked = rankVenueCandidates([nonMatching, matching], { preferences: ["quiet"] }, () => "WITHIN_RECOMMENDED");

    expect(ranked[0]!.venue.name).toBe("Quiet Bistro");
  });
});
