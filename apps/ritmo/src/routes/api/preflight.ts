import { createFileRoute } from "@tanstack/react-router";
import { isPreflightAccessAllowed, runPreflightChecks } from "@/functions/preflight.server";

/**
 * Deterministic production preflight (Sprint 9 Phase 5/6A, DEC-113/118) —
 * curl as part of a deploy pipeline/checklist before declaring a
 * staging/production deploy ready:
 * `curl -H "X-Preflight-Secret: $PREFLIGHT_SECRET" https://<host>/api/preflight`.
 * Never returns a secret value — only which named checks passed/failed.
 * Returns a plain 404 (not 401/403 — never confirm the route's existence)
 * when access isn't allowed. See `preflight.server.ts` for the real logic.
 */
export const Route = createFileRoute("/api/preflight")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const providedSecret = request.headers.get("X-Preflight-Secret");
        if (!isPreflightAccessAllowed(providedSecret)) {
          return new Response(null, { status: 404 });
        }
        const report = runPreflightChecks();
        return new Response(JSON.stringify(report), {
          status: report.ok ? 200 : 503,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
