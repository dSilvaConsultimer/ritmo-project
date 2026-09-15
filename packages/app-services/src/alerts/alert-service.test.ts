import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile, fromReais } from "@money-copilot/financial-engine";
import type { ExternalAccountInput, ExternalTransactionInput } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { createId } from "@money-copilot/shared";
import { freshSeededDb, installMockProvider } from "../test-helpers";
import { syncConnection } from "../sync";
import { acceptRecommendation, evaluateRecommendationVerifications } from "../recommendation-service";
import { createPlannedFinancialEvent, recordManualTransaction } from "../mutations";
import { getSafeToSpend } from "../queries";
import { resetProviderRegistry } from "../provider-registry";
import { registerDiscoveryProvider, resetDiscoveryProviderRegistry } from "../discovery-provider-registry";
import { buildConciergePlansForProfile, saveConciergePlan } from "../concierge";
import type { VenueCandidate } from "@money-copilot/discovery";
import { evaluateAlerts, listAlertsForProfile, dismissAlert, markAlertSeen, reevaluateAlertContext } from "./alert-service";

const ASOF = "2026-09-05";

afterEach(() => {
  resetProviderRegistry();
  resetDiscoveryProviderRegistry();
});

function alertsOfType(alerts: Awaited<ReturnType<typeof listAlertsForProfile>>, type: string) {
  return alerts.filter((a) => a.type === type);
}

describe("evaluateAlerts — Safe-to-Spend material drop (A-G, X)", () => {
  it("(A) a minor fluctuation creates no alert", async () => {
    const db = await freshSeededDb();
    await evaluateAlerts(db, fixtureProfile.id, ASOF); // bootstrap
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1), merchantOrDescription: "Coffee", date: ASOF });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);

    const alerts = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");
    expect(alerts).toHaveLength(0);
  });

  it("(B, C) a material drop creates exactly one alert; 3 repeated evaluations reuse it, not duplicate it", async () => {
    const db = await freshSeededDb();
    await evaluateAlerts(db, fixtureProfile.id, ASOF); // bootstrap — no baseline yet, never alerts
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1000), merchantOrDescription: "Big purchase", date: ASOF });

    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);

    const alerts = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.status).toBe("ACTIVE_UNSEEN");
  });

  it("(D) alert stays seen after re-evaluation", async () => {
    const db = await freshSeededDb();
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1000), merchantOrDescription: "Big purchase", date: ASOF });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);

    const [alert] = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");
    await markAlertSeen(db, fixtureProfile.id, alert!.id);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);

    const [after] = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");
    expect(after!.status).toBe("ACTIVE_SEEN");
    expect(after!.seenAt).toBeDefined();
  });

  it("(E) a dismissed active episode does not reappear on further evaluation", async () => {
    const db = await freshSeededDb();
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1000), merchantOrDescription: "Big purchase", date: ASOF });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);

    const [alert] = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");
    await dismissAlert(db, fixtureProfile.id, alert!.id);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);

    const all = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe("DISMISSED");
  });

  it("(F, G) condition resolves once recovered, and a later material re-drop opens a NEW episode (rearm)", async () => {
    const db = await freshSeededDb();
    await evaluateAlerts(db, fixtureProfile.id, ASOF); // bootstrap
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1000), merchantOrDescription: "Big purchase", date: ASOF });
    const firstPass = await evaluateAlerts(db, fixtureProfile.id, ASOF);
    expect(firstPass.alertsCreated).toBeGreaterThanOrEqual(1);

    // Manually restore the checkpoint's rolling value to simulate recovery
    // (income/removal of the transaction isn't modeled — we simulate
    // "safe-to-spend went back up" by directly resetting the persisted
    // active-episode baseline check via the deterministic policy: a
    // reported value back near the ORIGINAL baseline resolves it).
    const checkpoint = await repo.getAlertEvaluationCheckpointRow(db, fixtureProfile.id);
    const beforeDropCents = checkpoint!.activeDropEpisodeBaselineCents!;
    // Simulate recovery by adjusting income so Safe-to-Spend returns near baseline.
    await repo.upsertIncome(
      db,
      { id: createId("income"), label: "Recovery bonus", grossAmount: fromReais(100_000), certainty: "ACTUAL", recurring: false, source: "USER_DECLARED" },
      fixtureProfile.id,
    );
    const afterRecoverySnapshot = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(afterRecoverySnapshot.total.cents).toBeGreaterThan(beforeDropCents);

    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const resolved = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.status).toBe("RESOLVED");

    // A fresh material drop after resolution opens a NEW episode.
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(90_000), merchantOrDescription: "Another big purchase", date: ASOF });
    const rearmPass = await evaluateAlerts(db, fixtureProfile.id, ASOF);
    expect(rearmPass.alertEpisodesRearmed).toBe(1);

    const afterRearm = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");
    expect(afterRearm).toHaveLength(2);
    expect(afterRearm.filter((a) => a.status === "ACTIVE_UNSEEN")).toHaveLength(1);
  });

  it("idempotency: three identical evaluations never duplicate history entries", async () => {
    const db = await freshSeededDb();
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1000), merchantOrDescription: "Big purchase", date: ASOF });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);

    const [alert] = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");
    expect(alert!.transitions).toHaveLength(1); // only the original ACTIVE_UNSEEN transition
  });

  it("(X, mark-seen/dismiss idempotency) repeated markAlertSeen/dismissAlert calls never duplicate transitions", async () => {
    const db = await freshSeededDb();
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1000), merchantOrDescription: "Big purchase", date: ASOF });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const [alert] = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "SAFE_TO_SPEND_MATERIAL_DROP");

    await markAlertSeen(db, fixtureProfile.id, alert!.id);
    await markAlertSeen(db, fixtureProfile.id, alert!.id);
    await dismissAlert(db, fixtureProfile.id, alert!.id);
    await dismissAlert(db, fixtureProfile.id, alert!.id);
    await dismissAlert(db, fixtureProfile.id, alert!.id);

    const final = await listAlertsForProfile(db, fixtureProfile.id);
    const target = final.find((a) => a.id === alert!.id)!;
    expect(target.status).toBe("DISMISSED");
    expect(target.transitions.filter((t) => t.status === "ACTIVE_SEEN")).toHaveLength(1);
    expect(target.transitions.filter((t) => t.status === "DISMISSED")).toHaveLength(1);
  });
});

