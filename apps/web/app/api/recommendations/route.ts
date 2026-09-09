import { NextRequest, NextResponse } from "next/server";
import {
  getDb,
  acceptRecommendation,
  modifyRecommendation,
  rejectRecommendation,
} from "@money-copilot/app-services";
import { fromReais } from "@money-copilot/financial-engine";

export const runtime = "nodejs";

/**
 * Sprint 5: a single flat route for every recommendation decision action,
 * matching this app's existing convention (e.g. `/api/connections`)
 * rather than nested dynamic route segments. `action` dispatches to the
 * deterministic `recommendation-service` function — this route never
 * computes anything itself. Accepting/modifying a recommendation records
 * intent only; it does NOT contact any real merchant and does NOT change
 * current Safe-to-Spend (see docs/RECOMMENDATIONS.md, "Safe-to-Spend
 * separation").
 */
export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as {
    recommendationId?: string;
    action?: "ACCEPT" | "MODIFY" | "REJECT";
    targetAmountReais?: number;
    effectiveDate?: string;
    reason?: string;
  };

  if (!body.recommendationId || !body.action) {
    return NextResponse.json({ error: "recommendationId and action are required" }, { status: 400 });
  }

  const db = await getDb();

  try {
    switch (body.action) {
      case "ACCEPT": {
        const result = await acceptRecommendation(db, {
          recommendationId: body.recommendationId,
          ...(body.effectiveDate ? { effectiveDate: body.effectiveDate } : {}),
        });
        return NextResponse.json(result);
      }
      case "MODIFY": {
        const result = await modifyRecommendation(db, {
          recommendationId: body.recommendationId,
          ...(body.targetAmountReais !== undefined ? { targetAmount: fromReais(body.targetAmountReais) } : {}),
          ...(body.effectiveDate ? { effectiveDate: body.effectiveDate } : {}),
        });
        return NextResponse.json(result);
      }
      case "REJECT": {
        const result = await rejectRecommendation(db, body.recommendationId, body.reason);
        return NextResponse.json(result);
      }
      default:
        return NextResponse.json({ error: `Unknown action ${body.action as string}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 400 });
  }
}
