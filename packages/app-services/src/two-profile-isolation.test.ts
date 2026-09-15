import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile, fromReais } from "@money-copilot/financial-engine";
import type { ExternalAccountInput, ExternalTransactionInput } from "@money-copilot/financial-engine";
import type { VenueCandidate } from "@money-copilot/discovery";
import * as repo from "@money-copilot/persistence";
import { createId } from "@money-copilot/shared";
import { freshSeededDb, installMockProvider, seedSecondProfile } from "./test-helpers";
import { resetProviderRegistry } from "./provider-registry";
import { registerDiscoveryProvider, resetDiscoveryProviderRegistry } from "./discovery-provider-registry";
import { syncConnection, disconnectConnection } from "./sync";
import { getLatestSyncRunForConnection, getRecommendationDetails, getTransactionHistory } from "./queries";
import { acceptRecommendation, rejectRecommendation, evaluateRecommendations } from "./recommendation-service";
import { evaluateAlerts, listAlertsForProfile, getAlertById, dismissAlert, markAlertSeen } from "./alerts";
import { recordManualTransaction } from "./mutations";
import { buildConciergePlansForProfile, saveConciergePlan, reevaluateConciergePlan } from "./concierge";
import { getOrCreateConversation, appendMessage, listMessagesForConversation } from "./copilot";
import { ResourceNotFoundError } from "./ownership";

/**
 * Sprint 9 — the permanent two-profile adversarial regression suite (brief
 * §91). `fixtureProfile` (seeded by `freshSeededDb`) plays "User A"
 * throughout; a fresh `seedSecondProfile` plays "User B." Every test
 * attempts an access/mutation using A's own `financialProfileId` alongside
 * an id that actually belongs to B, and asserts it is denied — proving the
 * Phase 2 ownership fixes hold, not just that they compile.
 *
 * Out of scope here (deferred to Sprint 9 Phase 6 staging validation,
 * which uses a real Pluggy sandbox and two real users): the webhook
 * multi-user test (brief §80) and repeated-profile-provisioning idempotency
 * (brief §84/R), since profile provisioning doesn't exist as a function
 * until Phase 3 wires real auth.
 */

const ASOF = "2026-09-05";

afterEach(() => {
  resetProviderRegistry();
  resetDiscoveryProviderRegistry();
});

const bAccount: ExternalAccountInput = {
  provider: "mock",
  externalAccountId: "profile-b-account-1",
  connectionExternalId: "profile-b-conn-1",
  kind: "BANK",
  displayName: "Profile B Checking",
  currency: "BRL",
  balanceCents: 500_000,
  balanceCertainty: "ACTUAL",
  lastSyncedAt: `${ASOF}T00:00:00.000Z`,
};

function netflixCharge(date: string, id: string): ExternalTransactionInput {
  return {
    provider: "mock",
    externalTransactionId: id,
    paymentSourceExternalRef: bAccount.externalAccountId,
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

async function setUpProfileBConnection(db: Awaited<ReturnType<typeof freshSeededDb>>, profileB: string) {
  const connection = {
    id: createId("provider-connection"),
    financialProfileId: profileB as ReturnType<typeof createId<"financial-profile">>,
    provider: "mock" as const,
    externalConnectionId: bAccount.connectionExternalId,
    status: "PENDING" as const,
    createdAt: ASOF,
    updatedAt: ASOF,
  };
  await repo.upsertProviderConnection(db, connection);
  return connection;
}

describe("Two-profile isolation — provider connections (F, G)", () => {
  it("(F) User A cannot read User B's connection's latest sync run", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);
    installMockProvider({
      accounts: [bAccount],
      transactionsByAccount: new Map([[bAccount.externalAccountId, [netflixCharge(ASOF, "b-tx-1")]]]),
    });
    const connectionB = await setUpProfileBConnection(db, profileB);
    await syncConnection(db, profileB, connectionB.id);

    await expect(getLatestSyncRunForConnection(db, fixtureProfile.id, connectionB.id)).rejects.toThrow(
      ResourceNotFoundError,
    );
    // B can still read its own.
    await expect(getLatestSyncRunForConnection(db, profileB, connectionB.id)).resolves.toBeDefined();
  });

  it("(G) User A cannot disconnect User B's connection — it survives fully intact", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);
    installMockProvider({
      accounts: [bAccount],
      transactionsByAccount: new Map([[bAccount.externalAccountId, [netflixCharge(ASOF, "b-tx-2")]]]),
    });
    const connectionB = await setUpProfileBConnection(db, profileB);
    await syncConnection(db, profileB, connectionB.id);

    await expect(disconnectConnection(db, fixtureProfile.id, connectionB.id)).rejects.toThrow(
      ResourceNotFoundError,
    );

    // B's connection and its imported data are completely untouched.
    const stillThere = await repo.listProviderConnections(db, profileB);
    expect(stillThere.map((c) => c.id)).toEqual([connectionB.id]);
    const bTransactions = await repo.loadFinancialSnapshotInput(db, profileB, ASOF);
    expect(bTransactions.transactions.some((t) => t.externalTransactionId === "b-tx-2")).toBe(true);
  });
});

