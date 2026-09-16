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
  createCategory,
  getCategoriesForProfile,
} from "@money-copilot/app-services";
import { getAuth } from "./auth.server";
import { createManualPlanningItemHandler } from "./planejamento-criar.server";
import { resolveAsOfDate } from "./config";

// Injected fixed date (DEC-127: resolveAsOfDate accepts an explicit `now`
// override precisely for this) — deterministic regardless of the real
// wall clock, and matches the fixture dates used throughout this file.
const ASOF_DATE = resolveAsOfDate(new Date("2026-09-05T12:00:00Z"));

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

    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const category = await createCategory(db, financialProfileId, { name: "Utilities" });

    const result = await createManualPlanningItemHandler({
      kind: "fixed_expense",
      label: "Internet",
      amountReais: 120,
      categoryId: category.id,
    });
    expect(result.ok).toBe(true);

    const expenses = await getFixedExpensesForProfile(db, financialProfileId, ASOF_DATE);
    expect(expenses.some((e) => e.label === "Internet" && e.amount.cents === 12_000)).toBe(true);
  });

  it("rejects a fixed expense with no categoryId (a category is required, never optional free text)", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-cat-required@isolation-test.invalid",
      "supersecret123",
      "Planning Cat Required",
    );

    const result = await createManualPlanningItemHandler({
      kind: "fixed_expense",
      label: "Aluguel",
      amountReais: 1500,
    });
    expect(result.ok).toBe(false);
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

/**
 * DEC-137 (Issue A): a fixed-expense's category used to be a free-text
 * field that never touched the canonical `categories` table — a user
 * typing a new category name here saw it vanish from CategoryPicker/
 * Planning's filter/rule creation everywhere else, because no `Category`
 * row was ever created. `createManualPlanningItemHandler` now requires a
 * real `categoryId`, resolved through the exact same `requireVisibleCategory`
 * every other category-aware mutation uses.
 */
describe("createManualPlanningItemHandler — fixed-expense category is the canonical entity (DEC-137)", () => {
  it("a personal category created via the canonical mutation is immediately visible for its owner, and used verbatim on the expense", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-cat-a@isolation-test.invalid",
      "supersecret123",
      "Planning Cat A",
    );
    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();

    const category = await createCategory(db, financialProfileId, { name: "Despesas para casa" });

    const result = await createManualPlanningItemHandler({
      kind: "fixed_expense",
      label: "Condomínio",
      amountReais: 450,
      categoryId: category.id,
    });
    expect(result.ok).toBe(true);

    // The canonical row exists, belongs to THIS profile, and the
    // visible-category query (the same one CategoryPicker/Planning's
    // filter/rule creation all read) returns it immediately — no reload,
    // no separate re-fetch path needed.
    const visible = await getCategoriesForProfile(db, financialProfileId);
    const found = visible.find((c) => c.name === "Despesas para casa");
    expect(found).toBeDefined();
    expect(found?.id).toBe(category.id);
    expect(found?.financialProfileId).toBe(financialProfileId);

    // The expense's own (legacy/denormalized) category string matches the
    // canonical name exactly — never independently typed.
    const expenses = await getFixedExpensesForProfile(db, financialProfileId, ASOF_DATE);
    const created = expenses.find((e) => e.label === "Condomínio");
    expect(created?.category).toBe("Despesas para casa");
  });

  it("a fixed expense cannot be created for another profile's personal category (never leaks, never silently substitutes)", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-cat-b1@isolation-test.invalid",
      "supersecret123",
      "Planning Cat B1",
    );
    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const owner = await getCurrentProfileContext();
    const theirCategory = await createCategory(db, owner.financialProfileId, {
      name: "Só do dono",
    });

    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-cat-b2@isolation-test.invalid",
      "supersecret123",
      "Planning Cat B2",
    );
    const intruder = await getCurrentProfileContext();
    expect(intruder.financialProfileId).not.toBe(owner.financialProfileId);

    const visibleToIntruder = await getCategoriesForProfile(db, intruder.financialProfileId);
    expect(visibleToIntruder.some((c) => c.id === theirCategory.id)).toBe(false);

    const result = await createManualPlanningItemHandler({
      kind: "fixed_expense",
      label: "Tentativa cross-profile",
      amountReais: 100,
      categoryId: theirCategory.id,
    });
    expect(result.ok).toBe(false);
  });

  it("reusing an existing base category by id never creates a duplicate category row", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-cat-c@isolation-test.invalid",
      "supersecret123",
      "Planning Cat C",
    );
    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const { bootstrapBaseCategories, listBaseCategories } =
      await import("@money-copilot/persistence");
    await bootstrapBaseCategories(db);
    const moradia = (await listBaseCategories(db)).find((c) => c.name === "Moradia")!;

    const before = (await getCategoriesForProfile(db, financialProfileId)).length;
    const result = await createManualPlanningItemHandler({
      kind: "fixed_expense",
      label: "Aluguel",
      amountReais: 1800,
      categoryId: moradia.id,
    });
    expect(result.ok).toBe(true);
    const after = await getCategoriesForProfile(db, financialProfileId);
    expect(after).toHaveLength(before);
    expect(after.some((c) => c.id === moradia.id)).toBe(true);
  });
});
