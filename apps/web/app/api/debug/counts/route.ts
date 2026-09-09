import { NextResponse } from "next/server";
import { getDb, getEntityCounts, DEMO_PROFILE_ID } from "@money-copilot/app-services";

export const runtime = "nodejs";

const ASOF_DATE = new Date().toISOString().slice(0, 10);

/**
 * Development-only diagnostics for verifying sync idempotency (Sprint 4.5,
 * DEC-053). Exposes entity counts and a non-sensitive payment-source audit
 * (type/subtype/booleans only — never raw external ids, labels, or
 * connection ids) so live validation can run against the already-running
 * app's own endpoints instead of a second process against the file-backed
 * PGlite database (forbidden — see DEC-051).
 *
 * This must never become an anonymously reachable production financial-
 * inspection endpoint: gated on NODE_ENV, matching Next.js's own convention
 * for dev-only routes, since no auth layer exists yet in this pre-Founder-
 * approval product. Returns a plain 404 in production so its existence
 * isn't even disclosed.
 */
export async function GET(): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const db = await getDb();
  const counts = await getEntityCounts(db, DEMO_PROFILE_ID, ASOF_DATE);
  return NextResponse.json(counts);
}
