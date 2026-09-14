import { resolveAppEnvironment } from "@money-copilot/config";
import { isPasswordResetAvailable } from "./email.server";

/**
 * Server-only. Plain function holding the real logic — same shape as
 * `session.server.ts`'s `checkAuthenticatedHandler` — callable from both the
 * wrapped server function (`password-reset.ts`) and directly from tests.
 */
export async function checkPasswordResetAvailabilityHandler(): Promise<{
  readonly available: boolean;
}> {
  return { available: isPasswordResetAvailable(resolveAppEnvironment()) };
}
