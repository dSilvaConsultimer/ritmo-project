import { createServerFn } from "@tanstack/react-start";
import { checkAuthenticatedHandler } from "./session.server";

/**
 * UX-layer-only session check for route `beforeLoad` guards. This is
 * deliberately NOT the security boundary — the server functions themselves
 * independently resolve and verify the caller's session.
 *
 * Wrapped in `createServerFn` so routes can import and call it safely.
 * The handler is imported from `session.server.ts` within this module,
 * which is a server-only context.
 */
export const checkAuthenticated = createServerFn({ method: "GET" }).handler(
  checkAuthenticatedHandler,
);
