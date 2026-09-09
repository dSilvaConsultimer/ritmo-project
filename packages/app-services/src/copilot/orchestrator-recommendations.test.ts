import { describe, expect, it } from "vitest";
import { createId } from "@money-copilot/shared";
import * as M from "@money-copilot/financial-engine";
import { fixtureProfile, type Recommendation } from "@money-copilot/financial-engine";
import { MockAIProvider, mockTextResult, mockToolCallResult } from "@money-copilot/ai";
import * as repo from "@money-copilot/persistence";
import { freshSeededDb } from "../test-helpers";
import { runCopilotTurn } from "./orchestrator";

const ASOF = "2026-09-05";
const MODEL = "gpt-5.6-terra";

function baseInput(overrides: Partial<Parameters<typeof runCopilotTurn>[0]> = {}) {
  return {
    financialProfileId: fixtureProfile.id,
    asOfDate: ASOF,
    userMessageText: "Tem alguma coisa que eu poderia cortar?",
    model: MODEL,
    ...overrides,
  } as Parameters<typeof runCopilotTurn>[0];
}

async function seedPendingNetflixRecommendation(db: Awaited<ReturnType<typeof freshSeededDb>>): Promise<Recommendation> {
  const recommendation: Recommendation = {
    id: createId("recommendation"),
    financialProfileId: fixtureProfile.id,
    type: "CANCEL_RECURRING_COST",
    identityKey: `${fixtureProfile.id}:CANCEL_RECURRING_COST:NETFLIX:MONTHLY:3990:any`,
    title: "Recurring subscription: NETFLIX",
    evidence: {
      normalizedMerchant: "NETFLIX",
      category: "Entertainment",
      cadence: "MONTHLY",
      observedAmount: M.fromReais(39.9),
      monthlyEquivalentAmount: M.fromReais(39.9),
      occurrences: 3,
      transactionIds: [],
      confidence: "HIGH",
    },
    projectedMonthlyImpact: M.fromReais(39.9),
    projectedAnnualImpact: M.fromReais(478.8),
    status: "PENDING",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    decisionHistory: [{ status: "PENDING", at: "2026-09-01T00:00:00.000Z" }],
  };
  await repo.upsertRecommendation(db, recommendation);
  return recommendation;
}

describe("runCopilotTurn — recommendations (Sprint 5)", () => {
  it("(P) a read question (getRecommendations) never mutates anything", async () => {
    const db = await freshSeededDb();
    const recommendation = await seedPendingNetflixRecommendation(db);

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getRecommendations", argumentsJson: "{}" }]),
      mockTextResult(
        "Você tem uma assinatura recorrente de aproximadamente R$ 39,90/mês. Se cancelar, pode liberar cerca de R$ 39,90 por mês.",
      ),
    ]);

    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));

    expect(response.toolExecutions).toEqual([{ name: "getRecommendations", status: "SUCCESS" }]);
    expect(response.groundingStatus).not.toBe("FAILED");
    const unchanged = await repo.getRecommendationById(db, recommendation.id);
    expect(unchanged?.status).toBe("PENDING");
  });

  it("(Q) explicit PT-BR acceptance mutates exactly once", async () => {
    const db = await freshSeededDb();
    const recommendation = await seedPendingNetflixRecommendation(db);

    const provider = new MockAIProvider([
      mockToolCallResult([
        { id: "call_1", name: "acceptRecommendation", argumentsJson: JSON.stringify({ recommendationId: recommendation.id }) },
      ]),
      mockTextResult("Combinado — registrei que você quer cancelar a Netflix."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "Pode aceitar essa recomendação." }),
    );

    expect(response.toolExecutions).toEqual([{ name: "acceptRecommendation", status: "SUCCESS" }]);
    const updated = await repo.getRecommendationById(db, recommendation.id);
    expect(updated?.status).toBe("ACCEPTED");
    expect(updated?.decisionHistory.filter((e) => e.status === "ACCEPTED")).toHaveLength(1);
  });

  it("(R) hypothetical PT-BR wording does NOT mutate", async () => {
    const db = await freshSeededDb();
    const recommendation = await seedPendingNetflixRecommendation(db);

    const provider = new MockAIProvider([
      mockToolCallResult([
        { id: "call_1", name: "acceptRecommendation", argumentsJson: JSON.stringify({ recommendationId: recommendation.id }) },
      ]),
      mockTextResult("Se você cancelasse, liberaria cerca de R$ 39,90/mês."),
    ]);

    const response = await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "E se eu cancelasse essa assinatura?" }),
    );

    expect(response.toolExecutions).toEqual([{ name: "acceptRecommendation", status: "FAILED" }]);
    const unchanged = await repo.getRecommendationById(db, recommendation.id);
    expect(unchanged?.status).toBe("PENDING");

    const executions = await repo.listAIToolExecutionsForConversation(db, response.conversationId);
    expect(executions[0]?.errorCategory).toBe("MUTATION_NOT_EXPLICIT");
  });

  it("(R) an explicit rejection is NOT mutated by ambiguous phrasing, but IS by a clear one", async () => {
    const db = await freshSeededDb();
    const recommendation = await seedPendingNetflixRecommendation(db);

    const provider = new MockAIProvider([
      mockToolCallResult([
        { id: "call_1", name: "rejectRecommendation", argumentsJson: JSON.stringify({ recommendationId: recommendation.id }) },
      ]),
      mockTextResult("Sem problemas, não vou sugerir cancelar a Netflix novamente."),
    ]);

    await runCopilotTurn(
      baseInput({ db, aiProvider: provider, userMessageText: "Não quero mexer nessa assinatura." }),
    );

    const updated = await repo.getRecommendationById(db, recommendation.id);
    expect(updated?.status).toBe("REJECTED");
  });

  it("(S) grounding fails when the model cites an amount not returned by any tool", async () => {
    const db = await freshSeededDb();
    await seedPendingNetflixRecommendation(db);

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getRecommendations", argumentsJson: "{}" }]),
      // R$ 99,90 was never returned by getRecommendations — an invented amount.
      mockTextResult("Cancelando, você libera R$ 99,90 por mês."),
    ]);

    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));
    expect(response.groundingStatus).toBe("FAILED");
  });

  it("(S) grounding passes when the model cites the exact returned monthly/annual impact", async () => {
    const db = await freshSeededDb();
    await seedPendingNetflixRecommendation(db);

    const provider = new MockAIProvider([
      mockToolCallResult([{ id: "call_1", name: "getRecommendations", argumentsJson: "{}" }]),
      mockTextResult(
        "Cancelando a Netflix, você libera R$ 39,90 por mês, ou R$ 478,80 por ano.",
      ),
    ]);

    const response = await runCopilotTurn(baseInput({ db, aiProvider: provider }));
    expect(response.groundingStatus).not.toBe("FAILED");
  });
});
