import type { FinancialFact } from "./facts";

/**
 * Protection against hallucinated financial amounts — see
 * docs/AI-COPILOT.md, "Financial fact grounding." Deliberately narrow: this
 * only checks BRL-shaped monetary figures in the assistant's prose against
 * the deterministic facts computed this turn (plus any amount the user
 * themselves typed), rather than attempting general natural-language
 * verification — see NON-NEGOTIABLE (Sprint 4): "do not over-engineer
 * general NL verification."
 */

const CURRENCY_AMOUNT_PATTERN = /(?:R\$|BRL)\s?(-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?|-?\d+)/gi;

/** Parses a BRL-formatted numeric substring (already stripped of the currency marker) into integer cents. */
function parseBRLAmountToCents(raw: string): number | undefined {
  let normalized = raw.trim();
  // Disambiguate "1.234,56" (BR) vs "1,234.56" (US-ish typed by an LLM) vs plain "250".
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && hasDot) {
    // Whichever separator appears LAST is the decimal separator.
    normalized =
      normalized.lastIndexOf(",") > normalized.lastIndexOf(".")
        ? normalized.replace(/\./g, "").replace(",", ".")
        : normalized.replace(/,/g, "");
  } else if (hasComma) {
    // A single comma with exactly 2 trailing digits is a decimal separator; otherwise a thousands separator.
    normalized = /,\d{2}$/.test(normalized) ? normalized.replace(",", ".") : normalized.replace(/,/g, "");
  }
  const value = Number.parseFloat(normalized);
  if (Number.isNaN(value)) return undefined;
  return Math.round(value * 100);
}

/** Extracts every BRL-shaped monetary amount (in cents) mentioned in free text. */
export function extractMentionedAmountsCents(text: string): number[] {
  const amounts: number[] = [];
  for (const match of text.matchAll(CURRENCY_AMOUNT_PATTERN)) {
    const cents = parseBRLAmountToCents(match[1] ?? "");
    if (cents !== undefined) amounts.push(cents);
  }
  return amounts;
}

export interface GroundingResult {
  readonly status: "PASSED" | "FAILED" | "NOT_APPLICABLE";
  /** Amounts mentioned in the assistant text that could not be traced to a fact or the user's own message. */
  readonly unsupportedAmountsCents: readonly number[];
}

/**
 * Checks that every BRL amount the assistant's text mentions is traceable
 * to either a deterministic `FinancialFact` computed this turn or an
 * amount the user themselves supplied — never an amount the model
 * invented. See NON-NEGOTIABLE (Sprint 4): "the system must not silently
 * present it as financial truth."
 */
export function groundResponseText(
  assistantText: string,
  facts: readonly FinancialFact[],
  userMessageText: string,
): GroundingResult {
  const mentioned = extractMentionedAmountsCents(assistantText);
  if (mentioned.length === 0) {
    return { status: "NOT_APPLICABLE", unsupportedAmountsCents: [] };
  }

  const allowed = new Set<number>([
    ...facts.map((f) => f.amountCents),
    ...extractMentionedAmountsCents(userMessageText),
  ]);

  const unsupported = mentioned.filter((cents) => !allowed.has(cents));
  return {
    status: unsupported.length === 0 ? "PASSED" : "FAILED",
    unsupportedAmountsCents: unsupported,
  };
}

/** A deterministic, template-based fallback used when grounding fails — never trusts the model's prose for money. */
export function buildFallbackResponseText(facts: readonly FinancialFact[]): string {
  if (facts.length === 0) {
    return "I wasn't able to verify the amounts in my previous response, and I don't have deterministic figures to share right now. Could you rephrase your question?";
  }
  const lines = facts.map((f) => `- ${f.label}: ${formatCentsAsBRL(f.amountCents)}`);
  return ["Here's what I can confirm from your financial plan:", ...lines].join("\n");
}

function formatCentsAsBRL(cents: number): string {
  const reais = cents / 100;
  return `R$ ${reais.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
