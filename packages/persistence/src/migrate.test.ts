import { describe, expect, it } from "vitest";
import { EnvironmentConfigError } from "@money-copilot/config";
import { resolveMigrationConnectionString } from "./migrate";

/**
 * Sprint 9 Phase 6A (docs/DECISIONS.md DEC-119) — permanent proof that the
 * migration CLI reads a DIFFERENT variable than the running application
 * (`DATABASE_URL`, used by `@money-copilot/app-services`'s `initializeDb()`)
 * and fails closed, clearly, when that variable is absent — never silently
 * falling back to the pooled runtime URL.
 */
describe("resolveMigrationConnectionString (Sprint 9 Phase 6A, DEC-119)", () => {
  it("reads DATABASE_DIRECT_URL, not DATABASE_URL", () => {
    const env = {
      DATABASE_URL: "postgres://pooled-runtime-connection/db",
      DATABASE_DIRECT_URL: "postgres://direct-migration-connection/db",
    };
    expect(resolveMigrationConnectionString(env)).toBe("postgres://direct-migration-connection/db");
  });

  it("fails closed with a clear error when DATABASE_DIRECT_URL is missing, even if DATABASE_URL is set", () => {
    const env = { DATABASE_URL: "postgres://pooled-runtime-connection/db" };
    expect(() => resolveMigrationConnectionString(env)).toThrow(EnvironmentConfigError);
    expect(() => resolveMigrationConnectionString(env)).toThrow(/DATABASE_DIRECT_URL/);
  });

  it("fails closed when neither is set", () => {
    expect(() => resolveMigrationConnectionString({})).toThrow(EnvironmentConfigError);
  });
});