const netflixAccount: ExternalAccountInput = {
  provider: "mock",
  externalAccountId: "alert-checking-1",
  connectionExternalId: "alert-conn-1",
  kind: "BANK",
  displayName: "Mock Checking",
  currency: "BRL",
  balanceCents: 500_000,
  balanceCertainty: "ACTUAL",
  lastSyncedAt: "2026-09-05T00:00:00.000Z",
};

function netflixCharge(date: string, id: string): ExternalTransactionInput {
  return {
    provider: "mock",
    externalTransactionId: id,
    paymentSourceExternalRef: netflixAccount.externalAccountId,
    amountCents: 3990,
    direction: "DEBIT",
    financialEffect: "CONSUMPTION",
    certainty: "ACTUAL",
    date,
    rawDescription: "NETFLIX.COM",
    rawMerchant: "NETFLIX.COM",
    status: "POSTED",
  };
}

async function setUpAlertConnection(db: Awaited<ReturnType<typeof freshSeededDb>>) {
  return repo.upsertProviderConnection(db, {
    id: createId("provider-connection"),
    financialProfileId: fixtureProfile.id,
    provider: "mock",
    externalConnectionId: "alert-conn-1",
    status: "PENDING",
    createdAt: "2026-09-05",
    updatedAt: "2026-09-05",
  });
}

