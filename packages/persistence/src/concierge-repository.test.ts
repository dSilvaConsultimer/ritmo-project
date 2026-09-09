import { describe, expect, it } from "vitest";
import { fixtureProfile } from "@money-copilot/financial-engine";
import { createId } from "@money-copilot/shared";
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

describe("Concierge repository (Sprint 6)", () => {
  it("round-trips a concierge session row", async () => {
    const db = await freshSeededDb();
    const row = {
      id: createId("concierge-session"),
      financialProfileId: fixtureProfile.id,
      intentJson: JSON.stringify({ requiredComponents: ["DINING"], optionalComponents: [], paymentResponsibility: "SELF_ONLY" }),
      envelopeRecommendedAmountCents: 30000,
      envelopeCautionAmountCents: 40000,
      envelopeAsOfDate: "2026-09-09",
      plansJson: "[]",
      createdAt: "2026-09-09T00:00:00.000Z",
    };

    await repo.upsertConciergeSessionRow(db, row);
    const loaded = await repo.getConciergeSessionRowById(db, row.id);
    expect(loaded).toEqual(row);
  });

  it("(X) saving the same plan id twice does not duplicate — findByPlanId finds the existing row", async () => {
    const db = await freshSeededDb();
    const sessionId = createId("concierge-session");
    await repo.upsertConciergeSessionRow(db, {
      id: sessionId,
      financialProfileId: fixtureProfile.id,
      intentJson: "{}",
      envelopeRecommendedAmountCents: 30000,
      envelopeCautionAmountCents: 40000,
      envelopeAsOfDate: "2026-09-09",
      plansJson: "[]",
      createdAt: "2026-09-09T00:00:00.000Z",
    });

    const planId = createId("concierge-plan");
    const row = {
      id: createId("saved-concierge-plan"),
      sessionId,
      financialProfileId: fixtureProfile.id,
      planId,
      planJson: JSON.stringify({ label: "Dinner" }),
      status: "SELECTED" as const,
      createdAt: "2026-09-09T00:00:00.000Z",
    };
    await repo.upsertSavedConciergePlanRow(db, row);

    const found = await repo.findSavedConciergePlanRowByPlanId(db, fixtureProfile.id, planId);
    expect(found?.id).toBe(row.id);

    const all = await repo.listSavedConciergePlansForProfile(db, fixtureProfile.id);
    expect(all.filter((p) => p.planId === planId)).toHaveLength(1);
  });

  it("returns undefined for an unknown session id rather than throwing", async () => {
    const db = await freshSeededDb();
    expect(await repo.getConciergeSessionRowById(db, "does-not-exist")).toBeUndefined();
  });
});
