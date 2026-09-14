import { requireEnv, type AppEnvironment } from "@money-copilot/config";
import { logger } from "./logger.server";
import {
  createResendClient,
  sendPasswordResetEmailViaResend,
  type ResendEmailClient,
} from "./email-resend.server";

/**
 * Server-only transactional-email boundary (Sprint 9 Phase 3 fix-up, DEC-098;
 * Resend wired in Phase 6A, DEC-120). This module is the ONE seam Better
 * Auth's `sendResetPassword` callback (`auth.server.ts`) goes through — no
 * other file knows which provider (if any) is configured. Before DEC-098,
 * `auth.server.ts`'s `emailAndPassword` had no `sendResetPassword` at all,
 * which makes Better Auth's own `/request-password-reset` endpoint throw
 * `RESET_PASSWORD_DISABLED` server-side on every call — but that error is
 * swallowed by Better Auth's `runInBackgroundOrAwait` (awaited, caught,
 * logged, never rethrown) when no `advanced.backgroundTasks.handler` is
 * configured (which this app does not configure), so the client always
 * received `{status: true}` regardless. `isPasswordResetAvailable` — checked
 * by the UI BEFORE this function ever runs — is what actually gates the
 * flow; this function's own throw is defense-in-depth, not the real gate.
 */

export class PasswordResetUnavailableError extends Error {
  constructor() {
    super("Password-reset email delivery is not configured for this environment.");
    this.name = "PasswordResetUnavailableError";
  }
}

/**
 * True only once every piece Resend needs is actually present — a provider
 * NAME alone (e.g. `TRANSACTIONAL_EMAIL_PROVIDER=resend` with no API key or
 * sender configured) is deliberately NOT enough: password reset stays
 * unavailable, and `preflight.server.ts`'s `NO_TRANSACTIONAL_EMAIL_PROVIDER`
 * finding still fires (brief §D: "password reset must remain honestly
 * unavailable and preflight must report it as a GO_LIVE blocker").
 */
export function isTransactionalEmailConfigured(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (
    env["TRANSACTIONAL_EMAIL_PROVIDER"] === "resend" &&
    Boolean(env["RESEND_API_KEY"]) &&
    Boolean(env["TRANSACTIONAL_EMAIL_FROM"])
  );
}

/**
 * Whether password recovery can honestly be offered at all in this
 * environment. Pure and directly testable — the UI (`recuperar-senha.tsx`)
 * calls this via `checkPasswordResetAvailability` (`password-reset.ts`)
 * BEFORE ever showing the request form, so a user is never invited to submit
 * an email address into a feature that cannot deliver anything.
 */
export function isPasswordResetAvailable(
  environment: AppEnvironment,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  if (environment === "development" || environment === "test") return true;
  return isTransactionalEmailConfigured(env);
}

/**
 * Sprint 9 Phase 5 fix-up (docs/DECISIONS.md DEC-107): the reset URL itself
 * (a live, usable password-reset token) is a secret — it was previously
 * written to ordinary `console.log` output in development/test, which
 * flows into the same log stream as everything else. Captured here instead,
 * in-memory only, never through the structured logger (which would also
 * redact it, but the point is to never let a real reset token reach ANY
 * log line at all, ordinary or structured). `getLastDevPasswordResetEmail()`
 * is how automated tests prove reset-link generation without a real
 * mailbox — the same capability the old `console.log` gave manual testing,
 * without the logging side effect.
 */
interface DevPasswordResetCapture {
  readonly to: string;
  readonly url: string;
  readonly capturedAt: string;
}

let lastDevCapture: DevPasswordResetCapture | undefined;

/** Test/dev-only accessor — never used by production code paths. */
export function getLastDevPasswordResetEmail(): DevPasswordResetCapture | undefined {
  return lastDevCapture;
}

/** Test-only: clears the capture between test runs. */
export function resetDevPasswordResetCapture(): void {
  lastDevCapture = undefined;
}

/**
 * Better Auth's own `sendResetPassword` callback. In development/test,
 * captures the real reset URL in-memory (never to the browser, never
 * logged, never persisted, never a real network call) so a developer or an
 * automated test can complete the real reset flow without a real mailbox —
 * an honest stand-in, not a pretense that an email was sent. In staging/
 * production with Resend fully configured, sends a real, minimal
 * Ritmo-branded email (`email-resend.server.ts`). Otherwise throws — this
 * throw is swallowed by Better Auth itself (see module doc above), which is
 * exactly why `isPasswordResetAvailable` — not this function's return value
 * — is what gates whether the UI offers the flow at all.
 *
 * `createClient` is injectable ONLY for tests (default: the real Resend
 * constructor) — no test in this codebase ever makes a live Resend request.
 */
export async function sendPasswordResetEmail(
  environment: AppEnvironment,
  params: { readonly to: string; readonly url: string },
  createClient: (apiKey: string) => ResendEmailClient = createResendClient,
): Promise<void> {
  if (environment === "development" || environment === "test") {
    lastDevCapture = { to: params.to, url: params.url, capturedAt: new Date().toISOString() };
    logger.info("dev_password_reset_captured", { environment });
    return;
  }
  if (!isTransactionalEmailConfigured()) {
    throw new PasswordResetUnavailableError();
  }

  const apiKey = requireEnv("RESEND_API_KEY");
  const from = requireEnv("TRANSACTIONAL_EMAIL_FROM");
  const client = createClient(apiKey);
  await sendPasswordResetEmailViaResend(client, { from, to: params.to, resetUrl: params.url });
}
