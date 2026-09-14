import { describe, expect, it } from "vitest";
import { isPreflightAccessAllowed, runPreflightChecks } from "./preflight.server";

describe("isPreflightAccessAllowed (Sprint 9 Phase 6A, DEC-118)", () => {
  it("is always allowed in development/test regardless of any secret", () => {
    expect(isPreflightAccessAllowed(null, {}, "development")).toBe(true);
    expect(isPreflightAccessAllowed(null, {}, "test")).toBe(true);
  });

  it("is unavailable in staging/production when PREFLIGHT_SECRET isn't configured, even with a header", () => {
    expect(isPreflightAccessAllowed("anything", {}, "production")).toBe(false);
    expect(isPreflightAccessAllowed(null, {}, "staging")).toBe(false);
  });

  it("requires an exact match once PREFLIGHT_SECRET is configured", () => {
    const env = { PREFLIGHT_SECRET: "real-value" };
    expect(isPreflightAccessAllowed("real-value", env, "production")).toBe(true);
    expect(isPreflightAccessAllowed("wrong-value", env, "production")).toBe(false);
    expect(isPreflightAccessAllowed(null, env, "production")).toBe(false);
  });
});

describe("runPreflightChecks (Sprint 9 Phase 5, DEC-113, brief §25.T/U)", () => {
  it("(T) is ok in development with nothing configured — nothing is required there", () => {
    const report = runPreflightChecks({}, "development");
    expect(report.ok).toBe(true);
    expect(report.findings.some((f) => f.level === "error")).toBe(false);
  });

  it("(T) catches every missing required staging/production variable as an ERROR", () => {
    const report = runPreflightChecks({}, "production");
    expect(report.ok).toBe(false);
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain("MISSING_DATABASE_URL");
    expect(codes).toContain("MISSING_DATABASE_DIRECT_URL");
    expect(codes).toContain("MISSING_BETTER_AUTH_SECRET");
    expect(codes).toContain("MISSING_BETTER_AUTH_URL");
  });

  it("(Phase 6A, DEC-119) DATABASE_DIRECT_URL is required even when the pooled DATABASE_URL is present — they are never interchangeable", () => {
    const report = runPreflightChecks(
      {
        DATABASE_URL: "postgres://user:pass@host/db",
        BETTER_AUTH_SECRET: "a-real-generated-secret-value",
        BETTER_AUTH_URL: "https://ritmo.example.com",
      },
      "production",
    );
    expect(report.findings.map((f) => f.code)).toContain("MISSING_DATABASE_DIRECT_URL");
  });

  const FULLY_VALID_PRODUCTION_ENV = {
    DATABASE_URL: "postgres://user:pass@pooled-host/db",
    DATABASE_DIRECT_URL: "postgres://user:pass@direct-host/db",
    BETTER_AUTH_SECRET: "a-real-generated-secret-value",
    BETTER_AUTH_URL: "https://ritmo.example.com",
    NODE_ENV: "production",
  };

  it("(T) is ok in production once every required variable is present and safe", () => {
    const report = runPreflightChecks(FULLY_VALID_PRODUCTION_ENV, "production");
    expect(report.findings.some((f) => f.level === "error")).toBe(false);
  });

  it("(T) treats DEV_AUTH_BYPASS=true in production as a hard ERROR, not a warning", () => {
    const report = runPreflightChecks(
      { ...FULLY_VALID_PRODUCTION_ENV, DEV_AUTH_BYPASS: "true" },
      "production",
    );
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.code)).toContain("DEV_AUTH_BYPASS_ENABLED");
  });

  it("(T) flags a localhost BETTER_AUTH_URL in production as unsafe", () => {
    const report = runPreflightChecks(
      { ...FULLY_VALID_PRODUCTION_ENV, BETTER_AUTH_URL: "http://localhost:3000" },
      "production",
    );
    expect(report.findings.map((f) => f.code)).toContain("UNSAFE_BASE_URL");
  });

  it("(16) missing transactional email is a WARNING, never a hard error — the app boots either way", () => {
    const report = runPreflightChecks(FULLY_VALID_PRODUCTION_ENV, "production");
    const emailFinding = report.findings.find((f) => f.code === "NO_TRANSACTIONAL_EMAIL_PROVIDER");
    expect(emailFinding?.level).toBe("warning");
    expect(report.ok).toBe(true); // a warning alone never fails preflight
  });

  it("(Phase 6A) is ok once Resend is fully configured — no email warning", () => {
    const report = runPreflightChecks(
      {
        ...FULLY_VALID_PRODUCTION_ENV,
        TRANSACTIONAL_EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "re_real_key_value",
        TRANSACTIONAL_EMAIL_FROM: "Ritmo <naoresponda@ritmo.example.com>",
      },
      "production",
    );
    expect(report.findings.some((f) => f.code === "NO_TRANSACTIONAL_EMAIL_PROVIDER")).toBe(false);
  });

  it("(Phase 6A) still warns when provider=resend but the API key or FROM address is missing", () => {
    const report = runPreflightChecks(
      { ...FULLY_VALID_PRODUCTION_ENV, TRANSACTIONAL_EMAIL_PROVIDER: "resend" },
      "production",
    );
    const emailFinding = report.findings.find((f) => f.code === "NO_TRANSACTIONAL_EMAIL_PROVIDER");
    expect(emailFinding?.level).toBe("warning");
  });

  it("(U) never prints a secret VALUE anywhere in the report, even when one is present", () => {
    const report = runPreflightChecks(
      {
        ...FULLY_VALID_PRODUCTION_ENV,
        DATABASE_URL: "postgres://user:s3cr3t-password@host/db",
        BETTER_AUTH_SECRET: "the-actual-secret-value-12345",
        RESEND_API_KEY: "re_do_not_leak_this",
      },
      "production",
    );
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("s3cr3t-password");
    expect(serialized).not.toContain("the-actual-secret-value-12345");
    expect(serialized).not.toContain("re_do_not_leak_this");
  });
});
