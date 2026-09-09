import { describe, expect, it } from "vitest";
import { createId, type Id } from "@money-copilot/shared";
import * as M from "@money-copilot/financial-engine";
import { fixtureProfile, type Recommendation } from "@money-copilot/financial-engine";
import { createDatabase } from "./db";
import { runMigrations } from "./migrate";
import { seed } from "./seed";
import * as repo from "./repositories";

async function freshSeededDb() {
  const db = await createDatabase();
  await runMigrations(db);
  await seed(db);
  return db;
}

function buildRecommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: createId("recommendation"),
    financialProfileId: fixtureProfile.id,
    type: "CANCEL_RECURRING_COST",
    identityKey: `${fixtureProfile.id}:CANCEL_RECURRING_COST:NETFLIX:MONTHLY:3990:any`,
    title: "Recurring subscription: NETFLIX",
    evidence: {
      normalizedMerchant: "NETFLIX",
      category: "Entertainment",
      cadence: "MONTHLY",
      observedAmount: M.fromReais(39.9),
      monthlyEquivalentAmount: M.fromReais(39.9),
      occurrences: 3,
      transactionIds: [createId("transaction"), createId("transaction")] as Id<"transaction">[],
      confidence: "HIGH",
    },
    projectedMonthlyImpact: M.fromReais(39.9),
    projectedAnnualImpact: M.fromReais(478.8),
    status: "PENDING",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    decisionHistory: [],
    ...overrides,
  };
}

describe("Recommendation repository", () => {
  it("round-trips a recommendation through upsert/get, preserving evidence and decision history", async () => {
    const db = await freshSeededDb();
    const recommendation = buildRecommendation({
      decisionHistory: [{ status: "PENDING", at: "2026-09-05T00:00:00.000Z" }],
    });

    await repo.upsertRecommendation(db, recommendation);
    const loaded = await repo.getRecommendationById(db, recommendation.id);

    expect(loaded).toEqual(recommendation);
  });

  it("upsert is idempotent by id — re-saving the same recommendation does not create a second row", async () => {
    const db = await freshSeededDb();
    const recommendation = buildRecommendation();

    await repo.upsertRecommendation(db, recommendation);
    await repo.upsertRecommendation(db, { ...recommendation, status: "ACCEPTED", updatedAt: "2026-09-06T00:00:00.000Z" });

    const all = await repo.listRecommendationsForProfile(db, fixtureProfile.id);
    const matching = all.filter((r) => r.id === recommendation.id);
    expect(matching).toHaveLength(1);
    expect(matching[0]!.status).toBe("ACCEPTED");
  });

  it("findRecommendationByIdentityKey finds the persisted recommendation for an unchanged opportunity", async () => {
    const db = await freshSeededDb();
    const recommendation = buildRecommendation();
    await repo.upsertRecommendation(db, recommendation);

    const found = await repo.findRecommendationByIdentityKey(db, fixtureProfile.id, recommendation.identityKey);
    expect(found?.id).toBe(recommendation.id);
  });

  it("a different identityKey (materially different opportunity) is a distinct row, not a conflict", async () => {
    const db = await freshSeededDb();
    const first = buildRecommendation();
    const second = buildRecommendation({
      id: createId("recommendation"),
      identityKey: `${fixtureProfile.id}:CANCEL_RECURRING_COST:SPOTIFY:MONTHLY:1990:any`,
      evidence: { ...first.evidence, normalizedMerchant: "SPOTIFY" },
    });

    await repo.upsertRecommendation(db, first);
    await repo.upsertRecommendation(db, second);

    const all = await repo.listRecommendationsForProfile(db, fixtureProfile.id);
    expect(all.filter((r) => r.id === first.id || r.id === second.id)).toHaveLength(2);
  });
});
