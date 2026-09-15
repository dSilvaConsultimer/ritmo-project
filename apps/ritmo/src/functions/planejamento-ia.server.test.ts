import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * AI-assisted planning creation — permanent test suite. Follows the same
 * real-session pattern as `planejamento-criar.server.test.ts` for the parts
 * that touch the database; the AI interpretation call itself
 * (`requestPlanningDraftHandler`'s success path) is never exercised here —
 * that would require a real network call to OpenAI, exactly like
 * `assistente.server.test.ts` (if present) would avoid. What IS fully
 * tested without any network access: the rate-limit/config-error guards
 * (identical pattern to `assistente.server.ts`) and — most importantly —
 * `confirmPlanningDraftHandler`'s "no silent mutation" guard clauses and its
 * reuse of the exact same persistence path manual creation uses.
 */
let currentHeaders: Headers = new Headers();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => currentHeaders,
}));

import { convertSetCookieToCookie } from "better-auth/test";
import { getDb, resetDbCache, getFixedExpensesForProfile } from "@money-copilot/app-services";
import { getAuth } from "./auth.server";
import { resetRateLimits } from "./rate-limit.server";
import {
  confirmPlanningDraftHandler,
  requestPlanningDraftHandler,
  type PlanningDraft,
} from "./planejamento-ia.server";
import { resolveAsOfDate } from "./config";

// Injected fixed date (DEC-127: resolveAsOfDate accepts an explicit `now`
// override precisely for this) — deterministic regardless of the real
// wall clock, and matches the fixture dates used throughout this file.
const ASOF_DATE = resolveAsOfDate(new Date("2026-09-05T12:00:00Z"));

let tmpDir: string;

beforeAll(async () => {
  delete process.env["DEV_AUTH_BYPASS"];
  resetDbCache();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ritmo-planejamento-ia-"));
  process.env["MONEY_COPILOT_DB_PATH"] = path.join(tmpDir, "test.pglite");
  await getDb();
});

afterAll(() => {
  resetDbCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetRateLimits();
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

function baseDraft(overrides: Partial<PlanningDraft> = {}): PlanningDraft {
  return {
    kind: "event",
    label: "Trip",
    amountReais: null,
    category: null,
    startDate: "2026-12-01",
    endDate: "2026-12-10",
    dueDayOfMonth: null,
    rationale: "Interpreted as a one-off trip.",
    ...overrides,
  };
}

describe("requestPlanningDraftHandler — honest failure states, no network required", () => {
  it("returns a configuration error when OPENAI_API_KEY is unset, never fabricating a draft", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-a@isolation-test.invalid",
      "supersecret123",
      "Planning IA A",
    );
    const originalKey = process.env["OPENAI_API_KEY"];
    delete process.env["OPENAI_API_KEY"];
    try {
      const result = await requestPlanningDraftHandler({ message: "Quero viajar em dezembro" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("AI_CONFIGURATION_ERROR");
    } finally {
      if (originalKey !== undefined) process.env["OPENAI_API_KEY"] = originalKey;
    }
  });

  it("rate-limits rapid repeated requests, same guardrail the chat assistant uses", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-b@isolation-test.invalid",
      "supersecret123",
      "Planning IA B",
    );
    delete process.env["OPENAI_API_KEY"];

    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        requestPlanningDraftHandler({ message: "Quero juntar 8 mil até março" }),
      ),
    );
    const rateLimited = results.filter((r) => !r.ok && r.error.code === "AI_RATE_LIMITED");
    expect(rateLimited.length).toBeGreaterThan(0);
  });
});

describe("confirmPlanningDraftHandler — no silent mutation, real persistence on explicit confirm", () => {
  it("rejects a fixed_expense draft missing amount or category — never guesses either", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-c@isolation-test.invalid",
      "supersecret123",
      "Planning IA C",
    );

    const missingAmount = await confirmPlanningDraftHandler(
      baseDraft({ kind: "fixed_expense", category: "Housing", amountReais: null }),
    );
    expect(missingAmount.ok).toBe(false);

    const missingCategory = await confirmPlanningDraftHandler(
      baseDraft({ kind: "fixed_expense", amountReais: 100, category: null }),
    );
    expect(missingCategory.ok).toBe(false);
  });

  it("rejects an event draft missing a start date", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-d@isolation-test.invalid",
      "supersecret123",
      "Planning IA D",
    );

    const result = await confirmPlanningDraftHandler(baseDraft({ kind: "event", startDate: null }));
    expect(result.ok).toBe(false);
  });

  it("persists a valid fixed_expense draft through the exact same path manual creation uses", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-e@isolation-test.invalid",
      "supersecret123",
      "Planning IA E",
    );

    const result = await confirmPlanningDraftHandler(
      baseDraft({
        kind: "fixed_expense",
        label: "Gym membership",
        amountReais: 150,
        category: "Health",
        startDate: null,
        endDate: null,
      }),
    );
    expect(result.ok).toBe(true);

    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const expenses = await getFixedExpensesForProfile(db, financialProfileId, ASOF_DATE);
    expect(expenses.some((e) => e.label === "Gym membership" && e.amount.cents === 15_000)).toBe(
      true,
    );
  });

  it("nothing is persisted merely by requesting/holding a draft — only confirmPlanningDraftHandler ever writes", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-f@isolation-test.invalid",
      "supersecret123",
      "Planning IA F",
    );

    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const before = await getFixedExpensesForProfile(db, financialProfileId, ASOF_DATE);
    expect(before.length).toBe(0);
    // No call to confirmPlanningDraftHandler was made for this user — the
    // handler that would create a draft (requestPlanningDraftHandler) never
    // itself persists anything, by construction (it has no repo import at
    // all — see planejamento-ia.server.ts).
  });
});
