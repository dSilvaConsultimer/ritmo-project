import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProviderError } from "@money-copilot/financial-engine";
import { getPluggyClient, resetPluggyClientCache } from "./client";

const ORIGINAL_ENV = { ...process.env };

describe("getPluggyClient — server-side-only configuration", () => {
  beforeEach(() => {
    resetPluggyClientCache();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetPluggyClientCache();
  });

  it("throws a clear INVALID_CONFIGURATION error when credentials are missing", () => {
    delete process.env["PLUGGY_CLIENT_ID"];
    delete process.env["PLUGGY_CLIENT_SECRET"];

    expect(() => getPluggyClient()).toThrow(ProviderError);
    try {
      getPluggyClient();
      throw new Error("expected getPluggyClient to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe("INVALID_CONFIGURATION");
    }
  });

  it("constructs a client once credentials are present, and never requires them again per call (single instance reused)", () => {
    process.env["PLUGGY_CLIENT_ID"] = "fixture-client-id";
    process.env["PLUGGY_CLIENT_SECRET"] = "fixture-client-secret";

    const first = getPluggyClient();
    const second = getPluggyClient();
    // Reusing the same client instance is what lets the underlying SDK's
    // own API-key caching (an ~2h JWT) actually take effect across calls —
    // a fresh client per call would defeat that caching. See client.ts.
    expect(second).toBe(first);
  });

  it("constructs a new client after the cache is explicitly reset", () => {
    process.env["PLUGGY_CLIENT_ID"] = "fixture-client-id";
    process.env["PLUGGY_CLIENT_SECRET"] = "fixture-client-secret";

    const first = getPluggyClient();
    resetPluggyClientCache();
    const second = getPluggyClient();
    expect(second).not.toBe(first);
  });
});
