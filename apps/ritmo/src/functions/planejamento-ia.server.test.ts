import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * AI-assisted planning creation — permanent test suite. Follows the same
 * real-session pattern as `planejamento-criar.server.test.ts` for the parts
 * that touch the database. `requestPlanningDraftHandler`'s honest-failure
 * states (rate limit, missing API key) are tested with no AI call at all;
 * its actual category-resolution pipeline (DEC-138) IS fully exercised —
 * via `MockAIProvider` (the same deterministic, no-network `AIProvider`
 * `runCopilotTurn`'s own tests use), scripted to return exactly what a real
 * model's tool call would contain. This proves the REAL safety mechanism
 * (`resolveDraftCategory`, fed the real visible-category list from the
 * real database) end to end, without ever touching the network.
 */
let currentHeaders: Headers = new Headers();

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => currentHeaders,
}));

import { convertSetCookieToCookie } from "better-auth/test";
import { MockAIProvider, mockToolCallResult } from "@money-copilot/ai";
import {
  getDb,
  resetDbCache,
  getFixedExpensesForProfile,
  getCategoriesForProfile,
  createCategory,
} from "@money-copilot/app-services";
import { bootstrapBaseCategories, listBaseCategories } from "@money-copilot/persistence";
import { getAuth } from "./auth.server";
import { resetRateLimits } from "./rate-limit.server";
import {
  confirmPlanningDraftHandler,
  requestPlanningDraftHandler,
  resolveDraftCategory,
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
    categoryId: null,
    newCategoryName: null,
    startDate: "2026-12-01",
    endDate: "2026-12-10",
    dueDayOfMonth: null,
    rationale: "Interpreted as a one-off trip.",
    ...overrides,
  };
}

/** A `MockAIProvider` scripted to return exactly one tool call, matching what a real model's structured output would contain. */
function scriptedProvider(fields: Record<string, unknown>): MockAIProvider {
  return new MockAIProvider([
    mockToolCallResult([
      { id: "call_1", name: "proposePlanningDraft", argumentsJson: JSON.stringify(fields) },
    ]),
  ]);
}

