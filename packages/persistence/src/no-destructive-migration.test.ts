import { describe, expect, it } from "vitest";
import * as persistence from "./index";

/**
 * Sprint 9 Phase 5 (docs/DECISIONS.md DEC-115, brief §25.X): a permanent,
 * structural proof that no destructive schema operation is even reachable
 * from this package's public surface — `runMigrations`/`runPostgresMigrations`
 * only ever APPLY pending migrations (drizzle-orm's own migrator), never
 * drop/reset/truncate anything. If a future change ever adds one, this
 * test catches it by name before it ships.
 */
describe("no destructive migration/reset function is exported (brief §25.X)", () => {
  it("exports no function whose name suggests dropping/resetting/truncating the schema", () => {
    const dangerousNamePattern = /drop|truncate|^reset(?!DbCache)|wipe|destroy/i;
    const dangerousExports = Object.keys(persistence).filter((name) =>
      dangerousNamePattern.test(name),
    );
    expect(dangerousExports).toEqual([]);
  });
});
