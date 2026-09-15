import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Manual planning creation — permanent adversarial/ownership suite,
 * following the exact same real-session pattern as
 * `connections.server.test.ts`: a real Better Auth instance against a real
 * (temp file) PGlite database, independently signed-up users,
 * `getRequestHeaders` mocked to return whichever user's real session
 * cookie is "current." No mocked auth, no client-supplied
 * `financialProfileId` anywhere.
 */
let currentHeaders: Headers = new Headers();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => currentHeaders,
}));

import { convertSetCookieToCookie } from "better-auth/test";
import {
  getDb,
  resetDbCache,
  getFixedExpensesForProfile,
  getUpcomingFinancialEventsForProfile,
} from "@money-copilot/app-services";
import { getAuth } from "./auth.server";
import { createManualPlanningItemHandler } from "./planejamento-criar.server";
import { ASOF_DATE } from "./config";

let tmpDir: string;

beforeAll(async () => {
  delete process.env["DEV_AUTH_BYPASS"];
  resetDbCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-planejamento-criar-"));
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

describe("createManualPlanningItemHandler", () => {
  it("creates a recurring fixed expense with a real amount and category, immediately visible for the owner", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-a@isolation-test.invalid",
      "supersecret123",
      "Planning A",
    );

    const result = await createManualPlanningItemHandler({
      kind: "fixed_expense",
      label: "Internet",
      amountReais: 120,
      category: "Utilities",
    });
    expect(result.ok).toBe(true);

    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const expenses = await getFixedExpensesForProfile(db, financialProfileId, ASOF_DATE);
    expect(expenses.some((e) => e.label === "Internet" && e.amount.cents === 12_000)).toBe(true);
  });

  it("creates a one-off event with an honest UNKNOWN budget when no amount is given", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-b@isolation-test.invalid",
      "supersecret123",
      "Planning B",
    );

    const result = await createManualPlanningItemHandler({
      kind: "event",
      label: "Trip to the coast",
      startDate: "2026-12-01",
      endDate: "2026-12-10",
    });
    expect(result.ok).toBe(true);

    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const events = await getUpcomingFinancialEventsForProfile(db, financialProfileId, ASOF_DATE);
    const created = events.find((e) => e.event.label === "Trip to the coast");
    expect(created).toBeDefined();
    expect(created!.breakdown.unknownLabels.length).toBeGreaterThan(0);
  });

  it("creates a one-off event with a real confirmed budget when an amount is given", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-c@isolation-test.invalid",
      "supersecret123",
      "Planning C",
    );

    const result = await createManualPlanningItemHandler({
      kind: "event",
      label: "New phone",
      startDate: "2026-11-15",
      endDate: "2026-11-15",
      amountReais: 3500,
    });
    expect(result.ok).toBe(true);

    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const events = await getUpcomingFinancialEventsForProfile(db, financialProfileId, ASOF_DATE);
    const created = events.find((e) => e.event.label === "New phone");
    expect(created).toBeDefined();
    expect(created!.breakdown.futureConfirmed.cents).toBe(350_000);
  });

  it("a second, independent user never sees the first user's planning items", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-d@isolation-test.invalid",
      "supersecret123",
      "Planning D",
    );

    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const expenses = await getFixedExpensesForProfile(db, financialProfileId, ASOF_DATE);
    expect(expenses.some((e) => e.label === "Internet")).toBe(false);
  });
});