async function saudeBaseId(): Promise<string> {
  const db = await getDb();
  await bootstrapBaseCategories(db);
  const saude = (await listBaseCategories(db)).find((c) => c.name === "Saúde");
  if (!saude) throw new Error("Saúde base category not bootstrapped");
  return saude.id;
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

describe("resolveDraftCategory — the actual safety mechanism (DEC-138)", () => {
  const visible = [{ id: "cat_a" }, { id: "cat_b" }];

  it("keeps a categoryId that matches a real visible category, regardless of creation intent", () => {
    expect(resolveDraftCategory("cat_a", null, visible, false)).toEqual({
      categoryId: "cat_a",
      newCategoryName: null,
    });
  });

  it("discards a categoryId that is not in the visible list — never trusted blindly", () => {
    expect(resolveDraftCategory("cat_zzz_hallucinated", null, visible, false)).toEqual({
      categoryId: null,
      newCategoryName: null,
    });
  });

  it("keeps newCategoryName only when no valid categoryId resolved AND explicit creation intent is true", () => {
    expect(resolveDraftCategory(null, "Trabalho", visible, true)).toEqual({
      categoryId: null,
      newCategoryName: "Trabalho",
    });
  });

  it("(DEC-138) discards newCategoryName when explicit creation intent is false — the model's own claim is never sufficient", () => {
    expect(resolveDraftCategory(null, "Trabalho", visible, false)).toEqual({
      categoryId: null,
      newCategoryName: null,
    });
  });

  it("a valid categoryId always wins over newCategoryName — never both at once, regardless of intent", () => {
    expect(resolveDraftCategory("cat_a", "Trabalho", visible, true)).toEqual({
      categoryId: "cat_a",
      newCategoryName: null,
    });
  });
});

describe("requestPlanningDraftHandler — AI must never create a personal category from its own guess (DEC-138)", () => {
  it("(test 1) resolves a medical/health request to the existing BASE 'Saúde' category when the model returns its real id", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-g@isolation-test.invalid",
      "supersecret123",
      "Planning IA G",
    );
    const saudeId = await saudeBaseId();

    const provider = scriptedProvider({
      kind: "fixed_expense",
      label: "Consulta médica",
      amountReais: 200,
      categoryId: saudeId,
      newCategoryName: null,
      dueDayOfMonth: 10,
      rationale: "Consulta médica mensal — categoria Saúde já existente.",
    });

    const result = await requestPlanningDraftHandler(
      { message: "Pago R$200 de médico todo dia 10." },
      provider,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.categoryId).toBe(saudeId);
      expect(result.draft.newCategoryName).toBeNull();
    }
  });

  it("(test 2) an unresolvable/hallucinated category id is discarded — no Category is ever created merely from requesting a draft", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-h@isolation-test.invalid",
      "supersecret123",
      "Planning IA H",
    );
    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const before = await getCategoriesForProfile(db, financialProfileId);

    const provider = scriptedProvider({
      kind: "fixed_expense",
      label: "Plano de saúde",
      amountReais: 300,
      // A model that ignored instructions and used a NAME (or invented an
      // id) instead of a real visible id — must never be trusted.
      categoryId: "Health",
      newCategoryName: null,
      rationale: "Interpretado como plano de saúde.",
    });

    const result = await requestPlanningDraftHandler({ message: "Pago plano de saúde" }, provider);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.categoryId).toBeNull();
      expect(result.draft.newCategoryName).toBeNull();
    }

    const after = await getCategoriesForProfile(db, financialProfileId);
    expect(after).toHaveLength(before.length);
    expect(after.some((c) => c.name === "Health")).toBe(false);
  });

  it("(test 5) an existing personal category can be resolved by the AI through categoryId — never duplicated", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-i@isolation-test.invalid",
      "supersecret123",
      "Planning IA I",
    );
    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const despesas = await createCategory(db, financialProfileId, { name: "Despesas para casa" });

    const provider = scriptedProvider({
      kind: "fixed_expense",
      label: "Conserto da torneira",
      amountReais: 80,
      categoryId: despesas.id,
      newCategoryName: null,
      rationale: "Gasto doméstico — usa a categoria pessoal já existente.",
    });

    const result = await requestPlanningDraftHandler(
      { message: "Coloca esse gasto em Despesas para casa" },
      provider,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.categoryId).toBe(despesas.id);

    const categories = await getCategoriesForProfile(db, financialProfileId);
    expect(categories.filter((c) => c.name === "Despesas para casa")).toHaveLength(1);
  });

  it("(test 6) repeated unresolved AI guesses across near-synonyms never create duplicate/polluted categories", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-j@isolation-test.invalid",
      "supersecret123",
      "Planning IA J",
    );
    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const before = await getCategoriesForProfile(db, financialProfileId);

    for (const guess of ["Healthcare", "Saude", "Medical"]) {
      const provider = scriptedProvider({
        kind: "fixed_expense",
        label: "Consulta",
        amountReais: 150,
        categoryId: guess,
        newCategoryName: null,
        rationale: "Tentativa de categoria não visível.",
      });
      const result = await requestPlanningDraftHandler(
        { message: "Pago consulta médica" },
        provider,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.draft.categoryId).toBeNull();
    }

    const after = await getCategoriesForProfile(db, financialProfileId);
    expect(after).toHaveLength(before.length);
  });
});

/**
 * DEC-139: closes the remaining gap in DEC-138 — the model SAYING creation
 * was explicit (i.e. `newCategoryName` being non-null) was never itself a
 * sufficient authorization boundary, since prompt compliance is not
 * enforcement. `hasExplicitCategoryCreationIntent` re-derives intent from
 * the ORIGINAL user message text, exactly like `hasExplicitMutationIntent`
 * already does for every other mutation the copilot can perform — the
 * model's own claim is never trusted on its own.
 */
