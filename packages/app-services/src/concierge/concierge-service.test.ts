import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile, fromReais } from "@money-copilot/financial-engine";
import type { DiscoverySearchCriteria, VenueCandidate } from "@money-copilot/discovery";
import { freshSeededDb } from "../test-helpers";
import { getTransactions, getSafeToSpend, getUpcomingFinancialEventsForProfile } from "../queries";
import { recordManualTransaction } from "../mutations";
import { registerDiscoveryProvider, resetDiscoveryProviderRegistry } from "../discovery-provider-registry";
import {
  buildConciergePlansForProfile,
  getConciergeBudget,
  reevaluateConciergePlan,
  reservePlanBudget,
  saveConciergePlan,
} from "./concierge-service";
import type { ConciergeIntent } from "./types";

const ASOF = "2026-09-05";

afterEach(() => {
  resetDiscoveryProviderRegistry();
});

function venue(overrides: Partial<VenueCandidate> = {}): VenueCandidate {
  return {
    provider: "spy",
    externalPlaceId: overrides.externalPlaceId ?? "v1",
    name: overrides.name ?? "Test Dinner Place",
    category: "DINING",
    openingStatus: "OPEN",
    priceEvidence: [
      { priceType: "RANGE", minAmountCents: 12000, maxAmountCents: 16000, currency: "BRL", basis: "PER_PERSON", source: "spy", observedAt: ASOF, confidence: "MEDIUM" },
    ],
    sourceReferences: [],
    retrievedAt: ASOF,
    ...overrides,
  };
}

const dinnerOnlyIntent: ConciergeIntent = {
  requiredComponents: ["DINING"],
  optionalComponents: [],
  location: "Campinas",
  partySize: 2,
  paymentResponsibility: "FULL_PARTY",
};

