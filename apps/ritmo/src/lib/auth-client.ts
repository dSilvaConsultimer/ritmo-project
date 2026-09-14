import { createAuthClient } from "better-auth/react";

/**
 * Client-side Better Auth SDK — drives the Login/Sign-up/Recovery form
 * submissions and `signOut`. This is a thin wrapper; it owns no visual
 * identity of its own (no hosted UI), matching Sprint 9's requirement that
 * Ritmo's own screens remain the only auth UI a user ever sees.
 */
export const authClient = createAuthClient();