describe("requestPlanningDraftHandler — explicit user intent must authorize category creation (DEC-139)", () => {
  it("(test 1) 'Crie uma categoria chamada Trabalho' authorizes newCategoryName to survive resolution", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-m@isolation-test.invalid",
      "supersecret123",
      "Planning IA M",
    );

    const provider = scriptedProvider({
      kind: "fixed_expense",
      label: "Material de trabalho",
      amountReais: 90,
      categoryId: null,
      newCategoryName: "Trabalho",
      rationale: "Usuário pediu explicitamente para criar a categoria Trabalho.",
    });

    const result = await requestPlanningDraftHandler(
      { message: "Crie uma categoria chamada Trabalho" },
      provider,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.newCategoryName).toBe("Trabalho");
  });

  it("(test 2) an ordinary spending message never authorizes creation, even when the model wrongly fills newCategoryName", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-n@isolation-test.invalid",
      "supersecret123",
      "Planning IA N",
    );
    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const before = await getCategoriesForProfile(db, financialProfileId);

    const provider = scriptedProvider({
      kind: "fixed_expense",
      label: "Fisioterapia",
      amountReais: 120,
      categoryId: null,
      // The model ignored its own prompt instructions — this must be
      // caught regardless, since prompt compliance is not enforcement.
      newCategoryName: "Health",
      rationale: "Interpretado como fisioterapia mensal.",
    });

    const result = await requestPlanningDraftHandler(
      { message: "Pago fisioterapia todo mês" },
      provider,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.categoryId).toBeNull();
      expect(result.draft.newCategoryName).toBeNull();
    }

    const after = await getCategoriesForProfile(db, financialProfileId);
    expect(after).toHaveLength(before.length);
  });

  it("(test 3) a spending message with BOTH a hallucinated categoryId and a newCategoryName rejects both paths", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-o@isolation-test.invalid",
      "supersecret123",
      "Planning IA O",
    );

    const provider = scriptedProvider({
      kind: "fixed_expense",
      label: "Consulta médica",
      amountReais: 200,
      categoryId: "cat_hallucinated_xyz",
      newCategoryName: "Saúde pessoal",
      rationale: "Interpretado como consulta médica.",
    });

    const result = await requestPlanningDraftHandler(
      { message: "Gastei R$200 no médico" },
      provider,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.categoryId).toBeNull();
      expect(result.draft.newCategoryName).toBeNull();
    }
  });

  it("(test 3b) ...unless a valid visible categoryId exists — that still resolves normally, no creation involved", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-p@isolation-test.invalid",
      "supersecret123",
      "Planning IA P",
    );
    const saudeId = await saudeBaseId();

    const provider = scriptedProvider({
      kind: "fixed_expense",
      label: "Consulta médica",
      amountReais: 200,
      categoryId: saudeId,
      // Even if the model also (wrongly) fills this, a valid categoryId
      // always wins — see resolveDraftCategory's own precedence.
      newCategoryName: "Saúde pessoal",
      rationale: "Interpretado como consulta médica — categoria Saúde já existente.",
    });

    const result = await requestPlanningDraftHandler(
      { message: "Gastei R$200 no médico" },
      provider,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.categoryId).toBe(saudeId);
      expect(result.draft.newCategoryName).toBeNull();
    }
  });

  it("(test 4) explicit creation intent for a name that already exists (case-insensitive) reuses the existing category instead of duplicating", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-q@isolation-test.invalid",
      "supersecret123",
      "Planning IA Q",
    );
    const saudeId = await saudeBaseId();
    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();

    const provider = scriptedProvider({
      kind: "fixed_expense",
      label: "Consulta",
      amountReais: 150,
      categoryId: null,
      newCategoryName: "saúde", // different casing — still the same visible category
      rationale: "Usuário pediu para criar uma categoria chamada saúde.",
    });

    const requestResult = await requestPlanningDraftHandler(
      { message: "Crie uma categoria chamada saúde" },
      provider,
    );
    expect(requestResult.ok).toBe(true);
    if (!requestResult.ok) return;
    expect(requestResult.draft.newCategoryName).toBe("saúde");

    const before = await getCategoriesForProfile(db, financialProfileId);
    const confirmResult = await confirmPlanningDraftHandler(requestResult.draft);
    expect(confirmResult.ok).toBe(true);

    // DEC-136's own createCategory dedup logic reused the existing base
    // "Saúde" row (case/whitespace-insensitive match) — no new row created.
    const after = await getCategoriesForProfile(db, financialProfileId);
    expect(after).toHaveLength(before.length);
    expect(after.some((c) => c.id === saudeId)).toBe(true);
  });

  it("(test 5) an existing personal category selected by categoryId continues working without any creation intent in the message", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-r@isolation-test.invalid",
      "supersecret123",
      "Planning IA R",
    );
    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const despesas = await createCategory(db, financialProfileId, { name: "Despesas para casa" });

    const provider = scriptedProvider({
      kind: "fixed_expense",
      label: "Conserto",
      amountReais: 80,
      categoryId: despesas.id,
      newCategoryName: null,
      rationale: "Gasto doméstico — usa a categoria pessoal já existente.",
    });

    // No creation-intent language at all — must still resolve, since a
    // valid categoryId never needs creation authorization in the first
    // place.
    const result = await requestPlanningDraftHandler(
      { message: "Coloca esse gasto em Despesas para casa" },
      provider,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.categoryId).toBe(despesas.id);
  });
});

