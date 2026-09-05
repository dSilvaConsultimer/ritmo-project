import { NextRequest, NextResponse } from "next/server";
import { getDb, syncConnection, getConnections, DEMO_PROFILE_ID } from "@money-copilot/app-services";

export const runtime = "nodejs";

/**
 * Manual synchronization trigger — local development (and the founder,
 * later) should never depend entirely on webhook delivery. Powers the
 * "Refresh/sync" button in the Connected Accounts section.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const db = await getDb();
  const body = (await request.json().catch(() => ({}))) as { connectionId?: string };

  const connectionId = body.connectionId ?? (await getConnections(db, DEMO_PROFILE_ID))[0]?.id;
  if (!connectionId) {
    return NextResponse.json({ error: "No connection to sync" }, { status: 400 });
  }

  const run = await syncConnection(db, DEMO_PROFILE_ID, connectionId);
  return NextResponse.json(run);
}
