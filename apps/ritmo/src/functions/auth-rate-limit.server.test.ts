import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createDatabase, runMigrations, schema } from "@money-copilot/persistence";
import { shouldEnableAuthRateLimit } from "./auth.server";

/**
 * Sprint 9 Phase 5 — permanent proof that auth abuse protection is real,
 * not just configured (docs/DECISIONS.md DEC-108, brief §25.A). Builds a
 * throwaway Better Auth instance directly (same shape as `auth.server.ts`'s
 * `buildAuth()`, but with `rateLimit.enabled` forced `true` directly rather
 * than via `APP_ENV=staging`) — decoupled on purpose from
 * `resolveAppEnvironment()`/`getDb()`'s own environment-driven Postgres
 * selection (DEC-090/092), which this test has no real Postgres to satisfy.
 * `shouldEnableAuthRateLimit`'s own environment-selection logic is a
 * separate, pure, already-covered unit below.
 */
let tmpDir: string;
let db: Awaited<ReturnType<typeof createDatabase>>;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-auth-rate-limit-"));
  db = await createDatabase(path.join(tmpDir, "test.pglite"));
  await runMigrations(db);
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("shouldEnableAuthRateLimit (pure config decision)", () => {
  it("is enabled in staging and production, not development/test", () => {
    expect(shouldEnableAuthRateLimit("staging")).toBe(true);
    expect(shouldEnableAuthRateLimit("production")).toBe(true);
    expect(shouldEnableAuthRateLimit("development")).toBe(false);
    expect(shouldEnableAuthRateLimit("test")).toBe(false);
  });
});

describe("(A) Better Auth's built-in rate limiter actually fires when enabled", () => {
  it("eventually rejects rapid repeated sign-in attempts with a non-2xx response, without ever revealing whether the account exists", async () => {
    const auth = betterAuth({
      secret: "test-only-secret-not-used-for-anything-real",
      rateLimit: { enabled: true, storage: "memory" },
      database: drizzleAdapter(db, {
        provider: "pg",
        schema: {
          user: schema.user,
          session: schema.session,
          account: schema.account,
          verification: schema.verification,
        },
      }),
      emailAndPassword: { enabled: true },
    });

    // Sprint 9 note: Better Auth's rate-limit check is a router-level
    // `onRequest` hook that only runs for actual HTTP requests through
    // `auth.handler(request)` (exactly how `/api/auth/$` — the real
    // production entry point — invokes it) — NOT for direct `auth.api.*`
    // calls, which bypass that hook. Verified empirically: an earlier draft
    // of this test called `auth.api.signInEmail` directly and never
    // observed a 429 across 6 attempts.
    const attempts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const response = await auth.handler(
        new Request("http://localhost/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "no-such-account@ritmo-test.invalid",
            password: "irrelevant-password-value",
          }),
        }),
      );
      attempts.push(response.status);
    }

    // Every non-200 status is either the ordinary "invalid credentials"
    // response (safe, same for a real or fake email) or the rate limiter's
    // 429 — never a distinct "this account doesn't exist" signal, and at
    // least one of the later attempts must be the rate limiter itself.
    expect(attempts.some((status) => status === 429)).toBe(true);
    for (const status of attempts) {
      expect([401, 429]).toContain(status);
    }
  });
});
