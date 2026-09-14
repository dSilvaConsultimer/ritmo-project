import { getDb, handleWebhookEvent } from "@money-copilot/app-services";
import type { PluggyWebhookPayload } from "@money-copilot/open-finance";
import { checkRateLimit, RATE_LIMIT_POLICIES } from "./rate-limit.server";
import { logger } from "./logger.server";

/**
 * Server-only. `apps/ritmo`'s own Pluggy webhook receiver (Sprint 9 Phase
 * 5 — see docs/DECISIONS.md DEC-111) — `apps/ritmo` had none before this;
 * only `apps/web` (`/api/webhook`) did. Reuses `handleWebhookEvent`
 * unmodified — same idempotency (claimed by Pluggy's own `eventId`), same
 * "never trust the payload, always re-fetch canonical data" rule, same
 * ownership resolution (`recoverOrphanedConnection` validates `clientUserId`
 * against a real known `FinancialProfile` before trusting it — never a
 * client-controlled mapping). See docs/OPEN-FINANCE.md, "Webhooks."
 *
 * **Authenticity mechanism**: Pluggy does not document a payload-signature
 * scheme for this integration (confirmed — see docs/OPEN-FINANCE.md,
 * "Webhook security"). Protection is an unguessable shared secret embedded
 * in the webhook URL itself (`PLUGGY_WEBHOOK_SECRET`, appended as
 * `?secret=...` when the URL is registered at Connect Token creation time)
 * — the same scheme `apps/web`'s existing webhook route already uses, not
 * a newly-invented one.
 *
 * This is a PROVIDER_CALLBACK, not a browser client — Better Auth's
 * origin-check/CSRF middleware does not apply here (it's not mounted on
 * this route), and correctly so (brief §9: "do not accidentally apply
 * browser CSRF assumptions to Pluggy webhooks").
 */
export interface WebhookHandlerResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

export async function handlePluggyWebhookHandler(request: Request): Promise<WebhookHandlerResult> {
  const configuredSecret = process.env["PLUGGY_WEBHOOK_SECRET"];
  if (configuredSecret) {
    const url = new URL(request.url);
    const providedSecret = url.searchParams.get("secret");
    if (providedSecret !== configuredSecret) {
      logger.warn("webhook_unauthorized", {});
      return { status: 401, body: { error: "UNAUTHORIZED" } };
    }
  }

  // A provider callback, not a per-user action — keyed globally, generous,
  // just a sanity ceiling against a misbehaving/duplicating sender, never
  // intended to reject Pluggy's own normal delivery volume.
  const limited = checkRateLimit("webhook:pluggy", RATE_LIMIT_POLICIES.webhook);
  if (!limited.allowed) {
    logger.warn("webhook_rate_limited", {});
    return { status: 429, body: { error: "RATE_LIMITED" } };
  }

  let payload: PluggyWebhookPayload;
  try {
    payload = (await request.json()) as PluggyWebhookPayload;
  } catch {
    return { status: 400, body: { error: "INVALID_JSON" } };
  }
  if (!payload.event || !payload.eventId) {
    return { status: 400, body: { error: "Missing required fields: event and eventId" } };
  }

  const db = await getDb();
  try {
    const outcome = await handleWebhookEvent(db, payload, "pluggy");
    logger.audit("webhook_processed", { eventType: payload.event, outcome });
    return { status: 200, body: { received: true, eventId: payload.eventId, outcome } };
  } catch (error) {
    // Sprint 9 Phase 5 (brief §14): never the raw error message in the
    // response body — full detail goes server-side only. A non-2xx tells
    // Pluggy to retry; `handleWebhookEvent`'s idempotency (claimed-by-
    // eventId) makes a retry safe.
    logger.error("webhook_processing_failed", { eventType: payload.event });
    console.error(error);
    return { status: 500, body: { error: "Webhook processing failed" } };
  }
}
