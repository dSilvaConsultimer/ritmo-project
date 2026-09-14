import { describe, expect, it } from "vitest";
import { isFounderLiveBankPilotActive, resolveOpenFinanceMode } from "./open-finance-mode.server";

/**
 * Founder Local Live Bank Pilot — permanent test matrix (A, B, C, D below;
 * E–J live in connections.server.test.ts / webhook-url.server.test.ts /
 * apps/ritmo/scripts/check-client-bundle.mjs, one authoritative place per
 * concern). Every case here exercises `resolveOpenFinanceMode` purely by
 * passing an explicit env object — never mutates real `process.env`, so
 * this suite can never itself accidentally activate Live mode.
 */
describe("resolveOpenFinanceMode", () => {
  // A: default mode is sandbox.
  it("defaults to sandbox with no environment variables set at all", () => {
    expect(resolveOpenFinanceMode({})).toBe("sandbox");
  });

  it("is sandbox even in a plain development environment with nothing else set", () => {
    expect(resolveOpenFinanceMode({ APP_ENV: "development" })).toBe("sandbox");
  });

  // B: live requires explicit Founder pilot consent — all three flags together.
  it("resolves to live only when all three flags are set together", () => {
    expect(
      resolveOpenFinanceMode({
        APP_ENV: "development",
        OPEN_FINANCE_MODE: "live",
        FOUNDER_LIVE_BANK_PILOT: "true",
      }),
    ).toBe("live");
  });

  it("stays sandbox when only OPEN_FINANCE_MODE=live is set (missing the pilot flag)", () => {
    expect(resolveOpenFinanceMode({ APP_ENV: "development", OPEN_FINANCE_MODE: "live" })).toBe(
      "sandbox",
    );
  });

  it("stays sandbox when only FOUNDER_LIVE_BANK_PILOT=true is set (missing the mode flag)", () => {
    expect(
      resolveOpenFinanceMode({ APP_ENV: "development", FOUNDER_LIVE_BANK_PILOT: "true" }),
    ).toBe("sandbox");
  });

  it("never activates in staging or production regardless of the other two flags", () => {
    expect(
      resolveOpenFinanceMode({
        APP_ENV: "staging",
        OPEN_FINANCE_MODE: "live",
        FOUNDER_LIVE_BANK_PILOT: "true",
      }),
    ).toBe("sandbox");
    expect(
      resolveOpenFinanceMode({
        APP_ENV: "production",
        OPEN_FINANCE_MODE: "live",
        FOUNDER_LIVE_BANK_PILOT: "true",
      }),
    ).toBe("sandbox");
  });

  // D: live never activates in test simply because credentials/flags exist there.
  it("never activates in a test environment, even with both flags and real-looking credentials set", () => {
    expect(
      resolveOpenFinanceMode({
        APP_ENV: "test",
        OPEN_FINANCE_MODE: "live",
        FOUNDER_LIVE_BANK_PILOT: "true",
        PLUGGY_CLIENT_ID: "looks-real",
        PLUGGY_CLIENT_SECRET: "looks-real-too",
      }),
    ).toBe("sandbox");
  });

  // C: live cannot be activated via DEV_AUTH_BYPASS — this module never
  // reads that flag at all, so setting it can have no effect either way.
  it("ignores DEV_AUTH_BYPASS entirely — it plays no role in this decision", () => {
    expect(resolveOpenFinanceMode({ APP_ENV: "development", DEV_AUTH_BYPASS: "true" })).toBe(
      "sandbox",
    );
    expect(
      resolveOpenFinanceMode({
        APP_ENV: "development",
        DEV_AUTH_BYPASS: "true",
        OPEN_FINANCE_MODE: "live",
        FOUNDER_LIVE_BANK_PILOT: "true",
      }),
    ).toBe("live");
  });

  it("rejects near-miss values for either flag (case sensitivity, truthy-looking strings)", () => {
    expect(
      resolveOpenFinanceMode({
        APP_ENV: "development",
        OPEN_FINANCE_MODE: "Live",
        FOUNDER_LIVE_BANK_PILOT: "true",
      }),
    ).toBe("sandbox");
    expect(
      resolveOpenFinanceMode({
        APP_ENV: "development",
        OPEN_FINANCE_MODE: "live",
        FOUNDER_LIVE_BANK_PILOT: "1",
      }),
    ).toBe("sandbox");
  });
});

describe("isFounderLiveBankPilotActive", () => {
  it("mirrors resolveOpenFinanceMode", () => {
    expect(isFounderLiveBankPilotActive({})).toBe(false);
    expect(
      isFounderLiveBankPilotActive({
        APP_ENV: "development",
        OPEN_FINANCE_MODE: "live",
        FOUNDER_LIVE_BANK_PILOT: "true",
      }),
    ).toBe(true);
  });
});
