import { createFileRoute } from "@tanstack/react-router";
import { checkLiveHandler } from "@/functions/health.server";

/** LIVE health check (Sprint 9 Phase 5, DEC-112) — see health.server.ts. */
export const Route = createFileRoute("/api/health/live")({
  server: {
    handlers: {
      GET: () => {
        const result = checkLiveHandler();
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
