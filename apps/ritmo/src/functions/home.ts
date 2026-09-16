import { createServerFn } from "@tanstack/react-start";
import { getDb } from "@money-copilot/app-services";
import { getCurrentProfileContext } from "./profile.server";
import { resolveAsOfDate } from "./config";
import { buildHomeData } from "./home.server";

/**
 * Thin client-safe wrapper — see `home.server.ts` for the real logic and
 * why it lives in its own `.server.ts` file (code-splitting, not just
 * testability).
 */
export const getHomeData = createServerFn({ method: "GET" }).handler(async () => {
  const { financialProfileId, displayName } = await getCurrentProfileContext();
  const db = await getDb();
  const asOfDate = resolveAsOfDate();
  return buildHomeData(db, financialProfileId, displayName, asOfDate);
});

export type HomeData = Awaited<ReturnType<typeof getHomeData>>;