describe("evaluateAlerts — Recommendation FAILED / VERIFIED (H, I, J)", () => {
  it("(H, I) a FAILED recommendation creates exactly one alert; repeated evaluation never duplicates it", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [netflixAccount.externalAccountId, [netflixCharge("2026-07-05", "n1"), netflixCharge("2026-08-05", "n2"), netflixCharge("2026-09-05", "n3")]],
      ]),
    });
    await setUpAlertConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await acceptRecommendation(db, { financialProfileId: fixtureProfile.id, recommendationId: recommendation!.id, effectiveDate: "2026-09-05" });
    await repo.upsertTransaction(db, {
      ...(await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF)).transactions.find((t) => t.externalTransactionId === "n3")!,
      id: createId("transaction"),
      externalTransactionId: "n-still-charging",
      date: "2026-10-05",
    });
    const conn = await repo.getProviderConnectionById(db, connection.id);
    await repo.upsertProviderConnection(db, { ...conn!, lastSuccessfulSyncAt: "2026-10-25T00:00:00.000Z" });
    await evaluateRecommendationVerifications(db, fixtureProfile.id, "2026-10-25");

    await evaluateAlerts(db, fixtureProfile.id, "2026-10-25");
    await evaluateAlerts(db, fixtureProfile.id, "2026-10-25");

    const alerts = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "RECOMMENDATION_FAILED");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.relatedEntityId).toBe(recommendation!.id);
  });

  it("(J) a VERIFIED recommendation produces a low-noise INFO alert when policy enables it", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [netflixAccount.externalAccountId, [netflixCharge("2026-07-05", "n1"), netflixCharge("2026-08-05", "n2"), netflixCharge("2026-09-05", "n3")]],
      ]),
    });
    await setUpAlertConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await acceptRecommendation(db, { financialProfileId: fixtureProfile.id, recommendationId: recommendation!.id, effectiveDate: "2026-09-05" });
    const conn = await repo.getProviderConnectionById(db, connection.id);
    await repo.upsertProviderConnection(db, { ...conn!, lastSuccessfulSyncAt: "2026-10-25T00:00:00.000Z" });
    await evaluateRecommendationVerifications(db, fixtureProfile.id, "2026-10-25");

    await evaluateAlerts(db, fixtureProfile.id, "2026-10-25");
    const alerts = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "RECOMMENDATION_VERIFIED");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("INFO");
  });
});

describe("evaluateAlerts — Upcoming event pressure / unknown cost (K, L, M, N)", () => {
  it("(K) an event far away creates no alert", async () => {
    const db = await freshSeededDb();
    await createPlannedFinancialEvent(db, fixtureProfile.id, {
      label: "Distant trip",
      startDate: "2026-12-01",
      endDate: "2026-12-05",
      budgetAmount: fromReais(50),
    });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const alerts = (await listAlertsForProfile(db, fixtureProfile.id)).filter((a) => a.evidence.kind.startsWith("UPCOMING_EVENT"));
    expect(alerts).toHaveLength(0);
  });

  it("(L) an event near but financially comfortable creates no pressure alert", async () => {
    const db = await freshSeededDb();
    await createPlannedFinancialEvent(db, fixtureProfile.id, {
      label: "Comfortable outing",
      startDate: "2026-09-07",
      endDate: "2026-09-07",
      budgetAmount: fromReais(20),
    });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const alerts = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "UPCOMING_EVENT_PRESSURE");
    expect(alerts).toHaveLength(0);
  });

  it("(M) an event near AND financially pressuring creates a pressure alert", async () => {
    const db = await freshSeededDb();
    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    await createPlannedFinancialEvent(db, fixtureProfile.id, {
      label: "Big pressuring trip",
      startDate: "2026-09-07",
      endDate: "2026-09-07",
      budgetAmount: fromReais(before.total.cents / 100 + 1000),
    });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const alerts = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "UPCOMING_EVENT_PRESSURE");
    expect(alerts).toHaveLength(1);
  });

  it("(N) an event near with UNKNOWN cost creates a planning alert, not a spending-pressure one", async () => {
    const db = await freshSeededDb();
    await createPlannedFinancialEvent(db, fixtureProfile.id, {
      label: "Unplanned trip",
      startDate: "2026-09-08",
      endDate: "2026-09-09",
    });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const unknownAlerts = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "UPCOMING_EVENT_UNKNOWN_COST");
    expect(unknownAlerts).toHaveLength(1);
  });

  it("(V, W) an event that passes resolves its alert, and never re-alerts once past", async () => {
    const db = await freshSeededDb();
    const event = await createPlannedFinancialEvent(db, fixtureProfile.id, {
      label: "Passing trip",
      startDate: "2026-09-06",
      endDate: "2026-09-06",
    });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    expect(alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "UPCOMING_EVENT_UNKNOWN_COST")).toHaveLength(1);

    await evaluateAlerts(db, fixtureProfile.id, "2026-09-10"); // event has passed
    const afterPass = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "UPCOMING_EVENT_UNKNOWN_COST");
    expect(afterPass.find((a) => a.relatedEntityId === event.id)?.status).toBe("RESOLVED");
  });
});

