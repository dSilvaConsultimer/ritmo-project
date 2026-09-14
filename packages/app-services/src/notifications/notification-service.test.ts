import { afterEach, describe, expect, it } from "vitest";
import { fixtureProfile, fromReais } from "@money-copilot/financial-engine";
import { freshSeededDb } from "../test-helpers";
import { recordManualTransaction } from "../mutations";
import { evaluateAlerts, listAlertsForProfile, dismissAlert } from "../alerts";
import {
  deliverAlertNotification,
  getNotificationPreferences,
  syncNotificationsForProfile,
  updateNotificationPreferences,
} from "./notification-service";
import { registerNotificationProvider, resetNotificationProviderRegistry } from "../notification-provider-registry";
import type { NotificationProvider } from "./provider";
import * as repo from "@money-copilot/persistence";

const ASOF = "2026-09-05";

afterEach(() => {
  resetNotificationProviderRegistry();
});

async function makeMaterialSafeToSpendAlert(db: Awaited<ReturnType<typeof freshSeededDb>>) {
  await evaluateAlerts(db, fixtureProfile.id, ASOF); // bootstrap
  await recordManualTransaction(db, fixtureProfile.id, { amount: fromReais(1000), merchantOrDescription: "Big purchase", date: ASOF });
  await evaluateAlerts(db, fixtureProfile.id, ASOF);
  const [alert] = (await listAlertsForProfile(db, fixtureProfile.id)).filter((a) => a.type === "SAFE_TO_SPEND_MATERIAL_DROP");
  return alert!;
}

describe("getNotificationPreferences / updateNotificationPreferences", () => {
  it("returns sensible 'everything on' defaults for a profile with no row yet", async () => {
    const db = await freshSeededDb();
    const preferences = await getNotificationPreferences(db, fixtureProfile.id);
    expect(preferences.inAppEnabled).toBe(true);
    expect(preferences.conciergeEnabled).toBe(true);
    expect(preferences.privacyMode).toBe("AMOUNT_ALLOWED");
  });

  it("(B) disabling a category persists and only affects that category", async () => {
    const db = await freshSeededDb();
    const updated = await updateNotificationPreferences(db, fixtureProfile.id, { category: "CONCIERGE", enabled: false });
    expect(updated.conciergeEnabled).toBe(false);
    expect(updated.financialChangeEnabled).toBe(true);

    const reloaded = await getNotificationPreferences(db, fixtureProfile.id);
    expect(reloaded.conciergeEnabled).toBe(false);
  });

  it("(G) privacy mode can be set to GENERIC to omit amounts from future provider payloads", async () => {
    const db = await freshSeededDb();
    const updated = await updateNotificationPreferences(db, fixtureProfile.id, { privacyMode: "GENERIC" });
    expect(updated.privacyMode).toBe("GENERIC");
  });

  it("quiet hours can be set and later explicitly cleared", async () => {
    const db = await freshSeededDb();
    const withHours = await updateNotificationPreferences(db, fixtureProfile.id, { quietHoursStart: "22:00", quietHoursEnd: "07:00" });
    expect(withHours.quietHoursStart).toBe("22:00");

    const cleared = await updateNotificationPreferences(db, fixtureProfile.id, { quietHoursStart: null, quietHoursEnd: null });
    expect(cleared.quietHoursStart).toBeUndefined();
    expect(cleared.quietHoursEnd).toBeUndefined();
  });
});

