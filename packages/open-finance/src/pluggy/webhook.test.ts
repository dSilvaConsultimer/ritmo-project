import { describe, expect, it } from "vitest";
import {
  extractIdempotencyKey,
  isHandledWebhookEvent,
  summarizeWebhookPayload,
} from "./webhook";
import {
  fixtureItemCreatedWebhook,
  fixtureTransactionsCreatedWebhook,
  fixtureTransactionsDeletedWebhook,
  fixtureTransactionsUpdatedWebhook,
} from "./fixtures/index";

describe("extractIdempotencyKey", () => {
  it("uses Pluggy's own eventId as the idempotency key", () => {
    expect(extractIdempotencyKey(fixtureItemCreatedWebhook)).toBe(fixtureItemCreatedWebhook.eventId);
    expect(extractIdempotencyKey(fixtureTransactionsCreatedWebhook)).toBe(
      fixtureTransactionsCreatedWebhook.eventId,
    );
  });

  it("produces distinct keys for distinct events", () => {
    const a = extractIdempotencyKey(fixtureTransactionsUpdatedWebhook);
    const b = extractIdempotencyKey(fixtureTransactionsDeletedWebhook);
    expect(a).not.toBe(b);
  });
});

describe("isHandledWebhookEvent", () => {
  it("recognizes item and transaction lifecycle events", () => {
    expect(isHandledWebhookEvent("item/created")).toBe(true);
    expect(isHandledWebhookEvent("transactions/created")).toBe(true);
    expect(isHandledWebhookEvent("transactions/deleted")).toBe(true);
  });

  it("does not claim to handle out-of-scope events (e.g. payments)", () => {
    expect(isHandledWebhookEvent("payment_intent/created")).toBe(false);
  });
});

describe("summarizeWebhookPayload", () => {
  it("produces a narrow summary — never the full payload — safe to log/persist", () => {
    const summary = summarizeWebhookPayload(fixtureTransactionsDeletedWebhook);
    expect(summary["event"]).toBe("transactions/deleted");
    expect(summary["eventId"]).toBe(fixtureTransactionsDeletedWebhook.eventId);
    expect(summary["transactionCount"]).toBe(1);
    // Only identifiers/counts — no raw provider payload retained.
    expect(Object.keys(summary).sort()).toEqual(
      ["accountId", "event", "eventId", "itemId", "transactionCount"].sort(),
    );
  });
});
