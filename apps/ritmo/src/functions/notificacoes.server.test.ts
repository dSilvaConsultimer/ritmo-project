import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * "Notificações" screen — permanent adversarial/ownership suite, same
 * real-session pattern as `connections.server.test.ts`.
 */
let currentHeaders: Headers = new Headers();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => currentHeaders,
}));

import { convertSetCookieToCookie } from "better-auth/test";
import { getDb, resetDbCache } from "@money-copilot/app-services";
import { getAuth } from "./auth.server";
import { getNotificacoesDataHandler, updateNotificacoesHandler } from "./notificacoes.server";

let tmpDir: string;

beforeAll(async () => {
  delete process.env["DEV_AUTH_BYPASS"];
  resetDbCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-notificacoes-"));
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

describe("getNotificacoesDataHandler / updateNotificacoesHandler", () => {
  it("defaults to every category enabled, amounts allowed, no quiet hours for a brand-new profile", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "notif-a@isolation-test.invalid",
      "supersecret123",
      "Notif A",
    );
    const data = await getNotificacoesDataHandler();
    expect(data.inAppEnabled).toBe(true);
    expect(data.financialChangeEnabled).toBe(true);
    expect(data.privacyMode).toBe("AMOUNT_ALLOWED");
    expect(data.quietHoursStart).toBeNull();
  });

  it("updates only the single category toggled, leaving every other field untouched", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "notif-b@isolation-test.invalid",
      "supersecret123",
      "Notif B",
    );
    const updated = await updateNotificacoesHandler({ category: "CONCIERGE", enabled: false });
    expect(updated.conciergeEnabled).toBe(false);
    expect(updated.financialChangeEnabled).toBe(true);
    expect(updated.inAppEnabled).toBe(true);
  });

  it("sets and then explicitly clears quiet hours", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "notif-c@isolation-test.invalid",
      "supersecret123",
      "Notif C",
    );
    const withQuietHours = await updateNotificacoesHandler({
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
    });
    expect(withQuietHours.quietHoursStart).toBe("22:00");

    const cleared = await updateNotificacoesHandler({ quietHoursStart: null, quietHoursEnd: null });
    expect(cleared.quietHoursStart).toBeNull();
    expect(cleared.quietHoursEnd).toBeNull();
  });

  it("a second, independent user never sees the first user's preferences", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "notif-d@isolation-test.invalid",
      "supersecret123",
      "Notif D",
    );
    const data = await getNotificacoesDataHandler();
    // Real default state, unaffected by notif-b's/notif-c's changes above.
    expect(data.conciergeEnabled).toBe(true);
    expect(data.quietHoursStart).toBeNull();
  });
});
