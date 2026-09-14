import { createFileRoute } from "@tanstack/react-router";
import { checkReadyHandler } from "@/functions/health.server";

/** READY health check (Sprint 9 Phase 5, DEC-112) — see health.server.ts. */
export const Route = createFileRoute("/api/health/ready")({
  server: {
    handlers: {
      GET: async () => {
        const result = await checkReadyHandler();
        return new Response(JSON.stringify(result), {
          status: result.status === "ok" ? 200 : 503,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
