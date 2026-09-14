import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@/functions/auth.server";

/**
 * Mounts Better Auth's own request handler at `/api/auth/*` — sign-in,
 * sign-up, session, sign-out, email verification, and password reset all
 * flow through this single catch-all. This route has no `component`; it is
 * server-only by nature (an API endpoint, never rendered), following Better
 * Auth's official TanStack Start integration guide exactly — see
 * docs/DECISIONS.md DEC-095.
 */
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getAuth();
        return auth.handler(request);
      },
      POST: async ({ request }) => {
        const auth = await getAuth();
        return auth.handler(request);
      },
    },
  },
});
