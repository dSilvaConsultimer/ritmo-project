import { describe, expect, it } from "vitest";
import {
  assertDevOnlyFlagNotInProduction,
  EnvironmentConfigError,
  isProductionEnvironment,
  requireEnv,
  resolveAppEnvironment,
} from "./env";

describe("resolveAppEnvironment", () => {
  it("defaults to development when nothing is set", () => {
    expect(resolveAppEnvironment({})).toBe("development");
  });

  it("APP_ENV is authoritative, including the staging value NODE_ENV has no equivalent for", () => {
    expect(resolveAppEnvironment({ APP_ENV: "staging" })).toBe("staging");
    expect(resolveAppEnvironment({ APP_ENV: "production", NODE_ENV: "development" })).toBe(
      "production",
    );
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveAppEnvironment({ APP_ENV: " PRODUCTION " })).toBe("production");
  });

  it("falls back to the conventional NODE_ENV values when APP_ENV is unset", () => {
    expect(resolveAppEnvironment({ NODE_ENV: "production" })).toBe("production");
    expect(resolveAppEnvironment({ NODE_ENV: "test" })).toBe("test");
  });

  it("ignores an unrecognized APP_ENV value rather than trusting it", () => {
    expect(resolveAppEnvironment({ APP_ENV: "prod" })).toBe("development");
  });
});

describe("isProductionEnvironment", () => {
  it("reflects the resolved environment", () => {
    expect(isProductionEnvironment({ APP_ENV: "production" })).toBe(true);
    expect(isProductionEnvironment({ APP_ENV: "staging" })).toBe(false);
    expect(isProductionEnvironment({})).toBe(false);
  });
});

describe("requireEnv", () => {
  it("returns the value when present and non-empty", () => {
    expect(requireEnv("X", { X: "value" })).toBe("value");
  });

  it("throws EnvironmentConfigError when missing or blank, never returning an empty string as if set", () => {
    expect(() => requireEnv("X", {})).toThrow(EnvironmentConfigError);
    expect(() => requireEnv("X", { X: "" })).toThrow(EnvironmentConfigError);
    expect(() => requireEnv("X", { X: "   " })).toThrow(EnvironmentConfigError);
  });
});

describe("assertDevOnlyFlagNotInProduction", () => {
  it("fails closed when the flag is true in production", () => {
    expect(() =>
      assertDevOnlyFlagNotInProduction("DEV_AUTH_BYPASS", {
        APP_ENV: "production",
        DEV_AUTH_BYPASS: "true",
      }),
    ).toThrow(EnvironmentConfigError);
  });

  it("allows the flag outside production", () => {
    expect(() =>
      assertDevOnlyFlagNotInProduction("DEV_AUTH_BYPASS", {
        APP_ENV: "development",
        DEV_AUTH_BYPASS: "true",
      }),
    ).not.toThrow();
  });

  it("is a no-op in production when the flag is unset or false", () => {
    expect(() =>
      assertDevOnlyFlagNotInProduction("DEV_AUTH_BYPASS", { APP_ENV: "production" }),
    ).not.toThrow();
    expect(() =>
      assertDevOnlyFlagNotInProduction("DEV_AUTH_BYPASS", {
        APP_ENV: "production",
        DEV_AUTH_BYPASS: "false",
      }),
    ).not.toThrow();
  });
});
