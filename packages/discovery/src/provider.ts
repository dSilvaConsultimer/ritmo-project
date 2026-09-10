/**
 * Provider-neutral local-discovery abstraction — the Sprint 6 counterpart
 * to `@money-copilot/open-finance`'s `OpenFinanceProvider`. Nothing in
 * `@money-copilot/financial-engine` ever imports this package, and this
 * package never imports `financial-engine` either: discovery evidence
 * (venue names, prices, ratings) is a completely separate concern from
 * financial calculation, combined only in `@money-copilot/app-services`'s
 * concierge orchestration layer. See docs/CONCIERGE.md.
 */

export type ActivityType = "DINING" | "DRINKS" | "LODGING" | "ENTERTAINMENT" | "GENERIC_OUTING";

/**
 * How a price was observed — never assume every price is exact. See
 * docs/CONCIERGE.md, "Price evidence model."
 *
 * EXACT        — a specific, confirmed amount (e.g. one menu item's price).
 * RANGE        — a min/max band (e.g. "R$120-180 per person").
 * STARTING_AT  — a floor only (e.g. "rooms from R$100").
 * PRICE_LEVEL  — a coarse 1-4 indicator ("$" .. "$$$$"), never converted to
 *                an exact BRL amount without an explicit, centralized,
 *                documented policy mapping (and even then, always ESTIMATED).
 * ESTIMATED    — a derived/inferred figure, explicitly not externally confirmed.
 * UNKNOWN      — no usable price signal at all.
 */
export type PriceType = "EXACT" | "RANGE" | "STARTING_AT" | "PRICE_LEVEL" | "ESTIMATED" | "UNKNOWN";

/** Whether a price applies per person or to the whole party — see docs/CONCIERGE.md, "Price-per-person." */
export type PriceBasis = "PER_PERSON" | "TOTAL" | "UNKNOWN_BASIS";

export type DiscoveryConfidence = "HIGH" | "MEDIUM" | "LOW";

/**
 * A single piece of price evidence for one venue, always carrying
 * provenance — never presented as if it were a `FinancialFact`. All
 * amounts are integer cents, matching the rest of this codebase's Money
 * convention (DEC-002), even though this package has no dependency on
 * `@money-copilot/financial-engine`'s `Money` type itself.
 */
export interface PriceEvidence {
  readonly priceType: PriceType;
  readonly amountCents?: number;
  readonly minAmountCents?: number;
  readonly maxAmountCents?: number;
  /** 1 ("$") through 4 ("$$$$") — only meaningful when `priceType === "PRICE_LEVEL"`. */
  readonly priceLevel?: 1 | 2 | 3 | 4;
  readonly currency: string;
  readonly basis: PriceBasis;
  readonly source: string;
  readonly sourceUrl?: string;
  readonly observedAt: string;
  readonly description?: string;
  readonly confidence: DiscoveryConfidence;
}

export type OpeningStatus = "OPEN" | "CLOSED" | "UNKNOWN";

/**
 * A normalized venue fact set — every field here must come from the
 * provider; nothing is ever fabricated to fill a gap. A field the provider
 * didn't return is simply absent, never guessed (see docs/CONCIERGE.md,
 * "Venue candidate model").
 */
export interface VenueCandidate {
  readonly provider: string;
  readonly externalPlaceId: string;
  readonly name: string;
  readonly category: string;
  readonly address?: string;
  readonly neighborhood?: string;
  readonly location?: { readonly lat: number; readonly lng: number };
  readonly rating?: number;
  readonly reviewCount?: number;
  readonly openingStatus: OpeningStatus;
  readonly priceEvidence: readonly PriceEvidence[];
  readonly sourceReferences: readonly string[];
  readonly retrievedAt: string;
}

/**
 * Search criteria are DERIVED discovery constraints only — never the
 * user's raw financial data. See docs/CONCIERGE.md, "Privacy boundary":
 * `maxPriceCents` is a search ceiling already computed by the concierge
 * service, never the user's Safe-to-Spend/income/balance themselves.
 */
export interface DiscoverySearchCriteria {
  readonly activityType: ActivityType;
  /** City/neighborhood-level text (e.g. "Campinas", "Barão Geraldo") — no precise GPS required for V1. */
  readonly location: string;
  readonly maxPriceCents?: number;
  readonly partySize?: number;
  readonly preferences?: readonly string[];
  readonly avoidances?: readonly string[];
  /** ISO 8601 date-time the outing is planned for, when known. */
  readonly dateTime?: string;
}

export interface PlaceDetailsRequest {
  readonly provider: string;
  readonly externalPlaceId: string;
}

/**
 * The provider abstraction. `financial-engine` never depends on this —
 * this package has no dependency on it either. See NON-NEGOTIABLE (Sprint
 * 6): "external search must NEVER determine Safe-to-Spend," enforced
 * architecturally by this package not even being ABLE to see financial
 * data types.
 */
export interface LocalDiscoveryProvider {
  readonly name: string;
  searchPlaces(criteria: DiscoverySearchCriteria): Promise<readonly VenueCandidate[]>;
  getPlaceDetails(request: PlaceDetailsRequest): Promise<VenueCandidate | undefined>;
}

export type DiscoveryErrorCode =
  | "INVALID_CONFIGURATION"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "NOT_FOUND"
  /**
   * Sprint 7 (DEC, "discovery production safety"): the only registered
   * provider for this deployment is the obviously-synthetic
   * `MockDiscoveryProvider`, and the runtime environment is production —
   * refusing to resolve it here is what makes it structurally impossible
   * for fake venue data to reach a real user, rather than relying on every
   * caller to remember to check. See docs/CONCIERGE.md, "Live provider
   * status."
   */
  | "PROVIDER_NOT_CONFIGURED_FOR_PRODUCTION"
  | "UNKNOWN";

export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;
  constructor(code: DiscoveryErrorCode, message: string) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
  }
}
