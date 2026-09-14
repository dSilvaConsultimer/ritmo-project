/**
 * Best-effort detection of an expired/missing session surfacing from a
 * server function or route loader (`UnauthenticatedError`,
 * `apps/ritmo/src/functions/profile.server.ts`) after it has crossed the
 * client/server RPC boundary. Deliberately does NOT import that class or
 * its file — that file carries server-only imports, and importing it here
 * would pull them into client-reachable code (the exact bug class Sprint 9
 * Phase 3 fixed). A plain `Error` with a matching `name`/`message` is a
 * safe, framework-agnostic signal to check instead.
 */
export function isAuthExpiredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "UnauthenticatedError" || /no authenticated session/i.test(error.message);
}