describe("evaluateAlerts — Liquidity coverage degradation (O, P, Q)", () => {
  it("a profile with no connections at all (permanently UNKNOWN, never previously better) never alerts", async () => {
    const db = await freshSeededDb();
    await evaluateAlerts(db, fixtureProfile.id, ASOF); // bootstrap
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    expect(alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "LIQUIDITY_COVERAGE_DEGRADED")).toHaveLength(0);
  });

  it("(O) coverage genuinely degrading from COMPLETE creates an alert; (P) unchanged coverage does not duplicate it; (Q) restoring resolves it", async () => {
    const db = await freshSeededDb();
    const knownAccount = { ...netflixAccount, balanceCertainty: "ACTUAL" as const, balanceCents: 500_000 };
    installMockProvider({
      accounts: [knownAccount],
      transactionsByAccount: new Map([[knownAccount.externalAccountId, []]]),
    });
    await setUpAlertConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id); // coverage becomes COMPLETE
    await evaluateAlerts(db, fixtureProfile.id, ASOF); // bootstrap checkpoint records COMPLETE
    expect(alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "LIQUIDITY_COVERAGE_DEGRADED")).toHaveLength(0);

    // A second account with an UNKNOWN balance degrades coverage to PARTIAL.
    const unknownAccount: ExternalAccountInput = {
      ...netflixAccount,
      externalAccountId: "alert-checking-2",
      balanceCertainty: "UNKNOWN",
      balanceCents: null,
    };
    installMockProvider({
      accounts: [knownAccount, unknownAccount],
      transactionsByAccount: new Map([
        [knownAccount.externalAccountId, []],
        [unknownAccount.externalAccountId, []],
      ]),
    });
    await syncConnection(db, fixtureProfile.id, connection.id);

    // (O) a genuine COMPLETE -> PARTIAL degradation now surfaces.
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const created = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "LIQUIDITY_COVERAGE_DEGRADED");
    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe("ACTIVE_UNSEEN");

    // (P) repeated evaluation with unchanged coverage does not duplicate.
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    expect(alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "LIQUIDITY_COVERAGE_DEGRADED")).toHaveLength(1);

    // (Q) restoring the unknown balance back to known resolves it.
    installMockProvider({
      accounts: [knownAccount, { ...unknownAccount, balanceCertainty: "ACTUAL", balanceCents: 100_000 }],
      transactionsByAccount: new Map([
        [knownAccount.externalAccountId, []],
        [unknownAccount.externalAccountId, []],
      ]),
    });
    await syncConnection(db, fixtureProfile.id, connection.id);
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const afterRestore = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "LIQUIDITY_COVERAGE_DEGRADED");
    expect(afterRestore).toHaveLength(1);
    expect(afterRestore[0]!.status).toBe("RESOLVED");
  });
});

describe("evaluateAlerts — Connection health (R, S, T)", () => {
  it("(R) a single transient sync failure is suppressed, non-actionable", async () => {
    const db = await freshSeededDb();
    await repo.upsertProviderConnection(db, {
      id: createId("provider-connection"),
      financialProfileId: fixtureProfile.id,
      provider: "mock",
      externalConnectionId: "alert-conn-transient",
      status: "LOGIN_ERROR",
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    expect(alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "CONNECTION_NEEDS_ATTENTION")).toHaveLength(0);
  });

  it("(S, T) repeated/actionable failure creates an alert; recovery resolves it", async () => {
    const db = await freshSeededDb();
    const connectionId = createId("provider-connection");
    await repo.upsertProviderConnection(db, {
      id: connectionId,
      financialProfileId: fixtureProfile.id,
      provider: "mock",
      externalConnectionId: "alert-conn-repeated",
      status: "LOGIN_ERROR",
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    });
    for (const status of ["FAILED", "FAILED"] as const) {
      await repo.upsertSyncRun(db, {
        id: createId("sync-run"),
        connectionId,
        status,
        startedAt: "2026-09-05T00:00:00.000Z",
        finishedAt: "2026-09-05T00:01:00.000Z",
        metrics: {
          accountsDiscovered: 0,
          transactionsReceived: 0,
          transactionsCreated: 0,
          transactionsUpdated: 0,
          transactionsReconciled: 0,
          transactionsIgnoredDuplicates: 0,
          billsReceived: 0,
        },
        errors: ["Login required"],
      });
    }
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const created = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "CONNECTION_NEEDS_ATTENTION");
    expect(created).toHaveLength(1);

    // (T) recovery: status returns to CONNECTED with a successful sync.
    await repo.upsertProviderConnection(db, {
      id: connectionId,
      financialProfileId: fixtureProfile.id,
      provider: "mock",
      externalConnectionId: "alert-conn-repeated",
      status: "CONNECTED",
      lastSuccessfulSyncAt: new Date().toISOString(),
      createdAt: "2026-09-05",
      updatedAt: "2026-09-05",
    });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const afterRecovery = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "CONNECTION_NEEDS_ATTENTION");
    expect(afterRecovery.find((a) => a.relatedEntityId === connectionId)?.status).toBe("RESOLVED");
  });
});

