import { NextRequest, NextResponse } from "next/server";
import { getDb, DEMO_PROFILE_ID, dismissAlert, markAlertSeen } from "@money-copilot/app-services";

export const runtime = "nodejs";

/**
 * Alert state changes only — deterministic evaluation itself
 * (`evaluateAlerts`) runs server-side as part of the homepage load and the
 * sync pipeline (see `docs/ALERTS-NOTIFICATIONS.md`), never from a client
 * request. This route only ever moves an EXISTING alert between
 * ACTIVE_SEEN/DISMISSED — it can never create, resolve, or change an
 * alert's severity.
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { alertId?: string; action?: "SEEN" | "DISMISS" };
  if (!body.alertId || !body.action) {
    return NextResponse.json({ error: "alertId and action are required" }, { status: 400 });
  }

  const db = await getDb();
  try {
    const updated =
      body.action === "SEEN"
        ? await markAlertSeen(db, DEMO_PROFILE_ID, body.alertId)
        : await dismissAlert(db, DEMO_PROFILE_ID, body.alertId);
    return NextResponse.json({ alert: updated });
  } catch {
    return NextResponse.json({ error: `No alert ${body.alertId} for this profile` }, { status: 404 });
  }
}
