import { describe, expect, it } from "vitest";
import {
  buildForbiddenValues,
  FORBIDDEN_LITERAL_STRINGS,
  FORBIDDEN_PACKAGE_MARKERS,
  parseDotEnvValues,
  scanContentForViolations,
} from "./check-client-bundle.mjs";

describe("buildForbiddenValues (Sprint 9 Phase 3 fix-up, DEC-100)", () => {
  it("includes the Sprint 9 secret literal names even when no env vars are set locally", () => {
    const labels = buildForbiddenValues({}).map((v) => v.label);
    expect(labels).toContain("the literal string DATABASE_URL");
  });

  it("deliberately excludes a bare BETTER_AUTH_SECRET/BETTER_AUTH_URL name check — better-auth/react's own client bundle legitimately references both names itself", () => {
    const labels = buildForbiddenValues({}).map((v) => v.label);
    expect(labels).not.toContain("the literal string BETTER_AUTH_SECRET");
    expect(labels).not.toContain("the literal string BETTER_AUTH_URL");
  });

  it("includes real configured secret VALUES only when actually set locally", () => {
    const withSecret = buildForbiddenValues({ BETTER_AUTH_SECRET: "shh", DATABASE_URL: "postgres://x" });
    expect(withSecret.map((v) => v.label)).toContain("BETTER_AUTH_SECRET value");
    expect(withSecret.map((v) => v.label)).toContain("DATABASE_URL value");

    const withoutSecret = buildForbiddenValues({});
    expect(withoutSecret.map((v) => v.label)).not.toContain("BETTER_AUTH_SECRET value");
  });

  it("includes every server-only package/entry-point marker", () => {
    const values = buildForbiddenValues({});
    for (const marker of FORBIDDEN_PACKAGE_MARKERS) {
      expect(values).toContainEqual(marker);
    }
  });
});

describe("scanContentForViolations — precise about Better Auth (DEC-100)", () => {
  const forbidden = buildForbiddenValues({});

  it("flags server-only Better Auth entry points", () => {
    expect(scanContentForViolations('import x from "better-auth/adapters/drizzle"', forbidden)).toEqual([
      "server-only Better Auth Drizzle adapter (better-auth/adapters/drizzle)",
    ]);
    expect(scanContentForViolations('import x from "better-auth/tanstack-start"', forbidden)).toEqual([
      "server-only Better Auth TanStack Start cookie plugin (better-auth/tanstack-start)",
    ]);
  });

  it("does NOT flag the real client-safe Better Auth import the browser code uses", () => {
    expect(scanContentForViolations('import { createAuthClient } from "better-auth/react"', forbidden)).toEqual(
      [],
    );
  });

  it("flags the node-postgres driver via its own sub-dependency markers, not a bare 'pg' substring", () => {
    expect(scanContentForViolations('require("pg-protocol")', forbidden)).toEqual([
      'server-only Postgres driver "pg" (via its pg-protocol dependency)',
    ]);
    // Ordinary client-safe content that happens to contain the substring "pg" must never trip this.
    expect(scanContentForViolations("this.page.config.spg = 1;", forbidden)).toEqual([]);
  });

  it("flags known secret names and configured secret values", () => {
    const withValue = buildForbiddenValues({ DATABASE_URL: "postgres://real-connection-string" });
    expect(scanContentForViolations("const x = 'postgres://real-connection-string'", withValue)).toContain(
      "DATABASE_URL value",
    );
    expect(scanContentForViolations("process.env.DATABASE_URL", forbidden)).toContain(
      "the literal string DATABASE_URL",
    );
  });
});

describe("parseDotEnvValues", () => {
  it("extracts real values, skipping comments/blank lines/VITE_-prefixed public keys", () => {
    const values = parseDotEnvValues(
      [
        "# a comment",
        "",
        "BETTER_AUTH_SECRET=super-secret-value",
        'DATABASE_URL="postgres://user:pass@host/db"',
        "VITE_PUBLIC_FLAG=anything",
        "EMPTY=",
        "DEV_AUTH_BYPASS=true",
      ].join("\n"),
      ".env.local",
    );
    expect(values).toContainEqual({
      label: "raw .env.local value for BETTER_AUTH_SECRET",
      needle: "super-secret-value",
    });
    expect(values).toContainEqual({
      label: "raw .env.local value for DATABASE_URL",
      needle: "postgres://user:pass@host/db",
    });
    expect(values.some((v) => v.label.includes("VITE_PUBLIC_FLAG"))).toBe(false);
    expect(values.some((v) => v.label.includes("EMPTY"))).toBe(false);
    // A short value like "true" is an ordinary JS literal, not a meaningful
    // thing to search a whole bundle for — see MIN_SECRET_LENGTH.
    expect(values.some((v) => v.label.includes("DEV_AUTH_BYPASS"))).toBe(false);
  });
});

describe("FORBIDDEN_LITERAL_STRINGS (Sprint 9 Phase 5, DEC-114, brief §20/§25.Y)", () => {
  it("rejects the local dev test account's real credentials unconditionally, not gated on any env var", () => {
    const labels = buildForbiddenValues({}).map((v) => v.label);
    for (const { label } of FORBIDDEN_LITERAL_STRINGS) {
      expect(labels).toContain(label);
    }
  });

  it("flags the dev test credentials if they ever appeared in bundled content", () => {
    const forbidden = buildForbiddenValues({});
    expect(
      scanContentForViolations('const x = "teste@ritmo.local";', forbidden),
    ).toContain("the local dev test account email (teste@ritmo.local)");
    expect(scanContentForViolations('const y = "RitmoTeste123!";', forbidden)).toContain(
      "the local dev test account password (RitmoTeste123!)",
    );
  });
});
