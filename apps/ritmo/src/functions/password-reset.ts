import { createServerFn } from "@tanstack/react-start";
import { checkPasswordResetAvailabilityHandler } from "./password-reset.server";

/**
 * Whether `/recuperar-senha` can honestly offer password recovery in this
 * environment (Sprint 9 Phase 3 fix-up — see docs/DECISIONS.md DEC-098).
 * `recuperar-senha.tsx` calls this in its route `loader`, before rendering
 * the request form, so the UI never invites an email address into a feature
 * that cannot deliver anything in staging/production without a configured
 * transactional-email provider.
 */
export const checkPasswordResetAvailability = createServerFn({ method: "GET" }).handler(
  checkPasswordResetAvailabilityHandler,
);
