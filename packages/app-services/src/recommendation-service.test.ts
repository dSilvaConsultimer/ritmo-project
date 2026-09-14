import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile, fromReais } from "@money-copilot/financial-engine";
import type { ExternalAccountInput, ExternalTransactionInput } from "@money-copilot/financial-engine";
import * as repo from "@money-copilot/persistence";
import { createId } from "@money-copilot/shared";
import { syncConnection } from "./sync";
import {
  acceptRecommendation,
  evaluateRecommendations,
  evaluateRecommendationVerifications,
  modifyRecommendation,
  rejectRecommendation,
} from "./recommendation-service";
import { getSafeToSpend } from "./queries";
import { resetProviderRegistry } from "./provider-registry";
import { freshSeededDb, installMockProvider } from "./test-helpers";

const ASOF = "2026-09-05";

afterEach(() => {
  resetProviderRegistry();
});

const netflixAccount: ExternalAccountInput = {
  provider: "mock",
  externalAccountId: "mock-checking-1",
  connectionExternalId: "mock-conn-rec-1",
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

async function setUpConnection(db: Awaited<ReturnType<typeof freshSeededDb>>) {
  return repo.upsertProviderConnection(db, {
    id: createId("provider-connection"),
    financialProfileId: fixtureProfile.id,
    provider: "mock",
    externalConnectionId: "mock-conn-rec-1",
    status: "PENDING",
    createdAt: "2026-09-05",
    updatedAt: "2026-09-05",
  });
}

describe("recommendation-service integration", () => {
  it("a real sync of recurring Netflix charges produces exactly one PENDING recommendation", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;

    await syncConnection(db, fixtureProfile.id, connection.id);

    const recommendations = await repo.listRecommendationsForProfile(db, fixtureProfile.id);
    const netflixRecs = recommendations.filter((r) => r.evidence.normalizedMerchant === "NETFLIX");
    expect(netflixRecs).toHaveLength(1);
    expect(netflixRecs[0]!.type).toBe("CANCEL_RECURRING_COST");
    expect(netflixRecs[0]!.projectedMonthlyImpact.cents).toBe(3990);
    expect(netflixRecs[0]!.status).toBe("PENDING");
  });

  it("(B, O) three identical syncs do not duplicate the recommendation", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;

    await syncConnection(db, fixtureProfile.id, connection.id);
    await syncConnection(db, fixtureProfile.id, connection.id);
    await syncConnection(db, fixtureProfile.id, connection.id);

    const recommendations = await repo.listRecommendationsForProfile(db, fixtureProfile.id);
    const netflixRecs = recommendations.filter((r) => r.evidence.normalizedMerchant === "NETFLIX");
    expect(netflixRecs).toHaveLength(1);
  });

  it("(G) a rejected recommendation stays suppressed across repeated evaluation", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await rejectRecommendation(db, fixtureProfile.id, recommendation!.id, "User wants to keep it");

    await evaluateRecommendations(db, fixtureProfile.id, ASOF);
    await evaluateRecommendations(db, fixtureProfile.id, ASOF);

    const after = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe("REJECTED");
  });

  it("(H) a materially different amount becomes eligible again after rejection", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [original] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await rejectRecommendation(db, fixtureProfile.id, original!.id);

    // Price genuinely increased (e.g. NETFLIX raised its price) — three new
    // charges at a materially different amount produce a NEW identityKey.
    await repo.upsertTransaction(db, {
      ...(await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF)).transactions.find(
        (t) => t.externalTransactionId === "netflix-1",
      )!,
      id: createId("transaction"),
      externalTransactionId: "netflix-price-hike-1",
      amount: fromReais(69.9),
      date: "2026-10-05",
    });
    await repo.upsertTransaction(db, {
      ...(await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF)).transactions.find(
        (t) => t.externalTransactionId === "netflix-2",
      )!,
      id: createId("transaction"),
      externalTransactionId: "netflix-price-hike-2",
      amount: fromReais(69.9),
      date: "2026-11-05",
    });
    await repo.upsertTransaction(db, {
      ...(await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF)).transactions.find(
        (t) => t.externalTransactionId === "netflix-3",
      )!,
      id: createId("transaction"),
      externalTransactionId: "netflix-price-hike-3",
      amount: fromReais(69.9),
      date: "2026-12-05",
    });

    await evaluateRecommendations(db, fixtureProfile.id, "2026-12-05");

    const netflixRecs = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    expect(netflixRecs).toHaveLength(2);
    expect(netflixRecs.some((r) => r.status === "REJECTED")).toBe(true);
    expect(netflixRecs.some((r) => r.status === "PENDING" && r.evidence.observedAmount.cents === 6990)).toBe(true);
  });

  it("(I) accepting a recommendation does not change current Safe-to-Spend", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await acceptRecommendation(db, { financialProfileId: fixtureProfile.id, recommendationId: recommendation!.id });
    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);

    expect(after.total.cents).toBe(before.total.cents);
  });

  it("MODIFY records a decision-history entry and recalculates impact deterministically (X - Y)", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    const modified = await modifyRecommendation(db, {
      financialProfileId: fixtureProfile.id,
      recommendationId: recommendation!.id,
      targetAmount: fromReais(20),
      note: "Quero reduzir para R$ 20",
    });

    expect(modified.type).toBe("REDUCE_RECURRING_COST");
    expect(modified.projectedMonthlyImpact.cents).toBe(3990 - 2000);
    expect(modified.status).toBe("MODIFIED");
    expect(modified.decisionHistory.at(-1)?.status).toBe("MODIFIED");
    expect(modified.decisionHistory.at(-1)?.targetAmount?.cents).toBe(2000);
  });

  it("(K) modifying to a target >= the current amount throws rather than producing negative savings", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await expect(
      modifyRecommendation(db, { financialProfileId: fixtureProfile.id, recommendationId: recommendation!.id, targetAmount: fromReais(50) }),
    ).rejects.toThrow();
  });

  it("(L) accepted cancellation + sufficient future evidence with no continuing charge -> VERIFIED", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await acceptRecommendation(db, { financialProfileId: fixtureProfile.id, recommendationId: recommendation!.id, effectiveDate: "2026-09-05" });

    // Sync recency must also be within policy — advance the connection's
    // lastSuccessfulSyncAt without any new NETFLIX charge appearing.
    const conn = await repo.getProviderConnectionById(db, connection.id);
    await repo.upsertProviderConnection(db, { ...conn!, lastSuccessfulSyncAt: "2026-10-25T00:00:00.000Z" });

    const summary = await evaluateRecommendationVerifications(db, fixtureProfile.id, "2026-10-25");
    expect(summary.verified).toBe(1);

    const updated = await repo.getRecommendationById(db, recommendation!.id);
    expect(updated?.status).toBe("VERIFIED");
    expect(updated?.lastVerificationAssessment).toBe("CONFIRMED_SUCCESS");
  });

  it("(M) accepted cancellation + recurring charge continues -> FAILED", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await acceptRecommendation(db, { financialProfileId: fixtureProfile.id, recommendationId: recommendation!.id, effectiveDate: "2026-09-05" });

    // The charge continued after the user "cancelled" it.
    await repo.upsertTransaction(db, {
      ...(await repo.loadFinancialSnapshotInput(db, fixtureProfile.id, ASOF)).transactions.find(
        (t) => t.externalTransactionId === "netflix-3",
      )!,
      id: createId("transaction"),
      externalTransactionId: "netflix-still-charging",
      date: "2026-10-05",
    });
    const conn = await repo.getProviderConnectionById(db, connection.id);
    await repo.upsertProviderConnection(db, { ...conn!, lastSuccessfulSyncAt: "2026-10-25T00:00:00.000Z" });

    const summary = await evaluateRecommendationVerifications(db, fixtureProfile.id, "2026-10-25");
    expect(summary.failed).toBe(1);

    const updated = await repo.getRecommendationById(db, recommendation!.id);
    expect(updated?.status).toBe("FAILED");
  });

  it("(N) stale sync coverage leaves the recommendation ACCEPTED, not falsely VERIFIED", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await acceptRecommendation(db, { financialProfileId: fixtureProfile.id, recommendationId: recommendation!.id, effectiveDate: "2026-09-05" });

    // Connection has NOT synced recently — its lastSuccessfulSyncAt is from
    // right after the original sync, long before the "now" we check at.
    const summary = await evaluateRecommendationVerifications(db, fixtureProfile.id, "2026-10-25");
    expect(summary.inconclusive).toBe(1);

    const updated = await repo.getRecommendationById(db, recommendation!.id);
    expect(updated?.status).toBe("ACCEPTED");
    expect(updated?.lastVerificationAssessment).toBe("INCONCLUSIVE");
  });

  it("(O) repeated verification evaluation never re-transitions an already-VERIFIED recommendation", async () => {
    const db = await freshSeededDb();
    installMockProvider({
      accounts: [netflixAccount],
      transactionsByAccount: new Map([
        [
          netflixAccount.externalAccountId,
          [netflixCharge("2026-07-05", "netflix-1"), netflixCharge("2026-08-05", "netflix-2"), netflixCharge("2026-09-05", "netflix-3")],
        ],
      ]),
    });
    await setUpConnection(db);
    const connection = (await repo.listProviderConnections(db, fixtureProfile.id))[0]!;
    await syncConnection(db, fixtureProfile.id, connection.id);

    const [recommendation] = (await repo.listRecommendationsForProfile(db, fixtureProfile.id)).filter(
      (r) => r.evidence.normalizedMerchant === "NETFLIX",
    );
    await acceptRecommendation(db, { financialProfileId: fixtureProfile.id, recommendationId: recommendation!.id, effectiveDate: "2026-09-05" });
    const conn = await repo.getProviderConnectionById(db, connection.id);
    await repo.upsertProviderConnection(db, { ...conn!, lastSuccessfulSyncAt: "2026-10-25T00:00:00.000Z" });

    const first = await evaluateRecommendationVerifications(db, fixtureProfile.id, "2026-10-25");
    const second = await evaluateRecommendationVerifications(db, fixtureProfile.id, "2026-10-25");

    expect(first.verified).toBe(1);
    expect(second.verificationsEvaluated).toBe(0); // VERIFIED is terminal — never re-evaluated
    expect(second.verified).toBe(0);

    const finalRec = await repo.getRecommendationById(db, recommendation!.id);
    expect(finalRec?.decisionHistory.filter((e) => e.status === "VERIFIED")).toHaveLength(1);
  });
});
