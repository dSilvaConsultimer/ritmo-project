import { createFileRoute } from "@tanstack/react-router";
import { ensureDevTestUserHandler } from "@/functions/dev-seed.server";

/**
 * Development/test-only trigger for the local test login (Sprint 9 Phase 4
 * fix-up — see docs/DECISIONS.md DEC-104). Visit this once per fresh local
 * database (`GET /api/dev-seed`) to provision teste@ritmo.local, then use
 * the real `/login` screen. Idempotent — safe to hit repeatedly. Refuses
 * (`ensureDevTestUserHandler` throws, surfacing as a generic 500) outside
 * development/test — no separate route-level check duplicates that logic.
 */
export const Route = createFileRoute("/api/dev-seed")({
  server: {
    handlers: {
      GET: async () => {
        const result = await ensureDevTestUserHandler();
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
