import { z } from "zod";
import {
  getDb,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";

/**
 * Server-only "Notificações" screen (Mais → Conta) — real read/write
 * against the existing notification-preferences service (Sprint 7), no new
 * business logic. The `.server.ts` suffix signals this file is
 * server-only to Vite's import protection (it imports database code).
 */

export async function getNotificacoesDataHandler() {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  const preferences = await getNotificationPreferences(db, financialProfileId);
  return {
    inAppEnabled: preferences.inAppEnabled,
    financialChangeEnabled: preferences.financialChangeEnabled,
    plannedEventsEnabled: preferences.plannedEventsEnabled,
    recommendationsEnabled: preferences.recommendationsEnabled,
    connectionHealthEnabled: preferences.connectionHealthEnabled,
    conciergeEnabled: preferences.conciergeEnabled,
    quietHoursStart: preferences.quietHoursStart ?? null,
    quietHoursEnd: preferences.quietHoursEnd ?? null,
    privacyMode: preferences.privacyMode,
  };
}

export type NotificacoesData = Awaited<ReturnType<typeof getNotificacoesDataHandler>>;

export const updateNotificacoesInput = z.object({
  category: z
    .enum([
      "FINANCIAL_CHANGE",
      "PLANNED_EVENTS",
      "RECOMMENDATIONS",
      "CONNECTION_HEALTH",
      "CONCIERGE",
    ])
    .optional(),
  enabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
  quietHoursStart: z.string().nullable().optional(),
  quietHoursEnd: z.string().nullable().optional(),
  privacyMode: z.enum(["GENERIC", "AMOUNT_ALLOWED"]).optional(),
});
export type UpdateNotificacoesInput = z.infer<typeof updateNotificacoesInput>;

export async function updateNotificacoesHandler(
  data: UpdateNotificacoesInput,
): Promise<NotificacoesData> {
  const { financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();
  // `exactOptionalPropertyTypes` (repo-wide convention): an explicit
  // `{ category: undefined }` key is not the same as an absent one, so each
  // optional field is only included when actually provided — matches
  // `connections.server.ts`'s own conditional-spread pattern.
  const updated = await updateNotificationPreferences(db, financialProfileId, {
    ...(data.category !== undefined ? { category: data.category } : {}),
    ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
    ...(data.inAppEnabled !== undefined ? { inAppEnabled: data.inAppEnabled } : {}),
    ...(data.quietHoursStart !== undefined ? { quietHoursStart: data.quietHoursStart } : {}),
    ...(data.quietHoursEnd !== undefined ? { quietHoursEnd: data.quietHoursEnd } : {}),
    ...(data.privacyMode !== undefined ? { privacyMode: data.privacyMode } : {}),
  });
  return {
    inAppEnabled: updated.inAppEnabled,
    financialChangeEnabled: updated.financialChangeEnabled,
    plannedEventsEnabled: updated.plannedEventsEnabled,
    recommendationsEnabled: updated.recommendationsEnabled,
    connectionHealthEnabled: updated.connectionHealthEnabled,
    conciergeEnabled: updated.conciergeEnabled,
    quietHoursStart: updated.quietHoursStart ?? null,
    quietHoursEnd: updated.quietHoursEnd ?? null,
    privacyMode: updated.privacyMode,
  };
}
