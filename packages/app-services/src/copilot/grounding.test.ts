import { describe, expect, it } from "vitest";
import { buildFallbackResponseText, extractMentionedAmountsCents, groundResponseText } from "./grounding";
import type { FinancialFact } from "./facts";

describe("extractMentionedAmountsCents", () => {
  it("parses R$ amounts with a decimal comma", () => {
    expect(extractMentionedAmountsCents("You can spend R$ 217,11 today.")).toEqual([21_711]);
  });

  it("parses BRL amounts with a plain decimal point", () => {
    expect(extractMentionedAmountsCents("BRL 217.11 is available.")).toEqual([21_711]);
  });

  it("parses thousands-separated amounts", () => {
    expect(extractMentionedAmountsCents("R$ 1.200,00 reserved for the trip.")).toEqual([120_000]);
  });

  it("returns an empty array when no currency amount is present", () => {
    expect(extractMentionedAmountsCents("You're doing great this month!")).toEqual([]);
  });
});

describe("groundResponseText", () => {
  const facts: FinancialFact[] = [
    {
      label: "Recommended amount",
      amountCents: 21_711,
      certainty: "HIGH",
      sourceTool: "getSpendingEnvelope",
      semanticType: "RECOMMENDED_LIMIT",
    },
  ];

  it("passes when every mentioned amount matches a deterministic fact", () => {
    const result = groundResponseText("You can safely spend R$ 217,11 today.", facts, "How much can I spend today?");
    expect(result.status).toBe("PASSED");
  });

  it("is NOT_APPLICABLE when the response mentions no monetary amount", () => {
    const result = groundResponseText("You're doing great this month!", facts, "How am I doing?");
    expect(result.status).toBe("NOT_APPLICABLE");
  });

  it("fails when the model invents an amount not present in facts or user input", () => {
    const result = groundResponseText(
      "You can spend R$ 999,99 today.",
      facts,
      "How much can I spend today?",
    );
    expect(result.status).toBe("FAILED");
    expect(result.unsupportedAmountsCents).toEqual([99_999]);
  });

  it("allows an amount the user themselves supplied, even if no tool fact matches it", () => {
    const result = groundResponseText(
      "Spending R$ 650,00 would exceed your recommended limit of R$ 217,11.",
      facts,
      "I spent R$ 650,00 at the restaurant.",
    );
    expect(result.status).toBe("PASSED");
  });

  it("passes for grounded PT-BR prose (grounding is language-agnostic — only currency shapes are checked)", () => {
    const result = groundResponseText(
      "Você pode gastar com segurança R$ 217,11 hoje.",
      facts,
      "Quanto posso gastar hoje?",
    );
    expect(result.status).toBe("PASSED");
  });

  it("fails for an AI-invented amount in PT-BR prose just as it would in English", () => {
    const result = groundResponseText(
      "Você pode gastar até R$ 999,99 hoje sem problemas.",
      facts,
      "Quanto posso gastar hoje?",
    );
    expect(result.status).toBe("FAILED");
    expect(result.unsupportedAmountsCents).toEqual([99_999]);
  });

  it("allows a user-supplied amount in PT-BR even with no matching tool fact", () => {
    const result = groundResponseText(
      "Gastar R$ 650,00 ultrapassaria seu limite recomendado de R$ 217,11.",
      facts,
      "Gastei R$ 650,00 no restaurante.",
    );
    expect(result.status).toBe("PASSED");
  });
});

describe("buildFallbackResponseText", () => {
  it("renders every fact as a deterministic line, never inventing prose numbers", () => {
    const facts: FinancialFact[] = [
      {
        label: "Recommended amount",
        amountCents: 21_711,
        certainty: "HIGH",
        sourceTool: "getSpendingEnvelope",
        semanticType: "RECOMMENDED_LIMIT",
      },
    ];
    const text = buildFallbackResponseText(facts);
    expect(text).toContain("R$ 217,11");
  });

  it("asks the user to rephrase when there are no facts to fall back on", () => {
    expect(buildFallbackResponseText([])).toContain("rephrase");
  });
});
