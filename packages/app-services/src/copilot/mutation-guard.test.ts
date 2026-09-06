import { describe, expect, it } from "vitest";
import { containsHypotheticalLanguage, hasExplicitMutationIntent } from "./mutation-guard";

describe("hasExplicitMutationIntent", () => {
  it.each([
    "I spent BRL 250.",
    "Record BRL 250 at Restaurant X.",
    "Reserve BRL 1,000 for the beach.",
    "I'm definitely going to the beach September 25-27; add it.",
  ])("returns true for explicit action: %s", (text) => {
    expect(hasExplicitMutationIntent(text)).toBe(true);
  });

  it.each([
    "What if I spend BRL 250?",
    "Could I reserve BRL 1,000?",
    "How much should I reserve for the beach?",
  ])("returns false for hypothetical language: %s", (text) => {
    expect(hasExplicitMutationIntent(text)).toBe(false);
  });

  it("returns false for ambiguous text with no clear signal either way", () => {
    expect(hasExplicitMutationIntent("The beach trip sounds fun.")).toBe(false);
  });

  it("never treats a pure question about spending as explicit, even without 'what if'", () => {
    expect(hasExplicitMutationIntent("Can I spend R$500 today?")).toBe(false);
  });

  it.each([
    "Gastei R$ 250 no Restaurante X.",
    "Acabei de gastar R$ 250 no Restaurante X.",
    "Reserve R$ 1.000 para a praia.",
    "Vou definitivamente para a praia dia 25 de setembro; adicione.",
    "Registre R$ 250 no Restaurante X.",
    "Confirmo, pode adicionar.",
  ])("returns true for explicit PT-BR action: %s", (text) => {
    expect(hasExplicitMutationIntent(text)).toBe(true);
  });

  it.each([
    "E se eu gastasse R$ 250?",
    "Poderia reservar R$ 1.000 para a praia?",
    "Quanto eu deveria reservar para a praia?",
    "Será que eu deveria gastar R$ 250?",
    "Posso reservar R$ 1.000 para a praia?",
  ])("returns false for hypothetical PT-BR language: %s", (text) => {
    expect(hasExplicitMutationIntent(text)).toBe(false);
  });

  it("never treats a pure PT-BR affordability question as explicit", () => {
    expect(hasExplicitMutationIntent("Posso gastar R$ 500 hoje?")).toBe(false);
  });
});

describe("containsHypotheticalLanguage", () => {
  it("detects common hypothetical markers", () => {
    expect(containsHypotheticalLanguage("What if I spend BRL 250?")).toBe(true);
    expect(containsHypotheticalLanguage("Could I reserve BRL 1,000?")).toBe(true);
  });

  it("does not flag a plain statement of fact", () => {
    expect(containsHypotheticalLanguage("I spent BRL 250.")).toBe(false);
  });

  it("detects common PT-BR hypothetical markers", () => {
    expect(containsHypotheticalLanguage("E se eu gastasse R$ 250?")).toBe(true);
    expect(containsHypotheticalLanguage("Será que eu poderia reservar R$ 1.000?")).toBe(true);
  });

  it("does not flag a plain PT-BR statement of fact", () => {
    expect(containsHypotheticalLanguage("Gastei R$ 250 no restaurante.")).toBe(false);
  });
});