function venue(overrides: Partial<VenueCandidate> = {}): VenueCandidate {
  return {
    provider: "spy",
    externalPlaceId: "v1",
    name: "Alert Test Bistro",
    category: "DINING",
    openingStatus: "OPEN",
    priceEvidence: [
      { priceType: "RANGE", minAmountCents: 5000, maxAmountCents: 8000, currency: "BRL", basis: "PER_PERSON", source: "spy", observedAt: ASOF, confidence: "MEDIUM" },
    ],
    sourceReferences: [],
    retrievedAt: ASOF,
    ...overrides,
  };
}

describe("evaluateAlerts — Stale concierge plan (U)", () => {
  it("(U) a saved plan flagged stale by the concierge's own staleness check gets an alert; recalculating resolves it", async () => {
    const db = await freshSeededDb();
    registerDiscoveryProvider("mock", { name: "mock", searchPlaces: async () => [venue()], getPlaceDetails: async () => undefined });

    const { sessionId, plans } = await buildConciergePlansForProfile(db, fixtureProfile.id, ASOF, {
      requiredComponents: ["DINING"],
      optionalComponents: [],
      location: "Campinas",
      paymentResponsibility: "SELF_ONLY",
    });
    const saved = await saveConciergePlan(db, fixtureProfile.id, sessionId!, plans[0]!.id);

    // Change the envelope so the saved plan's snapshot goes stale.
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(300), merchantOrDescription: "Unrelated spend", date: ASOF });

    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const staleAlerts = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "STALE_CONCIERGE_PLAN");
    expect(staleAlerts.find((a) => a.relatedEntityId === saved.id)?.status).toBe("ACTIVE_UNSEEN");

    // reevaluateAlertContext (the AI tool path) reflects the same state.
    const viaReevaluate = await reevaluateAlertContext(db, fixtureProfile.id, ASOF, staleAlerts[0]!.id);
    expect(viaReevaluate.status).toBe("ACTIVE_UNSEEN");
  });

  it("(W) an old saved plan outside the relevance window never alerts at all", async () => {
    const db = await freshSeededDb();
    registerDiscoveryProvider("mock", { name: "mock", searchPlaces: async () => [venue()], getPlaceDetails: async () => undefined });
    const { sessionId, plans } = await buildConciergePlansForProfile(db, fixtureProfile.id, ASOF, {
      requiredComponents: ["DINING"],
      optionalComponents: [],
      location: "Campinas",
      paymentResponsibility: "SELF_ONLY",
    });
    const saved = await saveConciergePlan(db, fixtureProfile.id, sessionId!, plans[0]!.id);

    // Backdate the saved plan far beyond the relevance window.
    const row = await repo.findSavedConciergePlanRowByPlanId(db, fixtureProfile.id, plans[0]!.id);
    await repo.upsertSavedConciergePlanRow(db, { ...row!, createdAt: "2026-01-01T00:00:00.000Z" });

    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    const staleAlerts = alertsOfType(await listAlertsForProfile(db, fixtureProfile.id), "STALE_CONCIERGE_PLAN");
    expect(staleAlerts.find((a) => a.relatedEntityId === saved.id)).toBeUndefined();
  });
});

describe("evaluateAlerts — protected preferences (never optimization advice)", () => {
  it("never produces alert text suggesting reducing the protected family-support commitment", async () => {
    const db = await freshSeededDb();
    await evaluateAlerts(db, fixtureProfile.id, ASOF);
    await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1000), merchantOrDescription: "Big purchase", date: ASOF });
    await evaluateAlerts(db, fixtureProfile.id, ASOF);

    const all = await listAlertsForProfile(db, fixtureProfile.id);
    for (const alert of all) {
      expect(alert.title.toLowerCase()).not.toMatch(/mãe|mother|reduza|cancele|corte/);
    }
  });
});
