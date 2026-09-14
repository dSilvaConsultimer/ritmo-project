import { describe, expect, it } from "vitest";
import { shouldSeedDatabase, shouldUsePostgres } from "./db";

describe("shouldUsePostgres (Sprint 9, DEC-090)", () => {
  it("is true only for staging and production", () => {
    expect(shouldUsePostgres("staging")).toBe(true);
    expect(shouldUsePostgres("production")).toBe(true);
    expect(shouldUsePostgres("development")).toBe(false);
    expect(shouldUsePostgres("test")).toBe(false);
  });
});

describe("shouldSeedDatabase (Sprint 9, brief §31 — Founder fixture must never reach production)", () => {
  it("is true only for development and test", () => {
    expect(shouldSeedDatabase("development")).toBe(true);
    expect(shouldSeedDatabase("test")).toBe(true);
    expect(shouldSeedDatabase("staging")).toBe(false);
    expect(shouldSeedDatabase("production")).toBe(false);
  });

  it("is never true wherever shouldUsePostgres is true — no environment ever seeds a real Postgres database", () => {
    const environments = ["development", "test", "staging", "production"] as const;
    for (const environment of environments) {
      if (shouldUsePostgres(environment)) {
        expect(shouldSeedDatabase(environment)).toBe(false);
      }
    }
  });
});
