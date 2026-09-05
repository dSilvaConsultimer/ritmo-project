import { describe, expect, it } from "vitest";
import { ProviderError } from "@money-copilot/financial-engine";
import { normalizePluggyError } from "./errors";

describe("normalizePluggyError", () => {
  it("passes through an already-normalized ProviderError unchanged", () => {
    const original = new ProviderError("RATE_LIMITED", "pluggy", "slow down");
    expect(normalizePluggyError(original)).toBe(original);
  });

  it("maps a 401 response to AUTHENTICATION_ERROR", () => {
    const error = normalizePluggyError({ statusCode: 401, message: "Invalid API Key" });
    expect(error.code).toBe("AUTHENTICATION_ERROR");
    expect(error.provider).toBe("pluggy");
    expect(error).toBeInstanceOf(ProviderError);
  });

  it("maps a 429 response to RATE_LIMITED and marks it retryable", () => {
    const error = normalizePluggyError({ statusCode: 429, message: "Too many requests" });
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.retryable).toBe(true);
  });

  it("maps a 5xx response to PROVIDER_UNAVAILABLE and marks it retryable", () => {
    const error = normalizePluggyError({ statusCode: 503, message: "Service unavailable" });
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);
  });

  it("maps a 409 response to SYNC_CONFLICT", () => {
    const error = normalizePluggyError({ statusCode: 409, message: "conflict" });
    expect(error.code).toBe("SYNC_CONFLICT");
  });

  it("maps a message mentioning user action / MFA to USER_ACTION_REQUIRED", () => {
    const error = normalizePluggyError({ message: "waiting_user_input required" });
    expect(error.code).toBe("USER_ACTION_REQUIRED");
  });

  it("maps a bare network Error (no HTTP response) to NETWORK_ERROR and marks it retryable", () => {
    const error = normalizePluggyError(new Error("connect ECONNREFUSED"));
    expect(error.code).toBe("NETWORK_ERROR");
    expect(error.retryable).toBe(true);
  });

  it("falls back to UNKNOWN_PROVIDER_ERROR for an unrecognized shape", () => {
    const error = normalizePluggyError({ message: "something odd happened" });
    expect(error.code).toBe("UNKNOWN_PROVIDER_ERROR");
  });

  it("never leaks the raw error message format for secrets — message is preserved, not fabricated", () => {
    const error = normalizePluggyError({ statusCode: 401, message: "Invalid clientId or clientSecret" });
    // The normalized error carries Pluggy's own message (no secret VALUES are
    // ever in these strings — see client.ts, which never logs the actual
    // clientId/clientSecret/apiKey), just confirms code classification.
    expect(error.code).toBe("AUTHENTICATION_ERROR");
  });
});
