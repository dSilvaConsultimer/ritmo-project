import type { WebhookEventPayload } from "pluggy-sdk";

export type PluggyWebhookPayload = WebhookEventPayload;

/**
 * The set of events this integration actually acts on. Pluggy's full event
 * vocabulary includes payment/investment events irrelevant to Money
 * Copilot's Sprint 3 scope — anything else is acknowledged and ignored.
 */
export const HANDLED_WEBHOOK_EVENTS = [
  "item/created",
  "item/updated",
  "item/error",
  "item/deleted",
  "item/waiting_user_input",
  "item/waiting_user_action",
  "item/login_succeeded",
  "transactions/created",
  "transactions/updated",
  "transactions/deleted",
] as const;

export type HandledWebhookEvent = (typeof HANDLED_WEBHOOK_EVENTS)[number];

export function isHandledWebhookEvent(event: string): event is HandledWebhookEvent {
  return (HANDLED_WEBHOOK_EVENTS as readonly string[]).includes(event);
}

/**
 * Pluggy's own `eventId` uniquely identifies a webhook delivery — using it
 * directly as an idempotency key (e.g. a database primary key the caller
 * inserts before processing) is what makes "duplicate webhook eventId
 * ignored/idempotently handled" possible without any additional
 * bookkeeping. See docs/OPEN-FINANCE.md, "Webhooks."
 */
export function extractIdempotencyKey(payload: PluggyWebhookPayload): string {
  return payload.eventId;
}

/**
 * Minimal, narrow, loggable summary of a webhook payload — deliberately
 * excludes anything beyond identifiers, per "do not persist full raw
 * provider payloads by default."
 */
export function summarizeWebhookPayload(payload: PluggyWebhookPayload): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    event: payload.event,
    eventId: payload.eventId,
  };
  if ("itemId" in payload) summary["itemId"] = payload.itemId;
  if ("accountId" in payload) summary["accountId"] = payload.accountId;
  if ("transactionIds" in payload) summary["transactionCount"] = payload.transactionIds.length;
  return summary;
}
