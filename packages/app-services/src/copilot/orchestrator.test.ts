import { describe, expect, it } from "vitest";
import { fixtureProfile } from "@money-copilot/financial-engine";
import { AIError, MockAIProvider, mockTextResult, mockToolCallResult } from "@money-copilot/ai";
import * as repo from "@money-copilot/persistence";
import { freshSeededDb } from "../test-helpers";
import { getSafeToSpend } from "../queries";
import { MAX_TOOL_ITERATIONS, runCopilotTurn } from "./orchestrator";

const ASOF = "2026-09-05";
const MODEL = "gpt-5.6-terra";

function baseInput(overrides: Partial<Parameters<typeof runCopilotTurn>[0]> = {}) {
  return {
    financialProfileId: fixtureProfile.id,
    asOfDate: ASOF,
    userMessageText: "How am I doing this month?",
    model: MODEL,
    ...overrides,
  } as Parameters<typeof runCopilotTurn>[0];
}

describe("runCopilotTurn — conversation persistence", () => {
  it("persists the user message and the assistant's final response", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([mockTextResult("You're on track this month.")]);

    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));

    const history = await repo.listConversationMessages(db, response.conversationId);
    expect(history.map((m) => m.role)).toEqual(["USER", "ASSISTANT"]);
    expect(history[1]?.content).toBe("You're on track this month.");
  });

  it("reuses an existing conversation across turns — history is app-owned, not provider-hosted", async () => {
    const db = await freshSeededDb();
    const providerA = new MockAIProvider([mockTextResult("First reply.")]);
    const first = await runCopilotTurn(
      baseInput({ db, aiProvider: providerA, userMessageText: "Hi" }),
    );

    // A brand-new provider instance (simulating a swapped/independent provider process)
    // must still see the FULL prior history, because it's reconstructed from the DB,
    // never from any in-memory provider state.
    const providerB = new MockAIProvider([mockTextResult("Second reply.")]);
    await runCopilotTurn(
      baseInput({
        db,
        aiProvider: providerB,
        conversationId: first.conversationId,
        userMessageText: "And now?",
      }),
    );

    const sentToProviderB = providerB.calls[0]!.input;
    const messageContents = sentToProviderB
      .filter((item) => item.type === "message")
      .map((item) => ("content" in item ? item.content : ""));
    expect(messageContents).toContain("Hi");
    expect(messageContents).toContain("First reply.");
    expect(messageContents).toContain("And now?");
  });
});

describe("runCopilotTurn — read tool execution", () => {
  it("executes a READ tool and grounds the Sprint 1-3 Safe-to-Spend regression value (217_111 cents)", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getSafeToSpend", argumentsJson: "{}" }]),
      mockTextResult("You can safely spend R$ 2.171,11 for the rest of the month."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "How much can I spend this month?" }),
    );

    expect(response.groundingStatus).toBe("PASSED");
    expect(response.toolExecutions).toEqual([{ name: "getSafeToSpend", status: "SUCCESS" }]);
    const safeToSpendFact = response.financialFacts.find((f) => f.semanticType === "SAFE_TO_SPEND");
    expect(safeToSpendFact?.amountCents).toBe(217_111);
  });

  it("persists a SUCCESS AIToolExecution audit row with a small structured result reference", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getSafeToSpend", argumentsJson: "{}" }]),
      mockTextResult("You can safely spend R$ 2.171,11."),
    ]);
    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));

    const executions = await repo.listAIToolExecutionsForConversation(db, response.conversationId);
    expect(executions).toHaveLength(1);
    expect(executions[0]?.toolName).toBe("getSafeToSpend");
    expect(executions[0]?.status).toBe("SUCCESS");
    expect(executions[0]?.resultSummaryJson).toBeDefined();
    expect(executions[0]!.resultSummaryJson!.length).toBeLessThan(4100);
  });

  it("never lets the model call an unregistered tool — the sandbox rejects it without crashing", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "dropAllTables", argumentsJson: "{}" }]),
      mockTextResult("I couldn't complete that."),
    ]);

    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));
    expect(response.toolExecutions).toEqual([{ name: "dropAllTables", status: "INVALID_ARGUMENTS" }]);

    const executions = await repo.listAIToolExecutionsForConversation(db, response.conversationId);
    expect(executions[0]?.errorCategory).toBe("AI_INVALID_TOOL_ARGUMENTS");
  });

  it("rejects invalid tool arguments (negative amount) before ever calling the tool", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([
        { id: "call_1", name: "simulateExpense", argumentsJson: JSON.stringify({ amountReais: -5, category: "Food" }) },
      ]),
      mockTextResult("I couldn't simulate that."),
    ]);

    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));
    expect(response.toolExecutions).toEqual([{ name: "simulateExpense", status: "INVALID_ARGUMENTS" }]);
  });

  it("handles a tool execution failure gracefully instead of crashing the turn", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([
        {
          id: "call_1",
          name: "updatePlannedFinancialEvent",
          argumentsJson: JSON.stringify({ eventId: "does-not-exist", budgetAmountReais: 100 }),
        },
      ]),
      mockTextResult("I couldn't find that event."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "Reserve R$100 for event X, add it." }),
    );
    expect(response.toolExecutions).toEqual([{ name: "updatePlannedFinancialEvent", status: "FAILED" }]);

    const executions = await repo.listAIToolExecutionsForConversation(db, response.conversationId);
    expect(executions[0]?.errorCategory).toBe("AI_TOOL_EXECUTION_FAILED");
  });
});

