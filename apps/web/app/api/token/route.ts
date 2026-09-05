import { NextResponse } from "next/server";
import { getDb, createConnectToken, DEMO_PROFILE_ID } from "@money-copilot/app-services";
import { ProviderError } from "@money-copilot/financial-engine";

export const runtime = "nodejs";

/**
 * Creates a Pluggy Connect Token server-side. CLIENT_ID/CLIENT_SECRET
 * never reach the browser — only this restricted, short-lived token does
 * (see docs/OPEN-FINANCE.md, "Pluggy authentication").
 */
export async function POST(): Promise<Response> {
  const db = await getDb();
  const appUrl = process.env["NEXT_PUBLIC_APP_URL"];
  const webhookSecret = process.env["PLUGGY_WEBHOOK_SECRET"];
  const webhookUrl = appUrl
    ? `${appUrl}/api/webhook${webhookSecret ? `?secret=${encodeURIComponent(webhookSecret)}` : ""}`
    : undefined;

  try {
    const result = await createConnectToken(db, DEMO_PROFILE_ID, "pluggy", webhookUrl);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProviderError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "UNKNOWN_ERROR", message: "Failed to create connect token" }, { status: 500 });
  }
}
