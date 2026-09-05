import { NextRequest, NextResponse } from "next/server";
import { getDb, handleWebhookEvent } from "@money-copilot/app-services";
import type { PluggyWebhookPayload } from "@money-copilot/open-finance";

export const runtime = "nodejs";

/**
 * Receives Pluggy webhook deliveries. Pluggy does not document a payload
 * signature mechanism (see docs/OPEN-FINANCE.md, "Webhook security") — the
 * protection here is an unguessable shared secret embedded in the webhook
 * URL itself (`PLUGGY_WEBHOOK_SECRET`, appended as `?secret=...` when the
 * URL is registered — see `/api/token`), not a fabricated signature
 * scheme. Processing is idempotent by the provider's own `eventId` (see
 * `handleWebhookEvent`), so a safe-to-retry 500 is returned on failure.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const configuredSecret = process.env["PLUGGY_WEBHOOK_SECRET"];
  if (configuredSecret) {
    const providedSecret = request.nextUrl.searchParams.get("secret");
    if (providedSecret !== configuredSecret) {
      return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
  }

  const payload = (await request.json()) as PluggyWebhookPayload;
  if (!payload.event || !payload.eventId) {
    return NextResponse.json({ error: "Missing required fields: event and eventId" }, { status: 400 });
  }

  const db = await getDb();
  try {
    const outcome = await handleWebhookEvent(db, payload, "pluggy");
    return NextResponse.json({ received: true, eventId: payload.eventId, outcome });
  } catch (error) {
    // Non-2xx tells Pluggy to retry; handleWebhookEvent's idempotency
    // (claimed-by-eventId) makes a retry safe.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing failed" },
      { status: 500 },
    );
  }
}