describe("runCopilotTurn — explicit mutation policy", () => {
  it("does NOT execute a mutation tool for hypothetical language", async () => {
    const db = await freshSeededDb();
    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);

    const provider = new MockAIProvider([
      mockToolCallResult([
        {
          id: "call_1",
          name: "recordManualTransaction",
          argumentsJson: JSON.stringify({ amountReais: 250, merchantOrDescription: "Restaurant X", date: ASOF }),
        },
      ]),
      mockTextResult("Spending R$250 would be within your recommended limit."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "What if I spend R$250 at Restaurant X?" }),
    );

    expect(response.toolExecutions).toEqual([{ name: "recordManualTransaction", status: "FAILED" }]);
    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(after.total.cents).toBe(before.total.cents);

    const executions = await repo.listAIToolExecutionsForConversation(db, response.conversationId);
    expect(executions[0]?.errorCategory).toBe("MUTATION_NOT_EXPLICIT");
  });

  it("DOES execute a mutation tool for explicit, decided action language", async () => {
    const db = await freshSeededDb();
    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);

    const provider = new MockAIProvider([
      mockToolCallResult([
        {
          id: "call_1",
          name: "recordManualTransaction",
          argumentsJson: JSON.stringify({ amountReais: 250, merchantOrDescription: "Restaurant X", date: ASOF }),
        },
      ]),
      mockTextResult("Got it — recorded R$250 at Restaurant X."),
    ]);

    await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "I just spent R$250 at Restaurant X." }),
    );

    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(after.total.cents).toBe(before.total.cents - 25_000);
  });
});

describe("runCopilotTurn — bounded tool loop", () => {
  it("never loops forever — falls back to a deterministic response after MAX_TOOL_ITERATIONS", async () => {
    const db = await freshSeededDb();
    const alwaysCallsATool = Array.from({ length: MAX_TOOL_ITERATIONS }, () =>
      mockToolCallResult([{ id: "call_1", name: "getSafeToSpend", argumentsJson: "{}" }]),
    );
    const provider = new MockAIProvider(alwaysCallsATool);

    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));

    expect(provider.calls).toHaveLength(MAX_TOOL_ITERATIONS);
    expect(response.warnings.some((w) => w.toLowerCase().includes("maximum number of tool steps"))).toBe(true);
    expect(response.text.length).toBeGreaterThan(0);
  });
});

describe("runCopilotTurn — AI provider failure handling", () => {
  it("propagates a normalized AIError and logs the failed request", async () => {
    const db = await freshSeededDb();
    const workingProvider = new MockAIProvider([mockTextResult("ok")]);
    const first = await runCopilotTurn(baseInput({ db, aiProvider: workingProvider }));

    const failingProvider = new MockAIProvider(() => {
      throw new AIError("AI_RATE_LIMITED", "Too many requests.");
    });

    await expect(
      runCopilotTurn(
        baseInput({ db, aiProvider: failingProvider, conversationId: first.conversationId }),
      ),
    ).rejects.toThrow(AIError);

    const logs = await repo.listAIRequestLogsForConversation(db, first.conversationId);
    const failed = logs.find((l) => !l.success);
    expect(failed?.errorCode).toBe("AI_RATE_LIMITED");
  });

  it("normalizes a timeout the same way", async () => {
    const db = await freshSeededDb();
    const timeoutProvider = new MockAIProvider(() => {
      throw new AIError("AI_TIMEOUT", "Request timed out.");
    });

    await expect(runCopilotTurn(baseInput({ db, aiProvider: timeoutProvider }))).rejects.toMatchObject({
      code: "AI_TIMEOUT",
    });
  });
});