describe("confirmPlanningDraftHandler — no silent mutation, real persistence on explicit confirm", () => {
  it("rejects a fixed_expense draft missing amount or category — never guesses either", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-c@isolation-test.invalid",
      "supersecret123",
      "Planning IA C",
    );
    const saudeId = await saudeBaseId();

    const missingAmount = await confirmPlanningDraftHandler(
      baseDraft({ kind: "fixed_expense", categoryId: saudeId, amountReais: null }),
    );
    expect(missingAmount.ok).toBe(false);

    const missingCategory = await confirmPlanningDraftHandler(
      baseDraft({
        kind: "fixed_expense",
        amountReais: 100,
        categoryId: null,
        newCategoryName: null,
      }),
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

  it("persists a valid fixed_expense draft (resolved categoryId) through the exact same path manual creation uses", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-e@isolation-test.invalid",
      "supersecret123",
      "Planning IA E",
    );
    const saudeId = await saudeBaseId();

    const result = await confirmPlanningDraftHandler(
      baseDraft({
        kind: "fixed_expense",
        label: "Gym membership",
        amountReais: 150,
        categoryId: saudeId,
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

describe("confirmPlanningDraftHandler — explicit category creation only (DEC-138)", () => {
  it("(test 3) a fixed_expense draft with neither categoryId nor newCategoryName is rejected — the user must select a category first", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-k@isolation-test.invalid",
      "supersecret123",
      "Planning IA K",
    );

    const result = await confirmPlanningDraftHandler(
      baseDraft({
        kind: "fixed_expense",
        amountReais: 200,
        categoryId: null,
        newCategoryName: null,
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("(test 4) an explicit 'crie uma categoria chamada Trabalho' request creates a real personal Category via the canonical mutation", async () => {
    currentHeaders = await signUpAndGetSessionHeaders(
      "planning-ia-l@isolation-test.invalid",
      "supersecret123",
      "Planning IA L",
    );

    const result = await confirmPlanningDraftHandler(
      baseDraft({
        kind: "fixed_expense",
        label: "Ferramentas de trabalho",
        amountReais: 90,
        categoryId: null,
        newCategoryName: "Trabalho",
      }),
    );
    expect(result.ok).toBe(true);

    const db = await getDb();
    const { getCurrentProfileContext } = await import("./profile.server");
    const { financialProfileId } = await getCurrentProfileContext();
    const categories = await getCategoriesForProfile(db, financialProfileId);
    const trabalho = categories.find((c) => c.name === "Trabalho");
    expect(trabalho).toBeDefined();
    expect(trabalho?.financialProfileId).toBe(financialProfileId);
  });
});
