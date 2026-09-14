import { describe, expect, it } from "vitest";
import { resolveWebhookUrl } from "./webhook-url.server";

describe("resolveWebhookUrl (Sprint 9 Phase 6A, DEC-121)", () => {
  it("is undefined when no public base URL is configured — the current local-dev state", () => {
    expect(resolveWebhookUrl({ APP_ENV: "staging" })).toBeUndefined();
  });

  it("builds the real webhook URL with the secret once both are configured, in staging", () => {
    const url = resolveWebhookUrl({
      APP_ENV: "staging",
      BETTER_AUTH_URL: "https://ritmo-staging.up.railway.app",
      PLUGGY_WEBHOOK_SECRET: "real-secret-value",
    });
    expect(url).toBe("https://ritmo-staging.up.railway.app/api/webhook?secret=real-secret-value");
  });

  it("builds the real webhook URL in production too", () => {
    const url = resolveWebhookUrl({
      APP_ENV: "production",
      BETTER_AUTH_URL: "https://ritmo.example.com",
      PLUGGY_WEBHOOK_SECRET: "real-secret-value",
    });
    expect(url).toBe("https://ritmo.example.com/api/webhook?secret=real-secret-value");
  });

  it("still builds a URL (without a secret param) if the webhook secret isn't configured", () => {
    const url = resolveWebhookUrl({
      APP_ENV: "staging",
      BETTER_AUTH_URL: "https://ritmo-staging.up.railway.app",
    });
    expect(url).toBe("https://ritmo-staging.up.railway.app/api/webhook");
  });

  it("never appears malformed for a base URL with a trailing slash", () => {
    const url = resolveWebhookUrl({
      APP_ENV: "staging",
      BETTER_AUTH_URL: "https://ritmo-staging.up.railway.app/",
      PLUGGY_WEBHOOK_SECRET: "real-secret-value",
    });
    expect(url).toBe("https://ritmo-staging.up.railway.app/api/webhook?secret=real-secret-value");
  });

  describe("Founder Local Live Bank Pilot — webhook URL must stay omitted", () => {
    it("is undefined in development even if BETTER_AUTH_URL is (accidentally) set", () => {
      const url = resolveWebhookUrl({
        APP_ENV: "development",
        BETTER_AUTH_URL: "https://ritmo-staging.up.railway.app",
        PLUGGY_WEBHOOK_SECRET: "real-secret-value",
      });
      expect(url).toBeUndefined();
    });

    it("is undefined in test even if BETTER_AUTH_URL is (accidentally) set", () => {
      const url = resolveWebhookUrl({
        APP_ENV: "test",
        BETTER_AUTH_URL: "https://ritmo-staging.up.railway.app",
      });
      expect(url).toBeUndefined();
    });

    it("is undefined with no APP_ENV set at all (defaults to development)", () => {
      const url = resolveWebhookUrl({ BETTER_AUTH_URL: "https://ritmo-staging.up.railway.app" });
      expect(url).toBeUndefined();
    });
  });
});
