import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Sprint 9 — permanent direct-server-call adversarial suite.
 *
 * This is deliberately NOT a router/component test. It calls the exact
 * business-logic functions `apps/ritmo`'s server functions run —
 * `getCurrentProfileContext`, `checkAuthenticatedHandler`,
 * `sendAssistenteMessageHandler` — directly, with no TanStack Router, no
 * `beforeLoad`, no rendered UI, and no `createServerFn` transport wrapper
 * in between (that wrapper relies on a build-time code-splitting transform
 * that doesn't run under plain Vitest and carries no security logic of its
 * own — routing/transport only). This is exactly the threat model the
 * brief's authorization-boundary clarification describes: "a request is
 * handcrafted outside the Ritmo UI." If these pass, the security boundary
 * holds even when the UX-layer route guard (`_protected.tsx`'s
 * `beforeLoad`) is bypassed entirely.
 *
 * Session cookies are obtained by driving the REAL Better Auth instance's
 * `signUpEmail` API directly (no mocked auth), converting its real
 * `Set-Cookie` response headers into a `Cookie` request header via Better
 * Auth's own `better-auth/test` utility — the same mechanism a real browser
 * would produce. `getRequestHeaders` (normally backed by TanStack Start's
 * request-scoped AsyncLocalStorage, unavailable outside a live HTTP
 * request) is the only thing mocked, purely to hand these headers to code
 * that expects to read them off "the current request."
 */
let currentHeaders: Headers = new Headers();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => currentHeaders,
}));

import { convertSetCookieToCookie } from "better-auth/test";
import {
  getDb,
  resetDbCache,
  getOrCreateConversation,
  appendMessage,
  listMessagesForConversation,
} from "@money-copilot/app-services";
import { getAuth } from "./auth.server";
import { getCurrentProfileContext, UnauthenticatedError } from "./profile.server";
import { checkAuthenticatedHandler } from "./session.server";
import { sendAssistenteMessageHandler } from "./assistente.server";

let tmpDir: string;

beforeAll(async () => {
  delete process.env["DEV_AUTH_BYPASS"];
  resetDbCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-auth-adversarial-"));
  process.env["MONEY_COPILOT_DB_PATH"] = path.join(tmpDir, "test.pglite");
  await getDb();
});

afterAll(() => {
  resetDbCache();
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

describe("Sprint 9 — direct-server-call authorization boundary (bypassing router/beforeLoad)", () => {
  it("denies getCurrentProfileContext() with no session at all", async () => {
    currentHeaders = new Headers();
    await expect(getCurrentProfileContext()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("denies getCurrentProfileContext() with a forged/garbage session cookie", async () => {
    currentHeaders = new Headers({
      cookie: "better-auth.session_token=totally-forged-token-value",
    });
    await expect(getCurrentProfileContext()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("checkAuthenticatedHandler() (the beforeLoad UX check) agrees: unauthenticated for both cases above", async () => {
    currentHeaders = new Headers();
    await expect(checkAuthenticatedHandler()).resolves.toEqual({ authenticated: false });

    currentHeaders = new Headers({
      cookie: "better-auth.session_token=totally-forged-token-value",
    });
    await expect(checkAuthenticatedHandler()).resolves.toEqual({ authenticated: false });
  });

  it("(Sprint 9 Phase 4 fix-up, DEC-104, brief §10.F) logout (auth.api.signOut) really ends the session — checkAuthenticatedHandler reports unauthenticated again", async () => {
    const headers = await signUpAndGetSessionHeaders(
      "adversarial-logout@ritmo-test.invalid",
      "correct-horse-battery-staple-logout",
      "Adversarial Logout Test",
    );
    currentHeaders = headers;
    await expect(checkAuthenticatedHandler()).resolves.toEqual({ authenticated: true });

    const auth = await getAuth();
    await auth.api.signOut({ headers: currentHeaders });

    await expect(checkAuthenticatedHandler()).resolves.toEqual({ authenticated: false });
    await expect(getCurrentProfileContext()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("resolves distinct, stable FinancialProfile ids for two real, independently signed-up users", async () => {
    const aHeaders = await signUpAndGetSessionHeaders(
      "adversarial-a@ritmo-test.invalid",
      "correct-horse-battery-staple-a",
      "Adversarial Test User A",
    );
    const bHeaders = await signUpAndGetSessionHeaders(
      "adversarial-b@ritmo-test.invalid",
      "correct-horse-battery-staple-b",
      "Adversarial Test User B",
    );

    currentHeaders = aHeaders;
    await expect(checkAuthenticatedHandler()).resolves.toEqual({ authenticated: true });
    const contextA1 = await getCurrentProfileContext();
    const contextA2 = await getCurrentProfileContext();
    expect(contextA2.financialProfileId).toBe(contextA1.financialProfileId);

    currentHeaders = bHeaders;
    const contextB = await getCurrentProfileContext();

    expect(contextB.financialProfileId).not.toBe(contextA1.financialProfileId);
  });

  it("never lets one profile's session read or mutate another profile's conversation via sendAssistenteMessage", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-adversarial-dummy-key-never-actually-called";

    const aHeaders = await signUpAndGetSessionHeaders(
      "adversarial-c@ritmo-test.invalid",
      "correct-horse-battery-staple-c",
      "Adversarial Test User C",
    );
    const bHeaders = await signUpAndGetSessionHeaders(
      "adversarial-d@ritmo-test.invalid",
      "correct-horse-battery-staple-d",
      "Adversarial Test User D",
    );

    currentHeaders = bHeaders;
    const { financialProfileId: profileB } = await getCurrentProfileContext();
    const db = await getDb();
    const conversationB = await getOrCreateConversation(db, profileB);
    await appendMessage(db, profileB, conversationB.id, "USER", "Segredo do perfil B.");
    await appendMessage(db, profileB, conversationB.id, "ASSISTANT", "Resposta secreta para B.");
    const messagesBeforeAttack = await listMessagesForConversation(db, profileB, conversationB.id);

    // User C (attacker) forges a request for User D's real conversationId —
    // exactly the "guessed/handcrafted resource id" scenario the brief
    // requires permanent regression coverage for.
    currentHeaders = aHeaders;
    const result = await sendAssistenteMessageHandler({
      conversationId: conversationB.id,
      message: "Tentativa de sequestro de conversa alheia.",
    });

    expect(result.ok).toBe(false);

    const messagesAfterAttack = await listMessagesForConversation(db, profileB, conversationB.id);
    expect(messagesAfterAttack).toHaveLength(messagesBeforeAttack.length);
    expect(messagesAfterAttack.every((m) => !m.content.includes("sequestro"))).toBe(true);
  });
});
