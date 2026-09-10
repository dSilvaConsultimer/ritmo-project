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

function buildAlertRow(overrides: Partial<repo.AlertRow> = {}): repo.AlertRow {
  return {
    id: createId("alert"),
    financialProfileId: fixtureProfile.id,
    type: "SAFE_TO_SPEND_MATERIAL_DROP",
    status: "ACTIVE_UNSEEN",
    severity: "ATTENTION",
    identityKey: `${fixtureProfile.id}:SAFE_TO_SPEND_MATERIAL_DROP`,
    title: "Safe-to-Spend dropped",
    reasonCode: "RELATIVE_DROP",
    createdAt: "2026-09-09T00:00:00.000Z",
    firstTriggeredAt: "2026-09-09T00:00:00.000Z",
    lastTriggeredAt: "2026-09-09T00:00:00.000Z",
    resolvedAt: null,
    seenAt: null,
    dismissedAt: null,
    evidenceJson: JSON.stringify({ previousCents: 100_000, currentCents: 80_000 }),
    relatedEntityType: null,
    relatedEntityId: null,
    policyVersion: 1,
    transitionsJson: JSON.stringify([{ status: "ACTIVE_UNSEEN", at: "2026-09-09T00:00:00.000Z" }]),
    ...overrides,
  };
}

describe("Alert repository (Sprint 7)", () => {
  it("round-trips an alert row", async () => {
    const db = await freshSeededDb();
    const row = buildAlertRow();
    await repo.upsertAlertRow(db, row);
    const loaded = await repo.getAlertRowById(db, row.id);
    expect(loaded).toEqual(row);
  });

  it("(episode identity) finds the LATEST row for a given identity, not just any row", async () => {
    const db = await freshSeededDb();
    const identityKey = `${fixtureProfile.id}:CONNECTION_NEEDS_ATTENTION:conn-1`;
    const resolved = buildAlertRow({
      id: createId("alert"),
      identityKey,
      status: "RESOLVED",
      createdAt: "2026-09-01T00:00:00.000Z",
      resolvedAt: "2026-09-02T00:00:00.000Z",
    });
    await repo.upsertAlertRow(db, resolved);

    const newer = buildAlertRow({
      id: createId("alert"),
      identityKey,
      status: "ACTIVE_UNSEEN",
      createdAt: "2026-09-05T00:00:00.000Z",
    });
    await repo.upsertAlertRow(db, newer);

    const latest = await repo.findLatestAlertRowByIdentityKey(db, fixtureProfile.id, identityKey);
    expect(latest?.id).toBe(newer.id);
  });

  it("returns undefined for an identity with no rows yet", async () => {
    const db = await freshSeededDb();
    expect(await repo.findLatestAlertRowByIdentityKey(db, fixtureProfile.id, "no-such-identity")).toBeUndefined();
  });

  it("lists every alert row for a profile", async () => {
    const db = await freshSeededDb();
    await repo.upsertAlertRow(db, buildAlertRow({ id: createId("alert") }));
    await repo.upsertAlertRow(db, buildAlertRow({ id: createId("alert"), type: "CONNECTION_NEEDS_ATTENTION" }));
    const all = await repo.listAlertRowsForProfile(db, fixtureProfile.id);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("round-trips an alert evaluation checkpoint, one per profile (unique constraint upserts in place)", async () => {
    const db = await freshSeededDb();
    const base = {
      id: createId("alert-checkpoint"),
      financialProfileId: fixtureProfile.id,
      safeToSpendCents: 217_111,
      liquidityAwareSafeToSpendCents: null,
      liquidityCoverage: "UNKNOWN" as const,
      activeDropEpisodeBaselineCents: null,
      evaluatedAt: "2026-09-09T00:00:00.000Z",
      policyVersion: 1,
    };
    await repo.upsertAlertEvaluationCheckpointRow(db, base);
    const loaded = await repo.getAlertEvaluationCheckpointRow(db, fixtureProfile.id);
    expect(loaded).toEqual(base);

    // A second write for the SAME profile updates in place — never a second row.
    await repo.upsertAlertEvaluationCheckpointRow(db, { ...base, safeToSpendCents: 100_000 });
    const updated = await repo.getAlertEvaluationCheckpointRow(db, fixtureProfile.id);
    expect(updated?.safeToSpendCents).toBe(100_000);
    expect(updated?.id).toBe(base.id);
  });

  it("returns undefined for a profile with no checkpoint yet (bootstrap)", async () => {
    const db = await freshSeededDb();
    expect(await repo.getAlertEvaluationCheckpointRow(db, "no-such-profile")).toBeUndefined();
  });

  it("round-trips notification preferences, one per profile", async () => {
    const db = await freshSeededDb();
    const row: repo.NotificationPreferencesRow = {
      id: createId("notification-preferences"),
      financialProfileId: fixtureProfile.id,
      inAppEnabled: true,
      financialChangeEnabled: true,
      plannedEventsEnabled: true,
      recommendationsEnabled: true,
      connectionHealthEnabled: true,
      conciergeEnabled: false,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      privacyMode: "AMOUNT_ALLOWED",
      updatedAt: "2026-09-09T00:00:00.000Z",
    };
    await repo.upsertNotificationPreferencesRow(db, row);
    const loaded = await repo.getNotificationPreferencesRow(db, fixtureProfile.id);
    expect(loaded).toEqual(row);
  });

  it("round-trips a notification delivery and lists deliveries for an alert", async () => {
    const db = await freshSeededDb();
    const alertRow = buildAlertRow();
    await repo.upsertAlertRow(db, alertRow);

    const delivery: repo.NotificationDeliveryRow = {
      id: createId("notification-delivery"),
      alertId: alertRow.id,
      financialProfileId: fixtureProfile.id,
      channel: "IN_APP",
      status: "DELIVERED",
      attemptedAt: "2026-09-09T00:00:00.000Z",
      deliveredAt: "2026-09-09T00:00:00.000Z",
      failureReasonCode: null,
    };
    await repo.upsertNotificationDeliveryRow(db, delivery);
    const deliveries = await repo.listNotificationDeliveriesForAlert(db, alertRow.id);
    expect(deliveries).toEqual([delivery]);
  });
});
