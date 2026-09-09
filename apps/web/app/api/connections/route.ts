import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  getConnections,
  completeConnection,
  disconnectConnection,
  DEMO_PROFILE_ID,
} from "@money-copilot/app-services";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const db = await getDb();
  const connections = await getConnections(db, DEMO_PROFILE_ID);
  return NextResponse.json({ connections });
}

/**
 * Fully removes one connection (best-effort provider-side Item deletion +
 * every piece of local data scoped exclusively to it — never
 * shared/canonical fixture data). See `disconnectConnection`,
 * docs/OPEN-FINANCE.md "Connection deletion," DEC-050. Not yet wired to a
 * UI control — invoked directly (`DELETE /api/connections?connectionId=...`)
 * for the Sprint 4.5 duplicate-sandbox-connection cleanup; a "Disconnect"
 * button is a natural follow-up, not required for this to be a real,
 * permanent application capability.
 */
export async function DELETE(request: NextRequest): Promise<Response> {
  const connectionId = request.nextUrl.searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId query parameter is required" }, { status: 400 });
  }

  const db = await getDb();
  const existing = (await getConnections(db, DEMO_PROFILE_ID)).find((c) => c.id === connectionId);
  if (!existing) {
    return NextResponse.json({ error: `No connection ${connectionId} for this profile` }, { status: 404 });
  }

  const result = await disconnectConnection(db, connectionId);
  return NextResponse.json(result);
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
