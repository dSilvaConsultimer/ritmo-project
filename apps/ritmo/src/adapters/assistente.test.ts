import { describe, expect, it } from "vitest";
import type { Id } from "@money-copilot/shared";
import type { AssistenteData } from "@/functions/assistente";
import {
  parseInlineMarkdown,
  toAssistenteMessages,
  toSimulationCard,
  type AssistenteFact,
} from "./assistente";

function msgId(raw: string): Id<"conversation-message"> {
  return raw as Id<"conversation-message">;
}

describe("toAssistenteMessages", () => {
  it("maps USER/ASSISTANT roles and drops SYSTEM messages, never rendered in the chat UI", () => {
    const data: AssistenteData = {
      conversationId: null,
      messages: [
        { id: msgId("m0"), role: "SYSTEM", content: "You are..." },
        { id: msgId("m1"), role: "USER", content: "Posso gastar R$ 300 hoje?" },
        { id: msgId("m2"), role: "ASSISTANT", content: "Pode sim." },
      ],
    };
    expect(toAssistenteMessages(data)).toEqual([
      { id: "m1", role: "user", text: "Posso gastar R$ 300 hoje?" },
      { id: "m2", role: "assistant", text: "Pode sim." },
    ]);
  });

  it("returns an empty list for a fresh conversation, never a fabricated scripted exchange", () => {
    expect(toAssistenteMessages({ conversationId: null, messages: [] })).toEqual([]);
  });
});

describe("toSimulationCard", () => {
  it("builds the card from the real simulateExpense facts when all three are present", () => {
    const facts: AssistenteFact[] = [
      {
        label: "Recommended limit",
        amountCents: 30_000,
        sourceTool: "simulateExpense",
        semanticType: "RECOMMENDED_LIMIT",
      },
      {
        label: "Projected savings after this expense",
        amountCents: 154_200,
        sourceTool: "simulateExpense",
        semanticType: "PROJECTED_SAVINGS",
      },
      {
        label: "Compensation required",
        amountCents: 0,
        sourceTool: "simulateExpense",
        semanticType: "COMPENSATION_REQUIRED",
      },
    ];
    expect(toSimulationCard(facts)).toEqual({
      recommendedLimitLabel: "R$ 300,00",
      projectedSavingsAfterLabel: "R$ 1.542,00",
      compensationRequiredLabel: "R$ 0,00",
    });
  });

  it("never fabricates a card when the assistant didn't actually run a simulation this turn", () => {
    expect(toSimulationCard([])).toBeNull();
    const otherToolFacts: AssistenteFact[] = [
      {
        label: "Usable income",
        amountCents: 1_500_000,
        sourceTool: "getFinancialSnapshot",
        semanticType: "INCOME",
      },
    ];
    expect(toSimulationCard(otherToolFacts)).toBeNull();
  });
});

describe("parseInlineMarkdown", () => {
  it("splits **bold** spans out of the live model's plain-text reply, never leaving literal asterisks", () => {
    expect(parseInlineMarkdown("R$ 50 hoje está **seguro** dentro do seu plano.")).toEqual([
      { text: "R$ 50 hoje está ", bold: false },
      { text: "seguro", bold: true },
      { text: " dentro do seu plano.", bold: false },
    ]);
  });

  it("returns a single plain segment when there is no markdown at all", () => {
    expect(parseInlineMarkdown("Pode sim.")).toEqual([{ text: "Pode sim.", bold: false }]);
  });
});