describe("concierge-service", () => {
  it("(A) the discovery search ceiling is always a value DERIVED from the financial envelope, proving the envelope was resolved first", async () => {
    const db = await freshSeededDb();
    let capturedMaxPriceCents: number | undefined;
    registerDiscoveryProvider("mock", {
      name: "mock",
      searchPlaces: async (criteria: DiscoverySearchCriteria) => {
        capturedMaxPriceCents = criteria.maxPriceCents;
        return [venue()];
      },
      getPlaceDetails: async () => undefined,
    });

    const budget = await getConciergeBudget(db, fixtureProfile.id, ASOF);
    await buildConciergePlansForProfile(db, fixtureProfile.id, ASOF, dinnerOnlyIntent);

    // The search ceiling passed to the provider is EXACTLY the envelope's
    // own caution ceiling — a value that only exists once
    // getSpendingEnvelopeForProfile (the financial engine) has already run.
    expect(capturedMaxPriceCents).toBe(budget.searchCeilingCents);
    expect(capturedMaxPriceCents).toBe(budget.cautionAmountCents);
  });

  it("(B, Z) the discovery provider receives only derived search constraints, never raw financial data", async () => {
    const db = await freshSeededDb();
    let capturedCriteria: DiscoverySearchCriteria | undefined;
    registerDiscoveryProvider("mock", {
      name: "mock",
      searchPlaces: async (criteria) => {
        capturedCriteria = criteria;
        return [venue()];
      },
      getPlaceDetails: async () => undefined,
    });

    await buildConciergePlansForProfile(db, fixtureProfile.id, ASOF, dinnerOnlyIntent);

    expect(capturedCriteria).toBeDefined();
    // dinnerOnlyIntent sets only location + partySize — preferences/avoidances/
    // dateTime must be ABSENT (never invented), never present as undefined noise.
    expect(Object.keys(capturedCriteria!).sort()).toEqual(
      ["activityType", "location", "maxPriceCents", "partySize"].sort(),
    );
    // Explicitly assert none of the forbidden financial concepts ever appear.
    const serialized = JSON.stringify(capturedCriteria);
    for (const forbidden of ["income", "balance", "safeToSpend", "protectedSavings", "debt"]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("(B) an attacker-controlled provider returning an absurd price cannot change the financial envelope itself", async () => {
    const db = await freshSeededDb();
    registerDiscoveryProvider("mock", {
      name: "mock",
      searchPlaces: async () =>
        [venue({
          priceEvidence: [{ priceType: "EXACT", amountCents: 1, currency: "BRL", basis: "TOTAL", source: "spy", observedAt: ASOF, confidence: "HIGH" }],
        })],
      getPlaceDetails: async () => undefined,
    });

    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    await buildConciergePlansForProfile(db, fixtureProfile.id, ASOF, dinnerOnlyIntent);
    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);

    expect(after.total.cents).toBe(before.total.cents);
  });

  it("(U) saving a plan does not create a FinancialTransaction", async () => {
    const db = await freshSeededDb();
    registerDiscoveryProvider("mock", { name: "mock", searchPlaces: async () => [venue()], getPlaceDetails: async () => undefined });

    const before = await getTransactions(db, fixtureProfile.id, ASOF);
    const { sessionId, plans } = await buildConciergePlansForProfile(db, fixtureProfile.id, ASOF, dinnerOnlyIntent);
    await saveConciergePlan(db, fixtureProfile.id, sessionId!, plans[0]!.id);
    const after = await getTransactions(db, fixtureProfile.id, ASOF);

    expect(after.length).toBe(before.length);
  });

  it("(X) saving the same plan twice does not duplicate", async () => {
    const db = await freshSeededDb();
    registerDiscoveryProvider("mock", { name: "mock", searchPlaces: async () => [venue()], getPlaceDetails: async () => undefined });

    const { sessionId, plans } = await buildConciergePlansForProfile(db, fixtureProfile.id, ASOF, dinnerOnlyIntent);
    const first = await saveConciergePlan(db, fixtureProfile.id, sessionId!, plans[0]!.id);
    const second = await saveConciergePlan(db, fixtureProfile.id, sessionId!, plans[0]!.id);

    expect(second.id).toBe(first.id);
  });

  it("(V) reservePlanBudget creates a planned FinancialEvent, never a transaction", async () => {
    const db = await freshSeededDb();
    const beforeTx = await getTransactions(db, fixtureProfile.id, ASOF);
    const beforeEvents = await getUpcomingFinancialEventsForProfile(db, fixtureProfile.id, ASOF);

    await reservePlanBudget(db, fixtureProfile.id, {
      label: "Date night",
      amountCents: 25000,
      startDate: ASOF,
    });

    const afterTx = await getTransactions(db, fixtureProfile.id, ASOF);
    const afterEvents = await getUpcomingFinancialEventsForProfile(db, fixtureProfile.id, ASOF);

    expect(afterTx.length).toBe(beforeTx.length);
    expect(afterEvents.length).toBe(beforeEvents.length + 1);
  });

  it("(W) explicit spending still follows the existing recordManualTransaction path, not a concierge-specific one", async () => {
    const db = await freshSeededDb();
    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromReais(250),
      merchantOrDescription: "Restaurant X",
      date: ASOF,
    });
    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(after.total.cents).toBe(before.total.cents - 25_000);
  });

  it("(Y) a plan is flagged stale once the underlying financial context has changed", async () => {
    const db = await freshSeededDb();
    registerDiscoveryProvider("mock", { name: "mock", searchPlaces: async () => [venue()], getPlaceDetails: async () => undefined });

    const { sessionId, plans } = await buildConciergePlansForProfile(db, fixtureProfile.id, ASOF, dinnerOnlyIntent);
    const fresh = await reevaluateConciergePlan(db, fixtureProfile.id, ASOF, sessionId!, plans[0]!.id);
    expect(fresh.stale).toBe(false);

    // Real spending happens elsewhere, changing the envelope.
    await recordManualTransaction(db, fixtureProfile.id, {
      amount: fromReais(300),
      merchantOrDescription: "Unrelated big purchase",
      date: ASOF,
    });

    const stale = await reevaluateConciergePlan(db, fixtureProfile.id, ASOF, sessionId!, plans[0]!.id);
    expect(stale.stale).toBe(true);
  });

  it("(Sprint 7, production safety) buildConciergePlansForProfile degrades honestly instead of using mock venues in production", async () => {
    const db = await freshSeededDb();
    resetDiscoveryProviderRegistry();
    const originalEnv = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      const result = await buildConciergePlansForProfile(db, fixtureProfile.id, ASOF, dinnerOnlyIntent);
      expect(result.discoveryUnavailable).toBe(true);
      expect(result.sessionId).toBeNull();
      expect(result.plans).toEqual([]);
      expect(result.discoveryFacts).toEqual([]);
      // The financial envelope is STILL resolved deterministically — only discovery is unavailable.
      expect(result.budget.recommendedAmountCents).toBeGreaterThanOrEqual(0);
    } finally {
      process.env["NODE_ENV"] = originalEnv;
    }
  });
});
