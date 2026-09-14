import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { getDb } from "@money-copilot/app-services";
import { schema } from "@money-copilot/persistence";
import { resolveAppEnvironment } from "@money-copilot/config";
import { resolveBetterAuthRuntimeConfig } from "./auth-config.server";
import { sendPasswordResetEmail } from "./email.server";

/**
 * Server-only — this file constructs the real Better Auth instance and
 * must never be imported from client-context code (it touches the
 * database and, in production, session-signing secrets). The `.server.ts`
 * suffix signals to Vite's import protection that this is server-only.
 *
 * Better Auth needs a live `Database` at construction time, but our own
 * database access is lazily async (`getDb()`). This mirrors DEC-052's own
 * `globalThis`-cached-Promise pattern exactly, for the identical reason:
 * a plain module-level variable is not guaranteed to be one true singleton
 * across every module "layer" a dev-mode SSR framework might create.
 */
declare global {
  // `var` is required for ambient global augmentation — `let`/`const` are not valid here.
  var __moneyCopilotAuth: ReturnType<typeof buildAuth> | undefined;
}

/**
 * Sprint 9 Phase 5 (docs/DECISIONS.md DEC-108): Better Auth's OWN built-in
 * rate limiter, not a duplicate one — it already ships sane, undocumented-
 * by-us-but-verified-by-reading-its-source defaults specifically for
 * `/sign-in*`, `/sign-up*`, `/change-password*`, `/change-email*` (10s
 * window, max 3) and `/request-password-reset`/`/forget-password*` (60s
 * window, max 3), keyed by client IP — never by email, so it never reveals
 * whether an account exists (the 429 fires identically for a real or fake
 * email). Better Auth's own default is `enabled` only in production; this
 * app treats staging as equally sensitive, so it's enabled there too.
 * Development/test stay unthrottled (Better Auth's own default) so the
 * existing adversarial test suites' many rapid sign-ups aren't affected.
 */
export function shouldEnableAuthRateLimit(
  environment: ReturnType<typeof resolveAppEnvironment>,
): boolean {
  return environment === "production" || environment === "staging";
}

async function buildAuth() {
  const environment = resolveAppEnvironment();
  const { secret, baseURL } = resolveBetterAuthRuntimeConfig(environment);
  const db = await getDb();
  return betterAuth({
    secret,
    baseURL,
    rateLimit: {
      enabled: shouldEnableAuthRateLimit(environment),
      storage: "memory",
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      // See docs/DECISIONS.md DEC-098 and email.server.ts's module doc:
      // this callback's errors are swallowed by Better Auth itself, so it is
      // NOT the fail-closed gate — `isPasswordResetAvailable`
      // (`password-reset.ts`) is, checked by the UI before this ever runs.
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail(environment, { to: user.email, url });
      },
    },
    plugins: [tanstackStartCookies()],
  });
}

export function getAuth(): ReturnType<typeof buildAuth> {
  if (!globalThis.__moneyCopilotAuth) {
    globalThis.__moneyCopilotAuth = buildAuth();
  }
  return globalThis.__moneyCopilotAuth;
}
