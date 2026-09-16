import { describe, expect, it } from "vitest";
import {
  containsHypotheticalLanguage,
  hasExplicitCategoryCreationIntent,
  hasExplicitMutationIntent,
} from "./mutation-guard";

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
    "Transferi 2 mil do Itaú para o Nubank.",
    "Apliquei 500 no CDB.",
    "Resgatei 200 do CDB.",
    "Classifique sempre que aparecer POSTO CAMPINAS como Combustível.",
    "Confirmo, é isso mesmo.",
  ])("(DEC-132) returns true for explicit manual-entry/classification action: %s", (text) => {
    expect(hasExplicitMutationIntent(text)).toBe(true);
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

  it.each([
    "Pode aceitar essa recomendação.",
    "Aceito, pode cancelar.",
    "Na verdade quero reduzir para R$ 30.",
    "Não quero mexer nessa assinatura.",
    "Rejeito essa recomendação.",
  ])("(Sprint 5) returns true for explicit PT-BR recommendation decisions: %s", (text) => {
    expect(hasExplicitMutationIntent(text)).toBe(true);
  });

  it.each(["E se eu cancelasse essa assinatura?", "Será que eu deveria cancelar a Netflix?"])(
    "(Sprint 5) returns false for hypothetical PT-BR recommendation language: %s",
    (text) => {
      expect(hasExplicitMutationIntent(text)).toBe(false);
    },
  );

  it.each([
    "Vamos com a opção B.",
    "Escolho essa.",
    "Fico com essa opção.",
    "Separa R$ 250 para hoje à noite.",
  ])("(Sprint 6) returns true for explicit PT-BR concierge plan selection/reservation: %s", (text) => {
    expect(hasExplicitMutationIntent(text)).toBe(true);
  });

  it.each(["E se eu escolhesse a opção B?", "Poderia separar R$ 250 para isso?"])(
    "(Sprint 6) returns false for hypothetical PT-BR concierge language: %s",
    (text) => {
      expect(hasExplicitMutationIntent(text)).toBe(false);
    },
  );

  it.each([
    "Pode marcar como visto.",
    "Marca como visto.",
    "Pode ignorar esse alerta.",
    "Ignora esse alerta.",
    "Não quero mais receber alertas de concierge.",
    "Pare de me avisar sobre isso.",
    "Mark this as seen.",
    "Dismiss this alert.",
    // DEC-082 (real live bug): the object sits BETWEEN the verb and "como
    // visto" in natural phrasing — found via live validation, where the
    // model echoed the user's own words back almost verbatim and the
    // original adjacent-words-only pattern missed it entirely.
    "Pode marcar o alerta do Safe-to-Spend como visto.",
    "Marca esse alerta como visto, por favor.",
  ])("(Sprint 7) returns true for explicit alert mark-seen/dismiss/preference language: %s", (text) => {
    expect(hasExplicitMutationIntent(text)).toBe(true);
  });

  it.each(["E se eu ignorasse esse alerta?", "Poderia marcar como visto?"])(
    "(Sprint 7) returns false for hypothetical alert language: %s",
    (text) => {
      expect(hasExplicitMutationIntent(text)).toBe(false);
    },
  );

  it.each(["Quais alertas eu tenho?", "Por que você está me avisando disso?"])(
    "(Sprint 7) a plain question about alerts is never treated as explicit mutation intent: %s",
    (text) => {
      expect(hasExplicitMutationIntent(text)).toBe(false);
    },
  );
});

describe("hasExplicitCategoryCreationIntent (DEC-138)", () => {
  it.each([
    "Crie uma categoria chamada Trabalho",
    "Quero criar uma categoria Despesas da casa",
    "Adicione uma nova categoria chamada Viagens",
    "Cadastre uma categoria chamada Pets",
    "Create a category called Work",
    "Add a new category named Travel",
  ])("returns true for explicit category-creation intent: %s", (text) => {
    expect(hasExplicitCategoryCreationIntent(text)).toBe(true);
  });

  it.each([
    // Explicit MUTATION intent (spending/recording) is not, by itself,
    // category-creation intent — this is the exact gap DEC-138 closes.
    "Pago fisioterapia todo mês",
    "Gastei R$200 no médico",
    "Isso é uma despesa de saúde",
    "Coloca isso no meu planejamento",
    "Paguei a consulta médica hoje",
    "Registre R$ 250 no Restaurante X.",
  ])("returns false for an ordinary request with no explicit creation intent: %s", (text) => {
    expect(hasExplicitCategoryCreationIntent(text)).toBe(false);
  });

  it("returns false for hypothetical category-creation phrasing", () => {
    expect(hasExplicitCategoryCreationIntent("Poderia criar uma categoria chamada Trabalho?")).toBe(
      false,
    );
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
