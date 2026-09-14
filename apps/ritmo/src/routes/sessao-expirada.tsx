import { createFileRoute } from "@tanstack/react-router";
import { SessionExpiredScreen } from "@/components/ritmo/SessionExpiredScreen";

/**
 * Real, directly-navigable route for the SESSION_EXPIRED state (Sprint 9
 * Phase 4, brief §J and §26 visual review) — outside `_protected` since by
 * definition there is no valid session to gate on. See
 * `SessionExpiredScreen` for how this is also reached from a mid-session
 * expiry, not just direct navigation.
 */
export const Route = createFileRoute("/sessao-expirada")({
  head: () => ({ meta: [{ title: "Sessão expirada" }] }),
  component: SessionExpiredScreen,
});
