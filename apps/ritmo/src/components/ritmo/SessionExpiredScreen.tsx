import { Link } from "@tanstack/react-router";
import { AuthShell } from "./AuthShell";

/**
 * Sprint 9 Phase 4 (brief §J, "SESSION_EXPIRED"): a Ritmo-styled full-page
 * replacement — never a toast/overlay on top of whatever private financial
 * content was on screen. Used two ways, both server-driven, never a
 * client-only timer:
 *
 * 1. As `/sessao-expirada`, a real navigable route (for direct visual
 *    review and as the target of a manual redirect from an in-flight
 *    action that discovers the session is gone).
 * 2. Rendered directly by `__root.tsx`'s root `errorComponent` when a route
 *    loader/server function throws `UnauthenticatedError` — replacing the
 *    ENTIRE failed route's subtree, so no stale data stays mounted
 *    underneath it.
 */
export function SessionExpiredScreen() {
  return (
    <AuthShell
      title="Sua sessão expirou"
      subtitle="Por segurança, você precisa entrar novamente para continuar vendo seus dados."
    >
      <Link
        to="/login"
        className="mt-2 flex items-center justify-center rounded-full brand-gradient px-5 py-2.5 text-sm font-semibold text-primary-foreground"
      >
        Voltar para o login
      </Link>
    </AuthShell>
  );
}