describe("Two-profile isolation — recommendations (H, I, P)", () => {
  async function seedProfileBRecommendation(db: Awaited<ReturnType<typeof freshSeededDb>>, profileB: string) {
    installMockProvider({
      accounts: [bAccount],
      transactionsByAccount: new Map([
        [
          bAccount.externalAccountId,
          [netflixCharge("2026-07-05", "b-netflix-1"), netflixCharge("2026-08-05", "b-netflix-2"), netflixCharge(ASOF, "b-netflix-3")],
        ],
      ]),
    });
    const connectionB = await setUpProfileBConnection(db, profileB);
    await syncConnection(db, profileB, connectionB.id);
    const [recommendation] = await repo.listRecommendationsForProfile(db, profileB);
    return recommendation!;
  }

  it("(H) User A cannot read User B's recommendation details", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);
    const recommendation = await seedProfileBRecommendation(db, profileB);

    const asA = await getRecommendationDetails(db, fixtureProfile.id, recommendation.id);
    expect(asA).toBeUndefined();
    const asB = await getRecommendationDetails(db, profileB, recommendation.id);
    expect(asB?.id).toBe(recommendation.id);
  });

  it("(I) User A cannot accept or reject User B's recommendation", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);
    const recommendation = await seedProfileBRecommendation(db, profileB);

    await expect(
      acceptRecommendation(db, { financialProfileId: fixtureProfile.id, recommendationId: recommendation.id }),
    ).rejects.toThrow(ResourceNotFoundError);
    await expect(
      rejectRecommendation(db, fixtureProfile.id, recommendation.id),
    ).rejects.toThrow(ResourceNotFoundError);

    // Untouched — still PENDING, owned by B.
    const stillPending = await getRecommendationDetails(db, profileB, recommendation.id);
    expect(stillPending?.status).toBe("PENDING");
  });

  it("(P) evaluating User A's recommendations never creates or reuses one of User B's", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);
    const recommendationB = await seedProfileBRecommendation(db, profileB);

    await evaluateRecommendations(db, fixtureProfile.id, ASOF);

    const aRecommendations = await repo.listRecommendationsForProfile(db, fixtureProfile.id);
    expect(aRecommendations.some((r) => r.id === recommendationB.id)).toBe(false);
    const bRecommendations = await repo.listRecommendationsForProfile(db, profileB);
    expect(bRecommendations).toHaveLength(1);
  });
});

describe("Two-profile isolation — alerts (J)", () => {
  async function seedProfileBAlert(db: Awaited<ReturnType<typeof freshSeededDb>>, profileB: string) {
    await evaluateAlerts(db, profileB, ASOF); // bootstrap — no baseline yet
    await recordManualTransaction(db, profileB, { amount: fromReais(1000), merchantOrDescription: "Big B purchase", date: ASOF });
    await evaluateAlerts(db, profileB, ASOF);
    const [alert] = await listAlertsForProfile(db, profileB);
    return alert!;
  }

  it("(J) User A cannot read, dismiss, or mark seen User B's alert", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);
    const alert = await seedProfileBAlert(db, profileB);

    const asA = await getAlertById(db, fixtureProfile.id, alert.id);
    expect(asA).toBeUndefined();

    await expect(dismissAlert(db, fixtureProfile.id, alert.id)).rejects.toThrow(ResourceNotFoundError);
    await expect(markAlertSeen(db, fixtureProfile.id, alert.id)).rejects.toThrow(ResourceNotFoundError);

    // Untouched — still ACTIVE_UNSEEN, owned by B.
    const stillActive = await getAlertById(db, profileB, alert.id);
    expect(stillActive?.status).toBe("ACTIVE_UNSEEN");
  });
});

function venue(overrides: Partial<VenueCandidate> = {}): VenueCandidate {
  return {
    provider: "mock",
    externalPlaceId: "isolation-test-venue",
    name: "Isolation Test Bistro",
    category: "DINING",
    openingStatus: "OPEN",
    priceEvidence: [
      {
        priceType: "RANGE",
        minAmountCents: 5000,
        maxAmountCents: 8000,
        currency: "BRL",
        basis: "PER_PERSON",
        source: "mock",
        observedAt: ASOF,
        confidence: "MEDIUM",
      },
    ],
    sourceReferences: [],
    retrievedAt: ASOF,
    ...overrides,
  };
}

