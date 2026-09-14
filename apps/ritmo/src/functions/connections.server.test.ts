import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Sprint 9 Phase 4 — permanent adversarial/ownership suite for the
 * onboarding / Bank Connection server functions, following the exact same
 * real-session pattern as `security.adversarial.test.ts`: a real Better
 * Auth instance against a real (temp file) PGlite database, independently
 * signed-up users, `getRequestHeaders` mocked to return whichever user's
 * real session cookie is "current." No mocked auth, no client-supplied
 * `financialProfileId` anywhere — every handler below resolves it itself
 * via `getCurrentProfileContext()`. See docs/DECISIONS.md DEC-101, brief
 * §25 (A, B, C, D, E, J, K, O).
 */
let currentHeaders: Headers = new Headers();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => currentHeaders,
}));

import { convertSetCookieToCookie } from "better-auth/test";
import {
  getDb,
  resetDbCache,
  registerProvider,
  resetProviderRegistry,
} from "@money-copilot/app-services";
import { MockProvider } from "@money-copilot/open-finance";
import { getAuth } from "./auth.server";
import {
  getConnectionScreenDataHandler,
  startBankConnectionHandler,
  finishBankConnectionHandler,
  removeBankConnectionHandler,
  requestManualSyncHandler,
} from "./connections.server";

let tmpDir: string;

beforeAll(async () => {
  delete process.env["DEV_AUTH_BYPASS"];
  resetDbCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-connections-adversarial-"));
  process.env["MONEY_COPILOT_DB_PATH"] = path.join(tmpDir, "test.pglite");
  await getDb();
  registerProvider("pluggy", new MockProvider({ accounts: [], transactionsByAccount: new Map() }));
});

afterAll(() => {
  resetDbCache();
  resetProviderRegistry();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function signUpAndGetSessionHeaders(
  email: string,
  password: string,
  name: string,
): Promise<Headers> {
  const auth = await getAuth();
  const response = await auth.api.signUpEmail({
    body: { email, password, name },
    asResponse: true,
  });
  expect(response.status, `signUpEmail(${email}) should succeed`).toBeLessThan(400);

  const setCookieHeaders = new Headers();
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") setCookieHeaders.append("set-cookie", value);
  });
  return convertSetCookieToCookie(setCookieHeaders);
}

describe("Sprint 9 Phase 4 — onboarding / Bank Connection ownership", () => {
  it("(A, C, D) a real user: empty onboarding state, a real Connect Token, and duplicate-connect protection", async () => {
    const headersA = await signUpAndGetSessionHeaders(
      "phase4-a@isolation-test.invalid",
      "supersecret123",
      "User A",
    );
    currentHeaders = headersA;

    const before = await getConnectionScreenDataHandler();
    expect(before.hasAnyConnection).toBe(false);
    expect(before.coverage).toBe("UNKNOWN");
    expect(before.connections).toEqual([]);

    const tokenResult = await startBankConnectionHandler();
    expect(tokenResult.ok).toBe(true);

    const first = await finishBankConnectionHandler({ externalConnectionId: "phase4-item-A" });
    const second = await finishBankConnectionHandler({ externalConnectionId: "phase4-item-A" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.connection.id).toBe(first.connection.id);
    }

    const after = await getConnectionScreenDataHandler();
    expect(after.connections).toHaveLength(1);
    expect(after.hasAnyConnection).toBe(true);
  });

  it("(B, E) a second, independent user's own onboarding state never includes the first user's connection", async () => {
    const headersB = await signUpAndGetSessionHeaders(
      "phase4-b@isolation-test.invalid",
      "supersecret123",
      "User B",
    );
    currentHeaders = headersB;

    const dataB = await getConnectionScreenDataHandler();
    expect(dataB.hasAnyConnection).toBe(false);
    expect(dataB.connections).toEqual([]);
  });

  it("(J, K, O) a third user cannot disconnect another user's connection by guessing its id; the owner still can, and it refreshes to zero", async () => {
    const headersA = await signUpAndGetSessionHeaders(
      "phase4-a-2@isolation-test.invalid",
      "supersecret123",
      "User A2",
    );
    currentHeaders = headersA;
    await finishBankConnectionHandler({ externalConnectionId: "phase4-item-A2" });
    const dataA = await getConnectionScreenDataHandler();
    const connectionId = dataA.connections[0]!.id;

    const headersC = await signUpAndGetSessionHeaders(
      "phase4-c@isolation-test.invalid",
      "supersecret123",
      "User C",
    );
    currentHeaders = headersC;
    // No handler in this file accepts a financialProfileId argument at all
    // (brief §O) — ownership is resolved server-side from the session, so
    // the ONLY way this could leak is via the resource id itself, which
    // `assertOwnedByProfile` (Phase 2, DEC-093) rejects.
    const forgedAttempt = await removeBankConnectionHandler({ connectionId });
    expect(forgedAttempt.ok).toBe(false);

    currentHeaders = headersA;
    const survives = await getConnectionScreenDataHandler();
    expect(survives.connections.map((c) => c.id)).toContain(connectionId);

    const ownDisconnect = await removeBankConnectionHandler({ connectionId });
    expect(ownDisconnect.ok).toBe(true);

    const afterDisconnect = await getConnectionScreenDataHandler();
    expect(afterDisconnect.hasAnyConnection).toBe(false);
    expect(afterDisconnect.connections).toEqual([]);
  });
});

