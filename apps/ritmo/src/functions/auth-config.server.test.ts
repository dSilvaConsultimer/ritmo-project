import { describe, expect, it } from "vitest";
import { EnvironmentConfigError } from "@money-copilot/config";
import { resolveBetterAuthBaseURL, resolveBetterAuthSecret } from "./auth-config.server";

describe("resolveBetterAuthSecret (Sprint 9 Phase 3 fix-up, DEC-097)", () => {
  it("fails closed in staging/production when BETTER_AUTH_SECRET is missing — never an implicit default", () => {
    expect(() => resolveBetterAuthSecret("staging", {})).toThrow(EnvironmentConfigError);
    expect(() => resolveBetterAuthSecret("production", {})).toThrow(EnvironmentConfigError);
  });

  it("uses the real configured secret in staging/production when present", () => {
    expect(resolveBetterAuthSecret("staging", { BETTER_AUTH_SECRET: "real-secret" })).toBe(
      "real-secret",
    );
    expect(resolveBetterAuthSecret("production", { BETTER_AUTH_SECRET: "real-secret" })).toBe(
      "real-secret",
    );
  });

  it("falls back to an explicit, named dev-only secret in development/test when unset", () => {
    const devSecret = resolveBetterAuthSecret("development", {});
    const testSecret = resolveBetterAuthSecret("test", {});
    expect(devSecret).toBe(testSecret);
    expect(devSecret).toContain("dev-only-insecure");
  });

  it("still honors an explicitly configured secret in development/test", () => {
    expect(resolveBetterAuthSecret("development", { BETTER_AUTH_SECRET: "my-local-secret" })).toBe(
      "my-local-secret",
    );
  });
});

describe("resolveBetterAuthBaseURL (Sprint 9 Phase 3 fix-up, DEC-097)", () => {
  it("fails closed in staging/production when BETTER_AUTH_URL is missing", () => {
    expect(() => resolveBetterAuthBaseURL("staging", {})).toThrow(EnvironmentConfigError);
    expect(() => resolveBetterAuthBaseURL("production", {})).toThrow(EnvironmentConfigError);
  });

  it("uses the real configured base URL in staging/production when present", () => {
    expect(
      resolveBetterAuthBaseURL("production", { BETTER_AUTH_URL: "https://ritmo.example.com" }),
    ).toBe("https://ritmo.example.com");
  });

  it("is optional in development/test — undefined when unset, never throws", () => {
    expect(resolveBetterAuthBaseURL("development", {})).toBeUndefined();
    expect(resolveBetterAuthBaseURL("test", {})).toBeUndefined();
  });

  it("still honors an explicitly configured base URL in development/test", () => {
    expect(
      resolveBetterAuthBaseURL("development", { BETTER_AUTH_URL: "http://localhost:3000" }),
    ).toBe("http://localhost:3000");
  });
});
