import type {
  DiscoverySearchCriteria,
  LocalDiscoveryProvider,
  PlaceDetailsRequest,
  VenueCandidate,
} from "./provider";

/**
 * Deterministic, no-network discovery provider — the discovery-domain
 * counterpart to `@money-copilot/open-finance`'s `MockProvider`. Powers
 * every automated test AND, since no live discovery credential exists yet
 * (see docs/CONCIERGE.md, "Live provider status"), the running application
 * itself in the meantime — venue data is deliberately generic/obviously
 * synthetic ("Generic Bistro"), never presented as a real business, exactly
 * mirroring Pluggy's own sandbox-data labeling discipline.
 */
export class MockDiscoveryProvider implements LocalDiscoveryProvider {
  readonly name = "mock";
  private readonly venues: readonly VenueCandidate[];

  constructor(options?: { venues?: readonly VenueCandidate[] }) {
    this.venues = options?.venues ?? defaultMockVenues();
  }

  async searchPlaces(criteria: DiscoverySearchCriteria): Promise<readonly VenueCandidate[]> {
    return this.venues.filter((v) => {
      if (v.category !== criteria.activityType) return false;
      if (criteria.maxPriceCents === undefined) return true;
      // Include a venue if ANY of its price evidence could plausibly fit —
      // the concierge's own BudgetFit engine (not this provider) makes the
      // real determination per-candidate; this is only a coarse search filter.
      return v.priceEvidence.some((p) => {
        const low = p.minAmountCents ?? p.amountCents;
        return low === undefined || low <= criteria.maxPriceCents!;
      });
    });
  }

  async getPlaceDetails(request: PlaceDetailsRequest): Promise<VenueCandidate | undefined> {
    return this.venues.find((v) => v.provider === request.provider && v.externalPlaceId === request.externalPlaceId);
  }
}

function defaultMockVenues(): readonly VenueCandidate[] {
  const now = new Date().toISOString();
  return [
    {
      provider: "mock",
      externalPlaceId: "mock-dining-1",
      name: "Generic Bistro",
      category: "DINING",
      neighborhood: "Centro",
      rating: 4.3,
      reviewCount: 210,
      openingStatus: "OPEN",
      priceEvidence: [
        {
          priceType: "RANGE",
          minAmountCents: 12000,
          maxAmountCents: 16000,
          currency: "BRL",
          basis: "PER_PERSON",
          source: "mock",
          observedAt: now,
          confidence: "MEDIUM",
          description: "Estimated average meal price per person.",
        },
      ],
      sourceReferences: ["mock://generic-bistro"],
      retrievedAt: now,
    },
    {
      provider: "mock",
      externalPlaceId: "mock-dining-2",
      name: "Cantina Modesta",
      category: "DINING",
      neighborhood: "Centro",
      rating: 4.0,
      reviewCount: 85,
      openingStatus: "OPEN",
      priceEvidence: [
        {
          priceType: "RANGE",
          minAmountCents: 6000,
          maxAmountCents: 9000,
          currency: "BRL",
          basis: "PER_PERSON",
          source: "mock",
          observedAt: now,
          confidence: "MEDIUM",
        },
      ],
      sourceReferences: ["mock://cantina-modesta"],
      retrievedAt: now,
    },
    {
      provider: "mock",
      externalPlaceId: "mock-dining-3",
      name: "Casa Sem Preço",
      category: "DINING",
      neighborhood: "Centro",
      openingStatus: "UNKNOWN",
      priceEvidence: [],
      sourceReferences: ["mock://casa-sem-preco"],
      retrievedAt: now,
    },
    {
      provider: "mock",
      externalPlaceId: "mock-lodging-1",
      name: "Generic Motel Suites",
      category: "LODGING",
      neighborhood: "Centro",
      rating: 3.9,
      reviewCount: 40,
      openingStatus: "OPEN",
      priceEvidence: [
        {
          priceType: "STARTING_AT",
          amountCents: 10000,
          currency: "BRL",
          basis: "TOTAL",
          source: "mock",
          observedAt: now,
          confidence: "MEDIUM",
          description: "Starting price for a standard period stay.",
        },
      ],
      sourceReferences: ["mock://generic-motel-suites"],
      retrievedAt: now,
    },
  ];
}