describe("runCopilotTurn — financial fact grounding", () => {
  it("replaces an unsupported, AI-invented amount with a deterministic fallback", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getSafeToSpend", argumentsJson: "{}" }]),
      mockTextResult("You can safely spend R$ 999,99 today."),
    ]);

    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));

    expect(response.groundingStatus).toBe("FAILED");
    expect(response.text).not.toContain("999,99");
    expect(response.warnings.some((w) => w.includes("unverified"))).toBe(true);
  });

  it("allows an amount the user themselves typed, even with no matching tool fact", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getSafeToSpend", argumentsJson: "{}" }]),
      mockTextResult("Spending R$ 650,00 would exceed your recommended limit of R$ 2.171,11 by quite a lot— wait, actually it wouldn't."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "Can I spend R$ 650,00 today?" }),
    );
    expect(response.groundingStatus).toBe("PASSED");
  });

  it("financial facts are structured and separate from the narrative text", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getSpendingEnvelope", argumentsJson: "{}" }]),
      mockTextResult("For a night out, aim to stay within your recommended amount."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "How much can I spend on a date tonight?" }),
    );

    expect(response.financialFacts.length).toBeGreaterThan(0);
    expect(response.financialFacts.some((f) => f.semanticType === "RECOMMENDED_LIMIT")).toBe(true);
    expect(response.financialFacts.some((f) => f.semanticType === "CAUTION_LIMIT")).toBe(true);
  });
});

describe("runCopilotTurn — PT-BR conversational scenarios (Sprint 4.5 hardening)", () => {
  it("answers a PT-BR Safe-to-Spend question and grounds the regression value (217_111 cents)", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getSafeToSpend", argumentsJson: "{}" }]),
      mockTextResult("Você pode gastar com segurança R$ 2.171,11 pelo resto do mês."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "Quanto posso gastar até o fim do mês?" }),
    );

    expect(response.groundingStatus).toBe("PASSED");
    const fact = response.financialFacts.find((f) => f.semanticType === "SAFE_TO_SPEND");
    expect(fact?.amountCents).toBe(217_111);
  });

  it("does NOT execute a mutation tool for PT-BR hypothetical language ('E se eu gastasse...')", async () => {
    const db = await freshSeededDb();
    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);

    const provider = new MockAIProvider([
      mockToolCallResult([
        {
          id: "call_1",
          name: "recordManualTransaction",
          argumentsJson: JSON.stringify({ amountReais: 250, merchantOrDescription: "Restaurante X", date: ASOF }),
        },
      ]),
      mockTextResult("Gastar R$ 250 ainda estaria dentro do seu limite recomendado."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "E se eu gastasse R$ 250 no Restaurante X?" }),
    );

    expect(response.toolExecutions).toEqual([{ name: "recordManualTransaction", status: "FAILED" }]);
    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(after.total.cents).toBe(before.total.cents);
  });

  it("DOES execute a mutation tool for PT-BR explicit, decided action language ('Gastei...')", async () => {
    const db = await freshSeededDb();
    const before = await getSafeToSpend(db, fixtureProfile.id, ASOF);

    const provider = new MockAIProvider([
      mockToolCallResult([
        {
          id: "call_1",
          name: "recordManualTransaction",
          argumentsJson: JSON.stringify({ amountReais: 250, merchantOrDescription: "Restaurante X", date: ASOF }),
        },
      ]),
      mockTextResult("Anotado — R$ 250 no Restaurante X foi registrado."),
    ]);

    await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "Gastei R$ 250 no Restaurante X." }),
    );

    const after = await getSafeToSpend(db, fixtureProfile.id, ASOF);
    expect(after.total.cents).toBe(before.total.cents - 25_000);
  });

  it("replaces an AI-invented amount in PT-BR prose with a deterministic fallback", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getSafeToSpend", argumentsJson: "{}" }]),
      mockTextResult("Você pode gastar até R$ 999,99 hoje sem problemas."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "Quanto posso gastar hoje?" }),
    );

    expect(response.groundingStatus).toBe("FAILED");
    expect(response.text).not.toContain("999,99");
  });

  it("answers the PT-BR independent-living question via getLifestyleComparison", async () => {
    const db = await freshSeededDb();
    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getLifestyleComparison", argumentsJson: "{}" }]),
      mockTextResult("Ainda não é o momento ideal para morar sozinho, considerando seu plano atual."),
    ]);

    const response = await runCopilotTurn(
      baseInput({
        db,
        aiProvider: provider,
        userMessageText: "Estou financeiramente pronto para morar sozinho?",
      }),
    );

    expect(response.toolExecutions).toEqual([{ name: "getLifestyleComparison", status: "SUCCESS" }]);
    expect(response.groundingStatus).not.toBe("FAILED");
  });
});