describe("Two-profile isolation — concierge sessions/plans (K)", () => {
  it("(K) User A cannot save or re-evaluate a plan from User B's concierge session", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);
    registerDiscoveryProvider("mock", {
      name: "mock",
      searchPlaces: async () => [venue()],
      getPlaceDetails: async () => undefined,
    });

    const { sessionId, plans } = await buildConciergePlansForProfile(db, profileB, ASOF, {
      requiredComponents: ["DINING"],
      optionalComponents: [],
      location: "Campinas",
      paymentResponsibility: "SELF_ONLY",
    });

    await expect(
      saveConciergePlan(db, fixtureProfile.id, sessionId!, plans[0]!.id),
    ).rejects.toThrow(ResourceNotFoundError);
    await expect(
      reevaluateConciergePlan(db, fixtureProfile.id, ASOF, sessionId!, plans[0]!.id),
    ).rejects.toThrow(ResourceNotFoundError);

    // B can still save/re-evaluate its own.
    const savedByB = await saveConciergePlan(db, profileB, sessionId!, plans[0]!.id);
    expect(savedByB.financialProfileId).toBe(profileB);
  });
});

describe("Two-profile isolation — AI conversations (L)", () => {
  it("(L) User A cannot read or append to User B's conversation, even by guessing its id", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);

    const conversationB = await getOrCreateConversation(db, profileB);
    await appendMessage(db, profileB, conversationB.id, "USER", "Isso é privado do usuário B.");

    // A tries to "resume" B's conversation by passing its id alongside A's own profile id.
    await expect(getOrCreateConversation(db, fixtureProfile.id, conversationB.id)).rejects.toThrow(
      ResourceNotFoundError,
    );
    await expect(
      appendMessage(db, fixtureProfile.id, conversationB.id, "USER", "Tentando ler o histórico de B"),
    ).rejects.toThrow(ResourceNotFoundError);
    await expect(listMessagesForConversation(db, fixtureProfile.id, conversationB.id)).rejects.toThrow(
      ResourceNotFoundError,
    );

    // B's conversation is untouched — still exactly the one message.
    const bMessages = await listMessagesForConversation(db, profileB, conversationB.id);
    expect(bMessages).toHaveLength(1);
    expect(bMessages[0]!.content).toBe("Isso é privado do usuário B.");
  });
});

describe("Two-profile isolation — reconciliation never crosses profiles (N)", () => {
  it("(N) two profiles' identically-shaped duplicate transactions never cross-link", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);

    const aAccount: ExternalAccountInput = { ...bAccount, externalAccountId: "profile-a-account-1", connectionExternalId: "profile-a-conn-1" };
    installMockProvider({
      accounts: [aAccount, bAccount],
      transactionsByAccount: new Map([
        [aAccount.externalAccountId, [netflixCharge(ASOF, "a-dup-1"), netflixCharge(ASOF, "a-dup-2")]],
        [bAccount.externalAccountId, [netflixCharge(ASOF, "b-dup-1"), netflixCharge(ASOF, "b-dup-2")]],
      ]),
    });

    const connectionA = await repo.upsertProviderConnection(db, {
      id: createId("provider-connection"),
      financialProfileId: fixtureProfile.id,
      provider: "mock",
      externalConnectionId: aAccount.connectionExternalId,
      status: "PENDING",
      createdAt: ASOF,
      updatedAt: ASOF,
    }).then(() => repo.listProviderConnections(db, fixtureProfile.id).then((cs) => cs[0]!));
    const connectionB = await setUpProfileBConnection(db, profileB);

    await syncConnection(db, fixtureProfile.id, connectionA.id);
    await syncConnection(db, profileB, connectionB.id);

    const linksA = await repo.listReconciliationLinksForProfile(db, fixtureProfile.id);
    const linksB = await repo.listReconciliationLinksForProfile(db, profileB);

    expect(linksA.every((l) => l.financialProfileId === fixtureProfile.id)).toBe(true);
    expect(linksB.every((l) => l.financialProfileId === profileB)).toBe(true);
    // Neither profile's links reference the other profile's transaction ids.
    const bTransactionIds = new Set(
      (await repo.loadFinancialSnapshotInput(db, profileB, ASOF)).transactions.map((t) => t.id),
    );
    expect(linksA.some((l) => bTransactionIds.has(l.primaryTransactionId))).toBe(false);
  });
});

describe("Two-profile isolation — Extrato's full transaction history (DEC-129, Q)", () => {
  it("(Q) getTransactionHistory for User A never includes User B's transactions", async () => {
    const db = await freshSeededDb();
    const profileB = await seedSecondProfile(db);

    installMockProvider({
      accounts: [bAccount],
      transactionsByAccount: new Map([[bAccount.externalAccountId, [netflixCharge(ASOF, "b-hist-1")]]]),
    });
    const connectionB = await setUpProfileBConnection(db, profileB);
    await syncConnection(db, profileB, connectionB.id);

    const historyA = await getTransactionHistory(db, fixtureProfile.id, ASOF);
    expect(historyA.some((t) => t.externalTransactionId === "b-hist-1")).toBe(false);
    expect(historyA.every((t) => t.financialProfileId === fixtureProfile.id)).toBe(true);

    const historyB = await getTransactionHistory(db, profileB, ASOF);
    expect(historyB.some((t) => t.externalTransactionId === "b-hist-1")).toBe(true);
    expect(historyB.every((t) => t.financialProfileId === profileB)).toBe(true);
  });
});
