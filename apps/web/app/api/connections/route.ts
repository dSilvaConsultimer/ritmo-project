import { NextRequest, NextResponse } from "next/server";
import { getDb, getConnections, completeConnection, DEMO_PROFILE_ID } from "@money-copilot/app-services";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const db = await getDb();
  const connections = await getConnections(db, DEMO_PROFILE_ID);
  return NextResponse.json({ connections });
}

/**
 * Called by the Connect UI once Pluggy Connect's `onSuccess` callback
 * fires client-side with a new Item id. Persists the connection (or
 * reuses an existing one for the same external id — see
 * `completeConnection`) and runs the initial import.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json()) as { externalConnectionId?: string };
  if (!body.externalConnectionId) {
    return NextResponse.json({ error: "externalConnectionId is required" }, { status: 400 });
  }

  const db = await getDb();
  const result = await completeConnection(db, DEMO_PROFILE_ID, "pluggy", body.externalConnectionId);
  return NextResponse.json(result);
}
