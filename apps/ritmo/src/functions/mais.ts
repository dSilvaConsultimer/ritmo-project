import { createServerFn } from "@tanstack/react-start";
import {
  getCategoryRuleCount,
  getConnections,
  getDb,
  getNotificationPreferences,
} from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";

/**
 * Raw data for the Mais screen. See `src/adapters/mais.ts` for the
 * presentation reshaping — "Perfil e dados" is the seam Sprint 9's real
 * authentication will replace (see docs/RITMO.md, "Login exception"); no
 * production login is designed or implemented here.
 */
export const getMaisData = createServerFn({ method: "GET" }).handler(async () => {
  const { displayName, financialProfileId } = await getCurrentProfileContext();
  const db = await getDb();

  const [connections, categoryRuleCount, notificationPreferences] = await Promise.all([
    getConnections(db, financialProfileId),
    getCategoryRuleCount(db),
    getNotificationPreferences(db, financialProfileId),
  ]);

  return {
    displayName,
    connectedInstitutionsCount: connections.length,
    categoryRuleCount,
    quietHoursStart: notificationPreferences.quietHoursStart ?? null,
    quietHoursEnd: notificationPreferences.quietHoursEnd ?? null,
    // Real package version — set by pnpm/npm for any script-invoked process
    // (dev/build); falls back to today's actual shipped version rather than
    // showing a stale hardcoded number if unset in some deploy contexts.
    appVersion: process.env["npm_package_version"] ?? "0.1.0",
  };
});

export type MaisData = Awaited<ReturnType<typeof getMaisData>>;
