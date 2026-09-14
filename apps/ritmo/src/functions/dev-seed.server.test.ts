import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Sprint 9 Phase 4 fix-up — permanent regression coverage for the local
 * dev-only test login (docs/DECISIONS.md DEC-104), brief §10 items G, H, I,
 * J. Same real-Better-Auth-session pattern as `security.adversarial.test.ts`
 * and `connections.server.test.ts`.
 */
let currentHeaders: Headers = new Headers();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => currentHeaders,
}));

import { convertSetCookieToCookie } from "better-auth/test";
import {
  getDb,
  resetDbCache,
  getConnections,
  getFinancialPosition,
} from "@money-copilot/app-services";
import { getAuth } from "./auth.server";
import { checkAuthenticatedHandler } from "./session.server";
import { getCurrentProfileContext } from "./profile.server";
import {
  DEV_TEST_USER,
  DevSeedProductionRefusalError,
  ensureDevTestUserHandler,
} from "./dev-seed.server";

let tmpDir: string;

beforeAll(async () => {
  delete process.env["DEV_AUTH_BYPASS"];
  delete process.env["APP_ENV"];
  resetDbCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-dev-seed-"));
  process.env["MONEY_COPILOT_DB_PATH"] = path.join(tmpDir, "test.pglite");
  await getDb();
});

afterAll(() => {
  delete process.env["APP_ENV"];
  resetDbCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("ensureDevTestUserHandler (Sprint 9 Phase 4 fix-up, DEC-104)", () => {
  it("(G) is idempotent — a second call for the same account never errors, and never creates a duplicate", async () => {
    const first = await ensureDevTestUserHandler();
    expect(first.created).toBe(true);

    const second = await ensureDevTestUserHandler();
    expect(second.created).toBe(false);
  });

  it("(H) refuses to run outside development/test — staging", async () => {
    process.env["APP_ENV"] = "staging";
    await expect(ensureDevTestUserHandler()).rejects.toBeInstanceOf(DevSeedProductionRefusalError);
    delete process.env["APP_ENV"];
  });

  it("(H) refuses to run outside development/test — production", async () => {
    process.env["APP_ENV"] = "production";
    await expect(ensureDevTestUserHandler()).rejects.toBeInstanceOf(DevSeedProductionRefusalError);
    delete process.env["APP_ENV"];
  });

  it("(I) the provisioned account uses the REAL Better Auth sign-in path and gets an empty, non-fixture profile", async () => {
    await ensureDevTestUserHandler();

    const auth = await getAuth();
    const response = await auth.api.signInEmail({
      body: { email: DEV_TEST_USER.email, password: DEV_TEST_USER.password },
      asResponse: true,
    });
    expect(response.status, "real sign-in with the real password should succeed").toBeLessThan(400);

    const setCookieHeaders = new Headers();
    response.headers.forEach((value, name) => {
      if (name.toLowerCase() === "set-cookie") setCookieHeaders.append("set-cookie", value);
    });
    currentHeaders = await convertSetCookieToCookie(setCookieHeaders);

    const { authenticated } = await checkAuthenticatedHandler();
    expect(authenticated).toBe(true);

    const { financialProfileId } = await getCurrentProfileContext();
    const db = await getDb();
    const connections = await getConnections(db, financialProfileId);
    const position = await getFinancialPosition(db, financialProfileId, "2026-01-01");

    expect(connections).toEqual([]);
    expect(position.coverage).toBe("UNKNOWN");
  });

  it("(J) with DEV_AUTH_BYPASS unset (the default), an unauthenticated caller is never treated as authenticated", async () => {
    currentHeaders = new Headers();
    delete process.env["DEV_AUTH_BYPASS"];
    const { authenticated } = await checkAuthenticatedHandler();
    expect(authenticated).toBe(false);
  });

  it("(J) DEV_AUTH_BYPASS=true has no effect outside development/test — e.g. staging", async () => {
    currentHeaders = new Headers();
    process.env["DEV_AUTH_BYPASS"] = "true";
    process.env["APP_ENV"] = "staging";
    const { authenticated } = await checkAuthenticatedHandler();
    expect(authenticated).toBe(false);
    delete process.env["DEV_AUTH_BYPASS"];
    delete process.env["APP_ENV"];
  });
});
