import { createFileRoute } from "@tanstack/react-router";
import { handlePluggyWebhookHandler } from "@/functions/webhook.server";

/**
 * Pluggy webhook receiver (Sprint 9 Phase 5, DEC-111). No `component` —
 * server-only, never rendered. See `webhook.server.ts` for the real logic.
 */
export const Route = createFileRoute("/api/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const result = await handlePluggyWebhookHandler(request);
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
