import { createFileRoute, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { checkAuthenticated } from "@/functions/session";
import { syncAllConnectionsOnOpen } from "@/functions/connections";

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
  component: ProtectedLayout,
});

/**
 * DEC-129: the correct "once per app open" boundary. This component mounts
 * exactly once for the whole authenticated session — every screen under
 * `_protected` is a sibling route rendered through the same `<Outlet />`,
 * so navigating Home -> Planejamento -> Home never remounts this component
 * or re-runs this effect (only each destination route's own loader runs).
 * Deliberately NOT in `beforeLoad`/`loader`, both of which DO re-run on
 * every navigation. The `hasRunRef` guard additionally protects against
 * React 18 Strict Mode's dev-only double-invoke of effects.
 *
 * Fire-and-forget by design (brief: "não deve bloquear a renderização
 * inteira do app"): the app renders immediately from whatever data is
 * already persisted; sync happens in the background and, only on success,
 * triggers `router.invalidate()` so already-mounted loaders (Home,
 * Extrato, ...) re-fetch with the freshly-synced data. A failure is
 * swallowed here on purpose — `syncAllConnectionsOnOpenHandler` already
 * logs it server-side, `syncConnection` never deletes previously-synced
 * data on failure (DEC-128), and surfacing a background sync failure as a
 * blocking error/blank screen would be worse than silently keeping the
 * last-known-good data on screen.
 */
function ProtectedLayout() {
  const router = useRouter();
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    void syncAllConnectionsOnOpen()
      .then((summary) => {
        if (summary.ok && summary.succeeded > 0) {
          void router.invalidate();
        }
      })
      .catch(() => {
        // Swallowed — see doc comment above.
      });
  }, [router]);

  return <Outlet />;
}
