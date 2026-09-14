import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, resetDbCache } from "@money-copilot/app-services";
import { resetRateLimits } from "./rate-limit.server";
import { handlePluggyWebhookHandler } from "./webhook.server";

/**
 * Sprint 9 Phase 5 — permanent regression coverage for `apps/ritmo`'s own
 * webhook receiver (docs/DECISIONS.md DEC-111).
 */
let tmpDir: string;

beforeAll(async () => {
  resetDbCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-webhook-"));
  process.env["MONEY_COPILOT_DB_PATH"] = path.join(tmpDir, "test.pglite");
  await getDb();
});

afterEach(() => {
  resetRateLimits();
});

afterAll(() => {
  resetDbCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["PLUGGY_WEBHOOK_SECRET"];
});

function request(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handlePluggyWebhookHandler", () => {
  it("rejects a missing/wrong secret when one is configured", async () => {
    process.env["PLUGGY_WEBHOOK_SECRET"] = "real-secret-value";
    const result = await handlePluggyWebhookHandler(
      request("http://localhost/api/webhook?secret=wrong", {
        event: "item/deleted",
        eventId: "evt-1",
        itemId: "item-1",
      }),
    );
    expect(result.status).toBe(401);
    delete process.env["PLUGGY_WEBHOOK_SECRET"];
  });

  it("accepts a matching secret and processes a known event honestly (no matching connection -> no-op, still 200)", async () => {
    process.env["PLUGGY_WEBHOOK_SECRET"] = "real-secret-value";
    const result = await handlePluggyWebhookHandler(
      request("http://localhost/api/webhook?secret=real-secret-value", {
        event: "item/deleted",
        eventId: "evt-2",
        itemId: "unknown-item-id",
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body["outcome"]).toBe("PROCESSED");
    delete process.env["PLUGGY_WEBHOOK_SECRET"];
  });

  it("processes normally when no secret is configured at all (matches apps/web's existing behavior)", async () => {
    const result = await handlePluggyWebhookHandler(
      request("http://localhost/api/webhook", {
        event: "item/deleted",
        eventId: "evt-3",
        itemId: "unknown-item-id",
      }),
    );
    expect(result.status).toBe(200);
  });

  it("rejects malformed JSON and missing required fields without crashing", async () => {
    const badJson = new Request("http://localhost/api/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect((await handlePluggyWebhookHandler(badJson)).status).toBe(400);

    const missingFields = await handlePluggyWebhookHandler(
      request("http://localhost/api/webhook", { foo: "bar" }),
    );
    expect(missingFields.status).toBe(400);
  });

  it("(N/redaction) is rate-limited as a provider callback, and never leaks a raw internal error message to the response body", async () => {
    for (let i = 0; i < 121; i++) {
      await handlePluggyWebhookHandler(
        request("http://localhost/api/webhook", {
          event: "item/deleted",
          eventId: `evt-flood-${i}`,
          itemId: "unknown-item-id",
        }),
      );
    }
    const overLimit = await handlePluggyWebhookHandler(
      request("http://localhost/api/webhook", {
        event: "item/deleted",
        eventId: "evt-flood-last",
        itemId: "unknown-item-id",
      }),
    );
    expect(overLimit.status).toBe(429);
    expect(JSON.stringify(overLimit.body)).not.toMatch(/at\s+\S+\.(ts|js):\d+/); // no stack-trace-shaped content
  });
});