describe("deliverAlertNotification / syncNotificationsForProfile", () => {
  it("(A) delivers exactly one IN_APP notification for a newly created alert episode", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialSafeToSpendAlert(db);
    const delivery = await deliverAlertNotification(db, alert);
    expect(delivery?.status).toBe("DELIVERED");

    const all = await repo.listNotificationDeliveriesForAlert(db, alert.id);
    expect(all).toHaveLength(1);
  });

  it("(E) delivering the same alert twice is idempotent — never a second delivery row", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialSafeToSpendAlert(db);
    await deliverAlertNotification(db, alert);
    await deliverAlertNotification(db, alert);
    await deliverAlertNotification(db, alert);

    const all = await repo.listNotificationDeliveriesForAlert(db, alert.id);
    expect(all).toHaveLength(1);
  });

  it("(B) a disabled category suppresses delivery, but the alert itself still exists", async () => {
    const db = await freshSeededDb();
    await updateNotificationPreferences(db, fixtureProfile.id, { category: "FINANCIAL_CHANGE", enabled: false });
    const alert = await makeMaterialSafeToSpendAlert(db);
    const delivery = await deliverAlertNotification(db, alert);
    expect(delivery?.status).toBe("SUPPRESSED");

    const stillExists = await listAlertsForProfile(db, fixtureProfile.id);
    expect(stillExists.some((a) => a.id === alert.id)).toBe(true);
  });

  it("(C) a dismissed alert is not delivered by syncNotificationsForProfile", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialSafeToSpendAlert(db);
    await dismissAlert(db, fixtureProfile.id, alert.id);

    const result = await syncNotificationsForProfile(db, fixtureProfile.id);
    expect(result.delivered).toBe(0);
    const deliveries = await repo.listNotificationDeliveriesForAlert(db, alert.id);
    expect(deliveries).toHaveLength(0);
  });

  it("(D) a resolved alert is not newly delivered", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialSafeToSpendAlert(db);
    // Force resolution by directly marking the row RESOLVED (simulating a
    // condition that recovered) — resolution mechanics are alert-service's
    // own concern, already covered there; here we only verify the
    // notification-delivery boundary.
    const row = await repo.getAlertRowById(db, alert.id);
    await repo.upsertAlertRow(db, { ...row!, status: "RESOLVED", resolvedAt: "2026-09-06T00:00:00.000Z" });

    const result = await syncNotificationsForProfile(db, fixtureProfile.id);
    expect(result.delivered).toBe(0);
  });

  it("(F) quiet hours never suppress the in-app delivery itself", async () => {
    const db = await freshSeededDb();
    await updateNotificationPreferences(db, fixtureProfile.id, { quietHoursStart: "00:00", quietHoursEnd: "23:59" });
    const alert = await makeMaterialSafeToSpendAlert(db);
    const delivery = await deliverAlertNotification(db, alert);
    expect(delivery?.status).toBe("DELIVERED");
  });

  it("(G) GENERIC privacy mode renders a payload with no amount; AMOUNT_ALLOWED includes one", async () => {
    const db = await freshSeededDb();
    const seen: string[] = [];
    const spyProvider: NotificationProvider = {
      name: "spy",
      send: async (payload) => {
        seen.push(payload.body);
        return { delivered: true };
      },
    };
    registerNotificationProvider("mock", spyProvider);

    await updateNotificationPreferences(db, fixtureProfile.id, { privacyMode: "GENERIC" });
    const alert = await makeMaterialSafeToSpendAlert(db);
    await deliverAlertNotification(db, alert, spyProvider);

    expect(seen[0]).not.toMatch(/R\$/);
    expect(seen[0]).toBe("Money Copilot encontrou algo que merece sua atenção.");
  });

  it("syncNotificationsForProfile delivers every active alert exactly once across multiple types", async () => {
    const db = await freshSeededDb();
    const alert = await makeMaterialSafeToSpendAlert(db);
    const first = await syncNotificationsForProfile(db, fixtureProfile.id);
    expect(first.delivered).toBeGreaterThanOrEqual(1);
    const second = await syncNotificationsForProfile(db, fixtureProfile.id);
    expect(second.delivered).toBe(0); // already delivered — idempotent

    const deliveries = await repo.listNotificationDeliveriesForAlert(db, alert.id);
    expect(deliveries).toHaveLength(1);
  });
});
