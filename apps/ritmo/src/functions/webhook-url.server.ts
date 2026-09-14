import { resolveAppEnvironment } from "@money-copilot/config";

/**
 * Server-only Pluggy webhook URL derivation (Sprint 9 Phase 6A — see
 * docs/DECISIONS.md DEC-121). Prepares the code so the real webhook URL can
 * be built the moment a real staging/production public URL exists —
 * without calling Pluggy or requiring that URL to exist yet.
 *
 * Deliberately reuses `BETTER_AUTH_URL` as "our own validated public base
 * URL" rather than inventing a second `APP_BASE_URL`-shaped variable: it is
 * already `requireEnv`-validated in staging/production (DEC-097), and is
 * exactly the same "this app's own real public origin" concept `apps/web`
 * used `NEXT_PUBLIC_APP_URL` for (docs/OPEN-FINANCE.md). Locally,
 * `BETTER_AUTH_URL` is unset — `resolveWebhookUrl` returns `undefined`,
 * and `createConnectToken`'s existing `webhookUrl?` parameter already
 * handles that correctly (the documented "Local development caveat":
 * webhooks cannot reach localhost anyway).
 */
export function resolveWebhookUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  // Founder Local Live Bank Pilot: staging/production are the ONLY tiers
  // that ever register a Pluggy webhook — explicit, not merely incidental
  // to `BETTER_AUTH_URL` being unset locally. Without this gate, a
  // developer who happens to have `BETTER_AUTH_URL` set locally (e.g.
  // copied from another `.env` file, or a tunnel used for unrelated work)
  // would silently start registering a real webhook URL for a real bank
  // connection Pluggy could never actually reach — see docs/DECISIONS.md
  // (Founder Local Live Bank Pilot entry).
  const environment = resolveAppEnvironment(env);
  if (environment !== "staging" && environment !== "production") return undefined;

  const baseURL = env["BETTER_AUTH_URL"];
  if (!baseURL) return undefined;

  const url = new URL("/api/webhook", baseURL);
  const secret = env["PLUGGY_WEBHOOK_SECRET"];
  if (secret) url.searchParams.set("secret", secret);
  return url.toString();
}
