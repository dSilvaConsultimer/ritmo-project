import { describe, expect, it } from "vitest";
import { fixtureProfile } from "@money-copilot/financial-engine";
import { OpenAIProvider, resolveOpenAIModel } from "@money-copilot/ai";
import { createDatabase, runMigrations, seed } from "@money-copilot/persistence";
import { runCopilotTurn } from "./orchestrator";
import { getSafeToSpend } from "../queries";

/**
 * OPT-IN live smoke test against the real OpenAI Responses API. Skipped
 * entirely (not failed) when `OPENAI_API_KEY` is not present in
 * `process.env` — this file is never part of the default deterministic
 * test suite (`pnpm test` with no key set exercises zero network calls).
 * See docs/AI-COPILOT.md, "Live OpenAI smoke test."
 *
 * Uses ONLY the seeded fixture data (never real personal bank data) in a
 * fresh in-memory database — never the persistent local dev DB file, so
 * running this never pollutes real local state with test conversations or
 * manual transactions.
 */
const OPENAI_API_KEY = process.env["OPENAI_API_KEY"];
const ASOF = "2026-09-05";
const MODEL = resolveOpenAIModel();

async function freshSeededDb() {
  const db = await createDatabase();
  await runMigrations(db);
  await seed(db);
  return db;
}

describe.skipIf(!OPENAI_API_KEY)("Live OpenAI smoke test (opt-in, requires OPENAI_API_KEY)", () => {
  it(
    "answers a basic message with a non-empty, grounded response",
    async () => {
      const db = await freshSeededDb();
      const provider = new OpenAIProvider({ apiKey: OPENAI_API_KEY!, model: MODEL });

      const response = await runCopilotTurn({
        db,
        financialProfileId: fixtureProfile.id,
        asOfDate: ASOF,
        userMessageText: "Oi! Você pode me ajudar com minhas finanças?",
        aiProvider: provider,
        model: MODEL,
      });

      expect(response.text.length).toBeGreaterThan(0);
      expect(response.groundingStatus).not.toBe("FAILED");
    },
    30_000,
  );

  it(
    "calls a real tool and grounds the Sprint 1-4 Safe-to-Spend regression value (217_111 cents) in PT-BR",
    async () => {
      const db = await freshSeededDb();
      const provider = new OpenAIProvider({ apiKey: OPENAI_API_KEY!, model: MODEL });

      const response = await runCopilotTurn({
        db,
        financialProfileId: fixtureProfile.id,
        asOfDate: ASOF,
        userMessageText: "Quanto posso gastar hoje sem prejudicar meu planejamento do mês?",
        aiProvider: provider,
        model: MODEL,
      });

      expect(response.toolExecutions.some((t) => t.status === "SUCCESS")).toBe(true);
      expect(response.groundingStatus).not.toBe("FAILED");
      const safeToSpend = await getSafeToSpend(db, fixtureProfile.id, ASOF);
      expect(safeToSpend.total.cents).toBe(217_111);
    },
    30_000,
  );

  it(
    "answers a specific affordability question (simulateExpense) in PT-BR without blocking the user",
    async () => {
      const db = await freshSeededDb();
      const provider = new OpenAIProvider({ apiKey: OPENAI_API_KEY!, model: MODEL });

      const response = await runCopilotTurn({
        db,
        financialProfileId: fixtureProfile.id,
        asOfDate: ASOF,
        userMessageText: "Posso gastar R$ 500 hoje num jantar?",
        aiProvider: provider,
        model: MODEL,
      });

      expect(response.toolExecutions.some((t) => t.name === "simulateExpense" && t.status === "SUCCESS")).toBe(
        true,
      );
      expect(response.groundingStatus).not.toBe("FAILED");
    },
    30_000,
  );

  it(
    "does NOT record a transaction for hypothetical PT-BR language ('E se eu gastasse...')",
    async () => {
      const db = await freshSeededDb();
      const provider = new OpenAIProvider({ apiKey: OPENAI_API_KEY!, model: MODEL });
      const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);

      await runCopilotTurn({
        db,
        financialProfileId: fixtureProfile.id,
        asOfDate: ASOF,
        userMessageText: "E se eu gastasse R$ 250 no Restaurante X? Ainda estaria seguro?",
        aiProvider: provider,
        model: MODEL,
      });

      const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
      expect(after.total.cents).toBe(before.total.cents);
    },
    30_000,
  );

  it(
    "DOES record a transaction for explicit PT-BR language ('Gastei...') and reflects it immediately",
    async () => {
      const db = await freshSeededDb();
      const provider = new OpenAIProvider({ apiKey: OPENAI_API_KEY!, model: MODEL });
      const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);

      const response = await runCopilotTurn({
        db,
        financialProfileId: fixtureProfile.id,
        asOfDate: ASOF,
        userMessageText: "Acabei de gastar R$ 250 no Restaurante X.",
        aiProvider: provider,
        model: MODEL,
      });

      expect(
        response.toolExecutions.some((t) => t.name === "recordManualTransaction" && t.status === "SUCCESS"),
      ).toBe(true);
      const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
      expect(after.total.cents).toBe(before.total.cents - 25_000);
    },
    30_000,
  );

  it(
    "answers the independent-living question via getLifestyleComparison, in PT-BR",
    async () => {
      const db = await freshSeededDb();
      const provider = new OpenAIProvider({ apiKey: OPENAI_API_KEY!, model: MODEL });

      const response = await runCopilotTurn({
        db,
        financialProfileId: fixtureProfile.id,
        asOfDate: ASOF,
        userMessageText: "Estou financeiramente pronto para morar sozinho?",
        aiProvider: provider,
        model: MODEL,
      });

      expect(
        response.toolExecutions.some((t) => t.name === "getLifestyleComparison" && t.status === "SUCCESS"),
      ).toBe(true);
      expect(response.groundingStatus).not.toBe("FAILED");
    },
    30_000,
  );
});