describe("Sprint 9 Phase 5 — Open Finance abuse protection (DEC-105, brief §25.E/F)", () => {
  it("(E) rapid repeated expensive actions (startBankConnection) are eventually rate-limited", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "phase5-of-action@isolation-test.invalid",
      "supersecret123",
      "Phase5 OF Action",
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, () => startBankConnectionHandler()),
    );
    const rateLimited = results.filter(
      (r) => !r.ok && (r as { error: { code: string } }).error.code === "RATE_LIMITED",
    );
    expect(rateLimited.length).toBeGreaterThan(0);
  });

  it("(F) normal Phase 4 SYNCING-style polling (well under the generous poll ceiling) is never blocked", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "phase5-of-poll@isolation-test.invalid",
      "supersecret123",
      "Phase5 OF Poll",
    );

    // Simulate ~15 polls — comfortably more than a real 1.5s-interval poll
    // would issue in the time a real sync takes, and still nowhere near the
    // 120/min poll ceiling.
    for (let i = 0; i < 15; i++) {
      const data = await getConnectionScreenDataHandler();
      expect(data.hasAnyConnection).toBe(false);
    }
  });
});

describe("Founder Local Live Bank Pilot — mode wiring and manual sync ownership (matrix D, E, H)", () => {
  it("(D) openFinanceMode is sandbox in the real automated test environment, never live just because Pluggy credentials are set", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "pilot-mode@isolation-test.invalid",
      "supersecret123",
      "Pilot Mode",
    );
    process.env["PLUGGY_CLIENT_ID"] = "looks-real";
    process.env["PLUGGY_CLIENT_SECRET"] = "looks-real-too";
    try {
      const data = await getConnectionScreenDataHandler();
      expect(data.openFinanceMode).toBe("sandbox");
    } finally {
      delete process.env["PLUGGY_CLIENT_ID"];
      delete process.env["PLUGGY_CLIENT_SECRET"];
    }
  });

  it("(H) a forged connectionId from another user cannot be manually synced — ownership resolves server-side only", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "pilot-sync-owner@isolation-test.invalid",
      "supersecret123",
      "Pilot Sync Owner",
    );
    await finishBankConnectionHandler({ externalConnectionId: "pilot-sync-item" });
    const owned = await getConnectionScreenDataHandler();
    const connectionId = owned.connections[0]!.id;

    currentHeaders = await signUpAndGetSessionHeaders(
      "pilot-sync-attacker@isolation-test.invalid",
      "supersecret123",
      "Pilot Sync Attacker",
    );
    const forged = await requestManualSyncHandler({ connectionId });
    expect(forged.ok).toBe(false);
  });

  it("(H) the real owner can request a manual sync for their own connection", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "pilot-sync-owner-2@isolation-test.invalid",
      "supersecret123",
      "Pilot Sync Owner 2",
    );
    await finishBankConnectionHandler({ externalConnectionId: "pilot-sync-item-2" });
    const owned = await getConnectionScreenDataHandler();
    const connectionId = owned.connections[0]!.id;

    const result = await requestManualSyncHandler({ connectionId });
    expect(result.ok).toBe(true);
  });
});
