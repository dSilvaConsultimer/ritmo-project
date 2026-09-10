import type { AssistenteData } from "@/functions/assistente";
import { brl } from "./format";

export interface AssistenteMessage {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

export interface TextSegment {
  readonly text: string;
  readonly bold: boolean;
}

/**
 * The live model's replies use plain `**bold**` markdown — the approved
 * chat bubble is a plain `<p>`, never a markdown renderer, so without this
 * the literal asterisks would show up in the UI (a real rendering defect
 * found live, not present in the scripted mock). This only ever splits
 * `**...**` spans into bold/plain segments — never a general markdown
 * parser, and never touches the bubble's own visual container.
 */
export function parseInlineMarkdown(text: string): TextSegment[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith("**") && part.endsWith("**")
        ? { text: part.slice(2, -2), bold: true }
        : { text: part, bold: false },
    );
}

export interface SimulationCard {
  readonly recommendedLimitLabel: string;
  readonly projectedSavingsAfterLabel: string;
  readonly compensationRequiredLabel: string;
}

/** SYSTEM messages are orchestration plumbing, never shown in the chat UI. */
export function toAssistenteMessages(data: AssistenteData): AssistenteMessage[] {
  return data.messages
    .filter((m) => m.role !== "SYSTEM")
    .map((m) => ({ id: m.id, role: m.role === "USER" ? "user" : "assistant", text: m.content }));
}

export interface AssistenteFact {
  readonly label: string;
  readonly amountCents: number;
  readonly sourceTool: string;
  readonly semanticType: string;
}

/**
 * The Lovable mock's "Simulação" card shows a fabricated "Hoje/Depois"
 * Safe-to-Spend pair that the real `simulateExpense` tool doesn't return in
 * that exact shape — its real, deterministic output is a recommended
 * limit, the projected savings after the expense, and any compensation
 * required to still hit the goal. This card only ever appears when the
 * assistant actually ran that tool this turn, and only ever shows those
 * three real figures — never a fabricated before/after pair (see
 * docs/RITMO.md, "Data-model gaps").
 */
export function toSimulationCard(facts: readonly AssistenteFact[]): SimulationCard | null {
  const bySemanticType = new Map(
    facts.filter((f) => f.sourceTool === "simulateExpense").map((f) => [f.semanticType, f]),
  );

  const recommendedLimit = bySemanticType.get("RECOMMENDED_LIMIT");
  const projectedSavings = bySemanticType.get("PROJECTED_SAVINGS");
  const compensationRequired = bySemanticType.get("COMPENSATION_REQUIRED");

  if (!recommendedLimit || !projectedSavings || !compensationRequired) return null;

  return {
    recommendedLimitLabel: brl(recommendedLimit.amountCents),
    projectedSavingsAfterLabel: brl(projectedSavings.amountCents),
    compensationRequiredLabel: brl(compensationRequired.amountCents),
  };
}
