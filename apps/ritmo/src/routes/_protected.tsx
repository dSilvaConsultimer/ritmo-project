import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { checkAuthenticated } from "@/functions/session";

/**
 * Pathless layout wrapping every private Ritmo screen (Home, Transações,
 * Planejamento, Insights, Assistente, Mais). This `beforeLoad` redirect is
 * UX/route-protection only — it prevents a content flash before redirecting
 * an unauthenticated visitor to `/login`. It is NOT the security boundary:
 * every server function under `src/functions/` independently resolves and
 * verifies the caller's session via `getCurrentProfileContext()` regardless
 * of whether this check ever ran. See docs/DECISIONS.md, Sprint 9's
 * authorization-boundary entry.
 */
export const Route = createFileRoute("/_protected")({
  beforeLoad: async () => {
    const { authenticated } = await checkAuthenticated();
    if (!authenticated) {
      throw redirect({ to: "/login" });
    }
  },
  component: () => <Outlet />,
});
