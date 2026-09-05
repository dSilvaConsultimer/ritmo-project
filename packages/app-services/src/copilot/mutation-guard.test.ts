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
});

describe("containsHypotheticalLanguage", () => {
  it("detects common hypothetical markers", () => {
    expect(containsHypotheticalLanguage("What if I spend BRL 250?")).toBe(true);
    expect(containsHypotheticalLanguage("Could I reserve BRL 1,000?")).toBe(true);
  });

  it("does not flag a plain statement of fact", () => {
    expect(containsHypotheticalLanguage("I spent BRL 250.")).toBe(false);
  });
});
